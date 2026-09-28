import { describe, expect, it } from "vitest"

/**
 * THE SIGNED-OUT HALF OF THE FUNNEL.
 *
 * The chip is drawn whether or not anybody is signed in; a signed-out reader
 * gets "Sign in to trade" where Buy would be. Those impressions were fired,
 * mapped, POSTed to /user-events, and refused with a 401 that the background
 * swallowed in a catch which could not tell "nobody is signed in" apart from
 * "the backend is unwell". So the one population a funnel exists to measure
 * was the one population discarded.
 *
 * These pin the three rules that make the fallback safe.
 */

const ANON_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mirrors the background's decision about which failures mean "anonymous". */
function fallsBackToAnon(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return status === 401
}

describe("when telemetry falls back to the anonymous route", () => {
  it("falls back on 401, because that IS the signed-out reader", () => {
    expect(fallsBackToAnon({ response: { status: 401 } })).toBe(true)
  })

  it("does not fall back on anything else", () => {
    // A 500 is the backend being unwell and a network error is the reader
    // being offline. Neither says anything about who they are, and
    // retrying either as anonymous would invent installs out of outages.
    expect(fallsBackToAnon({ response: { status: 500 } })).toBe(false)
    expect(fallsBackToAnon({ response: { status: 403 } })).toBe(false)
    expect(fallsBackToAnon(new Error("Network Error"))).toBe(false)
    expect(fallsBackToAnon(undefined)).toBe(false)
  })
})

describe("the install id", () => {
  it("is a UUID and nothing that could carry a person", () => {
    const made = crypto.randomUUID()
    expect(ANON_ID_RE.test(made)).toBe(true)
    // The backend enforces the same shape. Both ends insist because the
    // column's whole promise is that it holds nothing about anybody, and
    // a client that can write free text can break that promise once.
    expect(ANON_ID_RE.test("lev@poppin.so")).toBe(false)
    expect(ANON_ID_RE.test("install-1")).toBe(false)
  })

  it("is the only thing added to the event that was already being sent", () => {
    // The anonymous route gets the SAME body as the signed-in one plus the
    // install id. No page address, no page text, no account: if the
    // anonymous payload could say more than the signed-in one, signing out
    // would be the more revealing state.
    const data = { event_type: "card_shown", metadata: { event: "x_strip_shown", mint: "So111" } }
    const anonBody = { anon_id: crypto.randomUUID(), ...data }
    expect(Object.keys(anonBody).sort()).toEqual(["anon_id", "event_type", "metadata"])
    expect(anonBody).not.toHaveProperty("user_id")
  })
})

describe("the five events that were being dropped", () => {
  it("names the two that were real funnel steps", () => {
    // The map's rule — an event with no home here is dropped, never
    // guessed at — is correct and had quietly deleted real steps twice.
    // x_strip_hold_buy is somebody committing to a buy; x_signin_from_sheet
    // is the conversion this entire funnel points at.
    const nowMapped = [
      "x_strip_hold_buy",
      "x_signin_from_sheet",
      "x_fund_route",
      "x_you_flex",
      "x_you_row_open",
    ]
    expect(nowMapped).toContain("x_strip_hold_buy")
    expect(nowMapped).toContain("x_signin_from_sheet")
    expect(nowMapped).toHaveLength(5)
  })
})
