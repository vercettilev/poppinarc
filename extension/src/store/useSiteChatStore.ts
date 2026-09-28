import { create } from "zustand"
import { startSitePresenceHeartbeat } from "~/helpers/presence"
import {
  initialSiteChatGate,
  siteChatGateReducer,
  siteChatGateView,
  SITE_PRESENCE_COUNT_STALE_MS,
  type SiteChatGateEvent,
  type SiteChatGateState,
  type SiteChatGateView,
} from "~/helpers/siteChatGate"
import { clearSiteChatTicket, getSiteChatTicket } from "~/helpers/siteChatApi"
import { canonicalSiteHost, siteChatHostFromUrl } from "~/helpers/siteChatHost"
import {
  createSiteChatTransport,
  type SiteChatDeleteError,
  type SiteChatHistoryError,
  type SiteChatJoinError,
  type SiteChatMessage,
  type SiteChatPostError,
  type SiteChatReportError,
  type SiteChatReportReply,
  type SiteChatTransport,
  type SiteChatUser,
} from "~/helpers/siteChatTransport"

/**
 * WEBSITE LIVE CHAT — everything the screen needs, and nothing it can decide.
 *
 * The store is a thin shell around two things that already exist: the pure
 * gate reducer (helpers/siteChatGate.ts) and the socket
 * (helpers/siteChatTransport.ts). It holds no rules of its own. Every state
 * change is either a server verdict handed to the reducer or a list of
 * messages the server sent us.
 *
 * ── WHY THE STORE OWNS THE SOCKET ───────────────────────────────────────────
 * The transport must be created once per panel document, torn down when the
 * panel closes, and pointed at whatever host the panel is looking at. That is
 * exactly the lifetime of this module. A component owning it would open a
 * second socket on every remount; the background worker owning it would lose
 * it to MV3 eviction (see the transport's header).
 *
 * ── THE COUNT COMES FROM THE HEARTBEAT, NOT FROM THE SOCKET ─────────────────
 * `setPage` starts helpers/presence.ts's HTTP heartbeat for the host and feeds
 * every answer into the reducer. It does NOT come over the socket, and the
 * reason is the pool's member id: the gateway would count an authenticated
 * socket as "u:<userId>" while the same reader's page beats anonymously, and
 * one person would fill two of the two seats the gate is counting. See the
 * transport's header — that socket cannot write presence at all.
 *
 * The panel's header runs the same heartbeat for the same host. That is not a
 * duplicate reader: both beats carry ONE per-install member id and the server's
 * write is an idempotent ZADD, so several writers never become several people
 * (site-presence.service.ts, `ping`). It costs one extra request per fifteen
 * seconds while this screen is open, and it buys a store that is correct on
 * its own — the chat screen must not depend on a header it does not render.
 *
 * ── THE SENDER SEES ITS OWN MESSAGE TWICE ───────────────────────────────────
 * Once as the `post` acknowledgement, once in the `message` broadcast — the
 * protocol pushes to the room INCLUDING the sender on purpose, so every client
 * renders from one ordered source instead of guessing optimistically. Both
 * paths land in `remember()`, which de-duplicates on `message.id`.
 *
 * ── R5 HAS TO SURVIVE THE PANEL CLOSING, NOT ONLY THE SOCKET DROPPING ───────
 * Membership is durable on the SERVER (30 days, per user — site-chat.config.ts
 * SITE_MEMBERSHIP_TTL_SECONDS), and the transport re-joins after a reconnect.
 * Neither of those survives the DOCUMENT dying, which the side panel does
 * every time the reader closes it. Without the hint below, a member who closed
 * the panel reopened into `member: false`, the heartbeat answered 1, and the
 * screen said "one more person needs to be here" — locked out of a room they
 * never left, which is the one thing R5 forbids. Nothing ever asked the server
 * the question, because the protocol has no verb that asks it: every verb the
 * gateway subscribes to is presence, admission, conversation or credential,
 * and not one of them is a read-only "am I already a member?".
 *
 * So this file keeps a HINT — {host: joinedAt} in chrome.storage.local — and
 * on `setPage` a hinted host re-sends `join`. Three things make that safe:
 *   - It is a cached copy of a SERVER fact, not a client-side gate. The server
 *     re-decides every verb; a stale `true` costs one refused join.
 *   - It never reads a count, so I2 holds: the population is still read in
 *     exactly one function, and that function is the server's.
 *   - `join` is idempotent for a member — decideAdmission checks membership
 *     BEFORE the population, and handleJoin broadcasts `member-joined` only
 *     when it admitted somebody NEW (`decision.reason === 'gate_open'`), so a
 *     resume is silent to the room.
 * The honest cost: if the server's record is gone (a Redis flush, or a `leave`
 * from another device) while the hint says otherwise, a resume onto a busy
 * host is admitted as a NEW member without a press. The reply does not say
 * which of the two happened, so this cannot be detected here — it can only be
 * kept rare, which is what clearing the hint on every proof of non-membership
 * (`gate_closed`, `not_member`, an explicit leave) does.
 *
 * ── THE COUNT EXPIRES; IT DOES NOT LINGER ───────────────────────────────────
 * A presence count is only true while the entries behind it are, so
 * `siteChatGateView` takes `now` and returns null past the TTL. Nothing here
 * polls to make that happen: after each count we set ONE timer for the moment
 * it stops being true, and that timer only bumps a counter so the view
 * recomputes. A panel that was closed for ten minutes reopens showing nothing
 * rather than announcing a crowd that left.
 */

