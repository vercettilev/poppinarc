import { describe, expect, it } from "vitest"
import { receiptSentence } from "./tradeReceipt"

describe("receiptSentence", () => {
  it("a buy is the size of the bet and the size of the thing", () => {
    expect(
      receiptSentence({ symbol: "$PANTS", side: "buy", usd: 953, tokens: 1074603.6105, mcap: 60_900_000 }),
    ).toBe("PANTS $953 at $60.9M market cap")
  })

  it("no market cap means the sentence stops early, never invents one", () => {
    expect(
      receiptSentence({ symbol: "PANTS", side: "buy", usd: 953, tokens: 1, mcap: null }),
    ).toBe("PANTS $953")
  })

  it("a sell says what left the wallet, since the dollars are not settled", () => {
    /**
     * THE SHARED QUANTITY RULE, not a private one. This pinned the output
     * of a local four-digit formatter, and four digits is exactly what
     * helpers/qtyText.ts exists to replace: it prints anything under
     * 0.00005 as "0" and once turned a real $1.00 purchase of Bitcoin into
     * "0 WBTC". Above a thousand that shared rule drops the fraction
     * entirely, for the reason it states: "nobody reads 1,240.0000 ORE".
     * The receipt now says the same number the holdings row says for the
     * same position, which is the divergence qtyText was written to end.
     */
    expect(
      receiptSentence({ symbol: "$PANTS", side: "sell", usd: 0, tokens: 1074603.6105, mcap: null }),
    ).toBe("PANTS 1,074,604")
    // And the band that was actually broken: a quantity far below one keeps
    // the digits that make it real.
    expect(
      receiptSentence({ symbol: "$WBTC", side: "sell", usd: 0, tokens: 0.0000127, mcap: null }),
    ).toBe("WBTC 0.0000127")
  })

  it("strips a doubled dollar sign, which one writer used to pass", () => {
    expect(
      receiptSentence({ symbol: "$$WIF", side: "buy", usd: 25, tokens: 1, mcap: null }),
    ).toBe("WIF $25")
  })

  it("groups thousands, and keeps cents that say something", () => {
    // "$1,234.5" reads as a number that got cut off, not as a price.
    expect(
      receiptSentence({ symbol: "WIF", side: "buy", usd: 1234.5, tokens: 1, mcap: null }),
    ).toBe("WIF $1,234.50")
  })

  it("drops cents only when they are zero", () => {
    expect(
      receiptSentence({ symbol: "WIF", side: "buy", usd: 25, tokens: 1, mcap: null }),
    ).toBe("WIF $25")
  })
})
