import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE POST'S ACTION ROW: COUNTERS ON THE LEFT, DOORS ON THE RIGHT.
 *
 * Reported by the owner against the panel's feed: "there are like, comment,
 * and two more buttons for tip and share. Make tip and share FRAMELESS and
 * pull them to the RIGHT, next to the timestamp."
 *
 * The row drew four identical pills, which said the four controls were the
 * same kind of thing. Two of them are counters — press like or reply and a
 * number moves, and the pill is the box that says a number lives here. The
 * other two are DOORS: tip opens a dialog that moves money, share leaves for
 * a composer. Neither holds a tally, so a pill around them promised a count
 * that never came, and both sat on the counting side of the row.
 *
 * A previous pass reported this fixed while the row was byte-for-byte
 * unchanged — the ownership list named components/Post.tsx, which contains
 * none of the four controls (it only threads `onTip` into <PostFooter>).
 * This file therefore pins the RENDERED surface, PostFooter.tsx, so no
 * future pass can call the row done without moving a pixel of it.
 *
 * WHY SOURCE GUARDS. jsdom implements no cascade and no layout (see the note
 * in vitest.config.ts), so it cannot be asked what this row measures. What
 * can be pinned is the declaration, and the declaration is where the defect
 * was written. The fit test below therefore does the arithmetic the browser
 * would do, from the numbers the source actually declares.
 */
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

/**
 * The file with its comments removed. Every guard here would otherwise be
 * trippable by its own documentation: the comments in PostFooter.tsx explain
 * what the doors used to be, and quote the pill they no longer wear.
 */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

const FOOTER = "components/PostFooter.tsx"
const STYLE = "components/chipActStyle.ts"
const GLYPHS = "components/chipGlyphs.ts"

/**
 * The glyph size, read where it is DECLARED.
 *
 * It used to be a literal in chipActStyle.ts, and this file read it there.
 * It is not any more: the shadow-root card draws the same marks and cannot
 * import chipActStyle (that file pulls in MUI's `alpha`), so the number moved
 * to chipGlyphs.ts, which is MUI-free, and CHIP_ACT.icon re-exports it. Both
 * halves are asserted, because a second literal creeping back into
 * chipActStyle is exactly the panel/card drift this spec exists to catch.
 */
const glyphSize = (): number => {
  const m = /CHIP_GLYPH_SIZE\s*=\s*(\d+)/.exec(code(GLYPHS))
  expect(m, `${GLYPHS}: CHIP_GLYPH_SIZE is not declared as a number`).not.toBeNull()
  expect(
    code(STYLE),
    `${STYLE}: CHIP_ACT.icon must re-export CHIP_GLYPH_SIZE, not restate it`,
  ).toMatch(/icon:\s*CHIP_GLYPH_SIZE/)
  return Number(m![1])
}

/**
 * The row's two halves, as source text.
 *
 * `ml: "auto"` is the seam: it is the one declaration in the file that means
 * "everything after me is pushed to the right edge". The slice starts at
 * `return (` so the import list — which names every glyph in the file — is
 * not mistaken for the left group.
 */
const halves = () => {
  const file = code(FOOTER)
  const jsx = file.slice(file.indexOf("return ("))
  const seam = jsx.indexOf('ml: "auto"')
  expect(seam, `${FOOTER}: no 'ml: "auto"' — the row lost its right group`)
    .toBeGreaterThan(-1)
  return { left: jsx.slice(0, seam), right: jsx.slice(seam) }
}

/**
 * The gap BETWEEN the two doors, in px, read off the group that holds them.
 *
 * It is 0, and that is the fix rather than an oversight. Each door is a 24px
 * transparent hit body around a 13px glyph, so 5.5px of nothing already
 * stands either side of every mark; the 8px this group used to declare was
 * therefore drawing 19px of white space between two glyphs in a row whose
 * left-hand chips sit 8px apart. The owner reported exactly that
 * ("aralarindaki bosluklar anlamsiz"). At 0 the marks are 11px apart and the
 * hit areas are contiguous, so a press between them still lands on a control.
 */
const doorGap = (): number => {
  const { right } = halves()
  const m = /<Stack[^>]*sx=\{\{\s*gap:\s*(\d+(?:\.\d+)?)\s*\}\}/.exec(right)
  expect(m, `${FOOTER}: the doors' group declares no readable gap`).not.toBeNull()
  return Number(m![1])
}

