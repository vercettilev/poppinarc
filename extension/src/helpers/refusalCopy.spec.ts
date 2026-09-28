import { describe, expect, it } from "vitest"
import { messageOf, plainReason } from "./refusalCopy"

const FALLBACK = "That buy didn't go through. Try again."

describe("what a reader is shown when the server says no", () => {
  it("gives the refusal a new reader saw twice a sentence they can act on", () => {
    // 2026-09-26: printed in red under the chip, twice, three minutes after
    // install.
    expect(plainReason("a positive amountUsd is required", FALLBACK)).toBe("Type an amount first.")
    expect(plainReason("mint and a positive amountUsd are required", FALLBACK)).toBe("Type an amount first.")
    expect(plainReason("buy orders need a positive amountUsd", FALLBACK)).toBe("Type an amount first.")
  })

  it("names the missing sell amount and price the same way", () => {
    expect(plainReason("a raw integer amountRaw is required", FALLBACK)).toBe("Pick how much to sell first.")
    expect(plainReason("Sell order needs an amount", FALLBACK)).toBe("Pick how much to sell first.")
    expect(plainReason("Trigger price must be a positive number", FALLBACK)).toBe("Type a price first.")
  })

  it("reads a slippage failure as the price moving, before the generic wrap", () => {
    expect(
      plainReason("Trade would fail on-chain — custom program error: 0x1771", FALLBACK),
    ).toBe("The price moved while you pressed. Try again.")
  })

  it("keeps a log line off the screen", () => {
    for (const m of [
      "mint is required",
      "orderKey is required",
      "signature is not a Solana signature",
      "User wallet not found",
      "Which wallet? Pass the address you are about to sign with.",
      "That signature is not this trade.",
      "Trade would fail on-chain — Error processing Instruction 3",
      "Built transaction failed verification — fee payer mismatch",
      "Failed to fetch",
      "Request failed with status code 500",
      "Cannot read properties of undefined (reading 'x')",
    ]) {
      expect(plainReason(m, FALLBACK), m).toBe(FALLBACK)
    }
  })

  it("lets a sentence written for a person through untouched", () => {
    for (const m of [
      "Your wallet needs a little SOL for network fees. Add about 0.01 SOL and try again.",
      "The SOL price moved. Press again.",
      "That took too long. Press Buy again.",
      "Order is too small at this price",
      "Convert between $1 and $500.",
      "Phantom is not on this page. Unlock it and try again.",
      "Closed in Phantom before signing.",
      "Link that wallet first: connect it on app.poppin.so and sign the sentence.",
    ]) {
      expect(plainReason(m, FALLBACK), m).toBe(m)
    }
  })

  it("keeps the wrong-wallet sentence even when the address slice looks like code", () => {
    const m = "Phantom is on a different wallet (bQeF…MJn9) than your Poppin account."
    expect(plainReason(m, FALLBACK)).toBe(m)
  })

  it("falls back on nothing, and on anything too long to be a sentence", () => {
    expect(plainReason(undefined, FALLBACK)).toBe(FALLBACK)
    expect(plainReason("", FALLBACK)).toBe(FALLBACK)
    expect(plainReason(`A ${"very ".repeat(30)}long message.`, FALLBACK)).toBe(FALLBACK)
  })

  it("reads the message off any error shape", () => {
    expect(messageOf(new Error("x"))).toBe("x")
    expect(messageOf({ status: 400, message: "a positive amountUsd is required" })).toBe(
      "a positive amountUsd is required",
    )
    expect(messageOf("plain string")).toBeUndefined()
    expect(messageOf({ message: 42 })).toBeUndefined()
  })
})
