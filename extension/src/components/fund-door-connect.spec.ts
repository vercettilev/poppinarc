import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * THE SECOND DOOR UNDER THE FUNDING ASK, AND THE ROAD IT TAKES.
 *
 * ── THE NUMBER ──────────────────────────────────────────────────────────────
 * Measured in production 2026-09-22, team and test accounts excluded: eight
 * strangers have ever signed in, none has opened the funding screen, none has
 * traded, and no deposit has landed in the product's lifetime. Every one of
 * those zeroes is behind one step, a person moving money, and not one person
 * has taken it. Somebody already holding USDC in a wallet can skip the step
 * entirely, so the door that skips it belongs directly under the one that
 * asks — quieter, because it hands the fees and a signature back to the
 * reader, and it is the better door for exactly one person.
 *
 * ── THE TRAP THIS FILE EXISTS TO HOLD ───────────────────────────────────────
 * A wallet extension injects into WEB PAGES and never into another
 * extension's pages, so the side panel cannot reach Phantom at all. The
 * tempting fix is a second road (open a tab on app.poppin.so and sign there),
 * and it would be a second money path to keep in step with the first forever.
 * There is already exactly one road — panel → background → the active tab's
 * content script → the MAIN-world bridge — and every wallet trade, order,
 * cancel and top-up already travels it. This door travels it too, and when
 * there is NO page beside the panel the background's own sentence is what
 * prints, because no tab we could open would help: the wallet only appears in
 * a page the reader is already on.
 *
 * The door itself is read from source, because jsdom + @mui cannot render
 * these views (see components/panel-fit-320.spec.ts). Everything below it
 * runs: the relay's answer with no page to ask, and the handshake on the
 * page. The two ends of the bridge meet for real in
 * helpers/page-wallet-sign-message.spec.ts, which cannot live here — this
 * file mocks the bridge, and a file-level vi.mock reaches every describe in
 * it.
 */

describe("the quieter door under the funding ask", () => {
  const door = stripComments(read("components/FundDoor.tsx"))

  it("still asks for a deposit first, in the verb every other door uses", () => {
    expect(door).toMatch(/Deposit USDC/)
    expect(door).toMatch(/Every chip becomes a Buy button\. Network fees are on us\./)
  })

  it("offers connecting a wallet as a second sentence, not a second offer", () => {
    expect(door).toMatch(/or connect a wallet you already have/)
    // Literal, because this one moves where the money lives: what they get,
    // then the fact that replaces the question a reader asks next. The
    // Settings card states both in these same words.
    expect(door).toMatch(/Trade the USDC you already hold\. Each trade signs in Phantom\./)
    // Quiet: no glow, no filled card, no accent border. Those belong to the
    // ask above it (JUICE.glowRest is the money-surface tier).
    const second = door.slice(door.indexOf("or connect a wallet"))
    expect(second).not.toMatch(/glowRest/)
  })

  it("takes the road that already exists, and opens nothing", () => {
    expect(door).toMatch(/connectWalletViaPage/)
    expect(door).toMatch(/from "~\/helpers\/panelExternalTrade"/)
    // The whole trap in one assertion: no second rail, no page of our own.
    expect(door).not.toMatch(/chrome\.tabs\.create|window\.open|openPanelAt/)
    // And it never talks to Phantom from here, which it cannot do anyway.
    expect(door).not.toMatch(/window\.solana|window\.phantom/)
  })

  it("prints the server's refusal as it arrives", () => {
    // Three refusals, three different next moves for the reader: an address
    // another account owns, a Poppin wallet that still holds money, an
    // account already trading from a wallet. One sentence of our own would
    // take the move away.
    expect(door).toMatch(/const m = \(e as \{ message\?: string \}\)\?\.message/)
    expect(door).toMatch(/setNote\(typeof m === "string" && m\.length > 0/)
  })

  it("re-reads the book once the wallet is on, because every row above is now stale", () => {
    expect(door).toMatch(/onConnected\?\.\(\)/)
    expect(door).toMatch(/invalidateQueries\(\{ queryKey: \["current-user"\] \}\)/)
    const view = stripComments(read("views/SpotPositions.tsx"))
    expect(view).toMatch(/<FundDoor onConnected=\{refresh\} \/>/)
  })
})

describe("no page beside the panel", () => {
  const bg = stripComments(read("entries/background/main.ts"))

  it("is answered by the relay every wallet trade already uses", () => {
    expect(bg).toMatch(/request\.type === "EXTERNAL_TRADE"/)
    expect(bg).toMatch(
      /error: "Open X, Reddit or any web page beside the panel, then try again\."/,
    )
    const panel = stripComments(read("helpers/panelExternalTrade.ts"))
    expect(panel).toMatch(/kind: "connect"/)
    // The connect goes through askPage, which is the trade's own channel —
    // not a second message type the background would have to learn.
    expect(panel).toMatch(/return askPage\(\{ kind: "connect" \}\)/)
  })

  it("reaches the caller as the sentence, so the door can print it", async () => {
    const sent: unknown[] = []
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: undefined,
        sendMessage: (msg: unknown, cb: (r: unknown) => void) => {
          sent.push(msg)
          cb({ ok: false, error: "Open X, Reddit or any web page beside the panel, then try again." })
        },
      },
    })
    const { connectWalletViaPage } = await import("~/helpers/panelExternalTrade")
    await expect(connectWalletViaPage()).rejects.toThrow(
      "Open X, Reddit or any web page beside the panel, then try again.",
    )
    expect(sent).toEqual([{ type: "EXTERNAL_TRADE", args: { kind: "connect" } }])
    vi.unstubAllGlobals()
  })
})

