import { describe, expect, it } from "vitest"
import {
  COOLDOWN_MS,
  DUST_USD,
  followTradeNews,
  followTradeNotification,
  type FollowTradeRow,
} from "./followTrades"

const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"

const row = (o: Partial<FollowTradeRow> = {}): FollowTradeRow => ({
  userId: "u-ada",
  name: "ada",
  mint: WIF,
  symbol: "$WIF",
  side: "buy",
  amountUsd: 50,
  at: 1_000,
  ...o,
})

const run = (
  rows: FollowTradeRow[],
  opts: { held?: string[]; marks?: Record<string, { at: number }>; now?: number } = {},
) =>
  followTradeNews({
    rows,
    held: new Set(opts.held ?? []),
    marks: opts.marks ?? {},
    now: opts.now ?? 10_000,
  })

describe("consensus over chatter", () => {
  it("groups an asset into ONE piece of news, newest name first", () => {
    const r = run([
      row({ userId: "u-ada", name: "ada", at: 3_000 }),
      row({ userId: "u-can", name: "can", at: 5_000 }),
      row({ userId: "u-lev", name: "lev", at: 4_000 }),
    ])
    expect(r.news).toHaveLength(1)
    expect(r.news[0].peopleCount).toBe(3)
    expect(r.news[0].names[0]).toBe("can")
    expect(r.news[0].totalUsd).toBe(150)
  })

  it("counts PEOPLE, not trades — five taps by one person is one person", () => {
    const r = run([
      row({ at: 1_000 }),
      row({ at: 2_000 }),
      row({ at: 3_000 }),
      row({ at: 4_000 }),
      row({ at: 5_000 }),
    ])
    expect(r.news[0].peopleCount).toBe(1)
    expect(r.news[0].names).toEqual(["ada"])
  })

  it("keeps a buy and a sell of the same asset apart", () => {
    const r = run(
      [row({ side: "buy" }), row({ userId: "u-can", name: "can", side: "sell" })],
      { held: [WIF] },
    )
    expect(r.news).toHaveLength(2)
    expect(new Set(r.news.map((n) => n.side))).toEqual(new Set(["buy", "sell"]))
  })
})

describe("buys invite, sells inform", () => {
  it("says nothing about a sale of something the reader does not hold", () => {
    const r = run([row({ side: "sell" })], { held: [] })
    expect(r.news).toEqual([])
  })

  it("says it when they DO hold it", () => {
    const r = run([row({ side: "sell" })], { held: [WIF] })
    expect(r.news).toHaveLength(1)
  })
})

describe("rarity", () => {
  it("drops dust without spending the cooldown on it", () => {
    const r = run([row({ amountUsd: DUST_USD - 1 })])
    expect(r.news).toEqual([])
    // Nothing was said, so nothing is marked — the next real trade in this
    // asset still gets through.
    expect(r.nextMarks[WIF]).toBeUndefined()
  })

  it("stays quiet for an hour after speaking about an asset", () => {
    const r = run([row({ at: 9_000 })], {
      marks: { [WIF]: { at: 10_000 - COOLDOWN_MS + 1 } },
      now: 10_000,
    })
    expect(r.news).toEqual([])
  })

  it("speaks again once the hour is up, and re-marks", () => {
    const now = 10_000_000
    const r = run([row({ at: now - 100 })], {
      marks: { [WIF]: { at: now - COOLDOWN_MS - 1 } },
      now,
    })
    expect(r.news).toHaveLength(1)
    expect(r.nextMarks[WIF]).toEqual({ at: now })
  })

  it("caps a loud round and keeps the strongest agreement", () => {
    const mints = ["m1", "m2", "m3", "m4", "m5"]
    const rows = mints.flatMap((m, i) =>
      // m5 has the most people behind it and arrives LAST.
      Array.from({ length: i + 1 }, (_, k) =>
        row({ mint: m, symbol: null, userId: `u${m}${k}`, name: `n${k}` }),
      ),
    )
    const r = run(rows)
    expect(r.news).toHaveLength(3)
    expect(r.news.map((n) => n.mint)).toEqual(["m5", "m4", "m3"])
    // The ones that were dropped are NOT marked as spoken: the next round
    // can still tell the reader about them.
    expect(r.nextMarks["m1"]).toBeUndefined()
  })
})

describe("the words", () => {
  it("leads with the person, ends with the action", () => {
    expect(
      followTradeNotification({
        mint: WIF,
        symbol: "$WIF",
        side: "buy",
        names: ["ada"],
        peopleCount: 1,
        totalUsd: 50,
        at: 1,
      }),
    ).toEqual({
      title: "ada bought $WIF",
      message: "$50 worth. Tap to copy.",
    })
  })

  it("names two people, then counts the rest", () => {
    const two = followTradeNotification({
      mint: WIF, symbol: "WIF", side: "buy",
      names: ["ada", "can"], peopleCount: 2, totalUsd: 1500, at: 1,
    })
    expect(two.title).toBe("ada and can bought $WIF")
    expect(two.message).toContain("$1.5k")

    const many = followTradeNotification({
      mint: WIF, symbol: "$WIF", side: "buy",
      names: ["ada", "can", "lev"], peopleCount: 3, totalUsd: 300, at: 1,
    })
    expect(many.title).toBe("ada and 2 others bought $WIF")
  })

  it("a sale says why the reader is being told", () => {
    const sell = followTradeNotification({
      mint: BONK, symbol: "$BONK", side: "sell",
      names: ["ada"], peopleCount: 1, totalUsd: 80, at: 1,
    })
    expect(sell.title).toBe("ada sold $BONK")
    expect(sell.message).toContain("you hold it")
  })

  it("never invents a ticker for an unnamed mint", () => {
    const n = followTradeNotification({
      mint: WIF, symbol: null, side: "buy",
      names: ["ada"], peopleCount: 1, totalUsd: 20, at: 1,
    })
    expect(n.title).toBe("ada bought EKpQ…")
  })
})
