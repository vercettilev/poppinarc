import { describe, expect, it } from "vitest"
import { callerHandle, flexParts } from "./flexCard"

describe("flexParts", () => {
  it("leads with UNREALIZED profit on an open position, not total pnl", () => {
    // 100 units, avg entry $1, price $2.50 → unrealized (2.5-1)*100 = +$150,
    // +150%. realizedPnlUsd is irrelevant to an OPEN flex.
    const p = flexParts({
      ticker: "$WIF",
      uiAmount: 100,
      priceUsd: 2.5,
      avgEntryPriceUsd: 1,
      realizedPnlUsd: 40,
    })!
    expect(p.tone).toBe("up")
    expect(p.action).toBe("Up $150.00")
    expect(p.subline).toBe("+150.0% on $WIF · holding")
  })

  it("colors a losing hold red and says Down", () => {
    const p = flexParts({ ticker: "WIF", uiAmount: 10, priceUsd: 0.5, avgEntryPriceUsd: 1 })!
    expect(p.tone).toBe("down")
    expect(p.action).toBe("Down $5.00")
    expect(p.subline).toContain("-50.0%")
  })

  it("a closed position flexes its REALIZED result, not an unrealized one", () => {
    const p = flexParts({
      ticker: "$BONK",
      uiAmount: 0,
      priceUsd: 0.00002,
      avgEntryPriceUsd: null,
      realizedPnlUsd: 320,
    })!
    expect(p.action).toBe("Banked $320.00")
    expect(p.subline).toBe("Closed $BONK · realized")
  })

  it("flexes NOTHING without a basis, or when there is nothing to show", () => {
    // Held but no avg entry (predates the ledger) → no honest unrealized.
    expect(
      flexParts({ ticker: "WIF", uiAmount: 100, priceUsd: 2, avgEntryPriceUsd: null }),
    ).toBeNull()
    // Nothing held, nothing banked.
    expect(
      flexParts({ ticker: "WIF", uiAmount: 0, priceUsd: 2, realizedPnlUsd: 0 }),
    ).toBeNull()
  })

  it("credits the caller from the entry tweet", () => {
    const p = flexParts({
      ticker: "WIF",
      uiAmount: 100,
      priceUsd: 2,
      avgEntryPriceUsd: 1,
      callerSourceUrl: "https://x.com/memecaller/status/123",
    })!
    expect(p.credit).toBe("via @memecaller")
  })

  it("parses the handle, and refuses a non-status URL", () => {
    expect(callerHandle("https://x.com/abc/status/9")).toBe("abc")
    expect(callerHandle("https://twitter.com/xyz_1/status/9")).toBe("xyz_1")
    expect(callerHandle("https://poppin.so/foo")).toBeNull()
    expect(callerHandle(null)).toBeNull()
  })
})

describe("flexParts numbers", () => {
  it("carries the open position as numbers the card can lay out", () => {
    const p = flexParts({ ticker: "SOL", uiAmount: 2, priceUsd: 150, avgEntryPriceUsd: 100 })!
    expect(p.numbers).toEqual({ kind: "open", pct: 50, inUsd: 200, nowUsd: 300, pnlUsd: 100 })
  })

  it("carries a closed position as its realized dollars and nothing it cannot know", () => {
    const p = flexParts({ ticker: "SOL", uiAmount: 0, priceUsd: 150, realizedPnlUsd: 12.5 })!
    expect(p.numbers).toEqual({ kind: "closed", pct: null, inUsd: null, nowUsd: null, pnlUsd: 12.5 })
  })
})

