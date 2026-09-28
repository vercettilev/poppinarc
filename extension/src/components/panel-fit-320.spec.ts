import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * FIVE SURFACES THAT DID NOT FIT A 320px PANEL, AND THE ARITHMETIC THAT SAYS
 * THEY DO NOW.
 *
 * The panel can be dragged to 320px. Four of these five were built against a
 * width nobody guaranteed — a reel that scrolled sideways with its scrollbar
 * painted out, a hover card whose MINIMUM was 340px, an emoji picker pinned
 * at its library's 350px inside an 80vw box, and a GIF grid whose column
 * count was decided by the browser window rather than by the 350px box it
 * actually lives in. The fifth (the watchlist row) fit its container and let
 * its text run out of it.
 *
 * WHY SOURCE GUARDS. jsdom implements no cascade and no layout (see the note
 * in vitest.config.ts), so it cannot be asked what any of this measures. What
 * can be pinned is the DECLARATION, and the declaration is where each defect
 * was written. Every number below is read out of the component with a regex
 * and then added up here, so a future padding bump fails in this file instead
 * of silently re-overflowing on somebody's narrow panel. Nothing is retyped
 * from a comment: a sum nobody can re-check is what this repo keeps getting
 * burned by.
 *
 * THE HOUSE RULING THESE ENFORCE is components/profile/ProfileFeed.tsx:70-87,
 * "THE ROW FITS; IT DOES NOT SLIDE … flexWrap is the valve below 320px: a
 * second line is honest, a hidden scrollbar is not."
 *
 * ── TEXT WIDTHS ────────────────────────────────────────────────────────────
 * The panel renders PoppinSans, which helpers/brandFont.ts:32-41 loads out of
 * public/fonts: 400 is Poppins-Regular, 500 Poppins-Medium, 600
 * Poppins-SemiBold, 700 Poppins-Bold. Nothing heavier is loaded, so a
 * declared weight of 800 resolves to the Bold file. Every advance quoted in
 * this file is that TTF's own `hmtx` entry (unitsPerEm 1000) times the
 * declared font size, summed over the string — the same method
 * components/profile/profile-filter-fit.spec.ts:67-72 used. Re-derive with
 * any TTF metrics reader if the face is ever replaced.
 */
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

/**
 * The file with its comments removed. Every guard here would otherwise be
 * trippable by its own documentation — each of these components now explains
 * in prose the declaration it used to carry ("this row was `overflowX:
 * "auto"`"), and a grep-shaped assertion cannot tell an explanation from a
 * relapse.
 */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

/** MUI's default spacing unit; the theme does not override it. */
const UNIT = 8
/** The panel's supported minimum width. */
const PANEL = 320

/**
 * WHAT A SCROLLING CONTAINER TAKES OFF THE PANEL.
 *
 * helpers/themeHelper.ts:228-230 paints a 2px `::-webkit-scrollbar` on `*`,
 * and the house budgets against exactly that: components/profile/
 * ProfileFeed.tsx:76-77 ("318px — the 320px panel less the theme's 2px
 * hairline scrollbar") and components/profile/profile-filter-fit.spec.ts:76
 * both spend 318px on a row inside the profile's scroller. Two of the
 * budgets below sit inside a container that declares a scrolling overflow —
 * the watchlist row (views/profile.tsx:205, `overflowY: "auto"`) and the GIF
 * grid (components/GifSearch.tsx:99, `overflow: "auto"`) — and they were
 * spending the whole 320px, which is 2px more panel than either of them has.
 *
 * IT IS A FLOOR, NOT A CERTAINTY. helpers/themeHelper.ts:242 also declares
 * `scrollbarWidth: "thin"`, and where the standard property is honoured it
 * outranks the `::-webkit-scrollbar` width and draws a bar wider than 2px.
 * Rather than guess which rule a given Chrome applies, every budget here
 * that spends SCROLLBAR also asserts its CONCLUSION survives FAT — a classic
 * 17px Windows bar — so the open question cannot change an answer in this
 * file.
 */
const SCROLLBAR = 2
const FAT_SCROLLBAR = 17

const num = (source: string, re: RegExp, label: string): number => {
  const m = re.exec(source)
  expect(m, `could not read ${label}`).not.toBeNull()
  const v = Number(m![1])
  expect(Number.isFinite(v), `${label} did not read as a number`).toBe(true)
  return v
}

// ───────────────────────────────────────────────────────────────────────────
// WinsRail — the reel
// ───────────────────────────────────────────────────────────────────────────

