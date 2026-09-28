import { describe, expect, it } from "vitest"
import { darkHas, darkWith, SITE_CHAT_DARK_TTL_MS, type DarkHosts } from "./presence"

describe("a dark host is remembered, then forgotten", () => {
  const T = 1_700_000_000_000
  it("remembers for the window and not a moment longer", () => {
    const map = darkWith(null, "x.com", T)
    expect(darkHas(map, "x.com", T + 1)).toBe(true)
    expect(darkHas(map, "x.com", T + SITE_CHAT_DARK_TTL_MS - 1)).toBe(true)
    expect(darkHas(map, "x.com", T + SITE_CHAT_DARK_TTL_MS)).toBe(false)
    expect(darkHas(map, "reddit.com", T + 1)).toBe(false)
  })
  it("prunes lapsed hosts when a new one is written", () => {
    const old = { "stale.example": T - 1 }
    const map = darkWith(old, "x.com", T)
    expect(Object.keys(map)).toEqual(["x.com"])
  })
  it("survives junk in storage", () => {
    expect(darkHas({ "x.com": "soon" } as unknown as DarkHosts, "x.com", T)).toBe(false)
    expect(darkHas(undefined, "x.com", T)).toBe(false)
  })
})
