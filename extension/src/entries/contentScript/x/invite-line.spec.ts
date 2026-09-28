import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchedAsset } from "~/services/SpotAssetService"
import { resetXMatchIndex } from "./xMatch"
import { createXStrip, type XStripDeps } from "./xStrip"

/**
 * THE INVITE DOOR OPENS ON THE FIRST LANDED TRADE, and nowhere before it.
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

describe("the invite line under every receipt", () => {
  it("grows under the first landed buy, and copies the join link", async () => {
    const d = deps({ invite: invite([true]) })
    const sh = await buyAndLand(d)
    const under = sh.querySelector<HTMLElement>(".invite-under")!
    expect(under).not.toBeNull()
    expect(under.textContent).toContain("Invite a friend.")
    expect(under.textContent).toContain("20% of their fees")
    expect(d.track).toHaveBeenCalledWith("x_invite_shown", expect.objectContaining({ via: "receipt" }))
    under.querySelector<HTMLElement>(".invite-copy")!.click()
    await tick()
    await tick()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://poppin.so/join/JQUBIQ")
    expect(under.textContent).toContain("Link copied")
    expect(under.textContent).toContain("poppin.so/join/JQUBIQ")
    expect(d.track).toHaveBeenCalledWith("x_invite_copy", expect.objectContaining({ via: "receipt" }))
  })

  it("shows again: the second landed trade gets the line too", async () => {
    /* It used to show once in a lifetime. Measured 2026-09-19: zero invite
       links had ever been copied, from 2,532 accounts. The moment was
       right and the frequency was wrong, so every receipt carries it now;
       `landed()` is still called, because the Holdings row opens on the
       first one. */
    const d = deps({ invite: invite([false]) })
    const sh = await buyAndLand(d)
    const under = sh.querySelector(".invite-under")
    expect(under).not.toBeNull()
    expect(under!.textContent).toContain("20% of their fees")
  })

  it("without the invite dep there is no line at all", async () => {
    const sh = await buyAndLand(deps())
    expect(sh.querySelector(".invite-under")).toBeNull()
  })

  it("leaves with the receipt: the next state clears it", async () => {
    const d = deps({ invite: invite([true]) })
    const sh = await buyAndLand(d)
    expect(sh.querySelector(".invite-under")).not.toBeNull()
    // The × beside the receipt returns the row to rest.
    ;[...sh.querySelectorAll<HTMLElement>(".quiet")].find((b) => b.textContent === "×")!.click()
    await tick()
    expect(sh.querySelector(".invite-under")).toBeNull()
  })
})
