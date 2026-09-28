import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchedAsset } from "~/services/SpotAssetService"
import { resetXMatchIndex } from "./xMatch"
import { createXStrip, type XStripDeps } from "./xStrip"

/**
 * THE STRIP MUST NOT FIRE A SECOND TRADE WHILE ONE IS IN FLIGHT.
 *
 * SPOT_SWAP_LIVE is true in production — real custodial USDC moves through
 * runBuyMarket / runSellMarket / runOrder — and the strip's Buy is
 * deliberately NOT disabled while a trade runs (the counting "$25" look is
 * the point). So the only thing standing between a double-press and a
 * double-charge is the in-flight guard.
 *
 * These tests RUN the guard. The file they replace read xStrip.ts off disk
 * and matched regexes against its source, which could not catch a guard
 * that is present and logically wrong — an early return above the
 * `finally`, a wrapper applied to the wrong function, a second flag — and
 * would have gone red for a rename that changed nothing. Every case here
 * mounts a real strip in jsdom, presses real buttons, and asserts on what
 * reached the money endpoints.
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

/** One timeline cell, in the measured shape of X's DOM. */
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

/** A book with cash AND a position, so both directions have an intent. */
const book = async () => ({
  cashUsd: 500,
  solUsd: 0,
  positions: [
    {
      mint: WIF.mint,
      uiAmount: 100,
      raw: "100000000",
      netInvestedUsd: 25,
    },
  ],
})

