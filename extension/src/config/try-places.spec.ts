import { describe, expect, it, vi } from "vitest"
import { NEWS_SITE } from "~/entries/contentScript/x/newsSite"
import { REDDIT_SITE } from "~/entries/contentScript/x/redditSite"
import { X_SITE } from "~/entries/contentScript/x/xSite"

/**
 * EVERY PLACE "Try Poppin" OFFERS IS A PAGE THE CHIP RUNS ON.
 *
 * The screen promises a price under the post. That promise has two halves:
 * the text of each page resolves to an asset (arc/edition-helpers.spec.ts
 * runs the matcher on their exact words), and the page's host is one a site
 * adapter serves, so the strip boots there at all. This file is the second
 * half, executed rather than read.
 */
async function arcOnboarding() {
  vi.unstubAllEnvs()
  vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "true")
  vi.resetModules()
  return import("~/config/onboarding")
}

describe("Try Poppin's places", () => {
  it("are one each of X, a news page and Reddit, in that order", async () => {
    const { ARC_TRY_PLACES } = await arcOnboarding()
    expect(ARC_TRY_PLACES.map((p) => p.id)).toEqual(["x", "news", "reddit"])
  })

  it("each sit on a host whose adapter the strip boots on", async () => {
    const { ARC_TRY_PLACES } = await arcOnboarding()
    const adapter = { x: X_SITE, news: NEWS_SITE, reddit: REDDIT_SITE } as const
    for (const place of ARC_TRY_PLACES) {
      const url = new URL(place.url)
      expect(url.protocol, place.url).toBe("https:")
      expect(adapter[place.id].matches(url.hostname), place.url).toBe(true)
    }
  })

  it("start with the page the handoff has always defaulted to", async () => {
    const { ARC_TRY_PLACES, ONBOARDING_X_URL } = await arcOnboarding()
    expect(ARC_TRY_PLACES[0]!.url).toBe(ONBOARDING_X_URL)
    expect(new URL(ONBOARDING_X_URL).hostname).toBe("x.com")
  })
})
