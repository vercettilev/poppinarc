/**
 * A price series turned into an SVG polyline — the whole of the chip chart's
 * geometry, kept pure because y-inversion and flat-series division are
 * exactly the two mistakes a canvas hides until somebody's chart draws
 * upside down or vanishes.
 */

export interface SparkGeometry {
  /** "x,y x,y …" for <polyline points>. Empty when there is no line to draw. */
  points: string
  /** Whether the series ends at or above where it began. */
  up: boolean
  min: number
  max: number
}

export function sparkGeometry(
  series: readonly number[] | null | undefined,
  width: number,
  height: number,
  pad = 3,
): SparkGeometry {
  const pts = (series ?? []).filter((v) => Number.isFinite(v))
  if (pts.length < 2 || width <= 0 || height <= 0) {
    return { points: "", up: true, min: 0, max: 0 }
  }

  const min = Math.min(...pts)
  const max = Math.max(...pts)
  // A flat series has zero range; dividing by it draws NaN. A straight line
  // through the middle is what "the price did not move" looks like.
  const span = max - min || 1

  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const step = innerW / (pts.length - 1)

  const points = pts
    .map((v, i) => {
      const x = pad + i * step
      // SVG y grows DOWN, prices grow up — the inversion every first draft
      // of this function gets backwards.
      const y = pad + innerH - ((v - min) / span) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return { points, up: pts[pts.length - 1] >= pts[0], min, max }
}

/**
 * The label a range button wears; single source so UI and tests agree.
 * "1m" is a MONTH — the minute scale left with 15m, which on thin pools
 * drew fifteen points of static; "max" is day candles to GeckoTerminal's
 * hard limit, which for a young pool is simply the pool's whole life,
 * exactly what the label promises. `.toUpperCase()` renders both ("1M",
 * "MAX") without a display map.
 */
export const SPARK_RANGES = ["15m", "1h", "4h", "1d", "1w", "1m", "max"] as const
export type SparkRange = (typeof SPARK_RANGES)[number]

/**
 * THE X AXIS THE API NEVER SENT.
 *
 * The series endpoint answers closes only — but every range has a FIXED
 * candle width (these mirror the backend's GeckoTerminal queries: 15m and
 * 1h are minute candles, 4h is 15-minute, 1d hourly, 1w 4-hourly), so the
 * timestamps are derivable: the last point is "now", and each step walks
 * one candle back. Approximate by up to one candle, which for a footer
 * label and a scrub readout is the difference nobody can see.
 */
export const RANGE_STEP_MS: Record<SparkRange, number> = {
  "15m": 60_000,
  "1h": 60_000,
  "4h": 900_000,
  "1d": 3_600_000,
  "1w": 14_400_000,
  "1m": 86_400_000,
  "max": 86_400_000,
}

/** Timestamps for each point, oldest first, last pinned to `now`. */
export function pointTimes(range: SparkRange, n: number, now: number): number[] {
  const step = RANGE_STEP_MS[range]
  return Array.from({ length: Math.max(0, n) }, (_, i) => now - (n - 1 - i) * step)
}

/**
 * Pointer x → nearest series index. Lives here because it is the same
 * pad-and-step arithmetic sparkGeometry draws with, and the two must never
 * disagree about where point i sits.
 */
export function scrubIndex(
  offsetX: number,
  renderedWidth: number,
  n: number,
  viewWidth = 288,
  pad = 3,
): number {
  if (n < 2 || renderedWidth <= 0) return 0
  const xView = (offsetX * viewWidth) / renderedWidth
  const t = (xView - pad) / (viewWidth - pad * 2)
  return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))))
}

/** Where point i sits in the viewBox — the scrub dot's anchor. */
export function sparkXY(
  series: readonly number[],
  i: number,
  width: number,
  height: number,
  pad = 3,
): { x: number; y: number } {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const x = pad + (i * (width - pad * 2)) / (series.length - 1)
  const y = pad + (height - pad * 2) - ((series[i] - min) / span) * (height - pad * 2)
  return { x, y }
}

/**
 * What a moment is CALLED at each zoom level. Intraday ranges answer with a
 * clock, the day with weekday+clock (its window crosses midnight), the week
 * with a date — each range names time at the resolution it actually has.
 */
