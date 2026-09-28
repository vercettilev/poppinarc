import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * WHAT THE STORE SHOWS IS SHIPPED FROM HERE, not typed into a dashboard.
 *
 * package.json's displayName and description become the extension's name and
 * short description in the Chrome Web Store, which means two house rules that
 * are enforced everywhere else in the product were being skipped on the one
 * surface a stranger reads first:
 *
 *   no em dashes in anything written for a reader, and
 *   no claim the product cannot keep.
 *
 * Both were being broken. The name carried an em dash and a line the product
 * retired months ago; the description promised "any coin", while the strip
 * trades what the catalog and the trade gate actually admit — a stranger
 * arriving on "$SOMETHING is not tradeable" after reading "any coin" was
 * promised something we do not do.
 */

const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { displayName?: string; description?: string }

const listing = [
  ["displayName", pkg.displayName ?? "", 75],
  ["description", pkg.description ?? "", 132],
] as const

describe("the store listing shipped in package.json", () => {
  for (const [field, value, limit] of listing) {
    it(`${field} fits what the store will show`, () => {
      expect(value.length).toBeGreaterThan(0)
      expect(value.length).toBeLessThanOrEqual(limit)
    })

    it(`${field} carries no em dash`, () => {
      // The rule is product-wide; this is simply the surface where forgetting
      // it is most expensive, because changing it later is a resubmission.
      expect(value).not.toContain("—")
    })

    it(`${field} promises nothing the trade gate refuses`, () => {
      // "any coin" was the claim. The strip trades what the catalog and the
      // gate admit, which is a large list and not an unlimited one.
      expect(value).not.toMatch(/any (coin|token|asset)/i)
      // And nothing about speed or certainty we cannot hold to.
      expect(value).not.toMatch(/\b(instant|guaranteed|risk[- ]free)\b/i)
    })
  }

  it("says WHERE, which is the part no other extension can copy", () => {
    // Lev, 2026-09-19, dropping the asset from the title: plenty of
    // extensions trade tokens; ours is the one that does it on the page
    // you are reading. The title carries the places, not the instrument.
    const name = (pkg.displayName ?? "").toLowerCase()
    expect(name).toContain("poppin")
    for (const place of ["x", "reddit", "any page"]) {
      expect(name).toContain(place)
    }
  })

  it("keeps a short name for the surfaces the title cannot fit", () => {
    // The side panel header and the extensions menu take short_name; a
    // 56-character title would be truncated in both.
    const manifest = readFileSync(join(__dirname, "manifest.ts"), "utf8")
    expect(manifest).toMatch(/short_name: "Poppin"/)
  })

  it("still says what the product is", () => {
    const both = `${pkg.displayName} ${pkg.description}`.toLowerCase()
    // A listing that offends no rule and describes nothing is not an
    // improvement. Buy and sell stay literal (see poppin-product-language).
    expect(both).toMatch(/buy and sell|trade/)
  })
})