function deps(over: Partial<XStripDeps> = {}): XStripDeps {
  return {
    enrich: vi.fn(async () => WIF),
    openTrade: vi.fn(),
    trade: {
      swap: vi.fn(async () => ({
        signature: "s",
        dryRun: false,
        outAmountRaw: "1000000",
      })),
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    },
    order: {
      createOrder: vi.fn(async () => ({
        orderKey: "OK1",
        signature: "sig",
        dryRun: false,
      })),
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

/** A strip on a $WIF tweet, with its market-buy sheet already open. */
async function stripWithSheet(over: Partial<XStripDeps> = {}) {
  const d = deps(over)
  const cell = makeCell(String(Math.random()).slice(2))
  createXStrip(d).processCell(cell)
  const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
  await tick()
  const sh = host.shadowRoot!
  sh.querySelector<HTMLElement>(".buy")!.click()
  await tick()
  return { sh, d }
}

/** A swap that hangs until it is let go — one trade, held in flight. */
function heldSwap() {
  let release!: () => void
  const inFlight = new Promise<void>((r) => {
    release = r
  })
  const swap = vi.fn(async () => {
    await inFlight
    return { signature: "s1", dryRun: false, outAmountRaw: "1000000" }
  })
  return {
    swap,
    release,
    trade: {
      swap,
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    },
  }
}

beforeEach(() => {
  document.body.innerHTML = ""
  resetXMatchIndex()
})

describe("the X strip's trade re-entry guard", () => {
  it("spends once, however many times the key is pressed", async () => {
    const held = heldSwap()
    const { sh } = await stripWithSheet({ trade: held.trade } as Partial<XStripDeps>)
    const go = sh.querySelector<HTMLElement>(".place")!
    go.click()
    await tick()
    expect(held.swap).toHaveBeenCalledTimes(1)

    // The impatient reader, on a key that is deliberately still lit.
    go.click()
    go.click()
    go.click()
    await tick()
    await tick()
    expect(held.swap).toHaveBeenCalledTimes(1)

    held.release()
    for (let i = 0; i < 8; i++) await tick()
    /**
     * AND THE KEY THEY FELL ON IS GONE. These three assertions document the
     * done ceremony's teardown, NOT the guard — they still pass with
     * `if (tradeBusy) return` deleted. They are here to record WHY the guard
     * only needs to cover the in-flight window; the assertions that actually
     * fail on a reverted guard are the call-count ones above.
     *
     * The landed trade takes its sheet
     * with it — the done ceremony calls closeSheet before it draws the
     * receipt — so `go` is off the tree and there is no `.place` left in
     * the shadow root at all. That is what bounds this case: the guard is
     * only asked to swallow presses WHILE the trade is in the air, and the
     * surface those presses landed on stops existing the moment it isn't.
     * Trading again has to be asked for from the receipt, which is the
     * last case in this file.
     */
    expect(go.isConnected).toBe(false)
    expect(sh.querySelector(".place")).toBeNull()
    expect(sh.querySelector(".sheet")).toBeNull()
  })

  /**
   * The sell gesture, driven exactly the same way in both of the next two
   * cases. NOT the tail's Sell: by this point the sheet is open, and
   * showSheet's `renderEnd(btn("quiet", "×", showIdle))` has already
   * replaced the tail's Buy/Sell pair with a lone ×. The only button still
   * reading "Sell" in the shadow root is the SHEET's segmented side toggle
   * (`segb sell-on`), and pressing it rebuilds the sheet on the sell side —
   * which is what re-keys the footer to `Sell $16` in `place sell-side`.
   * The assertions below pin that identity, so the helper cannot quietly
   * start driving some other control and still look like this comment.
   *
   * The first case proves the gesture WORKS, so the second case's silence
   * can only be the guard.
   */
  const sellFromTheSheet = async (sh: ShadowRoot) => {
    const sellBtn = [...sh.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.textContent === "Sell",
    )!
    expect(sellBtn).toBeTruthy()
    expect(sellBtn.className).toBe("segb sell-on")
    sellBtn.click()
    await tick()
    // The flip REPLACES the sheet: the toggle calls showSheet, which starts
    // with closeSheet and rebuilds from scratch, so this `.place` is a new
    // node wearing the direction it will now spend in — not the buy case's
    // node relabelled. Re-query it; a reference held across the flip is stale.
    const place = sh.querySelector<HTMLElement>(".place")!
    expect(place.className).toContain("sell-side")
    expect(place.textContent).toContain("Sell")
    place.click()
    await tick()
    await tick()
  }

  it("sells when nothing is in flight — the control for the next case", async () => {
    const sell = vi.fn(async () => ({ signature: "sell-sig", dryRun: false }))
    const { sh } = await stripWithSheet({ sell } as Partial<XStripDeps>)
    // The sheet's own side toggle, then the sheet's key — the tail is not
    // in this gesture at all; opening the sheet already took it away.
    await sellFromTheSheet(sh)
    expect(sell).toHaveBeenCalledTimes(1)
    // Real raw units off the book, the tweet it was fired from, and the
    // idempotency key minted inside the press handler. That fourth
    // argument is the server-side half of this guard: the in-flight flag
    // stops a second press in this tab, and the key stops a retry of THIS
    // press from settling twice. Asserted here so a refactor cannot quietly
    // drop it and leave only the client-side half.
    expect(sell).toHaveBeenCalledWith(
      WIF.mint,
      "100000000",
      expect.stringContaining("/status/"),
      expect.stringMatching(/\S/),
    )
  })

  it("is ONE flag across the directions, not one per button", async () => {
    // runBuyMarket / runSellMarket / runOrder share the in-flight flag, so
    // a buy in the air blocks a sell as surely as it blocks another buy.
    // Selling into an unsettled buy is the same double-spend wearing a
    // different verb: both legs sign against the same custodial wallet.
    const held = heldSwap()
    const sell = vi.fn(async () => ({ signature: "sell-sig", dryRun: false }))
    const { sh } = await stripWithSheet({
      trade: held.trade,
      sell,
    } as Partial<XStripDeps>)
    sh.querySelector<HTMLElement>(".place")!.click()
    await tick()
    expect(held.swap).toHaveBeenCalledTimes(1)

    // The identical GESTURE the control just proved lands a sell: flip the
    // sheet's side toggle, press the sheet's key. Same steps, same order —
    // not the same nodes: each case mounts its own strip and shadow root, and
    // the flip rebuilds the sheet inside it either way.
    await sellFromTheSheet(sh)
    expect(sell).not.toHaveBeenCalled()

    held.release()
    await tick()
  })

  it("always releases, so a genuine next trade is never wedged shut", async () => {
    // The `finally` is the half that a "return early on error" refactor
    // quietly deletes: the guard would then be a one-trade-per-page lock,
    // and the reader's second buy would silently do nothing forever.
    const swap = vi
      .fn<() => Promise<{ signature: string; dryRun: boolean; outAmountRaw: string }>>()
      .mockRejectedValueOnce(new Error("Swap would fail on-chain — nope"))
      .mockResolvedValue({
        signature: "s2",
        dryRun: false,
        outAmountRaw: "1000000",
      })
    const { sh } = await stripWithSheet({
      trade: {
        swap,
        confirm: vi.fn(async () => ({ status: "confirmed" as const })),
      },
    } as Partial<XStripDeps>)

    const go = sh.querySelector<HTMLElement>(".place")!
    go.click()
    await tick()
    await tick()
    expect(swap).toHaveBeenCalledTimes(1)

    // The sheet restored its key rather than closing on an error with no
    // door — the SAME node, with the same listener the ignored presses in
    // the first case landed on. It fires now, which is what makes those
    // ignored presses the guard's doing and not a dead button.
    expect(sh.querySelector(".place")).toBe(go)
    expect(go.className).not.toContain("wait")
    go.click()
    await tick()
    await tick()
    expect(swap).toHaveBeenCalledTimes(2)
  })

  it("lets the next trade through once the first one has landed", async () => {
    const held = heldSwap()
    const { sh } = await stripWithSheet({ trade: held.trade } as Partial<XStripDeps>)
    sh.querySelector<HTMLElement>(".place")!.click()
    await tick()
    held.release()
    // The done ceremony closes the sheet and leaves the receipt with an ×
    // back to the resting chip; the loop's whole point is the second scoop.
    for (let i = 0; i < 6; i++) await tick()
    const close = [...sh.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.textContent === "×",
    )
    expect(close).toBeTruthy()
    close!.click()
    await tick()
    sh.querySelector<HTMLElement>(".buy")!.click()
    await tick()
    sh.querySelector<HTMLElement>(".place")!.click()
    await tick()
    await tick()
    expect(held.swap).toHaveBeenCalledTimes(2)
  })
})
