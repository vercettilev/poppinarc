import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * NO SCREEN MAY DENY WHAT THE PRODUCT DOES.
 *
 * The line "Zero tracking. Not even we know where you browse." was false and
 * not in a grey-area way: attachSpotCard.harvest() sends the url, title, h1,
 * meta description and 20,000 characters of body text to /embed/asset/match
 * on every page over 400 characters. The servers know where you browse BY
 * NECESSITY, because the product cannot match a market to a page without
 * reading the page.
 *
 * It was corrected on QuickStartStep and MISSED on PermissionsStep, which is
 * the screen that actually asks for the permission — the two onboardings
 * were fixed apart, months apart, and the false half went on shipping. That
 * is the failure this file exists to stop repeating: a claim like this is a
 * Chrome Web Store user-data-policy problem before it is a copy problem, and
 * it must not depend on somebody remembering the second screen.
 *
 * The check runs over the SOURCE with comments stripped, so the audits that
 * explain the history — which quote the old line on purpose — stay legal.
 */

const WELCOME = join(__dirname, "components", "steps")

/** Both comment forms, so a quoted history does not read as a claim. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

const FORBIDDEN: Array<[RegExp, string]> = [
  [/zero tracking/i, "denies a page read the product performs on every page"],
  [
    /not even we know where you browse/i,
    "denies a page read the product performs on every page",
  ],
  [
    /we (do not|don't|never) (see|read|collect) (your )?(pages?|browsing)/i,
    "denies the page read that /embed/asset/match requires",
  ],
  [
    /join the conversation/i,
    "promises site chat, which is switched off in production",
  ],
]

const files = readdirSync(WELCOME).filter((f) => /\.tsx?$/.test(f) && !f.includes(".spec."))

describe("what the onboarding screens are allowed to claim", () => {
  it("has screens to check", () => {
    // A rename that empties this directory must fail loudly rather than
    // turning the whole file into a green no-op.
    expect(files.length).toBeGreaterThan(2)
  })

  for (const file of files) {
    it(`${file} claims nothing the code contradicts`, () => {
      const body = stripComments(readFileSync(join(WELCOME, file), "utf8"))
      for (const [pattern, why] of FORBIDDEN) {
        expect(
          pattern.test(body),
          `${file} matches ${pattern} — it ${why}`,
        ).toBe(false)
      }
    })
  }
})
