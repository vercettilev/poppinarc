import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE FUNNEL BELONGS TO THE FEED, AND THE FEED'S LABEL ROW BELONGS TO BOTH
 * OF ITS MODES.
 *
 * FeedFilterButton was mounted in Header's right-hand group. Layout gives a
 * header to nearly every route, so a control whose only readers are the feed
 * (useFilterStore's sort/kind, useUIStore's whole-site toggle) was on screen
 * over Positions, Wallet, Tasks and Notifications, where nothing it sets
 * changes anything. It now sits at the far right of the feed's label row.
 *
 * The same row now prints for BOTH feeds. `/feed` is one route with two
 * modes — `sort === "timeline"` is the global feed, anything else is the
 * feed for the page you are on — and the row used to render in the first
 * mode only, leaving the page feed unlabelled.
 *
 * The load-bearing half of that change is what did NOT move: the pathname
 * guard. `sort` is panel-wide state that outlives a route, and dropping the
 * pathname check is how this row once stamped "Global Feed" across the
 * Positions screen. These assertions exist so the next person who
 * "simplifies" the two guards into one keeps the right one.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/** The first integer after `key:` in a source blob, e.g. `width: 26,` → 26. */
const num = (text: string, key: string): number => {
  const m = text.match(new RegExp(`${key}:\\s*"?(\\d+)`))
  if (!m) throw new Error(`could not read \`${key}\` out of the source`)
  return Number(m[1])
}

