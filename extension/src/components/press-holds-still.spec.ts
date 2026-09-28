import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * A PRESS REPAINTS; IT DOES NOT RE-MEASURE.
 *
 * The report that created this file was about the whole product and not
 * about any one screen: "when I press buttons, things move in unrelated
 * places". Two controls in this folder were doing exactly that, and they
 * were the same mistake wearing two coats.
 *
 *   1. The composer's "Pop it" swapped its entire label for a 12px spinner
 *      while the post was in flight. The pill has padding and no width, and
 *      it is the last child of a right-aligned group, so the button
 *      collapsed to spinner-width and dragged the emoji and camera doors
 *      right with it — mid-press, in a part of the row nobody touched. The
 *      same button was also MOUNTED on the first keystroke, which shoved the
 *      same two doors the other way by the pill's whole width.
 *   2. FillCelebration's undo button swapped "Undo share" for the narrower
 *      "Removed" on the press, which re-measured the button and slid the
 *      Share pill and the dismiss glyph beside it.
 *
 * The rule both of them break: a box may change what it PAINTS in response
 * to a press, and may not change what it MEASURES. A control that shows a
 * spinner has to be big enough for the spinner and the label before either
 * one is decided; a control that swaps words has to be as wide as the wider
 * word at rest. components/FollowButton.tsx states the same rule in prose and
 * carries both remedies: a fixed slot for the glyph that swaps to a spinner,
 * and — for the label, whose two words are different lengths and cannot be
 * measured here — an `inline-grid` that stacks "Follow" and "Following" in one
 * cell (`"& > *": { gridArea: "1 / 1" }`) and toggles `visibility`, so the
 * WIDER word sizes the button once and neither state moves it. Cited by shape
 * rather than by line: the second remedy landed after this comment was first
 * written, and the line numbers it named had already moved by then.
 *
 * WHY A SOURCE GUARD. jsdom implements no cascade and no layout (see the
 * note at the top of vitest.config.ts), so it cannot be asked what a
 * mid-press button measures. What it can be asked is whether the
 * declaration that guarantees the width is still written down — and the
 * declaration is where both defects were written.
 */
const SRC = join(__dirname, "..")

const src = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * The file with its comments removed. Every guard below is otherwise
 * trippable by its own documentation: the comment explaining why the
 * spinner stopped replacing the label contains the sentence about the
 * spinner replacing the label.
 *
 * A block comment only opens after a delimiter or at a line's start —
 * borrowed from composer-points-badge.spec.ts, which learned it the hard
 * way: the `/*` inside `accept="image/*"` otherwise opens a comment that
 * runs to the end of the file and swallows the submit button.
 */
const code = (p: string) =>
  src(p)
    .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//g, "$1")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * The controls this group owns. Files with no button of their own are
 * listed anyway: the sweep costs nothing and the point is to catch the
 * first one somebody adds.
 */
const GROUP = [
  "components/CreatePost.tsx",
  "components/FillCelebration.tsx",
  "components/TipComment.tsx",
]

/**
 * The end of a JSX opening tag, and whether it closed itself.
 *
 * Brace-counted rather than "the next `>`", because an `sx` prop can hold
 * one: `"& > *": { gridArea: "1 / 1" }` is a real declaration in
 * FillCelebration and its `>` sits two braces deep.
 */
const openingTag = (source: string, at: number) => {
  let i = at + "<Box".length
  let depth = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === "{") depth++
    else if (ch === "}") depth--
    else if (ch === ">" && depth === 0) break
    i++
  }
  return { end: i, selfClosing: source[i - 1] === "/" }
}

type Control = { attrs: string; body: string }

/**
 * Every `<Box component="button">` in a file, split into the props that
 * decide its box and the children that fill it. Nested `<Box>`es are
 * counted so a button whose label lives in a span is read whole.
 */
const buttonBoxes = (file: string): Control[] => {
  const source = code(file)
  const out: Control[] = []
  for (let k = source.indexOf("<Box"); k !== -1; k = source.indexOf("<Box", k + 4)) {
    if (!/[\s/>]/.test(source[k + 4] ?? "")) continue
    const { end, selfClosing } = openingTag(source, k)
    const attrs = source.slice(k, end)
    if (!/component="button"/.test(attrs)) continue
    let body = ""
    if (!selfClosing) {
      let j = end + 1
      let nest = 1
      while (j < source.length && nest > 0) {
        if (source.startsWith("<Box", j) && /[\s/>]/.test(source[j + 4] ?? "")) {
          const inner = openingTag(source, j)
          if (!inner.selfClosing) nest++
          j = inner.end + 1
          continue
        }
        if (source.startsWith("</Box>", j)) {
          nest--
          j += "</Box>".length
          continue
        }
        j++
      }
      expect(nest, `${file}: unbalanced <Box> around a component="button"`).toBe(0)
      body = source.slice(end + 1, j - "</Box>".length)
    }
    out.push({ attrs, body })
  }
  return out
}

