import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE ROW IS ABOUT THE PERSON IN IT.
 *
 * Reported as "for a person I already follow there is still a follow icon
 * button — it should be unfollow". The cause was not the icon. FollowerItem
 * asked `useFollowingStatus([currentUser.id])`, matched on
 * `following_id === currentUser.id`, and handed `userId={currentUser.id}` to
 * the button: three expressions describing the READER, in a list whose whole
 * job is to describe twenty other people. Every row therefore showed the same
 * state, and pressing one asked the API to follow yourself. The correct
 * answer was already arriving as the `isFollowing` prop, batched by the tab,
 * and was never read.
 *
 * A source-level guard, in the shape profile-head-row.spec and
 * portfolio-hero.spec already use. Mounting the row would need a
 * QueryClient, a theme, a router and a mocked currentUser to assert one
 * identifier; what has to stay true is a property of the SOURCE — the row
 * may not name the current user at all.
 */
const HERE = __dirname
const ITEM = readFileSync(join(HERE, "FollowerItem.tsx"), "utf8")
const BUTTON = readFileSync(join(HERE, "FollowButton.tsx"), "utf8")
const FOLLOWERS = readFileSync(join(HERE, "profile", "FollowersTab.tsx"), "utf8")
const FOLLOWING = readFileSync(join(HERE, "profile", "FollowingTab.tsx"), "utf8")

/** Comments state intent; only the code may be asserted on. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const ITEM_CODE = strip(ITEM)
const BUTTON_CODE = strip(BUTTON)
const FOLLOWERS_CODE = strip(FOLLOWERS)
const FOLLOWING_CODE = strip(FOLLOWING)

describe("the row never speaks for the reader", () => {
  it("does not look the current user up at all", () => {
    /**
     * The strongest form of the guard, and the one that also closes the
     * crash: `currentUser!.id` was force-unwrapped twice at the top of the
     * component, while both parents render rows unconditionally and gate only
     * `showFollowButton` on `currentUser` existing (FollowersTab.tsx,
     * `!!currentUser && currentUser.id !== follower.id`). A sheet opened
     * before that query settles used to throw.
     */
    expect(ITEM_CODE).not.toMatch(/useCurrentUser/)
    expect(ITEM_CODE).not.toMatch(/currentUser/)
  })

  it("runs no follow-status query of its own", () => {
    // One batched query per page lives in the tabs. A per-row query would be
    // a request per visible row for an answer the parent already has, keyed
    // on a different array — so useFollowUser's optimistic patch would land
    // in two caches that can disagree.
    expect(ITEM_CODE).not.toMatch(/useFollowingStatus/)
  })

  it("targets the listed user with the button", () => {
    const call = ITEM_CODE.slice(ITEM_CODE.indexOf("<FollowButton"))
    expect(call).toMatch(/userId=\{follower\.id\}/)
    expect(call).not.toMatch(/userId=\{currentUser/)
  })

  it("reads the isFollowing prop it is handed instead of re-deriving it", () => {
    const call = ITEM_CODE.slice(ITEM_CODE.indexOf("<FollowButton"))
    expect(call).toMatch(/isFollowing=\{isFollowing\}/)
    // Not a locally computed lookup of any kind.
    expect(call).not.toMatch(/isFollowing=\{!!/)
  })
})

