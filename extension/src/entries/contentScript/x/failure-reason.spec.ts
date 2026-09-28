import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { outcomeReason } from "./inlineBuy"

const read = (p: string) => readFileSync(join(__dirname, "..", "..", "..", p), "utf8")

/**
 * A FAILURE WITH NO REASON IS A NUMBER NOBODY CAN ACT ON.
 *
 * Measured on production (2026-09-20): 40 to 60 percent of trade presses
 * failed on three separate days, and every swap_failed row in the database
 * carried `kind: "error"` and nothing else. The card's path had always
 * sent `reason`; the chip's — where nearly every press happens — never
 * did, so the product knew its own failure rate and not one cause.
 */
describe("a failed press says why", () => {
  it("carries the sentence the reader was shown, and the wallet's words when there are any", () => {
    expect(outcomeReason({ kind: "error", text: "Insufficient USDC" })).toBe(
      "Insufficient USDC",
    )
    expect(
      outcomeReason({ kind: "error", text: "Didn't go through", detail: "User rejected" }),
    ).toBe("Didn't go through · User rejected")
  })

  it("says nothing about a trade that worked", () => {
    expect(outcomeReason({ kind: "done", text: "Popped" })).toBeUndefined()
    expect(outcomeReason({ kind: "pending", text: "Popping…" })).toBeUndefined()
    expect(outcomeReason({ kind: "info", text: "Nothing to sell" })).toBeUndefined()
  })

  it("stays a label, not a log line", () => {
    const long = outcomeReason({ kind: "error", text: "x".repeat(400) })!
    expect(long.length).toBeLessThanOrEqual(160)
  })

  it("is reported by BOTH chip paths, which is where the presses are", () => {
    const chip = read("entries/contentScript/x/xStrip.ts")
    const buy = chip.slice(chip.indexOf('track("x_inline_buy"'))
    const sell = chip.slice(chip.indexOf('track("x_inline_sell"'))
    expect(buy.slice(0, 700)).toMatch(/reason: outcomeReason\(outcome\)/)
    expect(sell.slice(0, 400)).toMatch(/reason: outcomeReason\(outcome\)/)
  })
})
