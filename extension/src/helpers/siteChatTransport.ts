import { io, Socket } from "socket.io-client"
import { checkPermissions } from "./permissionHelper"
import {
  getSiteChatTicket,
  siteChatTicketIsFresh,
  type SiteChatTicketFailure,
} from "./siteChatApi"
import { canonicalSiteHost } from "./siteChatHost"

/**
 * THE SITE-CHAT SOCKET — namespace /site-chat, OWNED BY THE SIDE PANEL.
 *
 * ── WHY THE PANEL AND NOT THE BACKGROUND, WHERE THE OTHER SOCKET LIVES ──────
 * entries/background/main.ts keeps the /ticks socket (`ensureTicksSocket`, in
 * the PRICE TICKS SOCKET block), and two things there are copied below: the
 * re-emit on `connect`, and the refusal to keep state the server will not
 * restore. Chat does not belong there: an MV3 service worker is evicted after
 * roughly 30s idle and the socket goes with it. For prices that costs a few
 * seconds of staleness and the next tick repairs it. For a conversation it
 * costs MESSAGES — frames pushed to a socket
 * that no longer exists, with no error anywhere and no way to know what was
 * missed. The side panel is a real document, and when it closes the reader is
 * not in the conversation anyway.
 *
 * ══ THIS SOCKET DOES NOT WRITE PRESENCE, AND THAT IS THE POINT ═════════════
 * The protocol has a `hello` verb that registers the caller in the presence
 * pool and doubles as a heartbeat. THIS CLIENT NEVER SENDS IT, and never sends
 * an `anonId` in the handshake either, so it structurally cannot.
 *
 * The reason is the pool's member id. The gateway counts an authenticated
 * socket as "u:<userId>" (site-chat.gateway.ts, `handleHello`, which builds
 * its member with `presenceMember`), while every heartbeat this extension
 * sends over HTTP is anonymous — one shared per-install id from `siteAnonId`
 * in helpers/presence.ts, written by the panel's header, the page's content
 * script and a chrome.alarms backstop. A socket that also said hello would add
 * a SECOND member for the same reader, and two members is exactly what the
 * gate is asking about: "more than 1 person live" would become true for
 * somebody sitting alone. Presence is therefore written in exactly one place
 * and this is not it (I1: no presence path here, and no membership path
 * there).
 *
 * What that buys, besides correctness: the pill and the gate need no socket at
 * all. A reader who never opens a chat never opens a connection — this one is
 * created lazily, by the first verb, and `watch()` only remembers where we
 * are.
 *
 * ══ EVERY EVENT THE SERVER CAN PUSH, AND WHAT THIS CLIENT DOES WITH EACH ════
 * Read off the gateway's EMIT SITES, not off the DTO file: the DTO declares
 * shapes, but the emit decides who is actually addressed. Search `.emit(` in
 * apps/backend/src/site-chat/site-chat.gateway.ts and this is the whole list.
 *
 *   message          handlePost → `server.to('chat:<host>')`, the whole room
 *                    INCLUDING the author. WIRED.
 *   member-joined    handleJoin → `client.broadcast.to('chat:<host>')`, and
 *                    only for a NEW admission (`decision.reason ===
 *                    'gate_open'`), so a member's reconnect is silent. WIRED.
 *   member-left      handleLeave → `client.broadcast.to('chat:<host>')`. Only
 *                    an explicit `leave` produces one; handleDisconnect
 *                    deliberately emits nothing, because a dropped socket is
 *                    not a lost seat (R5). WIRED.
 *   message-deleted  handleDelete → the same chat room, author-only at the
 *                    server. WIRED — see `onMessageDeleted`.
 *   presence         handleHello ONLY → a direct emit to the caller plus a
 *                    broadcast to `presence:<host>`. NOT WIRED, deliberately,
 *                    and the next paragraph is why.
 *
 * Plus socket.io's own connect / disconnect / connect_error, which are wired
 * in wire() and are the only source `onConnection` has.
 *
 * ── THE ONE EVENT THIS CLIENT DELIBERATELY IGNORES, AND WHY A LISTENER WOULD
 *    NOT HELP ───────────────────────────────────────────────────────────────
 * `presence` is not unwanted. It is the push that would open the gate the
 * instant a second reader arrives instead of up to one heartbeat later. It is
 * UNREACHABLE, and registering a handler would not change that by one frame:
 *
 *   A socket receives `presence` only as a member of the room
 *   `presence:<host>`, and the ONLY `client.join(PRESENCE_ROOM_PREFIX + host)`
 *   in the gateway is inside handleHello. This client never sends `hello`, so
 *   it is never in that room: the frames are not being dropped here, none are
 *   addressed to us. A listener would be a subscription to an event nobody
 *   emits — worse than none, because the next reader would believe the count
 *   is pushed and stop looking for the poll that actually feeds it.
 *
 *   And `hello` cannot simply be added, for the reason at the top of this
 *   file: the pool de-duplicates by MEMBER ID, and `presenceMember`
 *   (apps/backend/src/site-chat/site-presence.service.ts) prefers a ticketed
 *   userId over the anonId. Every heartbeat this extension sends is anonymous,
 *   so one reader would be `u:<userId>` from the socket AND `a:<anonId>` from
 *   the beat — two of the two members the gate is counting.
 *
 * WHAT WOULD UNBLOCK IT, precisely, so this is a plan and not a lament: every
 * presence writer for one install has to agree on ONE member id. Three write
 * anonymously today — the panel's header, the content script and a
 * chrome.alarms backstop, all through `pingSitePresence` in helpers/presence.ts
 * — and a hello-ing socket would be the only one naming a user. Make them
 * agree, in ONE edit, in one of two directions:
 *   ALL ANONYMOUS   the handshake carries `siteAnonId()` and no ticket, so the
 *                   socket's member id is byte-identical to the beat's and the
 *                   server's ZADD is idempotent. Costs a second, unauthorised
 *                   socket, since this one must keep its ticket for `post`.
 *   ALL TICKETED    the HTTP beat carries the ticket instead. The server is
 *                   already willing (`tryGetUserId` in site-chat.controller.ts
 *                   verifies a ticket off the Authorization header); the
 *                   client is not, because lib/axios.ts overwrites
 *                   Authorization outside PUBLIC_ROUTES — and it would still
 *                   need the content script and the alarm to follow.
 * Either way `hello` and the `presence` listener land TOGETHER. One without
 * the other is either a dead subscription or a double-counted reader.
 *
 * THE COST UNTIL THEN, stated plainly: the population is a 15-second HTTP poll
 * (helpers/presence.ts, `startSitePresenceHeartbeat`), not a push, so the gate
 * can open up to ~15s after the second reader arrives. R6 — "genuinely real
 * time" — is met for MESSAGES and for DELETIONS, which are pushed, and polled
 * for the POPULATION. A gate that opens a few seconds late is correct-but-slow;
 * a socket that double-counts its own reader is fast and WRONG.
 *
 * ── EVERY VERB IS AN ACKNOWLEDGEMENT, NOT AN EVENT ──────────────────────────
 * Nest returns a handler's value through the frame's ack callback and DROPS it
 * entirely when the client passed none (`bindMessageHandlers` in
 * node_modules/@nestjs/platform-socket.io/adapters/io-adapter.js: it emits a
 * named event only when the returned object has an `event` key, and otherwise
 * calls `ack(response)` — which does nothing when there is no ack). A
 * `join` emitted without a callback therefore succeeds in silence and the
 * client never learns it is in. Everything here goes through `ask()`, which
 * always passes one and always resolves — a timeout becomes a refusal, so no
 * caller holds a catch for a socket that simply did not answer.
 *
 * ── A RECONNECT RESTORES NOTHING ────────────────────────────────────────────
 * socket.io re-establishes the connection and re-joins NO rooms. The /ticks
 * socket compensates the same way and says so (background/main.ts,
 * `ensureTicksSocket`'s own "connect" handler re-emits every watch).
 * Here, `connect` re-sends `join` when we were admitted. Membership itself is
 * durable server-side — per user, 30 days, checked BEFORE the population — so
 * a re-join walks straight back in without facing the count. That is R5
 * surviving a dropped connection.
 *
 * ── A FAILURE IS ONLY REPORTED AS THE KIND OF FAILURE IT IS ─────────────────
 * Three different facts reach the screen through three different callbacks and
 * they are never traded for one another:
 *   onConnection  the socket is up or down. Raised ONLY by socket.io's own
 *                 connect / disconnect / connect_error events.
 *   onAuth        the server spoke about our IDENTITY. Raised only when the
 *                 mint route answered 401 (no session) or 403 (suspended) —
 *                 i.e. when a server actually judged the reader.
 *   onDisabled    there is no chat here (O3, or no account behind this
 *                 identity): the mint route answered 404, or a verb answered
 *                 `disabled`.
 * A NETWORK FAILURE IS NONE OF THE THREE and is reported as nothing at all.
 * That distinction is load-bearing: onAuth(false) clears `member` in the gate
 * reducer, so calling it because a wifi hop ate one mint would eject a reader
 * from a room the server still has them in — the eviction R5 forbids, arriving
 * as a sign-in prompt for somebody who is signed in. `reportMintFailure()`
 * below is the single place that mapping lives.
 *
 * ── INERT BY DEFAULT ────────────────────────────────────────────────────────
 * No backend URL, no host permission, no host, or a server answering
 * `disabled` (O3: the kill switch is off, or this host is not on the
 * allowlist) and no socket is opened at all. Three hosts answering `disabled`
 * is taken as "the feature is off" and stops the probing for a while — off is
 * this feature's DEFAULT state and must not cost a connection per website.
 */

