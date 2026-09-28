import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { qtyText } from "~/helpers/qtyText"
import { openPnl, pnlCaption } from "~/helpers/openPnl"

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function tsFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (/\.tsx?$/.test(e.name) && !e.name.includes(".spec.")) out.push(p)
  }
  return out
}

/**
 * ONE P&L QUESTION, ASKED THE SAME WAY EVERYWHERE.
 *
 * The product has two P&L concepts. totalUnrealizedPnlUsd is what the open
 * book is doing; totalPnlUsd folds realized in and so keeps counting money
 * the reader already took out. The chip and the front door both settled on
 * the first in September; the profile card kept reading the second and
 * reached production with it: a live screenshot on 2026-09-20 shows "$3.55"
 * beside an unlabelled red "−$1,276.44", on a card whose own subline says
 * "−$1.25 banked". The server, in the same payload, said the open book was
 * flat.
 */
describe("the P&L question", () => {
  it("prefers the open book, and falls back only when the server sends nothing", () => {
    expect(openPnl({ totalUnrealizedPnlUsd: -2, totalPnlUsd: -1276 })!.usd).toBe(-2)
    expect(openPnl({ totalUnrealizedPnlUsd: 0, totalPnlUsd: -1276 })!.usd).toBe(0)
    // An older server sends no unrealized total at all; the all-time figure
    // is the fallback, and it says so.
    const old = openPnl({ totalUnrealizedPnlUsd: undefined, totalPnlUsd: -1276 })!
    expect(old).toEqual({ usd: -1276, kind: "alltime" })
    expect(pnlCaption(old)).toBe("all time")
    expect(pnlCaption(openPnl({ totalUnrealizedPnlUsd: 5, totalPnlUsd: 5 }))).toBe(
      "on what you hold",
    )
    // No P&L is not a P&L of zero.
    expect(openPnl({ totalUnrealizedPnlUsd: null, totalPnlUsd: null })).toBeNull()
    expect(openPnl(null)).toBeNull()
  })

  it("is asked from the one helper on every panel surface that asks it", () => {
    for (const f of ["views/SpotPositions.tsx", "components/profile/ProfilePortfolio.tsx"]) {
      const v = strip(read(f))
      expect(v, f).toMatch(/openPnl\(/)
      // And nobody reads the folded figure straight any more.
      expect(v, f).not.toMatch(/=\s*(?:book|data)\??\.totalPnlUsd/)
    }
  })

  it("names which P&L it is wherever it shows one", () => {
    expect(strip(read("components/profile/ProfilePortfolio.tsx"))).toMatch(/pnlCaption\(open\)/)
    expect(strip(read("views/SpotPositions.tsx"))).toMatch(/on what you hold/)
  })
})

/**
 * HOW MUCH OF A THING, WRITTEN SO IT IS NOT A LIE.
 *
 * helpers/qtyText.ts was written because four fraction digits print any
 * quantity under 0.00005 as "0" — it turned a real $1.00 purchase of
 * Bitcoin into "0 WBTC". Its own header says "One rule, in one place,
 * because it was learned twice and applied once". It was still not applied
 * in five places, and one of them was the panel's trade receipt. A live
 * screenshot caught another: a profile row reading "0 NVDAx".
 */
describe("a quantity is never written as a lie", () => {
  it("keeps the digits that matter below one", () => {
    expect(qtyText(0.0000127)).not.toBe("0")
    expect((0.0000127).toLocaleString("en-US", { maximumFractionDigits: 4 })).toBe("0")
  })

  it("has no surface left formatting a quantity with a four-digit cap", () => {
    const offenders: string[] = []
    for (const file of tsFiles()) {
      const code = strip(readFileSync(file, "utf8"))
      for (const m of code.matchAll(/(\w+(?:\.\w+)*)\.toLocaleString\([^)]*maximumFractionDigits:\s*4/g)) {
        // A PRICE may round to four places; a QUANTITY may not. Every
        // remaining call must prove it is not an amount of a token.
        offenders.push(`${file.slice(SRC.length + 1)}: ${m[0]}`)
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([])
  })
})

/**
 * A DOLLAR FIGURE IS GROUPED, on every surface. The wallet screen printed
 * "+$1234.57 in open orders" beside a front door printing the same sentence
 * as "+$1,234.57", and the front door's copy is a DOOR to the wallet.
 */
describe("dollars are grouped", () => {
  it("the wallet screen folds its money through one formatter", () => {
    const w = strip(read("views/wallet-ui.tsx"))
    expect(w).toMatch(/const usd = \(n: number\) =>/)
    expect(w).toMatch(/style: "currency"/)
    // No bare toFixed(2) left behind a dollar sign on this screen.
    expect(w).not.toMatch(/\$\$\{[^}]*\.toFixed\(2\)\}/)
  })
})

/**
 * THE THINGS THE SCREENSHOTS CAUGHT THAT WERE NOT ABOUT NUMBERS.
 */
describe("the profile card draws what it knows and no more", () => {
  const card = strip(read("components/profile/ProfilePortfolio.tsx"))

  it("folds a position worth less than a cent instead of drawing it as $0.00", () => {
    // Three rows read "$0.00" with a live percentage beside them on one
    // screen. The chip's book already counted them in a sentence.
    expect(card).toMatch(/const DUST_USD = 0\.01/)
    expect(card).toMatch(/p\.valueUsd === null \|\| p\.valueUsd >= DUST_USD/)
    expect(card).toMatch(/\$\{dust\} under \$\{usd\(DUST_USD\)\}/)
  })

  it("agrees with the chip about what a cent is", () => {
    const chip = strip(read("entries/contentScript/x/xStrip.ts"))
    const mine = /const DUST_USD = ([\d.]+)/.exec(card)![1]
    const theirs = /const DUST_USD = ([\d.]+)/.exec(chip)![1]
    expect(mine, "the two books disagree about what counts as dust").toBe(theirs)
  })

  it("sends a holding row to its own asset, not to the undifferentiated book", () => {
    expect(card).toMatch(/onOpen=\{\(\) => navigate\(`\/token\/\$\{p\.mint\}`\)\}/)
  })
})

describe("the profile head", () => {
  it("draws a dash rather than four zeros before the counts land", () => {
    expect(strip(read("components/profile/ProfileHead.tsx"))).toMatch(
      /counts === null \? "—"/,
    )
    expect(strip(read("views/profile.tsx"))).toMatch(/counts\s*\?\s*\{/)
  })
})

describe("your book's separators exist", () => {
  it("does not strip every row's border with :first-of-type", () => {
    // Each drawer row is wrapped in its own Box, so every button was the
    // first of its type inside its own parent and the group drew with no
    // separators at all.
    const y = strip(read("components/profile/YourBook.tsx"))
    expect(y).not.toMatch(/"&:first-of-type"/)
    expect(y).toMatch(/\{ \.\.\.rowSx, borderTop: "none" \}/)
  })
})

describe("the chip's own room", () => {
  const chip = strip(read("entries/contentScript/x/xStrip.ts"))

  it("never paints a portfolio VALUE in a P&L colour", () => {
    // Only the P&L branch cleared up/down, so a book that stopped being
    // scored kept the last verdict's colour under the word "Portfolio".
    const value = chip.slice(chip.indexOf('} else if (h.kind === "value")'))
    expect(value.slice(0, 600)).toMatch(/big\.classList\.remove\("up", "down"\)/)
    const unknown = chip.slice(chip.indexOf('cap.textContent = "Nothing to score yet"') - 400)
    expect(unknown.slice(0, 400)).toMatch(/big\.classList\.remove\("up", "down"\)/)
  })

  it("does not blank the whole book when one refresh fails", () => {
    expect(chip).toMatch(/refreshBook\(\)\.then\(\(b\) => \{\s*\n\s*if \(b\) landBook\(b, true\)/)
  })

  it("prints the cash once per screen", () => {
    expect(chip).toMatch(/cash\.hidden = tab === "holdings"/)
  })
})
