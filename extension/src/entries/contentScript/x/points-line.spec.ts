import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchedAsset } from "~/services/SpotAssetService"
import { resetXMatchIndex } from "./xMatch"
import { createXStrip, type XStripDeps } from "./xStrip"

/**
 * THE RECEIPT SAYS THE POINTS, multiplied by the seat.
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

type Testable = {
  chrome?: { runtime?: { getURL?: (p: string) => string } }
  matchMedia?: (q: string) => { matches: boolean }
}
const g = globalThis as unknown as Testable

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
const book = async () => ({ cashUsd: 500, solUsd: 0, positions: [] })

function deps(over: Partial<XStripDeps> = {}): XStripDeps & { track: ReturnType<typeof vi.fn> } {
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
    ...over,
  } as never
}

let seq = 1
async function buyAndLand(d: XStripDeps) {
  const cell = makeCell(String(seq++))
  createXStrip(d).processCell(cell)
  const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
  await tick()
  const sh = host.shadowRoot!
  sh.querySelector<HTMLElement>(".buy")!.click()
  await tick()
  sh.querySelector<HTMLElement>(".place")!.click()
  for (let i = 0; i < 10; i++) await tick()
  return sh
}

const invite = (first: boolean[]) => {
  const landed = vi.fn()
  for (const f of first) landed.mockResolvedValueOnce({ first: f })
  landed.mockResolvedValue({ first: false })
  return {
    landed,
    info: vi.fn(async () => ({ code: "JQUBIQ", joined: 0, earnedUsd: 0, hasTraded: true })),
  }
}

beforeEach(() => {
  document.body.innerHTML = ""
  resetXMatchIndex()
  g.chrome = { runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` } }
  g.matchMedia = () => ({ matches: true }) as never
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  })
})
afterEach(() => {
  delete g.chrome
  delete g.matchMedia
})

describe("the points on a landed receipt", () => {
  it("multiplies by the seat but never says the word: the number carries it", async () => {
    /* It read "+50 pts · ×2 seat" in a gold pill. Two units in one chip,
       a word with no referent on the screen, and brighter than the trade
       that had just happened. Lev, 2026-09-19. The multiplier still
       multiplies; only the receipt that CLAIMS a seat names one. */
    const d = deps({ points: { status: vi.fn(async () => ({ mult: 2, seat: null })) } })
    const sh = await buyAndLand(d)
    await tick()
    const pts = sh.querySelector<HTMLElement>(".pts")
    expect(pts).not.toBeNull()
    expect(pts!.textContent).toMatch(/^\+[\d,]+ pts$/)
    expect(pts!.textContent).not.toMatch(/seat/)
  })

  it("says only the points when there is no seat", async () => {
    const d = deps({ points: { status: vi.fn(async () => ({ mult: 1, seat: null })) } })
    const sh = await buyAndLand(d)
    await tick()
    expect(sh.querySelector<HTMLElement>(".pts")!.textContent).toMatch(/^\+[\d,]+ pts$/)
  })

  it("says nothing without the dep", async () => {
    const sh = await buyAndLand(deps())
    await tick()
    expect(sh.querySelector(".pts")).toBeNull()
  })

  it("leaves with the receipt", async () => {
    const d = deps({ points: { status: vi.fn(async () => ({ mult: 2, seat: null })) } })
    const sh = await buyAndLand(d)
    await tick()
    expect(sh.querySelector(".pts")).not.toBeNull()
    ;[...sh.querySelectorAll<HTMLElement>(".quiet")].find((b) => b.textContent === "×")!.click()
    await tick()
    expect(sh.querySelector(".pts")).toBeNull()
  })
})

/**
 * THE SEAT IS ANNOUNCED ONCE, on the receipt that claimed it, and that
 * receipt carries nothing else. Gold is spent here and nowhere else in the
 * product.
 */
describe("the receipt that claims a founding seat", () => {
  it("says the seat instead of the points, and keeps the invite off it", async () => {
    const d = deps({
      points: { status: vi.fn(async () => ({ mult: 2, seat: 7 })) },
      invite: {
        landed: vi.fn(async () => ({ first: true })),
        info: vi.fn(async () => ({ code: "JQUBIQ", joined: 0, earnedUsd: 0, hasTraded: true })),
      },
    })
    const sh = await buyAndLand(d)
    await tick()
    await tick()
    const seat = sh.querySelector<HTMLElement>(".seat-under")
    expect(seat).not.toBeNull()
    expect(seat!.textContent).toContain("SEAT #7 / 500")
    expect(seat!.textContent).toContain("counts double, forever")
    expect(sh.querySelector(".pts")).toBeNull()
    expect(sh.querySelector(".invite-under")).toBeNull()
    expect(d.track).toHaveBeenCalledWith("x_seat_claimed", expect.objectContaining({ seat: 7 }))
  })

  it("is not repeated: a later trade gets the quiet points and the invite", async () => {
    const d = deps({
      points: { status: vi.fn(async () => ({ mult: 2, seat: 7 })) },
      invite: {
        landed: vi.fn(async () => ({ first: false })),
        info: vi.fn(async () => ({ code: "JQUBIQ", joined: 0, earnedUsd: 0, hasTraded: true })),
      },
    })
    const sh = await buyAndLand(d)
    await tick()
    await tick()
    expect(sh.querySelector(".seat-under")).toBeNull()
    expect(sh.querySelector<HTMLElement>(".pts")!.textContent).toMatch(/^\+[\d,]+ pts$/)
    expect(sh.querySelector(".invite-under")).not.toBeNull()
  })

  it("says the points, not a seat, for somebody who never claimed one", async () => {
    const d = deps({
      points: { status: vi.fn(async () => ({ mult: 1, seat: null })) },
      invite: {
        landed: vi.fn(async () => ({ first: true })),
        info: vi.fn(async () => ({ code: "JQUBIQ", joined: 0, earnedUsd: 0, hasTraded: true })),
      },
    })
    const sh = await buyAndLand(d)
    await tick()
    await tick()
    expect(sh.querySelector(".seat-under")).toBeNull()
    expect(sh.querySelector(".pts")).not.toBeNull()
  })
})

