import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE SHELL'S ONE RULE, enforced instead of remembered.
 *
 * Layout renders a flex COLUMN at 100svh with overflow:hidden: a header, and
 * then the view. A view therefore gets whatever is left, and it has exactly
 * one honest way to ask for it — `flex: 1` with `minHeight: 0`.
 *
 * Two ways of guessing instead:
 *
 *   height: "100%"          measures the WHOLE column, header included, so
 *                           the view claims more room than exists, the shell
 *                           clips it, and the bottom rows are unreachable.
 *
 *   height: calc(100vh - N) is a promise that everything above will forever
 *                           add up to N. It never does. The feed's N was
 *                           tuned before the ActionBar row left and before
 *                           the trade card arrived; by then the column was
 *                           ~110px too tall and it pushed the HEADER off the
 *                           top — which takes every other screen with it,
 *                           because the header is how you reach them.
 *
 * This bug shipped five separate times — the profile, positions, the
 * leaderboard, settings, and the feed — each found by a person looking at a
 * screen rather than by anything in the repo. A grep is a blunt test, but it
 * is the one that would have caught all five before they left the machine.
 *
 * Content-script surfaces are exempt on purpose: that card is docked at a
 * size WE choose, so a fixed number there is a real constraint, not a guess.
 */

const VIEWS = join(__dirname)

function panelSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx$/.test(entry.name)) out.push({ file: p, text: readFileSync(p, "utf8") })
    }
  }
  walk(VIEWS)
  return out
}

/** Lines inside an `environment === "contentScript"` branch are exempt. */
function offendingLines(text: string, pattern: RegExp): string[] {
  return text
    .split("\n")
    .filter((l) => pattern.test(l))
    .filter((l) => !/contentScript/.test(l))
}

describe("the panel shell's one rule", () => {
  it("no view asks for a slice of the VIEWPORT", () => {
    const bad: string[] = []
    for (const { file, text } of panelSources()) {
      // Only flag it where it is actually applied, not where it is discussed.
      const lines = offendingLines(text, /(height|maxHeight|minHeight):\s*["'`]calc\(100[sd]?vh\s*-/)
      for (const l of lines) bad.push(`${file.split("/src/")[1]}: ${l.trim()}`)
    }
    expect(bad).toEqual([])
  })

  it("no view claims the WHOLE column as its own height", () => {
    const bad: string[] = []
    for (const { file, text } of panelSources()) {
      // `height: "100%"` is fine on an inner box whose parent has a real
      // height; it is only a lie on the element the router mounts. Flag the
      // shape that has burned us: it sitting next to an overflow rule.
      const lines = text
        .split("\n")
        .map((l, i) => ({ l, ctx: text.split("\n").slice(i, i + 4).join(" ") }))
        .filter(({ l, ctx }) => /height:\s*["']100%["']/.test(l) && /overflow/.test(ctx))
        .filter(({ ctx }) => !/contentScript/.test(ctx))
        .map(({ l }) => l)
      for (const l of lines) bad.push(`${file.split("/src/")[1]}: ${l.trim()}`)
    }
    expect(bad).toEqual([])
  })
})