describe("a control that swaps in a spinner is already big enough for both", () => {
  for (const file of GROUP) {
    it(`${file} declares a width for every box that can hold a spinner`, () => {
      for (const { attrs, body } of buttonBoxes(file)) {
        if (!/CircularProgress/.test(body)) continue
        expect(
          attrs,
          `${file}: this control renders a CircularProgress but its box ` +
            `declares no minWidth. A padded, auto-width button collapses to ` +
            `spinner-width the moment the label leaves, and takes its ` +
            `neighbours' positions with it. Give the box a minWidth, or a ` +
            `fixed glyph slot the way FollowButton.tsx:129-157 does.`,
        ).toMatch(/\b(?:minWidth|width)\s*:/)
      }
    })
  }

  it("finds the controls it is sweeping, rather than passing on an empty list", () => {
    // A rename from <Box component="button"> to a plain <button> would empty
    // every loop above and leave this file green while guarding nothing.
    expect(buttonBoxes("components/CreatePost.tsx").length).toBeGreaterThanOrEqual(1)
    expect(buttonBoxes("components/FillCelebration.tsx").length).toBeGreaterThanOrEqual(3)
  })
})

describe("the composer's action row holds still", () => {
  const COMPOSER = "components/CreatePost.tsx"

  it("keeps the submit in the row instead of mounting it on the first keystroke", () => {
    const composer = code(COMPOSER)
    const at = composer.indexOf('type="submit"')
    expect(at, "the composer has no submit control").toBeGreaterThan(-1)
    const before = composer.slice(0, at)
    expect(
      before.replace(/\s+$/, ""),
      `${COMPOSER}: the submit is mounted by a condition. Appearing inside ` +
        `a right-aligned flex group moves every sibling to its left by the ` +
        `button's whole width. Render it always and disable it instead.`,
    ).not.toMatch(/&&\s*\(\s*<Box\s+component="button"$/)
    // The pill is inert, not absent, when there is nothing to post.
    expect(composer).toMatch(/disabled=\{busy \|\| !canPost\}/)
  })

  it("keeps the label in the flow while the post is in flight", () => {
    const composer = code(COMPOSER)
    // The defect, exactly: spinner OR label, one measuring the box.
    expect(
      composer,
      `${COMPOSER}: the spinner is the label's alternative again. The box ` +
        `then measures whichever one is showing.`,
    ).not.toMatch(/CircularProgress[\s\S]{0,160}?\)\s*:\s*\(?\s*"Pop it"/)
    // The label is rendered unconditionally; the spinner rides on top of it.
    expect(composer).toMatch(/\{"Pop it"\}/)
    const submit = buttonBoxes(COMPOSER).find((c) => /type="submit"/.test(c.attrs))
    expect(submit, "the submit control moved out of a <Box component=\"button\">").toBeTruthy()
    expect(submit!.attrs).toMatch(/\bminWidth\s*:/)
    expect(submit!.body).toMatch(/position: "absolute"/)
  })
})

describe("a label that swaps words does not re-measure its button", () => {
  it("FillCelebration's undo keeps both words in one cell", () => {
    const fill = code("components/FillCelebration.tsx")
    // The defect: one ternary, two different widths, on the press.
    expect(fill).not.toMatch(/\{undone \? "Removed" : "Undo share"\}/)
    // The cure: both labels stacked in the same grid cell, so the wider one
    // measures the button once and the press only chooses the paint.
    expect(fill).toMatch(/gridArea: "1 \/ 1"/)
    expect(fill).toMatch(/visibility: undone \? "hidden" : "visible"/)
    expect(fill).toMatch(/visibility: undone \? "visible" : "hidden"/)
  })
})

describe("no hook is declared after an early return", () => {
  /**
   * The index of a component-level `if (…) return null`, or -1.
   *
   * Two-space indentation is the whole trick: it is what separates the
   * component's own guard from a `return null` inside a callback — the
   * `useMemo` at CreatePost.tsx:210 ends in one, four spaces deep, and a
   * naive scan reads it as the component bailing out and then flags every
   * hook the file declares afterwards.
   */
  const earlyReturn = (source: string) => {
    const m = /\n {2}if \([^\n]*\)\s*\{?[\s\n]*return null/.exec(source)
    return m ? m.index : -1
  }

  for (const file of GROUP) {
    it(`${file} calls every hook before it can bail out`, () => {
      const source = code(file)
      const at = earlyReturn(source)
      if (at === -1) return
      const after = source.slice(at)
      const strays = after.match(/\buse[A-Z][A-Za-z]*\s*\(/g) ?? []
      expect(
        strays,
        `${file}: a hook is called below an early return, so it runs only ` +
          `on the renders that get past it. The render where the guard ` +
          `stops matching throws "Rendered more hooks than during the ` +
          `previous render" and takes the panel with it — this is what ` +
          `FillCelebration did with its undo flag. Move the hook above the ` +
          `guard; its meaning is the button's, its position is React's.`,
      ).toEqual([])
    })
  }
})
