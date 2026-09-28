import { describe, expect, it } from "vitest"
import { countAnimates, countValueAt } from "./useCountUp"

/**
 * The book paints from cache first and the live answer lands a beat later.
 * Replacing one with the other in a single frame makes the headline blink
 * to a different figure with nothing to say a refresh happened - the reader
 * looking at $412 sees $389 and cannot tell whether the market moved or the
 * first number was a lie.
 *
 * These are the two decisions inside that ride, kept as functions so they
 * can be read without a renderer.
 */
describe("when a number earns a ride", () => {
  it("travels between two different numbers", () => {
    expect(countAnimates(412, 389, false)).toBe(true)
  })

  it("does not travel on a cold open - the first value IS the truth", () => {
    // Counting up from nothing would be an animation about our loading
    // rather than about their money.
    expect(countAnimates(null, 412, false)).toBe(false)
  })

  it("never eases into or out of absence", () => {
    // null means "we could not look". The numbers between null and 412 do
    // not exist, so inventing them would be inventing money.
    expect(countAnimates(412, null, false)).toBe(false)
  })

  it("stays still when nothing changed", () => {
    expect(countAnimates(42, 42, false)).toBe(false)
  })

  it("hands over the answer at once under reduced motion", () => {
    expect(countAnimates(412, 389, true)).toBe(false)
  })
})

describe("where the number is on the way", () => {
  it("starts at the old value and ends exactly on the new one", () => {
    expect(countValueAt(100, 250, 0)).toBe(100)
    expect(countValueAt(100, 250, 1)).toBe(250)
  })

  it("lands exactly, never a cent short", () => {
    // A frame can arrive after the duration; the clamp must not leave the
    // headline resting on 249.9998.
    expect(countValueAt(100, 250, 1.4)).toBe(250)
  })

  it("moves toward the target and never past it", () => {
    const mid = countValueAt(100, 250, 0.5)
    expect(mid).toBeGreaterThan(100)
    expect(mid).toBeLessThan(250)
  })

  it("runs downhill too - a book can be worth less than it was", () => {
    const mid = countValueAt(250, 100, 0.5)
    expect(mid).toBeLessThan(250)
    expect(mid).toBeGreaterThan(100)
    expect(countValueAt(250, 100, 1)).toBe(100)
  })
})
