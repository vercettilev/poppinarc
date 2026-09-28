import { describe, expect, it } from "vitest"
import {
  classifyStatus,
  fillNotification,
  fillShareText,
  mintsWithUnreadFills,
  rememberFills,
  splitFillsFor,
  watchStep,
  type WatchedOrder,
  rememberOrigin,
  takeOrigin,
} from "./orderFillWatch"

const order = (o: Partial<WatchedOrder> = {}): WatchedOrder => ({
  orderKey: "K1",
  mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  side: "buy",
  amountUsd: 25,
  amountUi: 126.53,
  triggerPriceUsd: 0.17,
  symbol: "WIF",
  ...o,
})

/**
 * The watch exists because a fill was the one moment the product provably
 * worked for the reader while they were away — and it said nothing.
 */
describe("one watch step", () => {
  it("reports an order that vanished into an executed history row", () => {
    const r = watchStep({
      prevKeys: ["K1", "K2"],
      active: [order({ orderKey: "K2" })],
      history: [order({ orderKey: "K1", status: "Completed" })],
    })
    expect(r.fills.map((f) => f.orderKey)).toEqual(["K1"])
    expect(r.nextKeys).toEqual(["K2"])
  })

  /**
   * A cancel also vanishes from the active list — the reader did that
   * themselves, on one of three surfaces, and being congratulated for it
   * would prove the product does not know what happened.
   */
  it("stays silent about a cancel", () => {
    const r = watchStep({
      prevKeys: ["K1"],
      active: [],
      history: [order({ status: "Cancelled" })],
    })
    expect(r.fills).toEqual([])
  })

  it("stays silent about an expiry and about a key history never explains", () => {
    const r = watchStep({
      prevKeys: ["K1", "K2"],
      active: [],
      history: [order({ orderKey: "K1", status: "Expired" })],
    })
    // K2 is not in history at all — unknown outcome, and a wrong "your order
    // filled" is a lie about money. Silence, and the book itself will show
    // the truth on the next surface that lists it.
    expect(r.fills).toEqual([])
  })

  /**
   * The seed run. On a fresh install every existing order would otherwise
   * "vanish" into a burst of fills that never happened.
   */
  it("reports nothing on the first run, whatever is standing", () => {
    const r = watchStep({
      prevKeys: null,
      active: [order()],
      history: [],
    })
    expect(r.fills).toEqual([])
    expect(r.nextKeys).toEqual(["K1"])
  })

  it("carries the surviving keys forward unchanged", () => {
    const r = watchStep({ prevKeys: ["K1"], active: [order()], history: [] })
    expect(r).toEqual({ fills: [], nextKeys: ["K1"] })
  })
})

describe("Jupiter's status strings, matched in the silent direction", () => {
  it("recognises the executed spellings", () => {
    for (const s of ["Completed", "completed", "Filled", "Executed"]) {
      expect(classifyStatus(s), s).toBe("filled")
    }
  })

  it("treats everything else as not-a-fill", () => {
    for (const s of ["Cancelled", "Expired", "Open", "", undefined, "SomethingNew"]) {
      expect(classifyStatus(s as string | undefined), String(s)).toBe("silent")
    }
  })
})

describe("the words on the notification", () => {
  it("says a buy in dollars, at the trigger or better", () => {
    expect(fillNotification(order())).toEqual({
      title: "Order filled: bought $WIF",
      message: "$25 at $0.17 or better",
    })
  })

  it("says a sell in units", () => {
    expect(
      fillNotification(order({ side: "sell", amountUi: 61.4082, triggerPriceUsd: 0.26 })),
    ).toEqual({
      title: "Order filled: sold $WIF",
      message: "61.4082 $WIF at $0.26 or better",
    })
  })

  it("prints sub-dollar prices with the digits they need", () => {
    const n = fillNotification(order({ triggerPriceUsd: 0.005178 }))
    expect(n.message).toBe("$25 at $0.005178 or better")
  })

  it("never doubles the sigil and survives a missing symbol", () => {
    expect(fillNotification(order({ symbol: "$WIF" })).title).toBe("Order filled: bought $WIF")
    expect(fillNotification(order({ symbol: null })).title).toMatch(/bought EKpQ…$/)
  })
})