/* ══════════════════════════ THE WIRE PROTOCOL ═══════════════════════════════
 *
 * MIRRORED from apps/backend/src/site-chat/dto/site-chat-events.dto.ts (the
 * shared shapes and the reply unions) and from site-chat.gateway.ts's own
 * `SiteChatReauthReply`, which is declared there rather than in that file. It
 * is a copy because the extension
 * has its own tsconfig and its own lockfile and cannot import from the API
 * package; when the DTO changes, change this in the same edit.
 *
 * I3 — NO CLIENT→SERVER SHAPE CARRIES A userId, and none ever may. Identity is
 * the ticket the server verified at the handshake and nothing else. The
 * deleted chat gateway did `payload.userId || socketToUser.get(client.id)` and
 * let anyone address a message as anyone. Server→client payloads DO carry ids
 * (member-left names who left) — those are server-authored facts, not client
 * claims.
 */

/** One rendered message. `content` is TEXT — v1 has no gif and no reply-to;
 *  those columns exist in chat_messages and stay NULL. */
export interface SiteChatMessage {
  id: string
  userId: string
  /** Raw username — may be null; displayName is the safe label. */
  username: string | null
  /** Always a human label, never a raw email. */
  displayName: string
  photoUrl: string | null
  content: string
  /** ISO 8601. */
  createdAt: string
}