/** Every refusal any verb can answer with. The UI phrases them; this only
 *  carries them, so the words live with the design and the codes live with
 *  the protocol. */
export type SiteChatNotice = {
  verb: "join" | "post" | "history" | "leave" | "delete"
  error:
    | SiteChatJoinError
    | SiteChatPostError
    | SiteChatHistoryError
    | SiteChatDeleteError
  retryAfterSeconds?: number
}

/**
 * `report` IS THE ONE VERB WHOSE ANSWER DOES NOT BECOME A NOTICE, and the
 * reason is where the reader is standing when it resolves.
 *
 * Every other refusal here is about the ROOM the reader is looking at — the
 * composer would not send, the history would not load — so a strip above the
 * composer is where their eyes already are. A report is a one-shot fired from
 * a row's ⋯ menu, and it needs to be answered in BOTH directions: silence
 * after "Report" is indistinguishable from a report that never left. So the
 * screen toasts it, success and failure alike, and this reply is what it
 * words that toast from.
 *
 * `ok: true` means "a human will see this" and NOTHING more — not that the
 * message was hidden, not that anyone was actioned. The wording at the call
 * site has to stay inside that claim.
 */
export type { SiteChatReportError, SiteChatReportReply }

interface SiteChatStore {
  /** The gate's memory. Read it through `view()`, never field by field. */
  gate: SiteChatGateState
  /** Canonical host the panel is looking at, or null. */
  host: string | null
  connected: boolean
  /** Oldest → newest, de-duplicated by id. */
  messages: SiteChatMessage[]
  /** People announced by `member-joined` since we entered. NOT the roster of
   *  everyone in the room — the server sends no roster, and inventing one
   *  from message authors would claim people are here who left. */
  arrivals: SiteChatUser[]
  /** Pass to `loadMore()` for older messages. null = no older page known. */
  nextCursor: string | null
  entering: boolean
  sending: boolean
  loadingHistory: boolean
  notice: SiteChatNotice | null
  /** Bumped when a count expires, so a subscriber re-renders. */
  tick: number

