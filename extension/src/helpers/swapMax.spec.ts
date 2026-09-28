import { describe, expect, it } from "vitest"
import {
  maxSwapFill,
  SOL_FEE_RESERVE_LAMPORTS,
  SOL_MINT,
  swappableUi,
} from "./swapMax"

/**
 * The field report as arithmetic: 3.020272 SOL, Max pressed, refused twice
 * over — once for the display string rounding UP past the balance, once for
 * the 0.001 SOL the backend keeps for fees on SOL-input swaps.
 */
describe("what Max may swap", () => {
  it("keeps the fee reserve back when swapping SOL itself away", () => {
    // The reported wallet: 3.020272 SOL exact. Max must fill
    // balance - 0.001, not the balance and certainly not "3.0203".
    expect(maxSwapFill("3.020272000", 9, SOL_MINT)).toBe("3.019272")
    expect(swappableUi("3.020272000", 9, SOL_MINT)).toBeCloseTo(3.019272, 9)
  })

  it("never fills the rounded-up display number", () => {
    // toFixed(4) of 3.020272 renders "3.0203" — more SOL than exists.
    const filled = parseFloat(maxSwapFill("3.020272000", 9, SOL_MINT))
    expect(filled).toBeLessThan(3.020272)
  })

  it("fills the exact balance for tokens that are not the fee currency", () => {
    // A USDC swap pays its fee in SOL; the USDC itself swaps whole.
    expect(maxSwapFill("1000.123456", 6, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(
      "1000.123456",
    )
  })

  it("answers zero when the reserve eats the whole balance", () => {
    // 0.0008 SOL cannot swap at all: the fee needs 0.001. "0" is honest;
    // a negative number is a bug wearing a minus sign.
    expect(maxSwapFill("0.000800000", 9, SOL_MINT)).toBe("0")
    expect(swappableUi("0.000800000", 9, SOL_MINT)).toBe(0)
  })

  it("survives float noise at nine decimals", () => {
    // 0.1 + 0.2 territory: the raw-units round trip must not lose a
    // lamport to IEEE 754 on ordinary balances.
    expect(maxSwapFill("0.300000000", 9, SOL_MINT)).toBe(
      ((0.3e9 - SOL_FEE_RESERVE_LAMPORTS) / 1e9).toFixed(9).replace(/0+$/, ""),
    )
  })

  it("treats junk input as an empty wallet", () => {
    expect(maxSwapFill("", 9, SOL_MINT)).toBe("0")
    expect(maxSwapFill("NaN", 6, undefined)).toBe("0")
  })

  it("a 0-decimals token keeps its whole number whole", () => {
    // The first trim regex made the dot optional and "500" became "5" —
    // Max filling a tenth of the balance, in the helper built for exactness.
    expect(maxSwapFill("500", 0, "SomeMint")).toBe("500")
    expect(maxSwapFill("1000", 0, "SomeMint")).toBe("1000")
  })

  it("a huge balance never round-trips through floats", () => {
    // Ten billion units of a 9-decimals token is past 2^53 raw units,
    // where floor(x * 1e9) overshoots and the backend refuses money that
    // does not exist. No reserve applies, so the exact string IS the max.
    expect(maxSwapFill("10000000000.123456789", 9, "MemeMint")).toBe(
      "10000000000.123456789",
    )
    expect(maxSwapFill("10.500000", 6, "MemeMint")).toBe("10.5")
  })
})
