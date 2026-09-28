import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
/** Comments are where the history lives; the words readers see are the rest. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the header on a quiet route", () => {
  it("swaps the feed's doors for a way back and keeps the avatar", () => {
    const h = stripComments(read("components/Header.tsx"))
    expect(h).toMatch(/const quiet = isQuietRoute\(location\.pathname\)/)
    const back = h.indexOf('aria-label="Back"')
    const home = h.indexOf('title="Global Feed"')
    expect(back).toBeGreaterThan(-1)
    expect(back).toBeLessThan(home)
    expect(h).toMatch(/\{quiet \? \(\s*<Box sx=\{\{ flex: 1 \}\} \/>/)
    expect(h).toMatch(/\{!quiet && liveView\.visible \? \(/)
  })

  it("signs out through the one helper Settings also uses", () => {
    expect(stripComments(read("components/Header.tsx"))).toMatch(
      /await signOutEverywhere\(queryClient\)/,
    )
    expect(stripComments(read("views/Settings.tsx"))).toMatch(
      /signOutEverywhere\(queryClient\)/,
    )
  })
})