  /** Point the whole feature at a page. Takes a full URL or a hostname. */
  setPage(urlOrHost: string | null): void
  /** The reader pressed the pill. Server-authoritative: this asks, it does
   *  not decide. */
  enter(): Promise<void>
  send(content: string): Promise<void>
  /** Take back your OWN message. The server is the judge of "own"; the row
   *  leaves when it says so, never before. */
  deleteMessage(messageId: string): Promise<void>
  /** Send somebody ELSE'S message to a human. Answers with the server's reply
   *  rather than a notice — see `SiteChatReportReply` above for why. */
  report(messageId: string, reason?: string): Promise<SiteChatReportReply>
  loadMore(): Promise<void>
  /** THE ONLY WAY OUT (R5). Nothing else clears membership. */
  exit(): Promise<void>
  /** The panel document ending, or a sign-out that keeps it alive. Bound to
   *  `pagehide` by `bindDocumentTeardown`; see `stop()` for what it clears and
   *  why the store stays restartable afterwards. */
  stop(): void
  dismissNotice(): void
  /** What to draw, as of `now`. */
  view(now?: number): SiteChatGateView
}

/** One per document, created on first use. */
let transport: SiteChatTransport | null = null
/** The single expiry timer described in the header. */
let staleTimer: ReturnType<typeof setTimeout> | null = null
/** Stops the presence heartbeat for the host we are on. */
let stopHeartbeat: (() => void) | null = null
/** The host a resume is currently asking about, so two `setPage` calls in one
 *  frame cannot emit two joins. */
let resumeInFlight: string | null = null
/** Whether the document-teardown listener is already registered. One per
 *  document, not one per transport — see `bindDocumentTeardown`. */
let teardownBound = false

/**
 * Ids of the messages currently in `messages`, kept ALONGSIDE the array rather
 * than rebuilt from it. The old shape (`new Set(s.messages.map(m => m.id))`)
 * rescanned the whole conversation on every arriving frame; this is one lookup
 * per message. Cleared wherever `messages` is cleared — a set that outlived
 * its array would silently swallow a re-sent message.
 */
let seenMessageIds = new Set<string>()

/**
 * How many messages the LIVE path keeps. A panel left open on a busy site used
 * to accumulate the entire conversation for as long as the document lived.
 *
 * The cap is enforced on arrivals only. Paging back with `loadMore()` is the
 * reader asking for older messages by hand, and it stops on its own when the
 * room runs out; silently trimming what they just asked for would be the
 * screen fighting the scroll. So: the room cannot grow this without bound, the
 * reader can, and only while they keep pulling.
 */
const MAX_LIVE_MESSAGES = 500

/** chrome.storage.local key for the membership hints (see the header). */
const MEMBER_HINT_KEY = "siteChat.memberHints"

/** A hint older than the server's own membership TTL
 *  (SITE_MEMBERSHIP_TTL_SECONDS in apps/backend/src/site-chat/site-chat.config.ts,
 *  30 days) describes a record the server has certainly dropped. Acting on it
 *  would be a join nobody asked for, so it expires here too. */
const MEMBER_HINT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Hosts remembered at once. A reader who chats on hundreds of sites should
 *  not grow a storage key forever; the oldest hints fall off first. */
const MEMBER_HINT_MAX_HOSTS = 20

type MemberHints = Record<string, number>

/** chrome.storage is absent in specs and in any non-extension context, and a
 *  storage read is allowed to fail. Both mean the same thing: no hint, which
 *  degrades to exactly the behaviour before hints existed. */
function hintStore(): typeof chrome.storage.local | null {
  try {
    return typeof chrome !== "undefined" && chrome?.storage?.local
      ? chrome.storage.local
      : null
  } catch {
    return null
  }
}

async function readMemberHints(now: number): Promise<MemberHints> {
  const area = hintStore()
  if (!area) return {}
  try {
    const got = await area.get(MEMBER_HINT_KEY)
    const raw = got?.[MEMBER_HINT_KEY] as unknown
    if (!raw || typeof raw !== "object") return {}
    const out: MemberHints = {}
    for (const [host, at] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof at === "number" && now - at < MEMBER_HINT_TTL_MS) out[host] = at
    }
    return out
  } catch {
    return {}
  }
}

