import { describe, expect, it } from "vitest"
import { isQuietRoute } from "./quietRoutes"

describe("quiet routes", () => {
  it("names the screens that are not about the page", () => {
    for (const p of [
      "/settings",
      "/flywheel",
      "/referral",
      "/callers",
      "/discover",
      "/wallet-ui",
      "/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
      "/profile/abc",
    ]) {
      expect(isQuietRoute(p), p).toBe(true)
    }
  })
  it("leaves the front door and the feed alone", () => {
    for (const p of ["/", "/feed", "/live-chat"]) {
      expect(isQuietRoute(p), p).toBe(false)
    }
  })
})