/**
 * money()'s WIDEST OUTPUT, which is what the card has to reserve for.
 *
 * ENUMERATED, NOT TYPED. This constant used to be the literal 60.41 with
 * "+$1000K" named as the widest string, and it was wrong: `money` rounds
 * ACROSS its own branch boundary. `n.toFixed(n >= 100 ? 0 : 2)` sends a
 * value in [99.995, 100) down the two-decimal path, which prints "$100.00" —
 * one character longer than any other output of that branch and 63.73px
 * against Poppins-Bold at 14px, 3.32px past the old maximum. A hand-picked
 * widest string keeps missing exactly that kind of edge, so the set is
 * enumerated below and the maximum is taken from it.
 *
 * Per-character advances at 14px, read from public/fonts/Poppins-Bold.ttf's
 * `hmtx` (unitsPerEm 1000) — the same method
 * components/profile/profile-filter-fit.spec.ts:67-72 used, and the same
 * assumption: advances summed with no GPOS kerning applied.
 */
const ADVANCE_14_BOLD: Record<string, number> = {
  "+": 8.792,
  $: 9.212,
  ".": 3.948,
  K: 9.758,
  "0": 9.128,
  "1": 5.264,
  "2": 7.994,
  "3": 8.47,
  "4": 9.478,
  "5": 9.1,
  "6": 8.918,
  "7": 7.49,
  "8": 9.072,
  "9": 8.61,
}

/**
 * WinsRail.tsx's `money`, mirrored. The test below pins this against the
 * component's own declaration character for character, so the enumeration
 * cannot drift away from the function it claims to describe.
 */
