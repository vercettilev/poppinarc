import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * PRESSING FOLLOW DOES NOT RE-MEASURE THE ROW.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The extended FollowButton is `width: "auto"`, so its label is what measures
 * it. The label swapped "Follow" → "Following" on press, and "Following" is
 * the wider word, so the button grew mid-press. Its wrapper is `flexShrink: 0`
 * and the only extended call site (components/FollowerItem.tsx) puts it beside
 * an identity column that is `minWidth: 0, flex: 1` with an ellipsised name —
 * so the extra width comes out of the person's name. Press Follow, and the
 * name you pressed next to gets shorter.
 *
 * ── WHY NOT A minWidth FLOOR ────────────────────────────────────────────────
 * Because nobody in this repo can measure one. A floor below the natural width
 * of "Following" fixes nothing; a floor above it pads every row that says
 * "Follow". Getting it right needs a real layout engine at the real font — and
 * jsdom has none, so a unit test could not tell a correct floor from a guess
 * either.
 *
 * ── THE SHAPE THAT NEEDS NO NUMBER ──────────────────────────────────────────
 * Put both words in ONE grid cell. The track is sized by the WIDER of them,
 * measured once by the browser at the real font, and the press only changes
 * which text is painted in it. No pixel is written down, so no pixel can be
 * wrong. components/FillCelebration.tsx does the same for its Undo/Removed
 * label.
 *
 * The hidden twin here is a constant "Following" rather than a second toggled
 * word, for two reasons. "Following" is the wider word, so it alone is enough
 * to hold the box at its final size in both states; and it leaves the visible
 * label as the single `isFollowing ? "Following" : "Follow"` expression that
 * follower-row-identity.spec.ts already pins as the row's readable state.
 *
 * `visibility: hidden` and not a conditional: a hidden box still occupies its
 * cell. Unmounting the twin gives the width straight back.
 *
 * ── WHY A SOURCE GUARD ──────────────────────────────────────────────────────
 * The defect IS a width, and jsdom reports every width as 0. Rendering this
 * button in a test would pass with the bug in place. What is checkable is that
 * the measurement-free shape is still the one in the file.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * Comments out. The rules below are explained in prose directly above the code
 * that implements them, and that prose quotes the shape it replaced — so a raw
 * grep counts the explanation as if it were the rule.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

const BUTTON = code("components/FollowButton.tsx")

/** Only the extended branch. The 24px icon-only branch below it is pinned to a
 *  fixed width already and has no label to measure. */
const EXTENDED = BUTTON.slice(
  BUTTON.indexOf("{isExtended ? ("),
  BUTTON.indexOf(": isPending ? ("),
)

describe("the extended Follow button is sized by its wider word", () => {
  it("the wider word is in the cell whatever the state", () => {
    // Two "Following" in the extended branch: the constant sizer, and the
    // live label's own ternary. One of them means the sizer is gone and the
    // button measures whichever word is current.
    expect(
      (EXTENDED.match(/Following/g) ?? []).length,
      "the constant sizer word is gone — the button measures the live label " +
        "again, so pressing Follow widens it",
    ).toBeGreaterThanOrEqual(2)
    expect(EXTENDED).toMatch(/isFollowing \? "Following" : "Follow"/)
  })

  it("both words share one grid cell", () => {
    expect(EXTENDED, "the label wrapper is no longer a one-cell grid").toMatch(
      /display:\s*"inline-grid"/,
    )
    expect(EXTENDED, "the two words no longer overlap in the same track").toMatch(
      /gridArea:\s*"1 \/ 1"/,
    )
  })

  it("the sizer keeps its space and stays out of the accessible name", () => {
    // Hidden, not unmounted, not `display: none` — all three of those hand
    // the width back. aria-hidden so the button announces one name.
    expect(EXTENDED).toMatch(
      /<span aria-hidden="true" style=\{\{ visibility: "hidden" \}\}>/,
    )
    expect(EXTENDED, "the sizer is being unmounted instead of hidden").not.toMatch(
      /display:\s*"none"/,
    )
  })

  it("nothing writes a pixel floor instead", () => {
    // A minWidth here would be a guess: see the header. If a future reader
    // needs one, the grid has stopped working and that is the thing to fix.
    expect(BUTTON, "a guessed minWidth is back on the Follow button").not.toMatch(
      /minWidth/,
    )
  })
})
