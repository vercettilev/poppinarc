import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ARC_USDC,
  chainFacts,
  explorerTxUrl,
  isEvmAddress,
  isEvmTxHash,
  panelRoomPattern,
  shortAddress,
  SOLANA_USDC_MINT,
} from "./chain"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const HASH = `0x${"ab".repeat(32)}`
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW"

describe("the chain facts", () => {
  it("are the Solana literals they replaced in the store build", async () => {
    const m = await import("./chain")
    expect(m.USDC_MINT).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    expect(m.NATIVE_SYMBOL).toBe("SOL")
    expect(m.CHAIN.networkName).toBe("Solana")
    expect(m.CHAIN.explorer).toBe("https://solscan.io")
  })

  it("are Arc's in the Arc edition, testnet unless told otherwise", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "true")
    vi.resetModules()
    const m = await import("./chain")
    expect(m.USDC_MINT).toBe("0x3600000000000000000000000000000000000000")
    expect(m.NATIVE_SYMBOL).toBe("USDC")
    expect(m.CHAIN.networkName).toBe("Arc")
    expect(m.CHAIN.explorer).toBe("https://explorer.testnet.arc.io")
  })

  it("point at the mainnet explorer on a mainnet build", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "true")
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "mainnet")
    vi.resetModules()
    const m = await import("./chain")
    expect(m.CHAIN.explorer).toBe("https://explorer.arc.io")
  })

  it("keeps Arc USDC lowercase, as the wire does", () => {
    expect(ARC_USDC).toBe(ARC_USDC.toLowerCase())
    expect(chainFacts(true).usdcMint).toBe(ARC_USDC)
    expect(chainFacts(false).usdcMint).toBe(SOLANA_USDC_MINT)
  })
})

describe("explorerTxUrl", () => {
  it("links every Solana signature to Solscan, as before", () => {
    expect(explorerTxUrl(SIG, chainFacts(false))).toBe(`https://solscan.io/tx/${SIG}`)
  })

  it("links a 0x hash on the Arc explorer of the build's network", () => {
    expect(explorerTxUrl(HASH, chainFacts(true, "testnet"))).toBe(`https://explorer.testnet.arc.io/tx/${HASH}`)
    expect(explorerTxUrl(HASH, chainFacts(true, "mainnet"))).toBe(`https://explorer.arc.io/tx/${HASH}`)
    expect(explorerTxUrl(HASH.toUpperCase().replace("0X", "0x"), chainFacts(true))).toBe(
      `https://explorer.testnet.arc.io/tx/${HASH}`,
    )
  })

  it("links nothing on Arc for a value that is not a hash yet", () => {
    const arc = chainFacts(true)
    expect(explorerTxUrl("3f2b8c1e-circle-transaction-id", arc)).toBeNull()
    expect(explorerTxUrl(SIG, arc)).toBeNull()
    expect(explorerTxUrl("", arc)).toBeNull()
  })
})

describe("addresses", () => {
  it("tells a 0x address from a 0x hash", () => {
    expect(isEvmAddress(ARC_USDC)).toBe(true)
    expect(isEvmAddress(HASH)).toBe(false)
    expect(isEvmTxHash(HASH)).toBe(true)
    expect(isEvmTxHash(ARC_USDC)).toBe(false)
    expect(isEvmAddress(SOLANA_USDC_MINT)).toBe(false)
  })

  it("shortens a 0x address past its prefix, and base58 the store's way", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678")
    expect(shortAddress("7SrjabcdefghijklmnopqrstuvwxyzABCDEFGHt13A")).toBe("7Srj…t13A")
  })
})

describe("panelRoomPattern", () => {
  const mint = "0x89b50855aa3be2f677cd6303cec089b5f319d72a"
  it("opens only base58 token rooms in the store build", () => {
    const re = panelRoomPattern(false)
    expect(re.test("/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm")).toBe(true)
    expect(re.test(`/token/${mint}`)).toBe(false)
    expect(re.test("/profile/u1")).toBe(true)
    expect(re.test("/feed")).toBe(true)
  })

  it("opens 0x token rooms too in the Arc edition, and still refuses the rest", () => {
    const re = panelRoomPattern(true)
    expect(re.test(`/token/${mint}`)).toBe(true)
    expect(re.test("/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm")).toBe(true)
    expect(re.test(`/token/${mint}00`)).toBe(false)
    expect(re.test("/token/0x12")).toBe(false)
    expect(re.test("/settings")).toBe(false)
    expect(re.test("/token/../../evil")).toBe(false)
  })
})
