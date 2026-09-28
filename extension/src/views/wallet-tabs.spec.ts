import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { popCopy } from "~/helpers/popLanguage"

/**
 * THE WALLET'S TAB RAIL HAS TO FIT, AND IT MUST NOT PRETEND TO.
 *
 * Reported as "the Your pops button looks broken". It was not a button bug.
 * The four Solana pills want ~370.6px of row — ~204.6px of label in PoppinSans
 * Bold 12.5px at normal tracking (see LETTER_SPACING_EM below: this theme's
 * custom fontFamily is why MUI emits no button letter-spacing), plus 4x34px
 * of padding-and-border, plus 3x10px of gap — and a 320px side panel gives
 * the rail ~298px once the theme's 2px hairline scrollbar and the column's
 * 10px gutters are paid.
 *
 * With no wrap and no overflow, flexbox settled that ~72.6px deficit by
 * shrinking every pill below its own label. "Your pops" is the only two-word
 * label, so it was the only one that could break: two 12.5px lines is 43.75px
 * of text inside a pill pinned at 32px, and it spilled out of the top and
 * bottom. The one-word labels cannot break, so they bled sideways through
 * their own borders instead.
 *
 * There are four tempting fixes and three of them are wrong:
 *   shrink the type   — 12.5px is the floor the design set
 *   shorten the label — wallet-ui carries a written decision AGAINST
 *                       "Trades"; the name is the feature
 *   scroll the rail   — see below; this is the one the house already ruled on
 * The fourth is the one that works: the rail WRAPS. Line one takes the three
 * pills that fit and Activity drops whole onto line two.
 *
 * WHY NOT SCROLL. An earlier pass made this rail overflowX:"auto" with the
 * scrollbar styled invisible and flexShrink:0 on every pill, and pinned that
 * shape here as law. It did not make the row fit; it made the shortfall
 * invisible — at 320px the right edge cut through the Activity pill, with no
 * visible scrollbar to say the rest had slid. Recomputed on the widths this
 * file measures below: unwrapped, Activity's left edge sits at 286.55px (line
 * one's 276.55 plus one 10px gap), leaving 11.45px of an 84px pill inside the
 * 298px box — and when Activity was the ACTIVE tab, the accent fill that
 * marks it was cut down to that sliver. components/profile/ProfileFeed.tsx had
 * already been through exactly this, for a sibling pill row at the same 320px,
 * and its ruling is written into the file: "THE ROW FITS; IT DOES NOT SLIDE...
 * flexWrap is the valve below 320px: a second line is honest, a hidden
 * scrollbar is not." profile-filter-fit.spec.ts enforces it there. This spec
 * enforces the same law here, and it asserts the OUTCOME (the row fits,
 * measured from the shipped face) rather than the mechanism, so a future
 * fixer who buys the fit some other legitimate way — trimming gap or padding
 * the way ProfileFeed did — is not forced to delete a test to land a correct
 * change.
 *
 * The three assertions this file used to make that are now GONE, and why they
 * were wrong rather than merely inconvenient:
 *   overflowX:"auto" required   — required the defect. A hidden scrollbar is
 *                                 not a fit; it is a clip nobody can see.
 *   flexShrink:0 on every pill  — the fingerprint of that scrolling rail.
 *   paddingX === 16 on all four — the right instinct ("do not buy the fit by
 *                                 restyling the pill") pinned to the wrong
 *                                 thing. The arithmetic below reads paddingX
 *                                 out of the source, so a padding change is
 *                                 measured, not forbidden.
 */

const SRC = readFileSync(join(__dirname, "wallet-ui.tsx"), "utf8")

/**
 * The rail's source: the <Box> that follows its marker comment, up to the
 * first tab panel. Sliced rather than grepped whole-file so a pill somewhere
 * else in this 1500-line screen cannot accidentally satisfy the assertions,
 * and started AFTER the marker comment rather than at it — that comment
 * quotes the shapes this spec forbids, and a half-open comment would survive
 * the stripper below and match them.
 */
function railSource(): string {
  const marker = SRC.indexOf("THE TAB RAIL")
  expect(marker).toBeGreaterThan(0)
  const start = SRC.indexOf("<Box", marker)
  const end = SRC.indexOf('{activeTab === "orders" &&', start)
  expect(start).toBeGreaterThan(marker)
  expect(end).toBeGreaterThan(start)
  return SRC.slice(start, end)
}

/**
 * Comments state intent; only the code may be asserted on. The per-pill
 * comments name flexShrink:0 to explain its absence, so they have to go
 * before anything is matched.
 */
