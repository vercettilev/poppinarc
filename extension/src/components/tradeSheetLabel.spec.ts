import { describe, expect, it } from "vitest"
import { viewTradeSheet } from "~/helpers/tradeSheetModel"

/**
 * WHAT THE LAST KEY BEFORE MONEY MOVES IS ALLOWED TO SAY.
 *
 * The sheet's Confirm button prints the model's label, which is right for
 * the case it was adopted for and wrong for one the adopter did not see. It
 * is pinned here because the failure is silent: both labels are armed, both
 * render, and only the wording betrays that the key does something else.
 */
/** Mirrors TradeSheet's own rule at the Confirm button. */
const confirmLabel = (
  view: ReturnType<typeof viewTradeSheet>,
  mode: "buy" | "sell",
  usd: number,
) => {
  const tail = usd > 0 ? ` · $${Number(usd.toFixed(2))}` : ""
  if (!tail) return "Type an amount"
  if (view.action?.armed && view.action.tone === mode) return view.action.label
  return mode === "buy" ? `Buy${tail}` : `Sell${tail}`
}

describe("the confirm key's words", () => {
  it("says what a clamped sell will actually move", () => {
    // $25 typed against a $3 position executes as a 100% sell. The button
    // used to keep printing $25; the receipt then reported a number the
    // reader never chose.
    const view = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 1,
      reader: { cashUsd: 100, uiAmount: 3, raw: "3", entryMcapUsd: null },
      state: { side: "sell", kind: "market", priceText: "", usd: 25, pct: 100 },
    })
    expect(confirmLabel(view, "sell", 25)).toBe("Sell all ($3)")
  })

  it("never puts a funding word on a key that sends a trade", () => {
    // A short balance arms { label: "Deposit USDC", tone: "fund" }, because
    // the surface that model was written for funds instead of buying. This
    // button's onClick is confirm() whatever it says, so the word has to be
    // the trade — a key reading "Deposit" that sends a swap the backend
    // then refuses is a worse lie than the one the model was adopted to fix.
    const view = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 1,
      reader: { cashUsd: 3, uiAmount: 0, raw: "0", entryMcapUsd: null },
      state: { side: "buy", kind: "market", priceText: "", usd: 25, pct: 0 },
    })
    expect(view.action.armed).toBe(true)
    expect(view.action.tone).toBe("fund")
    expect(confirmLabel(view, "buy", 25)).toBe("Buy · $25")
  })

  it("uses the rulebook's own words for an ordinary buy", () => {
    const view = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 1,
      reader: { cashUsd: 100, uiAmount: 0, raw: "0", entryMcapUsd: null },
      state: { side: "buy", kind: "market", priceText: "", usd: 25, pct: 0 },
    })
    // The model owns the wording ("Buy $25"); the sheet's own
    // fallback is only for the cases the model is not describing.
    expect(confirmLabel(view, "buy", 25)).toBe("Buy $25")
  })

  it("asks for an amount before it asks for anything else", () => {
    const view = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 1,
      reader: { cashUsd: 100, uiAmount: 0, raw: "0", entryMcapUsd: null },
      state: { side: "buy", kind: "market", priceText: "", usd: 0, pct: 0 },
    })
    expect(confirmLabel(view, "buy", 0)).toBe("Type an amount")
  })
})
