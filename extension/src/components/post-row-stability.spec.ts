import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE POST ROW HOLDS STILL.
 *
 * Two defects were reported against the same strip of the panel, and they
 * are the same mistake wearing two coats:
 *
 * 1. The Bought/Sold receipt lifted and SCALED on :hover
 *    (`translateY(-1px) scale(1.015)` on an overshoot curve). A scale on a
 *    pill with a sentence in it pushes every glyph outward from the pill's
 *    centre and re-rasterises text drawn at 1.0, so "Bought $WIF" slid, and
 *    the overshoot in the ease made it land twice. Reported as "the tag
 *    shifts its text on hover".
 *
 * 2. The comment count reserved space for a number that was not printed —
 *    the element stayed in the flex row with an empty string in it, so the
 *    container's gap kept drawing a hole beside the glyph.
 *
 * Both are "the box changed size for a reason that was not information".
 * The owner's note was that the extension is full of these, so this file is
 * a SWEEP rather than a single guard: it brace-matches every `"&:hover"`
 * object in the post row and refuses any property that can move a pixel of
 * layout, whoever writes it next.
 *
 * WHY SOURCE GUARDS. jsdom implements no cascade and no layout (see the note
 * in vitest.config.ts), so it cannot be asked what a hovered element
 * measures. The thing we can pin is the declaration, and the declaration is
 * where both bugs were written.
 */
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

/**
 * The file with its comments removed. Copied from receipt-wiring.spec.ts,
 * which learned this the hard way: a comment explaining the old line
 * contains the old line, so a `not.toMatch` over the raw file matches the
 * explanation. A guard the fix's own documentation can trip is a guard that
 * teaches people not to document — and the fixes below are heavily
 * commented precisely because they overturn a prior decision.
 */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * Every `"&:hover…": { … }` object in a file, as raw text.
 *
 * Brace-matched rather than regex-bounded so nested selectors (`"& .icon":
 * { … }` inside a hover) are read as part of the block instead of ending it
 * early. Template literals count their own `${` and `}`, which balance, so
 * `borderColor: \`${ACCENT}66\`` walks correctly. The one shape that would
 * fool this is an unbalanced brace inside a string literal; the depth
 * assertion below fails loudly rather than silently reading half a block.
 */
const hoverBlocks = (file: string): string[] => {
  const source = code(file)
  const out: string[] = []
  const open = /"&:hover[^"]*"\s*:\s*\{/g
  let m: RegExpExecArray | null
  while ((m = open.exec(source)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++
      else if (source[i] === "}") depth--
      i++
    }
    expect(depth, `unbalanced :hover block in ${file}`).toBe(0)
    out.push(source.slice(m.index + m[0].length, i - 1))
  }
  return out
}

/**
 * Properties that change the BOX, and are therefore forbidden on :hover.
 *
 * The allowed opposites are deliberate and worth naming, because every
 * hover in this row already uses one: `backgroundColor`, `borderColor`,
 * `color`, `boxShadow` (including `inset` hairlines), `textDecoration`,
 * `opacity` and `filter` are all painted into a box whose size was decided
 * before the pointer arrived. `borderColor` and `borderRadius` pass on
 * purpose; `border` and `borderWidth` do not, since those are the two that
 * can add a pixel and shove the words inside.
 *
 * `transform: "none"` is NOT exempted, even though it moves nothing on its
 * own. A hover that has to be neutralised under reduced-motion is a hover
 * that moves under everything else, and leaving the neutraliser behind
 * after the movement is gone is a dead rule still telling the old story.
 */
const MOVES_THE_BOX: [string, RegExp][] = [
  ["transform", /\btransform\s*:/],
  ["scale", /\bscale\s*:/],
  ["translate", /\btranslate\s*:/],
  ["padding", /\bpadding[A-Za-z]*\s*:/],
  ["margin", /\bmargin[A-Za-z]*\s*:/],
  ["MUI spacing shorthand", /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)\s*:/],
  ["a border width", /\bborder(?:Width|Top|Right|Bottom|Left)?\s*:/],
  ["fontWeight", /\bfontWeight\s*:/],
  ["fontSize", /\bfontSize\s*:/],
  ["letterSpacing", /\bletterSpacing\s*:/],
  ["lineHeight", /\blineHeight\s*:/],
  ["gap", /\bgap\s*:/],
  ["a box dimension", /\b(?:width|height|minWidth|maxWidth|minHeight|maxHeight)\s*:/],
]

