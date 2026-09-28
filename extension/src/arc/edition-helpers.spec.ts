import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * EVERY HELPER THE ARC EDITION TOUCHED, IN BOTH EDITIONS.
 *
 * Each case imports the module fresh under the env the build would inline:
 * unset (the store) or NEXT_PUBLIC_ARC_EDITION=true. The store half pins the
 * old behaviour; the Arc half pins the patch.
 */

const sendApiRequest = vi.fn()
const hasPageWallet = vi.fn(async () => true)
const connectPageWallet = vi.fn(async () => "PhantomSender111111111111111111111111111111")
const signWithPageWallet = vi.fn(async () => "sig")
vi.mock("~/helpers/pageWalletBridge", () => ({
  hasPageWallet: () => hasPageWallet(),
  connectPageWallet: () => connectPageWallet(),
  signWithPageWallet: (...a: unknown[]) => signWithPageWallet(...(a as [])),
}))
vi.mock("~/lib/fetchService", () => ({
  STALE_CONTEXT: "poppin/stale-context",
  sendApiRequest: (...a: unknown[]) => sendApiRequest(...a),
}))

const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const ARC_USDC = "0x3600000000000000000000000000000000000000"
const EURC_TESTNET = "0x89b50855aa3be2f677cd6303cec089b5f319d72a"
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"

async function fresh<T>(path: string, arc: boolean): Promise<T> {
  vi.unstubAllEnvs()
  if (arc) vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "true")
  vi.resetModules()
  return (await import(/* @vite-ignore */ path)) as T
}

