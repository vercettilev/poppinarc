import { describe, expect, it } from "vitest"
import { countTradeProof, proofText } from "./tradeProof"

/**
 * The number that moves a reader on a trading product: not how many people
 * are talking, how many BOUGHT. Counted from the trade receipts the surfaces
 * already load, so every claim is checkable in the conversation below it.
 */
describe("counting the receipts", () => {
  it("counts distinct authors, never posts", () => {
    // One enthusiast sharing three buys is one person. "3 bought" over one
    // author is the inflation a reader eventually catches — after which no
    // number on the surface is believed.
    const r = countTradeProof([
      { authorId: "a", isTrade: true, side: "buy" },
      { authorId: "a", isTrade: true, side: "buy" },
      { authorId: "b", isTrade: true, side: "buy" },
    ])
    expect(r.buyers).toBe(2)
  })

  it("counts buys only — a sell is not proof anyone bought", () => {
    const r = countTradeProof([
      { authorId: "a", isTrade: true, side: "buy" },
      { authorId: "b", isTrade: true, side: "sell" },
      { authorId: "c", isTrade: true, side: null },
    ])
    expect(r).toEqual({ buyers: 1 })
  })

  it("ignores talk, which has its own count", () => {
    const r = countTradeProof([
      { authorId: "a" },
      { authorId: "b", isTrade: false, side: "buy" },
    ])
    expect(r).toEqual({ buyers: 0 })
  })

  it("has nothing to say about an empty page", () => {
    expect(countTradeProof([])).toEqual({ buyers: 0 })
  })
})

describe("the sentence", () => {
  it("names where the receipts are", () => {
    expect(proofText(12)).toBe("12 bought from this tweet")
  })

  it("says nothing rather than saying zero", () => {
    // "0 bought from this tweet" is an anti-ad. Silence costs nothing and
    // lies about nothing.
    expect(proofText(0)).toBe("")
    expect(proofText(-1)).toBe("")
  })
})
