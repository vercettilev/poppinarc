import { decimalsFor } from "./tradeSheetModel"

/**
 * PRICE ALERTS — the free step before an order.
 *
 * A limit order needs money ($5 floor, escrowed at creation). "Tell me when
 * it gets there" needs nothing, and it is the sentence half of X is already
 * saying under every chart. The alert is the product's cheapest promise:
 * park a number, get tapped on the shoulder, decide THEN.
 *
 * Same architecture as the fill watch, for the same reasons: the pure half
 * lives here under test, the chrome glue stays thin in the background, the
 * schedule is the existing alarm (an alert a minute late is still a tap on
 * the shoulder), and the browser-closed limit is the same — checked on next
 * start, late but never lost.
 */

export interface PriceAlert {
  id: string
  mint: string
  symbol: string | null
  targetUsd: number
  /**
   * Which crossing means "it got there" — derived from where the market
   * stood at CREATION and frozen. Deriving it at fire time instead would
   * let a wobble across the target flip the alert's meaning.
   */
  direction: "above" | "below"
  createdAt: number
}

export const PRICE_ALERTS_KEY = "poppin_price_alerts"
/** Enough for a person, too few for a bot farm. Oldest out beyond it. */
export const ALERTS_CAP = 12

/**
 * An alert, or the reason there is none: a target needs a live market to
 * mean anything. Above it, you are asking about a rise; below, a drop; AT
 * it, you are describing the present, which needs no alarm.
 */
export function makeAlert(args: {
  mint: string
  symbol: string | null
  targetUsd: number
  marketUsd: number | null
  now: number
}): PriceAlert | null {
  const { mint, symbol, targetUsd, marketUsd, now } = args
  if (!Number.isFinite(targetUsd) || targetUsd <= 0) return null
  if (marketUsd === null || !(marketUsd > 0) || targetUsd === marketUsd) return null
  return {
    id: `${mint}:${targetUsd}:${now}`,
    mint,
    symbol,
    targetUsd,
    direction: targetUsd > marketUsd ? "above" : "below",
    createdAt: now,
  }
}

/**
 * Newest last, capped, and the same ask twice is answered once: a duplicate
 * (same mint, direction, and a target within a tenth of a percent) replaces
 * nothing and adds nothing.
 */
export function addAlert(
  existing: PriceAlert[],
  alert: PriceAlert,
  cap = ALERTS_CAP,
): { alerts: PriceAlert[]; added: boolean } {
  const dupe = existing.some(
    (a) =>
      a.mint === alert.mint &&
      a.direction === alert.direction &&
      Math.abs(a.targetUsd - alert.targetUsd) <= alert.targetUsd * 0.001,
  )
  if (dupe) return { alerts: existing, added: false }
  return { alerts: [...existing, alert].slice(-cap), added: true }
}

/**
 * Which alerts their price has reached. `priceOf` answers null for a mint it
 * could not price this tick — those alerts are KEPT, untouched: an alert
 * must never fire off a missing number, and never be lost to one either.
 */
export function alertsDue(
  alerts: PriceAlert[],
  priceOf: (mint: string) => number | null,
): { due: Array<PriceAlert & { atUsd: number }>; kept: PriceAlert[] } {
  const due: Array<PriceAlert & { atUsd: number }> = []
  const kept: PriceAlert[] = []
  for (const a of alerts) {
    const p = priceOf(a.mint)
    if (p === null) {
      kept.push(a)
      continue
    }
    const hit = a.direction === "above" ? p >= a.targetUsd : p <= a.targetUsd
    if (hit) due.push({ ...a, atUsd: p })
    else kept.push(a)
  }
  return { due, kept }
}

function fmtPrice(usd: number): string {
  return usd.toLocaleString("en-US", { maximumFractionDigits: decimalsFor(usd) })
}

/** The words on the notification: the promise, kept, with the number now. */
export function alertNotification(a: PriceAlert & { atUsd: number }): {
  title: string
  message: string
} {
  const name = a.symbol ? `$${a.symbol.replace(/^\$/, "")}` : `${a.mint.slice(0, 4)}…`
  return {
    title: `Price alert: ${name} ${a.direction === "above" ? "reached" : "dropped to"} $${fmtPrice(a.targetUsd)}`,
    message: `Now $${fmtPrice(a.atUsd)}. Tap to open ${name}.`,
  }
}

/**
 * A FIRED ALERT IS NEWS, and news that vanishes is a promise broken twice.
 *
 * Firing used to remove the alert and raise one system toast — which the
 * OS may swallow, the reader may miss, and the product surface never
 * showed at all. So the moment an alert fires it is also written HERE:
 * the row's pill counts the unread ones, and the scoreboard's Activity
 * tab lists them with their fill price. Capped and pruned oldest-first,
 * because news has a shelf life and a bounded key cannot grow into a log.
 */
export interface FiredAlert {
  id: string
  mint: string
  symbol: string | null
  targetUsd: number
  direction: "above" | "below"
  /** The price that crossed the line, at the moment it did. */
  atUsd: number
  firedAt: number
  read: boolean
}

export const FIRED_ALERTS_KEY = "poppin_alerts_fired"
export const FIRED_CAP = 20

export function recordFired(
  existing: FiredAlert[],
  alert: PriceAlert,
  atUsd: number,
  now: number,
): FiredAlert[] {
  const next: FiredAlert[] = [
    ...existing,
    {
      id: `${alert.id}:fired`,
      mint: alert.mint,
      symbol: alert.symbol,
      targetUsd: alert.targetUsd,
      direction: alert.direction,
      atUsd,
      firedAt: now,
      read: false,
    },
  ]
  return next.slice(-FIRED_CAP)
}

export function unreadFired(list: unknown): number {
  if (!Array.isArray(list)) return 0
  return list.filter((f) => f && (f as FiredAlert).read === false).length
}

/**
 * WHAT SIGNING OUT MUST NOT TAKE. The logout handler wipes the extension's
 * local store, which is right for everything that belongs to the session,
 * and wrong for alerts: an alert needs no account, a signed-out reader can
 * set one, and it was being deleted, with its fired history, by "Not you?
 * Switch account" on the welcome page. These keys are read before the wipe
 * and written back after it. Only arrays come back: a key holding anything
 * else is corruption, and corruption does not deserve to survive.
 */
export const LOGOUT_SURVIVORS = [PRICE_ALERTS_KEY, FIRED_ALERTS_KEY] as const

export function survivesLogout(stored: Record<string, unknown> | null | undefined): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const key of LOGOUT_SURVIVORS) {
    const v = stored?.[key]
    if (Array.isArray(v) && v.length > 0) out[key] = v
  }
  return out
}
