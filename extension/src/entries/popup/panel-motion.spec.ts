import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { JUICE } from "~/theme/juice"

/**
 * The panel's stylesheet is plain CSS and cannot import a token, so the two
 * navigation rules carry their duration as a custom property that Layout
 * sets from JUICE.cinemaNavMs. This file is what keeps that arrangement
 * honest: a fallback hardcoded in the CSS is fine as a fallback and becomes
 * a lie the moment it disagrees with the token nobody thought to update.
 */
const css = readFileSync(join(__dirname, "App.css"), "utf8")

describe("the panel's navigation motion", () => {
  it("moves in both directions, so a screen says which way it came", () => {
    // A hard swap is the one motion that carries no information, and it was
    // what the panel did. Forward rises, back settles from above.
    expect(css).toMatch(/@keyframes panel-view-in\b/)
    expect(css).toMatch(/@keyframes panel-view-back\b/)
  })

  it("takes its duration from the token, with a fallback that agrees", () => {
    const rules = css.match(/\.panel-view-(in|back) \{[^}]*\}/g) ?? []
    expect(rules.length).toBe(2)
    for (const rule of rules) {
      expect(rule).toContain("var(--panel-nav-ms")
      const fallback = rule.match(/var\(--panel-nav-ms,\s*(\d+)ms\)/)
      expect(fallback, `no fallback in: ${rule}`).not.toBeNull()
      expect(Number(fallback![1])).toBe(JUICE.cinemaNavMs)
    }
  })

  it("uses the navigation weight, not the ceremony weight", () => {
    // This repeats dozens of times a session. The tenth Wallet visit must
    // not feel like a curtain, which is the whole reason the tier splits.
    expect(JUICE.cinemaNavMs).toBeLessThan(JUICE.cinemaMs)
  })

  it("still lets a reader turn all of it off", () => {
    // The blanket is global and blunt on purpose in this file; these rules
    // must sit under it rather than beside it.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/animation-duration: 0\.01ms !important/)
  })
})
