import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  COPY_FROM_TTL_MS,
  DEFAULT_COPY_USD,
  copyAmountUsd,
  copyFromLine,
  readCopyFrom,
  type CopyFrom,
} from "./copyFrom"

const NOW = 1_800_000_000_000
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"
const SOL = "So11111111111111111111111111111111111111112"
const from = (over: Partial<CopyFrom> = {}): CopyFrom => ({
  mint: WIF,
  side: "buy",
  who: "Lev",
  usd: 250,
  at: NOW - 120_000,
  ...over,
})

/**
 * THE SENTENCE HAS TO SURVIVE THE DOOR. The notification names a person
 * and a size; the tap used to land on a bare Buy sheet that mentioned
 * neither, and the reader had to remember why they were standing there.
 */
describe("what brought the reader here", () => {
  it("is read back only for this coin, and only while it is still news", () => {
    expect(readCopyFrom(from(), WIF, NOW)).not.toBeNull()
    // Another coin's news is not this room's business.
    expect(readCopyFrom(from(), SOL, NOW)).toBeNull()
    // And a day later it is history, not a reason.
    expect(readCopyFrom(from({ at: NOW - COPY_FROM_TTL_MS - 1 }), WIF, NOW)).toBeNull()
  })

  it("refuses anything malformed rather than drawing half a sentence", () => {
    expect(readCopyFrom(undefined, WIF, NOW)).toBeNull()
    expect(readCopyFrom({}, WIF, NOW)).toBeNull()
    expect(readCopyFrom(from({ who: "" }), WIF, NOW)).toBeNull()
    expect(readCopyFrom(from({ side: "hold" as unknown as "buy" }), WIF, NOW)).toBeNull()
  })

  it("says who, which way, how much and how long ago, and nothing else", () => {
    expect(copyFromLine(from(), NOW)).toBe("Lev bought $250 of this · 2m ago")
    expect(copyFromLine(from({ side: "sell", usd: 1500, at: NOW - 3 * 3600_000 }), NOW)).toBe(
      "Lev sold $1.5k of this · 3h ago",
    )
    expect(copyFromLine(from({ at: NOW - 5_000 }), NOW)).toBe("Lev bought $250 of this · just now")
  })
})

/**
 * THE AMOUNT IS THE READER'S. eToro scales a copy to the copier's own
 * allocation and every Solana bot asks for a fixed per-copy size; none of
 * them spends the leader's absolute size on the follower's behalf.
 */
describe("the copy opens on the reader's own size", () => {
  it("uses what they last spent, and the middle preset before they have spent anything", () => {
    expect(copyAmountUsd(40)).toBe(40)
    expect(copyAmountUsd("40")).toBe(40)
    expect(copyAmountUsd(undefined)).toBe(DEFAULT_COPY_USD)
    expect(copyAmountUsd(0)).toBe(DEFAULT_COPY_USD)
    expect(copyAmountUsd(-5)).toBe(DEFAULT_COPY_USD)
    expect(copyAmountUsd("nonsense")).toBe(DEFAULT_COPY_USD)
  })

  it("never reaches for the other person's size", () => {
    const room = readFileSync(join(__dirname, "..", "views/TokenView.tsx"), "utf8")
    expect(room).toMatch(/copyAmountUsd\(stored\?\.\[LAST_TRADE_USD_KEY\]\)/)
    expect(room).not.toMatch(/setSheetUsd\([^)]*from\.usd/)
  })
})

describe("the three surfaces agree", () => {
  it("the notification invites a copy on a buy and still only informs on a sell", () => {
    const f = readFileSync(join(__dirname, "followTrades.ts"), "utf8")
    expect(f).toMatch(/Tap to copy\./)
    expect(f).toMatch(/and you hold it\. Tap to open \$\{t\}\./)
  })

  it("the room is told before the notification exists, so a tap cannot outrun it", () => {
    const bg = readFileSync(join(__dirname, "..", "entries/background/main.ts"), "utf8")
    const writeAt = bg.indexOf("[COPY_FROM_KEY]: {")
    const notifyAt = bg.indexOf("`social:${n.side}:${now}:${n.mint}`")
    expect(writeAt).toBeGreaterThan(0)
    expect(notifyAt).toBeGreaterThan(writeAt)
  })

  it("one phrasing of who, shared by the notification and the line", () => {
    const f = readFileSync(join(__dirname, "followTrades.ts"), "utf8")
    expect(f).toMatch(/export function people\(/)
    const bg = readFileSync(join(__dirname, "..", "entries/background/main.ts"), "utf8")
    expect(bg).toMatch(/who: people\(n\.names, n\.peopleCount\)/)
  })
})
