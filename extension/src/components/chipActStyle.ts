import { alpha } from "@mui/material"
import { CHIP_GLYPH_SIZE } from "./chipGlyphs"

/**
 * The like/reply chip, as ONE definition.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The trade card and the side panel drew the same two controls with the same
 * intent and different numbers — 10px against 11px, gap 4 against 5, padding
 * 8 against 10, a 14px glyph against an 11px one. None of it was decided;
 * two people wrote the same chip twice and the values drifted. Reported as
 * "the like and reply buttons are still completely different".
 *
 * The card cannot import this. It renders inside a CLOSED shadow root with
 * its own stylesheet and no MUI, so its copy lives in `SpotCard/style.ts`
 * under `.chip-act`. That is a hard boundary, not an oversight — which makes
 * these numbers the thing that has to be kept honest by hand. THEY MUST
 * MATCH `.chip-act`. Change one, change the other, in the same commit.
 *
 * ── WHY THE CARD IS THE SOURCE ──────────────────────────────────────────────
 * It has the harder constraint: 344px of somebody else's page. A control that
 * reads at that size reads anywhere, and the reverse is not true.
 */
export const CHIP_ACT = {
  /** rgba values duplicated from .chip-act rather than themed: the card has
   *  no theme to read, so a token here would only look shared. */
  bg: alpha("#FFFFFF", 0.05),
  bgHover: alpha("#FFFFFF", 0.09),
  border: alpha("#FFFFFF", 0.1),
  borderHover: alpha("#FFFFFF", 0.2),
  fg: alpha("#FFFFFF", 0.62),
  fgHover: "#FFFFFF",
  /** The accent is the product's, and the card hard-codes the same hex. */
  accent: "#68C6FF",
  accentBg: alpha("#68C6FF", 0.12),
  accentBorder: alpha("#68C6FF", 0.4),
  accentBgHover: alpha("#68C6FF", 0.18),
  accentBorderHover: alpha("#68C6FF", 0.55),
  /** Re-exported, not restated. The card draws the same glyphs and cannot
   *  import this file (it pulls in MUI's alpha), so the size has to live
   *  where BOTH can read it — chipGlyphs.ts, which is MUI-free. A second
   *  literal here is the drift this whole file exists to prevent. */
  icon: CHIP_GLYPH_SIZE,
} as const

/** The chip itself. `active` is the pressed/liked state. */
export const chipActSx = (active: boolean) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
  backgroundColor: active ? CHIP_ACT.accentBg : CHIP_ACT.bg,
  border: `1px solid ${active ? CHIP_ACT.accentBorder : CHIP_ACT.border}`,
  color: active ? CHIP_ACT.accent : CHIP_ACT.fg,
  transition: "background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out",
  "&:hover": {
    backgroundColor: active ? CHIP_ACT.accentBgHover : CHIP_ACT.bgHover,
    borderColor: active ? CHIP_ACT.accentBorderHover : CHIP_ACT.borderHover,
    color: active ? CHIP_ACT.accent : CHIP_ACT.fgHover,
  },
})

/**
 * THE SAME CONTROL WITH THE FRAME TAKEN OFF.
 *
 * Reported by the owner against the post row: "make tip and share FRAMELESS
 * and pull them to the RIGHT, next to the timestamp". Four identical pills
 * claimed the four actions were the same kind of thing, and they are not.
 * Like and reply are COUNTERS — you press them and a number moves, and the
 * pill is the thing that says a number lives here. Tip and share are DOORS —
 * they leave the row, they hold no tally, and a pill around them promises a
 * count that will never arrive. So the doors keep the chip's colour and lose
 * its box: no fill, no 1px border, and none of the 4px/10px pill padding.
 *
 * FRAMELESS IS A PAINT INSTRUCTION, NOT A LICENCE TO DELETE THE HIT AREA.
 * The first pass read it as one: with `padding: 0` and `border: 0`, the
 * button's border box became exactly the glyph — a square the size of the
 * icon — where the pill it replaced was wider and taller than that on every
 * side. That is under WCAG 2.2 SC 2.5.8's 24x24 minimum, on the control that
 * opens the dialog that moves money and on the panel's only way to send a
 * post outward. `minWidth`/`minHeight` give the glyph a body without drawing
 * one: transparent and borderless, so there is still nothing on screen to
 * see, and it is the button's OWN box, so the flex row guarantees it cannot
 * overlap the door beside it the way an oversized `::after` pad would.
 *
 * The pill's INSET stays gone, which is a different thing from the hit body:
 * `4px 10px` is asymmetric and sized to hold a NUMBER beside the glyph, and
 * that shape is what says "a count lives here". Neither door holds one.
 *
 * The `component="button"` still arrives with a UA border and ~1px/6px of UA
 * padding — MUI's CssBaseline resets html and body only, never a button — so
 * both are zeroed here rather than assumed.
 *
 * HOVER IS COLOUR ONLY, for two reasons. It cannot move the box (the sweep
 * in post-row-stability.spec.ts reads this file), and a background arriving
 * under the pointer would be the frame the owner asked us to remove, showing
 * up late. `borderRadius` survives with nothing to round because the focus
 * ring follows it, and a keyboard user should see the same shape as the
 * chips beside them.
 *
 * No `active` argument: neither door has a pressed state to carry, and a
 * flag nobody can set is a lie about the control's states. It is a constant
 * rather than a factory for the same reason — and one stable object identity
 * is one fewer sx recalculation per render.
 */
export const chipActBareSx = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  margin: 0,
  border: 0,
  /** The hit body: WCAG 2.2 SC 2.5.8's 24x24, with the glyph centred in it
   *  by the two `center`s above. Nothing is painted into it. The number is a
   *  FLOOR and stays 24 whatever CHIP_GLYPH_SIZE becomes — it is an
   *  accessibility minimum, not a function of the art. */
  minWidth: "24px",
  minHeight: "24px",
  backgroundColor: "transparent",
  borderRadius: "999px",
  lineHeight: 1,
  cursor: "pointer",
  color: CHIP_ACT.fg,
  transition: "color .15s ease-out",
  "&:hover": {
    color: CHIP_ACT.fgHover,
  },
}

/**
 * The count beside the glyph.
 *
 * `fontVariantNumeric` asks for tabular figures — the card asks for the same
 * on every numeric class (SpotCard/style.ts:1201) and the theme asks for it
 * panel-wide (helpers/themeHelper.ts:99) — but it buys less than the line
 * used to claim ("tabular so 9 → 10 does not shift the row"). Two things are
 * wrong with that. Tabular figures equalise digits, not STRINGS, so 9 → 10
 * adds a digit and moves the row whatever the figures do. And PoppinSans is
 * Poppins (helpers/brandFont.ts:32-41), whose GSUB carries no `tnum`
 * feature at all, so with the brand font loaded the request is inert and the
 * figures stay proportional — '1' is 0.362em against '4' at 0.661em. The
 * declaration stays because the fallback stack is real and the card asks for
 * the same thing; what the row cannot do is ASSUME a width from it, which is
 * why post-action-row.spec.ts measures the count out of the font file.
 */
export const chipNumSx = (active: boolean) => ({
  fontSize: "11px",
  fontWeight: 600,
  lineHeight: 1,
  color: active ? CHIP_ACT.accent : "inherit",
  fontVariantNumeric: "tabular-nums",
})
