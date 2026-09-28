/** @jsxImportSource preact */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { render } from "preact"
import { act } from "preact/test-utils"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CardChart } from "./CardChart"

const src = (f: string) =>
  readFileSync(join(__dirname, f), "utf8")

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the enlarged chart escapes the card, by construction", () => {
  it("renders the overlay as a SIBLING of .wrap, never a child", () => {
    // .wrap is position:fixed WITH transform: translateY(-50%), which makes
    // it the containing block for any fixed descendant. An overlay nested
    // inside would be "fullscreen" relative to a 344px card. This is not
    // visible in a jsdom test, so the structure is what gets pinned.
    const s = src("SpotCard.tsx")
    const wrapEnd = s.indexOf("     </div>\n    </div>\n    {chartBig")
    expect(wrapEnd).toBeGreaterThan(-1)
    // The scrim must appear AFTER .wrap's closing tags and before </>.
    const scrim = s.indexOf('className="cc-scrim"')
    expect(scrim).toBeGreaterThan(wrapEnd)
  })

  it("keeps the scrim out of the transformed subtree in CSS too", () => {
    const css = stripComments(src("style.ts"))
    // Position fixed, and NOT scoped under .wrap — a `.wrap .cc-scrim`
    // selector would mean somebody moved it back inside.
    expect(css).toMatch(/\.cc-scrim\s*\{[^}]*position:\s*fixed/)
    expect(css).not.toMatch(/\.wrap\s+\.cc-scrim/)
  })

  it("gives the enlarged plot touch-action: none", () => {
    // Without it a scrub drag scrolls the page under the overlay instead
    // of moving the crosshair.
    const css = stripComments(src("style.ts"))
    expect(css).toMatch(/\.cc-big-plot\s*\{[^}]*touch-action:\s*none/)
  })
})

describe("one chart, two sizes", () => {
  // jsdom has no requestAnimationFrame, so preact/hooks falls back to a
  // 100ms timer for effects. Same scoped shim the sibling spec uses, and
  // restored after: a leaked global re-times every other spec in the worker.
  const origRAF = globalThis.requestAnimationFrame
  beforeAll(() => {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number
  })
  afterAll(() => {
    globalThis.requestAnimationFrame = origRAF
  })
  const tick = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  const mount = (big: boolean) => {
    const root = document.createElement("div")
    document.body.appendChild(root)
    render(
      <CardChart
        big={big}
        mint="M"
        marketUsd={1}
        avgEntryUsd={null}
        held={false}
        onSeries={async () => ({
          points: [1, 2, 3, 4, 5, 6, 7, 8],
          times: null,
          opens: null,
          highs: null,
          lows: null,
          failed: false,
        })}
      />,
      root,
    )
    return root
  }

  it("draws the same chart at a bigger viewBox rather than a second one", async () => {
    // The geometry is chartMath either way; only the frame differs. If this
    // ever needs a separate component, that is the third copy of this
    // drawing and the reason to stop.
    const small = mount(false)
    const big = mount(true)
    await tick()
    await tick()
    const vb = (root: Element) =>
      root.querySelector("svg")?.getAttribute("viewBox")
    expect(vb(small)).toBe("0 0 308 108")
    expect(vb(big)).toBe("0 0 720 380")
  })

  it("shows the readout only when enlarged", async () => {
    const small = mount(false)
    const big = mount(true)
    await tick()
    await tick()
    expect(small.querySelector(".cc-read")).toBeNull()
    expect(big.querySelector(".cc-read")).not.toBeNull()
    // Nothing is being touched yet, so the head reads now, not index 0.
    expect(big.querySelector(".cc-read-t")?.textContent).toBe("now")
  })
})