/** True when this install believes it is already inside this host's room. */
async function hasMemberHint(host: string, now = Date.now()): Promise<boolean> {
  const hints = await readMemberHints(now)
  return hints[host] !== undefined
}

async function writeMemberHint(host: string, now = Date.now()): Promise<void> {
  const area = hintStore()
  if (!area) return
  try {
    const hints = await readMemberHints(now)
    hints[host] = now
    const entries = Object.entries(hints)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MEMBER_HINT_MAX_HOSTS)
    await area.set({ [MEMBER_HINT_KEY]: Object.fromEntries(entries) })
  } catch {
    // A hint we could not write is a resume that will not happen. The reader
    // presses the button instead — worse, not broken.
  }
}

/** Called on every PROOF that we are not a member: an explicit leave, a
 *  `not_member` refusal, or a `gate_closed` (the server only reads the
 *  population for a non-member — site-membership.service.ts decideAdmission). */
async function clearMemberHint(host: string): Promise<void> {
  const area = hintStore()
  if (!area) return
  try {
    const hints = await readMemberHints(Date.now())
    if (hints[host] === undefined) return
    delete hints[host]
    await area.set({ [MEMBER_HINT_KEY]: hints })
  } catch {
    // Same as above, mirrored: a hint we could not clear costs one join the
    // server refuses.
  }
}

