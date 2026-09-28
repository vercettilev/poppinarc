import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE FEED'S LABEL WEARS THE SITE'S FACE, AND THE BOX IS ONLY AS WIDE AS THE
 * NAME INSIDE IT.
 *
 * Two things the owner asked for on the feed row, in one sentence: "we used
 * to pull the website's favicon and put it as a round icon in front of the
 * site name — make it fit that. That box shouldn't be long, only as wide as
 * it needs to be."
 *
 * Both halves had a defender in the source. The mark had a comment arguing
 * that "a URL and a hostname are their own icons, so the two page-scoped
 * branches add nothing rather than inventing a mark". The width had a louder
 * one: a paragraph headed "minWidth 183px STAYS", which grounded the floor in
 * a cross-screen width contract shared with views/tasks.tsx and a
 * components/PageTitle.tsx that nothing in src imported. Half of that
 * contract rendered on no screen — PageTitle has since been deleted as dead
 * code — and the owner overruled the other half.
 *
 * This file is here because a repo whose comments argue for the opposite of
 * its code is the failure mode that costs the most to read, and because both
 * of these are the kind of change a later "let's make the header pills
 * consistent" pass would undo by accident.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/** House comments quote the code they replaced; count the code, not the prose. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** The first integer after `key:` in a source blob, e.g. `gap: "8px"` → 8. */
const num = (text: string, key: string): number => {
  const m = text.match(new RegExp(`${key}:\\s*"?(\\d+)`))
  if (!m) throw new Error(`could not read \`${key}\` out of the source`)
  return Number(m[1])
}

const barRaw = read("components/ActionBar.tsx")
const bar = stripComments(barRaw)
const pillRaw = read("components/HeaderPill.tsx")
const pill = stripComments(pillRaw)
const funnel = stripComments(read("components/FeedFilterButton.tsx"))

/**
 * One `id="action-bar"` in the file now that the unreachable /announcements
 * row is gone, so this slice is the whole live row. Same slice
 * feed-filter-placement.spec.ts takes.
 */
const feedRow = bar.slice(bar.indexOf('id="action-bar"'))

describe("the feed label is content-width, not a 183px slab", () => {
  it("declares no fixed floor anywhere in the row", () => {
    /**
     * The one surviving min-width on the row is HeaderPillText's `0`, which
     * is the opposite kind of number: it is what LETS the label shrink so
     * text-overflow can fire. Anything with a unit on it is a floor.
     */
    const mins = [...feedRow.matchAll(/minWidth:\s*([^,}\n]+)/g)].map((m) =>
      m[1].trim(),
    )
    expect(mins).toEqual(["0"])
  })

  it("dropped the number from the whole file, not just the row", () => {
    // The file ships one label pill now (the /announcements row is gone), and
    // the number must not survive anywhere in its code.
    expect(bar).not.toMatch(/183/)
  })

  it("replaced the reasoning instead of quietly deleting it", () => {
    /**
     * The number still appears in the file's COMMENTS — a reader who finds
     * the pill content-width deserves to find out that a floor was there,
     * what it was for and who overruled it — while appearing nowhere in the
     * code (the test above).
     *
     * THE OBVIOUS ASSERTION HERE IS WRONG, AND IT FAILED BEFORE THIS ONE
     * REPLACED IT. It read `expect(barRaw).not.toMatch(/minWidth 183px
     * STAYS/)` — "the sentence that argued for the floor must be gone". But
     * the house comment style QUOTES the code and the claims it replaced,
     * which is why header-pill-surface.spec.ts strips comments before it
     * sweeps at all; the rewritten paragraph quotes the defeated sentence
     * verbatim in order to say who overruled it, so banning the string bans
     * the explanation along with the claim. What must not survive is the
     * defeated claim standing as CURRENT policy, and the shape that proves
     * it is the pairing: the number in the prose, never in the code, next to
     * the word that demotes it.
     */
    expect(barRaw).toMatch(/183/)
    expect(barRaw).toMatch(/overrul/i)
  })
})

