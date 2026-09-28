import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("a wallet account's trade from the panel", () => {
  it("is relayed by the background to the active web page", () => {
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/request\.type === "EXTERNAL_TRADE"/)
    expect(bg).toMatch(/type: "POPPIN_EXTERNAL_TRADE", args: request\.args/)
    expect(bg).toMatch(/Open X, Reddit or any web page beside the panel/)
  })

  it("is signed by the page's content script with the account's own wallet", () => {
    const cs = stripComments(read("entries/contentScript/primary/main.tsx"))
    expect(cs).toMatch(/msg\?\.type === "POPPIN_EXTERNAL_TRADE"/)
    expect(cs).toMatch(/expectedAddress: tw\.address/)
  })

  it("the sheet routes buys, sells and standing orders by wallet mode", () => {
    const sheet = stripComments(read("components/TradeSheet.tsx"))
    expect(sheet).toMatch(/external\s*\?\s*await tradeViaPage\(\{ side: "buy"/)
    expect(sheet).toMatch(/external\s*\?\s*await tradeViaPage\(\{ side: "sell"/)
    expect(sheet).toMatch(/external\s*\?\s*await orderViaPage\(\{ mint: asset\.mint, side: "buy"/)
    expect(sheet).toMatch(/external\s*\?\s*await orderViaPage\(\{ mint: asset\.mint, side: "sell"/)
    expect(sheet).not.toMatch(/come next/)
    const orders = stripComments(read("components/OpenOrders.tsx"))
    expect(orders).toMatch(/external \? await cancelOrderViaPage\(orderKey\) : await cancelOrderAsset\(orderKey\)/)
  })

  it("the chip's orders and cancels sign on the page for a wallet account", () => {
    const cs = stripComments(read("entries/contentScript/primary/main.tsx"))
    expect(cs).toMatch(/await orderWithPageWallet\(\{ \.\.\.dto, expectedAddress: tw\.address \}\)/)
    expect(cs).toMatch(/cancelOrderWithPageWallet\(orderKey, tw\.address\)/)
    expect(cs).toMatch(/a\.kind === "order"/)
  })

  it("settings lets an account choose whose wallet trades", () => {
    const card = stripComments(read("components/TradingWalletCard.tsx"))
    expect(card).toMatch(/\/wallets\/linked\/trading/)
    expect(card).toMatch(/Trade from this/)
    expect(card).toMatch(/app\.poppin\.so\/fund/)
    expect(stripComments(read("views/Settings.tsx"))).toMatch(/<TradingWalletCard \/>/)
  })

  it("the deposit screen and the welcome sentence tell a wallet account the truth", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).toMatch(/Add USDC to your wallet/)
    expect(rcv).toMatch(/!external \? " Network fees are on us\."/)
    const yi = stripComments(read("entries/welcome/components/steps/YoureInStep.tsx"))
    expect(yi).toMatch(/Fees are yours, as always\./)
  })
})

describe("the bridge is on every page the chip is on", () => {
  it("is ensured on its own, even when the content script already runs", () => {
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/async function ensurePageWallet\(tabId: number\)/)
    // The mark is a VERSION now, and the gate is "have >= want" rather than
    // "is it set" — see entries/page-wallet-version.spec.ts for why a
    // boolean locked every open tab to the bridge it was updated away from.
    expect(bg).toMatch(/args: \[PAGE_WALLET_VERSION\]/)
    expect(bg).toMatch(/return have >= want/)
    expect(bg).toMatch(/request\.type === "ENSURE_PAGE_WALLET"/)
    expect(bg).toMatch(/if \(await contentScriptAlreadyRunning\(tabId\)\) \{\s*await ensurePageWallet\(tabId\)/)
  })
  it("the probe asks for the bridge before it says there is no wallet", () => {
    const bridge = stripComments(read("helpers/pageWalletBridge.ts"))
    expect(bridge).toMatch(/type: "ENSURE_PAGE_WALLET"/)
    expect(stripComments(read("entries/contentScript/pageWallet.ts"))).toMatch(
      /__poppinPageWallet = PAGE_WALLET_VERSION/,
    )
  })
  it("a deposit that landed reaches every open sheet", () => {
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/type: "POPPIN_BOOK_CHANGED"/)
    const cs = stripComments(read("entries/contentScript/primary/main.tsx"))
    expect(cs).toMatch(/xStripCtl\?\.onBookChanged\(\)/)
  })
})