export function timeLabel(range: SparkRange, t: number): string {
  const d = new Date(t)
  if (range === "max") {
    // Spans of years: the day is noise at this zoom, the year is not.
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
  }
  if (range === "1w" || range === "1m") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }
  const clock = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  if (range === "1d") {
    return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${clock}`
  }
  return clock
}

/**
 * A trade's moment → its x in the viewBox. The window is [t0, t1]; a
 * timestamp outside it answers null, because a marker for a trade the
 * chart does not cover would float at an edge and lie.
 */
export function timeToX(
  ts: number,
  t0: number,
  t1: number,
  width: number,
  pad = 3,
): number | null {
  if (!(t1 > t0) || ts < t0 || ts > t1) return null
  return pad + ((ts - t0) / (t1 - t0)) * (width - pad * 2)
}

/**
 * A price level → its y in the viewBox, under the SAME domain the line was
 * drawn with. Levels outside the window clamp to the nearest edge and say
 * so — an order far above the chart still deserves a line at the top, as
 * long as its label carries the real number.
 */
export function priceToY(
  series: readonly number[],
  price: number,
  height: number,
  pad = 3,
): { y: number; clamped: boolean } {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const raw = pad + (height - pad * 2) - ((price - min) / span) * (height - pad * 2)
  const lo = pad
  const hi = height - pad
  if (raw < lo) return { y: lo, clamped: true }
  if (raw > hi) return { y: hi, clamped: true }
  return { y: raw, clamped: false }
}

/** One candle's geometry, in the same viewBox units the polyline uses. */
export interface CandleGeometry {
  /** Centre of the body and of the wick. */
  x: number
  /** The wick: high to low. */
  yHigh: number
  yLow: number
  /** The body: top edge and height. Never zero — see below. */
  yBody: number
  hBody: number
  /** Closed at or above where it opened. */
  up: boolean
}

export interface CandlesGeometry {
  candles: CandleGeometry[]
  /** Body width; the wick is drawn as a hairline at x. */
  bodyW: number
  up: boolean
  min: number
  max: number
}

/**
 * OHLC turned into candle geometry.
 *
 * The scale is taken from the HIGHS AND LOWS, not from the closes: a candle
 * chart drawn on a close-derived scale clips its own wicks, which is the
 * first thing that goes wrong in every hand-rolled one.
 *
 * A doji — open equal to close — has zero body height, and a zero-height
 * rect draws nothing at all, so the reader loses the bar entirely on
 * exactly the candles that say "this went nowhere". Every body is at least
 * a hairline.
 *
 * Returns an empty list rather than guessing when the four arrays disagree
 * in length: a high borrowed from the next bucket is a lie about a price.
 */
export function candleGeometry(
  opens: readonly number[] | null | undefined,
  highs: readonly number[] | null | undefined,
  lows: readonly number[] | null | undefined,
  closes: readonly number[] | null | undefined,
  width: number,
  height: number,
  pad = 3,
): CandlesGeometry {
  const empty: CandlesGeometry = { candles: [], bodyW: 0, up: true, min: 0, max: 0 }
  const o = opens ?? []
  const h = highs ?? []
  const l = lows ?? []
  const c = closes ?? []
  const n = c.length
  if (n < 2 || o.length !== n || h.length !== n || l.length !== n) return empty
  if (width <= 0 || height <= 0) return empty
  for (let i = 0; i < n; i++) {
    if (![o[i], h[i], l[i], c[i]].every((v) => Number.isFinite(v))) return empty
  }

  const min = Math.min(...l)
  const max = Math.max(...h)
  const span = max - min || 1

  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const slot = innerW / n
  // Leave a real gap between candles; below a hairline they merge into a
  // block and stop reading as separate periods.
  const bodyW = Math.max(1, slot * 0.62)
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH

  const candles = Array.from({ length: n }, (_, i) => {
    const up = c[i] >= o[i]
    const top = y(Math.max(o[i], c[i]))
    const bottom = y(Math.min(o[i], c[i]))
    return {
      x: pad + slot * (i + 0.5),
      yHigh: y(h[i]),
      yLow: y(l[i]),
      yBody: top,
      hBody: Math.max(1, bottom - top),
      up,
    }
  })

  return { candles, bodyW, up: c[n - 1] >= c[0], min, max }
}
