import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { BRAND_GROUND } from "~/helpers/brandGround"

/**
 * THE PANEL'S GROUND HAS TO REACH THE PANEL'S EDGES.
 *
 * Reported as "the background does not cover the whole surface — a different
 * colour shows top, bottom, left and right".
 *
 * ── WHAT ACTUALLY CUTS THE CORNERS ──────────────────────────────────────────
 * TWO nested Papers wrap every screen, and BOTH of them used to round:
 *
 *   entries/popup/App.tsx   <Paper className="popup-app">  overflow: hidden
 *     components/Layout.tsx   styled(Paper) shell           100% x 100svh
 *
 * The radius is right for the injected in-page widget, which floats over a
 * host site and must read as a detached card. In the Chrome side panel these
 * Papers ARE the viewport, so a radius bites four notches out of the ground.
 *
 * The first repair squared only the inner shell — and changed nothing the
 * reader could see, because a parent that hides its overflow clips every
 * descendant to ITS radius. The notches were never the shell's; they were the
 * outer Paper's. Both gates are asserted here, and they are asserted together,
 * because fixing either one alone is indistinguishable from fixing neither.
 *
 * ── AND WHAT SHOWED THROUGH THE NOTCHES ─────────────────────────────────────
 * The panel document's own canvas (entries/side_panel/index.html). With the
 * notches gone it is covered edge to edge and can no longer show at all, so
 * its colour is now a first-frame value only: it has to look like the ground
 * that is about to replace it. That is the top of the sweep — the 0% stop of
 * BRAND_GROUND's linear-gradient — NOT BRAND_GROUND.backgroundColor, which is
 * a layer underneath an opaque gradient and is painted nowhere visible.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * Comments out. The rules this file guards are explained in prose directly
 * above the code that implements them, and that prose names the declarations
 * it replaced — so an un-stripped count of `borderRadius` counts the
 * explanation as if it were a rule.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * Only the shell's styled(Paper) block. Layout also renders dialogs further
 * down with their own legitimate 18px radii; a whole-file grep would catch
 * those and prove nothing.
 */
function shellBlock(): string {
  const text = read("components/Layout.tsx")
  const start = text.indexOf("const StyledPaper")
  const end = text.indexOf("export default function Layout")
  expect(start, "StyledPaper block not found in Layout.tsx").toBeGreaterThan(-1)
  expect(end, "Layout component not found after StyledPaper").toBeGreaterThan(start)
  return stripComments(text.slice(start, end))
}

/**
 * Only the outer Paper's props — from its className to the first child it
 * renders. App.tsx is otherwise full of dialogs, and those are allowed to be
 * round.
 */
function outerPaperBlock(): string {
  const text = read("entries/popup/App.tsx")
  const start = text.indexOf('className="popup-app"')
  const end = text.indexOf("<Fragment>", start)
  expect(start, 'popup-app Paper not found in App.tsx').toBeGreaterThan(-1)
  expect(end, "no children found after the popup-app Paper").toBeGreaterThan(start)
  return stripComments(text.slice(start, end))
}

describe("the panel frame", () => {
  it("the shell's corner is a decision about the surface, never a constant", () => {
    const shell = shellBlock()
    // Rounded for the widget, square for the window — one gate, both rules.
    expect(shell).toMatch(/environment === "sidepanel"/)
    expect(shell).toMatch(/borderRadius: 0/)
    expect(shell).toMatch(/borderRadius: "18px"/)
    // Exactly two: the panel's zero and the widget's 18px. A third would
    // mean somebody re-added an ungated one alongside the gate.
    expect(shell.match(/borderRadius/g) ?? []).toHaveLength(2)
    // ZERO, NOT ABSENT. Deleting the declaration hands the corner to the
    // theme's MuiPaper default (16px, helpers/themeHelper.ts) — the same
    // defect, 2px smaller.
    expect(shell).not.toMatch(/borderRadius:\s*(?:undefined|"none")/)
  })

  it("the Paper that does the clipping squares off in the panel too", () => {
    const outer = outerPaperBlock()
    // This block is the reason the shell's gate is not enough on its own:
    // it hides its overflow, and a rounded box that hides its overflow clips
    // its descendants to its own corner regardless of what they ask for.
    expect(outer).toMatch(/overflow:\s*"hidden"/)
    // One gated declaration, and only one. An ungated `borderRadius: "18px"`
    // anywhere in these props re-rounds the window.
    expect(outer).toMatch(/borderRadius:\s*environment === "sidepanel" \? 0 : "18px"/)
    expect(outer.match(/borderRadius/g) ?? []).toHaveLength(1)
  })

  it("the panel document's canvas is the colour the reader is about to see", () => {
    // The 0% stop of the ground's opaque sweep — the top of the panel, which
    // is where the eye lands when it opens. Read out of brandGround.ts rather
    // than retyped, so index.html cannot drift away from the ground.
    const sweepStart = BRAND_GROUND.backgroundImage.match(
      /linear-gradient\([^)]*?(#[0-9a-f]{3,8})\s+0%/i,
    )?.[1]
    expect(sweepStart, "no 0% stop found in BRAND_GROUND's linear-gradient").toBeTruthy()

    const html = read("entries/side_panel/index.html")
    const declared = [...html.matchAll(/background-color:\s*([^;"'\s]+)/gi)].map(
      (m) => m[1].toLowerCase(),
    )
    // html and body both, so no fractional-DPR rounding can expose a strip
    // of a colour the panel never paints.
    expect(declared.length).toBeGreaterThanOrEqual(2)
    for (const colour of declared) {
      expect(colour).toBe(sweepStart!.toLowerCase())
    }
  })
})