/** The gap between the doors' group and the age, in px. */
const rightGap = (): number => {
  const { right } = halves()
  const m = /gap:\s*"(\d+(?:\.\d+)?)px"/.exec(right)
  expect(m, `${FOOTER}: the right group declares no readable gap`).not.toBeNull()
  return Number(m![1])
}

/** The body of a named object literal in chipActStyle.ts, brace-matched. */
const objectBody = (file: string, name: string): string => {
  const source = code(file)
  const open = new RegExp(`${name}\\s*=\\s*\\{`).exec(source)
  expect(open, `${file}: ${name} is not declared`).not.toBeNull()
  let depth = 1
  let i = open!.index + open![0].length
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++
    else if (source[i] === "}") depth--
    i++
  }
  expect(depth, `unbalanced object literal for ${name} in ${file}`).toBe(0)
  return source.slice(open!.index + open![0].length, i - 1)
}

/** The `"&:hover": { … }` body inside an already-extracted object body. */
const hoverBody = (body: string): string => {
  const open = /"&:hover[^"]*"\s*:\s*\{/.exec(body)
  expect(open, "the style declares no :hover").not.toBeNull()
  let depth = 1
  let i = open!.index + open![0].length
  while (i < body.length && depth > 0) {
    if (body[i] === "{") depth++
    else if (body[i] === "}") depth--
    i++
  }
  return body.slice(open!.index + open![0].length, i - 1)
}

/**
 * THE DOOR'S TARGET — the box a pointer can hit — in CSS px, read out of
 * what `chipActBareSx` declares.
 *
 * Deliberately technique-agnostic: the invariant is the SIZE, not the
 * property used to reach it. A `minWidth`/`minHeight` box and a symmetric
 * `padding` around the glyph are both counted, and whichever is larger wins,
 * exactly as the browser resolves it. A padding shape this reader cannot
 * measure fails the test rather than being read as zero — a target that
 * cannot be computed cannot be certified.
 */
