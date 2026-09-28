import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * BOUGHT AND SOLD ARE ONE TAG.
 *
 * Reported by the owner: "bought ve sold postlarinda bought ve sold tagleri
 * ayni degil" — on a bought post and a sold post, the receipt tag was not
 * the same object. It had drifted where drift is cheapest to write and
 * hardest to see: the trailing door slot. The buy tag ended `"· Buy →"` and
 * the sell tag ended with a bare `"→"`, so the same control carried a
 * different number of glyphs, a different width and — worse — the sell one
 * had quietly stopped saying it was pressable at all.
 *
 * The cause was that the direction was re-derived at eight separate call
 * sites as `transaction.trade_type === "sell"`, each free to answer with
 * whatever it liked. Nothing tied the two states together, so nothing had to
 * break for them to diverge.
 *
 * What this file pins is the rule, not the pixels: EVERYTHING about the tag
 * is written once, and only the semantic colour and the verb are allowed to
 * branch on the direction (juice.ts rule 4). A shape property that ever
 * branches — a padding, a gap, a font size, a width — fails here.
 *
 * WHY A SOURCE GUARD. jsdom implements no layout (see the note in
 * vitest.config.ts), so it cannot be asked what either tag measures. The
 * thing that can be pinned is the declaration, and the declaration is where
 * the divergence was written. Same technique as its neighbours
 * post-row-stability.spec.ts and receipt-wiring.spec.ts.
 */
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

/**
 * The file with its comments removed, then flattened to single spaces.
 *
 * Comment-stripping is copied from receipt-wiring.spec.ts, which learned it
 * the hard way: a comment explaining the old line contains the old line, so
 * a `not.toMatch` over the raw file matches the explanation. The fix this
 * file guards is heavily commented and quotes its own defect, so the guards
 * below would trip on the documentation without this.
 */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

const flat = (p: string) => code(p).replace(/\s+/g, " ")

/**
 * The receipt tag itself, bounded by two anchors that are unique in the
 * file: the condition that gates the whole control, and the post's sentence
 * <Typography/> immediately below it. Bounded rather than paren-matched
 * because the tag's sx is full of `rgba(...)` strings, and a paren counter
 * that walks into a string literal is a slicer that can be wrong silently.
 */
const tagSource = (): string => {
  const file = flat("components/Post.tsx")
  const start = file.indexOf("{transaction?.token_mint && (")
  const end = file.indexOf('<Typography color="white"')
  expect(start, "Post.tsx: the receipt tag's opening gate moved").toBeGreaterThan(-1)
  expect(end, "Post.tsx: the post sentence below the tag moved").toBeGreaterThan(start)
  const tag = file.slice(start, end)
  // The slice really is the tag and nothing else.
  expect(tag).toContain("Bought")
  expect(tag).toContain("Sold")
  expect(tag).not.toContain("receiptText(")
  return tag
}

/**
 * Properties that decide the tag's SHAPE. Not one of them may branch on the
 * direction: the moment one does, a bought tag and a sold tag are two
 * different boxes again, which is the whole of the reported defect.
 *
 * `color`, `backgroundColor` and `boxShadow` are deliberately absent — those
 * are paint, they are what rule 4 exists to allow, and every one of them
 * already branches here on purpose.
 */
const SHAPE_PROPS = [
  "display",
  "alignItems",
  "justifyContent",
  "gap",
  "padding",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "borderRadius",
  "border",
  "borderWidth",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "flex",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "whiteSpace",
  "transform",
  "m",
  "mt",
  "mb",
  "ml",
  "mr",
  "mx",
  "my",
  "p",
  "pt",
  "pb",
  "pl",
  "pr",
  "px",
  "py",
]

