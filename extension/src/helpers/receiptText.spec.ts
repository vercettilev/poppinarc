import { describe, expect, it } from "vitest"
import { receiptText } from "./receiptText"

describe("receiptText", () => {
  it("re-says the machine's old buy in today's shape", () => {
    expect(
      receiptText(
        "Bought 1,074,603.6105 $PANTS ($953.00) on x.com via Poppin",
        true,
      ),
    ).toBe("PANTS $953")
  })

  it("keeps cents when they say something", () => {
    expect(
      receiptText("Bought 10 $WIF ($1,234.50) on x.com via Poppin", true),
    ).toBe("WIF $1,234.50")
  })

  it("a sell is remembered by what left the wallet", () => {
    expect(
      receiptText(
        "Sold 1,074,603.6105 $PANTS ($0.00) on x.com via Poppin",
        true,
      ),
    ).toBe("PANTS 1,074,603.6105")
  })

  it("heals receipts made anywhere, not only on x.com", () => {
    // The card's writer stamped whatever page the reader was standing on.
    expect(
      receiptText("Bought 10 $WIF ($25.00) on pump.fun via Poppin", true),
    ).toBe("WIF $25")
  })

  it("survives the card's doubled dollar sign", () => {
    // That writer passed a symbol that already carried a $.
    expect(
      receiptText("Bought 10 $$WIF ($25.00) on dexscreener.com via Poppin", true),
    ).toBe("WIF $25")
  })

  it("leaves today's receipt alone", () => {
    const now = "PANTS $953 at $60.9M market cap"
    expect(receiptText(now, true)).toBe(now)
  })

  it("never edits a person's own words, however close they sound", () => {
    // A human wrote this. One character off the machine's format is enough.
    const human = "Bought 5 $WIF ($10.00) on x.com via Poppin!"
    expect(receiptText(human, true)).toBe(human)
    const alsoHuman = "just Bought 5 $WIF ($10.00) on x.com via Poppin"
    expect(receiptText(alsoHuman, true)).toBe(alsoHuman)
  })

  it("a post with no ledger row behind it is not a receipt", () => {
    const s = "Bought 10 $WIF ($25.00) on x.com via Poppin"
    expect(receiptText(s, false)).toBe(s)
  })

  /**
   * THE LEDGER FILLS IN WHAT THE FROZEN SENTENCE COULD NOT.
   *
   * The words are the person's post and stay untouched; the market cap
   * arrives beside them from spot_trades, joined by signature. So a receipt
   * written before caps were captured starts reading like today's the day
   * its ledger row gains one, with no migration and no edit.
   */
  it("says the ledger's market cap on an old buy", () => {
    expect(
      receiptText(
        "Bought 1,074,603.6105 $PANTS ($953.00) on x.com via Poppin",
        true,
        60_900_000,
      ),
    ).toBe("PANTS $953 at $60.9M market cap")
  })

  it("says it on an old sell too, beside the quantity", () => {
    expect(
      receiptText("Sold 1,000 $WIF ($0.00) on x.com via Poppin", true, 2_400_000),
    ).toBe("WIF 1,000 at $2.4M market cap")
  })

  it("stops early when the ledger has no cap - never today's size", () => {
    const s = "Bought 10 $WIF ($25.00) on x.com via Poppin"
    expect(receiptText(s, true)).toBe("WIF $25")
    expect(receiptText(s, true, null)).toBe("WIF $25")
    expect(receiptText(s, true, 0)).toBe("WIF $25")
  })

  it("a cap cannot turn a person's own words into a receipt", () => {
    const human = "Bought 5 $WIF ($10.00) on x.com via Poppin!"
    expect(receiptText(human, true, 60_900_000)).toBe(human)
  })
})
