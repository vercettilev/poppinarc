import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * "YOUR MONEY IS GONE" — the sentence this card was accidentally saying.
 *
 * From the field, with a screenshot: a reader holding $493.95 of USDC and
 * $1.73 of WIF saw "$1.73" in 26px type under the word PORTFOLIO, with the
 * cash a grey caption underneath. The number was book.totalUsd, which is
 * the tokens alone.
 *
 * A total that leaves out the largest component is not a total. On a
 * product whose entire thesis is that USDC IS the money — the deposit
 * screens, the wallet header, the chip's scoreboard were all corrected for
 * exactly this — the one surface a person opens to check on themselves was
 * still reporting only the half they cannot spend.
 */
const SRC = readFileSync(
  join(__dirname, "ProfilePortfolio.tsx"),
  "utf8",
)
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the portfolio hero", () => {
  it("counts the cash", () => {
    // Positions + cash, folded once in helpers/portfolioTotal.ts so the
    // profile, the front door and the wallet screen cannot drift apart.
    expect(CODE).toMatch(/portfolioTotalUsd\(book\)/)
    // And is not the tokens alone any more.
    expect(CODE).not.toMatch(/usd\(book\.totalUsd\)/)
  })

  it("says UNKNOWN only when there is nothing to know", () => {
    /**
     * The old rule was right and too wide. A book whose every position
     * went unpriced is not worth $0.00, it is worth "we could not look".
     * But with cash sitting there we know a floor, and a dash over a
     * balance we can read is the same lie pointing the other way.
     */
    expect(CODE).toMatch(/allUnpriced && book\.cashUsd <= 0 \? null/)
  })

  it("still separates spendable from held", () => {
    // The split is a real question; it just no longer carries the whole
    // answer alone.
    expect(CODE).toMatch(/usd\(book\.cashUsd\)\} cash/)
  })
})

describe("the holdings list", () => {
  it("shows USDC as a row, ahead of the tokens", () => {
    // The list showed three memecoins and no USDC: the one asset a reader
    // actually spends was the only thing missing from a list of what they
    // own. Same correction the wallet screen already had.
    const at = CODE.indexOf("<CashRow")
    const first = CODE.indexOf("rows.map((p) =>")
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(first)
  })

  it("hides the row at zero rather than printing an empty wallet twice", () => {
    // The empty state above already says it, with a deposit door.
    expect(CODE).toMatch(/book\.cashUsd > 0 && <CashRow/)
  })

  it("does not dress cash as a trade", () => {
    // No mint to price, no 24h move to colour. Reusing Holding would have
    // meant inventing both.
    const row = CODE.slice(CODE.indexOf("function CashRow"), CODE.indexOf("function Holding"))
    expect(row).not.toMatch(/change24hPct|valueUsd|\bmint\b/)
  })
})
