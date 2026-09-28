/**
 * THE WATCHLIST, and the one message a day it earns.
 *
 * Everything this product says so far is triggered by an event: a fill, an
 * alert, somebody you follow buying something. All of it is reactive, and a
 * reader with a quiet book hears nothing for days — which is exactly the
 * reader who forgets the product exists.
 *
 * Two pieces, both here:
 *
 *   THE STAR      an asset somebody is interested in but does not hold. It
 *                 earns the same ±10% move rule holdings already get
 *                 (positionMoves owns that rule; this only decides WHICH
 *                 mints are watched).
 *   THE DIGEST    once a day, in the morning, one line about the book:
 *                 what it is worth and what moved. Not a feed, not a
 *                 summary of the market — the reader's own money, said
 *                 once, at an hour a person is awake.
 *
 * WHY ONCE A DAY AND NOT A STREAK COUNTER. A streak rewards opening the app;
 * this rewards owning something. The first is a slot machine's habit loop
 * and the second is the reason somebody came.
 */

export interface WatchedAsset {
  mint: string
  symbol: string | null
  at: number
}

export const WATCHLIST_KEY = "poppin_watchlist"
export const DIGEST_KEY = "poppin_digest_state"

/** A watchlist longer than this is a feed, and a feed is a different product. */
export const MAX_WATCHED = 24

/** The hour, local, before which a digest is not worth waking anybody for. */
export const DIGEST_HOUR = 9

export function isWatched(list: readonly WatchedAsset[], mint: string): boolean {
  return list.some((w) => w.mint === mint)
}

/**
 * Star or unstar. Returns a NEW list; the caller writes it. Newest first, so
 * the cap drops the oldest interest rather than refusing the newest.
 */
export function toggleWatch(
  list: readonly WatchedAsset[],
  asset: { mint: string; symbol: string | null },
  now: number,
): WatchedAsset[] {
  if (isWatched(list, asset.mint)) {
    return list.filter((w) => w.mint !== asset.mint)
  }
  return [{ mint: asset.mint, symbol: asset.symbol, at: now }, ...list].slice(
    0,
    MAX_WATCHED,
  )
}

export interface DigestState {
  /** Local calendar day of the last digest, "2026-08-24". */
  lastDayKey: string | null
  /** What the book was worth when we last said so. */
  lastTotalUsd: number | null
}

/** Local, not UTC: "today" is the reader's today. */
export function dayKeyOf(now: number): string {
  const d = new Date(now)
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Is a digest due? Morning of a day we have not spoken on.
 *
 * The hour gate is the whole reason this is not a 24h timer: a timer started
 * at install drifts to whatever hour that was, and a notification at 3am is
 * a notification somebody turns off.
 */
export function digestDue(state: DigestState, now: number): boolean {
  if (new Date(now).getHours() < DIGEST_HOUR) return false
  return dayKeyOf(now) !== state.lastDayKey
}

export interface DigestInput {
  /** Positions, priced. Unpriced rows are excluded from the total. */
  holdings: Array<{ symbol: string | null; mint: string; valueUsd: number | null; changePct: number | null }>
  /** Watched assets that are not held, with their day's move. */
  watched: Array<{ symbol: string | null; mint: string; changePct: number | null }>
  state: DigestState
}

export interface Digest {
  title: string
  message: string
  /** What to store so tomorrow can compare against today. */
  nextState: DigestState
}

const ticker = (symbol: string | null, mint: string) =>
  symbol ? (symbol.startsWith("$") ? symbol : `$${symbol}`) : `${mint.slice(0, 4)}…`

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`

const money = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`

/**
 * The words. Null means there is nothing worth waking somebody for — an
 * empty book and an empty watchlist is silence, not a cheerful zero.
 */
export function buildDigest(input: DigestInput, now: number): Digest | null {
  const priced = input.holdings.filter((h) => typeof h.valueUsd === "number")
  const total = priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0)
  const hasBook = priced.length > 0 && total >= 1

  // The biggest move of the day, from either list: holdings first on a tie,
  // because the reader's own money outranks their curiosity.
  const movers = [
    ...input.holdings.map((h) => ({ ...h, held: true })),
    ...input.watched.map((w) => ({ ...w, valueUsd: null, held: false })),
  ].filter((m) => typeof m.changePct === "number")
  movers.sort(
    (a, b) =>
      Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0) ||
      Number(b.held) - Number(a.held),
  )
  const top = movers[0]

  if (!hasBook && !top) return null

  const nextState: DigestState = {
    lastDayKey: dayKeyOf(now),
    lastTotalUsd: hasBook ? total : null,
  }

  if (!hasBook) {
    // Nothing owned, but something watched moved. That is the whole message,
    // and it is honest about which one it is.
    return {
      title: `${ticker(top.symbol, top.mint)} is ${pct(top.changePct ?? 0)} today`,
      message: "On your watchlist. Tap to open it.",
      nextState,
    }
  }

  const prev = input.state.lastTotalUsd
  // Yesterday's number is OUR snapshot, so it is only comparable when there
  // is one. A first digest reports the value and claims no change.
  const delta =
    typeof prev === "number" && prev > 0 ? ((total - prev) / prev) * 100 : null

  return {
    title:
      delta === null
        ? `Your book is ${money(total)}`
        : `Your book is ${money(total)}, ${pct(delta)} since yesterday`,
    message: top
      ? `${ticker(top.symbol, top.mint)} ${pct(top.changePct ?? 0)}${top.held ? "" : " (watching)"}. Tap to open it.`
      : "Tap to open Poppin.",
    nextState,
  }
}

/** The mint a digest's tap should land on, if any. */
export function digestMint(input: DigestInput): string | null {
  const movers = [...input.holdings, ...input.watched].filter(
    (m) => typeof m.changePct === "number",
  )
  if (movers.length === 0) return null
  movers.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
  return movers[0].mint
}
