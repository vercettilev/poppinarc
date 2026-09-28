import { beforeEach, describe, expect, it, vi } from "vitest"
import { createXStrip } from "./xStrip"
import { resetXMatchIndex } from "./xMatch"

/**
 * $PANTS, from the field: the chip never appeared, while the server answered
 * by-ticker AND by-mint perfectly for that token every time it was asked.
 *
 * The whole failure lived in one line of caching. A chip mounts, asks enrich
 * for the asset, and DELETES ITSELF when the answer is null - so a single
 * dropped request, remembered as "there is no such asset", silenced every
 * tweet about that token for the life of the page.
 */
const PANTS = "FtateF34Xzawa91bpbVNdX72hZYo9cymRDYqBreHHbJi"

const ASSET = {
  mint: PANTS,
  symbol: "PANTS",
  name: "dogwifpants",
  displayName: "dogwifpants",
  indicativeUsd: 0.00046,
  change24hPct: -36.5,
  icon: null,
  mcap: 343902,
  holderCount: 4569,
} as never

function cellFor(id: string, text: string, cashtags: string[], user: string) {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")
  const wrapper = document.createElement("div")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")
  const link = document.createElement("a")
  link.setAttribute("href", `/${user}/status/${id}`)
  link.textContent = "Aug 26"
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
  return { cell, article }
}

const TEXT = "$PANTS is currently going through a serious correction."

function strip(enrich: XEnrich) {
  return createXStrip({
    shadowMode: "open",
    onScreen: () => false,
    disabledMints: new Set<string>(),
    resolveTicker: vi.fn(async () => PANTS),
    enrich,
    quote: vi.fn(async () => ({ priceImpactPct: 0 })),
    watchPrice: vi.fn(),
    openTrade: vi.fn(),
    openPanel: vi.fn(),
    signIn: vi.fn(),
    topUp: vi.fn(),
    track: vi.fn(),
  } as never)
}
type XEnrich = (mint: string) => Promise<unknown>

const settle = () => new Promise((r) => setTimeout(r, 20))

describe("a token we have never heard of, on a real tweet", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    resetXMatchIndex()
  })

  it("asks the server for the cashtag and wears the chip", async () => {
    const ctl = strip(vi.fn(async () => ASSET))
    const { cell } = cellFor("1", TEXT, ["$PANTS"], "ImPushingSOL")
    ctl.processCell(cell)
    await settle()
    expect(cell.querySelector("[data-poppin-strip]")).toBeTruthy()
  })

  it("one dropped request does not silence the token for the rest of the page", async () => {
    // First ask fails the way a cold backend or a flaky network fails.
    let n = 0
    const enrich = vi.fn(async () => {
      n += 1
      if (n === 1) throw new Error("network")
      return ASSET
    })
    const ctl = strip(enrich)

    const first = cellFor("1", TEXT, ["$PANTS"], "ImPushingSOL")
    ctl.processCell(first.cell)
    await settle()
    // That tweet loses its chip, which is correct: we could not describe it.
    expect(first.cell.querySelector("[data-poppin-strip]")).toBeNull()

    // The NEXT tweet about the same token must ask again, not inherit a
    // failure remembered as an absence.
    const second = cellFor("2", TEXT, ["$PANTS"], "someoneelse")
    ctl.processCell(second.cell)
    await settle()
    expect(enrich).toHaveBeenCalledTimes(2)
    expect(second.cell.querySelector("[data-poppin-strip]")).toBeTruthy()
  })

  it("a real 'no such asset' is still remembered, so it costs one request", async () => {
    const enrich = vi.fn(async () => null)
    const ctl = strip(enrich)
    const a = cellFor("1", TEXT, ["$PANTS"], "ImPushingSOL")
    ctl.processCell(a.cell)
    await settle()
    const b = cellFor("2", TEXT, ["$PANTS"], "other")
    ctl.processCell(b.cell)
    await settle()
    expect(enrich).toHaveBeenCalledTimes(1)
    expect(b.cell.querySelector("[data-poppin-strip]")).toBeNull()
  })
})