/**
 * The post row as the reader meets it: the card, its header, its menu, its
 * favicon, the footer's chips, the comment thread underneath, and the two
 * other surfaces that draw a Bought/Sold receipt. Files with no `:hover` of
 * their own are listed anyway — the sweep costs nothing and the point is to
 * catch the first one somebody adds.
 *
 * ONE DELIBERATE OMISSION, so nobody has to rediscover it.
 * components/OrganizationBadge.tsx (rendered from Post/PostHeader.tsx:159)
 * hovers with `transform: "scale(1.1)"` — the same technique as the receipt
 * defect. It is left out rather than fixed because it is a 15px <img> with
 * no text in it: nothing re-rasterises into a different word shape, nothing
 * was reported against it, and a badge that zooms under the pointer is a
 * legible affordance rather than a glitch. If it ever gets a label inside
 * it, add the file to this list and the transform comes out.
 */
const POST_ROW = [
  "components/Post.tsx",
  "components/PostFooter.tsx",
  "components/UpvoteButton.tsx",
  "components/CommentFooter.tsx",
  "components/TradeHistory.tsx",
  "components/chipActStyle.ts",
  "components/Post/PostHeader.tsx",
  "components/Post/ActionMenu.tsx",
  "components/Post/WebsiteFavicon.tsx",
  "components/Post/Comments/CommentSection.tsx",
]

describe("a hover in the post row repaints, it does not reflow", () => {
  for (const file of POST_ROW) {
    it(`${file} keeps its box still on :hover`, () => {
      for (const body of hoverBlocks(file)) {
        for (const [name, re] of MOVES_THE_BOX) {
          expect(
            body,
            `${file}: a ":hover" block changes ${name}, which moves the ` +
              `layout under the pointer. Say "aimed at" with paint instead ` +
              `— background, border COLOUR, an inset box-shadow. Block:\n` +
              body,
          ).not.toMatch(re)
        }
      }
    })
  }

  it("the Bought/Sold receipt's hover carries no transform at all", () => {
    const post = code("components/Post.tsx")
    // The declaration that was the defect.
    expect(post).not.toMatch(/translateY\(-1px\) scale\(1\.015\)/)
    // The REST transform stays: it pins the stacking context so paint order
    // never changes mid-interaction, and :active needs a from-value.
    expect(post).toMatch(/transform: "translateY\(0\) scale\(1\)"/)
    // The press is still allowed to move — a finger asked a question.
    expect(post).toMatch(/"&:active": \{\s*transform: "scale\(0\.955\)"/)
  })

  it("the reduced-motion gate stopped undoing a hover that cannot move", () => {
    // `"&:hover, &:active": { transform: "none" }` would now be a rule that
    // can never fire, still explaining a lift the code no longer has.
    expect(code("components/Post.tsx")).not.toMatch(/"&:hover, &:active"/)
  })
})

describe("a count that is not there occupies no space", () => {
  it("UpvoteButton drops the whole element at zero, not just its digits", () => {
    const up = code("components/UpvoteButton.tsx")
    // The element itself is conditional. An emptied <Typography/> would be
    // invisible and still a flex item, so the chip's gap would keep drawing
    // a hole where the number is not.
    expect(up).toMatch(/data\.upvotes > 0 && \(/)
    expect(up).not.toMatch(/> 0[\s\S]{0,80}:\s*""/)
  })

  it("CommentFooter no longer prints a literal zero", () => {
    const cf = code("components/CommentFooter.tsx")
    expect(cf).not.toMatch(/comment_count \|\| reply_count \|\| 0/)
    expect(cf).toMatch(/\(comment_count \|\| reply_count\) > 0 && \(/)
  })

  /**
   * THE LIVE INSTANCE, AND THE ONE THE OWNER ACTUALLY SEES.
   *
   * This assertion was written as an `it.todo` excused by "that file belongs
   * to another agent in this working tree". That was not true — nobody held
   * PostFooter.tsx — and it is the worse half of the mistake: the guards
   * above pinned the defect on two surfaces where it had already been fixed
   * while the surface the report was filed against kept it, and the suite
   * stayed green saying so. A spec that parks the real case behind a false
   * excuse is a spec that certifies the bug.
   *
   * PostFooter.tsx is the panel's rendered post row. It used to draw the
   * count's <Typography> unconditionally with `: ""` inside it, so at zero
   * the chip still held an empty flex item and still drew chipActSx's
   * `gap: "5px"` beside the bubble: 15px of air to the right of the glyph
   * against 10px to its left. The element is now guarded whole.
   */
  it("PostFooter's comment chip drops the count ELEMENT at zero", () => {
    const footer = code("components/PostFooter.tsx")
    expect(footer).toMatch(/\(comment_count \|\| reply_count\) > 0 && \(/)
    // No emptied-string fallback anywhere in the row: that is the shape the
    // defect wore, and it is invisible on screen and invisible in review.
    expect(footer).not.toMatch(/:\s*""/)
  })
})
