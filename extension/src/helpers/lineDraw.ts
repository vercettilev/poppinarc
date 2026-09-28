/**
 * THE LINE ARRIVES LEFT TO RIGHT, the way it was drawn in time.
 *
 * A price line that appears all at once is a picture; a price line that
 * draws itself is the passage it describes. Asked for in exactly those
 * terms — "kuğu gibi zarif" — and it is the cinematic language's own move,
 * so every chart surface says it the same way rather than three ways.
 *
 * THE LENGTH COMES FROM THE GEOMETRY, never from a guessed dasharray. A
 * hardcoded one overshoots on a short line — the draw finishes early and the
 * last stretch snaps in — and undershoots on a long one, where the line
 * never completes at all. ChartFullscreen shipped with `stroke-dasharray:
 * 1600` for exactly that reason and had both failures available to it
 * depending on the range.
 *
 * TWO WEIGHTS, decided by the CALLER, because the rule that governs this
 * tier is about the moment and not about the shape (see cinemaMs in
 * theme/juice.ts). A chart OPENING is rare and consequential: it gets the
 * ceremony. A RANGE CHANGE is a comparison gesture — somebody taps 1H, 4H,
 * 1D in a row to compare them, and a 720ms draw per tap means they never see
 * a finished line — so a switch still draws, but at the everyday duration.
 *
 * The dash pattern is cleared once it has served its purpose: left in place,
 * a later line longer than this one would render with a visible gap.
 */
export function drawLineFromLeft(
  el: SVGGeometryElement | null | undefined,
  ms: number,
  ease: string,
): void {
  if (!el || !(ms > 0)) return
  /* THE BLANKET LIVES HERE, not in the three callers. A movement and the
     rule about when it may not play are one fact, and a caller that forgets
     the second half ships an animation to somebody who asked for none.
     A missing matchMedia counts as "reduce": the contexts without one are
     test environments and embedded documents, neither of which should be
     animating a line it cannot measure anyway. */
  if (
    typeof matchMedia !== "function" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return
  }
  // jsdom implements neither getTotalLength nor layout, so the whole effect
  // is a no-op there rather than a crash. Same for an SVG element that has
  // not been given its points yet.
  const len = dashLength(el)
  if (!(len > 0)) return
  const style = el.style
  style.transition = "none"
  style.strokeDasharray = String(len)
  style.strokeDashoffset = String(len)
  // Read a layout property so the browser commits the start state; without
  // it both assignments land in one frame and nothing moves.
  void (el as unknown as { getBoundingClientRect(): { width: number } })
    .getBoundingClientRect().width
  style.transition = `stroke-dashoffset ${ms}ms ${ease}`
  style.strokeDashoffset = "0"
  setTimeout(() => {
    style.transition = ""
    style.strokeDasharray = ""
    style.strokeDashoffset = ""
  }, ms + 60)
}

/**
 * THE LENGTH, MEASURED IN THE SPACE THE DASHES ACTUALLY LIVE IN.
 *
 * Reported as: the line starts half-drawn and then leaps at the end. That
 * is the exact signature of a dash pattern shorter than the path it is
 * dashing, and the cause is a mismatch of coordinate spaces that both
 * halves of this file were previously blind to.
 *
 * `getTotalLength()` answers in USER units — the viewBox's own numbers. The
 * chip's plot declares `viewBox="0 0 288 72"` and then renders at
 * `width: 100%` with `preserveAspectRatio="none"`, so on a normal timeline
 * those 288 units are stretched to something near twice that in real
 * pixels. That alone would be harmless, because a dash pattern in user
 * units stretches with everything else — except the line also carries
 * `vector-effect: non-scaling-stroke`, which asks for the stroke to be
 * rendered as though the transform were the identity. Dashing is part of
 * the stroke. So the dashes are measured in SCREEN pixels while the length
 * handed to them was measured in user units, the offset is roughly half of
 * what it needs to be, and half the line is visible before the animation
 * has moved at all.
 *
 * So: ask which space this element's dashes are in, and measure in that
 * one. A polyline can be measured exactly by transforming its own points
 * through the screen matrix, which is also immune to whatever the viewBox
 * is doing in either axis.
 */
function dashLength(el: SVGGeometryElement): number {
  /* Wrapped, because getComputedStyle THROWS on anything that is not a real
     Element rather than answering undefined, and this whole function is a
     flourish: it may decline to play, it may not take a chart down with it.
     Not asking means assuming user space, which is the conservative half —
     it is what every surface without the vector effect wants anyway. */
  let screenSpace = false
  try {
    screenSpace =
      typeof getComputedStyle === "function" &&
      getComputedStyle(el as unknown as Element).vectorEffect === "non-scaling-stroke"
  } catch {
    screenSpace = false
  }
  if (screenSpace) {
    const measured = polylineScreenLength(el)
    if (measured > 0) return measured
    // A non-polyline, or a browser that will not hand over the matrix: the
    // user-space answer is wrong but it is the only one available, and a
    // slightly-off draw beats no draw.
  }
  return typeof el.getTotalLength === "function" ? el.getTotalLength() : 0
}

/** Sum of the segment lengths after the element's own screen transform. */
function polylineScreenLength(el: SVGGeometryElement): number {
  const pts = (el as unknown as { points?: SVGPointList }).points
  const m =
    typeof (el as unknown as { getScreenCTM?: () => DOMMatrix | null }).getScreenCTM ===
    "function"
      ? (el as unknown as { getScreenCTM: () => DOMMatrix | null }).getScreenCTM()
      : null
  if (!m || !pts || pts.numberOfItems < 2) return 0
  let total = 0
  let px = 0
  let py = 0
  for (let i = 0; i < pts.numberOfItems; i++) {
    const q = pts.getItem(i)
    const x = m.a * q.x + m.c * q.y + m.e
    const y = m.b * q.x + m.d * q.y + m.f
    if (i > 0) total += Math.hypot(x - px, y - py)
    px = x
    py = y
  }
  return total
}
