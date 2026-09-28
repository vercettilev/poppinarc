import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const path = (p: string) => join(__dirname, "..", p)
const read = (p: string) => readFileSync(path(p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * THE WALLET SCREEN CARRIED THREE THINGS THAT WERE NOT THE WALLET:
 * a second chain whose backend left in August, a second buy/sell terminal
 * beside the TradeSheet every other surface uses, and a headline that
 * disagreed with the front door's. The audit called it the panel's heaviest
 * room (1,507 lines plus a 3,538-line folder). These pin the removals so
 * nothing walks back in without a reason.
 */
describe("the wallet screen holds one chain", () => {
  const wallet = stripComments(read("views/wallet-ui.tsx"))

  it("has no chain picker and no chain-gated reads", () => {
    expect(wallet).not.toMatch(/ChainSelector|useChainStore|selectedChain|isArc/)
    // The files behind the picker are gone, not merely unreferenced: an
    // import that still resolves is an invitation to re-wire it.
    for (const f of [
      "src/components/ChainSelector.tsx",
      "src/store/useChainStore.ts",
      "src/config/arcChain.ts",
      "src/hooks/useArc.ts",
      "src/services/ArcService.ts",
      "src/views/ArcBridge.tsx",
      "src/views/ArcTokenRow.tsx",
    ]) {
      expect(existsSync(join(__dirname, "..", "..", f))).toBe(false)
    }
  })

  it("leaves the deposit screen one network to explain", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).not.toMatch(/Arc \(Testnet\)|chain === "arc"/)
    expect(rcv).toMatch(/note: "Send USDC on Solana\."/)
  })
})

describe("the wallet screen holds one trade path", () => {
  const wallet = stripComments(read("views/wallet-ui.tsx"))

  it("sends a token row to the asset's room, not to a terminal of its own", () => {
    expect(existsSync(path("views/wallet/Swap.tsx"))).toBe(false)
    expect(wallet).not.toMatch(/"swap"/)
    expect(wallet).toMatch(/navigate\(`\/token\/\$\{token\.mint\}`\)/)
  })

  it("stops importing the terminal's quote and execute hooks", () => {
    expect(wallet).not.toMatch(/useTerminalTokens/)
  })
})

/**
 * FOUR FILES CARRIED THE SAME SEVEN DEAD IMPORTS — a chain picker, a chain
 * store, a flag, a balance hook and two Arc views, imported and never read.
 * They are the reason the removal above looked bigger than it was.
 */
describe("no file imports a chain it cannot select", () => {
  for (const f of [
    "views/wallet/Send.tsx",
    "views/wallet/ExportPrivateKey.tsx",
    "views/wallet/TipDialog.tsx",
  ]) {
    it(`${f} is clean`, () => {
      expect(read(f)).not.toMatch(
        /ChainSelector|useChainStore|ARC_ENABLED|useArcBalance|ArcTokenRow|ArcBridge|ChainIcons/,
      )
    })
  }
})