describe("the celebration's memory", () => {
  const pf = (orderKey: string, mint = "M1", at = 0) => ({
    ...order({ orderKey, mint }),
    at,
  })

  it("appends new fills, newest last, and never the same key twice", () => {
    const out = rememberFills(
      [pf("K1")],
      [order({ orderKey: "K1" }), order({ orderKey: "K2" })],
      5,
    )
    expect(out.map((f) => f.orderKey)).toEqual(["K1", "K2"])
    expect(out[1].at).toBe(5)
  })

  it("caps by dropping the oldest, because storage is not a ledger", () => {
    const out = rememberFills([pf("K1"), pf("K2")], [order({ orderKey: "K3" })], 9, 2)
    expect(out.map((f) => f.orderKey)).toEqual(["K2", "K3"])
  })

  it("splits one asset's fills out and leaves the rest untouched", () => {
    const { mine, rest } = splitFillsFor(
      [pf("K1", "A"), pf("K2", "B"), pf("K3", "A")],
      "A",
    )
    expect(mine.map((f) => f.orderKey)).toEqual(["K1", "K3"])
    expect(rest.map((f) => f.orderKey)).toEqual(["K2"])
  })
})

describe("the share text", () => {
  it("speaks the market share's grammar, minus the page it never had", () => {
    expect(fillShareText(order())).toBe(
      "Limit order filled: bought $WIF at $0.17 ($25) via Poppin",
    )
    expect(
      fillShareText(order({ side: "sell", amountUi: 61.4082, triggerPriceUsd: 0.26 })),
    ).toBe("Limit order filled: sold 61.4082 $WIF at $0.26 via Poppin")
  })
})

/**
 * WHERE A FILL IS FILED, decided at the moment the order was parked.
 *
 * The owner's rule: a trade made on the X feed belongs to the X feed's
 * conversation, and an order is a trade that has not happened yet. The
 * fill lands hours later on no page at all, so the address has to be
 * remembered rather than guessed.
 */
describe("an order remembers the room it was placed in", () => {
  it("hands the fill back the address the order was parked from", () => {
    const map = rememberOrigin({}, "OK1", "https://x.com/home")
    const { url, rest } = takeOrigin(map, "OK1", "https://poppin.so")
    expect(url).toBe("https://x.com/home")
    // Spent: a second fill on the same key cannot exist, and a map that
    // only grows is a leak with a reader's browsing history in it.
    expect(rest.OK1).toBeUndefined()
  })

  it("falls back rather than guessing for an order it never saw", () => {
    // Orders placed before this existed, or from a surface that does not
    // record one. The product's own address is the honest default.
    const { url } = takeOrigin({}, "GHOST", "https://poppin.so")
    expect(url).toBe("https://poppin.so")
    expect(takeOrigin(undefined, "GHOST", "https://poppin.so").url).toBe(
      "https://poppin.so",
    )
  })

  it("keeps the newest and drops the oldest rather than growing forever", () => {
    let map = {}
    for (let i = 0; i < 60; i++) {
      map = rememberOrigin(map, `k${i}`, `https://x.com/home?i=${i}`)
    }
    const keys = Object.keys(map)
    expect(keys.length).toBeLessThanOrEqual(40)
    // The ones a reader is most likely to still have open survive.
    expect(keys).toContain("k59")
    expect(keys).not.toContain("k0")
  })
})

describe("which assets the book should point at", () => {
  const fill = (mint: string, read?: boolean) =>
    ({ mint, read, at: 1, orderKey: `k-${mint}`, symbol: "WIF" }) as never

  it("names every mint carrying something ungreeted", () => {
    const s = mintsWithUnreadFills([fill("A"), fill("B")])
    expect([...s].sort()).toEqual(["A", "B"])
  })

  it("says nothing about a fill already greeted", () => {
    // Seen is marked, not deleted, so the pointer must read the flag and
    // not merely the presence of a row - otherwise the book would keep
    // pointing at news the reader has already been told.
    expect([...mintsWithUnreadFills([fill("A", true)])]).toEqual([])
  })

  it("names a mint once however many of its orders filled", () => {
    expect([...mintsWithUnreadFills([fill("A"), fill("A")])]).toEqual(["A"])
  })

  it("treats a missing or malformed list as no news, never as a crash", () => {
    expect([...mintsWithUnreadFills(undefined)]).toEqual([])
    expect([...mintsWithUnreadFills([null, 3, { read: false }])]).toEqual([])
  })
})
