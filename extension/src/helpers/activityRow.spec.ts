import { describe, expect, it } from "vitest"
import { activityRow, shortMint, tokenCountText } from "./activityRow"

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"

const swap = (meta: Record<string, unknown>, amount = "10000000") => ({
  transaction_type: "swap",
  amount,
  token_mint: (meta.inputMint as string) ?? null,
  metadata: JSON.stringify(meta),
})

const known = (m: string) => (m === BONK ? "BONK" : m === USDC ? "USDC" : null)

describe("a swap row never reads its own amount column", () => {
  it("prices a buy off the USDC that went in", () => {
    const r = activityRow(
      swap({ inputMint: USDC, outputMint: BONK, inputAmount: "25000000", outputAmount: "999" }),
      known,
    )
    expect(`${r.verb} ${r.subject}`).toBe("Bought BONK")
    expect(r.amountText).toBe("$25.00")
    // The token came IN, so the row is green. Not "dollars left, so red" —
    // the colour is about the thing the row names.
    expect(r.direction).toBe("in")
  })

  it("prices a sell off the USDC that came out", () => {
    const r = activityRow(
      swap({ inputMint: BONK, outputMint: USDC, inputAmount: "999", outputAmount: "31400000" }),
      known,
    )
    expect(`${r.verb} ${r.subject}`).toBe("Sold BONK")
    expect(r.amountText).toBe("$31.40")
    expect(r.direction).toBe("out")
  })

  it("never renders the raw amount column, which is a different unit", () => {
    // 10000000 raw was rendering as "10000000.00" beside the word "Swap".
    const r = activityRow(
      swap({ inputMint: USDC, outputMint: BONK, inputAmount: "10000000" }, "10000000"),
      known,
    )
    expect(r.amountText).toBe("$10.00")
    expect(r.amountText).not.toContain("10000000")
  })

  it("states no amount for a legacy token-to-token swap", () => {
    // No USDC leg means no honest dollar figure, and picking a side would
    // be inventing one.
    const r = activityRow(
      swap({ inputMint: BONK, outputMint: WIF, inputAmount: "1", outputAmount: "2" }),
      known,
    )
    expect(r.amountText).toBe("")
    expect(`${r.verb} ${r.subject}`).toBe("Swapped BONK → EKpQ…zcjm")
    expect(r.direction).toBeNull()
  })

  it("survives metadata it cannot read", () => {
    const r = activityRow(
      { transaction_type: "swap", amount: "5", token_mint: BONK, metadata: "{oops" },
      known,
    )
    expect(r.amountText).toBe("")
    expect(r.subject).toBe("BONK")
  })

  it("never says the word Swap where a token name belongs", () => {
    for (const meta of [
      { inputMint: USDC, outputMint: BONK, inputAmount: "1000000" },
      { inputMint: BONK, outputMint: USDC, outputAmount: "1000000" },
      { inputMint: BONK, outputMint: WIF },
    ]) {
      const r = activityRow(swap(meta), known)
      expect(`${r.verb} ${r.subject}`).not.toContain("Swapped Swap")
    }
  })
})

describe("transfers", () => {
  it("names the token by its mint instead of the word TOKEN", () => {
    const r = activityRow(
      { transaction_type: "receive_token", amount: "100", token_mint: USDC },
      known,
    )
    expect(`${r.verb} ${r.subject}`).toBe("Received USDC")
    expect(r.amountText).toBe("+100.00 USDC")
  })

  it("falls back to the mint itself, never to a placeholder symbol", () => {
    // A token you spent down is not in the holdings list, so it has no
    // symbol to look up — its own address is still more use than "TOKEN".
    const r = activityRow(
      { transaction_type: "receive_token", amount: "100", token_mint: WIF },
      known,
    )
    expect(r.subject).toBe("EKpQ…zcjm")
    expect(r.subject).not.toBe("TOKEN")
  })

  it("keeps SOL for a native transfer and signs it out", () => {
    const r = activityRow({ transaction_type: "send_sol", amount: "0.5" }, known)
    expect(`${r.verb} ${r.subject}`).toBe("Sent SOL")
    expect(r.amountText).toBe("-0.5000 SOL")
    expect(r.direction).toBe("out")
  })
})

describe("quantities", () => {
  it("drops decimals and groups digits once a count is memecoin-sized", () => {
    expect(tokenCountText(1234567.89)).toBe("1,234,568")
    expect(tokenCountText(12.5)).toBe("12.50")
    expect(tokenCountText(0.0001234)).toBe("0.0001")
  })

  it("leaves a short mint alone", () => {
    expect(shortMint("SOL")).toBe("SOL")
  })
})
