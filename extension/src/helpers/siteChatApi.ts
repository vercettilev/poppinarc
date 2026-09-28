import { sendApiRequest } from "~/lib/fetchService"

/**
 * THE SOCKET CREDENTIAL, AND NOTHING ELSE.
 *
 *   POST /site-chat/ticket  (Firebase auth) → a short-lived ticket
 *
 * Backed by the `ticket` route in
 * apps/backend/src/site-chat/site-chat.controller.ts (the one method there
 * behind FirebaseAuthGuard).
 *
 * ── WHY THE HEARTBEAT IS NOT IN THIS FILE ───────────────────────────────────
 * Site chat has a second HTTP route, POST /site-chat/presence/ping, and it
 * lives in `pingSitePresence` in helpers/presence.ts with the surfaces that
 * already call it (the panel's header, the content script, and a
 * chrome.alarms backstop). Two implementations of one route is how two
 * surfaces end up disagreeing about who is here, which is the exact failure
 * that file exists to prevent — so there is only one, and it is not here.
 *
 * ── AND WHY THIS FILE HAS NO ANONYMOUS ID ───────────────────────────────────
 * The presence pool de-duplicates by member id: "u:<userId>" for a signed-in
 * identity, "a:<anonId>" otherwise (`presenceMember` in
 * apps/backend/src/site-chat/site-presence.service.ts). Every heartbeat this
 * extension sends is anonymous and shares ONE id from `siteAnonId` in
 * helpers/presence.ts, so one install is one member however many surfaces
 * beat for it.
 *
 * A ticket in a socket handshake would break that: the gateway would count
 * that socket as "u:<userId>" while the same reader's page kept beating as
 * "a:<anonId>", and the pool would hold TWO members for one person — opening
 * the gate for somebody who is genuinely alone, which is the precise failure
 * the "more than 1 person" rule exists to prevent. The socket therefore never
 * writes presence at all (helpers/siteChatTransport.ts), and this ticket
 * authorises conversation only: join, post, history, leave.
 *
 * WHAT A TICKET IS NOT: it is HS256 with its own secret, issuer and audience
 * (`SITE_CHAT_TOKEN_ISSUER` / `SITE_CHAT_TOKEN_AUDIENCE` in
 * site-chat-ticket.service.ts), deliberately NOT a Firebase token, so it is
 * structurally unverifiable by every other guard in the product and cannot be
 * replayed against a money surface.
 */

/** Mirrors `SITE_CHAT_TICKET_TTL_SECONDS` in site-chat-ticket.service.ts. The
 *  live value is whatever the mint response says; this is the fallback. */
export const SITE_CHAT_TICKET_TTL_SECONDS = 300

/** Re-mint this long before expiry, so `reauth` never races the clock. */
export const SITE_CHAT_TICKET_LEEWAY_MS = 60_000

export interface SiteChatTicket {
  ticket: string
  /** ms epoch. */
  expiresAt: number
}

export type SiteChatTicketFailure =
  /** No Firebase session — nothing to mint from. */
  | "signed_out"
  /** users.is_suspended, the only manual moderation lever this feature has
   *  (site-chat.controller.ts's ticket route throws ForbiddenException on it).
   *  Do not retry: it is a person's decision, not a transient error. */
  | "suspended"
  /** 404. The kill switch being off (O3) and "no Poppin account for this
   *  identity" answer identically ON PURPOSE, so this does not try to tell
   *  them apart by reading message text off the wire. Both mean the same
   *  thing here: there is no chat for this reader right now. */
  | "no_chat"
  /** Network, 5xx, anything else. Retryable. */
  | "error"

export type SiteChatTicketResult =
  | { ok: true; value: SiteChatTicket }
  | { ok: false; reason: SiteChatTicketFailure }

let ticketCache: SiteChatTicket | null = null
let ticketInFlight: Promise<SiteChatTicketResult> | null = null