/** House comments quote the code they replaced; count the code, not the prose. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("the feed's filter sits on the feed's row", () => {
  it("the header no longer mounts a feed-only control", () => {
    const header = stripComments(read("components/Header.tsx"))
    expect(header).not.toMatch(/<FeedFilterButton/)
    expect(header).not.toMatch(/import .*FeedFilterButton/)
  })

  it("the label row mounts it, at the far right", () => {
    const bar = stripComments(read("components/ActionBar.tsx"))
    expect(bar).toMatch(/import \{ FeedFilterButton \}/)
    expect(bar).toMatch(/<FeedFilterButton \/>/)
    // Pill left, funnel right — the row has exactly two flex children.
    expect(bar).toMatch(/justifyContent: "space-between"/)
  })

  it("the route decides whether a label prints; the sort only decides which", () => {
    const bar = stripComments(read("components/ActionBar.tsx"))
    // The anti-"Global Feed over Positions" guard. Load-bearing.
    expect(bar).toMatch(/location\.pathname\.startsWith\("\/feed"\)/)
    // The guard that used to hide the row from the page feed is gone.
    expect(bar).not.toMatch(/sortBy !== "timeline"[\s\S]{0,20}return null/)
    // "Global Feed" is now one branch of a label, not the row's reason to
    // exist — so it appears exactly once in the code.
    expect(bar.match(/"Global Feed"/g) ?? []).toHaveLength(1)
  })

  /**
   * THE LABEL MUST NAME THE SCOPE THE FEED ACTUALLY FETCHED.
   *
   * CORRECTION TO AN EARLIER ASSERTION IN THIS FILE. It used to read
   * `expect(bar).toMatch(/siteHost\(/)` under a comment saying "the other
   * branch names the page by its host". That assertion was not merely
   * inconvenient, it was WRONG: views/comment.tsx:83-89 fetches
   * `decodeURIComponent(currentUrl)` — the whole page URL — whenever
   * `isDomainPost` is false, and only falls back to `url.hostname` when it is
   * true. Pinning the host as THE page-feed label therefore froze a pill that
   * named the site over a feed of one article's posts, and printed the same
   * string in both scopes so the row could not distinguish them. What follows
   * asserts the real invariant: three query scopes, three labels.
   */
  it("labels all three scopes the feed can fetch, distinguishably", () => {
    const bar = stripComments(read("components/ActionBar.tsx"))
    // The label reads the SAME two pieces of state the query does.
    expect(bar).toMatch(/isDomainPost/)
    expect(bar).toMatch(/sortBy === "timeline"/)
    // The page scope is named by the page, using the composer's own rule
    // (helpers/urlHelper's removeUrlPrefixes, CreatePost.tsx:265) — not the
    // host, and not that call site's hard `.slice(0, 20)` cut.
    expect(bar).toMatch(/removeUrlPrefixes\(currentUrl\)/)
    expect(bar).not.toMatch(/slice\(0, ?20\)/)
    // The site scope is named by the host, and worded so it can never be
    // mistaken for the page scope on a front page, where the page URL and the
    // site are the same string.
    expect(bar).toMatch(/siteHost\(/)
    expect(bar).toMatch(/`All of \$\{host\}`/)
  })

  it("a long page URL ellipsises instead of pushing the funnel off the edge", () => {
    const bar = stripComments(read("components/ActionBar.tsx"))
    // HeaderPillText owns nowrap + overflow + text-overflow; a raw Typography
    // does not, and the label is now arbitrary user-visited text.
    expect(bar).toMatch(/<HeaderPillText/)
    // ...and min-width:0, without which a flex item refuses to shrink and the
    // ellipsis never fires at all.
    expect(bar).toMatch(/minWidth: 0/)
  })

  /**
   * THE ROW FITS, AND IT GOT SMALLER — BOTH READ OUT OF THE SOURCE.
   *
   * The owner's instruction about this row was "çok az üstten alttan eşit
   * şekilde büzelim": a little smaller, symmetrically. The first pass trimmed
   * the pill 4px→3px (−2px) and in the same change moved a 36×36 header
   * button onto the row, which took it from 6+28+6 = 40px to 6+36+6 = 48px —
   * 8px TALLER than the thing that was asked to shrink, with a 26px chip
   * beside a 36px circle. A prose assertion would not have caught that, so
   * this adds the numbers up the way profile-filter-fit.spec.ts does.
   */
  describe("the row is shorter than it was, and both controls are one height", () => {
    const bar = stripComments(read("components/ActionBar.tsx"))
    const funnel = stripComments(read("components/FeedFilterButton.tsx"))

    /** HeaderPill.tsx:51 — 1px hairline, top and bottom. */
    const PILL_BORDER = 2
    /** HeaderPillText: 12px × line-height 1.5 (HeaderPill.tsx:88-90). */
    const PILL_LINE_BOX = 18
    /** The row before the funnel ever landed on it: 6 + 28 + 6. */
    const BEFORE = 40
    /** Header.tsx:616-617 py 10px, around the 36×36 chrome of :623-627. */
    const HEADER = 10 + 36 + 10

    // One `id="action-bar"` in the file now that the unreachable
    // /announcements row is gone, so this slice is the whole live row.
    const feedRow = bar.slice(bar.indexOf('id="action-bar"'))
    const rowPadY = num(feedRow, "py")
    /**
     * THE PILL'S TRIM IS NOT READ OUT OF THIS ROW ANY MORE.
     *
     * It used to be: the feed's call site declared `paddingY: "3px"` while
     * HeaderPill's own default stayed 4px, and this line read the override.
     * The two label pills that actually render (this one and Tasks) then
     * disagreed with the shared component AND, through their bell, with each
     * other. The trim and the 13px sides both moved into HeaderPill and the
     * overrides were deleted, so the number now lives where every screen
     * reads it — see components/header-pill-one-height.spec.ts, which is
     * where "one label, one height" is asserted directly.
     */
    const pillPadY = num(stripComments(read("components/HeaderPill.tsx")), "paddingY")
    const pill = PILL_BORDER + pillPadY * 2 + PILL_LINE_BOX
    const funnelH = num(funnel, "height")
    const row = rowPadY * 2 + Math.max(pill, funnelH)

    it("puts the same height on both sides of the row", () => {
      expect(funnelH).toBe(pill)
    })

    it("ends up shorter than the 40px it started at", () => {
      expect(row).toBeLessThan(BEFORE)
    })

    it("stays well under the header row it sits beneath", () => {
      expect(row).toBeLessThan(HEADER)
    })

    it("fills a 320px panel exactly and never exceeds it", () => {
      // Row content box at the panel's floor: 320 − px 10 − px 10 = 300.
      const content = 320 - 10 * 2
      const gap = num(feedRow, "gap")
      // The funnel is a circle, so its horizontal budget IS its height. Said
      // out loud because the reserve below is derived from the height.
      expect(num(funnel, "width")).toBe(funnelH)
      const reserve = Number(
        bar.match(/maxWidth: "calc\(100% - (\d+)px\)"/)?.[1] ?? NaN,
      )
      // What the pill gives up must be exactly what sits to its right — the
      // funnel plus the flex gap. A funnel resize that forgets this number is
      // how the control gets pushed off the right edge.
      expect(reserve).toBe(funnelH + gap)
      // THE FLOOR ASSERTION THAT USED TO CLOSE THIS TEST IS GONE, and both
      // halves of why are worth keeping. The pill had a minWidth of 183px and
      // this checked that the floor sat under the cap; the owner then asked
      // for a content-width label box, so the floor was deleted from
      // ActionBar. What was left here was worse than a stale comment: the
      // reader `num(feedRow, "minWidth")` found HeaderPillText's own
      // `minWidth: 0` instead and asserted 0 <= 266, so the test went on
      // passing while its sentence described a floor that no longer existed.
      // A green suite that says something false is the exact failure
      // components/header-pill-surface.spec.ts:50-67 was written about.
      //
      // The invariant itself did not disappear, it moved: the absence of a
      // floor is asserted directly in components/feed-label-mark.spec.ts,
      // and the cap arithmetic above is untouched and is what actually keeps
      // the funnel on screen at 320px.
    })
  })
})
