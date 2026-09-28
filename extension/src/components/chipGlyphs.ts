/**
 * The four post-action glyphs — like, reply, tip, share — as data both
 * surfaces can import.
 *
 * ── WHY DATA AND NOT A COMPONENT ────────────────────────────────────────────
 * The trade card renders inside a CLOSED shadow root with its own stylesheet
 * and no MUI, so it cannot import an icon component, a theme, or anything
 * that reaches for the document. It CAN import a plain module. That is the
 * whole trick: this file must stay free of @mui, of the theme, and of
 * anything that touches `document` — check that before adding an import.
 *
 * A third consumer takes them as raw HTML: helpers/notificationText.ts builds
 * notification rows as strings, which is why `glyphMarkup` exists beside the
 * React path instead of every caller hand-writing an <svg>.
 *
 * ── WHERE THE ART COMES FROM ────────────────────────────────────────────────
 * Owner-supplied SVGs, dropped in as four files (like / comment / share /
 * solana from svgrepo). Their path data is transcribed here VERBATIM. Nobody
 * re-draws a path by hand in this file: hand-editing `d` data is how icons
 * silently acquire kinks, and the one thing we cannot check in a unit test is
 * whether a curve still looks like a heart.
 *
 * What IS ours is the framing, and it has to be, because the four files were
 * drawn to four different conventions:
 *
 *   like     1025 x 1025 box, ink fills it edge to edge
 *   comment    24 x 24  box, ink spans 3..21   (75% of the box)
 *   share      25 x 25  box, ink spans 2..22   (80% of the box)
 *   solana     24 x 24  box, ink spans 5..19   (58% of the box)
 *
 * Drop those into equal squares and you get four icons of visibly different
 * sizes sitting in one row — which is exactly what the owner reported about
 * this row ("iconlarin boyutlarini ve ayni hizada durmalarini duzeltmemiz
 * gerekiyor": fix the icon sizes and their alignment). So each glyph declares
 * the bounding box of its own INK, and `squareBox` below re-frames it to a
 * square in which every glyph's ink occupies the same share. The viewBox
 * numbers are DERIVED, never typed: a magic viewBox string is a number
 * nobody can re-check.
 *
 * ── WHY SOME ARE STROKED AND ALL OF THEM AGREE ON WEIGHT ────────────────────
 * comment and share are outline drawings; like has both states; tip is solid.
 * A stroke declared in the glyph's own units would be a different weight in
 * every one of the four grids above, so `glyphStroke` converts ONE number —
 * CHIP_STROKE_PX, in CSS pixels — into each glyph's units at the size it is
 * actually being drawn. Change the render size and the outlines keep their
 * weight; that is the whole reason the size is a parameter and not a
 * constant baked into the path.
 */

/** Bounding box of a glyph's ink, in that glyph's own drawing units. */
interface Ink {
  x: number
  y: number
  w: number
  h: number
}

/**
 * How much of its square a glyph's ink is allowed to fill.
 *
 * 0.88 for solid shapes. Outline shapes take a smaller CENTRELINE share
 * because their stroke straddles the path and adds half a stroke on every
 * side: 0.80 centreline plus a 1.5px stroke on a 13px box lands at ~0.89
 * visually, which is the same optical size as a solid glyph at 0.88.
 */
const SOLID_SHARE = 0.88
const OUTLINE_SHARE = 0.8

/**
 * The stroke weight of every outlined glyph, in CSS pixels at the size it is
 * drawn. One number, so the row cannot drift into three weights again.
 */
export const CHIP_STROKE_PX = 1.5

/**
 * The size these glyphs are drawn at, in CSS px, and the single source for it.
 *
 * It lives HERE rather than in chipActStyle.ts because the card cannot import
 * that file (it pulls in @mui's `alpha`), and the card draws the same glyphs.
 * chipActStyle re-exports it as CHIP_ACT.icon so the panel has one name for
 * it; SpotCard.tsx and Conversation.tsx read it directly.
 *
 * 13, not the 11 the solid-only set used. Outline glyphs carry less ink than
 * solid ones at the same box, and at 11px the comment bubble's stroke was
 * thinner than the hairline of the chip's own border.
 */
