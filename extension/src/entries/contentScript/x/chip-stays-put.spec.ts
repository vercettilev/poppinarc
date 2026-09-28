import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchedAsset } from "~/services/SpotAssetService"
import { resetXMatchIndex } from "./xMatch"
import { createXStrip, type XStripDeps } from "./xStrip"

/**
 * "THE BOX KEEPS CLOSING AND RE-OPENING WHILE I MOVE THE MOUSE."
 *
 * Reported against the buy/sell end of the chip, moving between buttons.
 * Nothing in xStrip.ts listens for hover and the MutationObserver watches
 * childList only, so the question is narrow: what on this surface can a
 * bare pointer MOVE open, close, or rebuild?
 *
 *   1. A NATIVE TOOLTIP. `title` is a box the browser opens on a dwell,
 *      hides the moment the pointer moves, and opens again with different
 *      text over the next element that has one — and the tail is four
 *      controls inside ~150px. This is the reported symptom, literally, in
 *      the reported place. The first repair removed the title from the
 *      HOST only and left Buy, the bell, the wallet and the thin mark
 *      carrying their own, which is where a child's title always won
 *      anyway; the tail is empty of them now and the names live on
 *      aria-label. Pinned below, per element, including the accessible
 *      names that had to survive the removal.
 *   2. A FLIP REBUILT THE TAIL. Buy↔Sell and Now↔When-it-hits rebuild the
 *      sheet, and the tail's close button was rebuilt with it — destroyed
 *      and faded back in — on every segment tap, under whatever the
 *      pointer was resting on.
 *   3. OUR MOVE EVENTS REACHED X. The host sits inside X's article, X's
 *      cell is a React subtree that re-renders on its own hover state, and
 *      mousemove/pointermove carry no relatedTarget, so shadow retargeting
 *      does not stop them at the host the way it stops mouseover/mouseout
 *      between two of our own controls. They are fenced now.
 *
 * AND ONE THING THAT IS DELIBERATELY NOT HERE: a self-heal that re-mounted
 * the chip whenever the identity mark matched and the host was missing. It
 * was written for a removal nobody has ever measured, it cannot produce a
 * hover-triggered symptom at all, and if that removal WERE real and
 * recurring it would have answered with a brand-new host — closed, with
 * its 0.32s entrance — on every idle flush, i.e. several times a second.
 * The tests below pin the absence: one verdict per tweet, and no rebuild
 * under the pointer.
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

/**
 * A cell shaped the way X actually builds one, INCLUDING the action row.
 *
 * THE PARAGRAPH THAT USED TO BE HERE WAS FALSE, twice over, and it argued
 * for this fixture on both counts. It said "every other fixture in this
 * folder omits `role="group"`, so every other test mounts through the
 * article-level fallback — i.e. through the one placement the
 * reconciliation hazard does not apply to."
 *
 * Neither half survives a read. In xStrip.spec.ts, `withActionRow` builds a
 * div with `role="group"` and appends it to the article, and the `mountOn`
 * beside it calls `ctl.processCell(cell)` — so the action-row branch is
 * already exercised there. Counted by reading the bodies of the "placement
 * on any X layout" describe: five of its seven tests mount through
 * `mountOn`/`withActionRow`; the other two ("falls back to the article when
 * there is no action row" and "takes the rail's width when the host hangs
 * off a railed article") build a cell with no action row on purpose,
 * because the fallback is what they are about. And the "reconciliation
 * hazard" is the premise of the self-heal this file's own header (above)
 * records as never measured and deliberately absent: an argument built on
 * it is arguing from something this file abandoned.
 *
 * The honest reason for the landmark is smaller and does not need a bug.
 * `mountStrip` inserts the host directly after the last `[role="group"]`
 * in the article, and measures the chip's left rail from that same row
 * (its `actionRow` insertion, and the `rail` it feeds a few lines below),
 * falling back to the article and the tweet text only where no such row
 * exists. A fixture without one therefore exercises the fallback rather
 * than the placement X ships on every real tweet — and the first test
 * below asserts `group.nextElementSibling`, which the fallback shape
 * could not even express.
 */