beforeEach(() => {
  sendApiRequest.mockReset()
  hasPageWallet.mockClear()
  connectPageWallet.mockClear()
  signWithPageWallet.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("depositWatch", () => {
  type M = typeof import("~/helpers/depositWatch")
  const row = (mint: string | null, amountUi = 25) =>
    ({ signature: "s", direction: "in", mint, amountUi, at: null }) as const

  it("store: Solana USDC is the money, and a mintless row is SOL", async () => {
    const m = await fresh<M>("~/helpers/depositWatch", false)
    expect(m.USDC_MINT).toBe(SOLANA_USDC)
    expect(m.shouldSpeak(row(SOLANA_USDC), null, null)).toBe(true)
    expect(m.depositNotification(row(SOLANA_USDC), "USDC").message).toBe(
      "Landed in your Poppin balance. Ready when you are.",
    )
  })

  it("Arc: the ERC-20 at 0x3600…0000 is the money, and speaks on its own name", async () => {
    const m = await fresh<M>("~/helpers/depositWatch", true)
    expect(m.USDC_MINT).toBe(ARC_USDC)
    expect(m.shouldSpeak(row(ARC_USDC), null, null)).toBe(true)
    expect(m.shouldSpeak(row(ARC_USDC, 0.001), null, null)).toBe(false)
    expect(m.fmtTransferAmount(1000, ARC_USDC)).toBe("1,000.00")
    const note = m.depositNotification(row(ARC_USDC), "USDC", "EURC")
    expect(note).toEqual({ title: "Received 25.00 USDC", message: "Your $EURC buy is ready." })
    // The Solana mint is a stranger here: it must resolve like any token.
    expect(m.shouldSpeak(row(SOLANA_USDC), null, null)).toBe(false)
  })
})

describe("chain constants in the background's deposit toast", () => {
  it("names a mintless transfer SOL in the store and USDC on Arc", async () => {
    expect((await fresh<typeof import("./chain")>("./chain", false)).NATIVE_SYMBOL).toBe("SOL")
    expect((await fresh<typeof import("./chain")>("./chain", true)).NATIVE_SYMBOL).toBe("USDC")
  })
})

describe("activityRow", () => {
  type M = typeof import("~/helpers/activityRow")
  const known = () => null

  it("store: a mintless send is SOL, and a mint is shortened as before", async () => {
    const m = await fresh<M>("~/helpers/activityRow", false)
    const r = m.activityRow({ transaction_type: "send_sol", amount: "0.5" }, known)
    expect(`${r.verb} ${r.subject}`).toBe("Sent SOL")
    expect(m.shortMint(WIF)).toBe("EKpQ…zcjm")
  })

  it("Arc: a mintless transfer is USDC, a 0x mint keeps its prefix, and swaps read Arc USDC", async () => {
    const m = await fresh<M>("~/helpers/activityRow", true)
    const r = m.activityRow({ transaction_type: "receive_token", amount: "12" }, known)
    expect(`${r.verb} ${r.subject}`).toBe("Received USDC")
    expect(m.shortMint(EURC_TESTNET)).toBe("0x89b5…d72a")
    const buy = m.activityRow(
      {
        transaction_type: "swap",
        amount: "0",
        metadata: { inputMint: ARC_USDC, outputMint: EURC_TESTNET, inputAmount: "25000000" },
      },
      (mint) => (mint === EURC_TESTNET ? "EURC" : null),
    )
    expect(`${buy.verb} ${buy.subject} ${buy.amountText}`).toBe("Bought EURC $25.00")
  })
})

describe("walletSwapReceipt", () => {
  type M = typeof import("~/helpers/walletSwapReceipt")
  const args = (from: string, to: string) => ({
    from: { mint: from, symbol: "X" },
    to: { mint: to, symbol: "EURC" },
    fromAmount: "25",
    toAmount: "23",
    signature: "0xsig",
  })

  it("store: a buy is Solana USDC out", async () => {
    const m = await fresh<M>("~/helpers/walletSwapReceipt", false)
    expect(m.walletSwapReceipt(args(SOLANA_USDC, WIF))?.transaction_data).toMatchObject({ tradeType: "buy" })
    expect(m.walletSwapReceipt(args(ARC_USDC, EURC_TESTNET))).toBeNull()
  })

  it("Arc: a buy is Arc USDC out", async () => {
    const m = await fresh<M>("~/helpers/walletSwapReceipt", true)
    expect(m.walletSwapReceipt(args(ARC_USDC, EURC_TESTNET))?.transaction_data).toMatchObject({
      tradeType: "buy",
      tokenMint: EURC_TESTNET,
    })
    expect(m.walletSwapReceipt(args(SOLANA_USDC, WIF))).toBeNull()
  })
})

describe("presence", () => {
  type M = typeof import("~/helpers/presence")

  it("store: the page count is asked of the server", async () => {
    sendApiRequest.mockResolvedValue({ onlineCount: 4 })
    const m = await fresh<M>("~/helpers/presence", false)
    expect(await m.fetchPagePresence("x.com")).toBe(4)
    expect(sendApiRequest).toHaveBeenCalledTimes(1)
  })

  it("Arc: nothing is asked, the count is unknown and site chat is not here", async () => {
    const m = await fresh<M>("~/helpers/presence", true)
    expect(await m.fetchPagePresence("x.com")).toBeNull()
    expect(await m.pingSitePresence("x.com")).toEqual({ count: null, available: false })
    const seen: unknown[] = []
    const stop = m.startSitePresenceHeartbeat("x.com", (r) => seen.push(r))
    await new Promise((r) => setTimeout(r, 0))
    stop()
    expect(seen).toEqual([{ count: null, available: false }])
    expect(sendApiRequest).not.toHaveBeenCalled()
  })
})

describe("the X chip's offline lists", () => {
  type M = typeof import("~/entries/contentScript/x/xMatch")

  it("store: $WIF resolves locally to its Solana mint", async () => {
    const m = await fresh<M>("~/entries/contentScript/x/xMatch", false)
    expect(m.resolveCashtag("$WIF")?.mint).toBe(WIF)
    expect(m.isCuratedMint(WIF)).toBe(true)
    expect(m.isCuratedMint(EURC_TESTNET)).toBe(false)
  })

  it("Arc: no Solana mint is named locally, and Circle's assets are the reviewed ones", async () => {
    const m = await fresh<M>("~/entries/contentScript/x/xMatch", true)
    expect(m.resolveCashtag("$WIF")).toBeNull()
    expect(m.resolveCashtag("$EURC")).toBeNull()
    expect(m.matchTweet("$WIF to the moon", ["$WIF"])).toBeNull()
    expect(m.isCuratedMint(WIF)).toBe(false)
    expect(m.isCuratedMint(EURC_TESTNET)).toBe(true)
    expect(m.isCuratedMint(ARC_USDC)).toBe(true)
  })
})

describe("openPanelRoom", () => {
  type M = typeof import("~/components/SpotCard/pagePosts")
  const route = `/token/${EURC_TESTNET}`

  async function opened(arc: boolean, r: string): Promise<unknown> {
    const stored: Record<string, unknown> = {}
    const g = globalThis as { chrome?: unknown }
    const old = g.chrome
    g.chrome = {
      storage: { local: { set: async (kv: Record<string, unknown>) => Object.assign(stored, kv) } },
      runtime: { sendMessage: () => {} },
    }
    try {
      const m = await fresh<M>("~/components/SpotCard/pagePosts", arc)
      m.openPanelRoom(r)
      await new Promise((res) => setTimeout(res, 0))
      return stored.initialRoute
    } finally {
      g.chrome = old
    }
  }

  it("store: a 0x token room is dropped, as before", async () => {
    expect(await opened(false, route)).toBeUndefined()
  })

  it("Arc: a 0x token room opens", async () => {
    expect(await opened(true, route)).toBe(route)
  })
})

describe("topUpFromPage", () => {
  type M = typeof import("~/components/SpotCard/pagePosts")

  async function toppedUp(arc: boolean) {
    const stored: Record<string, unknown> = {}
    const routes: string[] = []
    const g = globalThis as { chrome?: unknown }
    const old = g.chrome
    g.chrome = {
      storage: { local: { set: async (kv: Record<string, unknown>) => Object.assign(stored, kv) } },
      runtime: { sendMessage: () => {} },
    }
    sendApiRequest.mockResolvedValue({ tx: "base64tx" })
    try {
      const m = await fresh<M>("~/components/SpotCard/pagePosts", arc)
      const funded = await m.topUpFromPage(12, (r) => routes.push(r), "exact")
      await new Promise((res) => setTimeout(res, 0))
      return { funded, routes, route: stored.initialRoute }
    } finally {
      g.chrome = old
    }
  }

  it("store: a wallet on the page signs the transfer, as before", async () => {
    const r = await toppedUp(false)
    expect(r.funded).toBe(true)
    expect(r.routes).toEqual(["signed"])
    expect(sendApiRequest).toHaveBeenCalledWith(expect.objectContaining({ url: "/fund/wallet-deposit-tx" }))
  })

  it("Arc: the address screen, with no wallet asked and no route called", async () => {
    const r = await toppedUp(true)
    expect(r.funded).toBe(false)
    expect(r.routes).toEqual(["no-wallet"])
    expect(r.route).toBe("/receive")
    expect(hasPageWallet).not.toHaveBeenCalled()
    expect(connectPageWallet).not.toHaveBeenCalled()
    expect(sendApiRequest).not.toHaveBeenCalled()
  })
})
