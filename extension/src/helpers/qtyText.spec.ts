import { describe, expect, it } from "vitest"
import { qtyText } from "./qtyText"

/**
 * "✓ $1.00 → 0 WBTC"
 *
 * A real purchase, on 2026-09-11. One dollar of Bitcoin at $78,968 is
 * 0.0000127 WBTC, and four fraction digits print that as zero. Money moved,
 * the chain agreed, and the only sentence the reader got said they had
 * received nothing.
 *
 * TradeHistory had already worked this out and written the reason down. The
 * inline buy under a tweet had its own copy of the formatter and its own
 * ceiling of four fraction digits. One rule now, in one place, because a rule
 * learned twice and applied once is not a rule.
 */
describe("qtyText", () => {
  it("never prints a real quantity as zero", () => {
    // The reported case, to the lamport.
    expect(qtyText(1 / 78968.3)).toBe("0.0000127")
    expect(qtyText(0.0000127)).not.toBe("0")
    expect(qtyText(0.00000001)).not.toBe("0")
  })

  it("keeps four significant digits below one, however far down they start", () => {
    expect(qtyText(0.5)).toBe("0.5")
    expect(qtyText(0.123456)).toBe("0.123")
    expect(qtyText(0.000999999)).toBe("0.001")
  })

  it("keeps four fraction digits in the ordinary band", () => {
    expect(qtyText(1)).toBe("1")
    expect(qtyText(12.3456789)).toBe("12.35")
    expect(qtyText(999.99999)).toBe("1,000")
  })

  it("drops the fraction entirely above a thousand", () => {
    // Nobody reads 1,240.0000 ORE, and the fourth decimal of a
    // thousand-unit position is noise.
    expect(qtyText(1240.5678)).toBe("1,241")
    expect(qtyText(2_000_000)).toBe("2,000,000")
  })

  it("is exactly zero only for zero", () => {
    expect(qtyText(0)).toBe("0")
  })
})