function makeCell(opts: { id: string; text: string; cashtags?: string[] }) {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")
  const wrapper = document.createElement("div")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")

  const link = document.createElement("a")
  link.setAttribute("href", `/someone/status/${opts.id}`)
  link.textContent = "2h"
  article.appendChild(link)

  const text = document.createElement("div")
  text.setAttribute("data-testid", "tweetText")
  text.appendChild(document.createTextNode(opts.text))
  for (const tag of opts.cashtags ?? []) {
    const a = document.createElement("a")
    a.setAttribute("href", `/search?q=${encodeURIComponent(tag)}&src=cashtag_click`)
    a.textContent = tag
    text.appendChild(a)
  }
  article.appendChild(text)

  // The reply/retweet/like cluster — the landmark mountStrip anchors to.
  const group = document.createElement("div")
  group.setAttribute("role", "group")
  article.appendChild(group)

  wrapper.appendChild(article)
  cell.appendChild(wrapper)
  document.body.appendChild(cell)
  return { cell, article, group }
}

function deps(overrides?: Partial<XStripDeps>): XStripDeps {
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
    shadowMode: "open",
    onScreen: () => false,
    disabledMints: new Set<string>(),
    ...overrides,
  } as never
}

const stripIn = (cell: Element) => cell.querySelector("[data-poppin-strip]") as HTMLElement | null

beforeEach(() => {
  document.body.innerHTML = ""
  resetXMatchIndex()
})