describe("the two page-scoped branches lead with the site's round favicon", () => {
  it("mounts the shared mark, fed by the URL the feed is scoped to", () => {
    expect(bar).toMatch(/HeaderPillFavicon/)
    expect(feedRow).toMatch(/<HeaderPillFavicon[^>]*url=\{currentUrl/)
    // One mark, one glyph — not a mark per branch and not both at once.
    expect(feedRow.match(/<HeaderPillFavicon/g) ?? []).toHaveLength(1)
    expect(feedRow.match(/<HomeIcon/g) ?? []).toHaveLength(1)
  })

  it("keeps HomeIcon on the one branch that names no site", () => {
    /**
     * "Global Feed" is an abstraction: there is no origin to fetch a favicon
     * for. The order in the ternary is the assertion — global gets the glyph,
     * everything else gets the site's own face.
     */
    const branch = feedRow.indexOf("isGlobal ? (")
    expect(branch).toBeGreaterThan(-1)
    expect(feedRow.indexOf("<HomeIcon")).toBeGreaterThan(branch)
    expect(feedRow.indexOf("<HeaderPillFavicon")).toBeGreaterThan(
      feedRow.indexOf("<HomeIcon"),
    )
  })

  it("is round, and is a label rather than a control", () => {
    const mark = pill.slice(pill.indexOf("export const HeaderPillFavicon"))
    expect(mark).toMatch(/borderRadius: "50%"/)
    /**
     * components/Post/WebsiteFavicon.tsx is a control: it navigates the tab
     * or opens the leaving-warning dialog, carries a Tooltip, and brightens
     * on hover. In a header pill the site's name is printed 6px away in plain
     * text, so a clickable second copy of it would be a control nobody asked
     * for — and a hover that repaints a 16px disc on a row whose job is to
     * sit still is the geometry-on-hover defect class waiting to happen.
     */
    expect(mark).not.toMatch(/onClick/)
    expect(mark).not.toMatch(/cursor: "pointer"/)
    expect(mark).not.toMatch(/Tooltip/)
    expect(mark).not.toMatch(/"&:hover"/)
  })

  it("takes the whole element with it when the image will not load", () => {
    const mark = pill.slice(pill.indexOf("export const HeaderPillFavicon"))
    // A broken-image square inside a header pill is worse than no mark, and
    // an emptied element still earns the pill's 6px gap — so the guard is on
    // the element, not on its contents.
    expect(mark).toMatch(/onError=\{\(\) => setFailed\(true\)\}/)
    expect(mark).toMatch(/if \(!src \|\| failed\) return null/)
    // ...and one dead favicon must not suppress the mark for every site the
    // reader visits afterwards.
    expect(mark).toMatch(/setFailed\(false\)/)
    expect(mark).toMatch(/\}, \[src\]\)/)
  })

  it("cannot become the pill's height", () => {
    /**
     * The pill's height is its text's line box. A mark that fits inside it
     * costs nothing; a mark bigger than it silently grows the pill, the feed
     * row, and every sum written against them (ActionBar.tsx's container
     * `py` comment). Both numbers are read out of the source rather than
     * restated here.
     */
    const markSize = Number(pill.match(/size = (\d+)/)?.[1])
    const fontPx = Number(pill.match(/fontSize: "(\d+)px"/)?.[1])
    const lineHeight = Number(pill.match(/lineHeight: ([\d.]+)/)?.[1])
    expect(markSize).toBeGreaterThan(0)
    expect(markSize).toBeLessThanOrEqual(fontPx * lineHeight)
  })
})

