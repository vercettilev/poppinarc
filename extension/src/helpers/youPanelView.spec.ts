import { describe, expect, it } from "vitest"
import { headline, type YouBook } from "./youPanelView"

/**
 * THE HERO ANSWERS THE HOLDER'S QUESTION.
 *
 * It used to be totalPnlUsd — realized and unrealized folded together — so
 * a reader holding $1.59 of one coin saw "−$954.89 · All time" in the
 * biggest type on the surface: a number about trades that are already over.
 * Asked for by name from the field ("ora UnPNL olmalı").
 */
const book = (over: Partial<YouBook> = {}): YouBook => ({
  cashUsd: 0,
  positions: [],
  ...over,
})

describe("the scoreboard headline", () => {
  it("leads with UNREALIZED — what the open book is doing now", () => {
    expect(
      headline(book({ totalUnrealizedPnlUsd: 12.4, totalPnlUsd: -954.89 })),
    ).toEqual({ kind: "unrealized", usd: 12.4 })
  })

  it("falls back to all-time only when the server does not send unrealized", () => {
    // An older build: the panel must never lose its headline.
    expect(headline(book({ totalPnlUsd: -954.89 }))).toEqual({
      kind: "pnl",
      usd: -954.89,
    })
    // A server that DOES answer, with a flat open book, does not fall
    // through to the all-time figure — that would put the old number back
    // in the hero the moment the reader's positions balanced out.
    expect(
      headline(book({ totalUnrealizedPnlUsd: 0, totalPnlUsd: -954.89 })).kind,
    ).not.toBe("pnl")
  })

  it("shows portfolio value when there is nothing to score", () => {
    expect(
      headline(book({ cashUsd: 25, totalUnrealizedPnlUsd: null })),
    ).toEqual({ kind: "value", usd: 25 })
    expect(headline(book()).kind).toBe("unknown")
  })

  it("ignores dust, the same half-cent the resting chip uses", () => {
    expect(headline(book({ totalUnrealizedPnlUsd: 0.004, cashUsd: 5 })).kind).toBe(
      "value",
    )
  })
})