describe("one verdict per tweet, and no rebuild under the pointer", () => {
  it("comes back when the page takes the chip away, a bounded number of times", async () => {
    /**
     * REVERSED 2026-09-13, on the evidence this test said was missing.
     *
     * What stood here said the chip must NOT come back, and its reasoning
     * was sound at the time: nobody had ever measured a host reconciling
     * our foreign child away, and xStrip's header records the opposite —
     * a foreign node surviving twelve thousand pixels of scrolling on X.
     *
     * It has been measured now. On a CNBC article the chip mounted under
     * the headline and vanished a moment later: the page server-renders
     * and then hydrates, and React removes children of a container it
     * manages that it did not put there. The old invariant answered that
     * with silence for ever.
     *
     * THE OTHER HALF OF THAT REASONING SURVIVES INTACT and is the whole
     * design of the cure. Healing without a ceiling is what turned a
     * removal into a flicker: processCell is driven by an idle flush with
     * a 300ms timeout and a 120ms fallback, so a removal that RECURS gets
     * answered several times a second by a brand-new host that arrives
     * closed, replays the entrance, and registers another TickTarget and
     * walRefresher on the way in. That is a fight with somebody else's
     * framework, on their site, with our name on it.
     *
     * So the chip comes back three times and then stops. Enough for a
     * hydration pass and a re-render after it; far short of a loop. And
     * the server is not asked again, because the verdict never changed.
     */
    const d = deps()
    const ctl = createXStrip(d)
    const { cell, group } = makeCell({ id: "9001", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    const first = stripIn(cell)!
    expect(first).not.toBeNull()
    // The real placement: inside the article, right after the action row.
    expect(group.nextElementSibling).toBe(first)
    const mark = cell.getAttribute("data-poppin-x")

    // Taken away once: it returns.
    first.remove()
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    expect(stripIn(cell), "a page that removes it once gets it back").not.toBeNull()

    // Taken away on a loop: it gives up rather than fight.
    for (let i = 0; i < 10; i++) {
      stripIn(cell)?.remove()
      ctl.processCell(cell)
    }
    await new Promise((r) => setTimeout(r, 0))
    expect(stripIn(cell), "and stops, rather than flicker for ever").toBeNull()

    expect(cell.getAttribute("data-poppin-x")).toBe(mark)
    expect(d.enrich, "the verdict never changed, so nobody was asked again").toHaveBeenCalledTimes(
      1,
    )
  })

  it("does not re-judge a tweet it decided to say nothing about", async () => {
    /**
     * THE OTHER HALF OF THE MARK. `data-poppin-x` records a verdict, and
     * "we mounted a chip" and "we deliberately said nothing" share it. Only
     * the first has anything in the DOM that can go missing; a presence
     * check that could not tell them apart would re-run the matcher, the
     * name-tier budget and the ticker lane on every mutation of every
     * tweet on the timeline that is not about a token.
     */
    const d = deps()
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "9002", text: "no tickers here at all" })
    for (let i = 0; i < 5; i++) ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    expect(stripIn(cell)).toBeNull()
    expect(d.enrich).not.toHaveBeenCalled()
  })

  it("lets a chip that deletes itself stay deleted", async () => {
    /**
     * THE LOOP THIS FIX COULD HAVE SHIPPED. A mint the server refuses makes
     * the chip remove its own host (enrichment is also the permission
     * slip). Paired with "the mark says chipped, the chip is missing", that
     * is a mount/remove cycle on every mutation of that tweet, forever, on
     * a live feed. The mount record is dropped by the self-delete, so the
     * cell goes back to short-circuiting.
     */
    const d = deps({ enrich: vi.fn(async () => null) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "9003", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    expect(stripIn(cell)).toBeNull()

    for (let i = 0; i < 5; i++) ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    expect(stripIn(cell)).toBeNull()
    expect(d.enrich).toHaveBeenCalledTimes(1)
  })

  it("still tears a strip down when the cell comes back as a different tweet", async () => {
    /**
     * THE INVARIANT THE HEAL MUST NOT WEAKEN. Buy-under-the-wrong-tweet is
     * the one failure this feature cannot survive, and X recycles cells —
     * so a heal that mistook a recycled cell for a missing chip would be a
     * far worse bug than the one it fixes.
     */
    const d = deps()
    const ctl = createXStrip(d)
    const { cell, article } = makeCell({ id: "9004", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    expect(stripIn(cell)).not.toBeNull()

    article.querySelector('a[href*="/status/"]')!.setAttribute("href", "/other/status/9005")
    const text = article.querySelector('[data-testid="tweetText"]')!
    text.textContent = "rest in peace, a tweet about nothing tradeable"
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))

    expect(stripIn(cell)).toBeNull()
    expect(cell.getAttribute("data-poppin-x")).toBe("9005")
  })
})

describe("nothing on the chip opens a box just because the pointer moved", () => {
  const restingChip = async (id: string, overrides?: Partial<XStripDeps>) => {
    const d = deps(overrides)
    const ctl = createXStrip(d)
    const { cell, article } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    const host = stripIn(cell)!
    return {
      host,
      sh: host.shadowRoot!,
      cell,
      article,
      ctl,
      mintKey: host.getAttribute("data-poppin-strip")!,
    }
  }

  it("has no native tooltip anywhere the pointer travels between keys", async () => {
    /**
     * THE TAIL IS THE REPORTED PLACE: bell · wallet · Buy · Sell, four
     * controls inside about 150px, and a reader choosing between the last
     * two sweeps across all of them. Every `title` in that band is a box
     * that opens on a dwell and shuts on the next movement.
     *
     * The previous version of this test asserted only that the HOST had no
     * title, and then asserted the badge had gained one — which is the
     * shape of the bug, not its fix: a child's own title always beat the
     * host's, so removing the host's changed nothing for Buy, the bell,
     * the wallet or the thin mark, and moving the name onto the disc added
     * a fifth box on the way in. Both halves are corrected here.
     */
    const { host, sh } = await restingChip("9010")
    expect(host.hasAttribute("title")).toBe(false)
    // The whole tail, descendants included — a title on a glyph inside a
    // key opens the same box the key would have.
    expect([...sh.querySelectorAll(".end *, .end")].filter((n) => n.hasAttribute("title"))).toEqual(
      [],
    )
    // And the disc, which is where the first repair put the name it took
    // off the host.
    expect(sh.querySelector(".badge")!.hasAttribute("title")).toBe(false)
  })

  it("carries no title anywhere on the resting chip, and cannot grow one on a tick", async () => {
    /**
     * THE STRONGEST FORM OF THE REPORTED SYMPTOM, and the one the pass that
     * cleared the tail left standing.
     *
     * That pass exempted `.mine` and `.who` on the reasoning that "a
     * pointer at that end of the row is reading, not choosing between
     * keys". Two facts it did not weigh:
     *
     *   `.mine` and `.who` are the last children of `.face`, i.e. the two
     *   elements immediately before `.more` and then `.end`. They are on
     *   the approach to Buy.
     *
     *   `paintMine` reassigned `mineEl.title` unconditionally and
     *   `replaceChildren`'d the pill just above it, and `paintMine` runs
     *   from the PRICE PAINT. A native tooltip closes and re-opens when
     *   its title is reassigned, so a reader who HELD the token and simply
     *   rested on that pill got a box blinking on the tick cadence with no
     *   pointer movement at all. Every other tooltip on this surface needs
     *   a sweep to flicker; that one needed nothing.
     *
     * So the invariant asserted here is not "no title where the pointer
     * travels" — a judgement about where pointers go, which is what got
     * argued down last time. It is the whole resting chip, before and
     * after a run of ticks. (Titles on the surfaces the reader SUMMONS —
     * the sheet, the chart, the fund panel — are out of scope by
     * construction: none of them exists on a resting chip.)
     */
    const { sh, ctl, mintKey } = await restingChip("9013", {
      book: (async () => ({
        cashUsd: 10,
        solUsd: 0,
        positions: [
          {
            mint: WIF.mint,
            uiAmount: 100,
            raw: "100000000",
            netInvestedUsd: 100,
            avgEntryPriceUsd: 2,
          },
        ],
      })) as never,
    })
    ctl.updatePrice(mintKey, 2.5, 4)
    await new Promise((r) => setTimeout(r, 0))

    /**
     * THE GUARD AGAINST A VACUOUS PASS. The element that carried the one
     * surviving title is hidden until it has something to say, so a "no
     * titles" sweep over a chip where it never painted would prove nothing
     * at all. It is on the row here.
     *
     * `.who` used to stand beside it and is gone: the stack of faces of
     * people you follow cost a second identity on a row that already
     * carries the reader's own, and the row's budget belongs to the price
     * and the two decisions.
     */
    const mine = sh.querySelector<HTMLElement>(".mine")!
    expect(mine.hidden).toBe(false)
    expect(mine.textContent).toBe("You +25.0%")
    expect(sh.querySelector(".who")).toBeNull()

    const titled = () =>
      [...sh.querySelectorAll(".chip, .chip *")]
        .filter((n) => n.hasAttribute("title"))
        .map((n) => n.className || n.tagName)
    expect(titled()).toEqual([])

    // Twenty prints with the pointer nowhere near the chip. The pill is
    // rebuilt and repainted on every one of them; none of them may put a
    // box back.
    for (let i = 0; i < 20; i++) ctl.updatePrice(mintKey, 2.5 + i / 100, 4)
    expect(titled()).toEqual([])
    // ...and the loop really did repaint, so the sweep above is not
    // measuring a chip that stopped listening. $2.69 against a $2.00
    // entry is +34.5%.
    expect(mine.textContent).toBe("You +34.5%")
  })

  it("puts no title on anything the sheet's price tick rewrites", async () => {
    /**
     * THE HALF OF THE RULE THAT IS NOT ON THE RESTING ROW.
     *
     * `.mine` was the tooltip that needed no pointer movement at all: a
     * TIMER reassigned its title, so the box shut and re-opened on the
     * tick cadence with the pointer standing still. The test above sweeps
     * the resting row clean. A timer writes the open sheet too —
     * `sheetTick` calls `verdict`, and the nodes that function can write
     * on a tick, read off its body, are the ones listed in `written`
     * below. Each is a place a maintainer could add a title and reproduce
     * `.mine` exactly.
     *
     * The sheet is ALLOWED titles: the reader summoned it, and the bell
     * carries one. What it may not do is put a title on a node the tick
     * writes, or change one on a tick. Both are asserted, so the next
     * person who reaches for a title on the primary button gets a red test
     * rather than a comment to argue with.
     */
    // saveAlert is what draws the sheet's bell, and the bell is the title
    // this sweep needs to have something to find.
    const { sh, ctl, mintKey } = await restingChip("9014", {
      saveAlert: (async () => true) as never,
    })
    ctl.updatePrice(mintKey, 0.16, 4)
    sh.querySelector<HTMLElement>(".buy")!.click()
    // The limit side, so the reading line the tick rebuilds is on screen,
    // and a typed price so it has something to say.
    ;[...sh.querySelectorAll<HTMLElement>("button")]
      .find((b) => b.textContent === "When it hits")!
      .click()
    const sheet = sh.querySelector(".sheet")!
    const input = sh.querySelector<HTMLInputElement>(".price-in")!
    input.value = "0.10"
    input.dispatchEvent(new Event("input"))

    // Read off verdict()'s body: the reading line and the word span it
    // builds inside it, the balance, the message and its row, the primary
    // button, and the size picks.
    const written = [".dist", ".dist-w", ".bal", ".msg", ".msg-row", ".place", ".pick"]
    // Not a vacuous sweep: each of those is really on this sheet.
    expect(written.map((sel) => [sel, sheet.querySelectorAll(sel).length])).toEqual([
      [".dist", 1],
      [".dist-w", 1],
      [".bal", 1],
      [".msg", 1],
      [".msg-row", 1],
      [".place", 1],
      [".pick", 3],
    ])
    const titledWritten = () =>
      written.flatMap((sel) =>
        [...sheet.querySelectorAll(sel)].filter((n) => n.hasAttribute("title")).map(() => sel),
      )
    // Every title in the chip, by owner and text, so a REASSIGNMENT on a
    // tick is caught as well as an addition.
    const titles = () =>
      [...sh.querySelectorAll("[title]")].map(
        (n) => `${n.className || n.tagName}=${n.getAttribute("title")}`,
      )

    expect(titledWritten()).toEqual([])
    const before = titles()
    // And the sweep can see a title when there is one: the bell has one,
    // so an empty result here would mean the sweep itself was broken.
    expect(before.filter((t) => t.startsWith("bell="))).toHaveLength(1)

    // Twenty prints with the pointer nowhere near the chip.
    const readingBefore = sh.querySelector(".dist")!.textContent
    expect(readingBefore).toBeTruthy()
    for (let i = 0; i < 20; i++) ctl.updatePrice(mintKey, 0.2 + i / 100, 4)

    // ...and the ticks really did reach the OPEN SHEET, so the two sweeps
    // below are not measuring a sheet that stopped listening.
    expect(sh.querySelector(".dist")!.textContent).not.toBe(readingBefore)
    expect(titledWritten()).toEqual([])
    expect(titles()).toEqual(before)
  })

  it("keeps every tail control named for a screen reader", async () => {
    /**
     * REMOVING A TOOLTIP MUST NOT REMOVE A NAME. The bell and the wallet
     * are icon-only: without an accessible name they are two unlabelled
     * buttons. Buy and Sell carry their own text, and Buy's label also has
     * to keep saying WHAT A HOLD SPENDS — the amount used to ride the
     * title, and it may not simply be dropped on the floor.
     */
    const { sh } = await restingChip("9011")
    const named = (sel: string) => sh.querySelector(sel)!.getAttribute("aria-label") ?? ""
    expect(named(".ring")).toBe("Alerts and activity")
    expect(named(".wal")).toBe("Your balance and positions")
    // Leads with the word written on the key, so voice control still finds
    // it by what the reader can see, and carries the clip behind it.
    expect(named(".buy")).toMatch(/^Buy\b.*\$\d+/)
    expect(sh.querySelector(".sell")!.textContent).toBe("Sell")
  })

  it("does not leak its own pointer moves into X's article", async () => {
    /**
     * The host is planted INSIDE the article, and X's cell is a React
     * subtree that re-renders on its own hover state. mouseover/mouseout
     * between two controls of ours never get out — the DOM dispatch
     * algorithm stops the path at the node the relatedTarget retargets to,
     * which for two siblings in one shadow root is the host itself — but
     * mousemove has no relatedTarget and no such stop, so every frame of a
     * sweep across our keys used to arrive in X's tree as an event on the
     * cell. Fenced at the host, in the bubble phase, AFTER our own
     * listeners below it have already had it.
     */
    const { host, sh, article } = await restingChip("9012")
    const onArticle = vi.fn()
    const onDocument = vi.fn()
    const inside = vi.fn()
    article.addEventListener("mousemove", onArticle)
    document.addEventListener("mousemove", onDocument)
    sh.querySelector(".row")!.addEventListener("mousemove", inside)

    sh.querySelector<HTMLElement>(".buy")!.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, composed: true }),
    )

    // Ours still sees it; X does not, and neither does the page.
    expect(inside).toHaveBeenCalledTimes(1)
    expect(onArticle).not.toHaveBeenCalled()
    expect(onDocument).not.toHaveBeenCalled()
    document.removeEventListener("mousemove", onDocument)
    expect(host.isConnected).toBe(true)

    /**
     * AND THE CONTROL, so the assertion above can never pass for the wrong
     * reason. A composed event that is NOT fenced must still cross the
     * shadow boundary into the article — otherwise this test would be
     * proving something about the test environment rather than about the
     * fence. mouseover is the honest example: entering and leaving the
     * region we occupy is the host page's legitimate business, and
     * swallowing it is how a page's own hover state gets stuck lit.
     */
    const onOver = vi.fn()
    article.addEventListener("mouseover", onOver)
    sh.querySelector<HTMLElement>(".buy")!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, composed: true }),
    )
    expect(onOver).toHaveBeenCalledTimes(1)
  })
})

