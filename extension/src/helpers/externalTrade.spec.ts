import { beforeEach, describe, expect, it, vi } from "vitest"

type Signed = { signature: string } | { error: "cancelled" | "failed" | "timeout" | "no-wallet" }
const { bridge, svc } = vi.hoisted(() => ({
  bridge: {
    hasPageWallet: vi.fn(async (): Promise<boolean> => true),
    connectPageWallet: vi.fn(async (): Promise<string | null> => "WALLET111111111111111111111111111111111111111"),
    signWithPageWalletDetailed: vi.fn(async (): Promise<Signed> => ({ signature: "5".repeat(88) })),
  },
  svc: {
    prepareExternalOrder: vi.fn(async () => ({ preparedId: "o1", transaction: "BBBB", orderKey: "OK9" })),
    prepareExternalCancel: vi.fn(async () => ({ preparedId: "c1", transaction: "CCCC", orderKey: "OK9" })),
    submitExternalOrder: vi.fn(async () => ({ orderKey: "OK9", signature: "5".repeat(88), dryRun: false, kind: "create" as const })),
    prepareExternalTrade: vi.fn(async () => ({
      preparedId: "p1",
      transaction: "AAAA",
      outAmountRaw: "1000",
      feeUsd: 0.05,
      category: "meme",
    })),
    submitExternalTrade: vi.fn(async () => ({
      signature: "5".repeat(88),
      dryRun: false,
      category: "meme",
      outAmountRaw: "1000",
      shareUrl: null as string | null,
    })),
  },
}))
vi.mock("~/helpers/pageWalletBridge", () => bridge)
vi.mock("~/services/SpotAssetService", () => svc)

import {
  cancelOrderWithPageWallet,
  ExternalTradeError,
  orderWithPageWallet,
  tradeWithPageWallet,
} from "./externalTrade"

beforeEach(() => {
  vi.clearAllMocks()
  bridge.hasPageWallet.mockResolvedValue(true)
  bridge.connectPageWallet.mockResolvedValue("WALLET111111111111111111111111111111111111111")
  bridge.signWithPageWalletDetailed.mockResolvedValue({ signature: "5".repeat(88) })
})

describe("a trade signed by the reader's own wallet", () => {
  it("prepares on the server, signs on the page, submits the signature", async () => {
    const r = await tradeWithPageWallet({
      side: "buy",
      mint: "MINT",
      amountUsd: 5,
      sourceUrl: "https://x.com/a/status/1",
      expectedAddress: "WALLET111111111111111111111111111111111111111",
    })
    expect(svc.prepareExternalTrade).toHaveBeenCalledWith({
      side: "buy",
      mint: "MINT",
      amountUsd: 5,
      sourceUrl: "https://x.com/a/status/1",
    })
    expect(bridge.signWithPageWalletDetailed).toHaveBeenCalledWith("AAAA")
    expect(svc.submitExternalTrade).toHaveBeenCalledWith({ preparedId: "p1", signature: "5".repeat(88) })
    expect(r.signature).toBe("5".repeat(88))
  })

  it("a sell sends the raw amount", async () => {
    await tradeWithPageWallet({ side: "sell", mint: "MINT", amountRaw: "123" })
    expect(svc.prepareExternalTrade).toHaveBeenCalledWith({ side: "sell", mint: "MINT", amountRaw: "123" })
  })

  it("refuses a Phantom on a different wallet than the account, before building anything", async () => {
    bridge.connectPageWallet.mockResolvedValue("OTHER111111111111111111111111111111111111111")
    await expect(
      tradeWithPageWallet({ side: "buy", mint: "MINT", amountUsd: 5, expectedAddress: "WALLET111111111111111111111111111111111111111" }),
    ).rejects.toMatchObject({ reason: "wrong-wallet" })
    expect(svc.prepareExternalTrade).not.toHaveBeenCalled()
  })

  it("says so when the reader closes Phantom, and submits nothing", async () => {
    bridge.signWithPageWalletDetailed.mockResolvedValue({ error: "cancelled" })
    const err = await tradeWithPageWallet({ side: "buy", mint: "MINT", amountUsd: 5 }).catch((e) => e)
    expect(err).toBeInstanceOf(ExternalTradeError)
    expect(err.reason).toBe("cancelled")
    expect(err.message).toMatch(/Closed in Phantom/)
    expect(svc.submitExternalTrade).not.toHaveBeenCalled()
  })

  it("says so when there is no wallet on the page", async () => {
    bridge.hasPageWallet.mockResolvedValue(false)
    await expect(tradeWithPageWallet({ side: "buy", mint: "MINT", amountUsd: 5 })).rejects.toMatchObject({ reason: "no-wallet" })
  })
})

describe("a standing order placed and taken back by the reader's own wallet", () => {
  it("prepares, signs on the page, submits, and answers like the custodial call", async () => {
    const r = await orderWithPageWallet({
      mint: "MINT",
      side: "buy",
      amountUsd: 20,
      triggerPriceUsd: 0.5,
      expectedAddress: "WALLET111111111111111111111111111111111111111",
    })
    expect(svc.prepareExternalOrder).toHaveBeenCalledWith({ mint: "MINT", side: "buy", amountUsd: 20, triggerPriceUsd: 0.5 })
    expect(bridge.signWithPageWalletDetailed).toHaveBeenCalledWith("BBBB")
    expect(svc.submitExternalOrder).toHaveBeenCalledWith({ preparedId: "o1", signature: "5".repeat(88) })
    expect(r).toEqual({ orderKey: "OK9", signature: "5".repeat(88), dryRun: false })
  })

  it("cancels the same way", async () => {
    const r = await cancelOrderWithPageWallet("OK9")
    expect(svc.prepareExternalCancel).toHaveBeenCalledWith("OK9")
    expect(bridge.signWithPageWalletDetailed).toHaveBeenCalledWith("CCCC")
    expect(r.orderKey).toBe("OK9")
  })

  it("a closed Phantom window places nothing", async () => {
    bridge.signWithPageWalletDetailed.mockResolvedValue({ error: "cancelled" })
    await expect(orderWithPageWallet({ mint: "MINT", side: "buy", amountUsd: 20, triggerPriceUsd: 0.5 })).rejects.toMatchObject({ reason: "cancelled" })
    expect(svc.submitExternalOrder).not.toHaveBeenCalled()
  })
})
