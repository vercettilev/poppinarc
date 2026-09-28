import { beforeEach, describe, expect, it, vi } from "vitest"
import { maybeCoach } from "./chipCoach"

/* The once-per-page latch lives at module scope, so each test gets a
   fresh module. */
const fresh = async () => {
  vi.resetModules()
  return (await import("./chipCoach")).maybeCoach as typeof maybeCoach
}

/** A chip with the controls the card points at, so `aim` has somewhere to land. */
const chipEl = () => {
  const c = document.createElement("div")
  c.innerHTML =
    '<div class="row"><span class="more"></span><span class="ring"></span><span class="wal"></span></div>'
  document.body.appendChild(c)
  return c
}

describe("maybeCoach", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("draws nothing when the welcome page never asked", async () => {
    const run = await fresh()
    const chip = chipEl()
    const clear = vi.fn(async () => undefined)
    await run({ chip, pending: async () => false, clear, track: () => undefined })
    expect(chip.querySelector(".coach")).toBeNull()
    expect(clear).not.toHaveBeenCalled()
  })

  it("draws the first sentence, and spends the flag on showing, not on dismissal", async () => {
    const run = await fresh()
    const chip = chipEl()
    const clear = vi.fn(async () => undefined)
    const track = vi.fn()
    await run({ chip, pending: async () => true, clear, track })
    const card = chip.querySelector(".coach")!
    expect(card.textContent).toContain("Buy or sell anything")
    expect(clear).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith("x_coach", { step: 1, action: "shown" })
  })

  it("walks four steps and Got it removes the card", async () => {
    const run = await fresh()
    const chip = chipEl()
    await run({ chip, pending: async () => true, clear: async () => undefined, track: () => undefined })
    const go = () => chip.querySelector(".coach-go") as HTMLButtonElement
    const text = () => chip.querySelector(".coach")!.textContent ?? ""

    expect(go().textContent).toBe("Next")
    go().click()
    expect(text()).toContain("chart")
    go().click()
    expect(text()).toContain("notifications")
    go().click()
    expect(text()).toContain("wallet")
    // The one place the points system is ever named, and it names the
    // price with it: every earning verb needs a landed trade.
    expect(text()).toContain("Trades earn points")
    // Only the last step offers to close.
    expect(go().textContent).toBe("Got it")
    go().click()
    expect(chip.querySelector(".coach")).toBeNull()
  })

  /**
   * THE POINTING IS THE POINT. Three of this row's controls are invisible
   * until a pointer arrives, so a card that named them without opening the
   * row would describe things the reader cannot see.
   */
  it("holds the row open and rings the control each step names", async () => {
    const run = await fresh()
    const chip = chipEl()
    await run({ chip, pending: async () => true, clear: async () => undefined, track: () => undefined })
    const go = () => chip.querySelector(".coach-go") as HTMLButtonElement

    // Step one is about the whole row: glow, no hold, nothing singled out.
    expect(chip.classList.contains("coach-glow")).toBe(true)
    expect(chip.classList.contains("coach-hold")).toBe(false)
    expect(chip.querySelector(".coach-aim")).toBeNull()

    for (const sel of [".more", ".ring", ".wal"]) {
      go().click()
      expect(chip.classList.contains("coach-hold")).toBe(true)
      expect(chip.querySelector(".coach-aim")).toBe(chip.querySelector(sel))
      // One at a time: the previous step's ring is taken back.
      expect(chip.querySelectorAll(".coach-aim").length).toBe(1)
    }

    go().click()
    // And the row is handed back exactly as it was found.
    expect(chip.classList.contains("coach-hold")).toBe(false)
    expect(chip.classList.contains("coach-glow")).toBe(false)
    expect(chip.querySelector(".coach-aim")).toBeNull()
  })

  /**
   * THE ONE THING ON SCREEN THAT POINTS HAS TO POINT AT THE RIGHT END.
   * Reported live: the words said "the bell", which sits at the far right
   * of a row twice the card's width, while the tail stayed pinned to the
   * left edge over the asset disc.
   */
  it("slides the card and its tail onto the control it names", async () => {
    vi.useFakeTimers()
    const run = await fresh()
    const chip = chipEl()
    // jsdom measures nothing, so the row is given a shape to measure.
    const box = (el: Element, left: number, width: number) =>
      Object.defineProperty(el, "getBoundingClientRect", {
        value: () => ({ left, width, right: left + width, top: 0, bottom: 0, height: 30 }),
        configurable: true,
      })
    box(chip, 0, 900)
    box(chip.querySelector(".more")!, 300, 24)
    box(chip.querySelector(".ring")!, 780, 28)
    box(chip.querySelector(".wal")!, 840, 28)

    await run({ chip, pending: async () => true, clear: async () => undefined, track: () => undefined })
    const card = chip.querySelector(".coach") as HTMLElement
    box(card, 0, 340)
    const go = () => chip.querySelector(".coach-go") as HTMLButtonElement

    // Step one is the whole row: no shift, the tail keeps its default.
    expect(card.style.getPropertyValue("--coach-shift")).toBe("")

    go().click()
    vi.advanceTimersByTime(400)
    const atChart = Number.parseInt(card.style.getPropertyValue("--coach-shift"), 10)

    go().click()
    vi.advanceTimersByTime(400)
    const atBell = Number.parseInt(card.style.getPropertyValue("--coach-shift"), 10)

    // The bell is 480px further right than the chevron, so the card moved.
    expect(atBell).toBeGreaterThan(atChart)
    // And never off the row: 900 wide, card 340.
    expect(atBell).toBeLessThanOrEqual(900 - 340)
    // The tail lands on the bell's centre, inside the card.
    const tail = Number.parseInt(card.style.getPropertyValue("--coach-tail"), 10)
    expect(atBell + tail + 7).toBeCloseTo(780 + 14, 0)
    vi.useRealTimers()
  })

  it("still has words for a control that is not on the row", async () => {
    // A signed-out reader has no wallet chip. The step must not throw, and
    // must not leave the row held open behind a card that cannot point.
    const run = await fresh()
    const chip = document.createElement("div")
    chip.innerHTML = '<div class="row"><span class="more"></span></div>'
    document.body.appendChild(chip)
    await run({ chip, pending: async () => true, clear: async () => undefined, track: () => undefined })
    const go = () => chip.querySelector(".coach-go") as HTMLButtonElement
    go().click()
    go().click()
    expect(chip.querySelector(".coach")!.textContent).toContain("notifications")
    expect(chip.querySelector(".coach-aim")).toBeNull()
  })

  it("acts once per page: the second chip to land gets nothing", async () => {
    const run = await fresh()
    const a = chipEl(), b = chipEl()
    await run({ chip: a, pending: async () => true, clear: async () => undefined, track: () => undefined })
    await run({ chip: b, pending: async () => true, clear: async () => undefined, track: () => undefined })
    expect(a.querySelector(".coach")).not.toBeNull()
    expect(b.querySelector(".coach")).toBeNull()
  })

  it("a storage failure means no coach, never a throw", async () => {
    const run = await fresh()
    const chip = chipEl()
    await expect(
      run({ chip, pending: async () => { throw new Error("no storage") }, clear: async () => undefined, track: () => undefined }),
    ).resolves.toBeUndefined()
    expect(chip.querySelector(".coach")).toBeNull()
  })
})