describe("the Bought and Sold receipt tags are the same object", () => {
  it("the direction is derived once, not re-asked per property", () => {
    const post = code("components/Post.tsx")
    expect(post).toMatch(/const isSell = transaction\?\.trade_type === "sell"/)
    // Every other site reads the flag. A second derivation is a second
    // opinion, and two opinions is how the door slot drifted in the first
    // place.
    expect(
      post.split('trade_type === "sell"').length - 1,
      'Post.tsx derives the trade direction more than once. Read `isSell`.',
    ).toBe(1)
  })

  it("no shape property branches on the direction", () => {
    const tag = tagSource()
    for (const prop of SHAPE_PROPS) {
      expect(
        tag,
        `the receipt tag branches "${prop}" on the direction, so a bought ` +
          `tag and a sold tag are different boxes. Only the semantic ` +
          `colour and the verb may differ (juice.ts rule 4).`,
      ).not.toMatch(new RegExp(`\\b${prop}\\s*:\\s*isSell\\b`))
    }
  })

  it("no CHILD branches on the direction either", () => {
    // THE HOLE THE TEST ABOVE LEAVES. It matches `<prop>: isSell`, which only
    // catches a branch written as a property VALUE. A direction-conditional
    // CHILD — `{isSell && <Typography …/>}` inside the tag — passes every one
    // of those guards, and it is the literal defect that was reported: the
    // sold tag drew a bare arrow where the bought tag drew "· Buy →", so the
    // two states held different numbers of elements and came out different
    // shapes. Branch the CONTENT of a slot; never whether the slot exists.
    const tag = tagSource()
    expect(
      tag,
      "the receipt tag renders a child in one direction only, so a bought " +
        "tag and a sold tag are different boxes.",
    ).not.toMatch(/\{\s*!?isSell\s*&&/)
  })

  it("the icon slot is a fixed box, so a missing coin costs no width", () => {
    const tag = tagSource()
    // A 20x20 slot that holds either the art or the emoji. Before this the
    // emoji was a bare 12px <span> beside a 20px <img>, and onError hid the
    // <img> outright — so a 404 took 20px and the row's gap out of the tag.
    // Asserted one at a time, NOT as one regex spanning all three: that form
    // pins the ORDER they happen to be written in, so reordering three
    // harmless declarations — or inserting a fourth between them — would
    // red-fail a tag that is still exactly right.
    for (const decl of ['flex: "none"', 'width: "20px"', 'height: "20px"']) {
      expect(tag, `the coin slot lost ${decl}`).toContain(decl)
    }
    expect(
      tag,
      "the coin art hides itself on error, which shrinks the tag after paint",
    ).not.toMatch(/style\.display = "none"/)
  })

  it("both directions fill the door slot with the same three parts", () => {
    const tag = tagSource()
    const m = /\{ ?isSell \? "([^"]*)" : "([^"]*)" ?\}/.exec(tag)
    expect(m, "Post.tsx: the receipt tag's door label is gone or reshaped").not.toBeNull()
    const [, sell, buy] = m!

    // Separator, one verb, arrow. The sell tag used to print the arrow
    // alone, which is a different element count in the same slot.
    for (const label of [sell, buy]) {
      expect(
        label,
        `the door label ${JSON.stringify(label)} is not "· <Verb> →"`,
      ).toMatch(/^· [A-Z][a-z]+ →$/)
    }
    const [sellSep, sellVerb, sellArrow] = sell.split(" ")
    const [buySep, buyVerb, buyArrow] = buy.split(" ")
    expect(sellSep).toBe(buySep)
    expect(sellArrow).toBe(buyArrow)

    // The verb is the ONE thing that may differ, and it has to stay true to
    // what the tap does: a buy receipt opens the Buy sheet, a sell receipt
    // opens the asset with no side at all. Never "Sell" — there is no sell
    // sheet behind this control.
    expect(buyVerb).toBe("Buy")
    expect(sellVerb).not.toBe("Sell")
  })

  it("both directions say the verb the same way in the same slot", () => {
    const tag = tagSource()
    const m =
      /\{ ?isSell \? `([A-Z][a-z]+) \$\{(transaction\.token_symbol)\}` : `([A-Z][a-z]+) \$\{(transaction\.token_symbol)\}` ?\}/.exec(
        tag,
      )
    expect(
      m,
      "Post.tsx: the receipt tag's headline is no longer <Verb> ${token_symbol} " +
        "in both directions",
    ).not.toBeNull()
    const [, sellVerb, sellSym, buyVerb, buySym] = m!
    expect(sellSym).toBe(buySym)
    expect(sellVerb).not.toBe(buyVerb)
  })

  it("the accessible name says exactly what the door says", () => {
    const tag = tagSource()
    const aria =
      /aria-label=\{ ?isSell \? `([A-Z][a-z]+) \$\{transaction\.token_symbol\}` : `([A-Z][a-z]+) \$\{transaction\.token_symbol\}` ?\}/.exec(
        tag,
      )
    expect(
      aria,
      "Post.tsx: the receipt tag's aria-label no longer branches with the tag. " +
        "It used to read `Buy $WIF` on BOTH, promising a screen reader a buy " +
        "sheet the sell tag does not open.",
    ).not.toBeNull()
    const door = /\{ ?isSell \? "· ([A-Z][a-z]+) →" : "· ([A-Z][a-z]+) →" ?\}/.exec(tag)
    expect(door).not.toBeNull()
    expect(aria![1], "the sell tag's spoken verb and printed verb disagree").toBe(
      door![1],
    )
    expect(aria![2], "the buy tag's spoken verb and printed verb disagree").toBe(
      door![2],
    )
  })

  it("the tap still matches the verb it prints", () => {
    // "Buy" is only honest because the buy branch hands the asset strip the
    // side, so the sheet is already open on Buy when the reader lands. The
    // sell branch passes no side, which is why its verb is not "Sell".
    expect(code("components/Post.tsx")).toMatch(
      /setLaunchMint\(\s*transaction\.token_mint,\s*isSell \? undefined : "buy",/,
    )
  })
})

/**
 * THE OTHER SURFACES THAT DRAW A DIRECTION TAG.
 *
 * The shadow-root card cannot import MUI or the theme, so agreement there is
 * kept by hand — which means it is worth pinning that its two directions are
 * at least the same SHAPE as each other. `.post-tag` is a different control
 * from the panel's receipt (one uppercase word in the post head, not a
 * pressable receipt), but the rule it has to obey is the same one: the box
 * is declared once and only the colour branches.
 */
describe("the card's own buy/sell tag branches on colour alone", () => {
  it(".post-tag.buy and .post-tag.sell differ by colour and nothing else", () => {
    // `${JUICE.green}` carries a `}` of its own, and a `[^}]*` rule body
    // that walks into one reads half a declaration and says the rule is
    // shorter than it is. The interpolations go first.
    const card = flat("components/SpotCard/style.ts").replace(/\$\{[^}]*\}/g, "VAR")
    const rule = (side: string) => {
      const m = new RegExp(`\\.post-tag\\.${side} \\{([^}]*)\\}`).exec(card)
      expect(m, `SpotCard/style.ts: .post-tag.${side} is gone`).not.toBeNull()
      return m![1]
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d.includes(":"))
        .map((d) => d.slice(0, d.indexOf(":")).trim())
        .sort()
    }
    // Same property names on both sides...
    const buy = rule("buy")
    expect(buy).toEqual(rule("sell"))
    expect(buy.length).toBeGreaterThan(0)
    // ...and every one of them is paint. The box lives in the base
    // `.post-tag` rule, written once for both directions; a shape property
    // appearing on a direction is the card's version of this defect.
    const PAINT = ["color", "background", "background-color", "box-shadow", "border-color"]
    for (const prop of buy) {
      expect(
        PAINT,
        `SpotCard/style.ts: .post-tag.buy/.sell declares "${prop}", which is ` +
          `not paint. The two directions must differ by colour alone.`,
      ).toContain(prop)
    }
  })
})
