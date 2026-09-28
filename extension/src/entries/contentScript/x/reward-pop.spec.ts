import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchedAsset } from "~/services/SpotAssetService"
import { resetXMatchIndex } from "./xMatch"
import { createXStrip, type XStripDeps } from "./xStrip"

/**
 * THE TRADE THAT LANDS GETS A CHARACTER, NOT JUST A TICK.
 *
 * Reported on 2026-09-11 over a receipt that had just worked: "çok kuru" —
 * too dry. What landed was a tick, a number and eight CSS dots, which reads
 * as a notification rather than a moment.
 *
 * These tests RUN the reward. That distinction is the whole reason this file
 * exists: this jsdom has no `matchMedia` at all, so `reducedMotion()` is
 * TRUE by default and the entire celebration block — the sparks that
 * shipped long ago included — never executes in any other spec in this
 * directory. A green suite next door proves nothing about this code. Every
 * case below installs a matchMedia before it mounts anything.
 *
 * It also has no `chrome`, which is the second thing under test. The reward
 * is the one direct `chrome.` lookup in a file that takes everything else
 * through XStripDeps, and it sits INSIDE the done ceremony — so the case
 * that matters most here is the one where chrome is missing and the receipt
 * has to survive anyway.
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

/** A reader who has not asked the system to hold still. */
const motionAllowed = () => {
  g.matchMedia = (q: string) => ({ matches: !q.includes("reduce") }) as never
}
/** A reader who has. */
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

/** Cash to spend AND a holding to exit, so both directions have an intent. */
const book = async () => ({
  cashUsd: 500,
  solUsd: 0,
  positions: [{ mint: WIF.mint, uiAmount: 100, raw: "100000000", netInvestedUsd: 25 }],
})

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

/** Mount a strip, open the buy sheet, place the trade, let it land. */
async function buyAndLand(over: Partial<XStripDeps> = {}) {
  const cell = makeCell(String(seq++))
  createXStrip(deps(over)).processCell(cell)
  const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
  await tick()
  const sh = host.shadowRoot!
  sh.querySelector<HTMLElement>(".buy")!.click()
  await tick()
  sh.querySelector<HTMLElement>(".place")!.click()
  for (let i = 0; i < 10; i++) await tick()
  return sh
}

let seq = 1

