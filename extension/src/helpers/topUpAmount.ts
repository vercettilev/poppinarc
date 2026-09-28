/**
 * WHAT A PAGE WALLET IS ASKED TO MOVE, and why the two callers differ.
 *
 * `cover`: the figure is a shortfall or a buy size, rounded up to the next
 *   whole dollar. It used to add one dollar more "in case the price moved",
 *   but a buy is sized in dollars: $26 spends 26 USDC whatever the price
 *   does, so the extra dollar only made three numbers disagree ("Top up
 *   $27" for a $26 buy). Lev, 2026-09-18, seeing $27 and $227.
 * `exact`: the figure is a deposit size the reader chose by pressing "$50".
 *   Asking the wallet for $51 breaks the promise on the button; measured on
 *   2026-09-17, every fund-box pick did exactly that because one rounding
 *   rule served both callers.
 *
 * Both floor at $5, the smallest transfer the funding route builds. The
 * sheet's "Top up $X" label is written from the same function, so the
 * button and the wallet popup name the same number.
 */
export type TopUpMode = "cover" | "exact"

export const TOP_UP_FLOOR_USD = 5

export function topUpAmount(usd: number | undefined, mode: TopUpMode): number {
  const known = typeof usd === "number" && Number.isFinite(usd) && usd > 0
  if (mode === "exact" && known) return Math.max(TOP_UP_FLOOR_USD, Math.ceil(usd))
  return Math.max(TOP_UP_FLOOR_USD, Math.ceil(known ? usd : 10))
}
