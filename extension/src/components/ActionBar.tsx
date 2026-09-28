import { Box } from "@mui/material"
import { useMemo } from "react"
import { useLocation, useParams } from "react-router"
import PoppinLogo from "~/assets/logo.png"
import { siteHost } from "~/helpers/siteMark"
import { removeUrlPrefixes } from "~/helpers/urlHelper"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { useUIStore } from "~/store/useUIStore"
import { FeedFilterButton } from "./FeedFilterButton"
import { HeaderPill, HeaderPillFavicon, HeaderPillText } from "./HeaderPill"
import { HomeIcon } from "./icons"

/**
 * THE FEED'S LABEL ROW — which room you are in, and the one control that
 * changes what it shows.
 *
 * ── WHAT THIS FILE USED TO BE ───────────────────────────────────────────────
 * It opened with a doc-comment for a `StyledSelect` described as "the URL /
 * domain selector at the top of the feed", followed by three more styled()
 * blocks (a time-range Select, a sort Select, a menu item) that nothing in
 * the repo rendered. The selector's job — "this page" vs "all posts on this
 * site" — moved into FeedFilterButton's toggle long ago; what stayed behind
 * was ~130 lines of dead CSS whose own comment still asserted that the page
 * canvas was "#000". The canvas has been BRAND_GROUND (a blue-cast near-black
 * under two accent auroras, helpers/brandGround.ts) for a while now, so that
 * was a dead explanation of live code — and the standing counter-example that
 * made the black pill below look deliberate. All four blocks are gone.
 *
 * What remains is the row itself: a label pill on the left, the feed's funnel
 * on the right.
 */

export type FilterValue = "newest" | "oldest" | "most_liked" | "less_liked"

interface ActionBarProps {
  sortBy: string
}

