/**
 * WHAT COLOUR IS THE PAGE UNDER US.
 *
 * The chip paints `background: none` and writes in near-white ink, because
 * it was drawn for X and Reddit and both are dark. Borrowing the host's
 * ground is what makes it look like part of the page rather than a box
 * dropped onto it, and that instinct is right — it is the DEFAULT that was
 * wrong. Measured on a CNBC article: white page, white-ish ink, a price
 * nobody could read and buttons that looked bleached.
 *
 * So the ground is a question now instead of an assumption, and the answer
 * is taken from the page itself rather than from a hostname list.
 *
 * UNKNOWN READS AS LIGHT, deliberately. A browser's own default canvas is
 * white, so a chain of transparent ancestors means white in practice. The
 * two failures are not symmetric either: guessing light on a dark page
 * paints a dark ground on a dark page, which is close to invisible, while
 * guessing dark on a light page is exactly the bug this exists to fix.
 */
const OPAQUE_ENOUGH = 0.5

/** sRGB relative luminance, the WCAG definition. */
const luminance = (r: number, g: number, b: number): number => {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function pageIsLight(from: Element | null): boolean {
  let el: Element | null = from
  while (el) {
    let bg = ""
    try {
      bg = getComputedStyle(el).backgroundColor
    } catch {
      // Not an element the engine will style. Keep walking.
    }
    const m = /^rgba?\(([^)]+)\)$/.exec(bg)
    if (m?.[1]) {
      const parts = m[1].split(",").map((n) => Number(n.trim()))
      const [r, g, b] = parts
      const alpha = parts.length > 3 ? parts[3]! : 1
      if (
        alpha >= OPAQUE_ENOUGH &&
        Number.isFinite(r) &&
        Number.isFinite(g) &&
        Number.isFinite(b)
      ) {
        // The first ground solid enough to be what the reader actually sees.
        return luminance(r!, g!, b!) > 0.45
      }
    }
    el = el.parentElement
  }
  return true
}