/**
 * THE HANDSHAKE ON THE PAGE. Connect, ask the SERVER for the sentence, sign
 * that text, post the signature. The account it joins is the token's.
 */
const { bridge, wallet } = vi.hoisted(() => ({
  bridge: {
    hasPageWallet: vi.fn(async () => true),
    connectPageWallet: vi.fn(async (): Promise<string | null> => "WALLET1111"),
    signMessageWithPageWallet: vi.fn(async (): Promise<string | null> => "c2ln"),
    signWithPageWalletDetailed: vi.fn(),
  },
  wallet: {
    WalletService: {
      walletSignInSentence: vi.fn(async () => ({
        isoTime: "2026-09-22T12:00:00.000Z",
        message: "Poppin: sign in with this wallet.\n\nWallet: WALLET1111\nTime: 2026-09-22T12:00:00.000Z",
      })),
      connectTradingWallet: vi.fn(async () => ({
        wallet_mode: "external",
        external_address: "WALLET1111",
      })),
    },
  },
}))
vi.mock("~/helpers/pageWalletBridge", () => bridge)
vi.mock("~/services/WalletService", () => wallet)

describe("connecting the wallet, on the page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridge.hasPageWallet.mockResolvedValue(true)
    bridge.connectPageWallet.mockResolvedValue("WALLET1111")
    bridge.signMessageWithPageWallet.mockResolvedValue("c2ln")
    wallet.WalletService.connectTradingWallet.mockResolvedValue({
      wallet_mode: "external",
      external_address: "WALLET1111",
    })
  })

  it("signs the sentence the SERVER composed, never one of its own", async () => {
    const { connectWalletOnPage } = await import("~/helpers/externalTrade")
    const r = await connectWalletOnPage()

    expect(wallet.WalletService.walletSignInSentence).toHaveBeenCalledWith("WALLET1111")
    // The exact string the server handed back. Composing the wording here
    // would mean two implementations agreeing forever, and the one that
    // drifts produces signatures that verify against nothing.
    expect(bridge.signMessageWithPageWallet).toHaveBeenCalledWith(
      "Poppin: sign in with this wallet.\n\nWallet: WALLET1111\nTime: 2026-09-22T12:00:00.000Z",
    )
    expect(wallet.WalletService.connectTradingWallet).toHaveBeenCalledWith({
      address: "WALLET1111",
      signature: "c2ln",
      isoTime: "2026-09-22T12:00:00.000Z",
    })
    expect(r).toEqual({
      address: "WALLET1111",
      wallet_mode: "external",
      external_address: "WALLET1111",
    })
  })

  it("says the wallet is not on this page before it asks the server anything", async () => {
    bridge.hasPageWallet.mockResolvedValue(false)
    const { connectWalletOnPage } = await import("~/helpers/externalTrade")
    await expect(connectWalletOnPage()).rejects.toMatchObject({
      reason: "no-wallet",
      message: "Phantom is not on this page. Unlock it and try again.",
    })
    expect(wallet.WalletService.walletSignInSentence).not.toHaveBeenCalled()
  })

  it("a closed window is a decision, and nothing is posted", async () => {
    bridge.signMessageWithPageWallet.mockResolvedValue(null)
    const { connectWalletOnPage } = await import("~/helpers/externalTrade")
    await expect(connectWalletOnPage()).rejects.toMatchObject({
      reason: "cancelled",
      message: "Closed in Phantom before signing.",
    })
    expect(wallet.WalletService.connectTradingWallet).not.toHaveBeenCalled()
  })

  it("lets the server's refusal through untouched", async () => {
    // "Your Poppin wallet still holds $42.50…" has to survive the whole way
    // up to the panel: it is the one refusal with an instruction in it.
    wallet.WalletService.connectTradingWallet.mockRejectedValue({
      status: 400,
      message:
        "Your Poppin wallet still holds $42.50. Trades come from one wallet at a time, so send that out first (Wallet › Send), then connect.",
    })
    const { connectWalletOnPage } = await import("~/helpers/externalTrade")
    await expect(connectWalletOnPage()).rejects.toMatchObject({
      message:
        "Your Poppin wallet still holds $42.50. Trades come from one wallet at a time, so send that out first (Wallet › Send), then connect.",
    })
  })
})
