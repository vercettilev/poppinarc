/** @jsxImportSource preact */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { render } from "preact"
import { act } from "preact/test-utils"
import { CardChart } from "./CardChart"
import type { SeriesAnswer } from "~/services/SpotAssetService"

/**
 * The card's chart, at parity with the chip. What is worth pinning here is
 * not the SVG geometry (chartMath owns that, and is specced) but the CARD's
 * contract: it fetches the reader's story once, draws marks at the executed
 * price, and parks an alert through the injected handler.
 */
const SERIES: SeriesAnswer = {
  points: [10, 12, 11, 13],
  times: [1000, 2000, 3000, 4000],
  opens: null,
  highs: null,
  lows: null,
  failed: false,
}

// jsdom has no requestAnimationFrame, so preact/hooks falls back to a 100ms
// timer for effects; point it at the next tick and flush with act. SCOPED
// to this file and restored after — a leaked global rAF re-times every
// other spec's setTimeout-based flush in the same worker.
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

function mount(over: Partial<Parameters<typeof CardChart>[0]> = {}) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  const props = {
    mint: "MINT1",
    marketUsd: 12,
    avgEntryUsd: null as number | null,
    held: false,
    onSeries: vi.fn(async () => SERIES),
    onMyTrades: vi.fn(async () => []),
    onListOrders: vi.fn(async () => []),
    onSaveAlert: vi.fn(async () => true),
    ...over,
  }
  render(<CardChart {...props} />, root)
  return { root, props }
}

describe("CardChart", () => {
  it("draws the reader's fills as discs, one read per mount", async () => {
    const onMyTrades = vi.fn(async () => [
      { side: "buy" as const, ts: 1500, priceUsd: 13 },
      { side: "sell" as const, ts: 3500, priceUsd: 10 },
    ])
    const { root, props } = mount({ onMyTrades })
    await tick()
    await tick()
    expect(props.onSeries).toHaveBeenCalledWith("MINT1", "1d")
    expect(root.querySelectorAll("circle").length).toBe(2)
    // The story is read ONCE, not per range flip.
    const flip = root.querySelectorAll<HTMLButtonElement>(".cc-range")
    const oneH = [...flip].find((b) => b.textContent === "1H")!
    oneH.click()
    await tick()
    await tick()
    expect(onMyTrades).toHaveBeenCalledTimes(1)
  })

  it("draws an average-entry level only while held, and order levels always, each LABELLED", async () => {
    const onListOrders = vi.fn(async () => [
      { side: "sell" as const, triggerPriceUsd: 14 },
    ])
    const held = mount({ avgEntryUsd: 11.5, held: true, onListOrders })
    await tick()
    await tick()
    // one order level + one entry level = 2 dashed lines
    expect(held.root.querySelectorAll('line[stroke-dasharray]').length).toBe(2)
    // Each level carries its PRICE — two clamped triggers would draw at the
    // same y and the tag is the only thing that tells them apart.
    const texts = [...held.root.querySelectorAll('text')].map((t) => t.textContent)
    expect(texts.some((t) => t?.includes('S ') && t.includes('14'))).toBe(true)
    expect(texts.some((t) => t?.startsWith('You '))).toBe(true)

    const flat = mount({ avgEntryUsd: 11.5, held: false, onListOrders })
    await tick()
    await tick()
    // order level draws; the entry level does not, because nothing is held
    expect(flat.root.querySelectorAll('line[stroke-dasharray]').length).toBe(1)
    expect([...flat.root.querySelectorAll('text')].some((t) => t.textContent?.startsWith('You '))).toBe(false)
  })

  it("parks an alert through the injected handler and reports the outcome", async () => {
    const onSaveAlert = vi.fn(async () => true)
    const { root } = mount({ onSaveAlert })
    await tick()
    ;(root.querySelector(".cc-bell") as HTMLButtonElement).click()
    await tick()
    const input = root.querySelector(".cc-bell-in") as HTMLInputElement
    // Bell prefills the current market so a tap-then-Set is a valid alert.
    expect(input.value).toBe("12")
    input.value = "20"
    input.dispatchEvent(new Event("input"))
    await tick()
    ;(root.querySelector(".cc-bell-set") as HTMLButtonElement).click()
    await tick()
    expect(onSaveAlert).toHaveBeenCalledWith(20)
    expect(root.querySelector(".cc-alertmsg")?.textContent).toBe("Alert set")
  })

  it("says which nothing when there is no chart", async () => {
    const failed: SeriesAnswer = { points: null, times: null, opens: null, highs: null, lows: null, failed: true }
    const { root } = mount({ onSeries: vi.fn(async () => failed) })
    await tick()
    await tick()
    expect(root.querySelector(".cc-note")?.textContent).toContain("did not load")
  })
})
