import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A HEADER LABEL IS A PILL ON THE GROUND, NOT A HOLE IN IT.
 *
 * HeaderPill exists so every "where am I" chip in the panel wears one
 * surface: JUICE.well over a JUICE.border hairline. It also takes a `bg`
 * override, and the feed's "Global Feed" pill used it to paint solid #000.
 * That was defensible once — the panel canvas really was #000 and a black
 * pill read as stitched into the page. The canvas has been BRAND_GROUND for
 * a while now (a blue-cast near-black under two accent auroras,
 * helpers/brandGround.ts), so an opaque fill on it reads as a hole punched
 * in a lit room. It shipped that way for months because nothing said
 * otherwise, and the file even carried a dead styled() whose comment still
 * called the canvas #000.
 *
 * `bg` is HeaderPill's own prop name and nothing else in src uses it, so a
 * sweep for an opaque hex on any `bg=` is, in practice, the HeaderPill
 * sweep. Comments are stripped first — the call sites that were fixed had to
 * KEEP the old value in prose to explain why it went.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * Source with comments removed. The house comment style quotes the code it
 * replaced, so a naive grep would keep finding the defect in the paragraph
 * explaining the fix. The `[^:]` guard keeps `https://` and `chrome://` out
 * of the line-comment rule.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function tsxFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith(".tsx")) out.push(p)
    }
  }
  walk(SRC)
  return out
}

/**
 * THERE IS NO ALLOWLIST HERE, AND THERE WAS NO REASON FOR THE ONE THERE WAS.
 *
 * The first version of this spec skipped `views/tasks.tsx` and explained the
 * skip by saying the file "belongs to another agent in this working tree".
 * That was not true — nothing was editing it — and the shape of the mistake
 * matters more than the fact: the one file the sweep would have caught was
 * the one file the sweep was told to skip, so the headline assertion below
 * went green by excluding its only counter-example while its sentence ("no
 * call site paints a header pill an opaque colour") still read as a claim
 * about the whole tree. A green suite that says something false is worse than
 * a red one that says something true.
 *
 * The Tasks pill has since dropped its `bg="#000"` (views/tasks.tsx), so the
 * sweep passes on the whole tree. If a future call site needs an opaque fill,
 * the answer is a named token in theme/juice.ts and a widened rule here — not
 * a file name on a skip list.
 */

describe("header pills wear the system's surface", () => {
  it("no call site paints a header pill an opaque colour", () => {
    const offenders: string[] = []
    for (const file of tsxFiles()) {
      const rel = file.slice(SRC.length + 1).split("\\").join("/")
      const code = stripComments(readFileSync(file, "utf8"))
      for (const m of code.matchAll(/\bbg=\{?\s*["'#][^"'}\n]*/g)) {
        if (/#[0-9a-fA-F]{3,8}/.test(m[0])) offenders.push(`${rel}: ${m[0]}`)
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([])
  })

  it("names the pill that carried the defect, so a regression is legible", () => {
    // The sweep above is the real guard; these two are the reported ones, and
    // a diff that reintroduces either should fail with the screen's name on
    // it rather than with a path in a list of offenders.
    expect(stripComments(read("components/ActionBar.tsx"))).not.toMatch(/\bbg=/)
  })

  it("the trim survived, and only ever went downward", () => {
    const pill = stripComments(read("components/HeaderPill.tsx"))
    // The owner's instruction was "çok az üstten alttan eşit şekilde" — a
    // little smaller, symmetrically. 3px is that trim against the 4px this
    // component used to default to.
    expect(pill).toMatch(/paddingY: "3px"/)
    // A later "let's make these consistent" pass must not silently regrow
    // the thing that was asked to shrink.
    expect(pill).not.toMatch(/paddingY: "(?:[4-9]|\d{2,})px"/)
    // And the feed's pill must not have gone back to overriding the fill.
    expect(stripComments(read("components/ActionBar.tsx"))).not.toMatch(/bg=/)
  })

  /**
   * THE TRIM DID NOT STAY LOCAL, AND THAT IS THE CORRECTION.
   *
   * There were two tests here. One read `paddingY: "3px"` out of ActionBar;
   * the other asserted HeaderPill still defaulted to 4px, on the reasoning
   * that "the feed pill deviates by 1px per side on purpose; the shared
   * default must not". Held together, they pinned a state where the shared
   * contract was a height NOTHING on screen wore: the feed's label was 26px,
   * the Tasks label 30px (its bell was a 20px box inside an 18px line box),
   * and PageInfoBar — then the only pill still taking the default — 28px.
   * (PageInfoBar has since been deleted; nothing in src imported it.) Both
   * rendered pills also overrode the sides to 13px, so the default was the
   * odd one out there too.
   *
   * The owner reported it from the outside as part of the site-label pass:
   * "eksiklik varsa diğer ekranlarla eşleşmeyen onları da düzelt". The trim
   * and the 13px both moved into HeaderPill and every override was deleted,
   * which is why the assertion above now reads the component instead of the
   * call site, and why the second test is gone rather than inverted — "one
   * height everywhere" is asserted properly, with the sweep that finds new
   * call sites, in components/header-pill-one-height.spec.ts.
   */
})
