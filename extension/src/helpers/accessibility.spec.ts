import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { JUICE } from "../theme/juice"
import { aaThreshold, contrastRatio, declaredColor, luminance } from "./contrast"

/**
 * THE CHECKLIST, AS A TEST.
 *
 * A design-audit skill hands you rules to remember. This file is the same
 * rules in the form that survives being forgotten: it reads the SHIPPED
 * stylesheets and fails the build when a colour drops below AA or a surface
 * animates past somebody who asked their system to stop moving things.
 *
 * It was written after measuring, not before: four of our own pairs were
 * under AA, one at 1.73:1, and the chip gated two of its eighteen animations
 * behind prefers-reduced-motion. Every one of those had passed review by eye.
 */

const CHIP = readFileSync("src/entries/contentScript/x/xStrip.ts", "utf8")
const CARD = readFileSync("src/components/SpotCard/style.ts", "utf8")
/** The panel is React + MUI, so its gate is a global rule, not a shadow sheet. */
const PANEL = readFileSync("src/entries/popup/App.css", "utf8")

/** The surfaces these colours are actually painted on. */
const CHIP_BG = JUICE.ground
const CARD_BG = "#0E141D"

describe("WCAG contrast, computed rather than eyeballed", () => {
  /**
   * Every foreground/background pair the two shadow-root surfaces put on
   * screen, with the size and weight it is drawn at — because the threshold
   * is 3.0 for large text and 4.5 for everything else, and using one number
   * for both is how a 21px price field ends up with an unreadable
   * placeholder or a 10px label ends up shouting.
   */
  /**
   * Every rule these two shadow-root surfaces paint text with, named by its
   * SELECTOR — the colour is read out of the shipped stylesheet, never
   * restated here. Size and weight are stated because the threshold is 3.0
   * for large text and 4.5 for everything else, and one number for both is
   * how a 21px price field ends up with an unreadable placeholder or a 10px
   * label ends up shouting.
   */
  const PAIRS: Array<[string, string, string, string, number, boolean]> = [
    // what                       css       selector                  bg        px    bold
    ["chip muted note", CHIP, ".note {", CHIP_BG, 12, false],
    ["chip section label", CHIP, ".sheet .lbl {", CHIP_BG, 11, true],
    ["chip price placeholder", CHIP, ".price-in::placeholder {", CHIP_BG, 21, true],
    ["chip pricing switch", CHIP, ".kindb {", CHIP_BG, 11.5, true],
    ["chip balance line", CHIP, ".bal {", CHIP_BG, 12.5, false],
    ["chip open-order row", CHIP, ".oo {", CHIP_BG, 12.5, false],
    ["card order label", CARD, ".order-lbl {", CARD_BG, 10, true],
    ["card price placeholder", CARD, ".order-price::placeholder {", CARD_BG, 20, true],
    ["card balance line", CARD, ".order-bal {", CARD_BG, 11.5, false],
    ["card pricing switch", CARD, ".kind-btn {", CARD_BG, 11, true],
  ]

  for (const [what, css, selector, bg, px, bold] of PAIRS) {
    it(`${what} clears AA`, () => {
      const fg = declaredColor(css, selector)
      const ratio = contrastRatio(fg, bg)
      const need = aaThreshold(px, bold)
      expect(
        ratio,
        `${what} (${selector}): ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${need}:1 at ${px}px${bold ? " bold" : ""}`,
      ).toBeGreaterThanOrEqual(need)
    })
  }

  /** The pairs that are literal in markup rather than in a rule of their own. */
  it("the fixed accents clear AA too", () => {
    const fixed: Array<[string, string, string, number]> = [
      ["chip price", JUICE.text, CHIP_BG, 3],
      ["Buy label on its accent", "#06202e", "#5EC1FF", 4.5],
      ["Sell at rest", "#ff6b61", CHIP_BG, 4.5],
      ["a gain, on its own chip", "#30D158", "#1c2a1f", 4.5],
      ["a loss, on its own chip", "#FF453A", "#2a1a1a", 4.5],
      ["a balance that cannot cover", "#f5a524", CHIP_BG, 4.5],
    ]
    for (const [what, fg, bg, need] of fixed) {
      expect(contrastRatio(fg, bg), `${what}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(need)
    }
  })

  it("still reports the pairs that used to fail, so nobody restores them", () => {
    // The exact values this pass replaced. Kept as a record: each one looked
    // fine on a good monitor in a dark room, and each one was unreadable.
    // Pinned to the pre-juice ground (#16181c): the record is about the
    // surface these colours actually shipped on, not today's.
    expect(contrastRatio("#5b6470", "#16181c")).toBeLessThan(3) //  2.96
    expect(contrastRatio("#3d4147", "#16181c")).toBeLessThan(2) //  1.73
    expect(contrastRatio("#71767b", "#16181c")).toBeLessThan(4.5) // 3.88
    expect(contrastRatio("#71767b", CARD_BG)).toBeLessThan(4.5) // 4.03
    // And the juice pass earned its own line: the first text3 draft.
    expect(contrastRatio("#6E7E93", JUICE.ground)).toBeLessThan(4.5) // 4.45
  })
})

/**
 * A reduced-motion block that names two animations out of eighteen is the
 * same as not having one. These assert the blanket rule is present and
 * unqualified, because the failure mode is not "no block" — it is a block
 * that quietly stopped covering what got added after it.
 */
describe("motion is a preference, not a decision we get to make", () => {
  const gates = (css: string) => (css.match(/prefers-reduced-motion/g) ?? []).length
  const animates = (css: string) =>
    (css.match(/animation:|@keyframes|transition:/g) ?? []).length

  it("the chip stops everything it moves", () => {
    expect(gates(CHIP)).toBeGreaterThan(0)
    expect(CHIP).toMatch(/prefers-reduced-motion[\s\S]{0,220}animation: none !important/)
    expect(CHIP).toMatch(/prefers-reduced-motion[\s\S]{0,260}transition: none !important/)
  })

  it("the card stops everything it moves", () => {
    expect(gates(CARD)).toBeGreaterThan(0)
    /**
     * The blanket has to REACH the tree it is blanketing. It used to select
     * `.poppin-spot-card`, a class nothing carries - the host wears the
     * ATTRIBUTE data-poppin-spot-card and sits outside this stylesheet's
     * shadow root either way - so every animation kept running for a reader
     * who had asked their system to stop, with a passing test above it.
     *
     * So this reads the block itself rather than measuring how close two
     * strings happen to sit: inside a shadow root the blanket is :host plus
     * the universal selector, and nothing else can be.
     */
    // The card gates in several blocks (specific ones first, the blanket
    // last); the blanket is the one that must reach the whole tree.
    const bodies = [
      ...CARD.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
    ].map((m) => m[1])
    const blanket = bodies.find((b) => /:host,\s*\n\s*\*\s*\{/.test(b))
    expect(blanket).toBeDefined()
    expect(blanket!).toMatch(/animation: none !important/)
    expect(blanket!).toMatch(/transition: none !important/)
    /**
     * The class that never existed must not come back - asserted against
     * the stylesheet with its COMMENTS REMOVED. The first version of this
     * guard failed against the correct fix, because the comment explaining
     * what the old selector was contains the old selector. A guard its own
     * documentation can trip teaches people not to document.
     */
    const cardCss = CARD.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(cardCss).not.toMatch(/\.poppin-spot-card[\s,{]/)
  })

  /**
   * The panel was the last surface still moving for a reader who had asked
   * their system to stop — it has no shadow stylesheet to gate, so nobody
   * gated it. A global rule, blunt on purpose.
   */
  /**
   * The welcome tab is the product's FIRST screen, and it was the one with
   * no rule at all - the step frame animates every route swap, and nothing
   * gated it.
   */
  it("the welcome tab stops everything it moves", () => {
    const WELCOME = readFileSync("src/entries/welcome/welcome.css", "utf8")
    expect(WELCOME).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(WELCOME).toMatch(/animation-duration: 0\.01ms !important/)
    expect(WELCOME).toMatch(/transition-duration: 0\.01ms !important/)
  })

  it("the panel stops everything it moves", () => {
    expect(gates(PANEL)).toBeGreaterThan(0)
    expect(PANEL).toMatch(/prefers-reduced-motion[\s\S]{0,200}animation-duration: 0\.01ms !important/)
    expect(PANEL).toMatch(/prefers-reduced-motion[\s\S]{0,300}transition-duration: 0\.01ms !important/)
  })

  it("both surfaces animate enough for this to matter", () => {
    // If these ever drop to zero the tests above are guarding nothing, and
    // the reader of this file should know that rather than assume coverage.
    expect(animates(CHIP)).toBeGreaterThan(10)
    expect(animates(CARD)).toBeGreaterThan(10)
  })
})

describe("the contrast maths itself", () => {
  it("matches WCAG's published anchors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5)
    // order must not matter
    expect(contrastRatio("#777777", "#000000")).toBeCloseTo(
      contrastRatio("#000000", "#777777"),
      10,
    )
    expect(luminance("#ffffff")).toBeCloseTo(1, 5)
    expect(luminance("#000000")).toBeCloseTo(0, 5)
    expect(luminance("#fff")).toBeCloseTo(luminance("#ffffff"), 10)
  })

  /**
   * Large text is 18.66px bold or 24px regular. Getting this wrong in the
   * lenient direction lets unreadable text through; getting it wrong in the
   * strict direction forced our 21px bold price placeholder to the same
   * brightness as a typed value, which reads as "a price is already set".
   */
  it("knows where WCAG's large-text line is", () => {
    expect(aaThreshold(21, true)).toBe(3)
    expect(aaThreshold(21, false)).toBe(4.5)
    expect(aaThreshold(24, false)).toBe(3)
    expect(aaThreshold(18.66, true)).toBe(3)
    expect(aaThreshold(18, true)).toBe(4.5)
  })

  it("refuses a colour it cannot read rather than guessing", () => {
    expect(() => luminance("rebeccapurple")).toThrow()
    expect(() => luminance("#12345")).toThrow()
  })
})