export const CHIP_GLYPH_SIZE = 13

export interface ChipGlyph {
  /** Square viewBox, derived by squareBox() — never hand-written. */
  viewBox: string
  /** Side of that square in the glyph's units; what converts px to units. */
  unit: number
  /** Subpaths, verbatim from the source file. */
  d: readonly string[]
  paint: "fill" | "stroke"
  /** Only meaningful when paint is "fill". */
  fillRule?: "evenodd" | "nonzero"
}

/**
 * Re-frame a glyph so its ink sits centred in a square and fills `share` of
 * it. Everything about a glyph's apparent size and centring comes from here.
 */
function squareBox(ink: Ink, share: number): { viewBox: string; unit: number } {
  const unit = Math.max(ink.w, ink.h) / share
  const cx = ink.x + ink.w / 2
  const cy = ink.y + ink.h / 2
  const round = (n: number) => Number(n.toFixed(3))
  return {
    viewBox: [round(cx - unit / 2), round(cy - unit / 2), round(unit), round(unit)].join(" "),
    unit,
  }
}

function glyph(ink: Ink, d: readonly string[], paint: "fill" | "stroke", fillRule?: "evenodd"): ChipGlyph {
  const box = squareBox(ink, paint === "stroke" ? OUTLINE_SHARE : SOLID_SHARE)
  return { viewBox: box.viewBox, unit: box.unit, d, paint, fillRule }
}

/** Stroke width for `g` in ITS units, so it draws CHIP_STROKE_PX on screen. */
export function glyphStroke(g: ChipGlyph, sizePx: number): number {
  return Number(((CHIP_STROKE_PX * g.unit) / sizePx).toFixed(4))
}

// ── like ────────────────────────────────────────────────────────────────────
/**
 * The heart's outer contour, from the owner's like SVG. The source file draws
 * an outline by tracing this contour and then a second, smaller heart inside
 * it as a hole; that inner subpath is deliberately NOT carried here.
 *
 * Two reasons. The ring it produces measures 85.5 of 1025 units — about
 * 0.95px once this glyph is 13px wide — against the 1.5px stroke every other
 * outline in the row draws, so the set would have arrived with the heart a
 * third lighter than its neighbours. And the empty and full states have to be
 * the SAME heart, or the glyph changes silhouette the instant you press it.
 * Stroking and filling one contour gives both states from one shape and one
 * weight; keeping the artist's ring would have given neither.
 */
const HEART_OUTLINE =
  "M512.8 977.4c-26.1 0-50.1-7.3-71.5-21.7C323.5 897 0 675.3 0 400.5 0 212 153.4 58.6 341.9 58.6c60.5 0 119 15.8 170.9 45.9 51.9-30.1 110.5-45.9 170.9-45.9 188.5 0 341.9 153.4 341.9 341.9 0 274.8-323.5 496.6-441.3 555.2-21.4 14.4-45.4 21.7-71.5 21.7z"

/** The heart's ink: full width of the 1025 box, top of the lobes to the point. */
const HEART_INK: Ink = { x: 0, y: 58.6, w: 1025.7, h: 918.8 }

/** Not liked yet: the outline. */
export const GLYPH_LIKE_OUTLINE = glyph(HEART_INK, [HEART_OUTLINE], "stroke")
/** Liked: the same contour, filled. Identical silhouette, so nothing jumps. */
export const GLYPH_LIKE_FILLED = glyph(HEART_INK, [HEART_OUTLINE], "fill")

// ── reply ───────────────────────────────────────────────────────────────────
/**
 * A round speech bubble with a tail, from the owner's comment SVG. The source
 * draws it as an open stroke with round caps and joins, which is preserved:
 * the tail's corner is the only place this shape has a visible join, and a
 * mitred one at 13px reads as a burr.
 */
export const GLYPH_REPLY = glyph(
  { x: 3, y: 3, w: 18, h: 18 },
  [
    "M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 13.4876 3.36093 14.891 4 16.1272L3 21L7.8728 20C9.10904 20.6391 10.5124 21 12 21Z",
  ],
  "stroke"
)

