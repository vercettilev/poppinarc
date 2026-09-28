import { describe, expect, it } from "vitest"
import { hasUsableProfile, needsProfileSetup } from "./profileGate"

/**
 * The invariant that stops the redirect fight.
 *
 * App.tsx sends people to /create-profile when `needsProfileSetup`;
 * CreateProfileStep sends them away when `hasUsableProfile`. If both can be
 * true for the same user, the panel oscillates between the two screens at
 * render speed — which is exactly what shipped, because one asked for a
 * display name the other never offered to fill.
 */

const CASES = [
  { name: "brand new google account", user: { username: "lev_7f2", display_name: null } },
  { name: "fully filled in", user: { username: "lev", display_name: "Lev" } },
  { name: "named but not yet usernamed", user: { username: null, display_name: "Lev" } },
  { name: "empty", user: { username: null, display_name: null } },
  { name: "blank strings", user: { username: "", display_name: "" } },
]

describe("the profile gate", () => {
  it.each(CASES)("never asks and dismisses at once: $name", ({ user }) => {
    expect(needsProfileSetup(user) && hasUsableProfile(user)).toBe(false)
  })

  it("lets a google-created account straight through", () => {
    // login-or-create writes username + email + first_name and NO
    // display_name, so this is the shape of every new Google sign-in. Under
    // the old rule App called it incomplete and the form called it done.
    const fresh = { username: "lev_7f2", display_name: null }
    expect(needsProfileSetup(fresh)).toBe(false)
    expect(hasUsableProfile(fresh)).toBe(true)
  })

  it("still stops someone who has no username", () => {
    expect(needsProfileSetup({ username: null, display_name: "Lev" })).toBe(true)
  })

  it("says nothing about a reader who is not signed in", () => {
    // No user is not an incomplete user — redirecting a signed-out reader to
    // a form they cannot submit is the same trap in a different costume.
    expect(needsProfileSetup(null)).toBe(false)
    expect(needsProfileSetup(undefined)).toBe(false)
    expect(hasUsableProfile(null)).toBe(false)
  })
})
