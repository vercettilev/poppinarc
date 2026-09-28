import { beforeEach, describe, expect, it, vi } from "vitest"
import { createXStrip } from "./xStrip"
import { resetXMatchIndex } from "./xMatch"

/**
 * THE TAB THAT GETS SLOWER FOR AN HOUR AND THEN STOPS.
 *
 * Reported from the field as Chrome freezing during long sessions, and
 * chased down the wrong path twice (a highlighter that is commented out, a
 * network loop that does not exist). This is the third answer and it is
 * measurable: the price-tick registry had an `add` and no `delete`.
 *
 * X recycles timeline cells constantly. Every chip a reader scrolled past
 * stayed registered for the life of the TAB, and each retained callback
 * holds its host, its shadow root, and every closure variable behind it.
 * So a long scroll kept hundreds of dead chips alive and made every price
 * tick loop over all of them.
 *
 * What hid it: the callback already checked host.isConnected and returned,
 * so no dead chip ever PAINTED. The symptom was never a wrong pixel.
 */
const MINT = "FtateF34Xzawa91bpbVNdX72hZYo9cymRDYqBreHHbJi"
const ASSET = {
  mint: MINT,
  symbol: "PANTS",
  name: "dogwifpants",
  displayName: "dogwifpants",
  indicativeUsd: 0.00046,
  change24hPct: -36.5,
  icon: null,
  mcap: 343902,
  holderCount: 4569,
} as never

/** The id must look like a real status id: the permalink parser reads
 *  /<user>/status/<digits>, and a word there is simply not a tweet. Cost me
 *  a debugging round to notice. */
function cellFor(id: string) {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")
  const wrapper = document.createElement("div")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")
  const link = document.createElement("a")
  link.setAttribute("href", `/someone/status/${id}`)
  link.textContent = "Aug 26"
  article.appendChild(link)
  const t = document.createElement("div")
  t.setAttribute("data-testid", "tweetText")
  t.appendChild(document.createTextNode("$PANTS looking good"))
  const a = document.createElement("a")
  a.setAttribute("href", "/search?q=%24PANTS")
  a.textContent = "$PANTS"
  t.appendChild(a)
  article.appendChild(t)
  wrapper.appendChild(article)
  cell.appendChild(wrapper)
  document.body.appendChild(cell)
  return cell
}

const settle = () => new Promise((r) => setTimeout(r, 20))

function strip(watchPrice = vi.fn()) {
  return createXStrip({
    shadowMode: "open",
    onScreen: () => false,
    disabledMints: new Set<string>(),
    resolveTicker: vi.fn(async () => MINT),
    enrich: vi.fn(async () => ASSET),
    quote: vi.fn(async () => ({ priceImpactPct: 0 })),
    watchPrice,
    openTrade: vi.fn(),
    openPanel: vi.fn(),
    signIn: vi.fn(),
    topUp: vi.fn(),
    track: vi.fn(),
  } as never)
}

describe("the price-tick registry", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    resetXMatchIndex()
  })

  it("lets go of a mint once every chip showing it is gone", async () => {
    /**
     * THE OBSERVABLE, and it took two attempts to find one that actually
     * separates the two behaviours. My first version asserted that a fresh
     * controller re-watches the mint — which was true before the fix too,
     * because `watched` is per controller. A test that passes on the bug
     * it was written for is worse than no test.
     *
     * This uses ONE controller. `watched` guards watchPrice, so the mint is
     * armed once and never again while the registry still holds a target
     * for it. If the registry never shrinks, a chip mounted after the first
     * one has been recycled inherits that guard and the price is never
     * re-subscribed. If it does shrink, the mint is forgotten and the new
     * chip arms it again.
     */
    const watchPrice = vi.fn()
    const ctl = strip(watchPrice)

    const first = cellFor("101")
    ctl.processCell(first)
    await settle()
    expect(first.querySelector("[data-poppin-strip]")).toBeTruthy()
    expect(watchPrice).toHaveBeenCalledTimes(1)

    // X recycles the cell as it leaves the viewport.
    first.remove()
    // One tick is the broom.
    ctl.updatePrice(MINT, 0.0005, -30)

    const second = cellFor("102")
    ctl.processCell(second)
    await settle()
    expect(second.querySelector("[data-poppin-strip]")).toBeTruthy()
    // Before the fix this stayed at 1: the dead chip's registration kept
    // the mint alive, so nothing re-subscribed and the registry only grew.
    expect(watchPrice).toHaveBeenCalledTimes(2)
  })

  it("still paints the chips that ARE on the page", async () => {
    // The prune must not take live chips with it, which is the way this
    // kind of fix usually breaks.
    const ctl = strip()
    const cell = cellFor("901")
    ctl.processCell(cell)
    await settle()
    const host = cell.querySelector("[data-poppin-strip]")
    expect(host).toBeTruthy()
    ctl.updatePrice(MINT, 0.00099, 12)
    ctl.updatePrice(MINT, 0.00098, 11)
    // Still mounted after two ticks: a live host is never pruned.
    expect(cell.querySelector("[data-poppin-strip]")).toBeTruthy()
  })
})
