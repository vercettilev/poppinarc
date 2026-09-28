/**
 * What a notification SAYS, in one place.
 *
 * ── WHY THIS IS SHARED ──────────────────────────────────────────────────────
 * This vocabulary used to live inside views/notifications.tsx as a switch
 * returning JSX. The card now shows notifications too, and copying the switch
 * would have been the fourth time in one session that a surface kept a private
 * copy of shared formatting: the strip, the side panel, the thread head and
 * the reply row each drifted from the feed that way, and each one was found by
 * the owner noticing two screens disagreeing rather than by a test.
 *
 * So the VERB is shared and the presentation is not. The panel wraps the
 * actor's name in a clickable Typography; the card renders plain text inside a
 * closed shadow root where MUI cannot reach. Those are real differences and
 * they stay local. What "upvote_comment" means to a reader is not a difference
 * and it lives here.
 *
 * The phrasing is unchanged from the panel's, deliberately — this is an
 * extraction, not a rewrite. Anything that reads oddly ("took an action") reads
 * exactly as oddly as it did yesterday, and changing it is its own decision.
 *
 * ── THE LIVE VOCABULARY, MEASURED ───────────────────────────────────────────
 * Every surface used to guess at the type column from what it happened to see
 * in the field, and each guess was wrong somewhere: the chip whitelisted
 * `upvote_cast` — a FLYWHEEL EVENT type that has never once been written to
 * the notifications table — so it dropped every real like; and this file did
 * not know `upvote_reply`, so a liked reply read "took an action" on the
 * panel and the card. The writer is apps/rabbit/src/app.service.ts, and what
 * it inserts is exactly: follow, comment, reply, mention, share, upvote_post,
 * upvote_comment, upvote_reply, post_deleted_by_admin — plus rows from
 * retired products (stream_created, arc_*, group_chat_invitation) that no
 * surface should render. `notificationKind` below is that measurement made
 * code; when the writer's vocabulary changes, this is the one place to teach.
 */

import { GLYPH_LIKE_FILLED, GLYPH_REPLY, glyphMarkup } from "~/components/chipGlyphs"

/**
 * The sentence that FOLLOWS the actor's name: "ada" + " liked your post".
 *
 * Returns the fragment only, never the name, because the two callers disagree
 * about what a name is — one is a button, the other is text.
 */
export function notificationVerb(
  type: string | null | undefined,
  postType?: string | null,
): string {
  const a = postType === "announcement"
  switch (type) {
    case "follow":
      return "followed you"
    case "upvote_post":
    case "upvote":
      return `liked your ${a ? "announcement" : "post"}`
    case "upvote_comment":
      return `liked your ${a ? "announcement comment" : "comment"}`
    case "upvote_ditto":
      return `liked your ${a ? "announcement ditto" : "ditto"}`
    case "upvote_reply":
      return `liked your ${a ? "announcement reply" : "reply"}`
    case "comment":
      return `commented on your ${a ? "announcement" : "post"}`
    case "reply":
      return `replied to your ${a ? "announcement comment" : "comment"}`
    case "share":
      return `shared a ${a ? "announcement" : "post"}`
    case "mention":
      return `mentioned you${a ? " in an announcement" : ""}`
    default:
      return "took an action"
  }
}

/**
 * The one notification nobody DID to you.
 *
 * An admin deletion has no actor worth naming — the panel renders it in red
 * with no name at all — so callers have to know to skip the name rather than
 * print "someone An admin deleted your post".
 */
export function isAuthorlessNotification(type: string | null | undefined): boolean {
  return type === "post_deleted_by_admin"
}

/** The authorless text, for the same reason it is not a verb. */
export const AUTHORLESS_NOTIFICATION_TEXT = "An admin deleted your post"

/**
 * The CLOSED design vocabulary: what a notification looks like, as opposed to
 * what the database called it. Six kinds, each with a glyph, and that is the
 * whole set — the type column spans every era of the product (arc_*,
 * stream_created, group_chat_invitation) and a surface that renders a type it
 * does not recognise renders a door to nowhere.
 */
export type NotificationKind =
  | "follow"
  | "reply"
  | "comment"
  | "mention"
  | "like"
  | "share"

