import { describe, expect, it } from "vitest"
import { isOwnProfileView } from "./profileEntry"

/**
 * WHO OWNS A BACK ARROW.
 *
 * Your own profile drew one. It pointed nowhere — the header you arrived
 * from is still on screen — and it reserved a 32px band above the avatar to
 * point nowhere in. That band is the "empty space" that was reported.
 *
 * ── THE INVARIANT THIS SPEC USED TO ASSERT, AND WHY IT WAS WRONG ────────────
 * The first repair asked "was this screen PUSHED?" and this spec cemented it,
 * asserting `isRootProfileDestination({ propUserId: "me" }) === false`: your
 * own id, pushed, KEEPS the arrow. That is not a stricter version of the
 * owner's rule, it is a different rule — and it left the reported defect
 * fully reachable, because the two commonest doors in the product name an id
 * even when the id is yours (PostHeader.tsx:105-111 tapping an avatar,
 * UserPopover.tsx:80-86 tapping a name, both pushing ProfileDetailView with
 * no self-check). Tap your own face on your own post and the band was back.
 *
 * The exit worry that motivated the old rule was real, and it is answered
 * where it happens instead of by leaving an arrow on your own page:
 * views/ProfileDetailView redirects a self-targeted overlay to the `/profile`
 * tab, so your own profile is never a sheet with the feed hidden under it.
 * profile-head-row.spec guards that door; this spec guards the question.
 */
describe("whose profile carries a back arrow", () => {
  it("calls the bare /profile tab yours, though it names nobody", () => {
    // The tab is the one entry that resolves no target at all.
    expect(isOwnProfileView({ targetId: null, currentUserId: "me" })).toBe(true)
  })

  it("calls your own id yours however you arrived at it", () => {
    // THE CORRECTED ASSERTION. The old spec demanded `false` here — the
    // pushed overlay carrying your own id — which is exactly the door the
    // owner reported the gutter through.
    expect(isOwnProfileView({ targetId: "me", currentUserId: "me" })).toBe(true)
  })

  it("keeps the arrow on somebody else's page, which really was pushed", () => {
    expect(isOwnProfileView({ targetId: "lev", currentUserId: "me" })).toBe(false)
  })

  it("does not call a stranger's page yours just because you are signed out", () => {
    // Without the explicit signed-in guard, `undefined === undefined` would
    // answer true for every named profile a signed-out reader opens and take
    // away the only control that closes it.
    expect(isOwnProfileView({ targetId: "lev" })).toBe(false)
    expect(isOwnProfileView({ targetId: "lev", currentUserId: null })).toBe(false)
  })

  it("reads a blank id as nobody, not as somebody", () => {
    // `location.state?.userId` and a route param can both arrive blank, and
    // profile.tsx's own `targetId` chain treats a blank as absent too.
    expect(isOwnProfileView({ targetId: "", currentUserId: "me" })).toBe(true)
    // Signed out on the bare tab is still "your" page — profile.tsx answers
    // it with the sign-in gate, not with a stranger's header.
    expect(isOwnProfileView({})).toBe(true)
  })
})
