import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE BELL RINGS ON ARRIVAL AND AT NO OTHER TIME.
 *
 * The gesture exists to be caught in peripheral vision while somebody is
 * reading a stranger's tweet, so it is deliberately large. That makes the
 * "only once, only on arrival" rule load-bearing rather than tasteful: a
 * bell this loud firing on a timer, or on scroll-in for week-old alerts,
 * is the orbiting attention-grab this product removed once already.
 *
 * Two things keep it honest, and both are one line from being lost:
 * `grew` (unread went UP, not merely is non-zero) and the seed that sets
 * unreadSpoken without ringing.
 */
const code = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

describe("the arrival gesture", () => {
  it("fires on growth, never on a non-zero count", () => {
    expect(code).toMatch(/const grew = unreadNow > unreadSpoken/)
    // `if (grew` and not `if (unreadNow > 0` for the animation itself.
    expect(code).toMatch(/if \(grew && svg\)/)
  })

  it("seeds without ringing, so scroll-in is silent", () => {
    // Mount reads existing alerts; those predate the reader's attention.
    expect(code).toMatch(/unreadSpoken = unreadNow/)
  })

  it("restarts the animation with a reflow between remove and add", () => {
    // Same class re-added in one frame never replays. Both the bell and
    // the ring need it.
    const idx = code.indexOf("svg.classList.add(\"swing\")")
    expect(idx).toBeGreaterThan(-1)
    expect(code.slice(idx - 260, idx)).toContain("void b.offsetWidth")
  })

  it("keeps the shake off the transform channel of the button", () => {
    // The button's transform belongs to the press system; an animation
    // there replaces the press mid-gesture. The swing rides the SVG and
    // the pulse rides box-shadow.
    expect(code).toMatch(/\.ring svg\.swing \{ animation: bellSwing/)
    expect(code).toMatch(/@keyframes ringPulse[\s\S]{0,320}box-shadow/)
    const pulse = code.slice(code.indexOf("@keyframes ringPulse"))
      .slice(0, 320)
    expect(pulse).not.toContain("transform")
  })
})

describe("both directions stay on the row", () => {
  it("never hides the sell key", () => {
    // An absent Sell reads as "this product cannot sell", not as "you hold
    // none of this". Owner's call, and it outranks the tidiness argument.
    expect(code).not.toMatch(/\.sell\[hidden\]/)
    expect(code).not.toMatch(/key\.hidden\s*=\s*bookAnswered/)
  })
})
