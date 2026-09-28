import { describe, expect, it } from "vitest"
import { NOTIFY_DEFAULTS, NOTIFY_ROWS, readNotifyPrefs, shouldNotify, type NotifyKind } from "./notifyPrefs"

const KINDS: NotifyKind[] = ["move", "social", "digest"]

describe("reading what a reader chose", () => {
  it("arrives on for somebody who has never chosen", () => {
    expect(readNotifyPrefs(undefined)).toEqual(NOTIFY_DEFAULTS)
    expect(readNotifyPrefs(null)).toEqual(NOTIFY_DEFAULTS)
    expect(readNotifyPrefs({})).toEqual(NOTIFY_DEFAULTS)
  })

  it("honours a switch that was turned off, and only that one", () => {
    const p = readNotifyPrefs({ social: false })
    expect(p.social).toBe(false)
    expect(p.move).toBe(true)
    expect(p.digest).toBe(true)
  })

  it("gives a kind the reader never chose its own default", () => {
    // Preferences saved by a build that had three kinds must not silence the
    // ones that came later — a feature nobody knows they have is not shipped.
    // `social` was the deliberate exception (default off until there was real
    // activity to reflect) and is no longer one; an absent key gives it the
    // same treatment every other kind gets, which is the whole point of
    // reading through NOTIFY_DEFAULTS rather than through a literal.
    const old = { move: false, social: true }
    const p = readNotifyPrefs(old)
    expect(p.move).toBe(false)
    expect(p.digest).toBe(true)
    expect(p.social).toBe(true)
  })

  it("drops keys from a build that still stored the reader's own requests", () => {
    // Order fills, price alerts and deposits are the reader's own requests:
    // they were never switchable, so they are not preferences at all now.
    // A value left behind by a build that stored them reads as nothing —
    // the background sends them without asking this file.
    const p = readNotifyPrefs({ fill: false, alert: false, deposit: false })
    expect(p).toEqual(NOTIFY_DEFAULTS)
    expect(Object.keys(p).sort()).toEqual(["digest", "move", "social"])
  })

  it("honours a reader who turned social OFF, and one who turned it on", () => {
    // The default moved; a real boolean still outranks it in both
    // directions, which is the only thing that makes a switch a switch.
    expect(readNotifyPrefs({ social: false }).social).toBe(false)
    expect(shouldNotify(readNotifyPrefs({ social: false }), "social")).toBe(false)
    expect(readNotifyPrefs({ social: true }).social).toBe(true)
    expect(shouldNotify(readNotifyPrefs({ social: true }), "social")).toBe(true)
  })

  it("survives junk by falling back to defaults, not to guesses", () => {
    const p = readNotifyPrefs({ move: "no", social: 0, digest: null })
    // Only a real boolean is a choice. "no", 0 and null are what a
    // hand-edited or half-migrated store produces; neither "off" nor "on" is
    // a reading of them. Every answer comes from the same place: that kind's
    // default.
    expect(p.move).toBe(true)
    expect(p.digest).toBe(true)
    expect(p.social).toBe(true)
  })
})

describe("the gate", () => {
  it("passes what is on and stops what is off", () => {
    const p = readNotifyPrefs({ move: false })
    expect(shouldNotify(p, "move")).toBe(false)
    expect(shouldNotify(p, "digest")).toBe(true)
  })
})

describe("the switches shown", () => {
  it("offers one row per kind, and every kind has a row", () => {
    // Three kinds, three switches. A kind exists here only where a
    // reasonable reader might say no: a position moving, someone they
    // follow trading, a morning line. The things the reader asked for —
    // an order, an alert, a deposit — are not kinds any more, because a
    // switch that says "do not tell me about the order I placed" is not a
    // preference. The way to stop hearing about an order is to cancel it.
    expect(NOTIFY_ROWS.map((r) => r.kind).sort()).toEqual(["digest", "move", "social"])
    expect(new Set(NOTIFY_ROWS.map((r) => r.kind)).size).toBe(NOTIFY_ROWS.length)
    // No kind can reach the background without a row to silence it with.
    for (const k of KINDS) {
      expect(NOTIFY_ROWS.some((r) => r.kind === k)).toBe(true)
    }
    expect([...KINDS].sort()).toEqual(["digest", "move", "social"])
  })

  it("says what each one is, in words about the reader", () => {
    for (const r of NOTIFY_ROWS) {
      expect(r.title.length).toBeGreaterThan(3)
      expect(r.description.length).toBeGreaterThan(20)
    }
  })
})
