import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import MoreHorizIcon from "@mui/icons-material/MoreHoriz"
import {
  alpha,
  Box,
  CircularProgress,
  Menu,
  MenuItem,
  TextareaAutosize,
  Typography,
} from "@mui/material"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate } from "react-router"
import { CAvatar } from "~/components/CAvatar"
import SignInPrompt from "~/components/SignInPrompt"
import { useToast } from "~/components/Toast/ToastProvider"
import { ACCENT, DIM, FAINT, PANEL_CARD, PANEL_PILL } from "~/helpers/panelSurface"
import {
  siteChatGateView,
  type SiteChatBlockReason,
  type SiteChatGateName,
} from "~/helpers/siteChatGate"
import type {
  SiteChatMessage,
  SiteChatReportReply,
} from "~/helpers/siteChatTransport"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import {
  useSiteChatStore,
  type SiteChatNotice,
} from "~/store/useSiteChatStore"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { checkPermissions } from "~/helpers/permissionHelper"
import { JUICE } from "~/theme/juice"
import { compactAge } from "~/utils/dateUtils"

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WEBSITE LIVE CHAT SCREEN — one room per hostname, R4's surface.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file RENDERS. It does not decide who is allowed in, it does not own a
 * socket, and it does not count anybody. Those three jobs live elsewhere on
 * purpose:
 *
 *   the gate      apps/backend/src/site-chat/site-chat.gateway.ts — `join` is
 *                 the ONLY function in the system that reads the population,
 *                 and membership is checked BEFORE the count, so a member is
 *                 never re-gated (invariant I2).
 *   the socket    helpers/siteChatTransport.ts
 *   the state     store/useSiteChatStore.ts
 *   the naming    helpers/siteChatGate.ts turns (count, membership, auth)
 *                 into the named state this screen paints.
 *
 * WHY THE GATE IS NOT HERE, stated where a future editor will look for it.
 * A client-side gate is not a gate — but the concrete reason is sharper than
 * the principle: components/Layout.tsx navigates the panel back to the
 * persisted currentPath on mount, so a reader who was in the chat REOPENS
 * INTO this route with no press at all. A gate living in the header pill's
 * onClick would simply not run. Everything below treats the server's answer
 * as the truth and paints it; there is no branch here that admits anybody.
 *
 * R5 — "once inside you are NEVER kicked out until YOU leave" — is visible in
 * two places on this screen, and they are the two halves of it:
 *
 *   `alone`        a member whose room has emptied keeps the transcript and
 *                  the composer. The room says so warmly instead of reporting
 *                  a failure, because nothing failed.
 *   the ALONE card the reader who was in and whose CLIENT forgot. Membership
 *                  is durable on the server and ephemeral here — it dies with
 *                  the panel document — so that card carries a press that
 *                  asks the server again. Its full reasoning is written at
 *                  the branch.
 *
 * ── THE SCROLL RULE, decided rather than inherited ─────────────────────────
 * STICK TO THE BOTTOM ONLY IF THE READER IS ALREADY AT THE BOTTOM.
 *
 *   new message + reader at the bottom  → follow it down
 *   new message + reader scrolled up    → do not move a pixel; raise the
 *                                         "N new" pill instead
 *   older page prepended                → hold the reader's anchor by adding
 *                                         the height that appeared above them
 *                                         back onto scrollTop, before paint
 *
 * components/CustomInfiniteScroll.tsx has a `reverse` prop left over from the
 * chat that was deleted, and it is NOT this. Read it: BOTH of its branches put
 * the sentinel AFTER the children, and `reverse` only moves the spinner above
 * them. A transcript loads OLDER messages when the reader scrolls UP, so the
 * sentinel has to be the FIRST child — with that component the fetch would
 * fire at the newest end instead. It also has no anchor compensation, which is
 * the half that actually decides whether the view jumps. Hence the observer
 * below.
 *
 * ── MODERATION: TWO PRIVATE CONTROLS AND TWO REAL ONES ─────────────────────
 * Chat was removed from this product once for a moderation cost the team
 * could not staff (commit c0da3aea). It does not come back with zero controls
 * on it. The four in `MessageMenu` are deliberately two different KINDS, and
 * conflating them is the failure this paragraph exists to prevent:
 *
 *   PRIVATE — chrome.storage.local, instant, this install only. They change
 *   what THIS reader sees and nothing else. Nobody is told, and the message
 *   is still on every other screen in the room.
 *     Hide   this one message, gone for this reader.
 *     Mute   this person's lines stop arriving, per host.
 *
 *   REAL — a verb on the wire, judged by the server, visible beyond this
 *   browser.
 *     Delete  `delete { host, messageId }`. AUTHOR-ONLY at the server, so the
 *             control is rendered only on the reader's own row: a button that
 *             appears where the answer is always `not_author` is a button that
 *             teaches people the product is broken. The row leaves every panel
 *             in the room, including this one, when the server says so.
 *     Report  `report { host, messageId, reason? }`. Sends somebody ELSE's
 *             message to a human — the server refuses `own_message`, so this
 *             control is rendered only on rows that are not the reader's, the
 *             mirror image of Delete. It also hides the message locally,
 *             BEFORE the call: that is the half that actually stops the harm
 *             for this reader, and it must not wait on a network round trip.
 *
 * WHAT `ok: true` ON A REPORT MEANS, because the wording of the toast is the
 * whole promise: "a human will see this", and nothing more. Not that the
 * message was hidden for anyone else, not that the author was actioned, not
 * that somebody is on call. `reportOutcomeText` below is the one place that
 * claim is written, so it can be read and checked in one screenful.
 */

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING — the ONLY block that touches the transport, the store and the
// gate reducer. Everything below this section renders from `RoomModel`, which
// is declared here, so if those three modules move or rename something this
// is the single place that has to follow.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One rendered line — the transport's own type, aliased rather than copied.
 *
 * A second declaration of the same seven fields is how two files start
 * disagreeing about whether `username` can be null. There is one shape on the
 * wire (`SiteChatMessage` in
 * apps/backend/src/site-chat/dto/site-chat-events.dto.ts), the transport
 * already declares it (helpers/siteChatTransport.ts, `SiteChatMessage`), and
 * this screen renders it. The alias exists only so the name at the render site
 * says what the reader is looking at.
 *
 * `content` is TEXT. Rendered as a text node, never as markup — see
 * MessageRow.
 */
export type LiveChatMessage = SiteChatMessage

/**
 * The named states this screen paints.
 *
 * SIX of them are the gate reducer's, unchanged and re-exported by name
 * (helpers/siteChatGate.ts, `SiteChatGateName`) — this screen must not invent
 * a second vocabulary for the thing the reducer already named. THREE more are
 * screen-only refinements of the reducer's `UNAVAILABLE`, which carries its
 * cause in `reason` rather than in its name because the PILL renders all
 * three identically and only a full screen has room to explain them:
 *
 *   DISABLED       O3's kill switch, or this host is outside the allowlist.
 *                  The server answers both with `disabled` on purpose, so
 *                  they are indistinguishable here too.
 *   BAD_HOST       there is no room for this address at all.
 *   NO_PERMISSION  Poppin cannot see the page, so there is no host to key on.
 *
 * UNKNOWN is not a synonym for "empty": it means no answer has arrived, and
 * it renders as waiting, never as a 0. helpers/presence.ts records the same
 * ruling for the count this feature inherited, above `fetchPagePresence` —
 * "a presence line that shows 0 tells every reader the place is dead".
 */
