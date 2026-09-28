import { describe, expect, it, vi } from "vitest"
import { createChipSeenWatch } from "./chipSeen"

/** A hand-driven IntersectionObserver: the test decides what is on screen. */
function harness(opts: { dwellMs?: number } = {}) {
  let fire: (e: { target: Element; intersectionRatio: number }[]) => void = () => {}
  const observed = new Set<Element>()
  let disconnected = false
  const timers = new Map<number, () => void>()
  let nextId = 1
  const track = vi.fn()

  const watch = createChipSeenWatch({
    track,
    dwellMs: opts.dwellMs ?? 500,
    makeObserver: (cb) => {
      fire = cb
      return {
        observe: (el) => observed.add(el),
        unobserve: (el) => observed.delete(el),
        disconnect: () => {
          disconnected = true
          observed.clear()
        },
      }
    },
    setTimer: (fn) => {
      const id = nextId++
      timers.set(id, fn)
      return id
    },
    clearTimer: (id) => {
      timers.delete(id)
    },
  })

  return {
    watch,
    track,
    observed,
    isDisconnected: () => disconnected,
    pendingTimers: () => timers.size,
    /** Let every armed dwell timer reach its deadline. */
    elapse: () => {
      const due = [...timers.values()]
      timers.clear()
      for (const fn of due) fn()
    },
    show: (el: Element, r = 1) => fire([{ target: el, intersectionRatio: r }]),
  }
}

const el = (): Element => document.createElement("div")

describe("createChipSeenWatch", () => {
  it("reports a chip that stayed on screen", () => {
    const h = harness()
    const a = el()
    h.watch.watch(a, { mint: "So111", tier: "cashtag" })
    h.show(a, 1)
    h.elapse()
    expect(h.track).toHaveBeenCalledWith("x_strip_seen", {
      mint: "So111",
      tier: "cashtag",
    })
  })

  it("says NOTHING about a chip flung past at scroll speed", () => {
    // On screen, then gone before the dwell. This is the whole reason the
    // event exists: counting these would rebuild x_strip_shown's own lie
    // one level up.
    const h = harness()
    const a = el()
    h.watch.watch(a, { mint: "So111", tier: "cashtag" })
    h.show(a, 1)
    h.show(a, 0)
    h.elapse()
    expect(h.track).not.toHaveBeenCalled()
  })

  it("does not restart the clock while the chip is still on screen", () => {
    // The observer fires again at every threshold on the way up. Re-arming
    // there would mean a slow scroll never banks the dwell it is earning.
    const h = harness()
    const a = el()
    h.watch.watch(a, { mint: "So111", tier: "cashtag" })
    h.show(a, 0.5)
    h.show(a, 0.8)
    h.show(a, 1)
    expect(h.pendingTimers()).toBe(1)
    h.elapse()
    expect(h.track).toHaveBeenCalledTimes(1)
  })

  it("counts one mint once, however many cells carry it", () => {
    // X mounts the same asset into several cells on a screenful. Counting
    // each would put the seen/shown ratio above 1, which is not a ratio.
    const h = harness()
    const a = el()
    const b = el()
    h.watch.watch(a, { mint: "So111", tier: "cashtag" })
    h.show(a, 1)
    h.elapse()
    h.watch.watch(b, { mint: "So111", tier: "name" })
    h.show(b, 1)
    h.elapse()
    expect(h.track).toHaveBeenCalledTimes(1)
  })

  it("stops watching an element it has already counted", () => {
    const h = harness()
    const a = el()
    h.watch.watch(a, { mint: "So111", tier: "cashtag" })
    expect(h.observed.has(a)).toBe(true)
    h.show(a, 1)
    h.elapse()
    expect(h.observed.has(a)).toBe(false)
  })

  it("leaves no timer running after stop()", () => {
    // The strip's stop() runs on teardown; a dwell timer that outlives it
    // would fire against a page that is gone.
    const h = harness()
    const a = el()
    h.watch.watch(a, { mint: "So111", tier: "cashtag" })
    h.show(a, 1)
    expect(h.pendingTimers()).toBe(1)
    h.watch.stop()
    expect(h.pendingTimers()).toBe(0)
    expect(h.isDisconnected()).toBe(true)
  })
})

