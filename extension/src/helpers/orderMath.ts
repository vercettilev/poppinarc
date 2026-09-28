/**
 * The standing-order arithmetic all THREE surfaces share — the panel's trade
 * sheet, the docked card, and the X chip. One source for the same reason
 * tradeMath is one source: two copies of a validation rule is how one surface
 * places an order another surface would have refused.
 *
 * The semantics these rules protect: a trigger order fills at the order's
 * price OR BETTER. That makes exactly two shapes honest —
 *
 *   buy  BELOW market  ("buy the dip")
 *   sell ABOVE market  ("take profit")
 *
 * A buy trigger at or above market is a market order wearing a costume: it
 * fills immediately and the trigger price meant nothing. The backend refuses
 * those too (when its price feed is up); refusing here as well means the
 * user hears it while typing, not after submitting.
 *
 * Stop-losses are NOT offered, on purpose. "Sell when it falls below P"
 * cannot be expressed as price-or-better, and a stop that fills far under
 * its level on a thin book is worse than no stop at all.
 */

/** Jupiter refuses orders under $5; measured, and mirrored in the backend. */
export const MIN_ORDER_USD = 5

export type OrderProblem =
  | "bad_price"
  | "buy_not_below_market"
  | "sell_not_above_market"
  | "below_minimum"

export interface OrderPlan {
  ok: boolean
  problem?: OrderProblem
  /** The sentence a surface can show verbatim. */
  note: string
  /** Signed distance from here to the trigger, vs current. null = no price. */
  distancePct: number | null
}

function distance(
  triggerPriceUsd: number,
  currentPriceUsd: number | null,
): number | null {
  if (currentPriceUsd === null || !(currentPriceUsd > 0)) return null
  return ((triggerPriceUsd - currentPriceUsd) / currentPriceUsd) * 100
}

/**
 * Validate a buy order: spend `amountUsd` when the price reaches the trigger.
 * `currentPriceUsd` null (feed down) skips the direction check — same posture
 * as the backend, which also refuses to let a broken feed block placement.
 */
export function planBuyOrder(
  amountUsd: number,
  triggerPriceUsd: number,
  currentPriceUsd: number | null,
): OrderPlan {
  const distancePct = distance(triggerPriceUsd, currentPriceUsd)
  if (!Number.isFinite(triggerPriceUsd) || triggerPriceUsd <= 0) {
    return { ok: false, problem: "bad_price", note: "Set a price", distancePct }
  }
  if (!(amountUsd >= MIN_ORDER_USD)) {
    return {
      ok: false,
      problem: "below_minimum",
      note: `Orders start at $${MIN_ORDER_USD}`,
      distancePct,
    }
  }
  if (currentPriceUsd !== null && triggerPriceUsd >= currentPriceUsd) {
    return {
      ok: false,
      problem: "buy_not_below_market",
      note: "Already below that — use Buy",
      distancePct,
    }
  }
  return {
    ok: true,
    note:
      distancePct === null
        ? "Fills if the price gets there"
        : `${Math.abs(distancePct).toFixed(1)}% below here`,
    distancePct,
  }
}

/** Validate a sell order: offer the holding at the trigger or better. */
export function planSellOrder(
  holdingUi: number,
  triggerPriceUsd: number,
  currentPriceUsd: number | null,
): OrderPlan {
  const distancePct = distance(triggerPriceUsd, currentPriceUsd)
  if (!Number.isFinite(triggerPriceUsd) || triggerPriceUsd <= 0) {
    return { ok: false, problem: "bad_price", note: "Set a price", distancePct }
  }
  if (holdingUi * triggerPriceUsd < MIN_ORDER_USD) {
    return {
      ok: false,
      problem: "below_minimum",
      note: `Worth less than $${MIN_ORDER_USD} at that price`,
      distancePct,
    }
  }
  if (currentPriceUsd !== null && triggerPriceUsd <= currentPriceUsd) {
    return {
      ok: false,
      problem: "sell_not_above_market",
      note: "Already above that — use Sell",
      distancePct,
    }
  }
  return {
    ok: true,
    note:
      distancePct === null
        ? "Fills if the price gets there"
        : `${Math.abs(distancePct).toFixed(1)}% above here`,
    distancePct,
  }
}

/**
 * What an open order's row says about the price.
 *
 * "8.2% away" while the market has not reached the trigger — unsigned,
 * because the row already says which side it is on.
 *
 * AND SOMETHING ELSE ENTIRELY once it HAS. The first version printed
 * "away" in both cases, using Math.abs on a signed distance, and the
 * field caught it exactly where it hurts: a buy parked at $0.000829 with
 * the market at $0.000809 read "2.0% away" — while the price had gone
 * 2.4% PAST the trigger and the order was sitting there waiting on a
 * keeper. A screen that says "not yet" about something already due is
 * worse than a screen that says nothing; it is why the owner asked
 * whether limit orders work at all.
 *
 * `side` is optional so old callers keep the old sentence; with it, a
 * crossed order says so. The wording promises nothing about WHEN, because
 * we do not control the keeper: Jupiter fills at the pool rate when
 * liquidity is actually there, and a wick that nobody could fill is a
 * documented reason a crossed price still waits.
 */
export function orderDistanceLabel(
  triggerPriceUsd: number,
  currentPriceUsd: number | null,
  side?: "buy" | "sell",
): string | null {
  const d = distance(triggerPriceUsd, currentPriceUsd)
  if (d === null) return null
  if (side && currentPriceUsd !== null) {
    // A buy triggers BELOW the market, a sell ABOVE — so "reached" is the
    // market having moved to the far side of the trigger.
    const reached =
      side === "buy"
        ? currentPriceUsd <= triggerPriceUsd
        : currentPriceUsd >= triggerPriceUsd
    if (reached) return "price reached · waiting to fill"
  }
  return `${Math.abs(d).toFixed(1)}% away`
}

/**
 * A trigger price the way the chip prints prices (xStrip's own rule): more
 * fraction digits the smaller the number, so $0.000197 and $215.66 both read.
 */
export function formatTriggerPrice(usd: number): string {
  return `$${usd.toLocaleString("en-US", {
    maximumFractionDigits: usd < 1 ? 6 : 2,
  })}`
}