describe("the tabs are where the answer is computed", () => {
  it("matches the status row against the LISTED user, in both tabs", () => {
    expect(FOLLOWERS_CODE).toMatch(/status\.following_id === follower\.id/)
    expect(FOLLOWING_CODE).toMatch(/status\.following_id === following\.id/)
    // Never against the reader — that is the bug this file exists for.
    expect(FOLLOWERS_CODE).not.toMatch(/status\.following_id === currentUser/)
    expect(FOLLOWING_CODE).not.toMatch(/status\.following_id === currentUser/)
  })

  it("asks about the listed ids, not the reader's", () => {
    expect(FOLLOWERS_CODE).toMatch(/useFollowingStatus\(currentUser \? userIds : \[\]\)/)
    expect(FOLLOWING_CODE).toMatch(/useFollowingStatus\(currentUser \? userIds : \[\]\)/)
    expect(FOLLOWERS_CODE).not.toMatch(/useFollowingStatus\(\[currentUser/)
    expect(FOLLOWING_CODE).not.toMatch(/useFollowingStatus\(\[currentUser/)
  })

  it("hides the button on your own row rather than offering self-follow", () => {
    expect(FOLLOWERS_CODE).toMatch(/currentUser\.id !== follower\.id/)
    expect(FOLLOWING_CODE).toMatch(/currentUser\.id !== following\.id/)
  })
})

/**
 * THE STATE HAS TO BE READABLE, WHICH THE ICON ALONE IS NOT.
 *
 * FollowIcon.svg and UnfollowIcon.svg draw the identical person and the
 * identical horizontal bar; FollowIcon adds one extra vertical bar, 18.4
 * units wide in a 500-unit viewBox, to close the plus. That is the entire
 * visual difference between "follow" and "unfollow", and FollowButton
 * rendered it at 14px. The owner's report — that it looks like a follow
 * button either way — is a property of the assets, not a misreading.
 *
 * So the sheet spells the state instead of drawing it.
 */
describe("the follow state is spelled out in the sheet", () => {
  it("uses the extended button", () => {
    const call = ITEM_CODE.slice(ITEM_CODE.indexOf("<FollowButton"))
    expect(call).toMatch(/isExtended/)
  })

  it("still has words to spell it with", () => {
    expect(BUTTON_CODE).toMatch(/isFollowing \? "Following" : "Follow"/)
  })
})

/**
 * PRESS MUST NOT MOVE THE ROW. An extended button is `width: auto`, so the
 * label measures it; the pending branch used to replace the entire content
 * with a spinner, collapsing the button to spinner-width mid-flight and
 * dragging the row's right edge with it. Same defect class as hover changing
 * geometry, arriving through the loading state instead.
 */
describe("the in-flight button keeps its width", () => {
  const extended = BUTTON_CODE.slice(
    BUTTON_CODE.indexOf("{isExtended ? ("),
    BUTTON_CODE.indexOf(": isPending ? ("),
  )

  it("keeps the label mounted while the mutation runs", () => {
    expect(extended).toMatch(/isFollowing \? "Following" : "Follow"/)
    // The pending check is INSIDE the extended branch, below the label —
    // if it ever wraps the label again this ordering breaks.
    expect(extended.indexOf('"Following"')).toBeLessThan(
      extended.indexOf("isPending"),
    )
  })

  it("swaps only a fixed-size glyph slot", () => {
    expect(extended).toMatch(/width: 12,\s*height: 12,\s*flexShrink: 0,/)
    expect(extended).toMatch(/<CircularProgress size=\{12\}/)
  })

  it("does not let the button be squashed by the name beside it", () => {
    // The wrapper is the flex item callers lay out, so the rule lives there.
    const wrapper = BUTTON_CODE.slice(
      BUTTON_CODE.indexOf("const ButtonWrapper"),
      BUTTON_CODE.indexOf("const StyledButton"),
    )
    expect(wrapper).toMatch(/flexShrink: 0/)
  })
})

/**
 * THE POINTS ARE GONE FROM THIS ROW. The product no longer gives points per
 * post, so a ditto badge beside a name in a followers list is a number
 * standing for nothing.
 */
describe("no points in the sheet", () => {
  it("draws no ditto badge", () => {
    expect(ITEM_CODE).not.toMatch(/DiamondIcon/)
    expect(ITEM_CODE).not.toMatch(/formatCompactNumber/)
    expect(ITEM_CODE).not.toMatch(/\bditto\b/)
  })
})

/**
 * `{count && count > 0 && <Badge/>}` renders a literal 0 when count is 0 —
 * and the parents pass `userStreak?.current_streak || 0`, so that was every
 * row without a streak. A stray "0" is still a text node, still a flex item,
 * and still earns the parent's gap. The retired leaderboard row dodged this
 * with a `? :` and an empty string; this row did not.
 */
describe("the streak badge is guarded as a whole element", () => {
  it("coerces before it decides", () => {
    expect(ITEM_CODE).toMatch(
      /const streakCount = follower\.activeStreakCount \?\? 0/,
    )
    expect(ITEM_CODE).toMatch(/\{streakCount > 0 && <StreakBadge/)
    expect(ITEM_CODE).not.toMatch(
      /follower\.activeStreakCount && follower\.activeStreakCount > 0/,
    )
  })
})

/**
 * The row has a fixed-width avatar and a button that refuses to shrink, so
 * the identity column is the only thing left that can give at 320px. It can
 * only give if the flex chain lets it: a flex item's default min-width is its
 * content, which is why minWidth:0 has to appear on every level down to the
 * text. Without it a long display_name pushes the button off the row.
 */
describe("the row fits at 320px", () => {
  it("lets the identity column shrink", () => {
    expect(ITEM_CODE).toMatch(/minWidth: 0/)
    expect(ITEM_CODE.match(/minWidth: 0/g)!.length).toBeGreaterThanOrEqual(3)
  })

  it("truncates the name and the handle rather than overflowing", () => {
    expect(ITEM_CODE.match(/textOverflow: "ellipsis"/g)!.length).toBe(2)
  })

  it("does not hide a scrollbar to make it fit", () => {
    // Banned repo-wide: a row that slides is a row with content nobody can
    // reach. See the note in ProfileFeed.tsx.
    expect(ITEM_CODE).not.toMatch(/overflowX: "auto"/)
    expect(ITEM_CODE).not.toMatch(/webkit-scrollbar/)
  })
})
