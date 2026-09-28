import { CAP } from "~/config/edition"
import { sendApiRequest } from "~/lib/fetchService"

/**
 * How many browsers hold a live card on this hostname right now.
 *
 * ── ONE SOURCE, TWO SURFACES ────────────────────────────────────────────────
 * The card's head and the side panel's header both show this number, and they
 * must be the SAME number — two surfaces disagreeing about "who's here" is the
 * exact class of bug this session spent a day undoing for post formatting. So
 * the fetch lives here and both import it.
 *
 * ONE WORD, TOO. Both surfaces say "live", never "online": the header pill is
 * the door to the live chat and the card's line is the same number, so a
 * product that called one "online" and the other "live" would be speaking two
 * words for one fact. Change the word here and change it in both call sites in
 * the same edit — components/Header.tsx and components/SpotCard/SpotCard.tsx.
 *
 * The count is /ticks page-room size: a socket in `page:<hostname>` is a
 * browser with a live card there, signed-in or not. It is NOT the site-chat
 * pool below — that one counts every reader with Poppin alive on the host,
 * card or no card — and the header prefers the pool whenever site chat is
 * available, falling back to this only when the feature is dark.
 *
 * null means "could not ask" — and null renders as NOTHING, everywhere. A
 * presence line that shows 0 tells every reader the place is dead; silence
 * makes the same page merely quiet. Both callers also hide counts below 2,
 * because a count of 1 is the reader themselves.
 */
export async function fetchPagePresence(hostname: string): Promise<number | null> {
  // No presence backend in the Arc edition: "could not ask", which renders as nothing.
  if (!CAP.sitePresence) return null
  try {
    const r = await sendApiRequest<{ onlineCount: number }>({
      url: `/ticks/pages/${encodeURIComponent(hostname)}/presence`,
      method: "GET",
    })
    return typeof r?.onlineCount === "number" ? r.onlineCount : null
  } catch {
    return null
  }
}

/**
 * THE PILL'S WORDS, in the file that owns the vocabulary.
 *
 * Two labels and one rule: SAY THE NUMBER ONLY WHEN THE NUMBER IS TRUE. A
 * member alone in a room is still in the room (R5), and telling them "1 live"
 * would be the pill counting the reader to themselves — the same mistake the
 * card refuses two comments above. So the size drops out and the pill says
 * only that the room is live.
 *
 * `showCount` is decided by helpers/siteChatGate.ts, which is the only place
 * allowed to decide it; this turns that verdict into English.
 */
export function siteLivePillLabel(view: {
  count: number | null
  showCount: boolean
}): string {
  return view.showCount && typeof view.count === "number"
    ? `${view.count} live`
    : "Live chat"
}

// ─────────────────────────── THE SITE POOL ─────────────────────────────────
/**
 * PRESENCE IS THE POOL, AND THE POOL IS WHAT THE GATE READS.
 *
 * Everything below feeds `presence:site:<host>` on the backend — a Redis ZSET
 * of everyone with Poppin alive on a hostname right now
 * (apps/backend/src/site-chat/site-presence.service.ts). It is written merely
 * by BEING on the page. It is never written by entering or leaving the chat:
 * that is membership, it lives in a different key, and keeping the two apart
 * is what makes "once you are in you are never kicked out" buildable at all.
 *
 * WHY THE HEARTBEAT IS NOT IN THE SERVICE WORKER. Chrome evicts an MV3
 * background worker after a short idle and every setInterval dies with it,
 * silently freezing the one number the gate, the header pill and the chat's
 * own admission all consume — a frozen count is worse than no count, because
 * it looks like an answer. So the beat lives in real documents: the side panel
 * while it is open (components/Header.tsx) and the content script on the
 * active page (entries/contentScript/primary/main.tsx), with a coarse
 * chrome.alarms backstop in the background (entries/background/main.ts).
 *
 * SEVERAL WRITERS FOR ONE MEMBER IS SAFE BY CONSTRUCTION, not by
 * coordination: the server's write is ZADD keyed by member id, so a second
 * writer for the same member overwrites a score and the cardinality does not
 * move. That is the whole reason the panel, the page and the alarm may all
 * beat for the same reader without anyone counting them twice.
 */

/**
 * The per-install anonymous id. It identifies a BROWSER INSTALL so the pool
 * can de-duplicate; it authorises nothing and is never sent as an identity.
 * Two tabs of one person are one member because both read this same key.
 */
const ANON_ID_KEY = "poppin_site_presence_anon"

/** Read once per context, then held — every beat would otherwise pay a
 *  storage round trip for a value that never changes. `watchAnonId` below is
 *  what keeps "held" from meaning "stale". */
let anonIdCache: string | null = null