/**
 * The credential, cached until it is nearly spent.
 *
 * The mint goes through sendApiRequest — i.e. through the background worker —
 * because that is the only context holding the Firebase session the route's
 * guard requires: backendApi's request interceptor (lib/axios.ts) awaits
 * `whenAuthSettled()` and then OVERWRITES `Authorization` with the Firebase ID
 * token on every route outside its PUBLIC_ROUTES list. This route wants
 * exactly that, so the interceptor is what makes the mint work.
 *
 * ── AND THAT SAME OVERWRITE IS WHY A TICKET NEVER RIDES AN HTTP CALL ────────
 * Stated here because it is invisible from the call site and silent when it
 * bites: any request this file (or any other) sends with a site-chat ticket in
 * `Authorization` reaches the server carrying a Firebase ID token instead, with
 * no error anywhere. The one route that would notice is the public presence
 * ping — `tryGetUserId` in site-chat.controller.ts verifies a TICKET off that
 * header and treats anything unverifiable as "count me as anonymous" — so a
 * ticketed beat would be silently downgraded rather than refused.
 *
 * Nothing here depends on that working, and nothing should start to: the beat
 * is anonymous ON PURPOSE (helpers/presence.ts, `pingSitePresence`), because
 * the socket already declines to write presence so that one reader is one
 * member. The ticket authorises conversation — join, post, history, delete,
 * leave — and conversation is entirely on the socket, where the ticket travels
 * in the handshake and not in a header. So: this is a fact to know before
 * adding an HTTP call, not a bug to route around.
 *
 * Concurrent callers share one request: the transport asks for a ticket when
 * it opens a socket and again when it refreshes one, and minting twice would
 * be two database reads for a single credential.
 */
export async function getSiteChatTicket(options?: {
  force?: boolean
  now?: number
}): Promise<SiteChatTicketResult> {
  const now = options?.now ?? Date.now()
  if (
    !options?.force &&
    ticketCache &&
    ticketCache.expiresAt - now > SITE_CHAT_TICKET_LEEWAY_MS
  ) {
    return { ok: true, value: ticketCache }
  }
  if (ticketInFlight) return ticketInFlight

  ticketInFlight = mint(now).finally(() => {
    ticketInFlight = null
  })
  return ticketInFlight
}

/** True when the cached ticket is still good for a while. Lets a caller decide
 *  whether a refresh is due without minting one as a side effect. */
export function siteChatTicketIsFresh(now = Date.now()): boolean {
  return !!ticketCache && ticketCache.expiresAt - now > SITE_CHAT_TICKET_LEEWAY_MS
}

/**
 * Drop the cached ticket. A ticket names a users.id, so handing the next
 * reader the last reader's credential is the one thing a cache here could get
 * badly wrong — but be precise about how narrow that window actually is:
 *
 *   - The cache is MODULE-LEVEL, so it dies with the document that holds it.
 *   - In the SIDE PANEL the product's own sign-out closes that document:
 *     components/Header.tsx's `performLogout` calls window.close() in its
 *     sidepanel branch, so the everyday path already destroys this.
 *   - The only auth listener in the extension is the one-shot settle helper
 *     `whenAuthSettled` in lib/axios.ts, which unsubscribes as soon as auth
 *     resolves and never swaps one user for another in place.
 *
 * WHO CALLS IT: store/useSiteChatStore.ts's `stop()`, paired there with
 * transport.destroy(), so the socket's handshake identity and the credential
 * behind it always end together — and `stop()` itself now runs on the panel
 * document's `pagehide`, which is the lifecycle it was written for.
 *
 * WHAT IS STILL OPEN, named rather than implied: `performLogout`'s POPUP
 * branch does NOT close its document — it sends OPEN_WELCOME_PAGE and returns
 * — so a sign-out there leaves this cache holding the previous reader's
 * ticket in a live document. Header.tsx belongs to another surface and is not
 * edited from here; the fix is one line in `performLogout`, calling
 * `useSiteChatStore.getState().stop()` (which calls this) beside the Zustand
 * user-store reset, so the socket dies with the session rather than after it.
 */
export function clearSiteChatTicket(): void {
  ticketCache = null
}

async function mint(now: number): Promise<SiteChatTicketResult> {
  try {
    const res = await sendApiRequest<{
      ticket?: string
      expiresInSeconds?: number
    }>({ url: "/site-chat/ticket", method: "POST" })
    if (!res?.ticket) return { ok: false, reason: "error" }
    const ttl =
      typeof res.expiresInSeconds === "number" && res.expiresInSeconds > 0
        ? res.expiresInSeconds
        : SITE_CHAT_TICKET_TTL_SECONDS
    ticketCache = { ticket: res.ticket, expiresAt: now + ttl * 1000 }
    return { ok: true, value: ticketCache }
  } catch (e) {
    ticketCache = null
    return { ok: false, reason: failureOf(e) }
  }
}

/** sendApiRequest rejects with the background's shape, { status, message }
 *  (the API_REQUEST handler in entries/background/main.ts). */
function failureOf(e: unknown): SiteChatTicketFailure {
  const status = (e as { status?: number } | null)?.status
  if (status === 401) return "signed_out"
  if (status === 403) return "suspended"
  if (status === 404) return "no_chat"
  return "error"
}
