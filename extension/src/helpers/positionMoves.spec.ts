import { describe, expect, it } from "vitest"
import {
  moveNotification,
  positionMoves,
  type HeldPosition,
} from "./positionMoves"

const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"

const pos = (o: Partial<HeldPosition> = {}): HeldPosition => ({
  mint: WIF,
  symbol: "WIF",
  uiAmount: 8.06,
  priceUsd: 0.2,
  valueUsd: 1.61,
  ...o,
})

describe("the anchor rule", () => {
  it("seeds silently on first sighting, never announces the past", () => {
    const r = positionMoves({ positions: [pos()], marks: {}, now: 5 })
    expect(r.moves).toEqual([])
    expect(r.nextMarks[WIF]).toEqual({ usd: 0.2, at: 5 })
  })

  it("says nothing under the threshold and keeps the anchor", () => {
    const r = positionMoves({
      positions: [pos({ priceUsd: 0.215 })], // +7.5%
      marks: { [WIF]: { usd: 0.2, at: 1 } },
      now: 5,
    })
    expect(r.moves).toEqual([])
    expect(r.nextMarks[WIF]).toEqual({ usd: 0.2, at: 1 })
  })

  it("fires at ±10% and re-anchors — the next word costs another 10%", () => {
    const r = positionMoves({
      positions: [pos({ priceUsd: 0.224, valueUsd: 1.81 })], // +12%
      marks: { [WIF]: { usd: 0.2, at: 1 } },
      now: 9,
    })
    expect(r.moves).toHaveLength(1)
    expect(r.moves[0].pct).toBeCloseTo(12, 1)
    expect(r.nextMarks[WIF]).toEqual({ usd: 0.224, at: 9 })
  })

  it("fires on the way down too", () => {
    const r = positionMoves({
      positions: [pos({ priceUsd: 0.178 })], // -11%
      marks: { [WIF]: { usd: 0.2, at: 1 } },
      now: 9,
    })
    expect(r.moves[0].pct).toBeLessThan(0)
  })

  it("keeps quiet about pocket lint whatever the percentage", () => {
    const r = positionMoves({
      positions: [pos({ priceUsd: 0.24, valueUsd: 0.4, uiAmount: 1.6 })], // +20%, 40 cents
      marks: { [WIF]: { usd: 0.2, at: 1 } },
      now: 9,
    })
    expect(r.moves).toEqual([])
    // and it does NOT re-anchor: the day the position grows past dust, the
    // move is still measured from where it really started
    expect(r.nextMarks[WIF]).toEqual({ usd: 0.2, at: 1 })
  })

  it("neither fires off a missing price nor loses the anchor to one", () => {
    const r = positionMoves({
      positions: [pos({ priceUsd: null })],
      marks: { [WIF]: { usd: 0.2, at: 1 } },
      now: 9,
    })
    expect(r.moves).toEqual([])
    expect(r.nextMarks[WIF]).toEqual({ usd: 0.2, at: 1 })
  })

  it("drops the anchor of a mint no longer held", () => {
    const r = positionMoves({
      positions: [],
      marks: { [WIF]: { usd: 0.2, at: 1 } },
      now: 9,
    })
    expect(r.nextMarks).toEqual({})
  })
})

describe("the words", () => {
  it("leads with the direction, ends with the door", () => {
    expect(
      moveNotification({ mint: WIF, symbol: "WIF", pct: 12.4, nowUsd: 0.2248, valueUsd: 1.81 }),
    ).toEqual({
      title: "Your $WIF is up +12.4%",
      message: "Now $0.2248, your position is $1.81. Tap to open $WIF.",
    })
    expect(
      moveNotification({ mint: WIF, symbol: null, pct: -11.2, nowUsd: 0.178, valueUsd: 1.43 })
        .title,
    ).toBe("Your EKpQ… is down -11.2%")
  })
})