/** One resolution at a time per context. Two beats starting in the same tick
 *  would otherwise each find the key empty, each generate an id and each
 *  write — and the loser's id becomes a pool member nobody is behind. */
let anonIdInFlight: Promise<string | null> | null = null

/** Registered lazily and once: this module also loads in contexts where
 *  chrome.storage does not exist at all. */
let anonIdWatching = false

/**
 * THE CONVERGENCE MECHANISM, and the only one.
 *
 * chrome.storage.onChanged fires in every extension context — including the
 * one that made the write — so the value written LAST to the key is the value
 * every context ends up holding. Nothing polls and nothing compares.
 *
 * It is also why the create path below only ever fills an EMPTY cache: a
 * change event is strictly newer than a `get()` issued before it, so a late
 * read must never overwrite what this listener already installed.
 */
function watchAnonId(): void {
  if (anonIdWatching) return
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return
      const next = changes?.[ANON_ID_KEY]?.newValue
      if (typeof next === "string" && next.length > 0) anonIdCache = next
    })
    anonIdWatching = true
  } catch {
    // No storage events reachable here (an orphaned page after an extension
    // reload). siteAnonId still works; it just cannot hear another document.
  }
}

/**
 * A random opaque id, WITHOUT crypto.randomUUID.
 *
 * randomUUID exists only in a secure context, and a content script inherits
 * the PAGE's context — so on any plain http:// site it is undefined and the
 * id generation would throw where presence matters most. getRandomValues has
 * no such requirement.
 */
