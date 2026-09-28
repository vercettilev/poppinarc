import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { JUICE } from "./juice"

/**
 * RULE 6 AS A CONTRACT, not a style suggestion.
 *
 * The cyberpunk dose lives in the data and never in the chrome — and the
 * verdict that shipped it named the risk out loud: "tüm yüzeylerde
 * tutarlılık". Consistency across three surfaces that render through three
 * different stacks (a vanilla shadow-root template, a React card template,
 * a MUI theme) will not survive on discipline alone, so this file reads
 * the shipped sources and fails the build when a surface drops the voice
 * or the voice leaks into prose.
 */

const CHIP = readFileSync("src/entries/contentScript/x/xStrip.ts", "utf8")
const CARD = readFileSync("src/components/SpotCard/style.ts", "utf8")
const THEME = readFileSync("src/helpers/themeHelper.ts", "utf8")

/** The body of a surface's rule-6 block: from the RULE 6 marker to the
 *  closing brace of its selector list. */
function monoBlock(css: string, name: string): string {
  const at = css.indexOf("RULE 6")
  expect(at, `${name} carries no RULE 6 block`).toBeGreaterThan(-1)
  const open = css.indexOf("{", at)
  /**
   * Walk past `${...}` interpolations rather than trusting the first `}`.
   * The rule's body opens with `font-family: ${JUICE.mono}`, whose closing
   * brace is the first one after the block opens — so the naive slice
   * ended mid-token. Harmless today only because every assertion on the
   * block targets the selector LIST, which sits before the brace; the
   * first assertion anyone writes against the body would have silently
   * tested a truncated string. Same bug, same fix as the sibling helper
   * below, which found it the hard way against correct code.
   */
  let i = open + 1
  for (; i < css.length; i++) {
    if (css[i] === "$" && css[i + 1] === "{") {
      i = css.indexOf("}", i)
      continue
    }
    if (css[i] === "}") break
  }
  return css.slice(at, i)
}

