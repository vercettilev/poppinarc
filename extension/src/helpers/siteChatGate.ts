/**
 * THE GATE, AS A PURE REDUCER. No network, no browser, no storage, no clock
 * of its own — every event carries the time it happened. That is the whole
 * point: R5 is a sequence of transitions, and a sequence you can only observe
 * through a socket and a side panel is a sequence nobody can test.
 *
 * ── PRESENCE IS NOT MEMBERSHIP ──────────────────────────────────────────────
 *   PRESENCE   = everyone with Poppin alive on this hostname right now (the
 *                pool). Written merely by being on the page.
 *   MEMBERSHIP = "you were admitted to this host and have not left". Written
 *                only by an explicit join, deleted only by an explicit leave.
 *
 * Entering or leaving the CHAT does not change PRESENCE, so the count that
 * admits you is untouched by your own arrival. Two consequences live in this
 * file and are both tested:
 *   - `left` does not change `count` (I1, client half).
 *   - once `member` is true, NOTHING about the count can clear it. Only the
 *     server saying so — a `leave` we sent, or a `not_member` refusal — does.
 *     That is R5: alone in the room is still in the room.
 *
 * ── THIS IS NOT THE GATE, IT IS THE PICTURE OF THE GATE ─────────────────────
 * The real gate is server-side and cannot be moved
 * (apps/backend/src/site-chat/site-membership.service.ts:157 decideAdmission).
 * A client-side gate would be bypassed outright: components/Layout.tsx
 * navigates the panel back to the persisted currentPath on mount, so a reader
 * who was in chat REOPENS INTO the chat route without pressing anything. So
 * every field below is either a server verdict or a fact about which host we
 * are looking at. Nothing here decides admission; it decides what to DRAW.
 *
 * ── THE SIX NAMED STATES ────────────────────────────────────────────────────
 *   UNKNOWN      no answer yet — render NOTHING, never 0. A presence line
 *                showing 0 tells every reader the place is dead; silence makes
 *                the same page merely quiet (helpers/presence.ts already
 *                holds this rule for the older pill).
 *   ALONE        count < 2 and not a member — the pill is hidden.
 *   OPEN         count >= 2 and not a member — pill visible and pressable.
 *   MEMBER       admitted. Pill visible REGARDLESS of the count. This is the
 *                visible half of R5.
 *   SIGNED_OUT   the room is open but we have no identity the server accepts.
 *                Pill visible and pressable; the press asks them to sign in.
 *   UNAVAILABLE  the server refused to open the door: the feature is dark
 *                (O3), this host is not allowed, or Redis could not answer.
 *
 * ── WHY THE VIEW TAKES `now` ────────────────────────────────────────────────
 * A count is only true for as long as the presence entries behind it are.
 * The server prunes a member who has not beaten in SITE_PRESENCE_TTL_SECONDS
 * (apps/backend/src/site-chat/site-chat.config.ts:29), so a count older than
 * that is not a stale number, it is a WRONG number. It expires back to
 * UNKNOWN — and UNKNOWN renders nothing, so the pill goes quiet rather than
 * lying. A panel that was closed for ten minutes therefore reopens showing
 * nothing until its first heartbeat answers, instead of announcing a crowd
 * that left.
 */

/**
 * THE GATE THRESHOLD — "more than 1 person live" = you plus at least one
 * other. The reader's OWN presence entry is written by being on the page,
 * before any chat interest exists, so 2 is the literal reading of the
 * requirement and it matches the threshold the shipped header pill already
 * uses (components/Header.tsx, "a count of 1 is the reader themselves").
 *
 * MIRRORED from apps/backend/src/site-chat/site-chat.config.ts:50. The server
 * is the authority; this copy only decides whether to draw a pressable pill.
 * siteChatGate.spec.ts reads that file and fails if the two numbers differ —
 * a client that offers a door the server will refuse is worse than no door.
 */
export const SITE_CHAT_MIN_POPULATION = 2

/**
 * How long a presence entry survives without a fresh heartbeat, MIRRORED from
 * site-chat.config.ts:29. Past this, the count we hold describes people the
 * server has already forgotten.
 */
export const SITE_PRESENCE_TTL_SECONDS = 45

/** A count older than this describes a room that no longer exists. */
export const SITE_PRESENCE_COUNT_STALE_MS = SITE_PRESENCE_TTL_SECONDS * 1000

/** Why the door will not open. Kept apart from the state name because two of
 *  these render as "nothing happened" and one renders as "try again". */
export type SiteChatBlockReason =
  /** O3: the kill switch is off, or this host is outside the allowlist. The
   *  server answers both with `disabled` on purpose, so they are
   *  indistinguishable here too (site-chat.gateway.ts:604 resolveHost). */
  | "disabled"
  /** Our canonicaliser and the server's disagreed. Should be impossible —
   *  siteChatHost.spec.ts exists to keep it that way — so treat it as a bug
   *  signal, not a user-facing state. */
  | "bad_host"
  /** Redis could not answer. Recoverable; the next join may work. */
  | "error"