function newAnonId(): string {
  const bytes = new Uint8Array(16)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    // No WebCrypto at all. A weaker id still de-duplicates one install from
    // another, which is the only job this string has.
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

/**
 * This install's presence id, creating it on first use.
 *
 * Returns null when chrome.storage is unreachable (an orphaned page after an
 * extension reload), and a null id means NO BEAT — never a fresh random id per
 * call, which would inflate the pool by one member per heartbeat.
 *
 * TWO DOCUMENTS CAN RACE HERE — the panel and the page can both find the key
 * empty on a fresh install, and both then write. Storage is last-write-wins
 * and `watchAnonId` above adopts every change, so both contexts end up holding
 * whichever id was written last: the loser's cache is overwritten by the change
 * event for the winner's write. THE CONVERGENCE IS THAT LISTENER, not a later
 * read — a cached id is deliberately never re-read, which is exactly how an
 * earlier version of this file could hold two ids for one install forever and
 * hand the admission gate a second member who did not exist. The ids handed
 * out DURING the race can still differ, for as long as the change events take
 * to be delivered; every call after that agrees.
 *
 * THIS IS THE EXTENSION'S ONLY PRESENCE ID, and the chat socket keeps it that
 * way by writing no presence at all: it never sends `hello` and never puts an
 * anonId in its handshake (helpers/siteChatTransport.ts:24-39). A socket that
 * did would be counted as "u:<userId>" beside this install's "a:<anonId>", and
 * one reader would be the two members the gate is asking about.
 */
export async function siteAnonId(): Promise<string | null> {
  if (anonIdCache) return anonIdCache
  if (anonIdInFlight) return anonIdInFlight
  anonIdInFlight = resolveAnonId().finally(() => {
    anonIdInFlight = null
  })
  return anonIdInFlight
}

async function resolveAnonId(): Promise<string | null> {
  watchAnonId()
  try {
    const got = await chrome.storage.local.get(ANON_ID_KEY)
    const stored = got?.[ANON_ID_KEY]
    if (typeof stored === "string" && stored.length > 0) {
      // `?? stored`, never a bare assignment: if the listener heard another
      // document's write while this read was in flight, that id is the newer
      // fact and it wins.
      anonIdCache = anonIdCache ?? stored
      return anonIdCache
    }
    const fresh = newAnonId()
    await chrome.storage.local.set({ [ANON_ID_KEY]: fresh })
    // Same rule on the write path, and the reason is sharper here: our own
    // write raises a change event too, so by this line the listener may
    // already hold either id. Whatever it holds is the last one written.
    anonIdCache = anonIdCache ?? fresh
    return anonIdCache
  } catch {
    return null
  }
}

/** The one route the heartbeat writes. Named here so the background's alarm
 *  backstop, which cannot use sendApiRequest (a sender never receives its own
 *  runtime message), spells the same URL as the documents do. */
export const SITE_PRESENCE_PING_ROUTE = "/site-chat/presence/ping"

/**
 * How often a visible document re-asserts its presence.
 *
 * The server drops a member 45 seconds after their last beat
 * (SITE_PRESENCE_TTL_SECONDS in apps/backend/src/site-chat/site-chat.config.ts)
 * and exports 15 as the interval it expects, which survives two missed beats.
 * This file quotes THAT number rather than a rounder one: at a 30s cadence a
 * single missed beat leaves the reader out of the pool for the remaining 15s,
 * and the pool is the number that decides who may enter the chat.
 *
 * Only the ACTIVE, VISIBLE document beats, so the cost is one request per
 * fifteen seconds per surface, not one per open tab.
 */
export const SITE_PRESENCE_REFRESH_MS = 15_000

/**
 * THE BACKSTOP'S NAME AND CADENCE, next to the interval it backs up, the way
 * ORDER_WATCH_ALARM sits in helpers/orderFillWatch.ts rather than in the
 * background that registers it.
 *
 * ONE MINUTE IS NOT A HEARTBEAT AND IS NOT MEANT TO BE. Against a 45s server
 * TTL, an alarm on this period cannot hold a reader in the pool continuously —
 * it re-establishes them, it does not sustain them. Its job is the case the
 * documents cannot cover: the panel is closed, the page's own beat stopped,
 * and the service worker woke for something else entirely. The documents are
 * the heartbeat; this is a floor under it. The period matches the panel's
 * oldest alarm ("checkNotifications"), which is the cadence this codebase
 * already treats as cheap.
 */
export const SITE_PRESENCE_ALARM = "siteChatPresenceBeat"
export const SITE_PRESENCE_ALARM_PERIOD_MIN = 1

export interface SitePresence {
  /** The pool size, or null for "could not ask" — which renders as NOTHING. */
  count: number | null
  /**
   * False only when the server says this feature does not exist here: site
   * chat is switched off, or this host is outside its allowlist. The header
   * uses it to fall back to the plain page count and to render the pill as a
   * fact with no door, exactly as it did before chat existed.
   */
  available: boolean
}

/** "We could not ask, but the feature is still there." */
const UNKNOWN: SitePresence = { count: null, available: true }

/**
 * ONE BEAT. Registers this install on `host` and returns the fresh pool size.
 *
 * A presence write and nothing else — it can never admit anyone to a chat and
 * can never remove anyone from one.
 *
 * IT NAMES THE INSTALL, NEVER THE PERSON, and every presence write in the
 * extension does the same — which is what keeps one reader to one member. The
 * server would accept a signed-in identity from a site-chat ticket in the
 * Authorization header (site-chat.controller.ts tryGetUserId), but this beat
 * cannot put one there: backendApi's request interceptor overwrites
 * Authorization with the Firebase ID token on every route outside
 * PUBLIC_ROUTES (lib/axios.ts:94, the early return at :98, the overwrite at
 * :114). Adding this route to PUBLIC_ROUTES would let a ticket through.
 *
 * THE COST OF STAYING ANONYMOUS, stated plainly: one signed-in person on two
 * devices is two installs and therefore two members of the pool. That is a
 * count slightly too high, in the direction of opening a gate — the reverse
 * trade from letting a socket write a second member for one reader, which is
 * why helpers/siteChatTransport.ts:24-39 refuses to write presence at all.
 *
 * THIS ID IS NOT A CREDENTIAL, AND THE SERVER MUST NOT TREAT IT AS ONE. The
 * route is public and takes its member id from the body — the schema accepts
 * any 1-128 character string (apps/backend/src/site-chat/dto/
 * site-chat-http.dto.ts:24) and the controller makes it the ZSET member
 * verbatim (site-chat.controller.ts:169) — so two posts with two invented ids
 * raise the very count the admission gate reads
 * (site-membership.service.ts:157). Nothing in this file can close that: an
 * honest client cannot make a forgeable route unforgeable. The fix is
 * server-side — derive the member from something the caller cannot choose, or
 * count only ticketed identities toward SITE_CHAT_MIN_POPULATION — and it is
 * written down here because this is the file the next reader will open.
 */
export async function pingSitePresence(host: string): Promise<SitePresence> {
  /* No site chat in the Arc edition. Answered exactly like the server's 404
     but without asking: every heartbeat (page, panel header, chat store)
     stops its timer on "not available" and the pill stays hidden. */
  if (!CAP.sitePresence) return { count: null, available: false }
  // Asked and answered "no chat here" within the window: do not ask again.
  if (await hostIsDark(host)) return { count: null, available: false }
  const anonId = await siteAnonId()
  if (!anonId) return UNKNOWN
  try {
    const r = await sendApiRequest<{ count: number | null }>({
      url: SITE_PRESENCE_PING_ROUTE,
      method: "POST",
      data: { host, anonId },
    })
    return {
      count: typeof r?.count === "number" ? r.count : null,
      available: true,
    }
  } catch (e) {
    // 404 is the kill switch and the allowlist speaking with one voice: this
    // host has no chat. Anything else — offline, 429, a 500 — is a bad moment,
    // not a missing feature, and must not tear the door off the pill.
    const status = (e as { status?: number } | undefined)?.status
    if (status === 404) {
      void rememberDark(host)
      return { count: null, available: false }
    }
    return UNKNOWN
  }
}

/**
 * THE DOCUMENT HEARTBEAT. Beats once now, then every SITE_PRESENCE_REFRESH_MS
 * for as long as this document is visible, and beats again the moment the
 * document comes back into view rather than waiting out an interval the reader
 * has already spent looking at the page.
 *
 * ONE HEARTBEAT IS ONE HOST. It takes the host as a value, not as a getter,
 * because a host change is a different room and deserves an immediate beat:
 * the caller stops this one and starts another (a React effect keyed on the
 * host does exactly that, and the content script never needs to — a document's
 * own hostname cannot change without a fresh document).
 *
 * HIDDEN MEANS STOPPED, on purpose. A background tab is not a reader; letting
 * every open tab beat would spend a request per tab to say what one member id
 * already says, and would keep a room "busy" that nobody is looking at.
 * Presence then lapses by TTL, which is the only way presence ever ends.
 *
 * Returns its own stop function. Callers must call it on unmount: a beat that
 * outlives its surface is exactly the frozen-timer failure this design moved
 * out of the service worker to avoid.
 */
export function startSitePresenceHeartbeat(
  host: string,
  onResult?: (result: SitePresence, host: string) => void,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false

  const beat = () => {
    if (stopped || inFlight) return
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    inFlight = true
    void pingSitePresence(host)
      .then((r) => {
        if (stopped) return
        // DARK MEANS STOP BEATING. A 404 says this host has no chat — the
        // kill switch is off, or the host is outside the allowlist — and
        // beating four times a minute to hear the same "no" is a request per
        // fifteen seconds spent on nothing. The visibility listener stays
        // registered, so returning to the tab asks again and a feature
        // switched on while the reader was away is picked up then.
        if (!r.available) stopTimer()
        onResult?.(r, host)
      })
      .finally(() => {
        inFlight = false
      })
  }

  const startTimer = () => {
    if (timer !== null) return
    timer = setInterval(beat, SITE_PRESENCE_REFRESH_MS)
  }
  const stopTimer = () => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      stopTimer()
      return
    }
    beat()
    startTimer()
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility)
  }
  beat()
  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    startTimer()
  }

  return () => {
    stopped = true
    stopTimer()
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }
}