export const useSiteChatStore = create<SiteChatStore>()((set, get) => {
  /** Every state change funnels through the pure reducer. */
  const dispatch = (event: SiteChatGateEvent) => {
    set((s) => ({ gate: siteChatGateReducer(s.gate, event) }))
    scheduleExpiry()
  }

  /** One timer, re-armed on each count, for the moment that count stops being
   *  true. Not an interval: nothing needs to happen in between. */
  const scheduleExpiry = () => {
    if (staleTimer !== null) clearTimeout(staleTimer)
    staleTimer = null
    const { gate } = get()
    if (gate.count === null) return
    const due = gate.countAt + SITE_PRESENCE_COUNT_STALE_MS - Date.now()
    if (due <= 0) return
    staleTimer = setTimeout(() => {
      staleTimer = null
      set((s) => ({ tick: s.tick + 1 }))
    }, due)
  }

  /** Append or ignore. The id is the identity — the same message arriving
   *  from the ack and from the broadcast is ONE message. The id set is kept
   *  next to the array (module scope) so this costs one lookup per message
   *  instead of a rescan of the whole conversation per frame. */
  const remember = (incoming: SiteChatMessage[], where: "old" | "new") => {
    const fresh: SiteChatMessage[] = []
    for (const m of incoming) {
      if (!m?.id || seenMessageIds.has(m.id)) continue
      seenMessageIds.add(m.id)
      fresh.push(m)
    }
    if (fresh.length === 0) return
    set((s) => {
      const next =
        where === "old" ? [...fresh, ...s.messages] : [...s.messages, ...fresh]
      if (where === "new" && next.length > MAX_LIVE_MESSAGES) {
        // Drop the oldest, and forget their ids with them: an id kept for a
        // message that is no longer on screen would refuse to re-render it if
        // history ever served that page again.
        for (const dropped of next.splice(0, next.length - MAX_LIVE_MESSAGES)) {
          seenMessageIds.delete(dropped.id)
        }
      }
      return { messages: next }
    })
  }

  /** Everywhere `messages` is emptied. The id set has to go with it. */
  const forgetMessages = () => {
    seenMessageIds = new Set()
  }

  /**
   * DROP ONE ROW, IDEMPOTENTLY — the mirror of `remember()`, and it has to be
   * idempotent for the same reason `remember()` does: a delete arrives TWICE,
   * once as the `delete` ack and once in the `message-deleted` broadcast the
   * server sends to the whole room INCLUDING the deleter. Whichever lands
   * first removes the row; the second finds nothing and costs one filter.
   *
   * THE ID STAYS IN `seenMessageIds`, AND THAT IS THE POINT. Removing it would
   * make the id fresh again, so any re-delivery of that message — a frame
   * already in flight, a reconnect that re-serves a page — would re-append the
   * row and resurrect something its author took back. Left in place, the id is
   * a tombstone: seen, and never rendered again for the life of this document.
   * (The trim in `remember()` is the opposite case and deliberately does drop
   * ids: those messages are still real and history may legitimately re-serve
   * them.)
   */
  const forget = (messageId: string) => {
    if (!messageId) return
    set((s) =>
      s.messages.some((m) => m.id === messageId)
        ? { messages: s.messages.filter((m) => m.id !== messageId) }
        : {},
    )
  }

  /**
   * `stop()`'s CALLER — the panel document's own end, which is the lifecycle
   * it was written for and had none of.
   *
   * Everything `stop()` releases dies with the document anyway, so this is not
   * about leaked memory. It is about leaving CLEANLY, and the two halves that
   * are actually observable from outside this browser:
   *   - transport.destroy() sends socket.io's disconnect, so the gateway drops
   *     the connection now instead of at its own ping timeout.
   *   - the heartbeat stops on a beat instead of mid-request, and the ticket
   *     cache goes with the socket it authenticated
   *     (helpers/siteChatApi.ts, `clearSiteChatTicket`).
   *
   * `persisted` IS THE WHOLE GUARD. A pagehide with persisted:true is a
   * document entering the back/forward cache and expecting to come back;
   * tearing down there would strand a live panel on a stopped store. Only a
   * real teardown is acted on.
   *
   * Bound when the transport is CREATED, not at import: a panel session that
   * never opens the chat has nothing to release and registers nothing. Once,
   * because `stop()` nulls the transport and the next `setPage` builds
   * another — a listener per rebuild would be a leak of its own.
   *
   * This is not the only caller `stop()` wants. A sign-out that keeps the
   * document alive needs one too, and components/Header.tsx's `performLogout`
   * has exactly that shape in its popup branch — see `clearSiteChatTicket`'s
   * own note, which names the edit.
   */
  const bindDocumentTeardown = () => {
    if (teardownBound) return
    if (typeof window === "undefined" || !window.addEventListener) return
    teardownBound = true
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) return
      get().stop()
    })
  }

  const ensureTransport = (): SiteChatTransport => {
    if (transport) return transport
    bindDocumentTeardown()
    transport = createSiteChatTransport({
      handlers: {
        onMessage: (host, message) => {
          // A frame for a website the reader has already left is not ours to
          // render; the gate reducer drops those by host and so does this.
          if (host !== get().host) return
          remember([message], "new")
        },
        onMemberJoined: (host, user) => {
          if (host !== get().host) return
          set((s) =>
            s.arrivals.some((u) => u.userId === user.userId)
              ? {}
              : { arrivals: [...s.arrivals, user] },
          )
        },
        onMemberLeft: (host, userId) => {
          if (host !== get().host) return
          set((s) => ({
            arrivals: s.arrivals.filter((u) => u.userId !== userId),
          }))
        },
        onMessageDeleted: (host, messageId) => {
          // Same host guard as every other frame: a deletion for a website the
          // reader has already left is not ours to apply.
          if (host !== get().host) return
          forget(messageId)
        },
        onConnection: (connected) => {
          // A dropped socket is NOT a lost membership (R5): the durable record
          // is per user and survives reconnects, tabs and a closed panel. So
          // this touches `connected` and nothing else.
          set({ connected })
        },
        onAuth: (signedIn) => {
          dispatch({ type: "signed-in", signedIn, at: Date.now() })
        },
        onDisabled: (host) => {
          dispatch({
            type: "join-refused",
            host,
            error: "disabled",
            at: Date.now(),
          })
        },
      },
    })
    return transport
  }

  /**
   * R5 ACROSS A CLOSED PANEL — the one place a join happens without a press.
   *
   * ORDER MATTERS, AND IT IS NOT THE COUNT. This asks storage, then the ticket
   * route, then the server. It never looks at `gate.count`, so the population
   * is still read in exactly one function and that function is server-side
   * (I2). What it acts on is a HINT that this install was admitted here, and
   * the only decision it makes is whether to ASK.
   *
   * The ticket is checked before the socket on purpose: a reader we cannot
   * authenticate must not cost a connection, and a failed mint here is
   * deliberately silent — the transport is the thing allowed to report
   * identity, and it does that when the reader actually presses.
   */
  const resumeMembership = async (h: string) => {
    if (resumeInFlight === h) return
    resumeInFlight = h
    try {
      if (!(await hasMemberHint(h))) return
      if (get().host !== h || get().gate.member || get().entering) return
      const ticket = await getSiteChatTicket()
      if (!ticket.ok) return
      if (get().host !== h || get().gate.member) return
      set({ entering: true })
      try {
        const reply = await ensureTransport().join()
        // The reader can change tabs while a join is in flight; the reducer
        // drops such a reply by host and so does this.
        if (get().host !== h) return
        const at = Date.now()
        if (reply.ok) {
          dispatch({ type: "join-ok", host: h, count: reply.count, at })
          remember(reply.messages ?? [], "new")
          return
        }
        if (reply.error === "unavailable") {
          // A RESUME THAT CANNOT REACH THE SERVER CHANGES NOTHING. This is the
          // transport's catch-all: no backend URL, no host permission, a
          // socket that would not open, an ack that never came. Dispatching it
          // would put the gate in UNAVAILABLE — "try again" — for a reader who
          // never touched anything, and that state is sticky until the host
          // changes. The pill keeps saying what the heartbeat says, and a
          // press still produces a verdict somebody actually asked for.
          return
        }
        dispatch({
          type: "join-refused",
          host: h,
          error: reply.error,
          count: reply.count,
          at,
        })
        // NO NOTICE. Nobody pressed anything, so nobody is owed an error.
        //
        // `gate_closed` is the only refusal that PROVES the hint is stale: the
        // server reads the population solely for a non-member (decideAdmission
        // in apps/backend/src/site-chat/site-membership.service.ts checks
        // membership first). `signed_out` proves nothing about membership —
        // the record is per user and lives 30 days — so the hint survives for
        // the next sign-in. (`unavailable` never reaches this line; it
        // returned above.)
        if (reply.error === "gate_closed") void clearMemberHint(h)
      } finally {
        set({ entering: false })
      }
    } finally {
      resumeInFlight = null
    }
  }

  return {
    gate: initialSiteChatGate(),
    host: null,
    connected: false,
    messages: [],
    arrivals: [],
    nextCursor: null,
    entering: false,
    sending: false,
    loadingHistory: false,
    notice: null,
    tick: 0,

    setPage(urlOrHost) {
      const host =
        urlOrHost === null
          ? null
          : (siteChatHostFromUrl(urlOrHost) ?? canonicalSiteHost(urlOrHost))
      if (host === get().host) return
      // A new website is a new conversation. Carrying messages across would
      // show one site's room under another site's name for a frame.
      forgetMessages()
      set({
        host,
        messages: [],
        arrivals: [],
        nextCursor: null,
        notice: null,
      })
      dispatch({ type: "host", host, at: Date.now() })
      ensureTransport().watch(host)

      // One heartbeat, one host. A host change is a different room and
      // deserves an immediate beat rather than the tail of the old interval,
      // which is exactly what stopping and restarting does.
      stopHeartbeat?.()
      stopHeartbeat = null
      if (!host) return
      stopHeartbeat = startSitePresenceHeartbeat(host, (result, beatHost) => {
        if (beatHost !== get().host) return
        if (!result.available) {
          // 404 is the kill switch and the allowlist speaking with one voice:
          // there is no chat here. The gate renders it as UNAVAILABLE, which
          // is the product exactly as it behaves today.
          dispatch({
            type: "join-refused",
            host: beatHost,
            error: "disabled",
            at: Date.now(),
          })
          return
        }
        // A null count is NOT dispatched. UNKNOWN is the absence of a number,
        // and an event carrying null is an invitation to render 0.
        if (typeof result.count === "number") {
          dispatch({
            type: "presence",
            host: beatHost,
            count: result.count,
            at: Date.now(),
          })
        }
      })

      // R5, the half a dropped socket never covered: if this install was
      // already admitted here, walk back in rather than waiting for a press
      // this reader has no reason to make. Deliberately AFTER the heartbeat
      // starts and completely independent of it — a resume asks the server,
      // never the count.
      void resumeMembership(host)
    },

    async enter() {
      const host = get().host
      if (!host || get().entering) return
      set({ entering: true, notice: null })
      try {
        const reply = await ensureTransport().join()
        const at = Date.now()
        if (reply.ok) {
          dispatch({ type: "join-ok", host, count: reply.count, at })
          // Remember WHERE we were admitted, so closing the panel is not a
          // silent eviction. It is a cached server fact with a 30-day life,
          // matching the record it describes.
          void writeMemberHint(host)
          // The join acknowledgement carries the newest page but no cursor, so
          // `loadMore()` asks for that page again to learn one and de-dupes
          // the overlap. One extra read, once, on the reader's first scroll
          // back — cheaper than a second cursor shape on the wire.
          remember(reply.messages ?? [], "new")
          return
        }
        dispatch({
          type: "join-refused",
          host,
          error: reply.error,
          count: reply.count,
          at,
        })
        // The server read the population, which it only does for a
        // non-member: whatever this install remembered is wrong.
        if (reply.error === "gate_closed") void clearMemberHint(host)
        set({ notice: { verb: "join", error: reply.error } })
      } finally {
        set({ entering: false })
      }
    },

    async send(content) {
      const host = get().host
      const text = content.trim()
      if (!host || !text || get().sending) return
      set({ sending: true, notice: null })
      try {
        const reply = await ensureTransport().post(text)
        if (reply.ok) {
          remember([reply.message], "new")
          return
        }
        if (reply.error === "not_member") {
          dispatch({ type: "not-a-member", host, at: Date.now() })
          void clearMemberHint(host)
        }
        set({
          notice: {
            verb: "post",
            error: reply.error,
            retryAfterSeconds: reply.retryAfterSeconds,
          },
        })
      } finally {
        set({ sending: false })
      }
    },

    /**
     * DELETE IS THE SERVER'S TO REFUSE, AND THE ROW PROVES IT.
     *
     * No optimistic removal. The screen only ever offers this control on the
     * reader's own message, so a refusal should be rare — but "should be rare"
     * is exactly where an optimistic UI lies: a `not_author` (a stale meId, a
     * row rendered under the wrong identity) would blank a message the server
     * still has, and every OTHER panel in the room would keep showing it.
     * `forget()` runs on the ack and on the broadcast, both of which are the
     * server confirming, and neither of which is a guess.
     */
    async deleteMessage(messageId) {
      const host = get().host
      if (!host || !messageId) return
      set({ notice: null })
      const reply = await ensureTransport().deleteMessage(messageId)
      if (reply.ok) {
        // The broadcast says the same thing to every panel including this one;
        // `forget()` is idempotent, so acting on whichever arrives first only
        // means the row goes now rather than a round trip later.
        forget(reply.messageId)
        return
      }
      if (reply.error === "not_member") {
        dispatch({ type: "not-a-member", host, at: Date.now() })
        void clearMemberHint(host)
      }
      set({
        notice: {
          verb: "delete",
          error: reply.error,
          retryAfterSeconds: reply.retryAfterSeconds,
        },
      })
    },

    /**
     * REPORT ANSWERS THE CALLER, NOT THE ROOM.
     *
     * The reply goes back rather than into `notice` because the screen has to
     * say something in BOTH directions — after pressing "Report", silence and
     * a failed send look identical — and the strip above the composer is the
     * wrong surface for an answer about one row in a menu.
     *
     * It STILL dispatches `not_member`, because that is a fact about the
     * reader's seat and the whole screen depends on it, not a fact about this
     * report.
     */
    async report(messageId, reason) {
      const host = get().host
      if (!host || !messageId) return { ok: false, error: "unavailable" }
      const reply = await ensureTransport().report(messageId, reason)
      if (!reply.ok && reply.error === "not_member") {
        dispatch({ type: "not-a-member", host, at: Date.now() })
        void clearMemberHint(host)
      }
      return reply
    },

    async loadMore() {
      const host = get().host
      if (!host || get().loadingHistory) return
      set({ loadingHistory: true })
      try {
        const cursor = get().nextCursor ?? undefined
        const reply = await ensureTransport().history(cursor)
        if (reply.ok) {
          remember(reply.messages ?? [], "old")
          set({ nextCursor: reply.nextCursor })
          return
        }
        if (reply.error === "not_member") {
          dispatch({ type: "not-a-member", host, at: Date.now() })
          void clearMemberHint(host)
        }
        set({ notice: { verb: "history", error: reply.error } })
      } finally {
        set({ loadingHistory: false })
      }
    },

    async exit() {
      const host = get().host
      if (!host) return
      const reply = await ensureTransport().leave()
      if (reply.ok) {
        // PRESENCE IS UNTOUCHED (I1). The reader is still on the page and
        // still counts for everyone else — the reducer's `left` deliberately
        // does not change the count. What changes is that they must face the
        // gate again.
        dispatch({ type: "left", host, at: Date.now() })
        // The hint outlives the document, so leaving has to erase it here or
        // the next panel would let them back in without a press.
        void clearMemberHint(host)
        forgetMessages()
        set({ messages: [], arrivals: [], nextCursor: null })
        return
      }
      set({ notice: { verb: "leave", error: reply.error } })
    },

    /**
     * STOP MEANS POINTED AT NOTHING, not merely disconnected.
     *
     * Called on the panel document's teardown (`bindDocumentTeardown`) and by
     * any sign-out that keeps the document alive. Both mean "this session is
     * over", so the store is returned to the state a fresh document starts in
     * and the next `setPage` rebuilds every piece.
     *
     * WHY `host` IS CLEARED, which is not cosmetic: `setPage` returns early
     * when the host has not changed. A stopped store that still remembered
     * where it was would refuse to restart on the very host it was stopped on
     * — the transport gone, the heartbeat gone, and `setPage` declining to
     * build either. Nulling it here is what makes stopping reversible.
     *
     * WHY THE TRANSCRIPT GOES WITH IT: `forgetMessages()` empties the id set
     * that `remember()` de-duplicates against. Leaving the array behind would
     * let the same message be appended a second time on the next session and
     * put two rows under one React key.
     *
     * THE CREDENTIAL DIES WITH THE SOCKET IT AUTHENTICATED. A ticket names a
     * users.id, and a cached one outliving the transport is a credential with
     * no owner (helpers/siteChatApi.ts, `clearSiteChatTicket`).
     */
    stop() {
      if (staleTimer !== null) clearTimeout(staleTimer)
      staleTimer = null
      stopHeartbeat?.()
      stopHeartbeat = null
      transport?.destroy()
      transport = null
      resumeInFlight = null
      forgetMessages()
      clearSiteChatTicket()
      set({
        host: null,
        connected: false,
        messages: [],
        arrivals: [],
        nextCursor: null,
        notice: null,
        entering: false,
        sending: false,
        loadingHistory: false,
      })
      // The gate is a reducer, so "we are looking at nothing" is an event, not
      // a field assignment. `signedIn` survives it on purpose — that is a fact
      // about the reader, not about the page (siteChatGate.ts, case "host").
      dispatch({ type: "host", host: null, at: Date.now() })
    },

    dismissNotice() {
      set({ notice: null })
    },

    view(now) {
      return siteChatGateView(get().gate, now ?? Date.now())
    },
  }
})
