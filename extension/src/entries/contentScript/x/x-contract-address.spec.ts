import { beforeEach, describe, expect, it, vi } from "vitest"
import { createXStrip } from "./xStrip"
import { resetXMatchIndex } from "./xMatch"

/**
 * A launch is posted as "CA: <address>" far more often than as a cashtag.
 * Until 2026-09-27 the chip never read the address, so a tweet made of a CA
 * and nothing else had no chip. The address is now asked about first,
 * through the server's by-mint gate (here: enrich), and anything the gate
 * does not describe leaves the tweet on the path it had before.
 */
const PANTS = "FtateF34Xzawa91bpbVNdX72hZYo9cymRDYqBreHHbJi"
const WALLET = "9mvmLpF3wxeF3EUZQ3gB1J7jGiwMQJn9fmzBjgTAhFCB"
const OTHER = "HYPEmint1111111111111111111111111111111111"

const asset = (mint: string, symbol: string) =>
  ({
    mint,
    symbol,
    name: symbol.toLowerCase(),
    displayName: symbol.toLowerCase(),
    indicativeUsd: 0.00046,
    change24hPct: 3.1,
    icon: null,
    mcap: 343902,
    holderCount: 4569,
  }) as never

function cellFor(id: string, text: string, cashtags: string[] = []) {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")
  const wrapper = document.createElement("div")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")
  const link = document.createElement("a")
  link.setAttribute("href", `/launcher/status/${id}`)
  link.textContent = "Sep 27"
  article.appendChild(link)
  const t = document.createElement("div")
  t.setAttribute("data-testid", "tweetText")
  t.appendChild(document.createTextNode(text))
  for (const tag of cashtags) {
    const a = document.createElement("a")
    a.setAttribute("href", `/search?q=${encodeURIComponent(tag)}`)
    a.textContent = tag
    t.appendChild(a)
  }
  article.appendChild(t)
  wrapper.appendChild(article)
  cell.appendChild(wrapper)
  document.body.appendChild(cell)
  return cell
}

function strip(opts: {
  enrich: (mint: string) => Promise<unknown>
  resolveTicker?: (tag: string) => Promise<string | null>
  disabled?: string[]
}) {
  const track = vi.fn()
  const resolveTicker = vi.fn(opts.resolveTicker ?? (async () => null))
  const ctl = createXStrip({
    shadowMode: "open",
    onScreen: () => false,
    disabledMints: new Set<string>(opts.disabled ?? []),
    resolveTicker,
    enrich: opts.enrich,
    quote: vi.fn(async () => ({ priceImpactPct: 0 })),
    watchPrice: vi.fn(),
    openTrade: vi.fn(),
    openPanel: vi.fn(),
    signIn: vi.fn(),
    topUp: vi.fn(),
    track,
  } as never)
  return { ctl, track, resolveTicker }
}

const settle = () => new Promise((r) => setTimeout(r, 20))
const chipMint = (cell: Element) => cell.querySelector("[data-poppin-strip]")?.getAttribute("data-poppin-strip") ?? null

describe("a tweet that shares a contract address", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    resetXMatchIndex()
  })

  it("wears the chip for the address alone, the way launches are posted", async () => {
    const enrich = vi.fn(async (m: string) => (m === PANTS ? asset(PANTS, "PANTS") : null))
    const { ctl, track } = strip({ enrich })
    const cell = cellFor("1", `new one just dropped\nCA: ${PANTS}\nsend it`)
    ctl.processCell(cell)
    await settle()
    expect(enrich).toHaveBeenCalledWith(PANTS)
    expect(chipMint(cell)).toBe(PANTS)
    expect(track).toHaveBeenCalledWith("x_strip_shown", expect.objectContaining({ mint: PANTS, tier: "address" }))
  })

  it("a wallet the gate does not describe gets no chip, and one question", async () => {
    const enrich = vi.fn(async () => null)
    const { ctl } = strip({ enrich })
    const a = cellFor("1", `send tips to ${WALLET}`)
    ctl.processCell(a)
    await settle()
    const b = cellFor("2", `again: ${WALLET}`)
    ctl.processCell(b)
    await settle()
    expect(chipMint(a)).toBeNull()
    expect(chipMint(b)).toBeNull()
    expect(enrich).toHaveBeenCalledTimes(1)
  })

  it("when the address is nothing, the cashtag still gets its turn", async () => {
    const enrich = vi.fn(async (m: string) => (m === PANTS ? asset(PANTS, "PANTS") : null))
    const { ctl, resolveTicker } = strip({ enrich, resolveTicker: async () => PANTS })
    const cell = cellFor("1", `my wallet ${WALLET} is loaded with `, ["$PANTS"])
    ctl.processCell(cell)
    await settle()
    expect(resolveTicker).toHaveBeenCalledWith("$PANTS")
    expect(chipMint(cell)).toBe(PANTS)
  })

  it("the address outranks a cashtag that names something else", async () => {
    // A cashtag is a name anybody can take; the address is the token.
    const enrich = vi.fn(async (m: string) =>
      m === PANTS ? asset(PANTS, "PANTS") : m === OTHER ? asset(OTHER, "HYPE") : null,
    )
    const { ctl } = strip({ enrich, resolveTicker: async () => OTHER })
    const cell = cellFor("1", `the real one CA: ${PANTS} `, ["$HYPE"])
    ctl.processCell(cell)
    await settle()
    expect(chipMint(cell)).toBe(PANTS)
  })

  it("an address on the kill switch is skipped, not asked about", async () => {
    const enrich = vi.fn(async (m: string) => (m === PANTS ? asset(PANTS, "PANTS") : null))
    const { ctl } = strip({ enrich, disabled: [PANTS] })
    const cell = cellFor("1", `CA: ${PANTS}`)
    ctl.processCell(cell)
    await settle()
    expect(enrich).not.toHaveBeenCalledWith(PANTS)
    expect(chipMint(cell)).toBeNull()
  })
})
