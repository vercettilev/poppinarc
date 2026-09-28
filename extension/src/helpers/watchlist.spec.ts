import { describe, expect, it } from "vitest"
import {
  buildDigest,
  dayKeyOf,
  digestDue,
  digestMint,
  isWatched,
  MAX_WATCHED,
  toggleWatch,
  type DigestState,
  type WatchedAsset,
} from "./watchlist"

const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"

/** Local constructor, so these read the same in any timezone. */
const at = (h: number, day = 24) =>
  new Date(2026, 7, day, h, 0, 0).getTime()

describe("the star", () => {
  it("adds newest first and removes on a second press", () => {
    let list: WatchedAsset[] = []
    list = toggleWatch(list, { mint: WIF, symbol: "$WIF" }, 1)
    list = toggleWatch(list, { mint: BONK, symbol: "$BONK" }, 2)
    expect(list.map((w) => w.mint)).toEqual([BONK, WIF])
    expect(isWatched(list, WIF)).toBe(true)

    list = toggleWatch(list, { mint: WIF, symbol: "$WIF" }, 3)
    expect(isWatched(list, WIF)).toBe(false)
    expect(list).toHaveLength(1)
  })

  it("drops the OLDEST interest at the cap, never refuses the newest", () => {
    let list: WatchedAsset[] = []
    for (let i = 0; i < MAX_WATCHED + 3; i++) {
      list = toggleWatch(list, { mint: `m${i}`, symbol: null }, i)
    }
    expect(list).toHaveLength(MAX_WATCHED)
    // The most recent press is always in.
    expect(list[0].mint).toBe(`m${MAX_WATCHED + 2}`)
    expect(isWatched(list, "m0")).toBe(false)
  })
})

describe("when a digest is due", () => {
  const spoken = (dayKey: string | null): DigestState => ({
    lastDayKey: dayKey,
    lastTotalUsd: 100,
  })

  it("waits for a decent hour", () => {
    expect(digestDue(spoken(null), at(3))).toBe(false)
    expect(digestDue(spoken(null), at(8))).toBe(false)
    expect(digestDue(spoken(null), at(9))).toBe(true)
  })

  it("speaks once a day, not once per check", () => {
    const today = dayKeyOf(at(9))
    expect(digestDue(spoken(today), at(11))).toBe(false)
    expect(digestDue(spoken(today), at(21))).toBe(false)
    // Tomorrow morning it may speak again.
    expect(digestDue(spoken(today), at(9, 25))).toBe(true)
  })
})

describe("the digest itself", () => {
  const held = (o: Partial<{ symbol: string; mint: string; valueUsd: number; changePct: number }> = {}) => ({
    symbol: "$WIF",
    mint: WIF,
    valueUsd: 120,
    changePct: 4,
    ...o,
  })
  const fresh: DigestState = { lastDayKey: null, lastTotalUsd: null }

  it("says nothing at all to somebody with nothing", () => {
    expect(
      buildDigest({ holdings: [], watched: [], state: fresh }, at(9)),
    ).toBeNull()
  })

  it("reports the book and, once there is a yesterday, the change", () => {
    const first = buildDigest({ holdings: [held()], watched: [], state: fresh }, at(9))!
    expect(first.title).toBe("Your book is $120.00")
    // No claim of change on the first one: there is no yesterday to compare.
    expect(first.title).not.toContain("%")
    expect(first.nextState.lastTotalUsd).toBe(120)

    const second = buildDigest(
      { holdings: [held({ valueUsd: 132 })], watched: [], state: first.nextState },
      at(9, 25),
    )!
    expect(second.title).toContain("+10.0% since yesterday")
  })

  it("leads the message with the biggest mover, and marks a watched one", () => {
    const d = buildDigest(
      {
        holdings: [held({ changePct: 2 })],
        watched: [{ symbol: "$BONK", mint: BONK, changePct: -18 }],
        state: fresh,
      },
      at(9),
    )!
    expect(d.message).toContain("$BONK -18.0%")
    expect(d.message).toContain("(watching)")
  })

  it("speaks about the watchlist alone when nothing is held", () => {
    const d = buildDigest(
      { holdings: [], watched: [{ symbol: "$BONK", mint: BONK, changePct: 12 }], state: fresh },
      at(9),
    )!
    expect(d.title).toBe("$BONK is +12.0% today")
    expect(d.nextState.lastTotalUsd).toBeNull()
  })

  it("ignores unpriced rows rather than counting them as zero", () => {
    const d = buildDigest(
      {
        holdings: [held({ valueUsd: 120 }), held({ mint: BONK, valueUsd: null as unknown as number, changePct: null as unknown as number })],
        watched: [],
        state: fresh,
      },
      at(9),
    )!
    // A missing price is unknown, and unknown is not zero — the total is the
    // one row we can actually value.
    expect(d.title).toBe("Your book is $120.00")
  })

  it("lands the tap on whatever moved most", () => {
    expect(
      digestMint({
        holdings: [held({ changePct: 2 })],
        watched: [{ symbol: "$BONK", mint: BONK, changePct: -18 }],
        state: fresh,
      }),
    ).toBe(BONK)
  })
})