/** The author card carried by member-joined. */
export interface SiteChatUser {
  userId: string
  username: string | null
  displayName: string
  photoUrl: string | null
}

export type SiteChatJoinError =
  | "signed_out"
  | "gate_closed"
  | "unavailable"
  | "bad_host"
  | "disabled"

export type SiteChatPostError =
  | "not_member"
  | "rate_limited"
  | "too_long"
  | "empty"
  | "signed_out"
  | "bad_host"
  | "disabled"
  | "suspended"
  | "not_found"
  | "unavailable"

export type SiteChatHistoryError =
  | "not_member"
  | "signed_out"
  | "bad_host"
  | "disabled"
  | "bad_cursor"
  | "unavailable"

/**
 * `not_author` and `not_found` are DIFFERENT ANSWERS ON PURPOSE. The server's
 * own note says the difference leaks exactly one bit — "a live message with
 * that id exists in this room" — and that every caller of `delete` is an
 * admitted member who can already read the whole room. The UI still must not
 * SAY them the same way: "that isn't yours" and "it's already gone" send the
 * reader to two different next moves.
 */
export type SiteChatDeleteError =
  | "not_member"
  | "not_author"
  | "not_found"
  | "signed_out"
  | "bad_host"
  | "disabled"
  | "rate_limited"
  | "unavailable"

/** `own_message` is the refusal for reporting yourself: a report is a note to
 *  a human about somebody ELSE, and `delete` is the verb for your own words. */
export type SiteChatReportError =
  | "not_member"
  | "not_found"
  | "own_message"
  | "signed_out"
  | "bad_host"
  | "disabled"
  | "rate_limited"
  | "unavailable"