describe("rule 6: the data speaks mono on every surface", () => {
  it("chip, card and panel all speak with the same voice token", () => {
    // The two templates interpolate the token; the theme references it.
    expect(CHIP).toContain("font-family: ${JUICE.mono}")
    expect(CARD).toContain("font-family: ${JUICE.mono}")
    expect(THEME).toContain("fontFamily: JUICE.mono")
  })

  it("the voice is the system's mono, nothing bundled", () => {
    expect(JUICE.mono.startsWith("ui-monospace")).toBe(true)
  })

  it("the chip's summoned surfaces are all in its block", () => {
    // Everything the reader OPENED — the sheet, the chart, the scoreboard,
    // the receipts. Ours, so it speaks our voice.
    const block = monoBlock(CHIP, "chip")
    for (const cls of [".amount-in", ".price-in", ".bal", ".dist", ".chart-note", ".order-tag", ".oo", ".receipt"]) {
      expect(block, `chip rule 6 lost ${cls}`).toContain(cls)
    }
  })

  it("the RESTING row is exempt, because it lives on X's page", () => {
    /**
     * The one place rule 6 stops. The resting row sits inside somebody
     * else's document where every glyph around it is Chirp, and a
     * monospace price six pixels from Chirp body text is the loudest
     * possible signal that this object was bolted on. Reported from the
     * field in exactly those words.
     *
     * The exemption is the costume, not the function: these classes must
     * still carry tabular-nums, which is what the mono was actually buying
     * — digits that do not jitter as a live price ticks.
     */
    const block = monoBlock(CHIP, "chip")
    for (const cls of [".px", ".chg", ".mine", ".wal"]) {
      const asSelector = new RegExp(`(?:^|[,\\s])\\${cls}(?:[,\\s{]|$)`)
      expect(asSelector.test(block), `resting row class ${cls} put back in the mono block`).toBe(false)
    }
    const rest = CHIP.slice(CHIP.indexOf(".px, .chg, .mine, .wal"))
    expect(rest.slice(0, 200), "the resting row lost tabular-nums").toContain(
      "font-variant-numeric: tabular-nums",
    )
  })

  it("the card's data classes are all in its block", () => {
    const block = monoBlock(CARD, "card")
    for (const cls of [".price", ".quote", ".amount input", ".order-price", ".order-bal", ".oo-row", ".col-num", ".me-hero-n"]) {
      expect(block, `card rule 6 lost ${cls}`).toContain(cls)
    }
  })

  it("prose never wears the terminal voice", () => {
    // Names, labels, sentences and social proof are the product face.
    // These are the classes most likely to get swept in by a future
    // "make it consistent" pass — that pass must come read this list.
    for (const [css, name, banned] of [
      [CHIP, "chip", [".sym", ".lbl", ".proof", ".unverified", ".note", ".pick", ".kindb", ".segb"]],
      [CARD, "card", [".stat-k", ".spark-k", ".order-lbl", ".panel-door", ".convo-proof"]],
    ] as const) {
      const block = monoBlock(css, name)
      for (const cls of banned) {
        // Match the class as a selector token, not as a substring of a
        // longer class name (.note must not flag .chart-note).
        const asSelector = new RegExp(`(?:^|[,\\s])\\${cls}(?:[,\\s{]|$)`)
        expect(asSelector.test(block), `${name} rule 6 swallowed prose class ${cls}`).toBe(false)
      }
    }
  })

  it("green means buy on every surface, and only on a buy", () => {
    /**
     * The row in the timeline draws Buy green and Sell red. The sheet it
     * opens drew Buy in the brand accent, and so did the card: sell had
     * been given its own colour on both, buy had been left on the default,
     * so only half of each pair was wrong and the mismatch never looked
     * like a mistake from inside one file.
     *
     * The exclusion matters as much as the rule. "Add funds" sits in the
     * same slot as the buy confirm and is not a trade, so it keeps the
     * brand gradient. A bright button that moves money into a wallet must
     * not wear the colour that means a trade went through (rule 4).
     */
    /**
     * The body of one CSS rule, skipping over `${...}` interpolations.
     *
     * A plain indexOf("}") looked right and was not: the first brace after
     * `.place {` belongs to `${JUICE.buyGlow}`, so the slice ended before
     * the declaration it was meant to read and the assertion failed against
     * correct code. Worth the extra lines — a test that lies about the
     * source is worse than no test.
     */
    const rule = (css: string, sel: string) => {
      const at = css.indexOf(sel)
      expect(at, `missing ${sel}`).toBeGreaterThan(-1)
      let i = css.indexOf("{", at) + 1
      for (; i < css.length; i++) {
        if (css[i] === "$" && css[i + 1] === "{") {
          i = css.indexOf("}", i)
          continue
        }
        if (css[i] === "}") break
      }
      return css.slice(at, i)
    }

    // The chip's sheet: buy confirm green, funding still brand.
    expect(rule(CHIP, ".place {")).toContain("${JUICE_BUY_FILL}")
    expect(rule(CHIP, ".place {")).not.toContain("${JUICE_GRADIENT}")
    expect(rule(CHIP, ".place.sell-side {")).toContain("${JUICE_SELL_FILL}")
    expect(rule(CHIP, ".place.fund-side {")).toContain("${JUICE_GRADIENT}")

    // The chip's side switch agrees with its own confirm.
    expect(rule(CHIP, '.segb[aria-pressed="true"] {')).toContain("${JUICE_BUY_FILL}")

    // The card, one surface over, says the same thing.
    expect(rule(CARD, '[data-act="confirm"][data-side="buy"]')).toContain(
      "${JUICE_BUY_FILL}",
    )
    expect(rule(CARD, '.modes button[aria-selected="true"][data-mode="buy"]')).toContain(
      "${JUICE_BUY_FILL}",
    )
  })

  it("the glow takes its hue from the button, not the recipe", () => {
    // One recipe, three directions. Before this the halo was the brand
    // blue under a red sell confirm, because the colour was baked into
    // glowMoney itself.
    expect(JUICE.glowMoney).toContain("var(--money-glow")
    expect(JUICE.glowMoneyHover).toContain("var(--money-glow-hi")
    // The fallback keeps every surface that sets nothing exactly as it was.
    expect(JUICE.glowMoney).toContain("rgba(104,198,255,.78)")
  })

  it("every money button shares the one glow recipe", () => {
    expect(CHIP).toContain("box-shadow: ${JUICE.glowMoney}")
    expect(CARD).toContain("box-shadow: ${JUICE.glowMoney}")
    expect(THEME).toContain("boxShadow: JUICE.glowMoney")
  })

  it("the neon halo stays rare: at most one text-shadow per surface", () => {
    // The halo marks THE live number. Two halos on one surface means the
    // next person found it pretty; that is exactly how the dose becomes
    // the costume.
    //
    // THE CHIP CARRIES NONE. Its halo sat on the resting price — a glowing
    // readout under a stranger's tweet all day, in the brand blue, which
    // does not describe market facts. It came off with the rest of the
    // terminal dress (field, 2026-08-31). "At most one" is the rule; zero
    // is the strictest way to keep it, and the ceiling below still binds
    // the day somebody adds one back.
    expect(CHIP.split("${JUICE.neonText}").length - 1).toBeLessThanOrEqual(1)
    expect(CARD.split("${JUICE.neonText}").length - 1).toBe(1)
  })

  it("rule 7: the opening beat is a token, not a number retyped per rule", () => {
    // The regression this blocks is literal: three hand-typed durations
    // (.24s / .28s / .3s) on one movement, which is what the feed showed
    // as broken animation. Interpolating the token is what keeps them
    // equal when somebody retunes the beat.
    const beat = CHIP.split("${JUICE.motionMs").length - 1
    expect(beat).toBeGreaterThanOrEqual(3) // height, radius, content fade
    expect(CHIP).toContain("${JUICE.motionEase}")
  })

  it("the costume never enters: no glitch, no brackets, no scanline abuse", () => {
    // The scan texture belongs to chart plots only — one use per template.
    expect(CHIP.split("JUICE_SCAN").length - 1).toBe(2) // import + chart well
    expect(CARD.includes("JUICE_SCAN"), "card sparkline is too small for scan texture").toBe(false)
  })
})
