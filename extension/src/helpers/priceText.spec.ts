import { describe, expect, it } from "vitest"
import { priceText } from "./priceText"

/**
 * "$0.283814" is the chip printing everything it knows, and it is what made
 * the strip read as a terminal readout instead of a product. Nobody decides
 * anything with the sixth digit.
 *
 * Two rules, and they pull in different directions on purpose: four
 * significant figures decides HOW MANY digits, and magnitude decides when
 * that count may change — because a live price that gains and loses a digit
 * as it ticks makes the whole row breathe, and a row that fidgets on
 * somebody else's feed is worse than one that is merely long.
 */

describe("priceText", () => {
  it("keeps money convention at or above a dollar", () => {
    expect(priceText(96.8)).toBe("$96.80")
    expect(priceText(96.804)).toBe("$96.80")
    expect(priceText(1)).toBe("$1.00")
    expect(priceText(1234.5)).toBe("$1,234.50")
  })

  it("shows four real figures below a dollar, not everything it knows", () => {
    // The measured offender: six decimals on a 28-cent token.
    expect(priceText(0.283814)).toBe("$0.2838")
    expect(priceText(0.0706)).toBe("$0.07060")
  })

  it("counts leading zeros as magnitude, not as digits", () => {
    // A memecoin at seven-hundredths of a cent still gets four figures.
    expect(priceText(0.00007061)).toBe("$0.00007061")
    expect(priceText(0.000000123456)).toBe("$0.0000001235")
  })

  it("does not change width while the price ticks inside a magnitude", () => {
    // The row must not breathe. Same number of characters either side of a
    // print, which is what a fixed count within a magnitude buys.
    expect(priceText(0.2838).length).toBe(priceText(0.2900).length)
    expect(priceText(96.8).length).toBe(priceText(96.85).length)
  })

  it("refuses nonsense rather than printing it", () => {
    expect(priceText(0)).toBe("$0.00")
    expect(priceText(-1)).toBe("$0.00")
    expect(priceText(NaN)).toBe("$0.00")
    expect(priceText(Infinity)).toBe("$0.00")
  })
})