/**
 * DB type → design kind, or null for "do not render this".
 *
 * null is the whitelist working, not an error: the chip drops the row
 * entirely, the panel and card fall back to their own richer handling of
 * authorless/admin rows. Every upvote_* era collapses to "like" because a
 * reader is being told the same thing each time.
 */
export function notificationKind(
  type: string | null | undefined,
): NotificationKind | null {
  switch (type) {
    case "follow":
      return "follow"
    case "reply":
      return "reply"
    case "comment":
      return "comment"
    case "mention":
      return "mention"
    case "share":
      return "share"
    case "upvote_post":
    case "upvote":
    case "upvote_comment":
    case "upvote_ditto":
    case "upvote_reply":
      return "like"
    default:
      return null
  }
}

/**
 * ONE GLYPH PER KIND, drawn once, worn everywhere. The like and reply glyphs
 * are the post row's own, rendered through chipGlyphs' own markup helper so a
 * notification about a like shows the same heart the reader pressed. follow,
 * mention and share are drawn here, on a 12-grid. The strip sets these via
 * innerHTML in its shadow root; React surfaces render them with
 * dangerouslySetInnerHTML — same strings, so the disc a reader learns on one
 * surface is the disc they meet on the next.
 *
 * THE 12 IS NOT DECORATION. Every consumer sizes these discs' svg to 12px in
 * CSS — views/notifications.tsx:151, SpotCard/style.ts:1569 — and the shared
 * glyphs are OUTLINES whose stroke width is computed from the size they will
 * be drawn at. Pass a different number here and the strokes come out at the
 * wrong weight while the drawing still looks correct, which is the kind of
 * wrong nobody spots. If a surface ever renders these at another size, it
 * must ask glyphMarkup for that size rather than scaling this string.
 */
const NOTE_GLYPH_PX = 12
export const NOTIFICATION_GLYPHS: Record<NotificationKind, string> = {
  follow:
    '<svg viewBox="0 0 12 12"><circle cx="4.6" cy="3.6" r="2.1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.2 10.6c.5-2 1.8-3 3.4-3s2.9 1 3.4 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9.4 3.4v3M7.9 4.9h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  reply: glyphMarkup(GLYPH_REPLY, NOTE_GLYPH_PX),
  comment: glyphMarkup(GLYPH_REPLY, NOTE_GLYPH_PX),
  /* Filled, always. This is a REPORT that somebody liked a thing, not a
     control with an unpressed state — an outline here would read as "not
     liked yet" on a row whose whole message is that it was. */
  like: glyphMarkup(GLYPH_LIKE_FILLED, NOTE_GLYPH_PX),
  mention:
    '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 6v.9c0 .9.6 1.4 1.3 1.4 1 0 1.5-.9 1.5-2.3A4.8 4.8 0 1 0 8.6 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  share:
    '<svg viewBox="0 0 12 12"><path d="M2.5 6v4h7V6M6 7.5v-6M3.8 3.6 6 1.4l2.2 2.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

/**
 * The fired-alert bell, on the same 12-ish grid. Lived as a private const
 * inside the strip until the card's Activity band needed it too — and a
 * bell that draws differently per surface is the exact drift this module
 * exists to prevent.
 */
export const BELL_GLYPH =
  '<svg viewBox="0 0 16 16"><path d="M8 2a4 4 0 0 0-4 4v2.2L2.8 10.5a.7.7 0 0 0 .6 1.1h9.2a.7.7 0 0 0 .6-1.1L12 8.2V6a4 4 0 0 0-4-4Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.6 13.4a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'

/**
 * A FILLED STANDING ORDER — a cheque mark inside a circle's worth of
 * meaning: the thing you asked for happened while you were away.
 *
 * A standalone export beside BELL_GLYPH rather than a seventh
 * NotificationKind, deliberately. NotificationKind is a CLOSED vocabulary
 * for the notifications TABLE's type column, and a fill is never a row in
 * it — the extension's own background writes fills to chrome.storage.
 * Adding a kind would force every consumer to carry a case the host
 * whitelist can never emit.
 */
export const FILL_GLYPH =
  '<svg viewBox="0 0 12 12"><path d="M1.6 6.3 4.4 9l6-6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
