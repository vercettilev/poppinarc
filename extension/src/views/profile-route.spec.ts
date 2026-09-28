import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * THE FEED IS `/feed`, AND EVERY DOOR TO A PROFILE MUST KNOW IT.
 *
 * `/` was the feed once. The restructure made it the POSITIONS screen and
 * left four navigations pointing at it with profile state attached — so
 * tapping somebody's name in the feed dropped the reader on their own
 * portfolio, and "back" from a profile did the same. Reported from the
 * field: "feed'de başka birinin profiline tıklayınca positions'a gidiyor".
 *
 * A source-level guard, deliberately: mounting four components through a
 * MemoryRouter would test react-router, while what actually rotted here is
 * a hard-coded path that no type checks and no render exercises. The same
 * shape of guard the chip's own panel door carries (page-posts.spec).
 */
const FILES = [
  "src/components/Post/PostHeader.tsx",
  "src/components/Reply.tsx",
  "src/components/UserPopover.tsx",
  "src/views/ProfileDetailView.tsx",
]

describe("the feed's doors point at the feed", () => {
  it("no profile navigation targets the bare root", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8")
      // `navigate("/")` / navigate(`/`) — the stale target.
      expect(src, `${f} still navigates to the root`).not.toMatch(
        /navigate\(\s*[`"]\/[`"]\s*,/,
      )
    }
  })

  it("each one carries the reader to /feed instead", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8")
      expect(src, `${f} lost its /feed target`).toMatch(
        /navigate\(\s*[`"]\/feed[`"]/,
      )
    }
  })
})