const doorTarget = (): { w: number; h: number } => {
  const bare = objectBody(STYLE, "chipActBareSx")
  const icon = glyphSize()
  const one = (re: RegExp): number => {
    const m = re.exec(bare)
    return m ? Number(m[1]) : 0
  }
  let padY = 0
  let padX = 0
  for (const decl of bare.match(/\b(?:padding[A-Za-z]*|p[xytrbl]?)\s*:\s*[^,\n]+/g) ?? []) {
    const shorthand =
      /^padding:\s*(?:0|"(\d+(?:\.\d+)?)px(?: (\d+(?:\.\d+)?)px)?")$/.exec(decl.trim())
    expect(
      shorthand,
      `${STYLE}: chipActBareSx declares "${decl.trim()}", which this file ` +
        `cannot measure. Write the inset as \`padding: "<n>px"\`, or as a ` +
        `SYMMETRIC \`padding: "<n>px <n>px"\`, so the hit target below stays ` +
        `checkable. An asymmetric pair is the pill's own shape and is ` +
        `refused by "chipActBareSx draws no fill, no border and no pill ` +
        `inset".`,
    ).not.toBeNull()
    padY = Number(shorthand![1] ?? 0)
    padX = Number(shorthand![2] ?? shorthand![1] ?? 0)
  }
  const border = one(/border:\s*"?(\d+(?:\.\d+)?)/)
  return {
    w: Math.max(one(/minWidth:\s*"?(\d+(?:\.\d+)?)/), icon + 2 * padX + 2 * border),
    h: Math.max(one(/minHeight:\s*"?(\d+(?:\.\d+)?)/), icon + 2 * padY + 2 * border),
  }
}

describe("tip and share are doors, and they live on the right", () => {
  it("both render inside the right-hand group, beside the timestamp", () => {
    const { left, right } = halves()
    // The two glyphs are drawn after the seam...
    expect(right).toMatch(/GLYPH_TIP/)
    expect(right).toMatch(/GLYPH_SHARE/)
    // ...in the same group as the age, which is the "next to the timestamp"
    // half of the report.
    expect(right).toMatch(/compactAge\(created_at\)/)
    // ...and nowhere on the counting side. This is the assertion that fails
    // on the row as reported.
    expect(
      left,
      `${FOOTER}: the tip door is still in the LEFT group with the counters`,
    ).not.toMatch(/GLYPH_TIP/)
    expect(
      left,
      `${FOOTER}: the share door is still in the LEFT group with the counters`,
    ).not.toMatch(/GLYPH_SHARE/)
  })

  it("both are frameless: they take chipActBareSx, never the pill", () => {
    const { right } = halves()
    expect(right.match(/sx=\{chipActBareSx\}/g)?.length).toBe(2)
    expect(
      right,
      `${FOOTER}: a control on the right is still wearing the counters' pill`,
    ).not.toMatch(/chipActSx\(/)
  })

  it("chipActBareSx draws no fill, no border and no pill inset", () => {
    const bare = objectBody(STYLE, "chipActBareSx")
    // A `component="button"` arrives with a UA border and UA padding, so
    // "frameless" has to be declared, not assumed — hence a padding
    // declaration is REQUIRED here; what it says is measured below.
    expect(bare).toMatch(/backgroundColor:\s*"transparent"/)
    expect(bare).toMatch(/border:\s*0/)
    expect(bare).toMatch(/\bpadding\s*:/)
    // The pill's frame, in the two shapes it is written in this file: the
    // fill and border above, and the pill's own INSET here. That inset is
    // `4px 10px` (chipActSx) — ASYMMETRIC, sized to hold a number beside
    // the glyph, and that shape is what says "a count lives here". Neither
    // door holds one.
    expect(bare).not.toMatch(/1px solid/)
    // What is refused here is the ASYMMETRY, not the two-value form. A
    // symmetric inset paints nothing and reserves nothing for a count; the
    // 24x24 test below counts it as a hit body, and it is one of the two
    // shapes doorTarget's own failure message asks a maintainer to write.
    // Forbidding every two-value padding made those instructions contradict
    // — write the one and you failed the other.
    for (const [decl, y, x] of bare.matchAll(
      /padding:\s*"(\d+(?:\.\d+)?)px (\d+(?:\.\d+)?)px"/g,
    )) {
      expect(
        y === x,
        `${STYLE}: chipActBareSx wears \`${decl}\`. An asymmetric inset is ` +
          `the pill's shape, and a door has no count to hold. Make the two ` +
          `values equal, or give the glyph its body with minWidth/minHeight.`,
      ).toBe(true)
    }
  })

  /**
   * AND A BODY TO HIT. This assertion replaces one that forbade the fix.
   *
   * The line here used to be `expect(bare.match(/padding…/g)).toEqual(
   * ["padding: 0"])` — any padding declaration at all was a test failure —
   * justified by "a transparent pad would be an invisible frame: nothing
   * drawn, the pill's space still taken". That conflated two different
   * things. The pill's FRAME is its fill and its 1px border, both already
   * forbidden by the test above; the pill's INSET is `4px 10px`, forbidden
   * there too. A symmetric transparent inset (or a min box) around a bare
   * glyph draws neither: it reserves space for the CONTROL, which is a
   * thing the pointer can hit, where the "space reserved for something that
   * is not there" this pass removed elsewhere was an emptied element that
   * could not be hit at all and drew nothing.
   *
   * What the rule actually cost: with `padding: 0` and `border: 0`, each
   * door's border box collapsed onto the glyph itself — a square the size of
   * the art — on the control that opens the money dialog and on the panel's
   * only way out to a composer. WCAG 2.2 SC 2.5.8 asks for 24x24, and its
   * spacing exception does not rescue a glyph-sized target sitting a few
   * pixels from its neighbour.
   */
  it("each door is 24x24, the WCAG 2.2 SC 2.5.8 minimum", () => {
    const { w, h } = doorTarget()
    const fix =
      `Frameless is a paint instruction — no fill, no border, no pill ` +
      `inset — and it does not mean "no hit area". Give the glyph a body ` +
      `that draws nothing: a min box, or a symmetric transparent inset.`
    expect(w, `${STYLE}: a door is ${w}px wide. ${fix}`).toBeGreaterThanOrEqual(24)
    expect(h, `${STYLE}: a door is ${h}px tall. ${fix}`).toBeGreaterThanOrEqual(24)
    // A box is only a target AROUND the glyph if the glyph sits in it.
    const bare = objectBody(STYLE, "chipActBareSx")
    expect(bare).toMatch(/alignItems:\s*"center"/)
    expect(bare).toMatch(/justifyContent:\s*"center"/)
  })

  it("hovering a door repaints it; it never puts the frame back", () => {
    const hover = hoverBody(objectBody(STYLE, "chipActBareSx"))
    // Colour is the whole hover. A background or a border arriving under the
    // pointer is the frame the owner asked us to remove, showing up late.
    expect(hover).toMatch(/color:/)
    expect(hover).not.toMatch(/backgroundColor:/)
    expect(hover).not.toMatch(/border/)
    // Layout-moving properties are swept across this whole file by
    // post-row-stability.spec.ts; this is the frameless-specific half.
  })

  it("the counters keep their frame, and keep the left", () => {
    // The reported fix is a MOVE, not a strip: like and comment were never
    // the complaint and must not be quietly de-framed with the doors.
    const { left } = halves()
    expect(left).toMatch(/<UpvoteButton/)
    expect(left).toMatch(/sx=\{chipActSx\(showComments\)\}/)
    expect(code("components/UpvoteButton.tsx")).toMatch(/sx=\{chipActSx\(isUpvoted\)\}/)
  })

  it("moving the doors kept every behaviour that made them work", () => {
    const { right } = halves()
    // Same handler, same payload shape, same self-tip gate...
    expect(right).toMatch(/onTip\(\{/)
    expect(right).toMatch(/user\.id !== currentUser\.id/)
    // ...same short-link share, same labels for a screen reader, same press.
    expect(right).toMatch(/handleSharePlatform\("twitter"\)/)
    expect(right).toMatch(/aria-label=\{`Tip @\$\{user\.username\}`\}/)
    expect(right).toMatch(/aria-label="Share this post"/)
    expect(right.match(/className="click-animation"/g)?.length).toBe(2)
  })
})

/**
 * THE ROW FITS AT 320px, and this is arithmetic rather than opinion.
 *
 * The panel can be dragged to ~320px. The house already ruled on rows that
 * do not fit — components/profile/ProfileFeed.tsx:70-87, "THE ROW FITS; IT
 * DOES NOT SLIDE": a hidden scrollbar leaves a control off-screen with
 * nothing on screen to say it exists, so wrapping is the valve and hiding is
 * never the answer. Moving two controls across the row changed its width
 * profile, and giving those two a 24x24 hit body changed it again, so the
 * budget is computed here from the numbers the source actually declares, and
 * the guards below forbid the outlawed escape hatches.
 *
 * WHAT THE PREVIOUS REVISION OF THIS TEST CLAIMED, AND WHY IT WAS FALSE. It
 * charged both counters four characters, on the stated grounds that "four
 * characters is the widest either number gets ('1.2K' from
 * formatCompactNumber, '999d' from compactAge)". No part of that was true.
 * Only the LIKE chip went through formatCompactNumber (UpvoteButton.tsx:54);
 * the comment chip printed its count RAW, so five digits were reachable and
 * nothing capped them. formatCompactNumber lowercases
 * (utils/numberUtils.ts:1-4), so "1.2K" is a string it cannot produce — it
 * prints "1.2k". And compactAge caps nothing either: utils/dateUtils.ts:36
 * returns `${Math.floor(h / 24)}d`, which is five characters the day a post
 * turns 1000 days old. The row did still fit, so nothing was on fire — but a
 * fit test is worth exactly the truth of its inputs, and these were
 * invented.
 *
 * The count is now compacted on BOTH chips (PostFooter.tsx), and that is a
 * deliberate change rather than a side effect of this repair. A RAW integer
 * has no width bound at all, so any reserve for it would have been an
 * assumption about how many comments one page can collect. Compacted, the
 * string comes out of a formatter whose output set can be enumerated and
 * measured, which is what the reserve below does. The age has no such
 * formatter, so it is measured as the strings compactAge prints.
 */
describe("the action row fits the 320px panel", () => {
  const style = code(STYLE)
  const num = (re: RegExp, label: string): number => {
    const m = re.exec(style)
    expect(m, `${STYLE}: could not read ${label}`).not.toBeNull()
    return Number(m![1])
  }

  /** The `<PostFooter … />` call inside a caller, as source text. */
  const footerCall = (p: string): string => {
    const file = code(p)
    const open = file.indexOf("<PostFooter")
    expect(open, `${p}: renders no <PostFooter>`).toBeGreaterThan(-1)
    const close = file.indexOf("/>", open)
    expect(close, `${p}: its <PostFooter> never closes`).toBeGreaterThan(open)
    return file.slice(open, close)
  }

  /**
   * TEXT, MEASURED OUT OF THE FONT THE ROW ACTUALLY DRAWS.
   *
   * The panel renders PoppinSans, which helpers/brandFont.ts:32-41 loads out
   * of public/fonts: weight 400 is Poppins-Regular, weight 600 is
   * Poppins-SemiBold. The advances below are those files' own `hmtx` entries
   * (unitsPerEm 1000) times the declared font size. Poppins ships no `tnum`
   * feature, so the tabular figures the theme asks for
   * (helpers/themeHelper.ts:99) change none of them: the figures are
   * proportional — '1' is 0.362em where '4' is 0.661em — so an estimate has
   * to cover the widest glyph, not an average one.
   */

  // THE COUNT, at 11px/600. Both counters print through
  // formatCompactNumber (the premises test below pins that they still do),
  // so this is measured against that formatter's OUTPUT SET rather than
  // against a per-character rate. No per-character rate can bound the set:
  // 'm' alone is 1.048em = 11.53px, against 0.661em = 7.27px for the
  // widest of the ten digits, '4'.
  //
  // HOW THE SET WAS ENUMERATED, so the next reader can repeat it: Intl
  // compact notation, lowercased, over every integer 0-1999 and over
  // m x 10^(e-3) for m = 1000..9999, e = 3..14. That yields 5321 distinct
  // strings over the alphabet [0-9.kmbt]; re-running it ten times finer
  // (m = 10000..99999) yields the same 5321, which is the evidence that
  // the sample is the whole set for values under 1e15.
  //
  // Widest of those against Poppins-SemiBold's hmtx advances: "444m",
  // which formatCompactNumber prints from 443,500,000, at
  // 3 x 0.661em + 1.048em = 3.031em = 33.34px — 4.07px more than the
  // "444b" a previous revision of this line named as the worst
  // four-character string. Five characters is reachable ("1000t", from
  // 999.5e12) but narrower at 29.57px. From 1e16 the formatter starts
  // grouping ("10,000t"), which is outside the sample and outside what
  // this reserve certifies.
  const COUNT = 33.5 // "444m" at 33.34px, rounded up

  // THE AGE is not a number, so it is measured as strings at 10px/400.
  // compactAge's shapes, read off its six returns (utils/dateUtils.ts:
  // 27-37): "" for a missing or future timestamp, "now", "<1-59>m",
  // "<1-23>h", and "<n>d" with the day count uncapped. At Poppins-Regular's
  // advances the widest of the ten digits is '6' (0.635em = 6.35px), so
  // those five measure 0; "now" = 21.0px; 2 x 6.35 + 'm' (1.030em) =
  // 23.0px; 2 x 6.35 + 'h' (0.640em) = 19.1px; and at four day-digits
  // 4 x 6.35 + 'd' (0.676em) = 32.2px, i.e. 27 years of days. 33 clears
  // all five.
  //
  // Four day-digits is the BOUND certified here, not a cap in the code. A
  // fifth wants 38.5px — 5.5px more than reserved, which is more than the
  // margin a reply's row comes in under below, so it would need
  // re-deriving rather than absorbing.
  const AGE = 33

  it("both rows this footer draws fit the panel's content width", () => {
    const padX = Number(/padding:\s*"\d+px (\d+)px"/.exec(style)![1]) // 10
    const gap = num(/gap:\s*"(\d+)px"/, "the chip's gap") //  5
    const icon = glyphSize() // 13
    const borderW = num(/border:\s*`(\d+)px solid/, "the chip's border") //  1
    const door = doorTarget().w // 24

    // A framed counter at its widest: padding, borders, glyph, gap, count.
    const counter = 2 * padX + 2 * borderW + icon + gap + COUNT // 73.5
    const leftGroup = 2 * counter + 8 // spacing={1} between like and comment
    /**
     * …then straight to the age. This used to read `4 + 3 + 4 + AGE`: the
     * strip's 4px rhythm, a 3px separator dot, 4px more. The dot is gone —
     * the owner named it ("alttaki saatin solunda bir nokta var anlamsiz")
     * and it was a separator with nothing of its own kind to separate, an
     * icon pair on one side and a timestamp on the other. What is left is
     * one gap, read out of the group that declares it, so this number
     * follows the file instead of being retyped after it.
     */
    const toAge = rightGap() + AGE

    /**
     * TWO ROWS, WHICH ARE NOT ONE ROW.
     *
     * Post.tsx passes `onTip` and no `sx`: both doors, no indent.
     * Reply.tsx passes `marginLeft: "34px !important"` and NO `onTip`, and
     * the tip door is gated on `onTip &&` (PostFooter.tsx:264), so an
     * indented row draws one door. The previous revision charged a single
     * row for both doors AND the indent; that is not pessimism, it is a row
     * that never renders. Both premises are pinned in the next test.
     */
    const postRow = leftGroup + (door + doorGap() + door) + toAge // 239
    const replyRow = leftGroup + door + toAge + 34 // 249

    /**
     * What the row is drawn into at 320px: a 16px gutter each side — the
     * real ones are at most 10px and are 0 whenever their conditions are
     * false (views/comment.tsx:277 and :339), so 16 is deliberately
     * pessimistic — the card's 1px border and its 14px padding
     * (components/Post.tsx:349 and :356).
     */
    const content = 320 - 2 * 16 - 2 * 1 - 2 * 14 // 258

    for (const [row, width] of [
      ["a post's row", postRow],
      ["a reply's row", replyRow],
    ] as const) {
      expect(
        width,
        `${row} needs ${width}px inside ${content}px of panel. ` +
          `Something in the chip grew; shrink it or drop a control, because ` +
          `the alternatives (a scroller, a shrunk chip) hide it instead.`,
      ).toBeLessThanOrEqual(content)
    }
  })

  it("the premises that arithmetic rests on are still true", () => {
    const footer = code(FOOTER)
    // Both counters compact, which is what makes four characters a CAP and
    // not a guess about how many comments a page can collect.
    expect(code("components/UpvoteButton.tsx"))
      .toMatch(/formatCompactNumber\(data\.upvotes\)/)
    expect(footer).toMatch(/formatCompactNumber\(comment_count \|\| reply_count\)/)
    // The tip door exists only where a caller hands over onTip…
    expect(footer).toMatch(/onTip && currentUser/)
    // …the un-indented caller hands one over and asks for no indent…
    const post = footerCall("components/Post.tsx")
    expect(post, "Post.tsx no longer passes onTip").toMatch(/onTip=/)
    expect(post, "Post.tsx now indents the row; re-derive the fit").not.toMatch(/sx=/)
    // …and the indented one passes the 34px and no onTip at all.
    const reply = footerCall("components/Reply.tsx")
    expect(reply).toMatch(/marginLeft: "34px/)
    expect(
      reply,
      `a reply's row now draws BOTH doors as well as the 34px indent, which ` +
        `is the row the arithmetic above says does not exist. Re-derive it.`,
    ).not.toMatch(/onTip/)
    // The two gaps the arithmetic above spends are read out of the file by
    // doorGap() and rightGap(), so they cannot silently disagree with it.
    // What is asserted here is the thing arithmetic cannot see: that the
    // separator dot the row was charged for is really gone, and did not
    // come back as a different small round thing.
    const { right } = halves()
    expect(
      right,
      "a separator dot is back between the doors and the age. It parts an " +
        "icon pair from a timestamp, which are already told apart by being " +
        "an icon and a number, and it costs three widths to say nothing.",
    ).not.toMatch(/borderRadius:\s*"999px"[\s\S]{0,120}alpha\("#FFFFFF"/)
    expect(right).not.toMatch(/width:\s*"3px"/)
  })

  it("the row wraps rather than hiding a control, per the house ruling", () => {
    const footer = code(FOOTER)
    // The valve.
    expect(footer).toMatch(/flexWrap:\s*"wrap"/)
    // The three outlawed alternatives, verbatim from
    // components/profile/profile-filter-fit.spec.ts:50-66.
    expect(footer).not.toMatch(/overflowX:\s*"auto"/)
    expect(footer).not.toMatch(/scrollbar/i)
    expect(footer).not.toMatch(/flexShrink:\s*0/)
  })
})
