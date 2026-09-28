import { describe, expect, it } from "vitest"
import { candleGeometry } from "./chartMath"

/**
 * The two mistakes every hand-rolled candle chart makes, pinned before the
 * renderer exists: a scale taken from closes clips its own wicks, and a
 * doji drawn as a zero-height rect disappears — losing the reader exactly
 * the bars that say "this went nowhere".
 */

const O = [10, 12, 11]
const H = [14, 13, 11]
const L = [9, 10, 10]
const C = [12, 11, 11]

describe("candleGeometry", () => {
  it("scales from the highs and lows, so no wick is clipped", () => {
    const g = candleGeometry(O, H, L, C, 100, 50)
    expect(g.min).toBe(9) // lowest LOW, not lowest close
    expect(g.max).toBe(14) // highest HIGH, not highest close
    for (const c of g.candles) {
      expect(c.yHigh).toBeGreaterThanOrEqual(0)
      expect(c.yLow).toBeLessThanOrEqual(50)
    }
  })

  it("inverts y — prices grow up, SVG grows down", () => {
    const g = candleGeometry(O, H, L, C, 100, 50)
    // The highest price must sit ABOVE the lowest on screen.
    expect(g.candles[0].yHigh).toBeLessThan(g.candles[0].yLow)
  })

  it("gives a doji a body somebody can see", () => {
    // Open equals close: a zero-height rect renders nothing at all.
    const g = candleGeometry([11], [11], [11], [11], 100, 50)
    expect(g.candles).toEqual([]) // one candle is not a chart
    const two = candleGeometry([11, 11], [12, 11], [10, 11], [11, 11], 100, 50)
    expect(two.candles[1].hBody).toBeGreaterThanOrEqual(1)
  })

  it("colours by the candle, not by the series", () => {
    // Bucket 0 closed above its open; bucket 1 closed below. A candle's
    // own direction is the whole point of the view.
    const g = candleGeometry(O, H, L, C, 100, 50)
    expect(g.candles[0].up).toBe(true)
    expect(g.candles[1].up).toBe(false)
  })

  it("leaves a gap, so candles read as separate periods", () => {
    const g = candleGeometry(O, H, L, C, 100, 50)
    const slot = (100 - 6) / 3
    expect(g.bodyW).toBeLessThan(slot)
    expect(g.bodyW).toBeGreaterThan(0)
  })

  it("refuses rather than borrowing a value from the wrong bucket", () => {
    // Arrays that disagree in length are the shape of an older server or a
    // partial read; a high taken from the next bucket is a lie about a
    // price, so nothing is drawn at all.
    expect(candleGeometry([1, 2], [3], [0, 1], [2, 1], 100, 50).candles).toEqual([])
    expect(candleGeometry(null, null, null, C, 100, 50).candles).toEqual([])
    expect(candleGeometry([1, NaN], [2, 2], [0, 0], [1, 1], 100, 50).candles).toEqual([])
  })
})