export type LiveChatScreen =
  | SiteChatGateName
  | "BAD_HOST"
  | "DISABLED"
  | "NO_PERMISSION"

/**
 * THE ONE PLACE THE SCREEN IS CHOSEN. Pure, so every state below is
 * reachable in a test without a socket, a store or a signed-in user — which
 * is the only way "every state is designed" is checkable rather than
 * aspirational.
 *
 * ORDER IS THE ARGUMENT, and it is the gate view's order plus the two facts
 * the gate does not know about:
 *   1. We cannot see the page at all. Nothing downstream can be true yet, and
 *      the reader has one specific thing to do about it.
 *   2. There is no host. `siteChatGateView` folds this into UNKNOWN because a
 *      pill simply does not render; a screen that spun forever instead of
 *      saying "there is no room here" would be a blank panel with no way out.
 *   3. The reducer's own verdict, with UNAVAILABLE split by its reason.
 */
export function liveChatScreen(m: {
  host: string | null
  gate: SiteChatGateName
  reason: SiteChatBlockReason | null
  permissionMissing: boolean
}): LiveChatScreen {
  if (m.permissionMissing) return "NO_PERMISSION"
  if (!m.host) return "BAD_HOST"
  if (m.gate === "UNAVAILABLE") {
    if (m.reason === "disabled") return "DISABLED"
    if (m.reason === "bad_host") return "BAD_HOST"
    return "UNAVAILABLE"
  }
  return m.gate
}

/** Everything this screen renders from. */
export interface RoomModel {
  /** Canonical hostname, server-side rules mirrored client-side for the
   *  title only — the server re-canonicalises every entry point and never
   *  trusts our string — helpers/siteChatHost.ts says so in its own header,
   *  under "THIS FILE IS A MIRROR, NOT A SOURCE". Null while the active tab
   *  is not a website. */
  host: string | null
  /** The reducer's verdict, straight through. */
  gate: SiteChatGateName
  reason: SiteChatBlockReason | null
  /** The optional host permissions are missing, so the panel cannot see the
   *  page. Distinct from "this page has no room": the fix is a grant. */
  permissionMissing: boolean
  /** null = nobody has told us yet. Never render a null as 0. */
  count: number | null
  messages: readonly LiveChatMessage[]
  /** True while an older page is in flight. */
  loadingOlder: boolean
  /** False once the server stops handing back a cursor. */
  hasOlder: boolean
  /** The socket's own health, independent of the gate: a member whose
   *  socket dropped is still a member (the server never revokes on
   *  disconnect — site-chat.gateway.ts, `handleDisconnect`, which enforces
   *  that by doing nothing). */
  connected: boolean
  /** Set while a send is in flight, so the composer can say so. */
  sending: boolean
  /**
   * The last refusal, verb and all, straight from the store
   * (store/useSiteChatStore.ts, `SiteChatNotice`).
   *
   * A JOIN refusal is deliberately NOT shown as a strip: the gate already
   * renders it as a whole screen, and a card saying "one more person needs to
   * be here" with a red error bar under it says the same thing twice in two
   * moods. See `noticeStrip` below for the filter.
   */
  notice: SiteChatNotice | null
  meId: string | null
  enter: () => void
  leave: () => void
  send: (content: string) => void
  /**
   * Take back one of the reader's OWN messages. Fire-and-forget from here: the
   * row leaves when the server confirms, either on the ack or on the
   * `message-deleted` broadcast, and a refusal arrives as a `notice` with verb
   * "delete". Nothing on this screen removes a row on a press.
   */
  deleteMessage: (messageId: string) => void
  /**
   * Send somebody ELSE's message to a human, and answer the caller.
   *
   * This is the one verb whose refusal does NOT come back as a notice — see
   * the note on `SiteChatReportReply` in the store. The reader pressed a menu
   * item about one row and needs an answer about that row, in both directions,
   * so the screen toasts it and this reply is what it words the toast from.
   */
  report: (messageId: string) => Promise<SiteChatReportReply>
  loadOlder: () => void
  dismissNotice: () => void
}

/**
 * MIRRORS `SITE_CHAT_MAX_MESSAGE_CHARS` in
 * apps/backend/src/site-chat/site-chat.config.ts. The server is
 * the judge — it re-checks and answers `too_long` — so this number only stops
 * a doomed frame from leaving. Named rather than inlined so the two can be
 * compared by grepping one word.
 */
export const LIVE_CHAT_MAX_CHARS = 500

// ═══════════════════════════════════════════════════════════════════════════
// PURE PARTS — the decisions worth testing without a DOM.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The room's label.
 *
 * "N live" only from 2 up. A member sitting in an emptied room gets "Live
 * chat" and a dot instead — they ARE still in it (R5), and printing "1 live"
 * would be a number about the room that means "you". The same threshold and
 * the same reasoning as the header's own pill (components/Header.tsx,
 * "a count of 1 is the reader themselves").
 */
export function liveCountLabel(count: number | null): string {
  return typeof count === "number" && count >= 2 ? `${count} live` : "Live chat"
}

/** Within this many pixels of the bottom counts as "at the bottom". A reader
 *  never lands on an exact 0, and sub-pixel layout means the arithmetic
 *  rarely settles cleanly either. */
export const BOTTOM_EPSILON_PX = 24

export function isAtBottom(el: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EPSILON_PX
}

/**
 * A LAST GUARD ON THE REACT KEY, not the protocol's de-duplication.
 *
 * The sender does see its own message twice — once in the `post` ack, once
 * in the `message` broadcast, which the protocol deliberately sends to
 * everyone INCLUDING the author (dto/site-chat-events.dto.ts,
 * `SiteChatMessageEvent`) — but the store is what collapses those:
 * `remember()` filters incoming ids
 * against the ones it holds (store/useSiteChatStore.ts, `remember()`). By the
 * time a list reaches this screen it should already be unique.
 *
 * This pass exists because "should" is not "is", and the cost of being wrong
 * lands here rather than there: two rows with the same `key` make React
 * reconcile the wrong element, which in a transcript means a message
 * rendering under somebody else's name. One Set per render is cheap
 * insurance against a class of bug that is very hard to read off a screen.
 *
 * Order is the server's and is preserved: a page is oldest-first
 * (site-chat.service.ts, `getMessages`), and live messages append.
 */
export function dedupeById(
  messages: readonly LiveChatMessage[],
): LiveChatMessage[] {
  const seen = new Set<string>()
  const out: LiveChatMessage[] = []
  for (const m of messages) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out
}

/** What this reader has silenced on this host. Local to the install. */
export interface LocalMutes {
  hiddenIds: readonly string[]
  mutedUserIds: readonly string[]
}

/** Apply the reader's own moderation. Their own messages are never muted out
 *  from under them — muting yourself is a mistake, not an intent. */
