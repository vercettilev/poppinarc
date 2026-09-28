import { describe, expect, it } from "vitest"
import { walletSwapReceipt, WALLET_SOURCE_URL } from "./walletSwapReceipt"

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" }
const WIF = { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", logoURI: "https://x/wif.png" }
const SOL = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL" }

const run = (o: Partial<Parameters<typeof walletSwapReceipt>[0]> = {}) =>
  walletSwapReceipt({
    from: USDC, to: WIF, fromAmount: "25", toAmount: "900", signature: "SIG", ...o,
  })

describe("walletSwapReceipt", () => {
  it("USDC in is a buy, priced by the dollars that left", () => {
    const r = run()!
    expect(r.content).toBe("WIF $25")
    expect(r.transaction_data).toMatchObject({
      tokenMint: WIF.mint, tokenSymbol: "WIF", tradeType: "buy",
      tokenAmount: 900, signature: "SIG", tokenImageUrl: "https://x/wif.png",
    })
    expect(r.website_url).toBe(WALLET_SOURCE_URL)
  })

  it("USDC out is a sell, and says what left the wallet", () => {
    const r = run({ from: WIF, to: USDC, fromAmount: "900", toAmount: "24" })!
    expect(r.content).toBe("WIF 900")
    expect(r.transaction_data).toMatchObject({ tradeType: "sell", tokenMint: WIF.mint })
  })

  it("a pair with no USDC is not a receipt this vocabulary can tell", () => {
    expect(run({ from: SOL, to: WIF, fromAmount: "1", toAmount: "900" })).toBeNull()
  })

  it("a gas top-up is not a call, so USDC to SOL says nothing", () => {
    expect(run({ from: USDC, to: SOL, fromAmount: "600", toAmount: "3" })).toBeNull()
    expect(run({ from: SOL, to: USDC, fromAmount: "3", toAmount: "600" })).toBeNull()
  })

  it("USDC to USDC is not a trade in any direction", () => {
    expect(run({ from: USDC, to: USDC })).toBeNull()
  })

  it("reads grouped display strings without turning money into NaN", () => {
    const r = run({ fromAmount: "1,234.50", toAmount: "9,000" })!
    expect(r.content).toBe("WIF $1,234.50")
    expect(r.transaction_data.tokenAmount).toBe(9000)
  })

  it("says nothing when the size cannot be read at all", () => {
    expect(run({ fromAmount: "", toAmount: "" })).toBeNull()
  })

  it("never claims a source that would pay somebody caller credit", () => {
    // Credit is paid from spot_trades.source_url; this posts under the app.
    expect(run()!.website_url).not.toContain("x.com")
  })
})