function railCode(): string {
  return railSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

/** The rail container's sx, i.e. everything before the first pill. */
function railContainer(): string {
  const code = railCode()
  return code.slice(0, code.indexOf("<Button"))
}

/** The four pills, in source order: Tokens, Orders, Your pops, Activity. */
function railPills(): string[] {
  return railCode().split("<Button").slice(1)
}

describe("the wallet tab rail survives a 320px panel", () => {
  it("does not slide, and does not hide the scrollbar that says it slid", () => {
    // The sibling ruling, applied here: a row that cannot fit takes a second
    // line. It never scrolls behind an invisible bar, because the reader has
    // no way to learn that a tab exists off the right edge.
    const code = railCode()
    expect(code).not.toMatch(/overflowX:\s*"auto"/)
    expect(code).not.toMatch(/webkit-scrollbar/)
    expect(code).not.toMatch(/scrollbarWidth:\s*"none"/)
  })

  it("keeps a second line as the valve", () => {
    expect(railContainer()).toMatch(/flexWrap:\s*"wrap"/)
    // flexShrink:0 is the scrolling rail's fingerprint. With wrap in place a
    // line is only ever formed from pills that already fit it, so pinning the
    // shrink factor buys nothing — it only re-states the decision this row
    // reversed. What actually guarantees no pill is squeezed is the fit test
    // below, which proves no single pill is wider than the panel's box.
    for (const pill of railPills()) expect(pill).not.toMatch(/flexShrink:\s*0/)
  })

  it("gives every pill its own label's width and a single line", () => {
    const pills = railPills()
    // Tokens + Orders + Your pops + Activity.
    expect(pills.length).toBe(4)
    for (const pill of pills) {
      // minWidth:0 defeats MUI's own minWidth:64, so a short pill is sized by
      // its label rather than by a framework default.
      expect(pill).toMatch(/minWidth:\s*0/)
      // MUI's Button sets no white-space of its own, so a two-word label will
      // wrap INSIDE its 32px pill unless it is told not to. This is the line
      // that stops the reported spill; the rail wraps, the label does not.
      expect(pill).toMatch(/whiteSpace:\s*"nowrap"/)
    }
  })

  it("never buys the fit by shrinking the type", () => {
    const sizes = railPills().map((p) =>
      Number(/fontSize:\s*"([\d.]+)px"/.exec(p)?.[1]),
    )
    expect(sizes.length).toBe(4)
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12.5)
  })

  it("never buys the fit by shortening the name", () => {
    // The label is owned by popLanguage, and wallet-ui reads it from there
    // rather than typing it, so the two cannot drift apart.
    expect(popCopy.historyTitle).toBe("Your pops")
    expect(railCode()).toContain("{popCopy.historyTitle}")
    // And the reasoning for that name has to stay next to it: it is the
    // decision that forbids "Trades" as an easy way out of this bug.
    expect(SRC).toMatch(/"Your pops" and not "Trades"/)
  })
})

/**
 * Advance widths of the four labels, in ems, read from the shipped
 * public/fonts/Poppins-Bold.ttf (hmtx / unitsPerEm 1000) — the face that
 * weight 700 of PoppinSans resolves to, per helpers/brandFont.ts — the
 * loader this panel runs at entries/side_panel/main.tsx. themeHelper only
 * names the family; brandFont is what binds each weight to a file. The same
 * reader reproduces profile-filter-fit.spec.ts's published table exactly
 * (All 15.92, Posts 33.40, Trades 42.61, Replies 44.53, Likes 30.77 at 12px),
 * which is how these were checked. Re-derive with any TTF metrics reader if
 * the face is ever replaced. `marker` is how each row is proved to belong to
 * the pill it is measuring, and `chars` is what letter-spacing WOULD multiply
 * if this theme had any — see LETTER_SPACING_EM. At 12.5px and the normal
 * tracking this theme actually renders, the four labels are 46.175 / 43.6875
 * / 64.6875 / 50.025, i.e. 204.575px of text.
 */
