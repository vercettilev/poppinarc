import { describe, expect, it } from "vitest"
import {
  MIN_ORDER_USD,
  formatTriggerPrice,
  orderDistanceLabel,
  planBuyOrder,
  planSellOrder,
} from "./orderMath"

/**
 * The one rulebook all three order surfaces read. The interesting rows are
 * the boundaries: AT market is refused in both directions (price-or-better
 * makes "at market" a market order), and a dead price feed skips the
 * direction check instead of blocking the order — the backend holds the same
 * posture, measured while its own feed was down.
 */
describe("planBuyOrder", () => {
  it("accepts a dip buy and says how far the dip is", () => {
    const p = planBuyOrder(25, 0.18, 0.2)
    expect(p.ok).toBe(true)
    expect(p.note).toBe("10.0% below here")
    expect(p.distancePct).toBeCloseTo(-10)
  })

  it.each([0.2, 0.25])("refuses a trigger at or above market (%p)", (t) => {
    const p = planBuyOrder(25, t, 0.2)
    expect(p.ok).toBe(false)
    expect(p.problem).toBe("buy_not_below_market")
  })

  it("holds Jupiter's $5 floor with a plain sentence", () => {
    const p = planBuyOrder(MIN_ORDER_USD - 1, 0.18, 0.2)
    expect(p.ok).toBe(false)
    expect(p.problem).toBe("below_minimum")
  })

  it("skips the direction check when the feed is down, and says so", () => {
    const p = planBuyOrder(25, 999, null)
    expect(p.ok).toBe(true)
    expect(p.note).toBe("Fills if the price gets there")
    expect(p.distancePct).toBeNull()
  })

  it.each([0, -1, NaN, Infinity])("refuses %p as a price", (t) => {
    expect(planBuyOrder(25, t as number, 0.2).ok).toBe(false)
  })
})

describe("planSellOrder", () => {
  it("accepts a take-profit above market", () => {
    const p = planSellOrder(1000, 0.24, 0.2)
    expect(p.ok).toBe(true)
    expect(p.note).toBe("20.0% above here")
  })

  it.each([0.2, 0.15])("refuses a trigger at or below market (%p)", (t) => {
    const p = planSellOrder(1000, t, 0.2)
    expect(p.ok).toBe(false)
    expect(p.problem).toBe("sell_not_above_market")
  })

  it("values the floor AT THE TRIGGER, not at market", () => {
    // 20 units at a $0.30 trigger = $6 — fine even though it is $4 here.
    expect(planSellOrder(20, 0.3, 0.2).ok).toBe(true)
    // 10 units at $0.30 = $3 — under the floor.
    const p = planSellOrder(10, 0.3, 0.2)
    expect(p.ok).toBe(false)
    expect(p.problem).toBe("below_minimum")
  })
})

describe("labels", () => {
  it("prints distance unsigned — the row already names the side", () => {
    expect(orderDistanceLabel(0.18, 0.2)).toBe("10.0% away")
    expect(orderDistanceLabel(0.24, 0.2)).toBe("20.0% away")
    expect(orderDistanceLabel(0.18, null)).toBeNull()
  })

  it("prints small and large prices the way the chip does", () => {
    expect(formatTriggerPrice(0.000197)).toBe("$0.000197")
    expect(formatTriggerPrice(215.66)).toBe("$215.66")
  })
})

/**
 * THE LABEL THAT SAID "NOT YET" ABOUT SOMETHING ALREADY DUE.
 *
 * Measured live 2026-08-30: a buy parked at $0.000829 with $PANTS trading
 * at $0.0008096 — the market 2.4% PAST the trigger — and the row read
 * "2.0% away", because the distance was taken through Math.abs and the
 * sentence never knew which side it was on. That one word is why the
 * owner asked whether limit orders work at all.
 */
describe("what an open order's row says about the price", () => {
  it("says the price is reached once a BUY's market falls to the trigger", () => {
    expect(orderDistanceLabel(0.000829, 0.0008096, "buy")).toBe(
      "price reached · waiting to fill",
    )
    // Exactly at the trigger counts as reached — a keeper may fill there.
    expect(orderDistanceLabel(0.000829, 0.000829, "buy")).toBe(
      "price reached · waiting to fill",
    )
  })

  it("says the price is reached once a SELL's market rises to the trigger", () => {
    expect(orderDistanceLabel(0.2, 0.25, "sell")).toBe(
      "price reached · waiting to fill",
    )
  })

  it("still counts the distance while the market has not got there", () => {
    expect(orderDistanceLabel(0.0005, 0.001, "buy")).toBe("50.0% away")
    expect(orderDistanceLabel(0.25, 0.2, "sell")).toBe("25.0% away")
  })

  it("keeps the old sentence when nobody says which side it is", () => {
    // Callers that predate the side argument read exactly as before.
    expect(orderDistanceLabel(0.000829, 0.0008096)).toBe("2.4% away")
    expect(orderDistanceLabel(0.000829, null, "buy")).toBeNull()
  })
})