const money = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`
    : `$${n.toFixed(n >= 100 ? 0 : 2)}`

/**
 * Every string the card can print for a realized win under $1,000,000, with
 * the leading "+" the JSX adds. Four shapes, and each one's own rounding
 * boundary sampled deliberately because that is where the old literal died:
 * "$100.00" (from just under $100), "$1000" (from just under $1000),
 * "$10.0K" (from just under $10,000) and "$1000K" (from just under $1M).
 */
const moneyStrings = (): string[] => {
  const seen = new Set<string>()
  const add = (n: number) => seen.add(`+${money(n)}`)
  for (let cents = 0; cents < 100_000; cents++) add(cents / 100) // $0 … $999.99
  for (let i = 0; i < 1000; i++) add(99.99 + i / 100_000) // → "$100.00"
  for (let n = 999.5; n < 1000; n += 0.01) add(n) // → "$1000"
  for (let n = 1000; n < 10_000; n += 0.5) add(n)
  for (let n = 9_949; n < 10_000; n += 0.25) add(n) // → "$10.0K"
  for (let n = 10_000; n < 1_000_000; n += 5) add(n)
  for (let n = 999_450; n < 1_000_000; n += 5) add(n) // → "$1000K"
  return [...seen]
}

const MONEY = moneyStrings()
const advance = (s: string) =>
  [...s].reduce((t, c) => t + (ADVANCE_14_BOLD[c] ?? NaN), 0)
const MONEY_MAX = MONEY.reduce((m, s) => Math.max(m, advance(s)), 0)

describe("the wins reel fits, and it wraps rather than sliding", () => {
  const WINS = "components/WinsRail.tsx"
  const wr = code(WINS)
  // `{wins.map(` and not `wins.map(`: the MIN_NAMES gate above the JSX reads
  // `new Set(wins.map(…))`, and anchoring on the bare call put every slice
  // below in the wrong half of the file.
  const at = wr.indexOf("{wins.map(")
  const outer = wr.slice(wr.indexOf("return ("), wr.indexOf("Biggest wins"))
  const rail = wr.slice(wr.indexOf("Biggest wins"), at)
  const card = wr.slice(at)
  // The rail does not render into the panel; it renders into a column that
  // carries an inset of its own. See the PARENT_PL read below.
  const feed = code("views/comment.tsx")

  it("does not slide, and does not hide the scrollbar that says it slid", () => {
    // Verbatim from components/profile/profile-filter-fit.spec.ts:50-51, the
    // file that retired this exact pattern on the profile's filter row. This
    // was the last live instance in src.
    expect(wr).not.toMatch(/overflowX:\s*"auto"/)
    expect(wr).not.toMatch(/scrollbar/i)
  })

  it("keeps a second line as the valve below 320px", () => {
    expect(rail).toMatch(/flexWrap:\s*"wrap"/)
    // A card that refuses to shrink turns the valve back off: the row would
    // wrap and still overhang.
    expect(card).not.toMatch(/flex:\s*"0 0 auto"/)
    expect(card).not.toMatch(/minWidth:\s*148/)
  })

  /**
   * THE 10px THE FIRST VERSION OF THIS SPEC FORGOT.
   *
   * views/comment.tsx:277 declares `pl: havePaddingLeft ? "10px" : "0px"` on
   * the column that holds the rail, and the rail's mount (:296) sits inside a
   * block gated on the same three location-state keys `havePaddingLeft`
   * (:154) is built from — so whenever the rail paints, that inset is there.
   * The rail is 310px of column at a 320px panel, not 320. Both numbers are
   * read out of that file rather than typed here: move either and this fails.
   */
  const parentPl = () =>
    num(
      feed,
      /pl:\s*havePaddingLeft \? "(\d+)px" : "0px"/,
      "views/comment.tsx: the feed column's inset",
    )

  it("the column the rail paints into really does carry that inset", () => {
    expect(feed).toMatch(/const havePaddingLeft = !userId && !username && !postId/)
    const mount = feed.indexOf("<WinsRail />")
    expect(mount, "views/comment.tsx: no <WinsRail /> mount").toBeGreaterThan(-1)
    const gate = feed.slice(feed.lastIndexOf('sort === "currentUrl"', mount), mount)
    expect(gate).toMatch(
      /!\(location\.state\?\.userId \|\| location\.state\?\.username \|\| location\.state\?\.postId\)/,
    )
    // And nothing between that column and the rail declares a scrolling
    // overflow, which is why this budget alone spends no SCROLLBAR: the feed's
    // own scroller (ScrollableDiv) is a SIBLING below the rail, not a parent.
    const column = feed.slice(feed.indexOf("pl: havePaddingLeft"), mount)
    expect(column).not.toMatch(/overflow/)
  })

  it("two cards and one gap are exactly the rail, at the panel's floor", () => {
    const mx = num(outer, /mx:\s*([\d.]+)/, `${WINS}: the outer gutter`)
    const gap = num(rail, /gap:\s*([\d.]+)/, `${WINS}: the rail's gap`)
    const basis = num(card, /flex:\s*"1 1 ([\d.]+)px"/, `${WINS}: the card's basis`)

    const railWidth = PANEL - parentPl() - 2 * mx * UNIT // 278
    expect(
      2 * basis + gap * UNIT,
      `${WINS}: two ${basis}px cards and one ${gap * UNIT}px gap need ` +
        `${2 * basis + gap * UNIT}px of a ${railWidth}px rail. Below two per ` +
        `line the reel is a list, which is the shape this component's own ` +
        `doc rejects — and a flex line is collected at each item's BASE size, ` +
        `before any shrinking, so 1px over is a whole extra row.`,
    ).toBeLessThanOrEqual(railWidth)
    // ...and a third does NOT fit, which is why `flex-grow: 1` spending the
    // slack on two cards is the whole layout rather than an accident.
    expect(3 * basis + 2 * gap * UNIT).toBeGreaterThan(railWidth)
  })

  it("the enumeration above is this component's own money(), verbatim", () => {
    const decl = wr.slice(wr.indexOf("const money ="), wr.indexOf("export function")).trim()
    expect(
      decl.replace(/\s+/g, " "),
      `${WINS}: money() changed, so the enumerated width reserve below no ` +
        `longer describes it. Update the mirror in this file in the same edit.`,
    ).toBe(
      "const money = (n: number) => n >= 1000 " +
        "? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` " +
        ": `$${n.toFixed(n >= 100 ? 0 : 2)}`",
    )
  })

  it("the widest figure is the one the branch boundary prints, not the biggest win", () => {
    // Four shapes: 10,000 two-decimal strings below $100 plus "$100.00", 900
    // integers to $1000 plus "$1000", 90 one-decimal K strings plus "$10.0K",
    // and 990 integer K strings plus "$1000K" — 11,984 in all.
    expect(MONEY.length).toBe(11_984)
    expect(MONEY.every((s) => Number.isFinite(advance(s)))).toBe(true)
    // The boundary itself: `n >= 100 ? 0 : 2` takes the two-decimal path and
    // then rounds past its own branch, which is the case a hand-picked
    // "widest string" kept missing.
    expect(money(99.999)).toBe("$100.00")
    const widest = MONEY.reduce((a, b) => (advance(b) > advance(a) ? b : a))
    expect(widest).toBe("+$100.00")
    expect(MONEY_MAX).toBeCloseTo(63.73, 2)
    // The biggest win under $1M is only the runner-up.
    expect(advance("+$1000K")).toBeCloseTo(60.41, 2)
  })

  it("the card's own two rows fit the basis they are given", () => {
    const basis = num(card, /flex:\s*"1 1 ([\d.]+)px"/, `${WINS}: the card's basis`)
    const padX = num(card, /px:\s*([\d.]+)/, `${WINS}: the card's inset`)
    const border = num(
      code("helpers/panelSurface.ts").slice(
        code("helpers/panelSurface.ts").indexOf("PANEL_ROW"),
      ),
      /border:\s*"(\d+)px solid/,
      "helpers/panelSurface.ts: PANEL_ROW's border",
    )
    const content = basis - 2 * padX * UNIT - 2 * border // 113

    // ROW 1 — an 18px avatar, a gap, and a name that ellipsizes to nothing.
    const avatar = num(
      card.slice(card.indexOf("component={w.avatarUrl")),
      /width:\s*(\d+)/,
      `${WINS}: the avatar's size`,
    )
    const idGap = num(
      card,
      /alignItems:\s*"center",\s*gap:\s*([\d.]+)/,
      `${WINS}: the identity row's gap`,
    )
    expect(avatar + idGap * UNIT).toBeLessThanOrEqual(content)

    // ROW 2 — the figure never shrinks (rule 5: numbers are the heroes), so
    // the reserve is the widest string money() can print plus the gap. The
    // ticker is what gives way, and the ellipsis below is what lets it.
    const figGap = num(
      card,
      /alignItems:\s*"baseline",\s*gap:\s*([\d.]+)/,
      `${WINS}: the figure row's gap`,
    )
    const figure = MONEY_MAX + figGap * UNIT
    expect(
      figure,
      `${WINS}: the figure row needs ${figure.toFixed(2)}px of ${content}px ` +
        `of card. Over the basis it stops being a two-up row: the card grows ` +
        `past its own flex-basis and the reel drops to one card per line.`,
    ).toBeLessThanOrEqual(content)
  })

  it("the ticker ellipsizes, because a symbol has no length bound", () => {
    // The symbol comes off the API. Without this the card's min-content is
    // whatever the API sent and the two-up arithmetic above is unenforceable.
    expect(card).toMatch(/textOverflow:\s*"ellipsis"[\s\S]{0,200}w\.symbol \?\?/)
    expect(card).toMatch(/fontVariantNumeric:\s*"tabular-nums",\s*flexShrink:\s*0/)
  })

  it("the reel is at most two lines at the panel's floor", () => {
    const reel = num(wr, /const REEL = (\d+)/, `${WINS}: REEL`)
    // Two per line is what the arithmetic above certifies, so the number of
    // LINES the reel puts above the composer is REEL / 2. Six wrapped cards
    // were three rows of decoration between the reader and the composer.
    expect(
      Math.ceil(reel / 2),
      `${WINS}: REEL is ${reel}, i.e. ${Math.ceil(reel / 2)} rows of cards ` +
        `standing above the composer at 320px.`,
    ).toBeLessThanOrEqual(2)
    // And it is the fetch size, so the MIN_NAMES gate reads exactly the set
    // that will paint rather than a larger one it then discards.
    expect(wr).toMatch(/topWins\(REEL\)/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// UserPopover — the hover card
// ───────────────────────────────────────────────────────────────────────────

/**
 * The four stat labels at 12px/400 (Poppins-Regular), and the widest count.
 *
 * The counts print through `formatCompactNumber`, whose output set was
 * enumerated in components/post-action-row.spec.ts:385-399: 5321 distinct
 * strings, widest "444m" at 33.34px at 11px/600. At the 12px this card
 * declares that is 36.37px.
 */
const STAT_LABELS = { Posts: 31.52, Replies: 42.46, Followers: 55.33, Following: 55.9 }
const STAT_COUNT = 36.37

describe("the profile hover card fits the panel it hovers over", () => {
  const POP = "components/UserPopover.tsx"
  const up = code(POP)
  // Anchored on the width declaration itself: the first `<Box` in this file
  // is the hover ANCHOR at the top of the component, not the card.
  const cardSx = up.slice(
    up.lastIndexOf("<Box", up.indexOf('width: "min(')),
    up.indexOf("onClick={(e) => e.stopPropagation()}"),
  )

  it("declares no width the 320px panel cannot meet", () => {
    // `minWidth` beats its containing block, and this card is portalled to
    // document.body where nothing clips it — so 340px in a 320px panel was a
    // card that hung off the edge at every width below 400px.
    expect(up).not.toMatch(/minWidth:\s*"340px"/)
    expect(up).not.toMatch(/maxWidth:\s*"360px"/)
  })

  it("its width and its popper padding are the same number, twice", () => {
    const cap = num(cardSx, /width:\s*"min\((\d+)px,/, `${POP}: the card's cap`)
    const inset = num(
      cardSx,
      /calc\(100vw - (\d+)px\)/,
      `${POP}: the card's viewport inset`,
    )
    const pad = num(
      up,
      /"preventOverflow",\s*options:\s*\{\s*altAxis:\s*true,\s*padding:\s*(\d+)\s*\}/,
      `${POP}: the popper's preventOverflow padding`,
    )
    // popper.js clamps the card to `padding` from each edge; the card's own
    // width has to leave exactly that much or one of the two is decorative.
    expect(
      2 * pad,
      `${POP}: the popper keeps ${pad}px each side but the width reserves ` +
        `${inset}px in total. Make them agree.`,
    ).toBe(inset)
    expect(cap).toBeGreaterThan(0)
    // altAxis is the whole point: popper.js defaults it to false, and for a
    // `bottom-start` placement the alt axis is the horizontal one.
    expect(up).toMatch(/altAxis:\s*true/)
  })

  it("the stats row cannot fit one line, so it has to be allowed a second", () => {
    const cap = num(cardSx, /width:\s*"min\((\d+)px,/, `${POP}: the card's cap`)
    const inset = num(cardSx, /calc\(100vw - (\d+)px\)/, `${POP}: the viewport inset`)
    const pad = num(cardSx, /\bp:\s*([\d.]+),/, `${POP}: the card's inset`)
    const border = num(cardSx, /border:\s*`([\d.]+)px solid/, `${POP}: the card's border`)

    const width = Math.min(cap, PANEL - inset) // 304
    const content = width - 2 * pad * UNIT - 2 * border // 279

    // `useFlexGap` is unique to the stats row, so it anchors both slices:
    // everything from the `<Stack` that opens it, and everything after.
    const at = up.indexOf("useFlexGap")
    expect(at, `${POP}: the stats row declares no useFlexGap`).toBeGreaterThan(-1)
    const statsHead = up.slice(up.lastIndexOf("<Stack", at), at)
    const stats = up.slice(at)
    const outerGap = num(statsHead, /spacing=\{([\d.]+)\}/, `${POP}: the stats row's gap`)
    const innerGap = num(stats, /spacing=\{([\d.]+)\}/, `${POP}: a stat group's gap`)

    const labels = Object.values(STAT_LABELS).reduce((a, b) => a + b, 0) // 185.21
    const counts = Object.keys(STAT_LABELS).length * STAT_COUNT // 145.48
    const inner = Object.keys(STAT_LABELS).length * innerGap * UNIT // 16
    const between = (Object.keys(STAT_LABELS).length - 1) * outerGap * UNIT // 24
    const oneLine = labels + counts + inner + between // 370.69

    expect(
      oneLine,
      `${POP}: the four counters now fit ${content}px on one line, so the ` +
        `flexWrap valve below is no longer load-bearing — re-derive it ` +
        `rather than leaving a rule nobody can justify.`,
    ).toBeGreaterThan(content)
    // ...which makes the valve mandatory. `useFlexGap` with it, or MUI's
    // Stack spaces a wrapped row with left margins and indents line two.
    expect(statsHead + stats.slice(0, 120)).toMatch(/flexWrap="wrap"/)
  })

  it("the header row fits with the identity column at zero", () => {
    const cap = num(cardSx, /width:\s*"min\((\d+)px,/, `${POP}: the card's cap`)
    const inset = num(cardSx, /calc\(100vw - (\d+)px\)/, `${POP}: the viewport inset`)
    const pad = num(cardSx, /\bp:\s*([\d.]+),/, `${POP}: the card's inset`)
    const border = num(cardSx, /border:\s*`([\d.]+)px solid/, `${POP}: the card's border`)
    const content = Math.min(cap, PANEL - inset) - 2 * pad * UNIT - 2 * border

    const avatar = num(
      code("components/CAvatar/CAvatarRoot.tsx"),
      /large:\s*(\d+)/,
      "CAvatarRoot.tsx: the large avatar",
    )
    const follow = num(
      code("components/FollowButton.tsx"),
      /isExtended \? "auto" : "(\d+)px"/,
      "FollowButton.tsx: the collapsed button",
    )
    const headAt = up.indexOf('alignItems="flex-start"')
    const header = up.slice(up.lastIndexOf("<Stack", headAt), headAt)
    const gap = num(header, /spacing=\{([\d.]+)\}/, `${POP}: the header row's gap`)

    // The identity column is the only shrinkable thing in this row, so the
    // row's minimum is everything else. FollowButton wears flexShrink: 0 on
    // purpose (FollowButton.tsx:10-12), which is what makes this the floor.
    const floor = avatar + gap * UNIT + 0 + gap * UNIT + follow
    expect(floor).toBeLessThanOrEqual(content)
    // And the column has to actually be allowed to reach zero: without
    // minWidth: 0 its automatic minimum is its longest unbreakable word,
    // which is a display name or a handle straight off the API.
    expect(up).toMatch(/<Stack flex=\{1\} minWidth=\{0\}/)
    expect(up).toMatch(/textOverflow:\s*"ellipsis"/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// EmojiGifWrapper — the picker paper
// ───────────────────────────────────────────────────────────────────────────

/** "GIF" and "EMOJI" (the tabs are uppercased) at 10px/500, Poppins-Medium. */
const TAB_LABELS = { GIF: 15.52, EMOJI: 30.18 }

/**
 * The picker's own default width, read where the library declares it. The
 * whole defect is that emoji-picker-react writes this as an INLINE style on
 * its `<aside>`, so nothing outside components/EmojiPicker.tsx can change it
 * except an author `!important`. Guarded rather than asserted: a library
 * upgrade that moves the file should not fail an unrelated suite, but a
 * library upgrade that changes the NUMBER must be noticed here.
 */
const pickerDefaultWidth = (): number | null => {
  const p = join(
    __dirname,
    "..",
    "..",
    "node_modules",
    "emoji-picker-react",
    "dist",
    "emoji-picker-react.cjs.development.js",
  )
  if (!existsSync(p)) return null
  const m = /\n\s*width: (\d+),\n/.exec(readFileSync(p, "utf8"))
  return m ? Number(m[1]) : null
}

describe("the emoji/GIF picker fits the paper it is drawn in", () => {
  const WRAP = "components/EmojiGifWrapper.tsx"
  const eg = code(WRAP)
  const paper = eg.slice(eg.indexOf('"& .MuiPopover-paper"'), eg.indexOf("<Box"))

  it("no pane measures itself against the viewport any more", () => {
    // 80vw of a 320px panel is 256px, and the picker inside it is 350px.
    // The Popover paper is `overflowX: hidden`, so the difference was cut
    // off rather than scrolled to — 94px at the floor, 30px at Chrome's
    // 400px default, and nothing until a 437.5px panel.
    expect(eg).not.toMatch(/80vw/)
  })

  it("the paper's cap is the picker's own width plus its border", () => {
    const cap = num(paper, /width:\s*"min\((\d+)px,/, `${WRAP}: the paper's cap`)
    const inset = num(paper, /calc\(100% - (\d+)px\)/, `${WRAP}: the paper's inset`)
    const border = num(paper, /border:\s*`(\d+)px solid/, `${WRAP}: the paper's border`)

    const picker = pickerDefaultWidth()
    if (picker !== null) {
      expect(
        cap - 2 * border,
        `${WRAP}: the paper caps the picker at ${cap - 2 * border}px while ` +
          `emoji-picker-react draws ${picker}px. Below the library's width ` +
          `the picker is squeezed for no reason; above it, the paper carries ` +
          `dead space on every wide panel.`,
      ).toBe(picker)
    }

    // The inset has to be MUI's own, or the paper asks for more than the
    // Popover will position: Popover.js caps the paper at calc(100% - 32px),
    // 16px of marginThreshold each side.
    const mui = join(
      __dirname, "..", "..", "node_modules", "@mui", "material", "Popover", "Popover.js",
    )
    if (existsSync(mui)) {
      const m = /maxWidth:\s*'calc\(100% - (\d+)px\)'/.exec(readFileSync(mui, "utf8"))
      if (m) expect(inset).toBe(Number(m[1]))
    }
  })

  it("the picker is resized by the one lever that reaches it", () => {
    // A percentage width on the box does nothing: the library writes width
    // inline on its own <aside>, and an author !important is what outranks a
    // non-important inline declaration. Widening the paper alone will not.
    expect(eg).toMatch(/"& \.EmojiPickerReact":\s*\{[\s\S]{0,160}width:\s*"100% !important"/)
    // ...and the pane holding it is not a flex row: a flex item's automatic
    // minimum size is its content's min-content, which over a fixed-width
    // child floors the wrapper at the child's width whatever the parent says.
    const emojiPane = eg.slice(eg.indexOf('activeTab === "emoji" &&'))
    const paneSx = emojiPane.slice(0, emojiPane.indexOf("</Box>"))
    expect(paneSx).not.toMatch(/display:\s*"flex"/)
    expect(paneSx).toMatch(/width:\s*"100%"/)
  })

  it("the header row fits the paper at the panel's floor", () => {
    const cap = num(paper, /width:\s*"min\((\d+)px,/, `${WRAP}: the paper's cap`)
    const inset = num(paper, /calc\(100% - (\d+)px\)/, `${WRAP}: the paper's inset`)
    const border = num(paper, /border:\s*`(\d+)px solid/, `${WRAP}: the paper's border`)
    const content = Math.min(cap, PANEL - inset) - 2 * border // 286

    const header = eg.slice(eg.indexOf('justifyContent: "space-between"'))
    const headerPad = num(header, /\bp:\s*(\d+),/, `${WRAP}: the header's inset`)
    const searchGap = num(header, /flex:\s*1,\s*minWidth:\s*0,\s*mr:\s*(\d+)/, `${WRAP}: the field's gutter`)
    const tabPad = num(header, /padding:\s*"\d+px (\d+)px"/, `${WRAP}: a tab's inset`)

    const tabs = Object.values(TAB_LABELS).reduce((t, w) => t + w + 2 * tabPad, 0) // 93.70
    const fixed = 2 * headerPad * UNIT + searchGap * UNIT + tabs
    expect(
      fixed,
      `${WRAP}: the tabs and the gutters need ${fixed.toFixed(2)}px of ` +
        `${content}px, leaving ${(content - fixed).toFixed(2)}px for the ` +
        `search field.`,
    ).toBeLessThanOrEqual(content)
    // The field is the only shrinkable thing in the row, so it has to be
    // allowed to shrink; a MUI TextField holds its content width otherwise.
    expect(header).toMatch(/flex:\s*1,\s*minWidth:\s*0/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// GifSearch — the tile grid
// ───────────────────────────────────────────────────────────────────────────

describe("the GIF grid follows its box, not the browser window", () => {
  const GIF = "components/GifSearch.tsx"
  const gs = code(GIF)
  const WRAP = "components/EmojiGifWrapper.tsx"
  const eg = code(WRAP)
  const paper = eg.slice(eg.indexOf('"& .MuiPopover-paper"'), eg.indexOf("<Box"))

  it("no MUI breakpoint decides how many tiles a fixed-width box holds", () => {
    // The grid lives inside a Popover paper capped at the picker's width, so
    // the box does NOT grow when the window crosses 600px — only the column
    // count did, and the same grid drew two tiles or three depending on how
    // wide the browser happened to be.
    expect(gs).not.toMatch(/xs:\s*"repeat\(/)
    // `containerType: "grid"` is not a value in the keyword set (normal |
    // size | inline-size), so that declaration was dropped by the parser;
    // the `inline-size` one was inert because nothing here writes a
    // container query. Both are gone rather than half-fixed.
    expect(gs).not.toMatch(/containerType/)
  })

  it("both grids ask for the same tile floor", () => {
    const cols = [...gs.matchAll(/repeat\(auto-fill, minmax\((\d+)px, 1fr\)\)/g)]
    expect(cols.length, `${GIF}: expected the results grid and the categories grid`)
      .toBe(2)
    expect(cols[0][1]).toBe(cols[1][1])
  })

  it("two tiles at the panel's floor and three at the paper's width", () => {
    const floor = num(
      gs,
      /repeat\(auto-fill, minmax\((\d+)px, 1fr\)\)/,
      `${GIF}: the tile floor`,
    )
    const gap = num(gs, /gap:\s*([\d.]+),/, `${GIF}: the grid's gap`) * UNIT
    const scrollPad = num(
      gs.slice(gs.indexOf('id="gifScrollableDiv"')),
      /\bp:\s*(\d+),/,
      `${GIF}: the scroller's inset`,
    ) * UNIT

    // The two widths the paper resolves to, read from the paper itself.
    const cap = num(paper, /width:\s*"min\((\d+)px,/, `${WRAP}: the paper's cap`)
    const inset = num(paper, /calc\(100% - (\d+)px\)/, `${WRAP}: the paper's inset`)
    const border = num(paper, /border:\s*`(\d+)px solid/, `${WRAP}: the paper's border`)

    // The grid is not the scroller: GifSearch.tsx:99 declares `overflow:
    // "auto"` on the box this grid sits in, so the bar comes off the grid's
    // width before a single track is laid out. See SCROLLBAR above.
    expect(gs.slice(gs.indexOf('id="gifScrollableDiv"'))).toMatch(
      /overflow:\s*"auto"/,
    )
    const grid = (panel: number, bar = SCROLLBAR) =>
      Math.min(cap, panel - inset) - 2 * border - 2 * scrollPad - bar
    // auto-fill lays out floor(( W + gap ) / ( floor + gap )) tracks.
    const tiles = (w: number) => Math.floor((w + gap) / (floor + gap))

    expect(grid(PANEL), `${GIF}: the grid at a 320px panel`).toBe(268)
    expect(tiles(grid(PANEL))).toBe(2)
    // Once the panel is wide enough for the paper's cap the grid stops
    // growing, so this is the widest the grid ever gets.
    expect(grid(cap + inset)).toBe(332)
    expect(tiles(grid(cap + inset))).toBe(3)

    // ...and the tile counts are what the layout is FOR, so they have to
    // survive the open question about which scrollbar rule Chrome applies.
    expect(tiles(grid(PANEL, FAT_SCROLLBAR))).toBe(2)
    expect(tiles(grid(cap + inset, FAT_SCROLLBAR))).toBe(3)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Watchlist — the row
// ───────────────────────────────────────────────────────────────────────────

/** "Remove" at 12px/600, from public/fonts/Poppins-SemiBold.ttf's hmtx. */
const REMOVE_W = 49.92

/**
 * Per-character advances at 12px, Poppins-Bold — the change chip's type step.
 * Same source and same no-kerning assumption as ADVANCE_14_BOLD above.
 */
const ADVANCE_12_BOLD: Record<string, number> = {
  "+": 7.536,
  "-": 6.96,
  ".": 3.384,
  "%": 10.44,
  "0": 7.824,
  "1": 4.512,
  "2": 6.852,
  "3": 7.26,
  "4": 8.124,
  "5": 7.8,
  "6": 7.644,
  "7": 6.42,
  "8": 7.776,
  "9": 7.38,
}
const advance12 = (s: string) =>
  [...s].reduce((t, c) => t + (ADVANCE_12_BOLD[c] ?? NaN), 0)

/**
 * Watchlist.tsx's `pct`, mirrored and pinned against the source below.
 *
 * THE WIDEST CHIP IS NOT THE BIGGEST NUMBER, and this constant used to say it
 * was: it carried 58.26, the width of "+9999.9%". In Poppins-Bold "4" is the
 * widest digit (8.124px at 12px, against 7.38 for "9"), so the real
 * four-integer-digit maximum is "+4444.4%" at 61.98px — 3.72px more chip than
 * the row was budgeting for. Enumerated rather than hand-picked, for the same
 * reason MONEY_MAX is.
 */
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
/** Every chip from -9999.9% to +9999.9%, in the tenths `toFixed(1)` prints. */
const PCT_STRINGS = (() => {
  const out: string[] = []
  for (let tenths = -99_999; tenths <= 99_999; tenths++) out.push(pct(tenths / 10))
  return out
})()
const PCT_MAX = PCT_STRINGS.reduce((m, s) => Math.max(m, advance12(s)), 0)
/** One digit past the certified bound, for the "it is a bound, not a cap" test. */
const PCT_FIVE_DIGIT = advance12("+44444.4%")

describe("the watchlist row fits and its text stays inside it", () => {
  const WATCH = "components/Watchlist.tsx"
  const wl = code(WATCH)
  const outer = wl.slice(wl.indexOf("return ("), wl.indexOf("rows.map"))
  const row = wl.slice(wl.indexOf("rows.map"))

  it("the enumeration above is this component's own pct(), verbatim", () => {
    const decl = wl.slice(wl.indexOf("const pct ="), wl.indexOf("export function")).trim()
    expect(decl.replace(/\s+/g, " ")).toBe(
      'const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`',
    )
    // ...and the button beside it still says the word REMOVE_W measures.
    expect(row).toMatch(/>\s*Remove\s*</)
  })

  it("the widest chip is the widest DIGITS, not the biggest number", () => {
    expect(PCT_STRINGS.every((s) => Number.isFinite(advance12(s)))).toBe(true)
    const widest = PCT_STRINGS.reduce((a, b) => (advance12(b) > advance12(a) ? b : a))
    expect(widest).toBe("+4444.4%")
    expect(PCT_MAX).toBeCloseTo(61.98, 2)
    expect(advance12("+9999.9%")).toBeCloseTo(58.26, 2)
  })

  it("the name column gets what is left, and it is a real amount", () => {
    const gutter = num(outer, /px:\s*([\d.]+)/, `${WATCH}: the outer gutter`)
    const padX = num(row, /px:\s*([\d.]+)/, `${WATCH}: the row's inset`)
    const border = num(row, /border:\s*`(\d+)px solid/, `${WATCH}: the row's border`)
    const gap = num(row, /gap:\s*([\d.]+)/, `${WATCH}: the row's gap`) * UNIT

    // views/profile.tsx:205 is `overflowY: "auto"` on this list's ancestor
    // and Watchlist is mounted inside it at :249, so the row never sees the
    // whole 320px. Same reserve, same reasoning as ProfileFeed.tsx:76-77.
    const profile = code("views/profile.tsx")
    expect(profile.slice(0, profile.indexOf("<Watchlist />"))).toMatch(
      /overflowY:\s*"auto"/,
    )
    const width = (bar: number) =>
      PANEL - bar - 2 * gutter * UNIT - 2 * padX * UNIT - 2 * border
    const content = width(SCROLLBAR) // 260
    const right = gap + PCT_MAX + gap + REMOVE_W // 131.90
    const name = content - right

    expect(
      name,
      `${WATCH}: the change chip and "Remove" now take ${right.toFixed(2)}px ` +
        `of ${content}px, leaving ${name.toFixed(2)}px for the symbol and ` +
        `its price. "Price unavailable" alone is 94.55px at 11px/400.`,
    ).toBeGreaterThan(94.55)
    // The conclusion, not just the arithmetic, has to survive a fat bar...
    expect(width(FAT_SCROLLBAR) - right).toBeGreaterThan(94.55)
    // ...and a fifth integer digit, since nothing in the code caps the
    // percentage. Four digits is what is CERTIFIED; five still fits.
    const five = gap + PCT_FIVE_DIGIT + gap + REMOVE_W
    expect(width(SCROLLBAR) - five).toBeGreaterThan(94.55)
  })

  it("the two right-hand controls do not shrink, and the name does", () => {
    // Both are single unbreakable strings; letting them shrink would clip
    // them with no ellipsis rather than ellipsizing the name, which is the
    // one thing on this row that has somewhere to go.
    expect(row.match(/flexShrink:\s*0/g)?.length).toBe(2)
    expect(row).toMatch(/flex:\s*1,\s*\n\s*minWidth:\s*0,/)
  })

  it("both lines of the name column ellipsize", () => {
    // A symbol arrives off the API with no length bound, and "Price
    // unavailable" contains a space — so without these the first line ran
    // under the change chip and the second wrapped, making one row taller
    // than its neighbours.
    // Bounded at the change chip: "Remove" past it is nowrap too, for a
    // different reason (it must not shrink), and counting it here would let
    // one ellipsis go missing without the count changing.
    const col = row.slice(
      row.indexOf('textAlign: "left"'),
      row.indexOf("w.change24hPct"),
    )
    expect(col.match(/textOverflow:\s*"ellipsis"/g)?.length).toBe(2)
    expect(col.match(/whiteSpace:\s*"nowrap"/g)?.length).toBe(2)
  })
})
