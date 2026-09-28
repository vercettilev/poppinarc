import { describe, expect, it } from "vitest"
import {
  CLIP_MAX_USD,
  DEFAULT_CLIP,
  clampClipUsd,
  clampSellPct,
  readClip,
} from "./clip"
import { MIN_ORDER_USD } from "./orderMath"

/**
 * The clip exists so the resting chip can say what a press will do. Today
 * the button says "Buy" and the amount is invisible until a sheet opens and
 * silently defaults to $25 — so the fact that decides how much money moves
 * is the one fact the feed does not show. These tests are about the CLAMP,
 * because that is where a convenience turns into a hazard.
 */

describe("the clip's ceiling", () => {
  it("never remembers more than the largest preset", () => {
    // A Max pick on a funded account can be hundreds of dollars.
    // Remembering it would turn one decision into a standing default that
    // grows with the balance — the exact shape of an accident.
    expect(clampClipUsd(5_000)).toBe(CLIP_MAX_USD)
    expect(clampClipUsd(101)).toBe(CLIP_MAX_USD)
  })

  it("never remembers less than the engine will accept", () => {
    // A clip below the minimum would arm a button that is refused, which
    // teaches the reader the product is broken.
    expect(clampClipUsd(1)).toBe(MIN_ORDER_USD)
    expect(clampClipUsd(0)).toBe(MIN_ORDER_USD)
    expect(clampClipUsd(-40)).toBe(MIN_ORDER_USD)
  })

  it("keeps an ordinary size exactly", () => {
    expect(clampClipUsd(25)).toBe(25)
    expect(clampClipUsd(10)).toBe(10)
  })

  it("refuses nonsense rather than propagating it", () => {
    // Infinity is not "a very large size", it is a broken value, and it
    // gets the same answer as NaN: the default, not the ceiling. (I first
    // asserted the ceiling here; clamping nonsense UP would let a corrupt
    // record quietly become the biggest legal clip.)
    expect(clampClipUsd(NaN)).toBe(DEFAULT_CLIP.usd)
    expect(clampClipUsd(Infinity)).toBe(DEFAULT_CLIP.usd)
    expect(clampClipUsd(-Infinity)).toBe(DEFAULT_CLIP.usd)
  })
})

describe("the sell fraction", () => {
  it("stays a real percentage", () => {
    expect(clampSellPct(50)).toBe(50)
    expect(clampSellPct(100)).toBe(100)
    expect(clampSellPct(0)).toBe(1)
    expect(clampSellPct(140)).toBe(100)
    expect(clampSellPct(NaN)).toBe(DEFAULT_CLIP.sellPct)
  })
})

describe("reading what was stored", () => {
  it("fills a missing or corrupt record instead of failing", () => {
    // Storage can hold anything a past version wrote, or nothing.
    expect(readClip(undefined)).toEqual(DEFAULT_CLIP)
    expect(readClip(null)).toEqual(DEFAULT_CLIP)
    expect(readClip({})).toEqual(DEFAULT_CLIP)
    expect(readClip({ usd: "25" })).toEqual(DEFAULT_CLIP)
  })

  it("clamps on the way in, not only on the way out", () => {
    // A value written by an older build with no ceiling must not survive
    // just because it is already on disk.
    expect(readClip({ usd: 9_999, sellPct: 500 })).toEqual({
      usd: CLIP_MAX_USD,
      sellPct: 100,
    })
  })
})
