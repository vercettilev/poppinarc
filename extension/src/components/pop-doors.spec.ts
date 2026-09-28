import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DOORS } from "./PopDoors"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the doors", () => {
  it("are three, X first, each on a page where a chip is certain", () => {
    expect(DOORS.length).toBe(3)
    expect(DOORS[0].id).toBe("x")
    expect(DOORS[0].url).toBe("https://x.com/search?q=%24SOL&f=live")
    expect(DOORS[1].url).toBe("https://www.reddit.com/r/solana/")
    expect(DOORS[2].url).toBe("https://www.cnbc.com/quotes/NVDA")
    for (const d of DOORS) expect(d.url.startsWith("https://")).toBe(true)
  })

  it("wear the sites' own marks: the X glyph, the others' favicons", () => {
    const src = stripComments(read("components/PopDoors.tsx"))
    expect(src).toMatch(/<XIcon /)
    expect(src).toMatch(/google\.com\/s2\/favicons\?domain=\$\{domain\}&sz=64/)
    expect(DOORS[1].iconDomain).toBe("reddit.com")
    expect(DOORS[2].iconDomain).toBe("cnbc.com")
  })

  it("the empty book prints no zero headline and no dash", () => {
    const src = stripComments(read("components/PopDoors.tsx"))
    expect(src).not.toMatch(/on what you hold/)
    expect(src).not.toMatch(/"—"/)
    expect(src).toMatch(/Nothing in yet\./)
    expect(src).toMatch(/Your cash is ready\./)
  })
})
