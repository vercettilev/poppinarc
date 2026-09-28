import { describe, expect, it } from "vitest"
import {
  depositNotification,
  depositStep,
  fmtTransferAmount,
  GENESIS,
  shouldSpeak,
  USDC_MINT,
} from "./depositWatch"

const row = (over: Partial<Parameters<typeof depositNotification>[0]> = {}) => ({
  signature: "5ig" + "x".repeat(40),
  direction: "in" as const,
  mint: null,
  amountUi: 3,
  at: "2026-08-28T20:00:00.000Z",
  ...over,
})

describe("the deposit watcher's step", () => {
  it("seeding on existing history remembers where it ends, silently", () => {
    // A new browser on an old wallet must not toast last month's deposits.
    const step = depositStep(null, {
      ok: true,
      cursor: "newest",
      transfers: [row()],
    })
    expect(step.notify).toEqual([])
    expect(step.nextCursor).toBe("newest")
  })

  it("an empty history seeds to GENESIS, and the first deposit ever speaks", () => {
    // The review's high finding: a fresh wallet has no history, the seed
    // learned nothing, and the user's FIRST funding — the exact request
    // that motivated this feature — was swallowed. GENESIS is the fix:
    // history that starts empty makes everything after it news.
    const seeded = depositStep(null, { ok: true, cursor: null, transfers: [] })
    expect(seeded.nextCursor).toBe(GENESIS)

    const first = row()
    const step = depositStep(GENESIS, {
      ok: true,
      cursor: "first-sig",
      transfers: [first],
    })
    expect(step.notify).toEqual([first])
    expect(step.nextCursor).toBe("first-sig")
  })

  it("after the seed, every transfer speaks and the cursor advances", () => {
    const t = row()
    const step = depositStep("older", {
      ok: true,
      cursor: "newest",
      transfers: [t],
    })
    expect(step.notify).toEqual([t])
    expect(step.nextCursor).toBe("newest")
  })

  it("a failed look holds state everywhere — seed included", () => {
    // ok:false means "could not look", not "saw nothing". Treating an RPC
    // hiccup as an empty history would seed GENESIS on a wallet with real
    // history and replay it as news next tick.
    expect(depositStep(null, { ok: false, cursor: null, transfers: [] }).nextCursor).toBeNull()
    expect(depositStep("kept", { ok: false, cursor: null, transfers: [] }).nextCursor).toBe("kept")
    expect(depositStep(GENESIS, { ok: false, cursor: null, transfers: [] }).nextCursor).toBe(GENESIS)
  })

  it("a quiet chain keeps the cursor it had", () => {
    expect(
      depositStep("kept", { ok: true, cursor: "kept", transfers: [] }).nextCursor,
    ).toBe("kept")
    expect(
      depositStep(GENESIS, { ok: true, cursor: null, transfers: [] }).nextCursor,
    ).toBe(GENESIS)
  })
})

describe("what deserves Poppin's voice", () => {
  it("SOL and real USDC speak on their own names", () => {
    expect(shouldSpeak(row(), null, null)).toBe(true)
    expect(shouldSpeak(row({ mint: USDC_MINT, amountUi: 1000 }), null, null)).toBe(true)
  })

  it("a stranger's token calling itself USDC never speaks", () => {
    // The attacker mints a token, names it "USDC", sends dust: the toast
    // would be their ad in our voice, one tap from a Buy on their contract.
    expect(shouldSpeak(row({ mint: "FakeMint" }), "USDC", 1)).toBe(false)
    expect(shouldSpeak(row({ mint: "FakeMint" }), " usdc ", 1)).toBe(false)
    expect(shouldSpeak(row({ mint: "FakeMint" }), "SOL", 100)).toBe(false)
  })

  it("an unnameable or unpriceable token stays quiet", () => {
    expect(shouldSpeak(row({ mint: "JunkMint" }), null, null)).toBe(false)
    expect(shouldSpeak(row({ mint: "OddMint" }), "ODD", null)).toBe(false)
  })

  it("below a cent is a knock, not a deposit", () => {
    expect(shouldSpeak(row({ mint: USDC_MINT, amountUi: 0.001 }), null, null)).toBe(false)
    expect(shouldSpeak(row({ mint: "WifMint", amountUi: 0.001 }), "WIF", 1)).toBe(false)
    expect(shouldSpeak(row({ mint: "WifMint", amountUi: 5 }), "WIF", 1)).toBe(true)
  })
})

describe("the words on the toast", () => {
  it("dollars speak in dollars", () => {
    expect(fmtTransferAmount(1000, USDC_MINT)).toBe("1,000.00")
    const n = depositNotification(row({ mint: USDC_MINT, amountUi: 1000 }), "USDC")
    expect(n.title).toBe("Received 1,000.00 USDC")
  })

  it("SOL trims to what is real, no trailing zeros", () => {
    expect(fmtTransferAmount(3, null)).toBe("3")
    expect(fmtTransferAmount(0.123456789, null)).toBe("0.123457")
    const n = depositNotification(row({ amountUi: 3 }), "SOL")
    expect(n.title).toBe("Received 3 SOL")
    /**
     * SOL is not the money. "Ready when you are" is a promise the product
     * keeps for USDC alone (a buy spends USDC), so an inbound SOL toast
     * says where it landed and what to do with it — it does not
     * congratulate the reader into a Buy that will refuse them.
     */
    expect(n.message).toContain("Swap it to USDC")
    expect(n.message).not.toContain("Ready when you are")
  })

  it("money leaving says so plainly", () => {
    const n = depositNotification(row({ direction: "out", amountUi: 3 }), "SOL")
    expect(n.title).toBe("Sent 3 SOL")
  })
})
