import { beforeEach, describe, expect, it, vi } from "vitest"
import { createXStrip } from "./xStrip"
import { resetXMatchIndex } from "./xMatch"

/**
 * An asset on another chain ($AERO from the hand-kept list, or any token such
 * as $PEPE on Ethereum) is reached from the Arc balance over CCTP. Its chip
 * names it and prices it like any other, and its key says "Preview": the
 * press opens the priced route and spends nothing.
 */
const AERO = "remote:aero"
const PEPE = "remote:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933"
const ASSETS: Record<string, { mint: string; symbol: string; name: string; indicativeUsd: number }> = {
  $AERO: { mint: AERO, symbol: "AERO", name: "Aerodrome", indicativeUsd: 0.81 },
  $PEPE: { mint: PEPE, symbol: "PEPE", name: "Pepe", indicativeUsd: 0.0000042 },
}

function cellFor(id: string, cashtag: string) {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")
  const link = document.createElement("a")
  link.setAttribute("href", `/solana/status/${id}`)
  link.textContent = "Sep 29"
  article.appendChild(link)
  const t = document.createElement("div")
  t.setAttribute("data-testid", "tweetText")
  t.appendChild(document.createTextNode("ETF talk again for "))
  const a = document.createElement("a")
  a.setAttribute("href", `/search?q=${encodeURIComponent(cashtag)}`)
  a.textContent = cashtag
  t.appendChild(a)
  article.appendChild(t)
  cell.appendChild(article)
  document.body.appendChild(cell)
  return cell
}

describe("a chip for an asset on another chain", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    resetXMatchIndex()
  })

  it.each(Object.keys(ASSETS))("prices %s, says Preview, and opens the route instead of buying", async (cashtag) => {
    const want = ASSETS[cashtag]!
    const swap = vi.fn()
    const openTrade = vi.fn()
    const ctl = createXStrip({
      shadowMode: "open",
      onScreen: () => false,
      disabledMints: new Set<string>(),
      resolveTicker: vi.fn(async (t: string) => (t.toUpperCase().includes(want.symbol) ? want.mint : null)),
      enrich: vi.fn(async (mint: string) =>
        mint === want.mint
          ? { mint, symbol: want.symbol, name: want.name, displayName: want.name, indicativeUsd: want.indicativeUsd, change24hPct: null, icon: null, mcap: null, holderCount: null, decimals: 18 }
          : null,
      ),
      quote: vi.fn(async () => ({ priceImpactPct: 0 })),
      watchPrice: vi.fn(),
      openTrade,
      openPanel: vi.fn(),
      signIn: vi.fn(),
      topUp: vi.fn(),
      trade: { swap, confirm: vi.fn() },
      track: vi.fn(),
    } as never)
    const cell = cellFor("1", cashtag)
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 30))
    const host = cell.querySelector<HTMLElement>("[data-poppin-strip]")
    expect(host?.getAttribute("data-poppin-strip")).toBe(want.mint)
    const buttons = Array.from(host!.shadowRoot!.querySelectorAll<HTMLButtonElement>(".end button"))
    const preview = buttons.find((b) => b.textContent?.trim() === "Preview")
    expect(preview).toBeTruthy()
    expect(buttons.some((b) => b.textContent?.trim() === "Buy")).toBe(false)
    preview!.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(swap).not.toHaveBeenCalled()
  })
})
