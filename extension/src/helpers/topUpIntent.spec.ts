import { afterEach, describe, expect, it, vi } from "vitest"
import {
  TOP_UP_INTENT_KEY,
  TOP_UP_INTENT_WATCH_MS,
  minutesSince,
  readTopUpIntent,
  rememberTopUpIntent,
} from "./topUpIntent"

const store = new Map<string, unknown>()
const fakeChrome = {
  storage: {
    local: {
      set: async (o: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(o)) store.set(k, v)
      },
      get: async (k: string) => ({ [k]: store.get(k) }),
    },
  },
}

describe("the top-up intent", () => {
  afterEach(() => {
    store.clear()
    vi.unstubAllGlobals()
  })

  it("remembers the cover amount, the buy behind it and the moment; the screen reads it for fifteen minutes", async () => {
    vi.stubGlobal("chrome", fakeChrome)
    rememberTopUpIntent(10.4, { mint: "WIF", buyUsd: 10, ticker: "$WIF", sourceUrl: "https://x.com/s/1" }, null, 1_000_000)
    expect(store.get(TOP_UP_INTENT_KEY)).toEqual({
      usd: 11,
      at: 1_000_000,
      mint: "WIF",
      buyUsd: 10,
      ticker: "$WIF",
      sourceUrl: "https://x.com/s/1",
      note: null,
    })
    expect(await readTopUpIntent(undefined, 1_000_000 + 14 * 60_000)).toMatchObject({ usd: 11, mint: "WIF", buyUsd: 10 })
    expect(await readTopUpIntent(undefined, 1_000_000 + 16 * 60_000)).toBeNull()
  })

  it("a door without an amount or a coin still marks the moment, which the watcher reads for a day", async () => {
    vi.stubGlobal("chrome", fakeChrome)
    rememberTopUpIntent(undefined, undefined, null, 5_000)
    const later = 5_000 + 3 * 60 * 60_000
    const intent = await readTopUpIntent(TOP_UP_INTENT_WATCH_MS, later)
    expect(intent).toMatchObject({ usd: null, at: 5_000, mint: null, buyUsd: null })
    expect(minutesSince(intent, later)).toBe(180)
    expect(await readTopUpIntent(TOP_UP_INTENT_WATCH_MS, 5_000 + 25 * 60 * 60_000)).toBeNull()
    expect(minutesSince(null)).toBeNull()
  })

  it("no extension context is not an error", async () => {
    vi.stubGlobal("chrome", undefined)
    expect(() => rememberTopUpIntent(5)).not.toThrow()
    expect(await readTopUpIntent()).toBeNull()
  })
})