export type SiteChatGateName =
  | "UNKNOWN"
  | "ALONE"
  | "OPEN"
  | "MEMBER"
  | "SIGNED_OUT"
  | "UNAVAILABLE"

/** Every refusal `join` can answer with. Mirrors SiteChatJoinError in
 *  apps/backend/src/site-chat/dto/site-chat-events.dto.ts:105. */
export type SiteChatJoinRefusal =
  | "signed_out"
  | "gate_closed"
  | "unavailable"
  | "bad_host"
  | "disabled"

/**
 * Everything the client knows. Six fields, and every one of them was either
 * stated by the server or is the identity of the page we are looking at.
 */
export interface SiteChatGateState {
  /** Canonical host this state describes. null = no page we would open a room
   *  for. It is part of the state, not a parameter, because a reply for the
   *  previous tab must be droppable — see the host guard in the reducer. */
  host: string | null
  /** The last count the SERVER reported. null = it has never told us. */
  count: number | null
  /** When that count arrived (ms epoch). Only meaningful when count !== null. */
  countAt: number
  /** The server admitted us and has not been told we left. */
  member: boolean
  /** We hold an identity the server accepts. Set from a minted ticket, and
   *  cleared the moment the server says `signed_out`. */
  signedIn: boolean
  /** A server refusal that survives until something changes it. */
  blocked: SiteChatBlockReason | null
}

/**
 * Server verdicts and page facts. There is deliberately NO event for "the
 * server could not count" — the absence of a count IS that answer, and an
 * event carrying `count: null` is an invitation for somebody downstream to
 * render 0. The store simply dispatches nothing when a heartbeat answers
 * null.
 */
export type SiteChatGateEvent =
  /** The panel is now looking at this host (already canonical), or at nothing. */
  | { type: "host"; host: string | null; at: number }
  /** A heartbeat answer that carried a number (store/useSiteChatStore.ts). */
  | { type: "presence"; host: string; count: number; at: number }
  /** A ticket was minted (true) or the reader signed out / the mint failed. */
  | { type: "signed-in"; signedIn: boolean; at: number }
  /** join answered ok. */
  | { type: "join-ok"; host: string; count: number; at: number }
  /** join refused. `count` is present only for `gate_closed`. */
  | {
      type: "join-refused"
      host: string
      error: SiteChatJoinRefusal
      count?: number
      at: number
    }
  /** WE left. Membership is gone; PRESENCE is not, and neither is the count. */
  | { type: "left"; host: string; at: number }
  /** A post or history call was refused with `not_member` — the server is
   *  correcting a client that believed it was inside. */
  | { type: "not-a-member"; host: string; at: number }

export function initialSiteChatGate(): SiteChatGateState {
  return {
    host: null,
    count: null,
    countAt: 0,
    member: false,
    signedIn: false,
    blocked: null,
  }
}

/**
 * THE REDUCER. Pure, total, and the only place client gate state changes.
 *
 * HOST SCOPING IS THE FIRST RULE. Every event except `host` and `signed-in`
 * names the host it is about, and one for a different host is DROPPED. A
 * socket reply is asynchronous; a reader who switches tabs while `join` is in
 * flight must not be told they are a member of the site they just left.
 */
export function siteChatGateReducer(
  state: SiteChatGateState,
  event: SiteChatGateEvent,
): SiteChatGateState {
  switch (event.type) {
    case "host": {
      if (event.host === state.host) return state
      // A new host is a new room: nothing we knew about the old one carries
      // over. `signedIn` does — it is a fact about the reader, not the page.
      return { ...initialSiteChatGate(), signedIn: state.signedIn, host: event.host }
    }

    case "signed-in": {
      if (event.signedIn === state.signedIn) return state
      if (event.signedIn) return { ...state, signedIn: true }
      // Signing out drops MEMBERSHIP from the client's picture, because
      // membership is per user (chatmember:<host>:<userId>) and this browser
      // can no longer prove it is that user. The durable record on the server
      // is untouched: sign back in and the next join walks straight in
      // without facing the count. That is still R5.
      return { ...state, signedIn: false, member: false }
    }

    case "presence": {
      if (event.host !== state.host) return state
      return { ...state, count: event.count, countAt: event.at }
    }

    case "join-ok": {
      if (event.host !== state.host) return state
      return {
        ...state,
        member: true,
        signedIn: true,
        count: event.count,
        countAt: event.at,
        blocked: null,
      }
    }

    case "join-refused": {
      if (event.host !== state.host) return state
      switch (event.error) {
        case "signed_out":
          return { ...state, signedIn: false, member: false, blocked: null }
        case "gate_closed":
          // The server's count is the authoritative one — it is what the
          // decision was actually made on. Adopt it, so the pill and the
          // refusal can never disagree about how many people are here.
          //
          // IT DOES NOT TOUCH `member`, and that is R5, not an oversight. A
          // member is never at the door: the server checks membership BEFORE
          // the population and admits them without reading it
          // (site-membership.service.ts:157 decideAdmission). So a
          // `gate_closed` reaching someone who believes they are inside is a
          // stale or raced reply, and acting on it would eject a reader from a
          // room the server still has them in — the exact eviction R5 forbids.
          // The refusal that DOES mean "you are not in" is `not_member`, and
          // it has its own event.
          return {
            ...state,
            blocked: null,
            ...(typeof event.count === "number"
              ? { count: event.count, countAt: event.at }
              : {}),
          }
        case "disabled":
          return { ...state, blocked: "disabled" }
        case "bad_host":
          return { ...state, blocked: "bad_host" }
        case "unavailable":
          return { ...state, blocked: "error" }
      }
      return state
    }

    case "left": {
      if (event.host !== state.host) return state
      // I1, client half: leaving the CHAT does not touch the count. The
      // person is still on the page and still counts for everyone else — and
      // for themselves, which is why the pill can stay visible and pressable
      // when the room is still busy.
      return { ...state, member: false, blocked: null }
    }

    case "not-a-member": {
      if (event.host !== state.host) return state
      return { ...state, member: false }
    }
  }
  return state
}

