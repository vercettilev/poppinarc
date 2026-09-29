import { describe, expect, it, vi } from "vitest"
import { tradeWithOwnWallet, type OwnTradeStatus } from "./ownWalletTrade"

/**
 * The wait around arc-api's confirm window: the receipt a buy or sell always
 * answers when the wallet finished, and one plain sentence for every other end.
 */
function harness(states: OwnTradeStatus[]) {
  let t = 0
  const prepare = vi.fn(async () => ({
    preparedId: "0c3e5f6a-1111-4222-8333-944455556666",
    confirmUrl: "https://arc-api-mainnet-production.up.railway.app/api/v1/wallet/confirm#id.key",
    summary: { title: "Buy $25.00 of Bitcoin", detail: "You get about 0.0003 Bitcoin." },
  }))
  const status = vi.fn(async () => states.shift() ?? { state: "waiting" as const })
  const open = vi.fn(async () => {})
  const wait = vi.fn(async (ms: number) => {
    t += ms
  })
  return { prepare, status, open, wait, now: () => t }
}

const buy = { side: "buy" as const, mint: "0x171a4217b86a807a64eb94757db6849fb4bdbaa0", amountUsd: 25, sourceUrl: "https://x.com/a/status/1" }

describe("tradeWithOwnWallet", () => {
  it("prepares the trade, opens the confirm window, and answers with the receipt once the wallet is done", async () => {
    const h = harness([{ state: "waiting" }, { state: "sending", signature: "0xabc" }, { state: "done", signature: "0xabc", outAmountRaw: "30000" }])
    const r = await tradeWithOwnWallet(buy, h)
    expect(h.prepare).toHaveBeenCalledWith({ side: "buy", mint: buy.mint, amountUsd: 25, sourceUrl: buy.sourceUrl })
    expect(h.open).toHaveBeenCalledWith(expect.stringContaining("/api/v1/wallet/confirm#"), "0c3e5f6a-1111-4222-8333-944455556666")
    expect(r).toEqual({ signature: "0xabc", dryRun: false, category: "spot", outAmountRaw: "30000", outUsdcRaw: "30000", shareUrl: null })
  })

  it("sends a sell's raw amount, never a dollar figure", async () => {
    const h = harness([{ state: "done", signature: "0xdef", outAmountRaw: "24990000" }])
    await tradeWithOwnWallet({ side: "sell", mint: buy.mint, amountRaw: "30000" }, h)
    expect(h.prepare).toHaveBeenCalledWith({ side: "sell", mint: buy.mint, amountRaw: "30000" })
  })

  it("says the window was closed, as a cancel the chip does not print as an error", async () => {
    const h = harness([{ state: "cancelled" }])
    await expect(tradeWithOwnWallet(buy, h)).rejects.toMatchObject({ reason: "cancelled", message: "Closed before your wallet confirmed." })
  })

  it("passes arc-api's own sentence through when the trade failed", async () => {
    const h = harness([{ state: "failed", error: "That trade did not go through. Only the network fee was spent." }])
    await expect(tradeWithOwnWallet(buy, h)).rejects.toThrow("Only the network fee was spent.")
  })

  it("stops waiting after four minutes, and says whether the wallet had already sent it", async () => {
    const quiet = harness([])
    await expect(tradeWithOwnWallet(buy, quiet)).rejects.toThrow("Your wallet has not confirmed yet.")
    const sent = harness(Array.from({ length: 400 }, () => ({ state: "sending" as const, signature: "0xabc" })))
    await expect(tradeWithOwnWallet(buy, sent)).rejects.toThrow("still settling")
  })

  it("rides over a failed poll", async () => {
    const h = harness([])
    h.status.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ state: "done", signature: "0x1", outAmountRaw: "1" })
    await expect(tradeWithOwnWallet(buy, h)).resolves.toMatchObject({ signature: "0x1" })
  })
})
