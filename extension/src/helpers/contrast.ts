/**
 * WCAG contrast, computed rather than eyeballed.
 *
 * This exists because a design checklist a person reads is a checklist a
 * person forgets. Measured on the shipped stylesheets, four of our own colour
 * pairs were below AA and one was at 1.73:1 — a placeholder nobody could read
 * — while every one of them had passed review by eye more than once.
 *
 * The formula is WCAG 2.1's, unchanged: relative luminance with the sRGB
 * transfer curve, then (lighter + 0.05) / (darker + 0.05).
 */

import { JUICE } from "../theme/juice"

/** Relative luminance of an #rgb or #rrggbb colour, per WCAG 2.1. */
export function luminance(hex: string): number {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) h = [...h].map((c) => c + c).join("")
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`)
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4)
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * WCAG's threshold for a given text size.
 *
 * "Large" is 18.66px at weight 700 or 24px at any weight, and it matters:
 * applying 4.5 to a 21px bold price field would have forced its placeholder
 * as bright as a typed value, which trades one legibility problem for a
 * worse comprehension one.
 */
export function aaThreshold(px: number, bold = false): 3 | 4.5 {
  const large = bold ? px >= 18.66 : px >= 24
  return large ? 3 : 4.5
}

export function meetsAA(fg: string, bg: string, px: number, bold = false): boolean {
  return contrastRatio(fg, bg) >= aaThreshold(px, bold)
}

/**
 * The colour a rule actually declares, read out of the stylesheet.
 *
 * A contrast test that restates its palette in the test file is decorative:
 * change the CSS, forget the test, and it keeps passing. Proved that on the
 * first version of this suite — reverting a shipped colour to the failing one
 * left every assertion green. So the values come from the source, and the
 * test only says which rule and at what size.
 */
export function declaredColor(css: string, selector: string): string {
  // Since the juice pass the source declares theme tokens rather than
  // hexes. Expand them against the real JUICE object BEFORE walking braces:
  // an interpolation carries the very `}` the walk would stop at, and
  // resolving here keeps the original guarantee — change the shipped
  // token's value and this test reads the new colour.
  const tokens: Record<string, unknown> = JUICE
  css = css.replace(/\$\{JUICE\.(\w+)\}/g, (whole, name: string) => {
    const v = tokens[name]
    return typeof v === "string" ? v : whole
  })
  const at = css.indexOf(selector)
  if (at === -1) throw new Error(`no rule for ${selector}`)
  const open = css.indexOf("{", at)
  const close = css.indexOf("}", open)
  if (open === -1 || close === -1) throw new Error(`unterminated rule for ${selector}`)
  const body = css.slice(open + 1, close)
  // `color:` but never `background-color:` / `border-color:`
  const m = /(?:^|[;\s])color:\s*(#[0-9a-fA-F]{3,8})/.exec(body)
  if (!m) throw new Error(`no literal color in ${selector}`)
  return m[1]
}
