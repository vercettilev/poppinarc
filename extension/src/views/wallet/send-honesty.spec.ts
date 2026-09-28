import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Send's two known lies, pinned. Both were diagnosed once before (Swap got
 * the fixes, Send kept the old road), so these guard against the drift
 * coming back a third time.
 */
const src = readFileSync(join(__dirname, "Send.tsx"), "utf8")

describe("Send speaks the truth", () => {
  it("balances come from the exact string, through the shared reserve math", () => {
    expect(src).toMatch(/amountExact \?\? activeToken\.amount/)
    expect(src).toMatch(/swappableUi\(exactAmount/)
    expect(src).toMatch(/maxSwapFill\(exactAmount/)
    // The display-rounded parse is gone.
    expect(src).not.toMatch(/parseFloat\(activeToken\.amount\)\s*:\s*0/)
  })

  it("the confirm dialog describes the transfer that actually happens", () => {
    expect(src).not.toMatch(/Swapping via Jupiter/)
    expect(src).not.toMatch(/via Jupiter/)
    // Every token gets the USD line, not just SOL.
    expect(src).toMatch(/≈ \$\$\{convertAmountToUSD\(amount\)\}/)
  })

  it("success names the money that moved", () => {
    expect(src).not.toMatch(/Successfully processed transaction/)
    expect(src).toMatch(/Sent \$\{amount\} \$\{activeToken\.symbol\}/)
  })
})