// ── share ───────────────────────────────────────────────────────────────────
/**
 * The owner's share SVG: a comet leaving a trail. Wider than it is tall
 * (20 x 15.94), so squareBox frames it on its WIDTH and it keeps its
 * proportions rather than being stretched square.
 */
export const GLYPH_SHARE = glyph(
  { x: 2, y: 4.14, w: 20, h: 15.94 },
  [
    "M13.47 4.13998C12.74 4.35998 12.28 5.96 12.09 7.91C6.77997 7.91 2 13.4802 2 20.0802C4.19 14.0802 8.99995 12.45 12.14 12.45C12.34 14.21 12.79 15.6202 13.47 15.8202C15.57 16.4302 22 12.4401 22 9.98006C22 7.52006 15.57 3.52998 13.47 4.13998Z",
  ],
  "stroke"
)

// ── tip ─────────────────────────────────────────────────────────────────────
/**
 * Solana's three bars, from the owner's solana SVG — the chain the tip is
 * actually paid on.
 *
 * SOLID, where the source file is outlined. Each of its three paths is an
 * outer parallelogram followed by an inner one that hollows it out, and those
 * walls measure roughly one unit of 24: about half a pixel at this size, i.e.
 * three grey smears where three bars should be. Only the outer subpath of
 * each is carried, which fills them. The contours are the artist's, untouched.
 */
export const GLYPH_TIP = glyph(
  { x: 5, y: 5, w: 14, h: 14 },
  [
    "M7.08398 5.22265C7.17671 5.08355 7.33282 5 7.5 5H18.5C18.6844 5 18.8538 5.10149 18.9408 5.26407C19.0278 5.42665 19.0183 5.62392 18.916 5.77735L16.916 8.77735C16.8233 8.91645 16.6672 9 16.5 9H5.5C5.3156 9 5.14617 8.89851 5.05916 8.73593C4.97215 8.57335 4.98169 8.37608 5.08398 8.22265L7.08398 5.22265Z",
    "M7.08398 13.7774C7.17671 13.9164 7.33282 14 7.5 14H18.5C18.6844 14 18.8538 13.8985 18.9408 13.7359C19.0278 13.5733 19.0183 13.3761 18.916 13.2226L16.916 10.2226C16.8233 10.0836 16.6672 10 16.5 10H5.5C5.3156 10 5.14617 10.1015 5.05916 10.2641C4.97215 10.4267 4.98169 10.6239 5.08398 10.7774L7.08398 13.7774Z",
    "M7.08398 15.2226C7.17671 15.0836 7.33282 15 7.5 15H18.5C18.6844 15 18.8538 15.1015 18.9408 15.2641C19.0278 15.4267 19.0183 15.6239 18.916 15.7774L16.916 18.7774C16.8233 18.9164 16.6672 19 16.5 19H5.5C5.3156 19 5.14617 18.8985 5.05916 18.7359C4.97215 18.5734 4.98169 18.3761 5.08398 18.2226L7.08398 15.2226Z",
  ],
  "fill"
)

/**
 * The glyph as an HTML string, for the one caller that cannot render React
 * (helpers/notificationText.ts). Same geometry as the React path — both go
 * through the same descriptor, which is the point of having one.
 */
export function glyphMarkup(g: ChipGlyph, sizePx: number = CHIP_GLYPH_SIZE): string {
  const paint =
    g.paint === "stroke"
      ? 'fill="none" stroke="currentColor" stroke-width="' +
        glyphStroke(g, sizePx) +
        '" stroke-linecap="round" stroke-linejoin="round"'
      : 'fill="currentColor"' + (g.fillRule ? ' fill-rule="' + g.fillRule + '"' : "")
  return (
    '<svg viewBox="' +
    g.viewBox +
    '" width="' +
    sizePx +
    '" height="' +
    sizePx +
    '" aria-hidden="true" focusable="false">' +
    g.d.map((d) => "<path " + paint + ' d="' + d + '"/>').join("") +
    "</svg>"
  )
}