export function applyLocalMutes(
  messages: readonly LiveChatMessage[],
  mutes: LocalMutes,
  meId: string | null,
): LiveChatMessage[] {
  const hidden = new Set(mutes.hiddenIds)
  const muted = new Set(mutes.mutedUserIds)
  return messages.filter(
    (m) => !hidden.has(m.id) && (m.userId === meId || !muted.has(m.userId)),
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL MODERATION STORAGE
// ═══════════════════════════════════════════════════════════════════════════

const MUTES_KEY = "siteChatMutes"
/** Bounded forever: a reader who hides a hundred lines on one host does not
 *  get to grow chrome.storage without limit. The oldest fall off. */
const MUTES_CAP = 200

type MutesByHost = Record<string, { hiddenIds: string[]; mutedUserIds: string[] }>

const EMPTY_MUTES: LocalMutes = { hiddenIds: [], mutedUserIds: [] }

function useLocalMutes(host: string | null) {
  const [mutes, setMutes] = useState<LocalMutes>(EMPTY_MUTES)

  /**
   * The committed list, readable synchronously.
   *
   * Hiding two messages in the same tick through the state variable alone
   * means the second press builds its list from the `mutes` its render
   * closed over — which does not yet contain the first — and the first hide
   * silently un-happens. A ref is current the instant it is assigned, so N
   * presses are N hides, and the write stays OUT of the state updater, which
   * React may call twice.
   */
  const mutesRef = useRef<LocalMutes>(EMPTY_MUTES)

  const adopt = useCallback((value: LocalMutes) => {
    mutesRef.current = value
    setMutes(value)
  }, [])

  useEffect(() => {
    if (!host) {
      adopt(EMPTY_MUTES)
      return
    }
    let alive = true
    // Reset first: until storage answers, the previous site's hide list must
    // not be applied to this site's transcript.
    adopt(EMPTY_MUTES)
    try {
      chrome?.storage?.local?.get(MUTES_KEY, (all) => {
        if (!alive) return
        const forHost = (all?.[MUTES_KEY] as MutesByHost | undefined)?.[host]
        adopt(
          forHost
            ? {
                hiddenIds: forHost.hiddenIds ?? [],
                mutedUserIds: forHost.mutedUserIds ?? [],
              }
            : EMPTY_MUTES,
        )
      })
    } catch {
      // No storage in this context. The reader loses their hide list, which
      // is a nuisance; refusing to render the room would be worse.
    }
    return () => {
      alive = false
    }
  }, [host, adopt])

  const write = useCallback(
    (next: (prev: LocalMutes) => LocalMutes) => {
      const value = next(mutesRef.current)
      adopt(value)
      if (!host) return
      try {
        chrome?.storage?.local?.get(MUTES_KEY, (all) => {
          const map = ((all?.[MUTES_KEY] as MutesByHost | undefined) ??
            {}) as MutesByHost
          map[host] = {
            hiddenIds: value.hiddenIds.slice(-MUTES_CAP),
            mutedUserIds: value.mutedUserIds.slice(-MUTES_CAP),
          }
          chrome?.storage?.local?.set({ [MUTES_KEY]: map })
        })
      } catch {
        // The in-memory copy already took effect, so the reader's press did
        // what they asked for this session; it simply will not survive a
        // reopen.
      }
    },
    [host, adopt],
  )

  const hide = useCallback(
    (id: string) =>
      write((prev) => ({ ...prev, hiddenIds: [...prev.hiddenIds, id] })),
    [write],
  )
  const mute = useCallback(
    (userId: string) =>
      write((prev) => ({
        ...prev,
        mutedUserIds: [...prev.mutedUserIds, userId],
      })),
    [write],
  )

  return { mutes, hide, mute }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIECES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The head: a way back, the room's name, and the count.
 *
 * The hostname ELLIPSIZES rather than wraps. A wrapped hostname breaks mid-
 * label and reads as two different sites; a clipped one still reads as one
 * name with more to it. minWidth:0 is what lets the flex child actually
 * shrink — without it the pill on the right gets pushed off a 320px panel.
 */
function RoomHead({
  host,
  count,
  isMember,
  onBack,
  onLeave,
}: {
  host: string
  count: number | null
  isMember: boolean
  onBack: () => void
  onLeave: () => void
}) {
  const live = typeof count === "number" && count >= 2
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.25,
        py: 1,
        minWidth: 0,
        borderBottom: `1px solid ${JUICE.border}`,
      }}
    >
      <Box
        component="button"
        onClick={onBack}
        aria-label="Back"
        className="click-animation"
        sx={{
          ...PANEL_PILL,
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          color: JUICE.text,
          p: 0,
          flexShrink: 0,
          // Hover PAINTS. No transform, no border-width change, no padding.
          "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
        }}
      >
        <ArrowBackIcon sx={{ fontSize: 16 }} />
      </Box>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: 15,
            fontWeight: 700,
            color: JUICE.text,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={host}
        >
          {host}
        </Typography>
        <Typography sx={{ fontSize: 11, color: FAINT, lineHeight: 1.3 }}>
          Everyone reading this site
        </Typography>
      </Box>

      <Box
        sx={{
          ...PANEL_PILL,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
          height: 26,
          flexShrink: 0,
          fontSize: 12,
          fontWeight: 600,
          color: JUICE.text,
          whiteSpace: "nowrap",
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: "999px",
            backgroundColor: live ? JUICE.green : FAINT,
          }}
        />
        {liveCountLabel(count)}
      </Box>

      {isMember && (
        <Box
          component="button"
          onClick={onLeave}
          sx={{
            ...PANEL_PILL,
            px: 1.25,
            height: 26,
            flexShrink: 0,
            cursor: "pointer",
            font: "inherit",
            fontSize: 12,
            fontWeight: 600,
            color: DIM,
            "&:hover": { color: JUICE.redSoft },
          }}
        >
          Leave
        </Box>
      )}
    </Box>
  )
}

/**
 * A card for every state that is not the room. One shape, so "you can't come
 * in yet", "we couldn't ask" and "this is off" do not each invent their own
 * furniture — and so none of them can accidentally read as an error when it
 * is not one.
 */
function StateCard({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
      }}
    >
      <Box sx={{ ...PANEL_CARD, maxWidth: 300, textAlign: "center" }}>
        <Typography
          sx={{ fontSize: 15, fontWeight: 700, color: JUICE.text, mb: 0.75 }}
        >
          {title}
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: JUICE.text2, lineHeight: 1.5 }}>
          {body}
        </Typography>
        {action && (
          <Box
            component="button"
            onClick={action.onClick}
            className="click-animation"
            sx={{
              mt: 1.5,
              px: 2,
              py: 0.75,
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 13,
              fontWeight: 700,
              color: JUICE.onAccent,
              backgroundColor: ACCENT,
              boxShadow: JUICE.glowRest,
              "&:hover": { backgroundColor: JUICE.accentHi },
            }}
          >
            {action.label}
          </Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * The per-message controls. Opened from a ⋯ that is always present, so the
 * row's geometry never changes on hover — only its paint.
 *
 * THE MENU MIRRORS THE SERVER'S TWO RULES, and it is the same rule seen from
 * both sides: `delete` is author-only and `report` refuses `own_message`. So
 * the reader's own row offers Delete and not Report, and everyone else's
 * offers Report and not Delete. Rendering a control whose answer is a foregone
 * refusal is not "letting the server decide" — it is teaching people that the
 * product's buttons do not mean anything.
 *
 * MUTE GOES WITH REPORT, for a quieter reason: `applyLocalMutes` deliberately
 * never hides the reader's own lines from them, so "Mute this person here" on
 * your own row is a control that does nothing at all.
 *
 * DELETE ASKS TWICE. It is the one irreversible control here and it removes
 * words from every screen in the room, not just this one; a mis-press in a
 * 320px menu should not be able to do that. The second press is the same menu
 * item with different words — no dialog, no new furniture, and nothing outside
 * the popover moves.
 */
function MessageMenu({
  mine,
  onHide,
  onMute,
  onReport,
  onDelete,
}: {
  mine: boolean
  onHide: () => void
  onMute: () => void
  onReport: () => void
  onDelete: () => void
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const close = () => {
    setAnchor(null)
    // Reopening always starts from the safe word. A menu that remembered
    // "really?" from last time would delete on the first press of the next.
    setConfirmingDelete(false)
  }
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <>
      <Box
        component="button"
        aria-label="Message options"
        onClick={(e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
        sx={{
          width: 22,
          height: 22,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          p: 0,
          border: "none",
          borderRadius: "999px",
          background: "transparent",
          cursor: "pointer",
          color: FAINT,
          "&:hover": { color: JUICE.text2 },
        }}
      >
        <MoreHorizIcon sx={{ fontSize: 15 }} />
      </Box>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: JUICE.ground,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "12px",
            },
          },
        }}
      >
        <MenuItem onClick={run(onHide)} sx={{ fontSize: 13, color: JUICE.text }}>
          Hide this message
        </MenuItem>
        {!mine && (
          <MenuItem
            onClick={run(onMute)}
            sx={{ fontSize: 13, color: JUICE.text }}
          >
            Mute this person here
          </MenuItem>
        )}
        {!mine && (
          <MenuItem
            onClick={run(onReport)}
            sx={{ fontSize: 13, color: JUICE.redSoft }}
          >
            Report to Poppin
          </MenuItem>
        )}
        {mine && (
          <MenuItem
            onClick={
              confirmingDelete ? run(onDelete) : () => setConfirmingDelete(true)
            }
            sx={{ fontSize: 13, color: JUICE.redSoft }}
          >
            {confirmingDelete
              ? "Really delete — press again"
              : "Delete for everyone"}
          </MenuItem>
        )}
      </Menu>
    </>
  )
}