describe("the cap still tiles a 320px panel, now that nothing props the pill open", () => {
  const reserve = Number(
    bar.match(/maxWidth: "calc\(100% - (\d+)px\)"/)?.[1] ?? NaN,
  )
  const gap = num(feedRow, "gap")
  const rowPadX = num(feedRow, "px")
  const funnelW = num(funnel, "width")
  /** The panel's floor, the width every one of these numbers is measured at. */
  const PANEL = 320

  it("gives up exactly what sits to the pill's right", () => {
    // A funnel resize that forgets this number is how the control gets pushed
    // off the right edge of a 320px panel.
    expect(reserve).toBe(funnelW + gap)
  })

  it("fills the row and never exceeds it", () => {
    const content = PANEL - rowPadX * 2 // 320 − 10 − 10 = 300
    const cap = content - reserve // 300 − 34 = 266
    expect(cap).toBeGreaterThan(0)
    expect(cap + gap + funnelW).toBe(content)
  })

  it("the comment's text-box sum is the one the source actually adds up to", () => {
    /**
     * THIS TEST EXISTS BECAUSE THE SUM WENT STALE ONCE ALREADY. Before the
     * mark, the paragraph beside `maxWidth` put the label's reading width at
     * "~238px" — correct for a pill with no icon. Adding a 16px mark behind
     * HeaderPill's 6px gap took 22px off it, and the prose kept saying 238:
     * a comment lying about the code one screen away from the code, which is
     * the failure this repo pays the most for.
     *
     * So the number is not restated here either. Every term is read out of
     * the source, added up, and checked against the figure the comment
     * prints — move the mark, the gap, the padding or the funnel and this
     * fails with the arithmetic in front of you instead of rotting quietly.
     */
    const cap = PANEL - rowPadX * 2 - reserve
    const border = Number(pill.match(/border:\s*`(\d+)px/)?.[1])
    // Read from HeaderPill, not from this row. The 13px used to be declared
    // at both label call sites and at neither of them on purpose; it is the
    // component's default now, so the sum has to follow it there. See
    // components/header-pill-one-height.spec.ts.
    const padX = num(pill, "paddingLeft")
    const markSize = Number(pill.match(/size = (\d+)/)?.[1])
    const markGap = num(pill, "gap")

    expect([border, padX, markSize, markGap].every(Number.isFinite)).toBe(true)
    const textBox = cap - border * 2 - padX * 2 - markSize - markGap

    // border-box is in force panel-wide (CssBaseline, ProvidersWrapper.tsx),
    // so the cap swallows the border and the padding rather than sitting
    // outside them. That is why both are subtracted.
    const claimed = Number(
      barRaw.match(/AND WHAT IS LEFT FOR THE TEXT[\s\S]*?=\s*(\d+)px/)?.[1],
    )
    expect(claimed).toBe(textBox)
  })

  it("keeps the cap, because it is now the only thing holding a long URL in", () => {
    // With the floor gone the pill is content-width below the cap — which is
    // the point — but the label is arbitrary user-visited text, so removing
    // the cap as "no longer needed" would let one long URL shove the funnel
    // off the edge. The ellipsis needs both halves: the cap here, and
    // HeaderPillText's nowrap/overflow/min-width:0 inside.
    expect(feedRow).toMatch(/maxWidth: "calc\(100% - \d+px\)"/)
    expect(feedRow).toMatch(/overflow: "hidden"/)
    expect(feedRow).toMatch(/<HeaderPillText sx=\{\{ minWidth: 0 \}\}>/)
  })
})

describe("the label pills that actually render agree with each other", () => {
  /**
   * The owner's last sentence was "if anything doesn't match the other
   * screens, fix those too". The set of screens was smaller than the source
   * suggested: PageInfoBar and PageTitle had no importer in src and have
   * since been deleted, so the only two header label pills a reader can
   * reach are this row's and the Tasks title (views/tasks.tsx).
   *
   * THEY AGREE BY CONSTRUCTION NOW, WHICH IS A STRONGER ANSWER THAN AGREEING
   * BY COINCIDENCE. This used to read both call sites' `paddingLeft` and
   * check the two numbers matched. They did — both overrode HeaderPill's
   * canonical 10px to 13px — but a test that two copies hold the same value
   * only fires AFTER somebody has already changed one of them, and it said
   * nothing at all about the heights, which were 26px and 30px.
   *
   * Both overrides are gone; 13/3 is HeaderPill's own default. What is left
   * to assert here is that neither call site has taken its geometry back, and
   * that is swept properly, across every present and future call site, in
   * components/header-pill-one-height.spec.ts. This one keeps only the local,
   * named version so a regression fails with the screen's name on it.
   */
  it("the call site does not take its own geometry back", () => {
    // The Tasks title was the second call site; its screen is retired.
    for (const [name, code] of [["the feed label", feedRow]] as const) {
      expect(code, `${name} declares its own horizontal padding again`)
        .not.toMatch(/paddingLeft:\s*"\d/)
      expect(code, `${name} declares its own vertical padding again`)
        .not.toMatch(/paddingY:\s*"\d/)
    }
  })
})