export type SiteChatJoinReply =
  | { ok: true; count: number; messages: SiteChatMessage[] }
  | { ok: false; error: SiteChatJoinError; count?: number }

export type SiteChatPostReply =
  | { ok: true; message: SiteChatMessage }
  | { ok: false; error: SiteChatPostError; retryAfterSeconds?: number }

export type SiteChatHistoryReply =
  | { ok: true; messages: SiteChatMessage[]; nextCursor: string | null }
  | { ok: false; error: SiteChatHistoryError }

export type SiteChatLeaveReply =
  | { ok: true }
  | { ok: false; error: "signed_out" | "bad_host" | "disabled" | "unavailable" }

/** reauth's acknowledgement. `signed_out` covers every reason a ticket did not
 *  install: malformed, expired, wrong scope, or a DIFFERENT user. */
export type SiteChatReauthReply =
  | { ok: true; expiresAt: number }
  | { ok: false; error: "disabled" | "signed_out" }

/** The ack echoes the id, so a client that fired several deletes can match the
 *  answer to the row without keeping a correlation table of its own. */
export type SiteChatDeleteReply =
  | { ok: true; messageId: string }
  | { ok: false; error: SiteChatDeleteError; retryAfterSeconds?: number }

/**
 * `ok: true` MEANS "A HUMAN WILL SEE THIS", AND NOTHING MORE — the server's
 * own words on the reply type. It does not mean the message was hidden, the
 * author was actioned, or that anybody is on call. Whatever the screen says
 * when this resolves has to stay inside that claim.
 */
export type SiteChatReportReply =
  | { ok: true }
  | { ok: false; error: SiteChatReportError; retryAfterSeconds?: number }

/**
 * MIRRORS `SITE_CHAT_MAX_REPORT_REASON_CHARS` in
 * apps/backend/src/site-chat/site-chat.config.ts. The schema REFUSES a longer
 * reason rather than truncating it (dto/site-chat-events.dto.ts,
 * `SiteChatReportSchema`), so a frame over this length is a wasted round trip
 * and a refusal the reader did nothing to earn. Clipped here instead.
 */
export const SITE_CHAT_MAX_REPORT_REASON_CHARS = 300

/** How long we wait for an acknowledgement before calling it a refusal. */
const ACK_TIMEOUT_MS = 10_000

/** How long we wait for the connection itself. */
const CONNECT_TIMEOUT_MS = 12_000

/** The gateway caps a socket at MAX_CHAT_ROOMS = 8 and only an explicit
 *  `leave` — which DELETES membership — ever frees one (site-chat.gateway.ts:
 *  the `MAX_CHAT_ROOMS` constant, enforced by the `countRooms` guard in
 *  `handleJoin`). Switching websites must not leave a
 *  chat, so rooms accumulate; recycle the connection before the cap instead. A
 *  fresh socket is a fresh room set, and membership is durable, so re-joining
 *  costs nothing. */
const MAX_CHAT_ROOMS_PER_SOCKET = 6

/** Distinct hosts answering `disabled` before we conclude the feature is off
 *  rather than merely absent from one allowlist. */
const DARK_AFTER_DISABLED_HOSTS = 3

/** How long we stay dark once we conclude that. */
const DARK_COOLDOWN_MS = 15 * 60_000

/** What the transport pushes at whoever owns the screen. Every callback names
 *  its host: a frame can arrive after the reader has moved on, and the store
 *  drops it rather than rendering somebody else's room. */
export interface SiteChatTransportHandlers {
  onMessage(host: string, message: SiteChatMessage): void
  onMemberJoined(host: string, user: SiteChatUser): void
  onMemberLeft(host: string, userId: string): void
  /**
   * A message was taken back by its author, and every panel in the room is
   * told — the deleter included, exactly like `message`, so one ordered source
   * removes the row everywhere instead of each client guessing.
   *
   * It carries the ID AND NOTHING ELSE. The server deliberately does not
   * re-send the content in the event announcing its removal.
   */
  onMessageDeleted(host: string, messageId: string): void
  /** Socket up or down. Informational — NOT a membership change, and it must
   *  never be rendered as one (R5). */
  onConnection(connected: boolean): void
  /** We do, or do not, hold an identity the server accepts. */
  onAuth(signedIn: boolean): void
  /** The server answered `disabled` for this host. */
  onDisabled(host: string): void
}

