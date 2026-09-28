import { describe, expect, it } from "vitest"
import {
  addAlert,
  alertNotification,
  alertsDue,
  makeAlert,
  type PriceAlert,
} from "./priceAlerts"
import { survivesLogout, LOGOUT_SURVIVORS } from "./priceAlerts"

const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"

const alert = (o: Partial<PriceAlert> = {}): PriceAlert => ({
  id: "A1",
  mint: WIF,
  symbol: "WIF",
  targetUsd: 0.25,
  direction: "above",
  createdAt: 0,
  ...o,
})

describe("making an alert", () => {
  it("derives the direction from where the market stood, and freezes it", () => {
    const up = makeAlert({ mint: WIF, symbol: "WIF", targetUsd: 0.25, marketUsd: 0.2, now: 9 })
    const down = makeAlert({ mint: WIF, symbol: "WIF", targetUsd: 0.15, marketUsd: 0.2, now: 9 })
    expect(up?.direction).toBe("above")
    expect(down?.direction).toBe("below")
  })

  it("refuses a target the present already answers", () => {
    // AT the market is a description, not an alarm.
    expect(makeAlert({ mint: WIF, symbol: "WIF", targetUsd: 0.2, marketUsd: 0.2, now: 9 })).toBeNull()
  })

  it("refuses to guess a direction without a live market", () => {
    // An alert whose meaning depends on a number nobody had fires wrong.
    expect(makeAlert({ mint: WIF, symbol: "WIF", targetUsd: 0.25, marketUsd: null, now: 9 })).toBeNull()
    expect(makeAlert({ mint: WIF, symbol: "WIF", targetUsd: 0, marketUsd: 0.2, now: 9 })).toBeNull()
    expect(makeAlert({ mint: WIF, symbol: "WIF", targetUsd: NaN, marketUsd: 0.2, now: 9 })).toBeNull()
  })
})

describe("keeping alerts", () => {
  it("answers the same ask once", () => {
    const first = alert()
    const again = alert({ id: "A2", targetUsd: 0.2500002 })
    const r = addAlert([first], again)
    expect(r.added).toBe(false)
    expect(r.alerts).toEqual([first])
  })

  it("treats the other direction as a different question", () => {
    const r = addAlert([alert()], alert({ id: "A2", direction: "below" }))
    expect(r.added).toBe(true)
    expect(r.alerts).toHaveLength(2)
  })

  it("caps oldest-out, because storage is not a ledger", () => {
    const r = addAlert([alert({ id: "A" }), alert({ id: "B", targetUsd: 1 })], alert({ id: "C", targetUsd: 2 }), 2)
    expect(r.alerts.map((a) => a.id)).toEqual(["B", "C"])
  })
})

describe("what is due", () => {
  it("fires above on reaching, below on dropping", () => {
    const r = alertsDue(
      [alert(), alert({ id: "A2", targetUsd: 0.15, direction: "below" })],
      () => 0.25,
    )
    expect(r.due.map((d) => d.id)).toEqual(["A1"])
    expect(r.kept.map((k) => k.id)).toEqual(["A2"])
  })

  it("fires at the target exactly — 'or better' grammar, both ways", () => {
    expect(alertsDue([alert()], () => 0.25).due).toHaveLength(1)
    expect(
      alertsDue([alert({ direction: "below", targetUsd: 0.25 })], () => 0.25).due,
    ).toHaveLength(1)
  })

  /**
   * A mint the tick could not price: the alert neither fires off a missing
   * number nor gets lost to one. It waits.
   */
  it("keeps, untouched, what it could not price", () => {
    const r = alertsDue([alert()], () => null)
    expect(r.due).toEqual([])
    expect(r.kept).toEqual([alert()])
  })

  it("carries the firing price out for the notification", () => {
    const r = alertsDue([alert()], () => 0.31)
    expect(r.due[0].atUsd).toBe(0.31)
  })
})

describe("the words", () => {
  it("says the promise was kept, and where the price is now", () => {
    expect(alertNotification({ ...alert(), atUsd: 0.2517 })).toEqual({
      title: "Price alert: $WIF reached $0.25",
      message: "Now $0.2517. Tap to open $WIF.",
    })
    expect(
      alertNotification({ ...alert({ direction: "below", targetUsd: 0.15 }), atUsd: 0.1489 }),
    ).toEqual({
      title: "Price alert: $WIF dropped to $0.15",
      message: "Now $0.1489. Tap to open $WIF.",
    })
  })
})

describe("what signing out must not take", () => {
  it("carries the standing alerts and the fired history across the wipe", () => {
    const stored = {
      [LOGOUT_SURVIVORS[0]]: [{ id: "a" }],
      [LOGOUT_SURVIVORS[1]]: [{ id: "f" }],
      poppin_watched_orders: ["mine"],
      initialRoute: "/profile",
    }
    expect(survivesLogout(stored)).toEqual({
      [LOGOUT_SURVIVORS[0]]: [{ id: "a" }],
      [LOGOUT_SURVIVORS[1]]: [{ id: "f" }],
    })
  })

  it("brings nothing back that is not a non-empty list", () => {
    expect(survivesLogout({ [LOGOUT_SURVIVORS[0]]: "junk", [LOGOUT_SURVIVORS[1]]: [] })).toEqual({})
    expect(survivesLogout(null)).toEqual({})
    expect(survivesLogout(undefined)).toEqual({})
  })
})