/**
 * One line of the transcript.
 *
 * `{m.content}` is a TEXT NODE. A stranger typed this on an arbitrary website
 * and it is stored and served as text (dto/site-chat-events.dto.ts says so
 * over `SiteChatMessage.content`); there is no markup path here and there
 * must never be one.
 *
 * Long content wraps with `overflowWrap: "anywhere"` — a pasted 400-character
 * URL has no spaces to break at, and without this it widens the row and takes
 * the whole panel with it. Long display names ellipsize instead, because a
 * name broken across two lines stops reading as a name.
 */
function MessageRow({
  m,
  mine,
  onHide,
  onMute,
  onReport,
  onDelete,
}: {
  m: LiveChatMessage
  mine: boolean
  onHide: () => void
  onMute: () => void
  onReport: () => void
  onDelete: () => void
}) {
  /**
   * GUARD THE ELEMENT, NOT THE TEXT. `compactAge` returns "" for a missing or
   * unparseable timestamp AND for any negative age (utils/dateUtils.ts,
   * `compactAge`) — which a message posted while the API's clock leads this
   * browser's produces. Rendering it unconditionally would paint the row's
   * 6px gap either side of a box with nothing in it: space reserved for
   * something that rendered empty, which is the one thing the house forbids.
   */
  const age = compactAge(m.createdAt)
  return (
    <Box
      data-message-id={m.id}
      sx={{
        display: "flex",
        gap: 1,
        px: 1.25,
        py: 0.75,
        minWidth: 0,
        // The reader's own line is marked by a hairline in the accent, not by
        // moving it to the other side of the panel: at 320px a right-aligned
        // bubble column costs more width than it explains.
        borderLeft: `2px solid ${mine ? alpha(ACCENT, 0.55) : "transparent"}`,
        "&:hover": { backgroundColor: alpha("#FFFFFF", 0.03) },
      }}
    >
      <CAvatar
        src={m.photoUrl || undefined}
        size="small"
        sx={{ flexShrink: 0, mt: "2px" }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: 0.75,
            minWidth: 0,
          }}
        >
          <Typography
            sx={{
              fontSize: 12.5,
              fontWeight: 700,
              color: mine ? JUICE.accentInk : JUICE.text,
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={m.username ? `@${m.username}` : m.displayName}
          >
            {m.displayName}
          </Typography>
          {age && (
            <Typography
              sx={{
                fontSize: 11,
                color: FAINT,
                flexShrink: 0,
                fontFamily: JUICE.mono,
                letterSpacing: "-.01em",
              }}
            >
              {age}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <MessageMenu
            mine={mine}
            onHide={onHide}
            onMute={onMute}
            onReport={onReport}
            onDelete={onDelete}
          />
        </Box>
        <Typography
          sx={{
            fontSize: 13,
            color: JUICE.text,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {m.content}
        </Typography>
      </Box>
    </Box>
  )
}

/**
 * The composer.
 *
 * The row FITS at 320px rather than sliding: the textarea is the flexible
 * child with minWidth:0, so it gives its width to the button instead of
 * pushing it off the edge. There is no overflowX here and there is no hidden
 * scrollbar — the house already ruled on that pattern twice
 * (components/profile/ProfileFeed.tsx and views/wallet-ui.tsx), and
 * profile-filter-fit.spec.ts enforces it.
 *
 * Enter sends; Shift+Enter is a newline. The counter appears only in the last
 * fifty characters — a number that is always on screen is furniture, and an
 * element that renders empty is not allowed to reserve space.
 */
function Composer({
  disabled,
  sending,
  onSend,
}: {
  disabled: boolean
  sending: boolean
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState("")
  const trimmed = draft.trim()
  const canSend = trimmed.length > 0 && !sending && !disabled

  const submit = () => {
    if (!canSend) return
    onSend(trimmed)
    setDraft("")
  }

  const remaining = LIVE_CHAT_MAX_CHARS - draft.length

  return (
    <Box sx={{ px: 1.25, pb: 1.25, pt: 0.75 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 1,
          minWidth: 0,
          px: 1.25,
          py: 1,
          borderRadius: "14px",
          border: `1px solid ${JUICE.border}`,
          backgroundColor: JUICE.well,
          transition: "border-color .15s ease",
          "&:focus-within": { borderColor: alpha(ACCENT, 0.5) },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, display: "flex" }}>
          <TextareaAutosize
            value={draft}
            disabled={disabled}
            maxLength={LIVE_CHAT_MAX_CHARS}
            minRows={1}
            maxRows={4}
            placeholder="Say something…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              resize: "none",
              color: JUICE.text,
              fontSize: "13px",
              fontFamily: "inherit",
              padding: 0,
              outline: "none",
            }}
          />
        </Box>
        <Box
          component="button"
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="click-animation"
          sx={{
            flexShrink: 0,
            px: 1.5,
            py: "5px",
            borderRadius: "12px",
            border: "none",
            font: "inherit",
            fontSize: 12.5,
            fontWeight: 700,
            cursor: canSend ? "pointer" : "not-allowed",
            color: canSend ? JUICE.onAccent : JUICE.text3,
            backgroundColor: canSend ? ACCENT : JUICE.well,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 26,
            "&:hover": {
              backgroundColor: canSend ? JUICE.accentHi : JUICE.well,
            },
          }}
        >
          {sending ? (
            <CircularProgress size={12} sx={{ color: JUICE.onAccent }} />
          ) : (
            "Send"
          )}
        </Box>
      </Box>
      {/* `remaining` cannot go negative — the textarea's own maxLength caps
          typing AND pasting — so there is no over-limit colour here to
          write; a branch for a state that cannot happen is a comment that
          lies in code. What the last ten characters get instead is amber:
          the wall is real and arriving, and that is worth saying before the
          reader hits it mid-sentence. */}
      {remaining <= 50 && (
        <Typography
          sx={{
            mt: 0.5,
            fontSize: 11,
            textAlign: "right",
            fontFamily: JUICE.mono,
            letterSpacing: "-.01em",
            color: remaining <= 10 ? JUICE.amber : FAINT,
          }}
        >
          {remaining}
        </Typography>
      )}
    </Box>
  )
}

/**
 * What a refusal says out loud.
 *
 * Every branch names something the reader can act on. `not_member` is the one
 * that is not really an error: a membership is a Redis key with a TTL
 * (site-membership.service.ts), so it can lapse under a reader who never
 * left, and the honest answer is "ask to come back in", not "you were
 * kicked".
 *
 * `rate_limited` quotes the server's own retryAfterSeconds rather than
 * guessing, because the limiter's window is the server's to know.
 */
export function noticeText(n: SiteChatNotice): string {
  switch (n.error) {
    case "rate_limited":
      return n.retryAfterSeconds
        ? `Too fast — try again in ${n.retryAfterSeconds}s.`
        : "Too fast — give it a second."
    case "too_long":
      return `That's longer than ${LIVE_CHAT_MAX_CHARS} characters.`
    case "empty":
      return "Nothing to send."
    case "not_member":
      return "Your seat in this room lapsed. Rejoin to keep talking."
    case "signed_out":
      return "You're signed out. Sign in to post."
    case "suspended":
      return "Your account can't post right now."
    case "disabled":
      return "Live chat is off right now."
    case "bad_cursor":
      return "Couldn't load older messages — scroll up again to retry."
    case "not_author":
      // Rendered anyway, though the ⋯ menu offers Delete only on the reader's
      // own row: the server is the judge of "own", and a client that is wrong
      // about `meId` for a frame must not answer a real refusal with "couldn't
      // send that".
      return "That message isn't yours to delete."
    case "not_found":
      // Two different facts share this code, and only the verb separates them.
      // On a delete it means the row is already gone — which is what the
      // reader wanted, so it is not phrased as a failure.
      return n.verb === "delete"
        ? "That message is already gone."
        : "This room isn't available."
    case "bad_host":
      return "This room isn't available."
    case "gate_closed":
      // Reachable only through `join`, which noticeStrip filters out — the
      // gate renders this as a whole screen. Worded anyway so a future verb
      // that can answer it does not fall through to "couldn't send that".
      return "The room isn't open yet."
    case "unavailable":
    default:
      return n.verb === "post"
        ? "Couldn't send that — try again."
        : "Something didn't go through — try again."
  }
}

/**
 * WHAT A REPORT IS ALLOWED TO CLAIM.
 *
 * Pure, and separate from `noticeText`, because a report resolves as a TOAST
 * rather than as a strip and because the success case has words of its own —
 * the only place on this screen where the product makes a promise about what
 * somebody else will do.
 *
 * THE PROMISE IS EXACTLY THE SERVER'S, AND NO WIDER. Read
 * apps/backend/src/site-chat/site-chat-report.service.ts before touching a
 * word of this: `ok: true` means one `feedback` row was written and one email
 * reached a shared inbox. It does NOT mean the message was hidden for anyone
 * else, that the author was touched, that a case exists, or that anybody is on
 * call — that file puts the honest latency at DAYS. So the success line says
 * where it went and who reads it, and explicitly declines to promise speed.
 * "Reported" alone would let a reader infer all four of those.
 *
 * EVERY FAILURE STILL SAYS "HIDDEN FOR YOU", and that is not a consolation
 * line: the caller hides the message locally BEFORE sending, so it is true in
 * every branch, and it is the half the reader actually came for.
 */
export function reportOutcomeText(reply: SiteChatReportReply): {
  text: string
  ok: boolean
} {
  if (reply.ok) {
    return {
      ok: true,
      text: "Hidden for you. Sent to the Poppin team — a person reads that inbox, though not instantly.",
    }
  }
  switch (reply.error) {
    case "own_message":
      // Unreachable from the menu — Report is not offered on the reader's own
      // row — but worded, because "couldn't send that" for this would be a lie
      // about a rule the reader could satisfy.
      return { ok: false, text: "That one's yours. Delete it instead." }
    case "not_found":
      return { ok: false, text: "That message is already gone." }
    case "not_member":
      return {
        ok: false,
        text: "Hidden for you — but your seat lapsed, so nobody was told. Rejoin and try again.",
      }
    case "signed_out":
      return {
        ok: false,
        text: "Hidden for you — sign in to send it to the team.",
      }
    case "rate_limited":
      return {
        ok: false,
        text: reply.retryAfterSeconds
          ? `Hidden for you — too many reports just now. Try again in ${reply.retryAfterSeconds}s.`
          : "Hidden for you — too many reports just now. Give it a second.",
      }
    case "disabled":
    case "bad_host":
    case "unavailable":
    default:
      return {
        ok: false,
        text: "Hidden for you — but the report didn't send. Try again.",
      }
  }
}

/**
 * Which refusals earn a strip.
 *
 * A join refusal already IS the screen: `gate_closed` renders "one more
 * person needs to be here", `disabled` renders the kill-switch card. Putting
 * a red bar under those says the same thing twice in two different moods, and
 * the red one is the wrong mood — being early is not an error.
 */
export function noticeStrip(n: SiteChatNotice | null): SiteChatNotice | null {
  if (!n) return null
  return n.verb === "join" ? null : n
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TRANSCRIPT
// ═══════════════════════════════════════════════════════════════════════════

function Transcript({
  messages,
  meId,
  loadingOlder,
  hasOlder,
  onLoadOlder,
  onHide,
  onMute,
  onReport,
  onDelete,
  alone,
}: {
  messages: readonly LiveChatMessage[]
  meId: string | null
  loadingOlder: boolean
  hasOlder: boolean
  onLoadOlder: () => void
  onHide: (m: LiveChatMessage) => void
  onMute: (m: LiveChatMessage) => void
  onReport: (m: LiveChatMessage) => void
  onDelete: (m: LiveChatMessage) => void
  alone: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  /** Where the reader is, updated on scroll rather than measured on render:
   *  reading it during render would measure the frame we are about to
   *  change. */
  const stickRef = useRef(true)
  /**
   * The transcript's height and its OLDEST ROW'S ID at the moment an older
   * page was asked for, so the anchor compensation has something to measure
   * against and something to recognise.
   *
   * THE ID IS THE KEY, AND SIZE IS NOT, because two different things make
   * this list grow while a history request is in flight and only one of them
   * needs compensating:
   *
   *   an older page arrived  → rows appeared ABOVE the reader. messages[0]
   *                            changes. Give back the height. This is the case.
   *   a live message arrived → one row appeared BELOW the reader. messages[0]
   *                            is untouched. Moving the view here would drag
   *                            somebody reading history down by a line AND
   *                            spend the anchor, so the real page — up to one
   *                            ACK timeout later — would then land with no
   *                            compensation at all and jump by its whole
   *                            height. Keyed on length, that is exactly what
   *                            happened.
   *
   * A history call can also come back with NOTHING new: the very first
   * `loadMore()` re-reads the newest page just to learn a cursor, and every
   * row of it is already on screen (store/useSiteChatStore.ts, `enter()`).
   * messages[0] is unchanged there too, so the same identity test refuses it,
   * and the passive effect below disarms it.
   *
   * `firstId` is null when the anchor was armed against an empty list. There
   * is nothing above a reader looking at nothing, so that anchor can never
   * compensate — it only waits to be disarmed.
   */
  const preserveRef = useRef<{ height: number; firstId: string | null } | null>(
    null,
  )
  /**
   * The oldest row on screen — the anchor's key, because it moves when a page
   * is prepended and stays put when a live message is appended.
   *
   * IT IS NOT ONLY PREPENDS ANY MORE. Deleting the topmost message changes
   * this too, and a deletion is the exact opposite of a prepend: rows left
   * ABOVE the reader rather than arriving there, so compensating for it would
   * scroll the wrong way AND spend the anchor the real page still needs. Hence
   * the `grew > 0` half of the test below — identity says WHICH end changed,
   * length says which DIRECTION, and the anchor needs both.
   */
  const firstId = messages[0]?.id ?? null
  const lastCountRef = useRef(0)
  const [unread, setUnread] = useState(0)

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
    stickRef.current = true
    setUnread(0)
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = isAtBottom(el)
    if (stickRef.current) setUnread(0)
  }, [])

  /**
   * THE ANCHOR, and why it is a layout effect.
   *
   * An older page is PREPENDED, so every pixel of it appears above the
   * reader and the browser leaves scrollTop where it was — which means the
   * content under their eyes jumps down by exactly the height that arrived.
   * Adding that height back has to happen before the browser paints, or the
   * jump is visible for a frame. useLayoutEffect is that "before paint".
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const grew = messages.length - lastCountRef.current
    const wasEmpty = lastCountRef.current === 0

    const anchor = preserveRef.current
    if (
      anchor &&
      anchor.firstId !== null &&
      firstId !== anchor.firstId &&
      // A shrunken list did not put anything above the reader. `message-deleted`
      // for the topmost row changes `firstId` while REMOVING height, so without
      // this the compensation would scroll up by the deleted row and leave the
      // real page, when it lands, with no anchor at all.
      grew > 0
    ) {
      el.scrollTop += el.scrollHeight - anchor.height
      preserveRef.current = null
      lastCountRef.current = messages.length
      return
    }

    // Nothing was prepended, so nothing is compensated — but if an anchor is
    // still armed, the list may have grown BELOW the reader while the older
    // page is in flight. That growth moved the baseline the compensation will
    // be measured against, so re-take it: otherwise the page, when it lands,
    // would give back the prepended height PLUS the live row's, and overshoot
    // by exactly one line.
    if (anchor) preserveRef.current = { ...anchor, height: el.scrollHeight }

    lastCountRef.current = messages.length
    if (grew <= 0) return
    if (wasEmpty || stickRef.current) {
      scrollToBottom(!wasEmpty)
      return
    }
    // Scrolled up and reading. Do not move the view; say what arrived.
    setUnread((n) => n + grew)
  }, [messages, firstId, scrollToBottom])

  /**
   * DISARM AN ANCHOR THAT NOTHING WAS PREPENDED FOR.
   *
   * Passive, so it runs AFTER the layout effect above in the same commit: if
   * an older page did arrive, that effect already spent the anchor and this
   * finds nothing. What it catches is the load that finished without putting
   * anything above the reader — a dead first page, or a request that only
   * live messages answered — so a stale height cannot ambush a later prepend.
   */
  useEffect(() => {
    if (loadingOlder) return
    const anchor = preserveRef.current
    if (!anchor) return
    if (anchor.firstId === null || firstId === anchor.firstId) {
      preserveRef.current = null
    }
  }, [loadingOlder, firstId])

  /** Older pages load when the TOP comes into view — the sentinel is the
   *  first child, which is the half CustomInfiniteScroll's `reverse` does
   *  not do (see the file header). */
  useEffect(() => {
    const root = scrollRef.current
    const target = topSentinelRef.current
    if (!root || !target || !hasOlder || loadingOlder) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        preserveRef.current = { height: root.scrollHeight, firstId }
        onLoadOlder()
      },
      { root, rootMargin: "200px 0px 0px 0px", threshold: 0 },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [hasOlder, loadingOlder, onLoadOlder, firstId])

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
      <Box
        ref={scrollRef}
        onScroll={onScroll}
        sx={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollbarWidth: "thin",
          scrollbarColor: `${alpha("#FFFFFF", 0.18)} transparent`,
        }}
      >
        {hasOlder && <Box ref={topSentinelRef} sx={{ height: 1 }} />}
        {loadingOlder && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
            <CircularProgress size={14} sx={{ color: ACCENT }} />
          </Box>
        )}

        {messages.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              px: 3,
              py: 6,
              textAlign: "center",
            }}
          >
            <Box
              component="img"
              src="/icons/logo.png"
              alt=""
              sx={{ width: 56, height: 56, borderRadius: "50%", opacity: 0.5 }}
            />
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: JUICE.text }}>
              Nobody&apos;s said anything yet.
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: JUICE.text2 }}>
              Start it. Everyone reading this site sees it.
            </Typography>
          </Box>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              m={m}
              mine={m.userId === meId}
              onHide={() => onHide(m)}
              onMute={() => onMute(m)}
              onReport={() => onReport(m)}
              onDelete={() => onDelete(m)}
            />
          ))
        )}

        {/*
          R5, said warmly. A member alone in the room has NOT failed at
          anything and is not being turned away — they are simply the only
          one here, and they stay until they leave. It sits at the bottom of
          the transcript rather than replacing it, because the room and its
          history are still theirs.
        */}
        {alone && (
          <Box sx={{ px: 2, py: 2, textAlign: "center" }}>
            <Typography sx={{ fontSize: 12.5, color: JUICE.text2 }}>
              You&apos;re the only one here right now. Your seat is kept —
              anything you say waits for whoever arrives next.
            </Typography>
          </Box>
        )}
      </Box>

      {unread > 0 && (
        <Box
          component="button"
          onClick={() => scrollToBottom(true)}
          className="click-animation"
          sx={{
            position: "absolute",
            bottom: 10,
            left: "50%",
            transform: "translateX(-50%)",
            ...PANEL_PILL,
            px: 1.5,
            py: "5px",
            cursor: "pointer",
            font: "inherit",
            fontSize: 12,
            fontWeight: 700,
            color: JUICE.onAccent,
            backgroundColor: ACCENT,
            boxShadow: JUICE.glowRest,
            border: "none",
            "&:hover": { backgroundColor: JUICE.accentHi },
          }}
        >
          {unread} new ↓
        </Box>
      )}
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SCREEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The presentational half, given a finished model. Split out so every state
 * below is reachable without a socket, a store or a signed-in user — which is
 * the only way "design every state" is checkable rather than aspirational.
 */
