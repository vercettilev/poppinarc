import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * The number the funding roadmap turns on is "how often is there no wallet
 * on the page at all" — because the panel's address screen is a dead end
 * for exactly those readers and for nobody else. The boolean topUpFromPage
 * returns folds that ending together with three others, so these lock the
 * reported route apart from the returned value.
 */
const bridge = {
  hasPageWallet: vi.fn(),
  connectPageWallet: vi.fn(),
  signWithPageWallet: vi.fn(),
}
vi.mock("~/helpers/pageWalletBridge", () => bridge)

const api = { sendApiRequest: vi.fn() }
vi.mock("~/lib/fetchService", () => api)

describe("topUpFromPage route reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.sendApiRequest.mockResolvedValue({ tx: "BASE64TX" })
  })

  const run = async () => {
    const seen: string[] = []
    const { topUpFromPage } = await import("./pagePosts")
    const ok = await topUpFromPage(25, (r) => seen.push(r))
    return { ok, seen }
  }

  it("says no-wallet when the page has none, which is the measurable one", async () => {
    bridge.hasPageWallet.mockResolvedValue(false)
    expect(await run()).toMatchObject({ ok: false, seen: ["no-wallet"] })
  })

  it("a closed wallet popup is declined, NOT no-wallet", async () => {
    bridge.hasPageWallet.mockResolvedValue(true)
    bridge.connectPageWallet.mockResolvedValue(null)
    expect(await run()).toMatchObject({ ok: false, seen: ["declined"] })
  })

  it("a transaction our own backend would not build is unbuildable", async () => {
    bridge.hasPageWallet.mockResolvedValue(true)
    bridge.connectPageWallet.mockResolvedValue("SENDER")
    api.sendApiRequest.mockResolvedValue({})
    expect(await run()).toMatchObject({ ok: false, seen: ["unbuildable"] })
  })

  it("a signature that never came back is unsigned, and still not no-wallet", async () => {
    bridge.hasPageWallet.mockResolvedValue(true)
    bridge.connectPageWallet.mockResolvedValue("SENDER")
    bridge.signWithPageWallet.mockResolvedValue(null)
    expect(await run()).toMatchObject({ ok: false, seen: ["unsigned"] })
  })

  it("the whole fast path working reports signed", async () => {
    bridge.hasPageWallet.mockResolvedValue(true)
    bridge.connectPageWallet.mockResolvedValue("SENDER")
    bridge.signWithPageWallet.mockResolvedValue("SIG")
    expect(await run()).toMatchObject({ ok: true, seen: ["signed"] })
  })

  it("a reporter that throws never costs the reader their top-up", async () => {
    bridge.hasPageWallet.mockResolvedValue(true)
    bridge.connectPageWallet.mockResolvedValue("SENDER")
    bridge.signWithPageWallet.mockResolvedValue("SIG")
    const { topUpFromPage } = await import("./pagePosts")
    await expect(
      topUpFromPage(25, () => {
        throw new Error("telemetry down")
      }),
    ).resolves.toBe(true)
  })
})

/**
 * A wallet that did not connect used to end on nothing: the reader pressed
 * Deposit and no screen came (two readers in a week, 2026-09-27). Both page
 * doors now open the funding screen, the fallback a failed signature
 * already had.
 */
describe("a wallet that does not connect still opens the funding screen", () => {
  const set = vi.fn(async () => undefined)
  const send = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { set, get: vi.fn(async () => ({})) } },
      runtime: { sendMessage: send, lastError: undefined },
    }
    bridge.hasPageWallet.mockResolvedValue(true)
    bridge.connectPageWallet.mockResolvedValue(null)
  })

  it("from the chip's Deposit", async () => {
    const { topUpFromPage } = await import("./pagePosts")
    const seen: string[] = []
    expect(await topUpFromPage(25, (r) => seen.push(r))).toBe(false)
    expect(seen).toEqual(["declined"])
    await new Promise((r) => setTimeout(r, 0))
    expect(set).toHaveBeenCalledWith({ initialRoute: "/receive" })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "TOGGLE_SIDE_PANEL" }))
  })

  it("from a Phantom account's conversion", async () => {
    const { convertFromPage } = await import("./pagePosts")
    const seen: string[] = []
    expect(await convertFromPage(25, (r) => seen.push(r))).toBe(false)
    expect(seen).toEqual(["declined"])
    await new Promise((r) => setTimeout(r, 0))
    expect(set).toHaveBeenCalledWith({ initialRoute: "/receive" })
  })
})

