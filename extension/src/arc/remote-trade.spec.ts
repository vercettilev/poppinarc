import { describe, expect, it } from "vitest"
import { remoteTradable } from "./remoteTrade"

describe("remoteTradable", () => {
  it("opens Base and Arbitrum on Arc mainnet, for any token and the hand-kept ones that live there", () => {
    expect(remoteTradable("remote:base:0x532f27101965dd16442e59d40670faf5ebb142e4", "mainnet")).toBe(true)
    expect(remoteTradable("remote:arbitrum:0x912ce59144191c1204e64559fe8253a0e49e6548", "mainnet")).toBe(true)
    expect(remoteTradable("remote:aero", "mainnet")).toBe(true)
    expect(remoteTradable("remote:virtual", "mainnet")).toBe(true)
    expect(remoteTradable("remote:eth", "mainnet")).toBe(true)
  })

  it("keeps everything else a preview: other chains, native ETH, testnet, and Arc's own tokens", () => {
    expect(remoteTradable("remote:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933", "mainnet")).toBe(false)
    expect(remoteTradable("remote:solana:EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "mainnet")).toBe(false)
    expect(remoteTradable("remote:hyperliquid:PURR/USDC", "mainnet")).toBe(false)
    expect(remoteTradable("remote:base:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "mainnet")).toBe(false)
    expect(remoteTradable("remote:base:0x532f27101965dd16442e59d40670faf5ebb142e4", "testnet")).toBe(false)
    expect(remoteTradable("0x171a4217b86a807a64eb94757db6849fb4bdbaa0", "mainnet")).toBe(false)
  })

})