export interface SiteChatTransport {
  /** Point the transport at a host (canonical or raw — it canonicalises
   *  again) or at nothing. Safe on every tab change; the same host twice is a
   *  no-op. Opens no connection by itself. */
  watch(host: string | null): void
  join(): Promise<SiteChatJoinReply>
  post(content: string): Promise<SiteChatPostReply>
  history(cursor?: string): Promise<SiteChatHistoryReply>
  /** Take back your own message. AUTHOR-ONLY AT THE SERVER — the frame names
   *  the message and never the author, so this cannot be aimed at somebody
   *  else's row however the caller is written (I3). */
  deleteMessage(messageId: string): Promise<SiteChatDeleteReply>
  /** Send somebody else's message to a human. `reason` is optional and
   *  clipped to SITE_CHAT_MAX_REPORT_REASON_CHARS, because the server's schema
   *  refuses a longer one rather than trimming it. */
  report(messageId: string, reason?: string): Promise<SiteChatReportReply>
  leave(): Promise<SiteChatLeaveReply>
  /** For the panel's unmount. Idempotent. */
  destroy(): void
  isConnected(): boolean
}

interface TransportOptions {
  handlers: SiteChatTransportHandlers
  /** Overridable for tests; defaults to process.env.NEXT_PUBLIC_BACKEND_URL. */
  backendUrl?: string | undefined
  /** Overridable for tests; defaults to the extension's host permission check. */
  hasPermission?: () => Promise<boolean>
  now?: () => number
}

