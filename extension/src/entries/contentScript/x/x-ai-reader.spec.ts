import { beforeEach, describe, expect, it, vi } from "vitest"
import { createXStrip } from "./xStrip"
import { resetXMatchIndex } from "./xMatch"

/**
 * THE READER LANE. A post no rule places ("the ECB held again") is asked
 * about once, and when the AI reader names an asset the chip mounts with the
 * reader's one line under it. A post the reader declines keeps no chip, a
 * post a rule already placed is never sent, and a cell that holds another
 * post by the time the answer lands is left alone.
 */
const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1"
const REASON = "The ECB held rates and the euro firmed against the dollar."

function cellFor(id: string, text: string, cashtags: string[] = []) {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")
  const wrapper = document.createElement("div")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")
  const link = document.createElement("a")
  link.setAttribute("href", `/markets/status/${id}`)
  link.textContent = "Sep 29"
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

function strip(readText: (id: string, text: string) => Promise<unknown>) {
  const track = vi.fn()
  const reader = vi.fn(readText)
  const ctl = createXStrip({
    shadowMode: "open",
    onScreen: () => false,
    disabledMints: new Set<string>(),
    resolveTicker: vi.fn(async () => null),
    readText: reader,
    // The chip describes itself from the server, as it does for any mint.
    enrich: vi.fn(async (mint: string) =>
      mint === EURC
        ? { mint, symbol: "EURC", name: "Euro", displayName: "Euro", indicativeUsd: 1.17, change24hPct: 0.2, icon: null, mcap: null, holderCount: null }
        : null,
    ),
    quote: vi.fn(async () => ({ priceImpactPct: 0 })),
    watchPrice: vi.fn(),
    openTrade: vi.fn(),
    openPanel: vi.fn(),
    signIn: vi.fn(),
    topUp: vi.fn(),
    track,
  } as never)
  return { ctl, track, reader }
}

const settle = () => new Promise((r) => setTimeout(r, 20))
const host = (cell: Element) => cell.querySelector<HTMLElement>("[data-poppin-strip]")

describe("the AI reader lane", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    resetXMatchIndex()
  })

  it("mounts the chip the reader named, with its one line under the price", async () => {
    const hit = { row: { mint: EURC, ticker: "EURC", name: "Euro", displayName: "Euro" }, reason: REASON }
    const { ctl, track, reader } = strip(async () => hit)
    const cell = cellFor("1", "ECB holds rates at 2%, and the single currency firms")
    ctl.processCell(cell)
    await settle()
    expect(reader).toHaveBeenCalledWith("1", expect.stringContaining("ECB holds rates"))
    expect(host(cell)?.getAttribute("data-poppin-strip")).toBe(EURC)
    const why = host(cell)!.shadowRoot!.querySelector<HTMLElement>(".why")!
    expect(why.hidden).toBe(false)
    expect(why.querySelector(".ai")?.textContent).toBe("AI")
    expect(why.querySelector(".because")?.textContent).toBe(REASON)
    expect(track).toHaveBeenCalledWith("x_strip_shown", expect.objectContaining({ mint: EURC, tier: "ai" }))
  })

  it("leaves a post without a chip when the reader says it is about nothing we trade", async () => {
    const { ctl } = strip(async () => null)
    const cell = cellFor("2", "Markets were quiet today")
    ctl.processCell(cell)
    await settle()
    expect(host(cell)).toBeNull()
  })

  it("never asks about a post a rule already placed", async () => {
    const { ctl, reader } = strip(async () => null)
    const cell = cellFor("3", "loading more ", ["$SOL"])
    ctl.processCell(cell)
    await settle()
    expect(reader).not.toHaveBeenCalled()
  })

  it("draws nothing into a cell that holds another post by the time the answer lands", async () => {
    let answer: (v: unknown) => void = () => {}
    const { ctl } = strip(() => new Promise((r) => (answer = r)))
    const cell = cellFor("4", "ECB cuts rates by 25bp")
    ctl.processCell(cell)
    cell.setAttribute("data-poppin-id", "someone-else")
    for (const a of Array.from(cell.attributes)) if (a.value === "4") cell.setAttribute(a.name, "someone-else")
    answer({ row: { mint: EURC, ticker: "EURC", name: "Euro", displayName: "Euro" }, reason: REASON })
    await settle()
    expect(host(cell)).toBeNull()
  })

  it("a rule-placed chip has no reader line", async () => {
    const { ctl } = strip(async () => null)
    const cell = cellFor("5", "loading more ", ["$SOL"])
    ctl.processCell(cell)
    await settle()
    const why = host(cell)?.shadowRoot?.querySelector<HTMLElement>(".why")
    if (why) expect(why.hidden).toBe(true)
  })
})