describe("when the platform has no IntersectionObserver", () => {
  it("stays silent instead of taking the chip down with it", () => {
    // Eager construction threw at strip-init and broke 272 specs; in a
    // browser that would have been the chip itself. A measurement is never
    // worth the thing it measures.
    const track = vi.fn()
    const watch = createChipSeenWatch({
      track,
      makeObserver: () => {
        throw new ReferenceError("IntersectionObserver is not defined")
      },
    })
    const a = el()
    expect(() => watch.watch(a, { mint: "So111", tier: "cashtag" })).not.toThrow()
    expect(() => watch.stop()).not.toThrow()
    expect(track).not.toHaveBeenCalled()
  })

  it("does not build an observer for a page that never mounts a chip", () => {
    const make = vi.fn(() => ({
      observe: () => {},
      unobserve: () => {},
      disconnect: () => {},
    }))
    const watch = createChipSeenWatch({ track: vi.fn(), makeObserver: make })
    expect(make).not.toHaveBeenCalled()
    watch.watch(el(), { mint: "So111", tier: "cashtag" })
    expect(make).toHaveBeenCalledTimes(1)
  })
})

describe("the onboarding card waits for a chip somebody looked at", () => {
  it("announces the first chip that clears the dwell, not the first mounted", () => {
    const seen: Element[] = []
    const h = harness()
    const a = el(), b = el()
    h.watch.watch(a, { mint: "So111", tier: "cashtag" })
    h.watch.watch(b, { mint: "Bonk1", tier: "cashtag" })
    // a mounts first but b is the one the reader rests on
    h.show(b, 1)
    h.elapse()
    expect(h.track).toHaveBeenCalledWith("x_strip_seen", expect.objectContaining({ mint: "Bonk1" }))
  })

  it("offers the card once, however many chips are later seen", () => {
    const seen: Element[] = []
    let fire: (e: { target: Element; intersectionRatio: number }[]) => void = () => {}
    const timers = new Map<number, () => void>()
    let id = 1
    const w = createChipSeenWatch({
      track: vi.fn(),
      onSeen: (e) => seen.push(e),
      makeObserver: (cb) => {
        fire = cb
        return { observe: () => {}, unobserve: () => {}, disconnect: () => {} }
      },
      setTimer: (fn) => { const k = id++; timers.set(k, fn); return k },
      clearTimer: (k) => { timers.delete(k) },
    })
    const run = () => { const due = [...timers.values()]; timers.clear(); due.forEach((f) => f()) }
    const a = el(), b = el()
    w.watch(a, { mint: "So111", tier: "cashtag" })
    fire([{ target: a, intersectionRatio: 1 }]); run()
    w.watch(b, { mint: "Bonk1", tier: "cashtag" })
    fire([{ target: b, intersectionRatio: 1 }]); run()
    expect(seen).toEqual([a])
  })

  it("does not let a thrown card take the count down with it", () => {
    // The count is the contract; the card is a courtesy.
    const track = vi.fn()
    let fire: (e: { target: Element; intersectionRatio: number }[]) => void = () => {}
    const timers: Array<() => void> = []
    const w = createChipSeenWatch({
      track,
      onSeen: () => { throw new Error("no chip") },
      makeObserver: (cb) => { fire = cb; return { observe: () => {}, unobserve: () => {}, disconnect: () => {} } },
      setTimer: (fn) => { timers.push(fn); return timers.length },
      clearTimer: () => {},
    })
    const a = el()
    w.watch(a, { mint: "So111", tier: "cashtag" })
    fire([{ target: a, intersectionRatio: 1 }])
    expect(() => timers.forEach((f) => f())).not.toThrow()
    expect(track).toHaveBeenCalledWith("x_strip_seen", expect.objectContaining({ mint: "So111" }))
  })
})