describe("flipping the sheet does not close the box", () => {
  const openSheet = async (id: string) => {
    const d = deps()
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    const sh = stripIn(cell)!.shadowRoot!
    sh.querySelector<HTMLElement>(".buy")!.click()
    return sh
  }
  const seg = (sh: ShadowRoot, label: string) =>
    [...sh.querySelectorAll<HTMLElement>(".segb, .kindb")].find((b) => b.textContent === label)!

  it("keeps the shell open and keeps the same close button through a flip", async () => {
    const sh = await openSheet("9020")
    const chip = sh.querySelector(".chip")!
    expect(chip.classList.contains("open")).toBe(true)
    const closeBefore = sh.querySelector(".end .quiet")
    expect(closeBefore).not.toBeNull()

    seg(sh, "Sell").click()

    // The shell never lets go, and — the part that was actually visible —
    // the close button is the SAME NODE. It used to be replaceChildren'd
    // and faded back in on every segment tap, i.e. destroyed under the
    // pointer that had just pressed the control beside it.
    expect(chip.classList.contains("open")).toBe(true)
    expect(sh.querySelector(".sheet")).not.toBeNull()
    expect(sh.querySelector(".end .quiet")).toBe(closeBefore)

    // And again on the other axis, which rebuilds a different layout.
    seg(sh, "When it hits").click()
    expect(chip.classList.contains("open")).toBe(true)
    expect(sh.querySelector(".sheet")).not.toBeNull()
    expect(sh.querySelector(".end .quiet")).toBe(closeBefore)
  })

  it("marks a replacement sheet as settled, and a first open as arriving", async () => {
    /**
     * The height already settled across a flip; the opacity did not, so the
     * surface being read blinked out and back while its height eased. Two
     * channels describing one event and disagreeing about whether it
     * happened. `.settled` kills the entrance for a replacement only.
     */
    const sh = await openSheet("9021")
    expect(sh.querySelector(".sheet")!.classList.contains("settled")).toBe(false)
    seg(sh, "Sell").click()
    expect(sh.querySelector(".sheet")!.classList.contains("settled")).toBe(true)
  })

  it("still collapses the shell when the reader closes it", async () => {
    // The flip must not have taught the chip to ignore a real dismissal —
    // that is what `.chip.closing` and its zero-duration exist for.
    const sh = await openSheet("9022")
    seg(sh, "Sell").click()
    sh.querySelector<HTMLElement>(".end .quiet")!.click()
    expect(sh.querySelector(".sheet")).toBeNull()
    expect(sh.querySelector(".chip")!.classList.contains("open")).toBe(false)
  })
})