beforeEach(() => {
  document.body.innerHTML = ""
  resetXMatchIndex()
  g.chrome = { runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` } }
  motionAllowed()
})

afterEach(() => {
  delete g.chrome
  delete g.matchMedia
})

describe("the reward on a landed trade", () => {
  it("puts the mark on screen when a buy confirms", async () => {
    const sh = await buyAndLand()
    const pop = sh.querySelector<HTMLImageElement>(".pop-reward")
    expect(pop).not.toBeNull()
    // The asset itself, resolved through the extension's own origin. A bare
    // "pop-reward.webp" would resolve against x.com and 404 on every trade.
    expect(pop!.src).toBe("chrome-extension://abc/pop-reward.webp")
  })

  it("is decoration, so it carries no alt text for a screen reader", async () => {
    const sh = await buyAndLand()
    // The receipt already SAYS the trade landed. A second voice announcing
    // a picture of a ghost would be noise on top of the news.
    expect(sh.querySelector<HTMLImageElement>(".pop-reward")!.alt).toBe("")
  })

  it("stays put once its entrance is over", async () => {
    const sh = await buyAndLand()
    const pop = sh.querySelector(".pop-reward")!
    /* Real seconds, not fake ones: fake timers freeze the `setTimeout(0)`
       that every await in this harness rides on, so the trade never lands.
       It used to take itself off at 1.7s, which was reported as a moment
       gone before it registered. The file plays once and holds (29 frames,
       loop count 1), so what sits here is the mark wearing its sunglasses,
       not an animation still running. */
    await new Promise((r) => setTimeout(r, 1850))
    expect(pop.isConnected).toBe(true)
  })

  it("leaves when the reader dismisses the receipt", async () => {
    const sh = await buyAndLand()
    expect(sh.querySelector(".pop-reward")).not.toBeNull()
    const close = [...sh.querySelectorAll("button")].find((b) => b.textContent === "×")
    expect(close).toBeDefined()
    close!.click()
    await tick()
    /* The × is the exit for the whole moment, receipt and reward together.
       The mark hangs off the CHIP rather than the row, so nothing else on
       the way out would have taken it: without this it would float over
       whatever the row showed next, permanently. */
    expect(sh.querySelector(".pop-reward")).toBeNull()
  })

  it("comes to a landed sell too", async () => {
    const cell = makeCell(String(seq++))
    createXStrip(deps()).processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await tick()
    const sh = host.shadowRoot!
    sh.querySelector<HTMLElement>(".buy")!.click()
    await tick()
    sh.querySelector<HTMLElement>(".segb.sell-on")!.click()
    for (let i = 0; i < 4; i++) await tick()
    sh.querySelector<HTMLElement>(".place")!.click()
    for (let i = 0; i < 10; i++) await tick()
    // An exit is a result as much as an entry is. The reward sits in the
    // shared done ceremony for exactly that reason.
    expect(sh.querySelector(".pop-reward")).not.toBeNull()
  })

  it("writes the buy as a sentence", async () => {
    const sh = await buyAndLand()
    const receipt = sh.querySelector(".receipt")!
    const text = receipt.textContent ?? ""
    // "✓ $5.00 → 0.04794 SOL" read like a conversion table in a feed made of
    // sentences. The asset is named once; the token quantity is the panel
    // history's job, because this row also carries a reward, Share and an
    // exit and it was the one part a reader can look up.
    expect(text).toContain("Bought")
    expect(text).toContain("of $WIF")
    expect(text).not.toContain("→")
    expect(receipt.querySelector(".r-sub")).toBeNull()
  })

  it("plays the landing on one clock, not five", async () => {
    const sh = await buyAndLand()
    const row = sh.querySelector(".end")!
    const chip = sh.querySelector(".chip")!
    /* The moment used to finish four times: the row at 150ms, the reward at
       420, the sparks at 620, the glow at 700. These three marks are what
       put them on one duration with delays instead of four durations with
       none — staggered, which is not the same as unsynchronised. */
    expect(row.classList.contains("landed")).toBe(true)
    expect(chip.classList.contains("landed")).toBe(true)
    expect(chip.querySelector(".chip-sweep")).not.toBeNull()
  })

  it("is interruptible: the next state strips the ceremony at once", async () => {
    const sh = await buyAndLand()
    const chip = sh.querySelector(".chip")!
    const close = [...sh.querySelectorAll("button")].find((b) => b.textContent === "×")
    close!.click()
    await tick()
    /* A ceremony that queues is not premium, it is stuck. Tapping through it
       lands on the next state immediately rather than waiting for a light to
       finish crossing a pill. */
    expect(chip.classList.contains("landed")).toBe(false)
    expect(chip.querySelector(".chip-sweep")).toBeNull()
    expect(sh.querySelector(".end")!.classList.contains("landed")).toBe(false)
    expect(sh.querySelector(".pop-reward")).toBeNull()
  })

  it("holds no ceremony at all for a reader who asked for less motion", async () => {
    motionRefused()
    const sh = await buyAndLand()
    expect(sh.querySelector(".chip-sweep")).toBeNull()
    expect(sh.querySelector(".end")!.classList.contains("landed")).toBe(false)
    // and the receipt still arrives, which is the half that carries the news
    expect(sh.querySelector(".receipt")!.textContent).toContain("Bought")
  })

  it("puts the reward in the row rather than over it", async () => {
    const sh = await buyAndLand()
    const pop = sh.querySelector(".pop-reward")!
    const written = sh.querySelector(".receipt")!
    // Reported from the field as the mark sitting on the numbers: it hung
    // off the chip at a fixed offset from the right edge, which is not a
    // layout, it is a guess about how wide a sentence will be.
    expect(pop.previousElementSibling).toBe(written)
    expect(getComputedStyle(pop).position).not.toBe("absolute")
  })

  it("is never born for a reader who asked for less motion", async () => {
    motionRefused()
    const sh = await buyAndLand()
    // Not hidden, not paused: absent. The reduced-motion blanket freezes
    // animations, and a frozen reward would be a permanent sticker.
    expect(sh.querySelector(".pop-reward")).toBeNull()
  })

  it("leaves the receipt standing when there is no chrome to ask", async () => {
    delete g.chrome
    const sh = await buyAndLand()
    // THE CASE THIS FILE WAS WRITTEN FOR. The ornament sits inside the done
    // ceremony, so an unguarded lookup here would throw between the landed
    // swap and the receipt, and a reader who just spent real money would be
    // shown nothing. No ornament is acceptable. No receipt is not.
    expect(sh.querySelector(".pop-reward")).toBeNull()
    expect(sh.textContent).toContain("✓")
  })
})