/**
 * A "NO" IS REMEMBERED, ACROSS TABS AND WORKER RESTARTS.
 *
 * The document heartbeat stops after one 404 and the background's beat
 * keeps a dark-host set, yet the api log showed 257 presence pings in
 * fifteen minutes, every one a 404 for x.com (2026-09-17): each page load,
 * each tab switch and each service-worker restart asked the same question
 * again. The answer lives here now, per host, for six hours, in
 * chrome.storage.local so every context reads the same memory. A host
 * switched on for chat is picked up within the window.
 */
export const SITE_CHAT_DARK_KEY = "poppin_site_chat_dark"
export const SITE_CHAT_DARK_TTL_MS = 6 * 60 * 60 * 1000

export type DarkHosts = Record<string, number>

/** The pure half: is `host` remembered as dark at `now`? */
export function darkHas(map: DarkHosts | null | undefined, host: string, now: number): boolean {
  const until = map?.[host]
  return typeof until === "number" && until > now
}

/** The pure half: remember `host`, and forget every entry that has lapsed. */
export function darkWith(map: DarkHosts | null | undefined, host: string, now: number): DarkHosts {
  const out: DarkHosts = {}
  for (const [h, until] of Object.entries(map ?? {})) {
    if (typeof until === "number" && until > now) out[h] = until
  }
  out[host] = now + SITE_CHAT_DARK_TTL_MS
  return out
}

const storageLocal = () =>
  (globalThis as { chrome?: { storage?: { local?: chrome.storage.LocalStorageArea } } }).chrome
    ?.storage?.local ?? null

export async function hostIsDark(host: string, now = Date.now()): Promise<boolean> {
  const area = storageLocal()
  if (!area) return false
  try {
    const stored = await area.get(SITE_CHAT_DARK_KEY)
    return darkHas(stored?.[SITE_CHAT_DARK_KEY] as DarkHosts | undefined, host, now)
  } catch {
    return false
  }
}

export async function rememberDark(host: string, now = Date.now()): Promise<void> {
  const area = storageLocal()
  if (!area) return
  try {
    const stored = await area.get(SITE_CHAT_DARK_KEY)
    await area.set({
      [SITE_CHAT_DARK_KEY]: darkWith(stored?.[SITE_CHAT_DARK_KEY] as DarkHosts | undefined, host, now),
    })
  } catch {
    // A memory that fails to write costs one more question later, nothing else.
  }
}