export function LiveChatScreenView({ model }: { model: RoomModel }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { data: currentUser, refetch, handleFirebaseAuth } = useCurrentUser()
  const { mutes, hide, mute } = useLocalMutes(model.host)
  const screen = liveChatScreen(model)
  const strip = noticeStrip(model.notice)

  const back = useCallback(
    () => (window.history.length > 1 ? navigate(-1) : navigate("/")),
    [navigate],
  )

  const refetchCurrentUser = useCallback(() => {
    refetch().then(() => handleFirebaseAuth(currentUser))
  }, [refetch, handleFirebaseAuth, currentUser])

  const visible = useMemo(
    () => applyLocalMutes(dedupeById([...model.messages]), mutes, model.meId),
    [model.messages, mutes, model.meId],
  )

  /**
   * REPORTING NOW GOES DOWN THE SOCKET, TO THE ROW ITSELF.
   *
   * This used to be UserService.sendFeedback with the ids pasted into a free-
   * text body, because the protocol had no report verb and the two report
   * endpoints the product already had (/website-post/:id/report and
   * /comments/:id/report) key on a post id with a foreign key behind it — a
   * chat message id is neither, and filing one there would either fail or
   * attach itself to an unrelated row. The verb exists now
   * (`report { host, messageId, reason? }`), so the report names the message
   * the server can actually find.
   *
   * TWO HALVES, IN THIS ORDER, AND THE ORDER IS THE ARGUMENT:
   *   1. HIDE IT LOCALLY FIRST. That is the half that stops the harm for this
   *      reader, it is instant, and it must not wait on a network call — or on
   *      a moderator.
   *   2. THEN ASK A HUMAN. The toast waits for the answer, because "a person
   *      will look at it" said while the frame is still in the air is a claim
   *      we have not earned, and the one time it is false is the time somebody
   *      needed it to be true.
   *
   * NO `reason` IS SENT. The menu is one press, so there is nothing to put in
   * it; the field is optional on the wire and an empty string would be refused
   * by the schema. A "why?" step is a design decision, not a plumbing one, and
   * the transport already clips a reason when there is one to send.
   */
  const report = useCallback(
    async (m: LiveChatMessage) => {
      hide(m.id)
      const outcome = reportOutcomeText(await model.report(m.id))
      showToast(outcome.text, outcome.ok ? "success" : "warning")
    },
    [hide, model, showToast],
  )

  /**
   * DELETE IS A PRESS AND THEN NOTHING — deliberately.
   *
   * No local hide, no optimistic removal, no toast on success. The row leaves
   * this screen the same way it leaves every other panel in the room: because
   * the server said so, through the store's `forget()`. A local hide here
   * would make the reader's own view disagree with the answer — a refused
   * delete would look like it worked, on the one screen whose owner most needs
   * to know it did not.
   *
   * Failure is not silent: it arrives as a `notice` with verb "delete" and is
   * painted by the strip above the composer, in the reader's words
   * (`noticeText`).
   */
  const deleteOne = useCallback(
    (m: LiveChatMessage) => model.deleteMessage(m.id),
    [model],
  )

  const hideOne = useCallback(
    (m: LiveChatMessage) => {
      hide(m.id)
      showToast("Hidden for you.", "info")
    },
    [hide, showToast],
  )

  const muteOne = useCallback(
    (m: LiveChatMessage) => {
      mute(m.userId)
      showToast(`Muted ${m.displayName} on this site.`, "info")
    },
    [mute, showToast],
  )

  // ── Signed out ───────────────────────────────────────────────────────────
  // The product's own gate, not a second one. views/edit-profile.tsx does the
  // same thing for the same reason: the panel has ONE auth path.
  if (screen === "SIGNED_OUT") {
    // `?? undefined`: useCurrentUser answers `User | null | undefined` and
    // SignInPrompt's prop is optional, not nullable. Null and undefined mean
    // the same thing to it — nobody is signed in — so the widening is a
    // no-op the type system needs spelled out.
    return (
      <SignInPrompt
        refetchCurrentUser={refetchCurrentUser}
        user={currentUser ?? undefined}
      />
    )
  }

  const head = (
    <RoomHead
      host={model.host ?? "this site"}
      count={model.count}
      isMember={screen === "MEMBER"}
      onBack={back}
      onLeave={model.leave}
    />
  )

  const shell = (children: React.ReactNode) => (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </Box>
  )

  // ── The kill switch, seen from the reader's side ─────────────────────────
  // SITE_CHAT_ENABLED is off by default and the routes 404 while it is
  // (apps/backend/src/site-chat/site-chat-enabled.guard.ts). This is what
  // that looks like: a plain sentence, not a broken screen.
  if (screen === "DISABLED") {
    return shell(
      <>
        {head}
        <StateCard
          title="Live chat isn't switched on"
          body="This site's room is closed for now. Nothing is wrong on your end."
        />
      </>,
    )
  }

  if (screen === "NO_PERMISSION") {
    return shell(
      <>
        {head}
        <StateCard
          title="Poppin can't see this page yet"
          body="Live chat needs permission to read the site you're on. Grant it from the banner at the top of the panel and this room opens."
        />
      </>,
    )
  }

  if (screen === "BAD_HOST") {
    return shell(
      <>
        {head}
        <StateCard
          title="No room for this page"
          body="Rooms are keyed to a website. A new tab, a local file or a browser page doesn't have one."
          action={{ label: "Back", onClick: back }}
        />
      </>,
    )
  }

  if (screen === "UNAVAILABLE") {
    return shell(
      <>
        {head}
        <StateCard
          title="Can't reach the room"
          body="We couldn't ask who's here. This is usually brief — try again in a moment."
          action={{ label: "Try again", onClick: model.enter }}
        />
      </>,
    )
  }

  // ── UNKNOWN: no answer yet. Render waiting, never a 0. ───────────────────
  if (screen === "UNKNOWN") {
    return shell(
      <>
        {head}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CircularProgress size={22} sx={{ color: ACCENT }} />
        </Box>
      </>,
    )
  }

  // ── The gate is closed. Never a number, never the word "dead". ───────────
  //
  // THE BUTTON IS R5's RECOVERY, and it is the only one on this screen.
  //
  // Client-side membership lives in exactly one flag — the gate reducer's
  // `member`, written by `join-ok` and by nothing else (helpers/siteChatGate.ts,
  // case "join-ok") — and that flag dies with the panel document: the store is
  // plain zustand with no persistence (store/useSiteChatStore.ts), and the
  // transport re-sends `join` on reconnect only while its own in-memory
  // `joined` flag is alive (helpers/siteChatTransport.ts). So a member who
  // closes the panel while the room is quiet reopens believing they are
  // outside, lands in ALONE, and has nowhere else to ask: the header pill is
  // hidden in this state (helpers/siteChatGate.ts, hidden("ALONE", count)) and
  // RoomHead's Leave button only renders for a member.
  //
  // THE SERVER NEVER LOST THEM. `join` checks membership BEFORE the population
  // and admits without reading it, so one press puts the reader back in the
  // room they never left — which is the eviction R5 exists to forbid, closed
  // by a press rather than by an auto-join. Nothing on this screen joins on
  // mount; `enter` is only ever an onClick, and this is one.
  //
  // For a reader who was never in, the same press is harmless: `join` answers
  // `gate_closed`, the reducer adopts the count and deliberately does NOT
  // touch `member`, and `noticeStrip` filters join refusals out — so this card
  // simply stays, with a fresher number behind it.
  //
  // The durable fix is a read-only membership verb on the gateway, so this
  // screen and the pill could both show MEMBER without a write. It does not
  // exist: every verb the gateway subscribes to is presence, admission,
  // conversation, moderation or credential, and not one of them is a read-only
  // "am I already a member?". Until one is, this button is the whole of it.
  if (screen === "ALONE") {
    return shell(
      <>
        {head}
        <StateCard
          title="One more person needs to be here"
          body="This room opens the moment somebody else is reading this site too. Keep the panel open — you'll see it happen."
          action={{ label: "I was in this room", onClick: model.enter }}
        />
      </>,
    )
  }

  // ── The gate is open and this reader has not come in yet. ────────────────
  if (screen === "OPEN") {
    return shell(
      <>
        {head}
        <StateCard
          title="The room is open"
          body="Other people are reading this site right now. Come in and say something — once you're in, you stay until you leave."
          action={{ label: "Join the chat", onClick: model.enter }}
        />
      </>,
    )
  }

  // ── MEMBER: inside. Whatever the count is. ───────────────────────────────
  const alone = typeof model.count === "number" && model.count < 2

  return shell(
    <>
      {head}

      {/* The socket is down but the SEAT is not: membership is per user and
          survives a dropped connection — the server does not revoke on
          disconnect — site-chat.gateway.ts, `handleDisconnect`. So this says
          "reconnecting", never "you left". */}
      {!model.connected && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            display: "flex",
            alignItems: "center",
            gap: 1,
            backgroundColor: alpha(JUICE.amber, 0.12),
            borderBottom: `1px solid ${alpha(JUICE.amber, 0.28)}`,
          }}
        >
          <CircularProgress size={12} sx={{ color: JUICE.amber }} />
          <Typography sx={{ fontSize: 12, color: JUICE.text2 }}>
            Reconnecting… your seat is kept.
          </Typography>
        </Box>
      )}

      <Transcript
        messages={visible}
        meId={model.meId}
        loadingOlder={model.loadingOlder}
        hasOlder={model.hasOlder}
        onLoadOlder={model.loadOlder}
        onHide={hideOne}
        onMute={muteOne}
        onReport={report}
        onDelete={deleteOne}
        alone={alone}
      />

      {/* The strip WRAPS rather than clipping: at 320px a long sentence plus
          a button does not fit on one line, and flexWrap is the valve the
          house already ruled on for exactly this. */}
      {strip && (
        <Box
          sx={{
            mx: 1.25,
            mb: 0.5,
            px: 1.25,
            py: 0.75,
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            backgroundColor: alpha(JUICE.red, 0.1),
            border: `1px solid ${alpha(JUICE.red, 0.24)}`,
          }}
        >
          <Typography
            sx={{ fontSize: 12, color: JUICE.redSoft, flex: 1, minWidth: 0 }}
          >
            {noticeText(strip)}
          </Typography>
          <Box
            component="button"
            onClick={
              strip.error === "not_member" ? model.enter : model.dismissNotice
            }
            sx={{
              flexShrink: 0,
              px: 1.25,
              py: "3px",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 11.5,
              fontWeight: 700,
              color: JUICE.text,
              backgroundColor: alpha("#FFFFFF", 0.08),
              "&:hover": { backgroundColor: alpha("#FFFFFF", 0.14) },
            }}
          >
            {strip.error === "not_member" ? "Rejoin" : "Dismiss"}
          </Box>
        </Box>
      )}

      <Composer
        disabled={!model.connected}
        sending={model.sending}
        onSend={model.send}
      />
    </>,
  )
}

