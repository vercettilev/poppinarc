import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * EVERY EVENT THE CHIP EMITS IS EITHER MAPPED OR DELIBERATELY DROPPED.
 *
 * The background translates the chip's own event names into the six funnel
 * types the backend enum carries, and anything it does not recognise is
 * discarded silently. That silence is the exact shape of the failure this
 * product already lived through once: track() was called from every control
 * on the chip for months while the background listened for nothing at all,
 * so no rate, no funnel and no claim about either was ever measurable.
 *
 * A new control added tomorrow will call track() with a new name, and the
 * failure will be a number that is quietly too low rather than an error.
 * This is the test that turns that into a red one: the list below is a
 * decision, and adding an event means making it.
 */

const SRC = join(__dirname, "..", "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/** Names the strip actually passes to track(). */
const emitted = new Set(
  [...read("entries/contentScript/x/xStrip.ts").matchAll(/\btrack\(\s*"([a-z0-9_]+)"/g)].map(
    (m) => m[1],
  ),
)

/** Names the background knows how to translate. */
const background = read("entries/background/main.ts")
const mapBody = background.slice(
  background.indexOf("const TELEMETRY_MAP"),
  background.indexOf("}", background.indexOf("const TELEMETRY_MAP")),
)
const mapped = new Set([...mapBody.matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((m) => m[1]))

/**
 * Events that are real and deliberately NOT funnel steps. Each one is here
 * because the enum has no honest home for it, not because nobody looked.
 */
const DELIBERATELY_UNMAPPED = new Set<string>([
  // A route taken while funding, not a step toward a trade.
  "x_fund_route",
])

describe("the telemetry map's coverage", () => {
  it("found the chip's events and the background's map", () => {
    // A rename that empties either side would otherwise turn this whole file
    // into a green no-op, which is the failure it exists to catch.
    expect(emitted.size).toBeGreaterThan(10)
    expect(mapped.size).toBeGreaterThan(5)
  })

  it("maps the impression, which is the funnel's own first countable step", () => {
    expect(mapped.has("x_strip_shown")).toBe(true)
    expect(mapped.has("x_page_scanned")).toBe(true)
  })

  it("leaves no event the chip emits silently on the floor", () => {
    const lost = [...emitted].filter(
      (e) => !mapped.has(e) && !DELIBERATELY_UNMAPPED.has(e),
    )
    expect(
      lost,
      `these reach the background and are discarded without a word: ${lost.join(", ")}. ` +
        "Map them, or add them to DELIBERATELY_UNMAPPED with the reason.",
    ).toEqual([])
  })

  it("keeps the deliberate list honest", () => {
    // An entry here that nothing emits any more is a decision nobody is
    // making, and it hides the next real one.
    const stale = [...DELIBERATELY_UNMAPPED].filter(
      (e) => !emitted.has(e) && !read("entries/contentScript/primary/main.tsx").includes(`"${e}"`),
    )
    expect(stale).toEqual([])
  })
})
