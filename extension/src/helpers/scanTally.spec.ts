import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createScanTally } from "./scanTally"

/**
 * The funnel's first question is "of the chances we had, how many did we
 * take", and until this existed it could not be asked at all: page_scanned
 * was in the backend enum, the migration and the controller, with no caller
 * anywhere in the extension. Three investigations into "the chip does not
 * appear" had an anecdote and no rate.
 */
const hide = () => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  })
  document.dispatchEvent(new Event("visibilitychange"))
}
const show = () => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  })
}

type TrackFn = (event: string, payload?: Record<string, unknown>) => void
let track: ReturnType<typeof vi.fn> & TrackFn
beforeEach(() => {
  show()
  track = vi.fn() as never
})
afterEach(() => {
  show()
  vi.useRealTimers()
})

const make = (everyMs = 60_000) =>
  createScanTally({ track, host: "x.com", everyMs })

describe("the scan tally", () => {
  it("sends nothing when the page had no cashtags to decide about", () => {
    const t = make()
    hide()
    // Most pages are not about an asset. A row per page load would be a cost
    // the reader pays for a fact we already know.
    expect(track).not.toHaveBeenCalled()
    t.stop()
  })

  it("reports the chances taken and the chances missed together", () => {
    const t = make()
    t.shown()
    t.shown()
    t.dropped("the server has no tradeable mint under that ticker")
    t.dropped("the server has no tradeable mint under that ticker")
    t.dropped("X recycled the cell onto another tweet while we asked")
    hide()

    expect(track).toHaveBeenCalledOnce()
    const [event, payload] = track.mock.calls[0]
    expect(event).toBe("x_page_scanned")
    // The denominator is DECISIONS, not tweets: a feed where only five posts
    // mentioned an asset must not report "500 scanned, 2 shown".
    expect(payload.decided).toBe(5)
    expect(payload.shown).toBe(2)
    expect(payload.host).toBe("x.com")
    expect(payload.dropped["the server has no tradeable mint under that ticker"]).toBe(2)
    t.stop()
  })

  it("sends a snapshot of the page, not a delta since last time", () => {
    const t = make()
    t.shown()
    hide()
    show()
    t.shown()
    hide()

    expect(track).toHaveBeenCalledTimes(2)
    // Two snapshots of one document, each complete. Deltas would only mean
    // something added together, and a reader who tabs away twice would have
    // their page counted as two half-pages.
    expect(track.mock.calls[0][1].shown).toBe(1)
    expect(track.mock.calls[1][1].shown).toBe(2)
    t.stop()
  })

  it("says nothing twice for the same unchanged page", () => {
    const t = make()
    t.shown()
    hide()
    show()
    hide()
    // Nothing happened between the two, so the second hide has no news.
    expect(track).toHaveBeenCalledOnce()
    t.stop()
  })

  it("reports a long session without waiting for the reader to leave", () => {
    vi.useFakeTimers()
    const t = make(1000)
    t.shown()
    vi.advanceTimersByTime(1100)
    // A feed left open all day would otherwise never be counted at all.
    expect(track).toHaveBeenCalledOnce()
    t.stop()
  })

  it("stops counting and listening once stopped", () => {
    const t = make()
    t.shown()
    t.stop()
    t.shown()
    hide()
    expect(track).not.toHaveBeenCalled()
  })
})

describe("the missing tickers ride along", () => {
  it("names what the catalog lacks, deduped", () => {
    const seen: Array<Record<string, unknown>> = []
    const t = createScanTally({ track: (_e, p) => seen.push(p ?? {}), host: "x.com", everyMs: 60_000 })
    t.dropped("the server has no tradeable mint under that ticker", "FOO")
    t.dropped("the server has no tradeable mint under that ticker", "FOO")
    t.dropped("the server has no tradeable mint under that ticker", "BAR")
    t.flush()
    expect(seen[0].missing).toEqual(["FOO", "BAR"])
    t.stop()
  })

  it("a reason with no name adds nothing, and no names means no field", () => {
    const seen: Array<Record<string, unknown>> = []
    const t = createScanTally({ track: (_e, p) => seen.push(p ?? {}), host: "x.com", everyMs: 60_000 })
    t.dropped("the cell left the page before the answer came back")
    t.flush()
    expect("missing" in seen[0]).toBe(false)
    t.stop()
  })

  it("an adversarial page cannot grow the payload past the cap", () => {
    const seen: Array<Record<string, unknown>> = []
    const t = createScanTally({ track: (_e, p) => seen.push(p ?? {}), host: "x.com", everyMs: 60_000 })
    for (let i = 0; i < 200; i += 1) {
      t.dropped("the server has no tradeable mint under that ticker", `JUNK${i}`)
    }
    t.flush()
    expect((seen[0].missing as string[]).length).toBe(25)
    t.stop()
  })
})