const LABELS = [
  { marker: '"tokens"', em: 3.694, chars: 6 },
  { marker: '"orders"', em: 3.495, chars: 6 },
  { marker: '"trades"', em: 5.175, chars: 9 },
  { marker: '"activity"', em: 4.002, chars: 8 },
]
/**
 * ZERO, and not MUI's 0.02857em, because this theme never receives that
 * letter-spacing in the first place.
 *
 * createTypography builds every variant through `buildVariant`, which emits
 * the `letterSpacing` key only inside `...(fontFamily === defaultFontFamily
 * ? {...} : {})` — defaultFontFamily being '"Roboto", "Helvetica", "Arial",
 * sans-serif' (@mui/material/styles/createTypography.js, v6.5.0 as installed).
 * helpers/themeHelper.ts sets `fontFamily: "PoppinSans"`, so `typography.button`
 * comes back as {fontFamily, fontWeight, fontSize, lineHeight, ...allVariants}
 * with no letterSpacing key, and MUI's Button spreads exactly that object
 * (@mui/material/Button/Button.js: `...theme.typography.button`). Nothing
 * downstream re-adds it, so the pills render at the face's own advance widths.
 *
 * An earlier revision of this file added 0.02857em here and justified it with
 * "themeHelper sets ... no `button` variant" — true and irrelevant: it is
 * `fontFamily`, not a `button` override, that deletes the key. At 12.5px that
 * tracking adds 0.357px per character: about 5% on the four labels (4.6 / 4.9
 * / 5.0 / 5.7 percent, in table order) but +2.8% on the row, because the 34px
 * of chrome per pill and the 30px of gaps take no tracking — the row read
 * 380.9px instead of 370.6px. The term is additive in railLayout's width
 * formula below, so it moved the figures up rather than down, but it was
 * still a false statement about the theme.
 *
 * If a future theme ever restores the Roboto default family, this becomes
 * 0.02857 and every pill grows by fontSize x 0.02857 per character.
 */
const LETTER_SPACING_EM = 0
/** 1px of border either side of the pill. */
const BORDER = 2
/** The Chrome side panel's narrowest width, which is the width this is about. */
const PANEL = 320
/** The theme's hairline scrollbar on the wallet's scrolling column. */
const SCROLLBAR = 2

/**
 * Lay the pills out the way flex does: pack each line with whatever fits at
 * its hypothetical main size, break when the next one does not.
 */
function railLayout() {
  const container = railContainer()
  const pills = railPills()
  expect(pills.length).toBe(LABELS.length)

  const gap = Number(/gap:\s*"([\d.]+)px"/.exec(container)?.[1])
  // The rail is full-width inside the balance column, whose paddingX is the
  // only horizontal gutter between it and the panel edge. Read from source so
  // this cannot go stale: the column is the one carrying marginTop:"14px".
  const column = SRC.slice(SRC.indexOf('marginTop: "14px"'))
  const gutter = Number(/paddingX:\s*"([\d.]+)px"/.exec(column)?.[1])
  expect([gap, gutter].every(Number.isFinite)).toBe(true)

  const widths = pills.map((pill, i) => {
    const { marker, em, chars } = LABELS[i]
    // The table is paired with the pills by position, so prove the position.
    expect(pill).toContain(marker)
    const fontSize = Number(/fontSize:\s*"([\d.]+)px"/.exec(pill)?.[1])
    const padX = Number(/paddingX:\s*"([\d.]+)px"/.exec(pill)?.[1])
    expect([fontSize, padX].every(Number.isFinite)).toBe(true)
    return (em + chars * LETTER_SPACING_EM) * fontSize + padX * 2 + BORDER
  })

  const budget = PANEL - SCROLLBAR - gutter * 2
  const lines: number[] = []
  for (const w of widths) {
    const last = lines.length - 1
    if (last < 0 || lines[last] + gap + w > budget) lines.push(w)
    else lines[last] += gap + w
  }
  return { budget, lines, widths }
}

describe("the wallet tab rail fits", () => {
  it("measures at the tracking this theme actually renders", () => {
    // The basis, checked rather than asserted in prose. Two revisions of this
    // file have now claimed a letter-spacing the theme does not have, so the
    // premise gets a test: MUI hangs typography.button's letterSpacing on
    // `fontFamily === defaultFontFamily`, and this theme's family is its own.
    // If somebody ever restores the Roboto stack, this fails and LETTER_SPACING_EM
    // has to be re-derived along with every figure above it.
    const THEME = readFileSync(
      join(__dirname, "..", "helpers", "themeHelper.ts"),
      "utf8",
    )
    expect(THEME).toMatch(/fontFamily:\s*"PoppinSans"/)
    expect(THEME).not.toContain('"Roboto", "Helvetica", "Arial", sans-serif')
    expect(LETTER_SPACING_EM).toBe(0)
  })

  it("puts no line of pills past the panel's narrowest width", () => {
    // THE invariant. Every line the rail wraps into has to fit the box, which
    // is also what proves no single pill is wider than the box — an oversized
    // pill lands on a line of its own and blows this assertion.
    const { budget, lines } = railLayout()
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toBeLessThanOrEqual(budget)
  })

  it("stays a rail, not a stack", () => {
    // As shipped: line one is Tokens + Orders + "Your pops" at 276.55px
    // inside a 298px box (80.175 + 10 + 77.6875 + 10 + 98.6875), and Activity
    // takes line two at 84.025px. Two lines is the honest valve; three would
    // mean the rail has stopped being a rail and is pushing the panel's
    // content down, which is a decision for a human and not something that
    // should arrive as a silent side effect of a rename.
    const { lines } = railLayout()
    expect(lines.length).toBeLessThanOrEqual(2)
  })
})
