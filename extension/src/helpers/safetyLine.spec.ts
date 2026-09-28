import { describe, expect, it } from "vitest"
import {
  capIsMeaningful,
  compactMoney,
  safetyLine,
  wrapsSomethingElse,
} from "./safetyLine"

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0)
const H = 3_600_000

/**
 * THIS LINE USED TO SAY FOUR FACTS AND NOW SAYS ONLY WARNINGS.
 *
 * It carried liquidity AND pool age AND holders AND mint status, in the
 * degen's own vocabulary, all in orange, under the amount. Read back from
 * the field as an info dump. Every number in it was true and the whole was
 * still wrong: a reader sizing a $25 buy is not auditing a pool.
 *
 * What survives is the part that is not information. A retained mint
 * authority means the issuer can print more; a retained freeze authority
 * means the issuer can take yours. Those change what a press DOES, and
 * they were always the only two that set `warn`. Liquidity and age were a
 * second opinion on floors the trade gate already enforces.
 */
describe("safetyLine", () => {
  it("says nothing at all when nothing is wrong", () => {
    // The old version returned four facts here.
    expect(
      safetyLine(
        {
          liquidityUsd: 56_400,
          poolCreatedAtMs: NOW - 3 * 24 * H,
          mintAuthorityRetained: false,
          freezeAuthorityRetained: false,
        },
        1_240,
        NOW,
      ),
    ).toBeNull()
  })

  it("speaks when the issuer can still print", () => {
    expect(
      safetyLine({ liquidityUsd: 8_000, mintAuthorityRetained: true }, 200, NOW),
    ).toEqual({ text: "mint open", warn: true })
  })

  it("speaks when the issuer can take yours", () => {
    expect(
      safetyLine({ freezeAuthorityRetained: true }, null, NOW),
    ).toEqual({ text: "can freeze", warn: true })
  })

  it("says both when both are true", () => {
    expect(
      safetyLine(
        { mintAuthorityRetained: true, freezeAuthorityRetained: true },
        9,
        NOW,
      ),
    ).toEqual({ text: "mint open · can freeze", warn: true })
  })

  it("stays silent on a missing field rather than reassuring", () => {
    // Absence is not "locked". A reassurance derived from a field the
    // upstream did not send is the exact lie the ticker cache used to tell
    // about failures — and "mint locked" is now unspoken even when we DO
    // know it, because a reassurance is information, not a warning.
    expect(safetyLine({}, null, NOW)).toBeNull()
    expect(safetyLine(null, null, NOW)).toBeNull()
    expect(safetyLine({ mintAuthorityRetained: null }, null, NOW)).toBeNull()
    expect(safetyLine({ mintAuthorityRetained: false }, null, NOW)).toBeNull()
  })
})

describe("capIsMeaningful", () => {
  /**
   * WBTC showed "$196.1M MC" beside a Bitcoin price. Nothing computed
   * wrong: Jupiter reports the cap of the SOLANA mint, which really is the
   * value of the wrapped supply on this chain. It is just not what the
   * words "market cap" promise, and next to the risk facts it read as
   * "small, be careful" about wrapped Bitcoin.
   */
  it("refuses the figure for bridge-wrapped collateral", () => {
    expect(capIsMeaningful("wormhole")).toBe(false)
    expect(capIsMeaningful("bridged")).toBe(false)
  })

  /**
   * CORRECTED 2026-09-13. The line above was drawn at bridges alone, and
   * the reasoning that drew it applies just as exactly to a tokenized
   * share: an AAPLx mint is the same shape as WBTC. Measured on the live
   * mint, it held $50.8M against a company worth three trillion, and the
   * chip printed "$51.4M MC" under the word Apple.
   */
  it("keeps it only for a mint that IS the asset", () => {
    for (const issuer of ["native-spl", null, undefined]) {
      expect(capIsMeaningful(issuer)).toBe(true)
    }
    for (const issuer of ["xstocks", "ondo", "tether"]) {
      expect(capIsMeaningful(issuer), issuer).toBe(false)
    }
  })
})

describe("compactMoney", () => {
  it("is unchanged — the cap still needs saying where it means something", () => {
    expect(compactMoney(196_100_000)).toBe("$196M")
    expect(compactMoney(1_240)).toBe("$1.2K")
  })
})

// Measured on the live AAPLx mint (XsbEhLAtcf6Hdfp…): mcap 50.8M against a
// company worth three trillion, and BOTH authorities retained — which is
// how a tokenized share works, not a hazard. The chip printed
// "$51.4M MC · mint open · can freeze" under an Apple headline.
describe("a mint that only wraps something else", () => {
  const custodied = {
    liquidityUsd: 894_690,
    poolCreatedAtMs: 1_751_034_072_000,
    mintAuthorityRetained: true,
    freezeAuthorityRetained: true,
  }

  it("keeps its market cap to itself", () => {
    for (const issuer of ["xstocks", "backpack-securities", "prestocks", "ondo", "tether"]) {
      expect(capIsMeaningful(issuer), issuer).toBe(false)
      expect(wrapsSomethingElse(issuer), issuer).toBe(true)
    }
  })

  it("still covers the bridges, which were the original reason for this rule", () => {
    expect(capIsMeaningful("wormhole")).toBe(false)
    expect(capIsMeaningful("bridged")).toBe(false)
  })

  it("leaves a native mint alone, where both numbers protect the reader", () => {
    expect(wrapsSomethingElse("native-spl")).toBe(false)
    expect(capIsMeaningful("native-spl")).toBe(true)
    expect(safetyLine(custodied)?.text).toBe("mint open · can freeze")
  })

  it("says nothing at all for an unknown issuer rather than guessing", () => {
    expect(wrapsSomethingElse(null)).toBe(false)
    expect(wrapsSomethingElse(undefined)).toBe(false)
  })
})
