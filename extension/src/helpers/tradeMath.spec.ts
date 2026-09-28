import { describe, expect, it, vi } from "vitest"
import {
  PRESET_USD,
  SELL_FRACTIONS,
  settledBalance,
  usdToRawOfHolding, pocketPick } from "./tradeMath"

/**
 * The money helpers both surfaces share.
 *
 * Each case here is a bug that shipped: the panel's sheet with its own preset
 * amounts, a "Max" that oversold by a rounding hair, and a post-trade balance
 * read that landed on the wrong side of the trade.
 */

describe("usdToRawOfHolding", () => {
  const bal = { uiAmount: 100, raw: "100000000" } // 100 tokens, 6 decimals

  it("takes a proportional slice of the raw balance", () => {
    // $5 of a $10 position is half of it, in raw units.
    expect(usdToRawOfHolding(5, bal, 0.1)).toBe("50000000")
  })

  it("clamps Max so it can never ask for more than the wallet holds", () => {
    // This is the whole reason the math is shared. Asking for more USD than
    // the position is worth must sell the position, not more than it.
    expect(usdToRawOfHolding(999, bal, 0.1)).toBe(bal.raw)
  })

  it("refuses to guess when the holding is worth nothing", () => {
    expect(usdToRawOfHolding(5, { uiAmount: 0, raw: "0" }, 0.1)).toBe("0")
    expect(usdToRawOfHolding(5, bal, 0)).toBe("0")
  })
})

describe("settledBalance", () => {
  it("keeps reading until the chain reports a different number", async () => {
    // `confirmed` does not mean every node has the block, so the first read
    // after a fill can still be the pre-trade balance. Stopping there is what
    // made Max sell less than everything right after a buy.
    const reads = [
      { uiAmount: 10, raw: "10" },
      { uiAmount: 10, raw: "10" },
      { uiAmount: 12, raw: "12" },
    ]
    let i = 0
    const read = vi.fn(async () => reads[Math.min(i++, reads.length - 1)])

    const out = await settledBalance(read, "10", 5, 0)
    expect(out?.raw).toBe("12")
    expect(read).toHaveBeenCalledTimes(3)
  })

  it("stops at the first read when there was nothing to compare against", async () => {
    const read = vi.fn(async () => ({ uiAmount: 1, raw: "1" }))
    expect((await settledBalance(read, null, 5, 0))?.raw).toBe("1")
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("gives back the last number it did read rather than nothing", async () => {
    // The trade already happened. A stale balance beats a blank one, and it
    // beats an error on a successful purchase.
    const read = vi.fn(async () => ({ uiAmount: 10, raw: "10" }))
    const out = await settledBalance(read, "10", 3, 0)
    expect(out?.raw).toBe("10")
    expect(read).toHaveBeenCalledTimes(3)
  })

  it("survives a probe that throws and one that answers nothing", async () => {
    let n = 0
    const read = vi.fn(async () => {
      n++
      if (n === 1) throw new Error("offline")
      if (n === 2) return null
      return { uiAmount: 7, raw: "7" }
    })
    expect((await settledBalance(read, "5", 5, 0))?.raw).toBe("7")
  })
})

describe("the preset amounts", () => {
  it("are the card's, because there is only one set", () => {
    // The panel's sheet shipped with 1/5/20 — retyped rather than imported.
    expect(PRESET_USD).toEqual([10, 25, 100])
    expect(SELL_FRACTIONS).toEqual([0.25, 0.5, 1])
  })
})

describe("pocketPick", () => {
  it("Max is the whole pocket to the cent, float ghosts and all", () => {
    expect(pocketPick(1.15, 100)).toBe(1.15)
    expect(pocketPick(8.55, 100)).toBe(8.55)
  })
  it("never rounds the pocket UP past the balance", () => {
    expect(pocketPick(8.559, 100)).toBe(8.55)
  })
  it("a quarter and a half are taken of whole cents, floored", () => {
    expect(pocketPick(10.01, 25)).toBe(2.5)
    expect(pocketPick(1.15, 50)).toBe(0.57)
  })
})
