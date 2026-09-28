import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CHIP = join(__dirname, "xStrip.ts")
const raw = readFileSync(CHIP, "utf8")
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * SIX SCREENSHOTS OF ONE CHIP, READ SIDE BY SIDE (2026-09-20). Each of
 * these is a thing the chip said that it should not have said. They are
 * pinned here rather than in the big xStrip spec because they share a
 * cause: a surface built in six states drifts state by state, and the
 * drift is only visible when the states are laid out together.
 */
describe("the chip states one fact one way", () => {
  it("spells market cap out, in the sheet as well as under the chart", () => {
    expect(code).toMatch(/`Market cap \$\{compactUsd\(m\.mcap\)\}`/)
    // "$63.7B MC" in the sheet and "Market cap $63.7B" under the chart
    // were two names for one number, two taps apart.
    expect(code).not.toMatch(/\$\{compactUsd\(m\.mcap\)\} MC/)
    // And the third spelling, inside the fill row's sentence.
    expect(code).toMatch(/at \$\{compactUsd\(m\.mcap\)\} market cap/)
    expect(code).not.toMatch(/\bMC`/)
  })

  it("does not hedge a hedge on price impact", () => {
    // "~<0.01% price impact" read as "approximately less than".
    expect(code).toMatch(/"<0\.01% price impact"/)
    expect(code).not.toMatch(/~\$\{pct < 0\.01/)
  })
})

/**
 * THE QUOTE ENDPOINT ONLY KNOWS ONE DIRECTION — it takes the mint as the
 * OUTPUT, so its answer is always the impact of BUYING. The sell sheet
 * printed that under a red Sell button with no label saying so.
 */
describe("the sell sheet quotes nothing it cannot ask about", () => {
  it("never asks for a buy quote while selling", () => {
    expect(code).toMatch(/if \(limit \|\| selling \|\| !deps\.quote\) return/)
  })
})

/**
 * THE SIZE CONTROLS MUST OFFER MONEY THE CONFIRM CAN SPEND. The presets
 * learned this; the default amount had not. Measured: $25 in the field,
 * presets offering $0.88 / $1.77 / $3.53, "USDC balance $3.53" below, and
 * a button asking for a deposit.
 */
describe("the buy sheet opens on what the reader can spend", () => {
  it("reseeds an untouched default down to the pocket, never up", () => {
    expect(code).toMatch(/let buySeeded = false/)
    expect(code).toMatch(/r\.cashUsd > 0 &&\s*\n\s*r\.cashUsd < PRESET_USD\[1\]/)
    // The same cent-floored figure Max writes, so the field and the preset
    // beside it cannot differ by a rounding.
    expect(code).toMatch(/const all = pocketPick\(r\.cashUsd, 100\)/)
  })

  it("leaves a standing order alone, because that one really does escrow", () => {
    const seed = code.slice(code.indexOf("let buySeeded"))
    expect(seed.slice(0, seed.indexOf("verdict()"))).toMatch(/!limit &&/)
  })

  it("still only touches a field the reader has not typed in", () => {
    expect(code).toMatch(/!buySeeded &&\s*\n\s*st\.usd === PRESET_USD\[1\]/)
  })
})

/**
 * WHAT THE BOOK SAYS ABOUT ITSELF. The hero counted positions the list
 * refused to draw ($3.55 over a list summing to $3.53), and the one line
 * that explained the gap said "nothing to show" about two different facts.
 */
describe("the book explains its own gaps", () => {
  it("separates a position under a cent from one nobody could price", () => {
    expect(code).toMatch(/const unpriced = dust\.filter\(\(p\) => p\.valueUsd === null\)\.length/)
    expect(code).toMatch(/`\$\{tiny\} under \$\$\{DUST_USD\.toFixed\(2\)\}`/)
    expect(code).toMatch(/we could not price/)
    expect(code).not.toMatch(/with nothing to show/)
  })

  it("prints a dollar's amount once, not twice", () => {
    // "USDC  3.53  $3.53" — the quantity of a dollar IS its value.
    expect(code).toMatch(/\.\.\.\(isCash \? \[\] : \[cell\("you-qty", qtyText\(p\.uiAmount\)\)\]\)/)
  })
})
