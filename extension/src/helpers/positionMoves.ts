import { decimalsFor } from "./tradeSheetModel"

/**
 * "YOUR $WIF IS UP 12% TODAY" — the strongest come-back signal a portfolio
 * product owns, and until now this one never said it. The reader holds a
 * position, the market moves it, and the product that knows both stays
 * silent unless they think to open it.
 *
 * Same architecture as the fill watch and the price alerts, deliberately:
 * pure half here under test, thin chrome glue on the SAME alarm tick, the
 * same OS notification with the mint riding the id's last segment, the same
 * browser-closed limit (checked on next start, late but never lost).
 *
 * ── THE ANCHOR RULE ────────────────────────────────────────────────────────
 * Each held mint keeps an ANCHOR price in storage. First sighting seeds the
 * anchor silently. A move of ±10% from the anchor fires ONE notification and
 * re-anchors at the current price — so a 20% run says something at 10% and
 * again at 21%, a flat day says nothing, and there is no timer-based
 * cooldown to tune because the re-anchor IS the cooldown: the next word is
 * earned by the next ten percent, not by the clock.
 *
 * Dust is filtered: a $0.40 position moving 12% is four cents, and a
 * notification about four cents teaches the reader to ignore notifications.
 */

export interface HeldPosition {
  mint: string
  symbol: string | null
  uiAmount: number
  priceUsd: number | null
  valueUsd: number | null
}

export interface PositionMark {
  usd: number
  at: number
}

export const POSITION_MARKS_KEY = "poppin_position_marks"
/** The move that earns a word. */
export const MOVE_THRESHOLD_PCT = 10
/** Below this the move is pocket lint, whatever the percentage. */
export const MOVE_MIN_VALUE_USD = 1

export interface PositionMove {
  mint: string
  symbol: string | null
  /** Signed percent from the anchor, e.g. +12.4 */
  pct: number
  nowUsd: number
  valueUsd: number
}

/**
 * One tick: which held positions moved past the threshold from their anchor,
 * and the next anchor map.
 *
 * Rules, in the order they protect the reader:
 *   · a mint with no anchor is SEEDED, never announced — a fresh install
 *     must not greet its reader with a wall of "up 40%" about moves that
 *     happened before the product was watching.
 *   · a null price keeps the anchor untouched: no firing off a missing
 *     number, no losing the anchor to one.
 *   · a mint no longer held loses its anchor, so re-buying later seeds
 *     fresh rather than comparing against a price from another life.
 */
export function positionMoves(args: {
  positions: HeldPosition[]
  marks: Record<string, PositionMark>
  now: number
}): { moves: PositionMove[]; nextMarks: Record<string, PositionMark> } {
  const { positions, marks, now } = args
  const moves: PositionMove[] = []
  const nextMarks: Record<string, PositionMark> = {}

  for (const p of positions) {
    if (p.priceUsd === null || !(p.priceUsd > 0)) {
      // Unpriced this tick: carry the old anchor forward untouched.
      if (marks[p.mint]) nextMarks[p.mint] = marks[p.mint]
      continue
    }
    const prev = marks[p.mint]
    if (!prev) {
      nextMarks[p.mint] = { usd: p.priceUsd, at: now }
      continue
    }
    const pct = ((p.priceUsd - prev.usd) / prev.usd) * 100
    const worth = p.valueUsd ?? p.uiAmount * p.priceUsd
    if (Math.abs(pct) >= MOVE_THRESHOLD_PCT && worth >= MOVE_MIN_VALUE_USD) {
      moves.push({
        mint: p.mint,
        symbol: p.symbol,
        pct,
        nowUsd: p.priceUsd,
        valueUsd: worth,
      })
      // The re-anchor IS the cooldown: the next word costs another 10%.
      nextMarks[p.mint] = { usd: p.priceUsd, at: now }
    } else {
      nextMarks[p.mint] = prev
    }
  }
  return { moves, nextMarks }
}

function fmtPrice(usd: number): string {
  return usd.toLocaleString("en-US", { maximumFractionDigits: decimalsFor(usd) })
}

/** The words: the direction first, the numbers second, the door last. */
export function moveNotification(m: PositionMove): { title: string; message: string } {
  const name = m.symbol ? `$${m.symbol.replace(/^\$/, "")}` : `${m.mint.slice(0, 4)}…`
  const sign = m.pct > 0 ? "+" : ""
  return {
    title: `Your ${name} is ${m.pct > 0 ? "up" : "down"} ${sign}${m.pct.toFixed(1)}%`,
    message: `Now $${fmtPrice(m.nowUsd)}, your position is $${m.valueUsd.toLocaleString(
      "en-US",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    )}. Tap to open ${name}.`,
  }
}
