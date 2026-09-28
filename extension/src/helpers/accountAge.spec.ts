import { describe, expect, it } from "vitest"
import { isNewbornAccount, NEWBORN_WINDOW_MS } from "./accountAge"

/**
 * The identity step's whole admission rule. The decision worth pinning is
 * the DIRECTION of every failure: anything unknowable must read as
 * "existing", because the screen is an offer for newborns, and offering
 * it to the wrong person is the only expensive mistake.
 */
describe("isNewbornAccount", () => {
  const now = Date.parse("2026-08-26T12:00:00Z")

  it("a minutes-old account is newborn", () => {
    expect(isNewbornAccount("2026-08-26T11:58:00Z", now)).toBe(true)
  })

  it("an account older than the window is not", () => {
    expect(isNewbornAccount("2026-08-26T11:40:00Z", now)).toBe(false)
    expect(isNewbornAccount("2026-08-01T12:00:00Z", now)).toBe(false)
  })

  it("the boundary belongs to the old side", () => {
    expect(isNewbornAccount(new Date(now - NEWBORN_WINDOW_MS).toISOString(), now)).toBe(false)
  })

  it("missing or garbage birthdates read as existing, never newborn", () => {
    expect(isNewbornAccount(null, now)).toBe(false)
    expect(isNewbornAccount(undefined, now)).toBe(false)
    expect(isNewbornAccount("not-a-date", now)).toBe(false)
  })
})