export function createSiteChatTransport(
  options: TransportOptions,
): SiteChatTransport {
  const handlers = options.handlers
  const backendUrl =
    options.backendUrl ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? ""
  const hasPermission = options.hasPermission ?? defaultHasPermission
  const now = options.now ?? (() => Date.now())

  let socket: Socket | null = null
  let host: string | null = null
  /** We were admitted and have not left. Drives the re-join on reconnect. */
  let joined = false
  /** Hosts THIS SOCKET has been admitted to — the room-cap counter. */
  let joinedHosts = new Set<string>()
  const disabledHosts = new Set<string>()
  let darkUntil = 0
  let destroyed = false
  /** Shared by every caller that arrives while a connection is opening. */
  let opening: Promise<Socket | null> | null = null

  // ─────────────────────────── connection ──────────────────────────────────

  /**
   * The socket, connected, or null when this feature is not available here.
   * Lazy on purpose: browsing costs no connection, because presence is not
   * this socket's job.
   */
  function ensureConnected(): Promise<Socket | null> {
    if (destroyed) return Promise.resolve(null)
    if (socket?.connected) return Promise.resolve(socket)
    if (opening) return opening
    if (!backendUrl || !host) return Promise.resolve(null)
    if (now() < darkUntil || disabledHosts.has(host)) return Promise.resolve(null)

    opening = open().finally(() => {
      opening = null
    })
    return opening
  }

  async function open(): Promise<Socket | null> {
    if (!(await hasPermission())) return null
    // The host can change while the ticket is being minted.
    if (destroyed || !host) return null
    if (socket?.connected) return socket

    const auth = await handshakeAuth()
    if (destroyed || !host) return null

    // Reuse an existing-but-disconnected socket rather than stacking clients:
    // socket.io is already retrying it, and a second io() would leave the
    // first one reconnecting forever in the background.
    if (socket) {
      ;(socket.auth as Record<string, string>).token = auth.token ?? ""
      if (!socket.connected) socket.connect()
      return waitForConnect(socket)
    }

    const s = io(`${backendUrl}/site-chat`, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth,
    })
    socket = s
    wire(s)
    return waitForConnect(s)
  }

  function waitForConnect(s: Socket): Promise<Socket | null> {
    if (s.connected) return Promise.resolve(s)
    return new Promise<Socket | null>((resolve) => {
      let settled = false
      const finish = (value: Socket | null) => {
        if (settled) return
        settled = true
        s.off("connect", onOk)
        s.off("connect_error", onFail)
        clearTimeout(timer)
        resolve(value)
      }
      const onOk = () => finish(s)
      const onFail = () => finish(null)
      const timer = setTimeout(() => finish(null), CONNECT_TIMEOUT_MS)
      s.on("connect", onOk)
      s.on("connect_error", onFail)
    })
  }

  /**
   * THE HANDSHAKE CARRIES A TICKET AND NOTHING ELSE.
   *
   * No `anonId`: that field exists only to de-duplicate a presence member for
   * `hello`, and this client never sends `hello`. Leaving it out is what makes
   * "this socket cannot write presence" a property of the code rather than a
   * promise in a comment.
   *
   * A connection with no ticket is still allowed — the server treats it as
   * signed out rather than refusing it — so a reader whose mint failed gets a
   * refusal on `join` they can act on, instead of a socket that will not open.
   */
  async function handshakeAuth(): Promise<Record<string, string>> {
    const ticket = await getSiteChatTicket()
    if (!ticket.ok) {
      reportMintFailure(ticket.reason)
      return {}
    }
    handlers.onAuth(true)
    return { token: ticket.value.ticket }
  }

  /**
   * THE ONLY PLACE A FAILED MINT BECOMES A FACT ON SCREEN.
   *
   * siteChatApi.ts distinguishes four reasons and they are NOT the same fact:
   *
   *   signed_out (401)  the server looked and found no session.
   *   suspended  (403)  the server looked and refused this person
   *                     (users.is_suspended — the one moderation lever).
   *     → both are the server judging our IDENTITY, so onAuth(false) is true.
   *
   *   no_chat    (404)  the kill switch is off, this host is off the
   *                     allowlist, or there is no Poppin account behind the
   *                     identity. The server deliberately makes these
   *                     indistinguishable (siteChatApi.ts, the `no_chat` arm
   *                     of `SiteChatTicketFailure`), and they share one
   *                     rendering: no door here, pill exactly as it ships
   *                     today (O3).
   *
   *   error             network, 5xx, a laptop waking up mid-request. THE
   *                     SERVER SAID NOTHING. Reporting it as identity would
   *                     tell a signed-in member they are signed out and clear
   *                     `member` (siteChatGate.ts, the reducer's
   *                     `case "signed-in"`) — the file's header
   *                     explains why that is the eviction R5 forbids. So it is
   *                     reported as nothing: the verb that triggered this still
   *                     runs, the server's own answer (or the socket's connect
   *                     events) carries whatever went wrong, and the next mint
   *                     retries. Silence is the honest report for "we could not
   *                     ask".
   */
  function reportMintFailure(reason: SiteChatTicketFailure): void {
    if (reason === "signed_out" || reason === "suspended") {
      handlers.onAuth(false)
      return
    }
    if (reason === "no_chat" && host) {
      handlers.onDisabled(host)
    }
  }

  function wire(s: Socket): void {
    s.on("connect", () => {
      handlers.onConnection(true)
      // Rooms do not survive a reconnect; re-say what this socket was.
      joinedHosts = new Set()
      if (joined) void join()
    })
    s.on("disconnect", () => handlers.onConnection(false))
    s.on("connect_error", () => handlers.onConnection(false))

    s.on("message", (e: { host?: string; message?: SiteChatMessage }) => {
      if (typeof e?.host === "string" && e?.message?.id) {
        handlers.onMessage(e.host, e.message)
      }
    })
    s.on("member-joined", (e: { host?: string; user?: SiteChatUser }) => {
      if (typeof e?.host === "string" && e?.user?.userId) {
        handlers.onMemberJoined(e.host, e.user)
      }
    })
    s.on("member-left", (e: { host?: string; userId?: string }) => {
      if (typeof e?.host === "string" && typeof e?.userId === "string") {
        handlers.onMemberLeft(e.host, e.userId)
      }
    })
    s.on("message-deleted", (e: { host?: string; messageId?: string }) => {
      if (typeof e?.host === "string" && typeof e?.messageId === "string") {
        handlers.onMessageDeleted(e.host, e.messageId)
      }
    })
  }

  function teardown(): void {
    const s = socket
    socket = null
    joinedHosts = new Set()
    if (s) {
      s.removeAllListeners()
      s.disconnect()
    }
    handlers.onConnection(false)
  }

  // ───────────────────────────── the verbs ─────────────────────────────────

  /**
   * Emit with an acknowledgement and a deadline. Resolves null when nothing
   * answered in time — never rejects, so no caller needs a try/catch around a
   * conversation.
   */
  function ask<T>(
    s: Socket,
    verb: string,
    payload: Record<string, unknown>,
  ): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      let settled = false
      const done = (value: T | null) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      try {
        s.timeout(ACK_TIMEOUT_MS).emit(verb, payload, (err: unknown, reply: T) => {
          done(err ? null : reply)
        })
      } catch {
        done(null)
      }
    })
  }

  /**
   * A connected socket whose credential is still good, or null.
   *
   * The ticket lives five minutes and the socket outlives it, so it is
   * refreshed IN PLACE with `reauth` rather than by dropping a live
   * conversation. This is checked before each verb instead of on a timer:
   * only a verb cares, and a timer here would be a second clock to keep
   * correct for no gain.
   */
  async function ready(): Promise<Socket | null> {
    const s = await ensureConnected()
    if (!s) return null
    if (siteChatTicketIsFresh(now())) return s

    const minted = await getSiteChatTicket()
    if (!minted.ok) {
      // The socket stays; only the CREDENTIAL is stale. Whether that is worth
      // saying out loud depends entirely on why the mint failed, which is
      // reportMintFailure's whole job — a 401 is news, a dropped request is
      // not. Either way the verb below still goes out on the old ticket: it
      // may still be inside its 5-minute life (we re-mint 60s early), and if
      // it is not, the SERVER answers `signed_out` and the screen acts on an
      // answer somebody actually gave.
      reportMintFailure(minted.reason)
      return s
    }
    ;(s.auth as Record<string, string>).token = minted.value.ticket
    const reply = await ask<SiteChatReauthReply>(s, "reauth", {
      ticket: minted.value.ticket,
    })
    if (reply?.ok) {
      handlers.onAuth(true)
      return s
    }
    // `reauth` REFUSES a ticket for a different userId, because this socket may
    // already hold rooms it was admitted to as the first identity
    // (site-chat.gateway.ts, `handleReauth`: it answers `signed_out` when
    // `data.userId` is set and differs). The answer is a new socket, not a
    // retry.
    handlers.onAuth(false)
    teardown()
    return ensureConnected()
  }

  async function join(): Promise<SiteChatJoinReply> {
    const h = host
    if (!h) return { ok: false, error: "unavailable" }

    // Recycle before the gateway's room cap rather than after it.
    if (
      socket &&
      !joinedHosts.has(h) &&
      joinedHosts.size >= MAX_CHAT_ROOMS_PER_SOCKET
    ) {
      teardown()
    }

    const s = await ready()
    if (!s) return { ok: false, error: "unavailable" }
    const reply = await ask<SiteChatJoinReply>(s, "join", { host: h })
    if (!reply) return { ok: false, error: "unavailable" }
    if (reply.ok) {
      joined = true
      joinedHosts.add(h)
      disabledHosts.delete(h)
    } else if (reply.error === "disabled") {
      noteDisabled(h)
    }
    return reply
  }

  async function post(content: string): Promise<SiteChatPostReply> {
    const h = host
    if (!h) return { ok: false, error: "unavailable" }
    const s = await ready()
    if (!s) return { ok: false, error: "unavailable" }
    // I3: this frame carries the host and the words. There is no userId field
    // and there must never be one — identity is the ticket the server verified
    // at the handshake.
    const reply = await ask<SiteChatPostReply>(s, "post", { host: h, content })
    if (!reply) return { ok: false, error: "unavailable" }
    if (!reply.ok && reply.error === "not_member") joined = false
    if (!reply.ok && reply.error === "disabled") noteDisabled(h)
    return reply
  }

  async function history(cursor?: string): Promise<SiteChatHistoryReply> {
    const h = host
    if (!h) return { ok: false, error: "unavailable" }
    const s = await ready()
    if (!s) return { ok: false, error: "unavailable" }
    const reply = await ask<SiteChatHistoryReply>(s, "history", {
      host: h,
      ...(cursor ? { cursor } : {}),
    })
    if (!reply) return { ok: false, error: "unavailable" }
    if (!reply.ok && reply.error === "not_member") joined = false
    return reply
  }

  /**
   * TAKE BACK YOUR OWN WORDS.
   *
   * I3 AGAIN, and it is the reason this signature takes an id and not a
   * message: the frame is `{ host, messageId }` and carries no author, so the
   * SERVER decides whose row this is from the handshake's verified ticket.
   * There is no field here to lie in, and a caller that wanted to delete
   * somebody else's line would have nowhere to put the claim.
   *
   * THE TRANSPORT REMOVES NOTHING. It hands the answer back and the store
   * drops the row — from the ack AND from the `message-deleted` broadcast,
   * which the server sends to the whole room INCLUDING the deleter. That is
   * the same double delivery `post` already has (the ack plus the `message`
   * broadcast), answered the same way: both paths go through one idempotent
   * function, so whichever arrives first is the one that acts and the second
   * is free. Neither is optimistic — both are the server confirming.
   */
  async function deleteMessage(messageId: string): Promise<SiteChatDeleteReply> {
    const h = host
    if (!h) return { ok: false, error: "unavailable" }
    const s = await ready()
    if (!s) return { ok: false, error: "unavailable" }
    const reply = await ask<SiteChatDeleteReply>(s, "delete", {
      host: h,
      messageId,
    })
    if (!reply) return { ok: false, error: "unavailable" }
    if (!reply.ok && reply.error === "not_member") joined = false
    if (!reply.ok && reply.error === "disabled") noteDisabled(h)
    return reply
  }

  /**
   * SEND SOMEBODY ELSE'S MESSAGE TO A HUMAN.
   *
   * `reason` is clipped rather than validated: the server's schema REFUSES a
   * reason over SITE_CHAT_MAX_REPORT_REASON_CHARS instead of truncating it, so
   * a long one would come back as a refusal the reader did nothing to earn.
   * An empty or whitespace-only reason is omitted entirely — the field is
   * optional and `z.string().min(1)`, so sending "" would be refused too.
   */
  async function report(
    messageId: string,
    reason?: string,
  ): Promise<SiteChatReportReply> {
    const h = host
    if (!h) return { ok: false, error: "unavailable" }
    const s = await ready()
    if (!s) return { ok: false, error: "unavailable" }
    const trimmed = reason?.trim().slice(0, SITE_CHAT_MAX_REPORT_REASON_CHARS)
    const reply = await ask<SiteChatReportReply>(s, "report", {
      host: h,
      messageId,
      ...(trimmed ? { reason: trimmed } : {}),
    })
    if (!reply) return { ok: false, error: "unavailable" }
    if (!reply.ok && reply.error === "not_member") joined = false
    if (!reply.ok && reply.error === "disabled") noteDisabled(h)
    return reply
  }

  async function leave(): Promise<SiteChatLeaveReply> {
    const h = host
    if (!h) return { ok: false, error: "unavailable" }
    const s = await ready()
    if (!s) return { ok: false, error: "unavailable" }
    const reply = await ask<SiteChatLeaveReply>(s, "leave", { host: h })
    // Believing we left when we did not would strand the reader outside a room
    // the server still has them in, so only a CONFIRMED leave clears it.
    if (reply?.ok) {
      joined = false
      joinedHosts.delete(h)
    }
    return reply ?? { ok: false, error: "unavailable" }
  }

  function noteDisabled(h: string): void {
    disabledHosts.add(h)
    handlers.onDisabled(h)
    if (disabledHosts.size >= DARK_AFTER_DISABLED_HOSTS) {
      darkUntil = now() + DARK_COOLDOWN_MS
    }
    teardown()
  }

  // ───────────────────────────── lifecycle ─────────────────────────────────

  function watch(next: string | null): void {
    const canonical = next === null ? null : canonicalSiteHost(next)
    if (canonical === host) return
    host = canonical
    // A new website is a new room. Membership is per host, so whatever we were
    // admitted to no longer describes where we are. The SERVER's record is
    // untouched — this is the client forgetting where it is, not a leave.
    joined = false
  }

  function destroy(): void {
    destroyed = true
    teardown()
    host = null
    joined = false
  }

  return {
    watch,
    join,
    post,
    history,
    deleteMessage,
    report,
    leave,
    destroy,
    isConnected: () => !!socket?.connected,
  }
}

/** The reader has to have granted the extension the pages they read before any
 *  of this means anything: without <all_urls> there is no content script, no
 *  page presence, and nothing to be live ON. */
async function defaultHasPermission(): Promise<boolean> {
  try {
    return await checkPermissions()
  } catch {
    return false
  }
}
