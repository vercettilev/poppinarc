import { describe, expect, it } from "vitest"
import {
  pointTimes,
  priceToY,
  RANGE_STEP_MS,
  scrubIndex,
  sparkGeometry,
  sparkXY,
  timeLabel,
  timeToX,
} from "./chartMath"

describe("spark geometry", () => {
  it("puts the highest price at the TOP — svg y grows down", () => {
    const g = sparkGeometry([1, 2, 3], 100, 50, 0)
    const ys = g.points.split(" ").map((p) => Number(p.split(",")[1]))
    // Rising series: y must strictly fall.
    expect(ys[0]).toBeGreaterThan(ys[1])
    expect(ys[1]).toBeGreaterThan(ys[2])
    expect(g.up).toBe(true)
  })

  it("calls a falling series down, and an unchanged one up", () => {
    expect(sparkGeometry([3, 2, 1], 100, 50).up).toBe(false)
    expect(sparkGeometry([2, 1, 2], 100, 50).up).toBe(true)
  })

  it("draws a flat series as a line, not as NaN", () => {
    const g = sparkGeometry([5, 5, 5, 5], 100, 50, 0)
    expect(g.points).not.toContain("NaN")
    const ys = new Set(g.points.split(" ").map((p) => p.split(",")[1]))
    expect(ys.size).toBe(1)
  })

  it("spans the full width regardless of point count", () => {
    for (const n of [2, 24, 60]) {
      const series = Array.from({ length: n }, (_, i) => i + 1)
      const g = sparkGeometry(series, 200, 60, 3)
      const xs = g.points.split(" ").map((p) => Number(p.split(",")[0]))
      expect(xs[0]).toBeCloseTo(3, 1)
      expect(xs[xs.length - 1]).toBeCloseTo(197, 1)
    }
  })

  it("refuses to draw what is not a line", () => {
    expect(sparkGeometry(null, 100, 50).points).toBe("")
    expect(sparkGeometry([], 100, 50).points).toBe("")
    expect(sparkGeometry([1], 100, 50).points).toBe("")
    expect(sparkGeometry([1, NaN], 100, 50).points).toBe("")
  })
})

describe("the x axis the API never sent", () => {
  it("pins the last point to now and walks candles back", () => {
    const now = 1_700_000_000_000
    const t = pointTimes("4h", 16, now)
    expect(t).toHaveLength(16)
    expect(t[15]).toBe(now)
    expect(t[14]).toBe(now - RANGE_STEP_MS["4h"])
    expect(t[0]).toBe(now - 15 * RANGE_STEP_MS["4h"])
    // Oldest first, strictly increasing — the same order the closes come in.
    expect([...t].sort((a, b) => a - b)).toEqual(t)
  })

  it("maps pointer x to the nearest index, clamped to the line", () => {
    // 288-wide viewBox rendered at 576px: everything doubles.
    expect(scrubIndex(0, 576, 24)).toBe(0)
    expect(scrubIndex(576, 576, 24)).toBe(23)
    // Past either edge stays on the line instead of indexing off it.
    expect(scrubIndex(-40, 576, 24)).toBe(0)
    expect(scrubIndex(700, 576, 24)).toBe(23)
    // Dead centre of an odd-count series is its middle point.
    expect(scrubIndex(288, 576, 25)).toBe(12)
  })

  it("anchors the dot exactly where the polyline drew the point", () => {
    const series = [1, 3, 2]
    const g = sparkGeometry(series, 288, 72)
    const drawn = g.points.split(" ").map((p) => p.split(",").map(Number))
    for (let i = 0; i < series.length; i++) {
      const { x, y } = sparkXY(series, i, 288, 72)
      expect(x).toBeCloseTo(drawn[i][0], 1)
      expect(y).toBeCloseTo(drawn[i][1], 1)
    }
  })

  it("names time at each range's own resolution", () => {
    const t = Date.UTC(2026, 7, 21, 14, 32)
    // Structural, not literal: the clock renders in the machine's zone.
    expect(timeLabel("1h", t)).toMatch(/^\d{2}:\d{2}$/)
    expect(timeLabel("4h", t)).toMatch(/^\d{2}:\d{2}$/)
    expect(timeLabel("1d", t)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/)
    expect(timeLabel("1w", t)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
    expect(timeLabel("1m", t)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
    // Max spans years, so the year is the information and the day is noise.
    expect(timeLabel("max", t)).toMatch(/^[A-Z][a-z]{2} \d{4}$/)
  })

  it("places a trade at its moment, and refuses moments off the chart", () => {
    // A 100-unit window drawn 288 wide with 3px pads.
    expect(timeToX(0, 0, 100, 288)).toBe(3)
    expect(timeToX(100, 0, 100, 288)).toBe(285)
    expect(timeToX(50, 0, 100, 288)).toBeCloseTo(144, 0)
    // Outside the window is null, not an edge — an edge marker would lie.
    expect(timeToX(-1, 0, 100, 288)).toBeNull()
    expect(timeToX(101, 0, 100, 288)).toBeNull()
    expect(timeToX(5, 5, 5, 288)).toBeNull()
  })

  it("draws a level under the line's own domain, clamped honestly", () => {
    const series = [10, 20]
    // Mid-domain lands mid-chart.
    expect(priceToY(series, 15, 72).y).toBeCloseTo(36, 0)
    expect(priceToY(series, 15, 72).clamped).toBe(false)
    // The domain edges land on the pads.
    expect(priceToY(series, 20, 72)).toEqual({ y: 3, clamped: false })
    expect(priceToY(series, 10, 72)).toEqual({ y: 69, clamped: false })
    // Beyond them clamps to the edge and says so.
    expect(priceToY(series, 99, 72)).toEqual({ y: 3, clamped: true })
    expect(priceToY(series, 1, 72)).toEqual({ y: 69, clamped: true })
  })
})