/**
 * THE ONLY CODE IN THIS FILE THAT KNOWS THE STORE EXISTS.
 *
 * Three deliberate choices, each of which would be a bug the other way:
 *
 * 1. IT CALLS setPage AND NEVER stop(). `setPage` is idempotent — the store
 *    returns early when the host has not changed
 *    (store/useSiteChatStore.ts, `setPage`) — so calling it here is a cheap
 *    guarantee that opening this screen points the feature at the page, no
 *    matter who else did or did not. `stop()` is the opposite: it destroys
 *    the ONE transport for the whole document, which the header's pill is
 *    also reading. Tearing it down when this screen unmounts would silence
 *    the pill everywhere else in the panel — the reader navigates away from
 *    /live-chat far more often than they close the panel.
 *
 *    `stop()` IS CALLED, just not from here: the store binds it to the
 *    document's own `pagehide` (store/useSiteChatStore.ts,
 *    `bindDocumentTeardown`), which is the lifetime the transport was scoped
 *    to in the first place. A route is not that lifetime.
 *
 * 2. IT NEVER AUTO-JOINS. Entering is a press, always. Layout navigates back
 *    to the persisted currentPath on mount, so a reader who was in the chat
 *    lands here without asking; joining on mount would make that a silent
 *    re-admission, which is the client-side gate this whole design refuses.
 *    An existing MEMBER does not need one — the server remembers them.
 *
 * 3. IT LATCHES "no older messages" ITSELF. The store's `nextCursor` is null
 *    both before the first history call and after the last one
 *    (store/useSiteChatStore.ts, `loadMore`), so it cannot answer "is there
 *    more". Asking again at the top of an exhausted room would loop forever against
 *    the server. `exhausted` is set the moment a load returns nothing new AND
 *    still has no cursor, and it is cleared when the host changes.
 */
