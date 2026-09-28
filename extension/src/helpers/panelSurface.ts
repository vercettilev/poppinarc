/**
 * The panel's surface grammar, in one place.
 *
 * The page card settled these values first — the accent, the two verdict
 * colours, the "one step above the ground with the accent whispering in the
 * hairline" block — and every panel surface that wanted to look like the card
 * has been retyping them. That is the same drift that put 1/5/20 in the trade
 * sheet and a flat background in the sidebar: nothing is wrong on the day it
 * is written, and six weeks later two surfaces disagree by four percent of an
 * alpha channel.
 *
 * THE CARD CANNOT IMPORT THIS FILE — it renders in a closed shadow root with
 * its own stylesheet, so its copy lives in SpotCard/style.ts. Same hard
 * boundary BRAND_GROUND documents.
 *
 * WHAT MUST MATCH THE CARD, AND WHAT MUST NOT. The accent, the two verdict
 * colours and the block recipe (radius, padding, the lit hairline) are the
 * same object on both surfaces and must stay byte-identical. THE TWO TEXT
 * TIERS ARE NOT: the card paints white-alpha on its own #0E141D, while the
 * panel paints on BRAND_GROUND — a lighter, blue-cast sweep — where the same
 * alphas measured 4.5:1 and 2.45:1. They are JUICE tokens here for that
 * reason, and re-syncing them to the card's rgba() would reintroduce a
 * measured AA failure. See theme/panel-contrast.spec.ts.
 */

import { JUICE } from "../theme/juice"

/** The one blue. Buy buttons, active states, focus rings, hairlines. */
export const ACCENT = JUICE.accent

/** Apple's greens and reds — up and down, and nothing else. */
export const GREEN = JUICE.green
export const RED = JUICE.red

/**
 * THE TWO QUIET TIERS, MEASURED RATHER THAN EYEBALLED.
 *
 * These were `rgba(255,255,255,.45)` and `rgba(255,255,255,.28)` — neutral
 * white-alpha, which breaks rule 2 ("the grays are blue") and, composited
 * across the twelve combinations theme/panel-contrast.spec.ts sweeps
 * (BRAND_GROUND's three stops × bare/PANEL_CARD/PANEL_ROW/PANEL_PILL),
 * measured 4.16–4.53:1 and 2.45–2.54:1. FAINT was therefore below AA and
 * below even the 3:1 large-text bar, on real prose: the deposit warning that
 * names the network and the token (views/receive.tsx:297) is 11px, at 2.45:1
 * on the panel's base stop.
 *
 * BOTH TIERS ARE text2 TODAY, AND THAT IS DELIBERATE. FAINT's text sites are
 * small — panel-contrast.spec.ts pins the bar at the smallest shipped size,
 * 10.5px, so the threshold is 4.5 — and the fills they sit on are where the
 * next step down fails: JUICE.text3 measures 4.09:1 over PANEL_CARD and
 * 3.85:1 over PANEL_PILL on the ground's lightest stop. So the tertiary tier
 * is carried by SIZE AND WEIGHT until there is a colour that measures; the
 * name is kept because its call sites mean it, and a token that passes can be
 * dropped in here in one line.
 *
 * ONE CONSUMER IS NOT TEXT, AND THE AA ARGUMENT DOES NOT COVER IT.
 * views/live-chat.tsx:543 paints the "not live" status dot with FAINT as a
 * FILL (`live ? JUICE.green : FAINT`, a 6px circle). Moving FAINT off a .28
 * alpha onto an opaque blue gray made that dot brighter than it shipped and
 * closer in weight to the green it is meant to contrast with. It wants a dim
 * token of its own; until it has one, anyone changing FAINT should look at
 * that dot before assuming this token only ever draws letters.
 */
export const DIM = JUICE.text2
/** Tertiary — timestamps, units, the quietest thing on screen. See above:
 *  same value as DIM, one tier down in size/weight, not in colour. */
export const FAINT = JUICE.text2

/**
 * A block that sits ON the ground: one step lighter, with the accent in the
 * hairline so the edge reads as lit rather than drawn.
 */
export const PANEL_CARD = {
  p: "14px",
  borderRadius: "16px",
  backgroundColor: "rgba(255,255,255,.04)",
  border: `1px solid rgba(122,201,255,.20)`,
} as const

/**
 * A row INSIDE a block. Deliberately colder than PANEL_CARD — nesting the
 * accent hairline twice makes a list look like a stack of separate cards.
 */
export const PANEL_ROW = {
  borderRadius: "12px",
  backgroundColor: "rgba(255,255,255,.03)",
  border: "1px solid rgba(255,255,255,.06)",
} as const

/** A tappable pill: the panel's one button shape at rest. */
export const PANEL_PILL = {
  borderRadius: "999px",
  backgroundColor: "rgba(255,255,255,.06)",
  border: "1px solid rgba(255,255,255,.10)",
} as const

/** A signed USD number the way both money surfaces write it. U+2212 for
 *  the minus — the ASCII hyphen is a different, shorter glyph at display
 *  sizes, and the same figure was measured wearing both on two adjacent
 *  surfaces (youPanelView's usdText already mandates the real sign). */
export function signedUsd(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "\u2212" : ""
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Plain USD, no sign. */
export function usd(v: number, maxFrac = 2): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, maxFrac),
    maximumFractionDigits: maxFrac,
  })}`
}
