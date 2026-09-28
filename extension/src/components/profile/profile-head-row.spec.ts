import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE HEAD OF YOUR OWN PROFILE: NO ARROW, AND THE ONE BUTTON BESIDE THE NAME.
 *
 * Reported together, because they were the same 32px of screen. The row above
 * the avatar held a back arrow and "Edit profile". On your own `/profile`
 * tab the arrow pointed nowhere, so the row was a near-empty band and the
 * button floated a line above the person it edits.
 *
 * `isOwnProfileView` (tested next door) decides the arrow: your own page
 * never carries one, whichever door you came through. This spec guards the
 * LAYOUT that follows from it, which is otherwise untested: that the row is
 * conditional rather than always drawn, that the button moved down onto the
 * identity row, and that the three rules keeping that row honest at 320px are
 * still there. A source-level guard, in the shape profile-route.spec and
 * portfolio-hero.spec already use — mounting this through a MemoryRouter
 * would test react-router, and jsdom has no layout to ask about the 320px
 * case anyway.
 *
 * It also guards the door that makes "no arrow on your own page" safe rather
 * than a strand — see the last describe.
 */
const HEAD = readFileSync(join(__dirname, "ProfileHead.tsx"), "utf8")
const VIEWS = join(__dirname, "..", "..", "views")
const VIEW = readFileSync(join(VIEWS, "profile.tsx"), "utf8")
const DETAIL = readFileSync(join(VIEWS, "ProfileDetailView.tsx"), "utf8")
/** Comments state intent; only the code may be asserted on. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const HEAD_CODE = strip(HEAD)
const VIEW_CODE = strip(VIEW)
const DETAIL_CODE = strip(DETAIL)

describe("the back arrow", () => {
  it("is handed down by WHOSE page this is, not by how it was reached", () => {
    /**
     * This assertion used to read `isRootProfile ? undefined : goBack` — the
     * root-vs-pushed rule. It was wrong, not merely narrow: every door that
     * names an id counted as a push, and your own id is named by the feed's
     * avatar and name taps, so the arrow and its 32px band came back on your
     * own profile. The rule the owner asked for is the one on the left.
     */
    expect(VIEW_CODE).toMatch(/onBack=\{isOwnProfile \? undefined : goBack\}/)
    expect(VIEW_CODE).not.toMatch(/onBack=\{goBack\}/)
    // And that flag is the same one the rest of the page reads, so the head
    // cannot disagree with the panels below it about whose page this is.
    expect(VIEW_CODE).toMatch(/const isOwnProfile = isOwnProfileView\(/)
  })

  it("still has a goBack to hand down, for the dead ends that use it", () => {
    // The "Profile not found" gate's only button is this function. Deleting
    // it along with the unconditional prop would leave that screen inert.
    expect(VIEW_CODE).toMatch(/const goBack =/)
    expect(VIEW_CODE).toMatch(/onAction=\{goBack\}/)
  })
})

describe("the action row above the avatar", () => {
  it("renders only when something is standing in it", () => {
    expect(HEAD_CODE).toMatch(/const showActionRow = Boolean\(onBack\) \|\| !isOwnProfile/)
    expect(HEAD_CODE).toMatch(/\{showActionRow && \(/)
    // The arrow lives inside that gate, not before it.
    expect(HEAD_CODE.indexOf("{showActionRow && (")).toBeLessThan(
      HEAD_CODE.indexOf("<ArrowBackIcon"),
    )
  })

  it("leaves no margin behind measuring a row that is not there", () => {
    expect(HEAD_CODE).toMatch(/mt: showActionRow \? 1 : 0/)
  })
})

describe("Edit profile", () => {
  it("sits on the identity row, below the avatar and above the bio", () => {
    const avatar = HEAD_CODE.indexOf("<CAvatar")
    const button = HEAD_CODE.indexOf("Edit profile")
    const bio = HEAD_CODE.indexOf("user.bio &&")
    expect(avatar).toBeGreaterThan(-1)
    expect(button).toBeGreaterThan(avatar)
    expect(button).toBeLessThan(bio)
  })

  it("is the item that refuses to shrink at 320px", () => {
    /**
     * The row is avatar 62 + gap 12 + name + gap 12 + this pill inside a
     * 288px content width. Without these two rules the pill is what gives,
     * "Edit profile" wraps onto two lines and the identity row grows taller
     * than the avatar. The NAME is the half that may truncate.
     */
    const pill = HEAD_CODE.slice(HEAD_CODE.indexOf("{isOwnProfile && ("))
    expect(pill).toMatch(/flexShrink: 0/)
    expect(pill).toMatch(/whiteSpace: "nowrap"/)
  })

  it("does not squash the badges it now shares the row's width with", () => {
    const nameRow = HEAD_CODE.slice(
      HEAD_CODE.indexOf("<OrganizationBadge"),
      HEAD_CODE.indexOf("@{user.username}"),
    )
    // An <img> sized only by width/height will happily become an oval.
    expect(nameRow.match(/flexShrink: 0/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("leaves the handle able to truncate under it", () => {
    const handle = HEAD_CODE.slice(
      HEAD_CODE.indexOf("@{user.username}") - 400,
      HEAD_CODE.indexOf("@{user.username}"),
    )
    expect(handle).toMatch(/textOverflow: "ellipsis"/)
  })
})

/**
 * WHY TAKING THE ARROW AWAY IS NOT A STRAND.
 *
 * The feed's avatar and name taps push ProfileDetailView with a bare id and
 * no self-check, so they can point at the reader themselves — and that
 * overlay covers the feed while the header's Feed pill still paints itself
 * ACTIVE, because the pathname is unchanged (`/feed`). An arrow-less own
 * profile in there would be a screen whose only exits do not look like exits.
 *
 * So the door is closed rather than the arrow kept: a self-targeted overlay
 * hands the reader to the `/profile` tab, where the same page has the
 * header's identity row pointing at it and the Feed pill plainly inactive
 * one tap away. If this ever regresses, the arrow rule above becomes a trap,
 * which is why it is asserted here and not left to a comment.
 */
describe("your own profile is never the overlay", () => {
  it("recognises the reader in the overlay's own target", () => {
    expect(DETAIL_CODE).toMatch(/useCurrentUser/)
    expect(DETAIL_CODE).toMatch(/const isSelf = Boolean\(/)
    expect(DETAIL_CODE).toMatch(/userId === currentUser\.id/)
  })

  it("sends them to the /profile tab instead of drawing the sheet", () => {
    expect(DETAIL_CODE).toMatch(/navigate\("\/profile", \{ replace: true \}\)/)
    // `replace`, so the entry that would re-open the overlay is not left in
    // history for a later back gesture to bounce off.
    expect(DETAIL_CODE).toMatch(/if \(isSelf\) return null/)
  })

  it("leaves somebody else's overlay exactly as it was", () => {
    // The redirect is gated on isSelf; a stranger's overlay still renders
    // Profile, and profile.tsx still hands that one a back arrow.
    expect(DETAIL_CODE).toMatch(/if \(!isOpen \|\| !isSelf\) return/)
    expect(DETAIL_CODE).toMatch(/<Profile userId=/)
  })
})