function useRoomModel(): RoomModel {
  const host = useSiteChatStore((s) => s.host)
  const messages = useSiteChatStore((s) => s.messages)
  const connected = useSiteChatStore((s) => s.connected)
  const sending = useSiteChatStore((s) => s.sending)
  const loadingHistory = useSiteChatStore((s) => s.loadingHistory)
  const notice = useSiteChatStore((s) => s.notice)
  // `tick` is the store's expiry beat: it moves when a count stops being
  // true, and subscribing to it is what makes `view()` below recompute so a
  // stale crowd fades to UNKNOWN instead of lingering on screen.
  useSiteChatStore((s) => s.tick)
  const gateState = useSiteChatStore((s) => s.gate)

  const setPage = useSiteChatStore((s) => s.setPage)
  const enterRoom = useSiteChatStore((s) => s.enter)
  const exitRoom = useSiteChatStore((s) => s.exit)
  const sendMessage = useSiteChatStore((s) => s.send)
  const deleteMessage = useSiteChatStore((s) => s.deleteMessage)
  const reportMessage = useSiteChatStore((s) => s.report)
  const loadMore = useSiteChatStore((s) => s.loadMore)
  const dismissNotice = useSiteChatStore((s) => s.dismissNotice)

  const currentUrl = useCurrentUrlStore((s) => s.currentUrl)
  const { data: currentUser } = useCurrentUser()

  useEffect(() => {
    setPage(currentUrl ?? null)
  }, [currentUrl, setPage])

  /**
   * "We cannot see the page" is a different answer from "this page has no
   * room", and only one of them has a fix the reader can perform. Checked
   * once, and only while there is no host — with a host the question is
   * already answered.
   */
  const [permissionMissing, setPermissionMissing] = useState(false)
  useEffect(() => {
    if (host) {
      setPermissionMissing(false)
      return
    }
    let alive = true
    checkPermissions()
      .then((ok) => alive && setPermissionMissing(!ok))
      .catch(() => {
        // Could not ask. Claiming a missing grant we did not verify would
        // send the reader to a button that changes nothing.
      })
    return () => {
      alive = false
    }
  }, [host])

  const view = siteChatGateView(gateState, Date.now())

  const [exhausted, setExhausted] = useState(false)
  useEffect(() => setExhausted(false), [host])

  const loadOlder = useCallback(() => {
    const before = useSiteChatStore.getState().messages.length
    void loadMore().then(() => {
      const after = useSiteChatStore.getState()
      // Nothing new AND still no cursor: we are at the beginning of the room.
      if (after.messages.length === before && after.nextCursor === null) {
        setExhausted(true)
      }
    })
  }, [loadMore])

  return {
    host,
    gate: view.state,
    reason: view.reason,
    permissionMissing,
    count: view.count,
    messages,
    loadingOlder: loadingHistory,
    hasOlder: !exhausted,
    connected,
    sending,
    notice,
    meId: currentUser?.id ?? null,
    enter: () => void enterRoom(),
    leave: () => void exitRoom(),
    send: (content: string) => void sendMessage(content),
    deleteMessage: (messageId: string) => void deleteMessage(messageId),
    report: reportMessage,
    loadOlder,
    dismissNotice,
  }
}

/**
 * The route's component. Its whole job is to hand the screen a model.
 */
export default function LiveChat() {
  const model = useRoomModel()
  return <LiveChatScreenView model={model} />
}
