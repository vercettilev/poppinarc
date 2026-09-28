import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchedAsset } from "~/services/SpotAssetService"
import { resetXMatchIndex } from "./xMatch"
import { createXStrip, type XStripDeps } from "./xStrip"

/**
 * THE BUTTON SAYS WHAT IT IS DOING, ONCE THE COUNT IS OVER.
 *
 * Reported from the field: pressing Buy or Sell changes the button's colour
 * and nothing on it says why. The cause is a gap between two durations. The
 * count-up answers in the same beat as the finger and is done in 450ms; a
 * swap plus a confirm takes seconds. So the button spent nearly the whole
 * wait showing "~$5.00" — a figure, holding still, in a colour that had
 * changed for an unstated reason.
 *
 * These tests install a real matchMedia before mounting. Without one this
 * jsdom reports reduced motion, the count-up takes its instant path, and the
 * two-beat behaviour under test never happens.
 */

const WIF = {
  mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  symbol: "$WIF",
  name: "dogwifhat",
  displayName: "dogwifhat",
  decimals: 6,
  indicativeUsd: 0.16,
  change24hPct: 15,
  icon: null,
} as unknown as MatchedAsset

type Testable = { matchMedia?: (q: string) => { matches: boolean } }
const g = globalThis as unknown as Testable

const motionAllowed = () => {
  g.matchMedia = (q: string) => ({ matches: !q.includes("reduce") }) as never
}
const motionRefused = () => {
  g.matchMedia = () => ({ matches: true }) as never
}

function makeCell(id: string): HTMLElement {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")
  const wrapper = document.createElement("div")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")
  const link = document.createElement("a")
  link.setAttribute("href", `/someone/status/${id}`)
  link.textContent = "2h"
  article.appendChild(link)
  const text = document.createElement("div")
  text.setAttribute("data-testid", "tweetText")
  text.appendChild(document.createTextNode("sending it "))
  const tag = document.createElement("a")
  tag.setAttribute("href", "/search?q=%24WIF&src=cashtag_click")
  tag.textContent = "$WIF"
  text.appendChild(tag)
  article.appendChild(text)
  wrapper.appendChild(article)
  cell.appendChild(wrapper)
  document.body.appendChild(cell)
  return cell
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const after = (ms: number) => new Promise((r) => setTimeout(r, ms))

const book = async () => ({
  cashUsd: 500,
  solUsd: 0,
  positions: [{ mint: WIF.mint, uiAmount: 100, raw: "100000000", netInvestedUsd: 25 }],
})

/** A trade that hangs until it is let go, so the in-flight button can be read. */
function heldTrade() {
  let release!: () => void
  const held = new Promise<void>((r) => {
    release = r
  })
  return {
    release,
    trade: {
      swap: vi.fn(async () => {
        await held
        return { signature: "s1", dryRun: false, outAmountRaw: "1000000" }
      }),
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    },
    sell: vi.fn(async () => {
      await held
      return { signature: "sell-sig", dryRun: false }
    }),
  }
}

function deps(over: Partial<XStripDeps> = {}): XStripDeps {
  return {
    enrich: vi.fn(async () => WIF),
    openTrade: vi.fn(),
    trade: {
      swap: vi.fn(async () => ({ signature: "s", dryRun: false, outAmountRaw: "1000000" })),
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    },
    order: {
      createOrder: vi.fn(async () => ({ orderKey: "OK1", signature: "sig", dryRun: false })),
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    },
    watchPrice: vi.fn(),
    quote: vi.fn(async () => ({ priceImpactPct: 0.42 })),
    openPanel: vi.fn(),
    signIn: vi.fn(),
    topUp: vi.fn(),
    track: vi.fn(),
    disabledMints: new Set<string>(),
    shadowMode: "open",
    onScreen: () => false,
    book,
    sell: vi.fn(async () => ({ signature: "sell-sig", dryRun: false })),
    ...over,
  } as never
}

let seq = 1
async function sheet(over: Partial<XStripDeps> = {}) {
  const cell = makeCell(String(seq++))
  createXStrip(deps(over)).processCell(cell)
  const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
  await tick()
  const sh = host.shadowRoot!
  sh.querySelector<HTMLElement>(".buy")!.click()
  await tick()
  return sh
}

beforeEach(() => {
  document.body.innerHTML = ""
  resetXMatchIndex()
  motionAllowed()
})

afterEach(() => {
  delete g.matchMedia
})

describe("the in-flight button", () => {
  it("counts the dollars first", async () => {
    const held = heldTrade()
    const sh = await sheet({ trade: held.trade } as Partial<XStripDeps>)
    const go = sh.querySelector<HTMLElement>(".place")!
    go.click()
    // A frame, because the figure is painted by requestAnimationFrame: the
    // press itself only empties the label and starts the count.
    await after(120)
    // The beat that answers the finger: a figure with a tilde, never green,
    // because green is reserved for a trade that landed. The verb is NOT
    // here yet — that is the whole of what "two beats" means.
    expect(go.className).toContain("wait")
    expect(go.textContent).toContain("~$")
    expect(go.textContent).not.toContain("Buying")
    held.release()
  })

  it("says what it is doing once the figure lands", async () => {
    const held = heldTrade()
    const sh = await sheet({ trade: held.trade } as Partial<XStripDeps>)
    const go = sh.querySelector<HTMLElement>(".place")!
    go.click()
    await after(600)
    // 450ms of count against seconds of swap-plus-confirm: the rest of the
    // wait used to be a still figure under a changed colour.
    expect(go.textContent).toBe("Buying…")
    expect(go.className).toContain("wait")
    held.release()
  })

  it("says Selling… on the way out", async () => {
    const held = heldTrade()
    const sh = await sheet({ sell: held.sell } as Partial<XStripDeps>)
    sh.querySelector<HTMLElement>(".segb.sell-on")!.click()
    for (let i = 0; i < 4; i++) await tick()
    const go = sh.querySelector<HTMLElement>(".place")!
    go.click()
    await after(600)
    expect(go.textContent).toBe("Selling…")
    held.release()
  })

  it("never writes the verb over a trade that beat the count home", async () => {
    // The default harness lands in a few ticks, well inside the 450ms. The
    // callback still fires afterwards, and must find nothing to write on:
    // the outcome clears `wait` when it restores the label, and a landed
    // trade closes the sheet outright.
    const sh = await sheet()
    sh.querySelector<HTMLElement>(".place")!.click()
    for (let i = 0; i < 10; i++) await tick()
    expect(sh.querySelector(".receipt")).not.toBeNull()
    await after(600)
    expect(sh.textContent).not.toContain("Buying…")
    expect(sh.querySelector(".receipt")!.textContent).toContain("Bought")
  })

  it("shows the verb straight away for a reader who asked for less motion", async () => {
    motionRefused()
    const held = heldTrade()
    const sh = await sheet({ trade: held.trade } as Partial<XStripDeps>)
    const go = sh.querySelector<HTMLElement>(".place")!
    go.click()
    await tick()
    // No count to wait for, so the two beats collapse into one, and the beat
    // that survives is the one that carries information.
    expect(go.textContent).toBe("Buying…")
    held.release()
  })
})