export default function ActionBar({ sortBy }: ActionBarProps) {
  const location = useLocation()
  const params = useParams()

  const { currentUrl } = useCurrentUrlStore()
  /**
   * The same flag views/comment.tsx reads to choose its query scope (its
   * `passedUrl` memo). The label is derived from it for exactly that
   * reason — see the derivation below.
   */
  const { isDomainPost } = useUIStore()

  const postId = useMemo(() => {
    if (params.postId) {
      return params.postId
    }
    if (location.state?.postId) {
      return location.state.postId
    }
    return null
  }, [params.postId, location.state?.postId])

  const userId = useMemo(() => {
    if (params.userId) {
      return params.userId
    }
    if (location.state?.userId) {
      return location.state.userId
    }
    return null
  }, [params.userId, location.state?.userId])

  const username = useMemo(() => {
    if (params.username) {
      return params.username
    }
    if (location.state?.username) {
      return location.state.username
    }
    return null
  }, [params.username])

  if (postId || userId || username || location.state?.username) return null

  if (
    [
      "/referral",
      "/edit-profile",
      "/profile",
      "/terminal",
    ].some((route) => location.pathname.includes(route))
  ) {
    return null
  }

  /**
   * ONE ROW, BOTH FEEDS — and the funnel now sits on it.
   *
   * `/feed` is a single route with two modes: `sort === "timeline"` is the
   * global feed, anything else is the feed for the page the reader is on
   * (views/comment.tsx scopes its query off the same store). This row used to
   * render in the first mode only, so the page feed had no label at all and
   * its identity was left to the composer placeholder underneath it. Both
   * modes get the row now: `sort` chooses WHICH label prints, not WHETHER a
   * label prints.
   *
   * THE FUNNEL MOVED HERE FROM THE HEADER, on the owner's call. It was
   * mounted in the header's right-hand group, and Layout gives a header to
   * nearly every route — so a control that only drives the feed's sort, kind
   * and whole-site toggle rode along over Positions, Wallet, Tasks and
   * Notifications, where nothing reads what it sets. A control belongs beside
   * the thing it changes.
   *
   * THE PATHNAME GUARD BELOW IS LOAD-BEARING — DO NOT WEAKEN IT. `sort` is
   * panel-wide state that outlives a route, so after the restructure moved
   * the feed to /feed this row went on stamping "Global Feed" over the
   * Positions screen: a label naming a screen the reader was not looking at.
   * The route is the fact; the sort is a mode within it. Only the sort guard
   * is gone, and dropping it cannot bring that back — /feed is the one route
   * that renders a feed (entries/popup/App.tsx), so the pathname alone still
   * decides whether any label prints.
   */
  if (!location.pathname.startsWith("/feed")) return null

  /**
   * THE LABEL NAMES WHAT THE FEED ACTUALLY FETCHED — ALL THREE SCOPES.
   *
   * views/comment.tsx's `passedUrl` memo builds the feed's scope from two
   * pieces of state, not one:
   *
   *   sort === "timeline"          → website_url undefined  → every post
   *   isDomainPost                 → url.hostname           → the whole site
   *   otherwise (sort "currentUrl") → decodeURIComponent(currentUrl)
   *                                                          → THIS PAGE
   *
   * so a label derived from `sortBy` alone can only ever be right about one
   * of the two page-scoped cases. It printed the bare host in both, which
   * meant that on coingecko.com/coins/bitcoin the pill said "coingecko.com"
   * over a feed holding that single article's posts — naming a room you are
   * not in — and printed a byte-identical string whether the site toggle was
   * on or off, so the row could not tell you which of the two you were
   * looking at. Reading `isDomainPost` here is what closes both halves.
   *
   * HOW A PAGE IS NAMED: `removeUrlPrefixes` (helpers/urlHelper.ts:85), the
   * same rule the composer placeholder underneath this row uses
   * (CreatePost.tsx's `getPlaceholder`). What is NOT borrowed is that call
   * site's `.slice(0, 20)` — a hard character cut mid-word
   * ("coingecko.com/coins/"). The pill ellipsises instead: HeaderPillText
   * owns nowrap/overflow, and the text box is the pill's cap minus the site
   * mark and its gap — the arithmetic is written out on the `maxWidth` below
   * and belongs there, not restated here where it would go stale the next
   * time the mark or the funnel moves. Ordinary article URLs print whole;
   * only the long ones taper. A lone trailing slash is dropped so a site's
   * front page reads "coingecko.com" and not "coingecko.com/".
   *
   * HOW A SITE IS NAMED: the host, via helpers/siteMark's `siteHost` ("a
   * label with no room for a path"), under the funnel's own wording — the
   * toggle 8px to the right says "All posts in this site". Without that
   * prefix the two scopes would still collide on a front page, where the
   * page URL and the site are the same string; "All of coingecko.com" can
   * never be mistaken for the single page.
   */
  const isGlobal = sortBy === "timeline"
  const host = siteHost(currentUrl || "")
  const page = currentUrl
    ? removeUrlPrefixes(currentUrl).replace(/\/+$/, "")
    : ""

  const label = isGlobal
    ? "Global Feed"
    : isDomainPost
      ? host
        ? `All of ${host}`
        : "This site"
      : page || "This page"

  return (
    <Box
      id="action-bar"
      sx={{
        display: "flex",
        // Both children measure 26px now, so this centres nothing — which is
        // the point. While the funnel was 36px it centred a 26px pill in a
        // 36px line box, pushing the label 5px further from the header than
        // it had ever been.
        alignItems: "center",
        // Label hard left, funnel hard right. The gap is the floor the pill's
        // maxWidth is measured against, so the two must stay in step.
        justifyContent: "space-between",
        gap: "8px",
        px: "10px",
        // THE ROW'S HEIGHT, ADDED UP: 6 + max(pill 26, funnel 26) + 6 = 38px,
        // against the header's own 10 + 36 + 10 = 56px (Header.tsx:616-617,
        // 623-627). Before any of this it was 6 + 28 + 6 = 40px, and the
        // owner asked for less, not more. Both the pill's paddingY trim and
        // the funnel's 26px are what get it there; changing either without
        // the other puts the row back over 40px.
        //
        // THE SITE MARK COSTS THIS SUM NOTHING. It is 16px and rides inside
        // the label's own 18px line box (12px × 1.5, HeaderPill.tsx:89-91),
        // so the pill's content height is still 18 and the pill is still
        // 1 + 3 + 18 + 3 + 1 = 26. A mark above 18px would become the pill's
        // height and this whole sum would move — HeaderPillFavicon's header
        // says so where the size lives.
        py: "6px",
        width: "100%",
      }}
    >
      {/*
        THE LABEL WEARS THE SYSTEM'S SURFACE, NOT A BLACK SLAB.

        This pill passed `bg="#000"` into HeaderPill, from a time when the
        panel canvas really was #000 and a black pill read as stitched into
        the page. The canvas is BRAND_GROUND now — a blue-cast near-black
        under two accent auroras, painted once by Layout — so the same opaque
        #000 reads as a hole punched in a lit room, matching neither the
        header's white glass directly above it nor HeaderPill's own surface on
        Tasks. Dropping the override IS the fix: HeaderPill's default is
        JUICE.well over the JUICE.border hairline, which is what the other
        header label that actually renders — the Tasks pill — already wears.

        THE TRIM (HeaderPill's canonical paddingY 4px → 3px, equal top and
        bottom) is the owner's explicit instruction — "çok az üstten alttan
        eşit şekilde", i.e. a little smaller, symmetrically, NOT bigger. It is
        deliberately local to this call site: 4px is the cross-screen height
        contract HeaderPill's own header documents, and moving the trim there
        would restyle the Tasks pill, which nobody reported.

        THE COST OF THAT LOCALITY, MEASURED RATHER THAN GUESSED. An earlier
        version of this paragraph put it at "26px here, 28px on Tasks, so the
        label shifts 1px". Both halves were wrong. The Tasks pill's tallest
        child is not its text but a 20px `.bell-container` (views/tasks.tsx:
        42-48) holding a 12px glyph, so it measures 1 + 4 + 20 + 4 + 1 = 30px
        against this pill's 1 + 3 + 18 + 3 + 1 = 26px — a 4px difference, 2px
        per side. Closing it belongs to Tasks (shrink that 20px box to the
        18px line box its own text already occupies), not here: this row was
        told to get smaller and did.

        AND THE TRIM ONLY COUNTS IF THE ROW KEEPS IT. The first pass took the
        2px here and then set a 36px funnel down beside it, so the row the
        owner asked to shrink finished 8px TALLER than it started and a 26px
        chip sat next to a 36px circle. The funnel is 26px now
        (FeedFilterButton.tsx) and the two heights are one number; the row
        arithmetic is written out on the container's `py` above.

        THE 183px FLOOR IS GONE, AND THE COMMENT THAT DEFENDED IT WAS WRONG.
        It read "minWidth 183px STAYS… tasks.tsx and PageTitle use the same
        number, and it is what keeps a label pill the same width as you move
        around." The owner has overruled the conclusion — "o kutu gerektiği
        kadar olsun", the box should be only as wide as it needs — and the
        premise did not survive checking either. PageTitle had no call site
        anywhere in src — it has since been deleted outright — so the "same
        width as you move around" it was protecting was a width shared with a
        component that rendered on no screen; the only other live header pill
        is Tasks (views/tasks.tsx). And a floor is the wrong tool for THIS pill in particular: the
        other pills name a screen with a fixed word ("Tasks"), while this one
        prints whatever URL the reader is standing on, so a floor could only
        ever pad "Global Feed" out into a slab and never help the long case,
        which is what the cap below is for. Content-width now: short labels
        get a short pill, and the funnel stays hard right on its own
        (`justifyContent: space-between` above).
      */}
      <HeaderPill
        sx={{
          // Never wider than the row minus the 26px funnel and the 8px gap,
          // so a long page URL ellipsises inside the pill (HeaderPillText
          // owns the nowrap/ellipsis) instead of shoving the control off the
          // right edge in a 320px panel. With the floor gone this cap is the
          // ONLY thing standing between a 200-character URL and the funnel.
          //
          // AT 320px, EXACTLY: the row's content box is 320 − 10 − 10 = 300px,
          // this pill caps at 300 − 34 = 266px, and 266 + 8 + 26 = 300. The
          // row fills its width and never exceeds it — no horizontal scroll,
          // nothing clipped, nothing off-edge. 34 tracks the funnel: if that
          // control's width changes, this number changes with it.
          //
          // AND WHAT IS LEFT FOR THE TEXT, at that cap: 266 − 2 (HeaderPill's
          // 1px border per side, HeaderPill.tsx:52, counted in because
          // CssBaseline puts the panel in border-box, ProvidersWrapper.tsx:34)
          // − 26 (13px of padding per side, now HeaderPill's own default
          // rather than an override here) − 16 (the mark) − 6 (HeaderPill's
          // gap) = 216px. The mark
          // cost the label 22px of reading width; that is the price of the
          // icon, and it is written down rather than discovered later.
          //
          // What the dropped floor changes is only the OTHER end: below the
          // cap the pill is as wide as its contents (1 + 13 + mark 16 + gap 6
          // + text + 13 + 1) and no wider.
          //
          // THE PADDING AND THE TRIM ARE NOT DECLARED HERE ANY MORE. They
          // were, and so was the same pair at the Tasks call site, which left
          // the shared component carrying a shape neither pill wore. Both
          // moved into HeaderPill's default; the numbers above are unchanged
          // because the values did not change, only their home.
          maxWidth: "calc(100% - 34px)",
          overflow: "hidden",
        }}
      >
        {/*
          THE SITE WEARS ITS OWN FACE; THE ABSTRACTION WEARS A GLYPH.

          Both page-scoped branches name a real origin — one page of it, or
          all of it — so both lead with that origin's favicon, round, the same
          mark a post in the feed carries (components/Post/WebsiteFavicon.tsx).
          The previous version argued that "a URL and a hostname are their own
          icons"; they are not, they are a wall of grey text, and the owner
          asked for the mark back.

          "Global Feed" KEEPS THE HomeIcon, and this is the honest split
          rather than a leftover: that branch has no site, so there is no
          favicon to fetch — it is the one label naming an abstraction instead
          of a place.

          Both marks fail closed. HomeIcon's flexShrink keeps the 14px glyph
          square when a long label presses on it; HeaderPillFavicon renders
          nothing at all when the URL is unparseable or the image will not
          load, so the "This page" / "This site" fallback labels never sit
          beside an empty box. The white ink is inherited from HeaderPill —
          SvgIcon defaults to color:inherit — so no call site restates it.
        */}
        {isGlobal ? (
          <HomeIcon sx={{ height: "14px", width: "14px", flexShrink: 0 }} />
        ) : (
          <HeaderPillFavicon url={currentUrl || ""} logo={PoppinLogo} />
        )}
        {/* minWidth 0 is what makes the ellipsis real. A flex item defaults to
            min-width:auto, so text-overflow never fires — it just refuses to
            shrink below its own width and gets hard-cut by the pill's
            overflow. */}
        <HeaderPillText sx={{ minWidth: 0 }}>{label}</HeaderPillText>
      </HeaderPill>

      {/* The feed's one control, finally next to the feed it filters — and
          sized to this row (26px) rather than to the header it came from
          (36px), so the row reads as one line. */}
      <FeedFilterButton />
    </Box>
  )
}
