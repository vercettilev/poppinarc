import { ChipGlyph, CHIP_GLYPH_SIZE, glyphStroke } from "./chipGlyphs"

/**
 * One post-action glyph, drawn the same way on every surface that has React.
 *
 * ── WHY A COMPONENT NOW, WHEN chipGlyphs.ts SAYS "DATA, NOT A COMPONENT" ────
 * That header's rule is about DEPENDENCIES, not about JSX: the trade card
 * lives in a closed shadow root with no MUI and no document access, so it
 * cannot import an icon that reaches for a theme. It renders React perfectly
 * well. This file imports nothing but the glyph data, so the card may use it,
 * and Conversation.tsx / SpotCard.tsx do.
 *
 * It exists because the glyphs stopped being one-liners. Half of them are
 * outlines now, and an outline needs fill:none, stroke:currentColor, round
 * caps and joins, and a stroke width converted from CSS pixels into that
 * glyph's own units — six props that five call sites were about to copy, and
 * that a sixth would have copied slightly wrong. The size is threaded through
 * to glyphStroke rather than assumed, so a caller drawing at a different size
 * still gets CHIP_STROKE_PX of stroke on screen.
 */
export function ChipGlyphIcon({
  glyph,
  size = CHIP_GLYPH_SIZE,
  className,
}: {
  glyph: ChipGlyph
  size?: number
  className?: string
}) {
  const stroked = glyph.paint === "stroke"
  return (
    <svg
      viewBox={glyph.viewBox}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      /* `block` kills the inline-baseline gap under an svg; `flex: none` stops
         a narrow row from shrinking a square into a rectangle. Both were being
         restated at every call site, one of which forgot the second. */
      style={{ display: "block", flex: "none" }}
    >
      {glyph.d.map((d) => (
        <path
          key={d}
          d={d}
          fill={stroked ? "none" : "currentColor"}
          fillRule={stroked ? undefined : glyph.fillRule}
          stroke={stroked ? "currentColor" : undefined}
          strokeWidth={stroked ? glyphStroke(glyph, size) : undefined}
          strokeLinecap={stroked ? "round" : undefined}
          strokeLinejoin={stroked ? "round" : undefined}
        />
      ))}
    </svg>
  )
}