/** Fold a whole sequence. The transport does not need this; the specs and any
 *  future replay/debug surface do, and it keeps `siteChatGateReducer` honest
 *  about being a plain fold. */
export function siteChatGateReduceAll(
  state: SiteChatGateState,
  events: SiteChatGateEvent[],
): SiteChatGateState {
  return events.reduce(siteChatGateReducer, state)
}

/** What to draw. Strings are the UI's business; this decides only the facts. */
export interface SiteChatGateView {
  state: SiteChatGateName
  /** The count to show, or null when there is no honest number. Already
   *  expired: a caller can render this directly and can never show a stale
   *  crowd. */
  count: number | null
  /** Is there a pill at all? */
  visible: boolean
  /** Does pressing it do anything? UNAVAILABLE renders the pill exactly as
   *  the product does today — a fact with no onClick. */
  pressable: boolean
  /** True → the pill says the number ("N live"). False on a visible pill →
   *  it says the room is live without claiming a size, because a member alone
   *  in a room must not be told "1 live". */
  showCount: boolean
  /** Present only for UNAVAILABLE. `disabled`/`bad_host` mean "there is no
   *  chat here" (render as today); `error` means "try again". */
  reason: SiteChatBlockReason | null
}

/**
 * THE ONLY PLACE THE NAMED STATE IS DECIDED. `now` is a parameter so a spec
 * can walk a reader across the presence TTL without waiting 45 seconds.
 *
 * ORDER IS THE ARGUMENT:
 *  1. No host → there is no room to talk about.
 *  2. `disabled` / `bad_host` beat everything, including MEMBER: when the
 *     feature is dark the door does not exist for anyone, and the extension
 *     must render exactly as it does today (O3).
 *  3. MEMBER beats the count. This is R5's visible half — an admitted reader
 *     keeps their pill when the room empties, when Redis stops answering, and
 *     when the count expires to UNKNOWN.
 *  4. Only then does the count decide, and only if it is still true.
 */
export function siteChatGateView(
  state: SiteChatGateState,
  now: number,
): SiteChatGateView {
  const fresh =
    state.count !== null && now - state.countAt < SITE_PRESENCE_COUNT_STALE_MS
  const count = fresh ? state.count : null

  if (!state.host) return hidden("UNKNOWN")

  if (state.blocked === "disabled" || state.blocked === "bad_host") {
    // A pill with a real number but no door: the count came from presence and
    // is still true, so hiding it would lose information the reader already
    // had. This is deliberately identical to today's rendering.
    return {
      state: "UNAVAILABLE",
      count,
      visible: count !== null && count >= SITE_CHAT_MIN_POPULATION,
      pressable: false,
      showCount: count !== null && count >= SITE_CHAT_MIN_POPULATION,
      reason: state.blocked,
    }
  }

  if (state.member) {
    const shows = count !== null && count >= SITE_CHAT_MIN_POPULATION
    return {
      state: "MEMBER",
      count,
      visible: true,
      pressable: true,
      // "N live" only while N is true. Below the threshold — or with no
      // number at all — the pill says the room is live and says nothing
      // about its size, so the number never lies.
      showCount: shows,
      reason: null,
    }
  }

  if (state.blocked === "error") {
    return {
      state: "UNAVAILABLE",
      count,
      visible: count !== null && count >= SITE_CHAT_MIN_POPULATION,
      pressable: false,
      showCount: count !== null && count >= SITE_CHAT_MIN_POPULATION,
      reason: "error",
    }
  }

  if (count === null) return hidden("UNKNOWN")
  if (count < SITE_CHAT_MIN_POPULATION) return hidden("ALONE", count)

  // The room is open. Whether the press ends in a chat or in a sign-in prompt
  // is the only thing left to decide.
  return {
    state: state.signedIn ? "OPEN" : "SIGNED_OUT",
    count,
    visible: true,
    pressable: true,
    showCount: true,
    reason: null,
  }
}

function hidden(state: SiteChatGateName, count: number | null = null): SiteChatGateView {
  return { state, count, visible: false, pressable: false, showCount: false, reason: null }
}
