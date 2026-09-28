// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

/**
 * THE TOP-UP DOOR, on the surface where it matters: a reader on a tweet with
 * no balance. The chip's contract is small and every part of it is a decision
 * that can silently regress, so each gets a case:
 *
 *   · a page with no wallet must still reach the panel (the old door);
 *   · a closed wallet popup must say nothing and change nothing;
 *   · a successful transfer must report TRUE, because the chip throws away
 *     its cached book on that word alone — reporting true without money
 *     having moved would show a balance that does not exist;
 *   · the amount must cover the buy that prompted it.
 */

const bridge = vi.hoisted(() => ({
  hasPageWallet: vi.fn(async (): Promise<boolean> => true),
  connectPageWallet: vi.fn(async (): Promise<string | null> => "SENDER"),
  signWithPageWallet: vi.fn(async (_tx: string): Promise<string | null> => "SIGNATURE"),
}))
vi.mock("~/helpers/pageWalletBridge", () => bridge)

const api = vi.hoisted(() => ({
  sendApiRequest: vi.fn(async (_args: unknown) => ({ tx: "BASE64" }) as unknown),
}))
vi.mock("~/lib/fetchService", () => api)

const panel = vi.hoisted(() => ({ set: vi.fn(async () => {}), send: vi.fn() }))
vi.stubGlobal("chrome", {
  storage: { local: { set: panel.set } },
  runtime: { sendMessage: panel.send },
})

const load = async () => (await import("~/components/SpotCard/pagePosts")).topUpFromPage

describe("topping up from the page's wallet", () => {
  it("moves money and reports it, so the chip can trust its next read", async () => {
    const topUp = await load()
    await expect(topUp(25)).resolves.toBe(true)
    expect(api.sendApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/fund/wallet-deposit-tx",
        data: expect.objectContaining({ senderAddress: "SENDER" }),
      }),
    )
    expect(bridge.signWithPageWallet).toHaveBeenCalledWith("BASE64")
  })

  it("covers the buy that prompted it, and never asks for less than the floor", async () => {
    const topUp = await load()
    const amountFor = async (need?: number) => {
      api.sendApiRequest.mockClear()
      await topUp(need)
      return (
        api.sendApiRequest.mock.calls[0][0] as unknown as {
          data: { amountUsd: number }
        }
      ).data.amountUsd
    }
    // A top-up equal to the buy leaves nothing for a tick against them.
    // Exactly the buy: a dollar-sized buy spends exactly its dollars, no buffer.
    expect(await amountFor(25)).toBe(25)
    expect(await amountFor(4.37)).toBeGreaterThanOrEqual(5)
    expect(await amountFor(undefined)).toBeGreaterThanOrEqual(5)
  })

  it("a deposit the reader sized by hand is moved as named, not rounded past itself", async () => {
    // Measured 2026-09-17: the fund box's "$50" asked Phantom for 51 USDC,
    // because the shortfall rounding above served both callers.
    const topUp = await load()
    api.sendApiRequest.mockClear()
    await topUp(50, undefined, "exact")
    expect(
      (api.sendApiRequest.mock.calls[0][0] as unknown as { data: { amountUsd: number } }).data
        .amountUsd,
    ).toBe(50)
  })

  it("falls back to the panel when the page has no wallet", async () => {
    bridge.hasPageWallet.mockResolvedValueOnce(false)
    // Cleared HERE: this assertion is about what this case did, and the
    // mock carries every call the file made before it.
    api.sendApiRequest.mockClear()
    const topUp = await load()
    await expect(topUp(10)).resolves.toBe(false)
    expect(panel.send).toHaveBeenCalled()
    expect(api.sendApiRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: "/fund/wallet-deposit-tx" }),
    )
  })

  it("opens the funding screen when the wallet does not connect", async () => {
    bridge.connectPageWallet.mockResolvedValueOnce(null)
    panel.send.mockClear()
    const topUp = await load()
    await expect(topUp(10)).resolves.toBe(false)
    // This used to open nothing, on the reasoning that a closed popup is a
    // decision. But a locked or silent Phantom answers the same null, and
    // measured 2026-09-27 two readers pressed Deposit, saw nothing, and
    // never came back. The funding screen is the fallback a failed
    // signature already had (Lev, 2026-09-27).
    expect(panel.send).toHaveBeenCalled()
  })

  it("reports false when the signature never comes", async () => {
    bridge.signWithPageWallet.mockResolvedValueOnce(null)
    const topUp = await load()
    await expect(topUp(10)).resolves.toBe(false)
  })
})
