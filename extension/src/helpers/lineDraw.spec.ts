import { afterEach, describe, expect, it, vi } from "vitest"
import { drawLineFromLeft } from "./lineDraw"

/**
 * Three chart surfaces make this movement — the chip's expanded chart, the
 * token room's inline chart and the full screen — and before this they made
 * it zero, zero and one-with-a-guessed-length. These tests pin the two
 * things that were actually wrong rather than the shape of the animation,
 * which jsdom cannot see: the LENGTH is measured, and the movement carries
 * its own reduced-motion rule so a caller cannot forget it.
 */

type Fake = {
  getTotalLength?: () => number
  getBoundingClientRect: () => { width: number }
  style: Record<string, string>
  points?: unknown
  getScreenCTM?: () => unknown
}
const fakeLine = (len: number | null): Fake => ({
  getTotalLength: len === null ? undefined : () => len,
  getBoundingClientRect: () => ({ width: 100 }),
  style: {} as Record<string, string>,
})

/** A polyline with real points and a stretch matrix, the way the chip's
 *  plot actually renders: 288 viewBox units across a ~560px chip. */
const fakeStretchedPolyline = (xs: number[][], scaleX: number): Fake => ({
  ...fakeLine(0),
  getTotalLength: () => {
    let t = 0
    for (let i = 1; i < xs.length; i++) {
      t += Math.hypot(xs[i][0] - xs[i - 1][0], xs[i][1] - xs[i - 1][1])
    }
    return t
  },
  points: {
    numberOfItems: xs.length,
    getItem: (i: number) => ({ x: xs[i][0], y: xs[i][1] }),
  },
  getScreenCTM: () => ({ a: scaleX, b: 0, c: 0, d: 1, e: 0, f: 0 }),
})

/** vector-effect is what decides which space the dashes are measured in. */
const withVectorEffect = (value: string) => {
  ;(globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({
    vectorEffect: value,
  })
}

type G = { matchMedia?: (q: string) => { matches: boolean } }
const g = globalThis as unknown as G
const motionAllowed = () => {
  g.matchMedia = (q: string) => ({ matches: !q.includes("reduce") }) as never
}
const motionRefused = () => {
  g.matchMedia = () => ({ matches: true }) as never
}

afterEach(() => {
  delete g.matchMedia
  delete (globalThis as unknown as { getComputedStyle?: unknown }).getComputedStyle
  vi.useRealTimers()
})

describe("the left-to-right line draw", () => {
  it("takes its dash length from the line, not from a guess", () => {
    motionAllowed()
    const el = fakeLine(742.5)
    drawLineFromLeft(el as never, 720, "ease")
    // The value it replaced was a hardcoded 1600, which on this line would
    // have finished the draw at 46% and snapped the rest in.
    expect(el.style.strokeDasharray).toBe("742.5")
    expect(el.style.strokeDashoffset).toBe("0")
    expect(el.style.transition).toContain("720ms")
  })

  it("clears the dash pattern once it has served its purpose", () => {
    vi.useFakeTimers()
    motionAllowed()
    const el = fakeLine(300)
    drawLineFromLeft(el as never, 200, "ease")
    expect(el.style.strokeDasharray).toBe("300")
    vi.advanceTimersByTime(400)
    // Left in place, a LATER line longer than this one renders with a gap.
    expect(el.style.strokeDasharray).toBe("")
    expect(el.style.transition).toBe("")
  })

  it("does nothing at all for a reader who asked for less motion", () => {
    motionRefused()
    const el = fakeLine(400)
    drawLineFromLeft(el as never, 720, "ease")
    // The blanket lives in the movement, not in the three callers: a caller
    // that forgets it would ship an animation to somebody who asked for none.
    expect(el.style.strokeDasharray).toBeUndefined()
  })

  it("is a no-op where the length cannot be measured", () => {
    motionAllowed()
    const el = fakeLine(null)
    // jsdom has no getTotalLength. An absent measurement is a skipped
    // flourish, never a crash in a chart somebody is reading.
    expect(() => drawLineFromLeft(el as never, 720, "ease")).not.toThrow()
    expect(el.style.strokeDasharray).toBeUndefined()
  })

  it("skips a zero-length line and a zero duration", () => {
    motionAllowed()
    const empty = fakeLine(0)
    drawLineFromLeft(empty as never, 720, "ease")
    expect(empty.style.strokeDasharray).toBeUndefined()
    const el = fakeLine(400)
    drawLineFromLeft(el as never, 0, "ease")
    expect(el.style.strokeDasharray).toBeUndefined()
  })
})

describe("the space the dash pattern is measured in", () => {
  /*
   * THE REPORTED BUG, in one number. The chip's plot is a 288-unit viewBox
   * stretched across roughly twice that in pixels, and its line carries
   * `vector-effect: non-scaling-stroke`, which asks for the stroke — dashing
   * included — to be rendered as though the transform were the identity.
   * So the dashes live in SCREEN pixels while getTotalLength answers in USER
   * units: the offset came out about half of what it needed to be, half the
   * line was already visible before the animation moved, and the rest closed
   * in a leap. "Ortadan başlıyor ve sona doğru bir anda leap yapıyor."
   */
  const FLAT = [
    [0, 40],
    [100, 30],
    [200, 50],
    [288, 20],
  ]

  it("measures through the screen matrix when the stroke does not scale", () => {
    motionAllowed()
    withVectorEffect("non-scaling-stroke")
    const el = fakeStretchedPolyline(FLAT, 2)
    const user = el.getTotalLength!()
    drawLineFromLeft(el as never, 720, "ease")
    const used = Number(el.style.strokeDasharray)
    // Nearly twice the user-space answer, because x is stretched twice.
    expect(used).toBeGreaterThan(user * 1.7)
    expect(used).toBeLessThan(user * 2.1)
  })

  it("keeps the user-space answer when the stroke scales with the viewBox", () => {
    motionAllowed()
    withVectorEffect("none")
    const el = fakeStretchedPolyline(FLAT, 2)
    // Here the dash pattern is stretched by the same transform as the path,
    // so the two agree and the user-space length is the correct one.
    drawLineFromLeft(el as never, 720, "ease")
    expect(Number(el.style.strokeDasharray)).toBeCloseTo(el.getTotalLength!(), 4)
  })

  it("falls back rather than refusing to draw when no matrix is available", () => {
    motionAllowed()
    withVectorEffect("non-scaling-stroke")
    const el = fakeLine(300)
    // A slightly-off draw beats no draw: the flourish still plays.
    drawLineFromLeft(el as never, 720, "ease")
    expect(el.style.strokeDasharray).toBe("300")
  })
})
