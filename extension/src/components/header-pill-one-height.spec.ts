import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * EVERY HEADER LABEL IS THE SAME HEIGHT, OR THE LABEL JUMPS WHEN YOU CHANGE
 * SCREENS.
 *
 * That is HeaderPill's whole reason to exist — its own header says so: "the
 * header always sits at the same y-coordinate as you switch tabs". It was not
 * true. The component defaulted to 10px of side padding and 4px top and
 * bottom, and then:
 *
 *   the feed's label  overrode to 13px sides and trimmed to 3px  -> 26px tall
 *   the Tasks label   overrode to 13px sides, kept 4px           -> 30px tall
 *                     (its bell was a 20px box in an 18px line box)
 *   PageInfoBar       took the default                           -> 28px tall
 *                     (deleted since — it had no importer in src)
 *
 * Three pills, three heights, and the shared contract was the one shape none
 * of them wore. The owner reported it from the outside — "eksiklik varsa
 * diger ekranlarla eslesmeyen onlari da duzelt" (if anything does not match
 * the other screens, fix that too).
 *
 * The fix was to move what the call sites already agreed on (13px sides) and
 * the owner's trim (3px) into the default, and delete the overrides. This
 * spec is what stops the next call site reopening the drift, because the
 * override door is how it got in — not copy-paste.
 *
 * WHY SOURCE GUARDS: jsdom has no cascade and no layout, so it cannot be
 * asked what a pill measures. What can be pinned is the declaration, and the
 * declaration is where the drift was written.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/** Source with comments removed — this repo explains fixes by quoting what
 *  they replaced, so a naive sweep finds the defect in the paragraph about
 *  its removal. The `[^:]` guard keeps `https://` out of the line rule. */
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const PILL = "components/HeaderPill.tsx"

/** A number declared in HeaderPill's own sx, in px. */
const canonical = (prop: string): number => {
  const m = new RegExp(`${prop}:\\s*"(\\d+(?:\\.\\d+)?)px"`).exec(strip(read(PILL)))
  expect(m, `${PILL}: ${prop} is not declared as a px literal`).not.toBeNull()
  return Number(m![1])
}

describe("the header label has one shape, and it lives in one file", () => {
  it("declares its padding and line box as numbers, not as taste", () => {
    expect(canonical("paddingLeft")).toBe(13)
    expect(canonical("paddingRight")).toBe(13)
    expect(canonical("paddingY")).toBe(3)
    const pill = strip(read(PILL))
    expect(pill, `${PILL}: the pill's height comes from its line box`).toMatch(
      /fontSize:\s*"12px"/,
    )
    expect(pill).toMatch(/lineHeight:\s*1\.5/)
  })

  it("adds up to the 26px every screen is supposed to share", () => {
    // 1px border + 3 + the 18px line box + 3 + 1px border.
    const border = Number(/border:\s*`(\d+)px solid/.exec(strip(read(PILL)))![1])
    const lineBox = 12 * 1.5
    expect(2 * border + 2 * canonical("paddingY") + lineBox).toBe(26)
  })
})

/**
 * Every file that renders a header label, and what it is allowed to say about
 * it. `styled(HeaderPill)` counts: the Tasks label reached the drift that way
 * rather than through an sx prop.
 */
function pillCallSites(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (entry.name.includes(".spec.")) continue
      const rel = p.slice(SRC.length + 1).split("\\").join("/")
      if (rel === PILL) continue
      const code = strip(readFileSync(p, "utf8"))
      if (/<HeaderPill\b|styled\(HeaderPill\)/.test(code)) out.push([rel, code])
    }
  }
  walk(SRC)
  return out
}

describe("no call site re-opens the drift", () => {
  it("finds the call sites at all", () => {
    // A sweep that matches nothing passes vacuously, which is how the last
    // header-pill spec in this repo went green while being false. The bound
    // was >1 while Tasks was the second call site; that screen is retired,
    // and one real site is still enough to prove the sweep can see.
    const sites = pillCallSites().map(([rel]) => rel)
    expect(sites.length, "no HeaderPill call site found — the sweep is blind").toBeGreaterThan(0)
    expect(sites).toContain("components/ActionBar.tsx")
  })

  it("none of them sets its own padding or height", () => {
    const offenders: string[] = []
    for (const [rel, code] of pillCallSites()) {
      // Only look inside the pill's own declaration: these files hold other
      // boxes with perfectly legitimate padding of their own.
      for (const m of code.matchAll(/(?:<HeaderPill\b|styled\(HeaderPill\))[\s\S]{0,900}/g)) {
        const block = m[0]
        // Scope to the PILL'S OWN declaration. Two things sit deliberately
        // outside it: a padded Box rendered as a CHILD, and a nested `"& …"`
        // selector, which styles a descendant rather than the pill. The Tasks
        // bell is the second kind — and it is checked further down against
        // the line box, which is the rule that actually applies to a child.
        const own = /styled\(HeaderPill\)/.test(block)
          ? block.slice(0, block.indexOf("}))"))
          : block.slice(0, block.indexOf(">") + 1 || block.length)
        const scope = own.replace(/"&[^"]*":\s*\{[\s\S]*?\}/g, "")
        for (const bad of scope.matchAll(
          /\b(padding[A-Za-z]*|p[xytrbl]|height|minHeight|lineHeight)\s*:/g,
        )) {
          offenders.push(`${rel}: ${bad[1]} on the pill itself`)
        }
      }
    }
    expect(
      offenders,
      "A header label that sets its own padding or height is a screen that " +
        "disagrees with the others about where the label sits. Change " +
        `${PILL} instead — the value becomes everyone's.\n` +
        offenders.join("\n"),
    ).toEqual([])
  })

  it("none of them sets a width floor either", () => {
    // 183px, on the two pills that had it. The owner overruled it: a label
    // box should be only as wide as it needs.
    const offenders = pillCallSites()
      .filter(([, code]) =>
        /(?:<HeaderPill\b|styled\(HeaderPill\))[\s\S]{0,400}?minWidth:\s*"\d/.test(code),
      )
      .map(([rel]) => rel)
    expect(offenders, offenders.join("\n")).toEqual([])
  })
})

describe("nothing inside a label out-grows its line box", () => {
  /**
   * THE TASKS BELL CASE RETIRED WITH ITS SCREEN. It was the reported one:
   * a 20px icon frame setting a pill's height inside an 18px line box. The
   * sweep below still covers every present and future call site, which is
   * what actually kept the defect out.
   */
  it("the feed's site mark does too", () => {
    const m = /size\s*=\s*(\d+)/.exec(strip(read(PILL)))
    expect(m, `${PILL}: HeaderPillFavicon declares no default size`).not.toBeNull()
    expect(Number(m![1])).toBeLessThanOrEqual(18)
  })
})
