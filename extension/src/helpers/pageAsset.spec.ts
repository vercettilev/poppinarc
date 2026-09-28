import { describe, expect, it } from "vitest"
import { pageCanCarryAsset } from "./pageAsset"

describe("pages that can carry an asset", () => {
  it("never asks X: the tweet's chip already knows, the feed never does", () => {
    expect(pageCanCarryAsset("https://x.com/home")).toBe(false)
    expect(pageCanCarryAsset("https://x.com/search?q=%24SOL&f=live")).toBe(false)
    expect(pageCanCarryAsset("https://twitter.com/someone/status/1")).toBe(false)
    expect(pageCanCarryAsset("https://mobile.twitter.com/home")).toBe(false)
  })
  it("asks everywhere else, and nothing when there is no page", () => {
    expect(pageCanCarryAsset("https://www.coingecko.com/en/coins/dogwifhat")).toBe(true)
    expect(pageCanCarryAsset("https://www.cnbc.com/quotes/NVDA")).toBe(true)
    expect(pageCanCarryAsset("https://www.reddit.com/r/solana/")).toBe(true)
    expect(pageCanCarryAsset("")).toBe(false)
    expect(pageCanCarryAsset(null)).toBe(false)
    expect(pageCanCarryAsset("not a url")).toBe(false)
  })
})
