import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * NO RULE MAY BE OVERRIDDEN BY ITS OWN TWIN.
 *
 * Three bugs in one session came from the same shape: a selector declared
 * twice in one stylesheet, the later copy winning, and the earlier one left
 * behind with a comment that described what the LATER one does. That is
 * worse than dead code — it is dead code that explains the live code
 * incorrectly, so the next reader trusts the wrong half.
 *
 *   .buy:hover / .sell:hover  kept the old direction colours after the
 *                             keys went brand, and repainted them on touch
 *   .view                     had a fill in one copy and none in the other;
 *                             the comment above the losing copy described
 *                             the winner
 *   .more:hover               two different backgrounds, one never seen
 *
 * A duplicate inside @media is NOT this: that is an override, which is what
 * media queries are for. Only same-context twins that disagree count.
 */
const FILES = [
  ["chip", "../entries/contentScript/x/xStrip.ts"],
  ["card", "../components/SpotCard/style.ts"],
] as const

/**
 * The character ranges covered by an at-rule (@media, @supports, …).
 * Everything inside one is an override BY DESIGN, so those rules are not
 * twins of the top-level ones. Brace matching skips `${...}`, because the
 * first brace after `.place {` belongs to an interpolation and a naive
 * scan ends the block in the wrong place.
 */
function atRuleRanges(css: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const m of css.matchAll(/@[a-z-]+[^{;]*\{/g)) {
    let depth = 1
    let i = m.index! + m[0].length
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "$" && css[i + 1] === "{") {
        i = css.indexOf("}", i)
        continue
      }
      if (css[i] === "{") depth += 1
      else if (css[i] === "}") depth -= 1
    }
    out.push([m.index!, i])
  }
  return out
}

/** Rules NOT inside an at-rule, with their declarations. */
function topLevelRules(css: string): Array<{ sel: string; props: Map<string, string>; line: number }> {
  const skip = atRuleRanges(css)
  const inside = (at: number) => skip.some(([a, b]) => at >= a && at < b)
  const out: Array<{ sel: string; props: Map<string, string>; line: number }> = []
  for (let i = css.indexOf("{"); i > -1; i = css.indexOf("{", i + 1)) {
    if (inside(i)) continue
    const lineStart = css.lastIndexOf("\n", i) + 1
    const sel = css.slice(lineStart, i).trim()
    if (!sel.startsWith(".") && !sel.startsWith("[")) continue
    let j = i + 1
    for (; j < css.length; j++) {
      if (css[j] === "$" && css[j + 1] === "{") {
        j = css.indexOf("}", j)
        continue
      }
      if (css[j] === "}" || css[j] === "{") break
    }
    if (css[j] !== "}") continue
    const props = new Map<string, string>()
    for (const m of css.slice(i + 1, j).matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
      props.set(m[1], m[2].split(/\s+/).join(" "))
    }
    out.push({ sel, props, line: css.slice(0, i).split("\n").length })
  }
  return out
}

describe("no rule is silently overridden by its own twin", () => {
  for (const [name, rel] of FILES) {
    it(`${name}: every duplicated selector agrees with itself`, () => {
      const css = readFileSync(join(__dirname, rel), "utf8")
      const rules = topLevelRules(css)
      expect(rules.length, `${name}: parsed no rules, so this proves nothing`).toBeGreaterThan(50)

      const bySel = new Map<string, typeof rules>()
      for (const r of rules) {
        const list = bySel.get(r.sel) ?? []
        list.push(r)
        bySel.set(r.sel, list)
      }
      const clashes: string[] = []
      for (const [sel, list] of bySel) {
        for (let a = 0; a < list.length; a++) {
          for (let b = a + 1; b < list.length; b++) {
            for (const [k, v] of list[a].props) {
              const other = list[b].props.get(k)
              if (other !== undefined && other !== v) {
                clashes.push(
                  `${sel} (L${list[a].line} vs L${list[b].line}) disagrees on ${k}: "${v}" then "${other}"`,
                )
              }
            }
          }
        }
      }
      expect(clashes, clashes.join("\n")).toEqual([])
    })
  }
})
