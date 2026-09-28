import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE FILTER ROW HAS TO FIT, AND IT HAS TO SAY "LIKES".
 *
 * Two defects, one row. It said "Upvoted" — the last surface still speaking
 * the API's word to a reader, when notificationText has collapsed every
 * upvote_* row to the kind "like" for a long time. And it was built to SLIDE
 * rather than fit: `overflowX: "auto"` with the scrollbar styled invisible
 * and `flexShrink: 0` on every pill, so at the panel's 320px minimum the
 * fifth segment lived off-screen with nothing to hint it was there.
 *
 * The rename is not the fix for the fit. Measured against the shipped face
 * (Poppins-Bold, which is what weight 700 of PoppinSans resolves to) at 12px,
 * the five segments needed 374.6px of a 318px budget; swapping "Upvoted"
 * (52.18px) for "Likes" (30.77px) leaves it 35.2px over. The padding and gap
 * are what buy the fit, so this spec guards them ARITHMETICALLY: it reads the
 * real numbers out of the component and adds up the row. A future padding
 * bump fails here instead of silently re-overflowing on somebody's phone.
 */
const FILTER_SRC = readFileSync(join(__dirname, "ProfileFeed.tsx"), "utf8")
const EMPTY_SRC = readFileSync(join(__dirname, "..", "EmptyState.tsx"), "utf8")
/** Comments state intent; only the code may be asserted on. */
const CODE = FILTER_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the profile filter says Likes", () => {
  it("labels the segment for the reader, not for the endpoint", () => {
    expect(CODE).toMatch(/\["upvoted", "Likes"\]/)
    expect(CODE).not.toMatch(/"Upvoted"/)
  })

  it("keeps `upvoted` as the key it queries with", () => {
    // The rename is a LABEL change. `upvoted` still names the query, the
    // enable checks and the EmptyState branch, and renaming it would drag
    // /users/upvoted-status and every hook along for no reader's benefit.
    expect(CODE).toMatch(/kind === "upvoted"/)
    expect(CODE).toMatch(/useUpvotedPosts/)
  })

  it("says the same word in the empty state", () => {
    expect(EMPTY_SRC).toMatch(/"No liked posts yet"/)
    expect(EMPTY_SRC).not.toMatch(/"No upvoted posts yet"/)
  })
})

describe("the profile filter fits", () => {
  it("does not slide, and does not hide the scrollbar that says it slid", () => {
    expect(CODE).not.toMatch(/overflowX:\s*"auto"/)
    expect(CODE).not.toMatch(/webkit-scrollbar/)
  })

  it("shares the row instead of each pill hugging its own label", () => {
    // "1 1 auto", never "1 1 0"/"flex: 1": an equal fifth of the row is
    // 54px, and "Replies" needs 62.5px at this type step, so literal equal
    // flex clips two of the five at 320px.
    expect(CODE).toMatch(/flex:\s*"1 1 auto"/)
    expect(CODE).not.toMatch(/flexShrink:\s*0/)
  })

  it("keeps a second line as the valve below 320px", () => {
    // A wrapped row is honest; a hidden scrollbar is not.
    expect(CODE).toMatch(/flexWrap:\s*"wrap"/)
  })

  /**
   * Advance widths of the five labels at 12px, read from the shipped
   * public/fonts/Poppins-Bold.ttf (hmtx / unitsPerEm). Re-derive with any
   * TTF metrics reader if the face is ever replaced.
   */
  const LABELS = { All: 15.92, Posts: 33.4, Trades: 42.61, Replies: 44.53, Likes: 30.77 }
  /** MUI's default spacing unit; the theme does not override it. */
  const UNIT = 8
  /** 320px panel, less the theme's 2px hairline scrollbar. */
  const BUDGET = 318

  it("adds up to less than the panel's narrowest width", () => {
    const container = CODE.slice(0, CODE.indexOf("options.map"))
    const pill = CODE.slice(CODE.indexOf("options.map"))

    const gap = Number(/gap:\s*([\d.]+)/.exec(container)?.[1])
    const gutter = Number(/px:\s*([\d.]+)/.exec(container)?.[1])
    const padX = Number(/px:\s*([\d.]+)/.exec(pill)?.[1])
    expect([gap, gutter, padX].every(Number.isFinite)).toBe(true)

    const labels = Object.values(LABELS)
    // Each pill is its label plus padding plus a 1px border either side.
    const pills = labels.reduce((t, w) => t + w + padX * UNIT * 2 + 2, 0)
    const row = gutter * UNIT * 2 + pills + gap * UNIT * (labels.length - 1)

    expect(row).toBeLessThan(BUDGET)
  })

  it("does not raid the gutter that lines this row up with the head", () => {
    // px: 2 matches ProfileHead's px: 2. There is slack in the budget above;
    // buying more width by breaking the alignment is not the trade.
    const container = CODE.slice(0, CODE.indexOf("options.map"))
    expect(/px:\s*2\b/.test(container)).toBe(true)
  })
})
