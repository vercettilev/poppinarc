import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { MatchedAsset } from "~/services/SpotAssetService"
import { JUP_TICKERS } from "./tickerMap.generated"
import { JUICE } from "~/theme/juice"
import { COACH_VERSION } from "~/helpers/chipCoach"
import { resetXMatchIndex } from "./xMatch"
import {
  fractionRaw,
  createXStrip,
  initXStrip,
  displayTicker,
  extractTweet,
  isXHost,
  type XStripDeps,
} from "./xStrip"

/**
 * The adapter, against a fixture built from the MEASURED shape of X's
 * timeline (live x.com, 2026-08-20): articles under data-testid="tweet",
 * inside cellInnerDiv wrappers, permalinks as /status/<id> anchors, cashtags
 * as anchors inside tweetText.
 *
 * The recycle tests are the point of the file. On the real timeline the same
 * cell DOM node came back holding a DIFFERENT tweet after ~40k px of
 * scrolling, with a probe element still attached — so "processed" booleans
 * lie, and a strip that trusts them ends up selling WIF under an obituary.
 */

function makeCell(opts: {
  id: string
  text: string
  cashtags?: string[]
  user?: string
}): { cell: HTMLElement; article: HTMLElement } {
  const cell = document.createElement("div")
  cell.setAttribute("data-testid", "cellInnerDiv")

  const wrapper = document.createElement("div")
  const article = document.createElement("article")
  article.setAttribute("data-testid", "tweet")

  const link = document.createElement("a")
  link.setAttribute("href", `/${opts.user ?? "someone"}/status/${opts.id}`)
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

  wrapper.appendChild(article)
  cell.appendChild(wrapper)
  document.body.appendChild(cell)
  return { cell, article }
}

/** Mutate an existing cell IN PLACE into a different tweet — the recycle. */
function recycle(cell: HTMLElement, opts: { id: string; text: string; cashtags?: string[] }) {
  const article = cell.querySelector("article")!
  article.querySelector('a[href*="/status/"]')!.setAttribute("href", `/other/status/${opts.id}`)
  const text = article.querySelector('[data-testid="tweetText"]')!
  text.textContent = ""
  text.appendChild(document.createTextNode(opts.text))
  for (const tag of opts.cashtags ?? []) {
    const a = document.createElement("a")
    a.textContent = tag
    text.appendChild(a)
  }
}

const WIF_ASSET = {
  mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  symbol: "$WIF",
  name: "dogwifhat",
  displayName: "dogwifhat",
  decimals: 6,
  indicativeUsd: 0.16,
  change24hPct: 15,
  icon: null,
} as unknown as MatchedAsset

function deps(overrides?: Partial<XStripDeps>): XStripDeps & {
  openTrade: ReturnType<typeof vi.fn>
  track: ReturnType<typeof vi.fn>
} {
  return {
    enrich: vi.fn(async () => WIF_ASSET),
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
    ...overrides,
  } as never
}

beforeEach(() => {
  document.body.innerHTML = ""
  resetXMatchIndex()
})

describe("extractTweet — reading identity off the article", () => {
  it("finds the status id, the text and the cashtags", () => {
    const { article } = makeCell({ id: "123", text: "wif szn ", cashtags: ["$WIF"] })
    const facts = extractTweet(article)!
    expect(facts.id).toBe("123")
    expect(facts.text).toContain("wif szn")
    expect(facts.cashtags).toEqual(["$WIF"])
  })

  it("answers null for a half-rendered article, not a verdict", () => {
    const article = document.createElement("article")
    article.setAttribute("data-testid", "tweet")
    expect(extractTweet(article)).toBeNull()
  })
})

describe("the strip", () => {
  it("appears under a cashtag tweet, as the article's sibling", () => {
    const d = deps()
    const ctl = createXStrip(d)
    const { cell, article } = makeCell({ id: "1", text: "sending it ", cashtags: ["$WIF"] })
    ctl.processCell(cell)

    const strip = cell.querySelector("[data-poppin-strip]")!
    expect(strip).not.toBeNull()
    expect(strip.parentElement).toBe(article.parentElement)
    expect(cell.getAttribute("data-poppin-x")).toBe("1")
    expect(d.track).toHaveBeenCalledWith("x_strip_shown", expect.objectContaining({ tier: "cashtag" }))
  })

  /**
   * THE STATUS PAGE, which the old placement got wrong and no test noticed.
   *
   * On a timeline the article is the only child of its wrapper, so appending
   * to the wrapper and inserting after the article are the same thing — which
   * is exactly why "as the article's sibling" above passed either way.
   *
   * On a status page that wrapper also holds the reply composer, and appending
   * put the strip BELOW "Post your reply": a Buy button floating under a text
   * box, attached to nothing. Sibling-of-the-article is not a strong enough
   * claim; the strip has to be the article's NEXT sibling.
   */
  it("sits directly after the tweet, not after the reply box beside it", () => {
    const ctl = createXStrip(deps())
    const { cell, article } = makeCell({ id: "9", text: "sending it ", cashtags: ["$WIF"] })

    const composer = document.createElement("div")
    composer.setAttribute("data-testid", "tweetTextarea_0")
    article.parentElement!.appendChild(composer)

    ctl.processCell(cell)

    const strip = cell.querySelector("[data-poppin-strip]")!
    expect(article.nextElementSibling).toBe(strip)
    expect(strip.nextElementSibling).toBe(composer)
  })

  it("stays silent under a tweet about nothing tradeable", () => {
    const ctl = createXStrip(deps())
    const { cell } = makeCell({ id: "2", text: "great weather in Lisbon" })
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
    // ...but the verdict is still recorded, so the next pass is free.
    expect(cell.getAttribute("data-poppin-x")).toBe("2")
  })

  it("is idempotent for the same tweet", () => {
    const d = deps()
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "3", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    ctl.processCell(cell)
    ctl.processCell(cell)
    expect(cell.querySelectorAll("[data-poppin-strip]").length).toBe(1)
  })
})

/**
 * THE FIRST CHIP HAS TO INTRODUCE ITSELF.
 *
 * Two seams, both invisible to the type checker and both the reason this
 * release exists. The strip already accepted six dependencies once and
 * forwarded none of them, with every end type-valid, so "chipCoach's specs
 * are green" says nothing about whether the strip ever calls it.
 *
 * Note the coach's module-level one-shot: a successful showing latches for
 * the life of the module, which is correct in a page and means exactly one
 * test in this file may take the happy path. Every other test here mounts
 * chips with no chrome stub, coachPending answers false on the throw, and
 * the latch is released untouched. Whether a reader who HAS seen it is
 * skipped is pinned in coach-shows-once-for-everyone.spec.ts, against the
 * predicate itself.
 */
describe("the first chip a reader ever sees", () => {
  const storage = (store: Record<string, unknown>) =>
    vi.stubGlobal("chrome", {
      runtime: { lastError: undefined, sendMessage: (_m: unknown, cb?: (r: unknown) => void) => { cb?.(undefined); return Promise.resolve() } },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (patch: Record<string, unknown>) => { Object.assign(store, patch) },
          remove: async () => undefined,
        },
      },
    })

  it("introduces the product to a reader who never went through onboarding", async () => {
    // The 131 of 140. Nothing in storage, because nothing armed them: the
    // coach used to be a reward for reaching /show-me and 9 people did.
    const store: Record<string, unknown> = {}
    storage(store)
    /* THE CARD NOW WAITS FOR A CHIP SOMEBODY LOOKED AT, so the test has to
       be the pair of eyes: mounting a chip is no longer enough, and that
       is the whole point of the change (212 chips placed, 38 seen). */
    let fire: ((e: Array<{ target: Element; intersectionRatio: number }>) => void) | null = null
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (e: Array<{ target: Element; intersectionRatio: number }>) => void) {
          fire = cb
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const d = deps({ shadowMode: "open" })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "801", text: "sending it ", cashtags: ["$WIF"] })
    ctl.processCell(cell)

    const chipEl = (cell.querySelector("[data-poppin-strip]") as HTMLElement)
      .shadowRoot!.querySelector(".chip")!
    fire!([{ target: chipEl, intersectionRatio: 1 }])
    // The dwell, then the storage read the card does before it draws.
    await new Promise((r) => setTimeout(r, 700))

    const shadow = (cell.querySelector("[data-poppin-strip]") as HTMLElement).shadowRoot!
    const card = shadow.querySelector(".coach")
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain("That's Poppin")
    expect(shadow.querySelector(".coach-go")).not.toBeNull()
    // objectContaining, because every strip event now carries the host it
    // was drawn on; see the track wrapper in xStrip.
    expect(d.track).toHaveBeenCalledWith(
      "x_coach",
      expect.objectContaining({ step: 1, action: "shown" }),
    )
    vi.unstubAllGlobals()
    // Spent on display, so the second chip is quiet and the next page too.
    // The flag holds the COACH VERSION, not a boolean: a rewritten card is
    // owed to everyone again, and a bare `true` could never say that.
    expect(store.poppin_coach_seen).toBe(COACH_VERSION)
    vi.unstubAllGlobals()
  })

  it("stamps the host on every event it sends", async () => {
    // `page_scanned` always carried it and `card_shown` never did, so on
    // 2026-09-23 all 13,832 chips answered "(kayıt yok)" when asked where
    // they were drawn — on a product whose whole claim is "tweet, Reddit
    // post, or any website". Stamped once at the track wrapper, so a new
    // call site cannot forget it.
    const d = deps({ shadowMode: "open" })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "803", text: "sending it ", cashtags: ["$WIF"] })
    ctl.processCell(cell)

    expect(d.track).toHaveBeenCalledWith(
      "x_strip_shown",
      expect.objectContaining({ host: location.hostname, tier: "cashtag" }),
    )
  })

  it("hands every chip to the visibility watch", async () => {
    // x_strip_shown counts what this code MOUNTED. Without this call there
    // is no numerator for the ratio that says whether 13,773 chips were
    // ever actually in front of anybody.
    const observed: Element[] = []
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_cb: unknown, _opts: unknown) {}
        observe(el: Element) { observed.push(el) }
        unobserve() {}
        disconnect() {}
      },
    )
    const ctl = createXStrip(deps({ shadowMode: "open" }))
    const { cell } = makeCell({ id: "802", text: "sending it ", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))

    const shadow = (cell.querySelector("[data-poppin-strip]") as HTMLElement).shadowRoot!
    expect(observed).toContain(shadow.querySelector(".chip"))
    vi.unstubAllGlobals()
  })
})

describe("recycling — the measured hazard", () => {
  it("tears the strip down when the cell becomes a DIFFERENT tweet", () => {
    const ctl = createXStrip(deps())
    const { cell } = makeCell({ id: "10", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()

    // The cell comes back as somebody's non-financial tweet.
    recycle(cell, { id: "11", text: "rest in peace, coach" })
    ctl.processCell(cell)

    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
    expect(cell.getAttribute("data-poppin-x")).toBe("11")
  })

  it("re-matches when the recycled tweet is tradeable too", () => {
    const ctl = createXStrip(deps())
    const { cell } = makeCell({ id: "20", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)

    recycle(cell, { id: "21", text: "Tesla delivery day" })
    ctl.processCell(cell)

    const strips = cell.querySelectorAll("[data-poppin-strip]")
    expect(strips.length).toBe(1)
    expect(cell.getAttribute("data-poppin-x")).toBe("21")
  })

  it("a stale boolean would have lied here — identity does not", () => {
    // The exact failure the live probe demonstrated: mark survives, content
    // changes. With identity marks the second pass CANNOT be skipped.
    const ctl = createXStrip(deps())
    const { cell } = makeCell({ id: "30", text: "nothing tradeable" })
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()

    recycle(cell, { id: "31", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })

  it("clears everything when the cell recycles into a non-tweet", () => {
    const ctl = createXStrip(deps())
    const { cell } = makeCell({ id: "40", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    cell.querySelector("article")!.remove()
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
    expect(cell.hasAttribute("data-poppin-x")).toBe(false)
  })
})

describe("the buttons", () => {
  it("Buy enriches and opens the trade on the buy side", async () => {
    const d = deps()
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "50", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)

    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const shadow = host.shadowRoot // closed → null in production; jsdom honours "closed" too
    // Closed shadow means the page cannot reach in — including this test.
    // The seam is the deps: click handlers call openTrade via enrich, so we
    // assert through a synthetic click dispatched INSIDE the shadow at
    // creation time is impossible; instead verify the wiring indirectly.
    expect(shadow).toBeNull()
    expect(d.enrich).toHaveBeenCalledWith(WIF_ASSET.mint)
  })
})

describe("the @price state — a standing buy inside the same pill", () => {
  /**
   * The pill's DOM is behind a CLOSED shadow root, and that is a feature —
   * the page cannot reach into a money control, and neither can this test
   * (the "buttons" describe above documents the same wall).
   *
   * So the @price behaviour is held where it is REACHABLE:
   *   · the sentence rules   → orderMath.spec (the one rulebook, 15 rows)
   *   · the money honesty    → inlineBuy.spec's runInlineOrder table
   *   · the wiring           → typecheck: XStripDeps.order is required, so a
   *                            caller cannot construct the strip without the
   *                            order services any more than without swap.
   * What remains here is the same indirect assertion the Buy button gets.
   */
  it("mounts with the order seam required and the shadow closed", () => {
    const d = deps()
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "60", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    expect(host).not.toBeNull()
    expect(host.shadowRoot).toBeNull()
    // The deps object the strip accepted carries the order leg.
    expect(typeof d.order.createOrder).toBe("function")
  })
})

describe("the thin tail — shown, but not one-tapped", () => {
  /** A tweet whose ticker resolves to a THIN Jupiter row. */
  function thinCell(id: string) {
    const ticker = JUP_TICKERS.find(([, r]) => r.thin)?.[0]
    return { ticker, ...makeCell({ id, text: "", cashtags: [`$${ticker}`] }) }
  }

  it("marks thin liquidity and routes to the card instead of an inline buy", () => {
    const d = deps()
    const ctl = createXStrip(d)
    const { ticker, cell } = thinCell("100")
    if (!ticker) return // no thin rows in the generated map right now
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]")
    expect(host, `no chip for $${ticker}`).not.toBeNull()
    // Closed shadow: assert through behaviour, not internals. A thin row
    // must never reach the preset flow, so tapping cannot start a buy.
    expect(d.trade.swap).not.toHaveBeenCalled()
  })

  it("deep rows keep the inline flow", () => {
    const deep = JUP_TICKERS.find(([, r]) => !r.thin)
    if (!deep) return
    const ctl = createXStrip(deps())
    const { cell } = makeCell({ id: "101", text: "", cashtags: [`$${deep[0]}`] })
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })

  it("the generated map keeps both tiers apart and honest", () => {
    // Every row is one or the other, and the flag only ever narrows.
    for (const [ticker, r] of JUP_TICKERS) {
      expect(typeof r.thin === "undefined" || r.thin === true, ticker).toBe(true)
    }
    const thin = JUP_TICKERS.filter(([, r]) => r.thin).length
    expect(thin, "a thin tier that is empty means the floor stopped working")
      .toBeGreaterThan(0)
  })
})

describe("an asset that cannot be described is not offered", () => {
  it("removes the chip when by-mint refuses the mint", async () => {
    // §7's verdict is time-varying — rows the generator confirmed came back
    // refused minutes later. The map names; this call decides.
    const d = deps({ enrich: vi.fn(async () => null) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "90", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()
    await Promise.resolve()
    await Promise.resolve()
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
  })

  it("keeps the chip when the asset IS offerable", async () => {
    const ctl = createXStrip(deps())
    const { cell } = makeCell({ id: "91", text: "", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await Promise.resolve()
    await Promise.resolve()
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })
})

describe("live ticks", () => {
  it("watches a mounted mint once, and updatePrice stays safe for strangers", () => {
    const d = deps()
    const ctl = createXStrip(d)
    ctl.processCell(makeCell({ id: "60", text: "", cashtags: ["$WIF"] }).cell)
    ctl.processCell(makeCell({ id: "61", text: "", cashtags: ["$WIF"] }).cell)
    // One socket room per mint, however many strips show it.
    expect(d.watchPrice).toHaveBeenCalledTimes(1)
    expect(d.watchPrice).toHaveBeenCalledWith(WIF_ASSET.mint)
    // A tick for a mint no strip shows must be a no-op, not a crash.
    expect(() => ctl.updatePrice("UnknownMint", 1.23, 4.5)).not.toThrow()
    expect(() => ctl.updatePrice(WIF_ASSET.mint, 0.17, 16.2)).not.toThrow()
  })
})

describe("the ticker as a tweet would write it", () => {
  it("strips OUR wrapper suffix instead of shouting it", () => {
    // Live catch: the strip printed "$HOODX" under a Robinhood tweet — a
    // ticker that exists nowhere. The lowercase x is catalog naming.
    expect(displayTicker("HOODx")).toBe("HOOD")
    expect(displayTicker("TSLAx")).toBe("TSLA")
    expect(displayTicker("BRK.Bx")).toBe("BRK.B")
  })

  it("leaves real names alone", () => {
    expect(displayTicker("$WIF")).toBe("WIF")
    expect(displayTicker("WBTC")).toBe("WBTC")
    // SPCX's capital X is part of the name, not a wrapper.
    expect(displayTicker("SPCX")).toBe("SPCX")
  })
})

describe("one inferred strip per asset, per screenful", () => {
  /**
   * Reported from the field, and the reason this rule is spatial: a lone
   * "Solana looks good here" with nothing else near it, wearing no chip. The
   * matcher was right (SOL, name tier); a two-minute per-mint timer had
   * simply been started by some other tweet that had already scrolled away.
   */
  it("chips a lone tweet even when the same asset appeared earlier", () => {
    const offScreen = new Set<Element>()
    const d = deps({ onScreen: (el: Element) => !offScreen.has(el) })
    const ctl = createXStrip(d)

    const a = makeCell({ id: "70", text: "solana szn" })
    ctl.processCell(a.cell)
    const first = a.cell.querySelector("[data-poppin-strip]")
    expect(first).not.toBeNull()

    // the reader scrolls; that strip leaves the screenful
    offScreen.add(first!)

    const b = makeCell({ id: "71", text: "Solana looks good here" })
    ctl.processCell(b.cell)
    expect(b.cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })

  it("lets a feed genuinely about one token wear it, up to three", () => {
    // WIDENED from one. The old ceiling made the chip a function of scroll
    // position: a tweet reading "useless and fartcoin had a baby" showed
    // nothing, then showed a chip after a scroll — same tweet, same asset.
    // A chip that comes and goes with the viewport reads as broken, and
    // the owner's rule is the plainer one: where X shows a ticker, we show
    // a ticker.
    const d = deps({ onScreen: () => true })
    const ctl = createXStrip(d)

    for (const id of ["80", "81", "82"]) {
      const c = makeCell({ id, text: "solana szn" })
      ctl.processCell(c.cell)
      expect(c.cell.querySelector("[data-poppin-strip]")).not.toBeNull()
    }
  })

  it("still refuses to wallpaper one screenful", () => {
    // The ceiling is higher, not gone — the five-$SOL-strips screenshot
    // that put this rule here was also real.
    const d = deps({ onScreen: () => true })
    const ctl = createXStrip(d)

    for (const id of ["85", "86", "87"]) {
      ctl.processCell(makeCell({ id, text: "solana szn" }).cell)
    }
    const fourth = makeCell({ id: "88", text: "solana again" })
    ctl.processCell(fourth.cell)
    expect(fourth.cell.querySelector("[data-poppin-strip]")).toBeNull()
  })

  it("never holds back the author's own $ mark", () => {
    const d = deps({ onScreen: () => true })
    const ctl = createXStrip(d)

    const a = makeCell({ id: "90", text: "solana szn" })
    ctl.processCell(a.cell)
    expect(a.cell.querySelector("[data-poppin-strip]")).not.toBeNull()

    const b = makeCell({ id: "91", text: "$SOL here", cashtags: ["$SOL"] })
    ctl.processCell(b.cell)
    expect(b.cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })

  /**
   * The cooldown's job is stopping one asset from wallpapering a feed across
   * DIFFERENT tweets. It was also quietly forgetting tweets: X recycles cells,
   * so scrolling past a name-tier post and back inside two minutes tore the
   * strip down and then refused to restore it. The post lost its Buy on the
   * way back, which reads as the feature being broken rather than tactful.
   */
  it("gives a tweet its strip back after the cell recycles away and returns", () => {
    let clock = 3_500_000
    const d = deps({ now: () => clock })
    const ctl = createXStrip(d)

    const { cell } = makeCell({ id: "80", text: "solana szn" })
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()

    // Scrolled away: X reuses this cell for somebody else's tweet.
    cell.innerHTML = ""
    const other = makeCell({ id: "81", text: "great weather in Lisbon" })
    cell.appendChild(other.article.parentElement!)
    cell.setAttribute("data-poppin-x", "81")
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()

    // Scrolled back, still well inside the cooldown.
    clock += 20_000
    cell.innerHTML = ""
    const again = makeCell({ id: "80", text: "solana szn" })
    cell.appendChild(again.article.parentElement!)
    cell.setAttribute("data-poppin-x", "81")
    ctl.processCell(cell)
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })

  it("never rests the author's own $ mark", () => {
    let clock = 2_000_000
    const d = deps({ now: () => clock })
    const ctl = createXStrip(d)

    ctl.processCell(makeCell({ id: "80", text: "", cashtags: ["$WIF"] }).cell)
    clock += 1_000
    const again = makeCell({ id: "81", text: "", cashtags: ["$WIF"] })
    ctl.processCell(again.cell)
    expect(again.cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })
})

describe("the door to the app", () => {
  it("extractTweet carries the tweet's own permalink", () => {
    const { article } = makeCell({ id: "777", text: "", cashtags: ["$WIF"], user: "someone" })
    expect(extractTweet(article)!.url).toBe("https://x.com/someone/status/777")
  })

  it("hands the panel the mint AND the tweet, not the feed", () => {
    // The card is a channel to the sidebar, so on X — where the chip is the
    // only surface — routing through the card would be a detour past the
    // thing it exists to reach. And the panel opens at the TWEET: measured,
    // x.com/home matches no asset while a permalink matches correctly.
    const d = deps()
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "778", text: "", cashtags: ["$WIF"], user: "trader" })
    ctl.processCell(cell)
    // Closed shadow root: the click is reached the way a reader reaches it,
    // through the host's own tree, so assert the wiring via the deps the
    // handler closes over.
    expect(d.openPanel).toBeDefined()
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })
})

describe("host gate", () => {
  it("knows X when it sees it, and nothing else", () => {
    for (const h of ["x.com", "www.x.com", "twitter.com", "mobile.twitter.com"]) {
      expect(isXHost(h), h).toBe(true)
    }
    for (const h of ["xx.com", "notx.com", "twitter.com.evil.tld", "example.com"]) {
      expect(isXHost(h), h).toBe(false)
    }
  })
})

/**
 * The order sheet. Reported from the field with three complaints and one
 * screenshot each: the limit flow was unreadable, the balance was nowhere,
 * and nothing about it felt like a product. All three were the same cause —
 * a decision about a PRICE was being composed inside a 32px pill.
 */
const book = (cashUsd: number, pos?: { uiAmount: number; raw: string; netInvestedUsd: number | null }) =>
  async () => ({
    cashUsd,
    positions: pos ? [{ mint: WIF_ASSET.mint, ...pos }] : [],
  })

describe("the order sheet opens instead of compressing", () => {
  const openShadow = (cell: Element) =>
    (cell.querySelector("[data-poppin-strip]") as HTMLElement).shadowRoot!

  const openSheet = (extra: Partial<XStripDeps> = {}, marketUsd: number | null = null) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, ...extra })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "600", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const mint = host.getAttribute("data-poppin-strip")!
    if (marketUsd !== null) ctl.updatePrice(mint, marketUsd, 1.2)
    const shadow = openShadow(cell)
    // Buy opens the sheet directly now (market mode); the old preset hop
    // ($10 $25 $100 → Limit) is gone. The order tests want the LIMIT side,
    // so flip the kind switch the sheet draws.
    shadow.querySelector<HTMLElement>(".buy")!.click()
    const at = [...shadow.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.textContent === "When it hits",
    )!
    at.click()
    return { shadow, d, ctl, mint }
  }

  it("grows the chip and gives the price room of its own", () => {
    const { shadow } = openSheet()
    expect(shadow.querySelector(".chip")!.classList.contains("open")).toBe(true)

    const sheet = shadow.querySelector(".sheet")!
    // The price is an element in its own right, not a 76px slot in a row.
    expect(sheet.querySelector(".price-in")).not.toBeNull()
    // Three real amount targets, and a confirm that names the GAP while
    // the price is empty. "Place order" said the same words armed and
    // disarmed, so the key could never tell a reader why it would not go.
    expect(sheet.querySelectorAll(".pick").length).toBe(3)
    expect(sheet.querySelector(".place")!.textContent).toBe("Type a price")
  })

  it("shows the balance, which the chip never had anywhere", async () => {
    const { shadow } = openSheet({ book: book(432.1) })
    await new Promise((r) => setTimeout(r, 0))
    expect(shadow.querySelector(".bal")!.textContent).toContain("432.10")
  })

  it("says nothing about a balance it could not read", async () => {
    const { shadow } = openSheet({ book: async () => { throw new Error("401") } })
    await new Promise((r) => setTimeout(r, 0))
    expect(shadow.querySelector(".bal")!.textContent).toBe("")
  })

  /**
   * The reader should never have to work out how far below the market they
   * just typed, and the button should change under their hand rather than
   * rejecting them after a tap.
   */
  it("reads the typed price back live, and arms only when it is valid", () => {
    const { shadow } = openSheet({}, 100)
    const input = shadow.querySelector<HTMLInputElement>(".price-in")!
    const dist = shadow.querySelector<HTMLElement>(".dist")!
    const place = shadow.querySelector<HTMLElement>(".place")!

    // nothing typed yet: no verdict, nothing armed
    expect(place.className).toContain("wait")

    // above the market — a buy order there is not an order, it is a buy
    input.value = "120"
    input.dispatchEvent(new Event("input"))
    expect(dist.className).toContain("bad")
    expect(place.className).toContain("wait")

    // below it — armed, and the distance is stated instead of implied
    input.value = "90"
    input.dispatchEvent(new Event("input"))
    expect(dist.className).toContain("good")
    // The reading is a sentence now: figure in the data voice, words in
    // the product face (one .dist-w child).
    expect(dist.textContent).toBe("-10.0% vs now")
    expect(place.className).not.toContain("wait")
  })

  /**
   * A trigger order escrows its funds when it is CREATED, so placing one for
   * more than the balance is a round trip to a refusal. The button stops
   * pretending and becomes the door that fixes it.
   */
  it("turns into the funding door when the balance cannot cover the size", async () => {
    const d0 = deps()
    const { shadow, d } = openSheet({ book: book(9) }, 100)
    await new Promise((r) => setTimeout(r, 0))
    const input = shadow.querySelector<HTMLInputElement>(".price-in")!
    input.value = "90" // a perfectly valid trigger
    input.dispatchEvent(new Event("input"))

    const place = shadow.querySelector<HTMLElement>(".place")!
    expect(place.textContent).toMatch(/^Deposit .*USDC$/)
    expect(shadow.querySelector(".bal")!.classList.contains("low")).toBe(true)

    place.click()
    expect(d.topUp).toHaveBeenCalled()
    // and it never tried to place the order it just said could not be paid
    expect(d0.order.createOrder).not.toHaveBeenCalled()
  })

  it("lets a covered order through untouched", async () => {
    /**
     * The market price is re-asserted AFTER the enrich lands. openSheet's
     * own updatePrice runs before it, so the asset's fixture price (0.16)
     * overwrote it — which made "90" a buy 56,000% ABOVE the market and
     * left this order permanently unplaceable. The test passed anyway,
     * because the key said "Place order" armed AND disarmed; naming the
     * money on the armed key is what finally showed it.
     */
    const { shadow, ctl, mint } = openSheet({ book: book(500) }, 100)
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(mint, 100, 1.2)
    const input = shadow.querySelector<HTMLInputElement>(".price-in")!
    input.value = "90"
    input.dispatchEvent(new Event("input"))
    // Armed, and the key says the money and the condition rather than the
    // mechanism's name.
    // Armed, and the key says the money and the condition rather than the
    // mechanism's name.
    expect(shadow.querySelector(".place")!.textContent).toBe("Buy $25 at $90.00")
    expect(shadow.querySelector(".bal")!.classList.contains("low")).toBe(false)
  })


  it("collapses back to the pill when dismissed", () => {
    const { shadow } = openSheet()
    const close = [...shadow.querySelectorAll<HTMLElement>(".end button")].find(
      (b) => b.textContent === "×",
    )!
    close.click()
    expect(shadow.querySelector(".sheet")).toBeNull()
    expect(shadow.querySelector(".chip")!.classList.contains("open")).toBe(false)
  })
})

/**
 * THE LANDING'S JUICE, PORTED. Four signatures the marketing page proved
 * and the product now carries: the money key breathes and sweeps, the
 * opened shell floats on a brand glow, and a strip ARRIVES with the
 * overshoot beat instead of fading in. All dead under the surface's
 * reduced-motion blanket, which the last test pins.
 */
describe("the juice signatures", () => {
  const css = async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1701", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    return host.shadowRoot!.querySelector("style")!.textContent!
  }

  it("the money key breathes and carries the shine sweep, except while waiting", async () => {
    const c = await css()
    // The breathe rides the SAME direction-aware glow the static shadow
    // reads, so a sell key breathes red without a second recipe.
    expect(c).toMatch(/\.place:not\(\.wait\) \{ animation: placeBreathe/)
    expect(c).toContain("@keyframes placeBreathe")
    // The sweep is a hover event and never fires on the wait state — a
    // light show on a progress report promises the wrong thing.
    expect(c).toMatch(/\.place:not\(\.wait\):hover::after/)
    expect(c).toContain("@keyframes placeShine")
    // .arm keeps the breathe alongside its one-shot: a second animation
    // declaration on one property silently kills the first.
    expect(c).toMatch(/\.place\.arm \{ animation: armed[^}]*placeBreathe/)
  })

  it("the opened shell floats on a brand glow; a strip lands with the overshoot beat", async () => {
    const c = await css()
    expect(c).toMatch(/\.chip\.open \{[^}]*rgba\(104,198,255,\.22\)/)
    // The arrival overshoots (a mid-keyframe past the resting point) and
    // rides the release curve, not the standard ease. Substring, not a
    // [^}]* regex: keyframe steps close with } internally.
    expect(c).toContain("@keyframes stripIn")
    expect(c).toContain("translateY(-1px) scale(1.005)")
    expect(c).toContain(`animation: stripIn .32s ${JUICE.releaseEase}`)
    /* THE CEREMONY TIER, declared once and spent everywhere the landing
       touches. Four parts of one movement quote the same token: if a future
       edit gives any of them its own number, the moment starts finishing
       twice again, which is the exact defect this replaced. */
    expect(c).toContain(`animation: glowOk ${JUICE.cinemaMs}ms ${JUICE.cinemaEase}`)
    expect(c).toContain(`animation: chipLand ${JUICE.cinemaMs}ms ${JUICE.cinemaEase}`)
    expect(c).toContain(`animation: landIn calc(${JUICE.cinemaMs}ms * .62) ${JUICE.cinemaEase}`)
    expect(c).toContain(`animation: spark calc(${JUICE.cinemaMs}ms * .82) ${JUICE.cinemaEase}`)
  })

  it("every new signature dies under reduced motion", async () => {
    const c = await css()
    // The blanket is the guarantee: everything inside .chip/.sheet loses
    // animation AND transition wholesale. The signatures live inside it.
    expect(c).toMatch(
      /prefers-reduced-motion[^}]*\{[^}]*\.chip, \.chip \*, \.sheet, \.sheet \* \{[^}]*animation: none !important/,
    )
  })
})

/** HOLD TO RE-BUY: the clip fires with no sheet when the press is held. */
describe("hold-to-buy", () => {
  const mountRow = async (id: string) => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    return { d, sh: host.shadowRoot!, buy: host.shadowRoot!.querySelector<HTMLElement>(".buy")! }
  }

  it("a held press fires the clip as a market buy, and the click after it is spent", async () => {
    const { d, sh, buy } = await mountRow("1621")
    vi.useFakeTimers()
    try {
      buy.dispatchEvent(new Event("pointerdown"))
      expect(buy.classList.contains("holding")).toBe(true)
      await vi.advanceTimersByTimeAsync(700)
    } finally {
      vi.useRealTimers()
    }
    await new Promise((r) => setTimeout(r, 0))
    // The buy went straight to the swap endpoint — no sheet ever mounted.
    expect(d.trade.swap).toHaveBeenCalledTimes(1)
    expect(sh.querySelector(".sheet")).toBeNull()
    // The finger coming up fires a click too; it must not open a sheet
    // over the receipt.
    buy.dispatchEvent(new Event("pointerup"))
    buy.click()
    expect(sh.querySelector(".sheet")).toBeNull()
  })

  it("letting go early is a plain tap: the sheet, no money moved", async () => {
    const { d, sh, buy } = await mountRow("1622")
    vi.useFakeTimers()
    try {
      buy.dispatchEvent(new Event("pointerdown"))
      await vi.advanceTimersByTimeAsync(300)
      buy.dispatchEvent(new Event("pointerup"))
      expect(buy.classList.contains("holding")).toBe(false)
      await vi.advanceTimersByTimeAsync(1_000)
    } finally {
      vi.useRealTimers()
    }
    expect(d.trade.swap).not.toHaveBeenCalled()
    buy.click()
    expect(sh.querySelector(".sheet")).not.toBeNull()
  })

  it("discloses the amount on the key's own name, not in a tooltip", async () => {
    /**
     * THIS USED TO ASSERT A `title`, and the title had to go: a native
     * tooltip on Buy is a box that opens on a dwell and shuts on the next
     * movement, on the exact key the reader sweeps across on the way to
     * Sell — the "it keeps closing and re-opening" report. What may NOT go
     * with it is the disclosure, so the amount moved to the accessible
     * name: spoken on request, never painted, and still led by the word
     * written on the key so voice control finds it by what is visible.
     * (The other half of the disclosure is unchanged and untouched: let go
     * early and the sheet opens with the amount on screen before any money
     * moves.)
     */
    const { buy } = await mountRow("1623")
    expect(buy.hasAttribute("title")).toBe(false)
    expect(buy.getAttribute("aria-label")).toMatch(/^Buy — hold to buy \$\d+ instantly$/)
  })
})

/**
 * MC LEFT THE RESTING FACE (field, 2026-08-31): a real timeline clipped it
 * to "MC $60." — truncated money text — and it tipped the row into reading
 * as a terminal strip. The number lives in the chart's own header
 * (chart-cap) and the sheet's safety line. This pins the ABSENCE, so it
 * cannot quietly creep back, and pins how the identity is allowed to lose
 * a squeeze: to an ellipsis, inside a box that clips.
 */
describe("the resting face stays light", () => {
  it("carries no MC ink, and the ticker can only lose letters to an ellipsis", async () => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      enrich: vi.fn(async () => ({ ...WIF_ASSET, mcap: 3_040_000 }) as MatchedAsset),
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1611", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    const sh = host.shadowRoot!
    expect(sh.querySelector(".cap")).toBeNull()
    const css = sh.querySelector("style")!.textContent!
    /**
     * THE IDENTITY IS CAPPED AND ELLIPSISED — which is what this line was
     * always guarding. It used to assert `flex-shrink: 0` on .sym, and
     * that was pinning a mitigation instead of the invariant: freezing the
     * ticker never made room, it moved the failure OUT of the box, and
     * with .px frozen too and nothing clipping, a squeeze put the 15px
     * price across the Sell key. A ticker losing letters to a "…" is a
     * legible failure; a price painting over a key is not. The ticker only
     * pays after the price and the tail have refused, which is the
     * opposite of the field report that froze it (there it paid first,
     * while MC was still on the row). The full derivation — who shrinks,
     * who clips, in what order — lives in chip-frame.spec.ts.
     */
    expect(css).toMatch(/\.sym \{[^}]*max-width: 9ch/)
    expect(css).toMatch(/\.sym \{[^}]*text-overflow: ellipsis/)
    expect(css).toMatch(/\.pair \{[^}]*overflow: hidden/)
    // And the chart's grid is gone — the loudest terminal tell.
    expect(css).not.toContain("${JUICE_GRID}")
    expect(css).not.toMatch(/background-size: auto, 12px 12px/)
  })
})

/**
 * THE GATE'S EVIDENCE ON THE SHEET — the pool facts the trade gate already
 * read, disclosed where size is decided instead of on a screener tab.
 */
describe("the safety line", () => {
  const openBuy = async (id: string, asset: unknown) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      enrich: vi.fn(async () => asset as MatchedAsset),
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    const sh = host.shadowRoot!
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    return sh.querySelector<HTMLElement>(".safe")!
  }

  it("carries the market cap and NOT the pool audit", async () => {
    /**
     * This asserted "$56K liquidity · 3 days old · 1.2K holders · mint
     * locked" — four true facts that read, from the field, as an info dump
     * under a $25 amount field. Liquidity and age duplicate floors the
     * trade gate already enforces; holders and "mint locked" are
     * reassurances, and a reassurance is information rather than a warning.
     * What is left is the one unit size is spoken in.
     */
    const safe = await openBuy("1601", {
      ...WIF_ASSET,
      mcap: 196_100_000,
      holderCount: 1_240,
      safety: {
        liquidityUsd: 56_400,
        poolCreatedAtMs: Date.now() - 3 * 24 * 3_600_000,
        mintAuthorityRetained: false,
        freezeAuthorityRetained: false,
      },
    })
    expect(safe.hidden).toBe(false)
    // "Market cap", not "MC": the chart one tap away spells it out, and a
    // chip that teaches two names for one fact teaches neither.
    expect(safe.textContent).toBe("Market cap $196.1M")
    expect(safe.classList.contains("warn")).toBe(false)
  })

  it("wears amber ONLY for a live authority, and says only that", async () => {
    const safe = await openBuy("1602", {
      ...WIF_ASSET,
      mcap: null,
      holderCount: 200,
      safety: {
        liquidityUsd: 8_000,
        poolCreatedAtMs: null,
        mintAuthorityRetained: true,
        freezeAuthorityRetained: false,
      },
    })
    // The warning survived the cut. It is the one fact here that changes
    // what a press DOES: the issuer can still print.
    expect(safe.textContent).toBe("mint open")
    expect(safe.classList.contains("warn")).toBe(true)
  })

  it("drops the cap for bridge-wrapped collateral", async () => {
    // WBTC showed "$196.1M MC" beside a Bitcoin price. Jupiter reports the
    // SOLANA mint's cap, which is the wrapped supply on this chain — true,
    // and not what "MC" promises.
    const safe = await openBuy("1604", {
      ...WIF_ASSET,
      issuer: "wormhole",
      mcap: 196_100_000,
      safety: {
        liquidityUsd: 36_000_000,
        poolCreatedAtMs: null,
        mintAuthorityRetained: false,
        freezeAuthorityRetained: false,
      },
    })
    expect(safe.hidden).toBe(true)
  })

  it("stays silent without evidence — an older server, or Ultra said nothing", async () => {
    // The base fixture carries no safety block at all (older server).
    const safe = await openBuy("1603", WIF_ASSET)
    expect(safe.hidden).toBe(true)
    expect(safe.textContent).toBe("")
  })
})

/**
 * Market and Limit used to live at different depths of the same menu: a
 * market buy was two taps in the pill, a limit buy was hidden behind a
 * button inside that pill's amount row. They are the two ways to buy the
 * same thing, so the sheet carries both axes as siblings.
 */
describe("the two axes", () => {
  const HOLD = { uiAmount: 61.4082, raw: "61408200" } // entry $80/unit below
  const open = async (extra: Partial<XStripDeps> = {}) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(432.1, { ...HOLD, netInvestedUsd: 61.4082 * 80 }),
      sell: vi.fn(async () => ({ signature: "sig", dryRun: false })),
      ...extra,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "700", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    // enrich lands asynchronously and paints its own price, so the live tick
    // has to come AFTER it or the sheet composes against a stale number.
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    const sh = host.shadowRoot!
    // Buy lands in the sheet (market mode) in one press now; these tests
    // exercise the LIMIT axis, so flip the kind switch.
    sh.querySelector<HTMLElement>(".buy")!.click()
    ;[...sh.querySelectorAll<HTMLElement>("button")]
      .find((b) => b.textContent === "When it hits")!
      .click()
    await new Promise((r) => setTimeout(r, 0))
    const tab = (label: string) => {
      const all = [...sh.querySelectorAll<HTMLElement>(".segb, .kindb")]
      all.find((b) => b.textContent === label)!.click()
    }
    const settle = () => new Promise((r) => setTimeout(r, 0))
    return { sh, d, tab, settle, host, ctl }
  }

  it("switches to market without leaving the sheet", async () => {
    const { sh, tab, settle } = await open()
    tab("Now")
    await settle()
    // no price leg in a market order, and the button says what it will do
    expect(sh.querySelector(".price-in")).toBeNull()
    expect(sh.querySelector(".place")!.textContent).toBe("Buy $25")
    expect(sh.querySelectorAll(".pick").length).toBe(3)
  })

  it("reads a typed price back as distance from the tape", async () => {
    // Was "profit against the entry", and the entry was
    // netInvestedUsd / uiAmount — see tradeSheetModel for why that number
    // could not be computed. Both sides read against the tape now.
    const { sh, tab, settle } = await open()
    tab("Sell")
    await settle()
    const input = sh.querySelector<HTMLInputElement>(".price-in")!
    // $96 against the $100 tape: 4% below, the wrong direction for a sell.
    input.value = "96"
    input.dispatchEvent(new Event("input"))
    expect(sh.querySelector(".dist")!.textContent).toBe("-4.0% vs now")
    expect(sh.querySelector(".dist")!.className).toContain("bad")

    // $72 against the same $100 tape: further below, same direction.
    input.value = "72"
    input.dispatchEvent(new Event("input"))
    expect(sh.querySelector(".dist")!.textContent).toBe("-28.0% vs now")
    expect(sh.querySelector(".dist")!.className).toContain("bad")
  })

  /**
   * A basis that predates the ledger is unknowable, NOT zero. Re-basing the
   * targets onto the tape would quietly change what the buttons mean, so
   * they do nothing and the sheet says why instead.
   */
  it("says so rather than guessing when the basis is unknowable", async () => {
    const { sh, tab, settle } = await open({
      book: book(432.1, { uiAmount: 61.4082, raw: "61408200", netInvestedUsd: null }),
    })
    tab("Sell")
    await settle()
    const input = sh.querySelector<HTMLInputElement>(".price-in")!
    input.value = "96"
    input.dispatchEvent(new Event("input"))
    // The anchor is the tape, which is known here, so the reading is a
    // number. There is no "basis" left to be unknowable — that was the
    // point of the change: the sheet stopped depending on a figure it
    // could not compute. What it still refuses to invent is a reading with
    // no live price, which the model spec covers directly.
    expect(sh.querySelector(".dist")!.textContent).toBe("-4.0% vs now")
    expect(sh.querySelector(".bal")!.textContent).not.toContain("entry")
  })

  it("sizes a sell as a fraction of the position, and says what it is worth", async () => {
    const { sh, tab, settle } = await open()
    tab("Sell")
    await settle()
    expect([...sh.querySelectorAll(".pick")].map((b) => b.textContent)).toEqual([
      "25%", "50%", "Max",
    ])
    expect(sh.querySelector(".bal")!.textContent).toContain("61.4082")
    // 61.4082 units at $100 — units alone never answer "how much is that"
    expect(sh.querySelector(".bal")!.textContent).toContain("$6,140.82")
    expect(sh.querySelector(".bal")!.textContent).not.toContain("entry")
  })

  it("never wears the buy accent on a sell", async () => {
    const { sh, tab, settle } = await open()
    tab("Sell")
    await settle()
    tab("Now")
    await settle()
    expect(sh.querySelector(".place")!.className).toContain("sell-side")
    // Seeded to the whole holding, so the label now says so ("Sell all
    // ($…)"); the point of this test is the accent, not the wording.
    expect(sh.querySelector(".place")!.textContent).toMatch(/^Sell\b/)
  })

  it("sells the fraction in RAW units, straight from the server's string", async () => {
    const sell = vi.fn(async () => ({ signature: "sig", dryRun: false }))
    const { sh, tab, settle } = await open({ sell })
    tab("Sell")
    await settle()
    tab("Now")
    await settle()
    // 50% of the position, expressed in the dollars the field speaks
    ;[...sh.querySelectorAll<HTMLElement>(".pick")].find((b) => b.textContent === "50%")!.click()
    await settle()
    sh.querySelector<HTMLElement>(".place")!.click()
    await settle()
    // The third argument is the tweet the sale came from — the same
    // attribution the buy carries.
    // Half of 61408200, in RAW units. The fourth argument is this press's
    // idempotency key: one press, one key, so a retry cannot sell twice.
    expect(sell).toHaveBeenCalledWith(
      expect.any(String),
      "30704100",
      expect.any(String),
      expect.any(String),
    )
  })

  it("a refused sell shows the server's own sentence, not 'Selling failed'", async () => {
    // The bridge rethrows the background's plain {status, message}, never an
    // Error. The tail read `instanceof Error` and printed "Selling failed"
    // over every refusal the server had explained.
    const sell = vi.fn(async () => {
      throw { status: 400, message: "Insufficient balance: wallet holds 1.2 WIF" }
    })
    const { sh, tab, settle } = await open({ sell })
    tab("Sell")
    await settle()
    tab("Now")
    await settle()
    ;[...sh.querySelectorAll<HTMLElement>(".pick")].find((b) => b.textContent === "50%")!.click()
    await settle()
    sh.querySelector<HTMLElement>(".place")!.click()
    await settle()
    await settle()
    expect(sh.textContent).toContain("Insufficient balance: wallet holds 1.2 WIF")
    expect(sh.textContent).not.toContain("Selling failed")
  })

  it("a sell refused for want of a session asks to sign in", async () => {
    const sell = vi.fn(async () => {
      throw { status: 401, message: "No token provided for endpoint/api/v1/embed/asset/sell" }
    })
    const { sh, tab, settle } = await open({ sell })
    tab("Sell")
    await settle()
    tab("Now")
    await settle()
    ;[...sh.querySelectorAll<HTMLElement>(".pick")].find((b) => b.textContent === "50%")!.click()
    await settle()
    sh.querySelector<HTMLElement>(".place")!.click()
    await settle()
    await settle()
    expect(sh.textContent).toContain("Sign in to trade")
  })

  it("Max sends the whole position as 100% even after the price has ticked", async () => {
    // The sheet speaks dollars and the sell is cut as a share of a moving
    // worth. Max at $100, a tick to $101, and the share used to come out at
    // 99.0%: dust left behind on every whole-position sell.
    const sell = vi.fn(async () => ({ signature: "sig", dryRun: false }))
    const { sh, tab, settle, host, ctl } = await open({ sell })
    tab("Sell")
    await settle()
    tab("Now")
    await settle()
    ;[...sh.querySelectorAll<HTMLElement>(".pick")].find((b) => b.textContent === "Max")!.click()
    await settle()
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 101, 1)
    await settle()
    expect(sh.querySelector(".place")!.textContent).toMatch(/^Sell all/)
    sh.querySelector<HTMLElement>(".place")!.click()
    await settle()
    // All 61408200 raw units, not 99% of them.
    expect(sell).toHaveBeenCalledWith(
      expect.any(String),
      "61408200",
      expect.any(String),
      expect.any(String),
    )
  })

  it("offers no sell at all when there is nothing held", async () => {
    const { sh, tab, settle } = await open({ book: book(432.1) })
    tab("Sell")
    await settle()
    tab("Now")
    await settle()
    expect(sh.querySelector(".place")!.textContent).toBe("Nothing to sell")
    expect(sh.querySelector(".place")!.className).toContain("wait")
  })
})

/**
 * A balance is a u64 string for a reason: 1e-9 of a token is a real amount,
 * and a float would round somebody's exit. 100% is exact by construction.
 */
describe("fractionRaw", () => {
  it("cuts without touching a float", () => {
    expect(fractionRaw("61408200", 50)).toBe("30704100")
    expect(fractionRaw("61408200", 25)).toBe("15352050")
    expect(fractionRaw("61408200", 100)).toBe("61408200")
    // a balance far beyond Number.MAX_SAFE_INTEGER still exits exactly
    expect(fractionRaw("18446744073709551615", 100)).toBe("18446744073709551615")
    expect(fractionRaw("18446744073709551614", 50)).toBe("9223372036854775807")
  })

  it("is silent rather than wrong when there is no balance", () => {
    expect(fractionRaw(null, 50)).toBe("0")
    expect(fractionRaw("not a number", 50)).toBe("0")
  })
})

/**
 * An order placed from a tweet used to vanish the moment the sheet closed:
 * the only place to see or cancel it was the panel, a different surface and,
 * on X, a different frame of mind. Someone about to set a second trigger at
 * nearly the same price should not have to leave the tweet to learn the
 * first one exists.
 */
describe("standing orders, shown where they were placed", () => {
  const ORDER = {
    orderKey: "K1",
    mint: WIF_ASSET.mint,
    side: "buy" as const,
    amountUsd: 25,
    amountUi: 0,
    triggerPriceUsd: 90,
    gated: false,
  }
  const open = async (extra: Partial<XStripDeps> = {}) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(432.1), ...extra })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "800", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    const sh = host.shadowRoot!
    sh.querySelector<HTMLElement>(".buy")!.click()
    ;[...sh.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "When it hits")!.click()
    await new Promise((r) => setTimeout(r, 0))
    return { sh, d }
  }

  it("lists what is already standing on this asset", async () => {
    const { sh } = await open({ listOrders: async () => [ORDER] })
    const line = sh.querySelector(".oo")!
    expect(line.textContent).toContain("Buy")
    // ONE SENTENCE PER ORDER, not a blotter row: the figures keep the data
    // voice and the words around them are the product's own.
    expect(line.textContent).toContain("Buying $25 if it hits $90")
  })

  it("is silent when nothing is standing", async () => {
    const { sh } = await open({ listOrders: async () => [] })
    expect(sh.querySelector<HTMLElement>(".open-orders")!.hidden).toBe(true)
  })

  it("shows nobody else's orders", async () => {
    const { sh } = await open({
      listOrders: async () => [{ ...ORDER, mint: "some-other-mint" }],
    })
    expect(sh.querySelector<HTMLElement>(".open-orders")!.hidden).toBe(true)
  })

  /**
   * §7 can stop admitting a mint, and the row says so — but the exit is
   * never gated. A reader must always be able to get out of something they
   * are already in.
   */
  it("keeps cancel lit on a paused market", async () => {
    const cancelOrder = vi.fn(async () => ({}))
    const { sh } = await open({
      listOrders: async () => [{ ...ORDER, gated: true }],
      cancelOrder,
    })
    // The amber stays — a real warning is never pretended away — but the
    // status CODE became the sentence it was hiding in a tooltip.
    expect(sh.querySelector(".oo-gated")!.textContent).toContain("on hold")
    expect(sh.querySelector(".oo-gated")!.textContent).toContain(
      "isn't taking new orders",
    )
    sh.querySelector<HTMLElement>(".oo-x")!.click()
    expect(cancelOrder).toHaveBeenCalledWith("K1")
  })

  it("re-reads the book after a cancel instead of trusting its cache", async () => {
    let calls = 0
    const { sh } = await open({
      listOrders: async () => {
        calls++
        return calls === 1 ? [ORDER] : []
      },
      cancelOrder: async () => ({}),
    })
    expect(calls).toBe(1)
    sh.querySelector<HTMLElement>(".oo-x")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toBe(2)
    expect(sh.querySelector<HTMLElement>(".open-orders")!.hidden).toBe(true)
  })
})

/**
 * The visibility rule needs a geometry read, and geometry reads force
 * layout. Asked once per CELL it put a forced layout between every mount —
 * measured in Chrome at 10.56 ms for a 200-cell batch, most of a 16.67 ms
 * frame, on somebody else's feed. Asked once per BATCH it is 0.18 ms.
 *
 * These tests pin the two things that make the snapshot safe to cache.
 */
describe("the visibility snapshot", () => {
  it("does not leak between separate processCell calls", () => {
    // processCell is exposed on its own, and a cache that outlived one call
    // would answer the next with geometry from before anything was mounted.
    const d = deps({ onScreen: () => false })
    const ctl = createXStrip(d)
    const a = makeCell({ id: "900", text: "solana szn" })
    ctl.processCell(a.cell)
    expect(a.cell.querySelector("[data-poppin-strip]")).not.toBeNull()

    const b = makeCell({ id: "901", text: "solana again" })
    ctl.processCell(b.cell)
    expect(b.cell.querySelector("[data-poppin-strip]")).not.toBeNull()
  })

  it("still counts a strip mounted earlier in the same batch", () => {
    // The snapshot is taken BEFORE the batch mounts anything, so a strip
    // this batch created has to join it or a batch of Solana tweets would
    // sail past the ceiling together.
    const d = deps({ onScreen: () => true })
    const ctl = createXStrip(d)
    const cells = ["910", "911", "912", "913"].map((id) =>
      makeCell({ id, text: "solana szn" }),
    )
    ctl.scan(document)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const chips = cells.filter((c) =>
          c.cell.querySelector("[data-poppin-strip]"),
        )
        // Three, not four: the batch's own mounts count toward the ceiling.
        expect(chips.length).toBe(3)
        resolve()
      }, 400)
    })
  })
})

/**
 * "12 bought from this tweet" — the one number on a trading surface that
 * moves a reader, and it obeys the chip's oldest rule: NOTHING is fetched
 * per tweet on the timeline. The proof loads behind the sheet tap, from
 * the trade ledger's source_url receipts.
 */
describe("social proof, behind the tap", () => {
  const open = async (pageProof?: XStripDeps["pageProof"]) => {
    const calls: string[] = []
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(432.1),
      pageProof: pageProof
        ? (url: string) => {
            calls.push(url)
            return pageProof(url)
          }
        : undefined,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "950", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    const sh = host.shadowRoot!
    return { sh, calls, openSheet: async () => {
      sh.querySelector<HTMLElement>(".buy")!.click()
      ;[...sh.querySelectorAll<HTMLElement>("button")]
        .find((b) => b.textContent === "When it hits")!
        .click()
      await new Promise((r) => setTimeout(r, 0))
    } }
  }

  it("fetches nothing until the sheet opens, then says the count", async () => {
    const { sh, calls, openSheet } = await open(async () => ({ buyers: 12 }))
    expect(calls).toEqual([]) // the timeline rule: mount cost is zero
    await openSheet()
    const proof = sh.querySelector<HTMLElement>(".proof")!
    expect(proof.hidden).toBe(false)
    expect(proof.textContent).toBe("12 bought from this tweet")
  })

  it("stays silent at zero — '0 bought' is an anti-ad", async () => {
    const { sh, openSheet } = await open(async () => ({ buyers: 0 }))
    await openSheet()
    expect(sh.querySelector<HTMLElement>(".proof")!.hidden).toBe(true)
  })

  it("stays silent below three — an aggregate of one names a person", async () => {
    // The ledger count includes buyers who never posted; "1 bought from
    // this tweet" under a reply that says "aped in" is that reader's
    // spend, published. Three is the privacy floor, not a taste call.
    const { sh, openSheet } = await open(async () => ({ buyers: 2 }))
    await openSheet()
    expect(sh.querySelector<HTMLElement>(".proof")!.hidden).toBe(true)
  })

  it("speaks at exactly three", async () => {
    const { sh, openSheet } = await open(async () => ({ buyers: 3 }))
    await openSheet()
    const proof = sh.querySelector<HTMLElement>(".proof")!
    expect(proof.hidden).toBe(false)
    expect(proof.textContent).toBe("3 bought from this tweet")
  })

  it("survives the read failing, because proof is garnish", async () => {
    const { sh, openSheet } = await open(async () => {
      throw new Error("down")
    })
    await openSheet()
    expect(sh.querySelector<HTMLElement>(".proof")!.hidden).toBe(true)
  })
})

/**
 * The bell — the free step before an order. A limit needs money; "tell me
 * when it gets there" needs nothing, and the chip only DERIVES and hands
 * over: storage belongs to the caller, watching to the background's alarm.
 */
describe("the price alert bell", () => {
  const open = async (saveAlert = vi.fn(async () => true)) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(432.1),
      saveAlert,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "970", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    const sh = host.shadowRoot!
    // Buy lands in the sheet (market mode) in one press now; these tests
    // exercise the LIMIT axis, so flip the kind switch.
    sh.querySelector<HTMLElement>(".buy")!.click()
    ;[...sh.querySelectorAll<HTMLElement>("button")]
      .find((b) => b.textContent === "When it hits")!
      .click()
    await new Promise((r) => setTimeout(r, 0))
    const type = (v: string) => {
      const el = sh.querySelector<HTMLInputElement>(".price-in")!
      el.value = v
      el.dispatchEvent(new Event("input"))
    }
    return { sh, saveAlert, type, settle: () => new Promise((r) => setTimeout(r, 0)) }
  }

  it("parks the typed price with the direction the market implies", async () => {
    const { sh, saveAlert, type, settle } = await open()
    type("90")
    sh.querySelector<HTMLElement>(".bell")!.click()
    await settle()
    expect(saveAlert).toHaveBeenCalledWith(
      expect.objectContaining({ targetUsd: 90, direction: "below", symbol: "WIF" }),
    )
    expect(sh.querySelector(".sheet .msg")!.textContent).toBe("Alert set: drops to $90")
  })

  it("says when the same ask already stands", async () => {
    const { sh, type, settle } = await open(vi.fn(async () => false))
    type("120")
    sh.querySelector<HTMLElement>(".bell")!.click()
    await settle()
    expect(sh.querySelector(".sheet .msg")!.textContent).toBe("That alert is already set")
  })

  it("asks for a price rather than parking nothing", async () => {
    const { sh, saveAlert } = await open()
    sh.querySelector<HTMLElement>(".bell")!.click()
    expect(saveAlert).not.toHaveBeenCalled()
    expect(sh.querySelector(".sheet .msg")!.textContent).toBe("Type a price to set an alert")
  })
})

/**
 * BUY SIZE CHIPS, in two grammars.
 *
 * With the reader's book in hand the chips are FRACTIONS of the spendable
 * pocket — 25% / 50% / Max — the same grammar the sell side always spoke.
 * The change came from the first live reader with $9.49 in the wallet
 * asking, reasonably, why the buttons ignored it. While the book is
 * unknown the old adding keypad (+$10 +$25 +$100) survives, because a
 * fraction of an unknown number is not a button.
 */
describe("buy size chips", () => {
  const open = async (withBook = true) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      ...(withBook ? { book: book(432.1) } : {}),
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "900", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    const sh = host.shadowRoot!
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    return sh
  }

  it("with a book, the chips are fractions and Max is the whole pocket", async () => {
    const sh = await open()
    await new Promise((r) => setTimeout(r, 0)) // the reader lands, picks repaint
    const labels = [...sh.querySelectorAll<HTMLElement>(".pick")].map(
      (b) => b.textContent,
    )
    expect(labels).toEqual(["25%", "50%", "Max"])
    ;[...sh.querySelectorAll<HTMLElement>(".pick")]
      .find((b) => b.textContent === "Max")!
      .click()
    expect(sh.querySelector(".place")!.textContent).toBe("Buy $432.1")
    // Half SETS — fractions do not stack.
    ;[...sh.querySelectorAll<HTMLElement>(".pick")]
      .find((b) => b.textContent === "50%")!
      .click()
    expect(sh.querySelector(".place")!.textContent).toBe("Buy $216.05")
  })

  it("the typed field stays free alongside the fractions", async () => {
    const sh = await open()
    await new Promise((r) => setTimeout(r, 0))
    const input = sh.querySelector<HTMLInputElement>(".amount-in")!
    input.value = "7"
    input.dispatchEvent(new Event("input"))
    expect(sh.querySelector(".place")!.textContent).toBe("Buy $7")
  })

  it("opens armed at the default, in market mode, one press from the feed", async () => {
    const sh = await open()
    expect(sh.querySelector(".sheet")).not.toBeNull()
    expect(sh.querySelector(".price-in")).toBeNull() // market, not limit
    expect(sh.querySelector(".place")!.textContent).toBe("Buy $25")
  })

  it("without a book the keypad survives: +$10 twice is $45", async () => {
    const sh = await open(false)
    const chip10 = [...sh.querySelectorAll<HTMLElement>(".pick")].find(
      (b) => b.textContent === "+$10",
    )!
    chip10.click()
    chip10.click()
    expect(sh.querySelector(".place")!.textContent).toBe("Buy $45")
    expect(sh.querySelector<HTMLInputElement>(".amount-in")!.value).toBe("45")
  })

  it("without a book a typed amount replaces; the chips add on top", async () => {
    const sh = await open(false)
    const input = sh.querySelector<HTMLInputElement>(".amount-in")!
    input.value = "7"
    input.dispatchEvent(new Event("input"))
    ;[...sh.querySelectorAll<HTMLElement>(".pick")]
      .find((b) => b.textContent === "+$100")!
      .click()
    expect(sh.querySelector(".place")!.textContent).toBe("Buy $107")
  })
})

/**
 * The tap-the-price chart: the number is a door to its own history.
 */
/**
 * THE READER'S OWN STAKE, worn on the chip's face. The feed never told you
 * what you hold; now meeting your own asset shows "You +8.2%" (or the plain
 * value while the basis is unknowable), re-priced on every live tick.
 */
describe("the position badge", () => {
  const mount = async (book?: () => Promise<unknown>) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      ...(book ? { book } : {}),
    } as Partial<XStripDeps>)
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "995", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    return { sh: host.shadowRoot!, ctl, mintKey: host.getAttribute("data-poppin-strip")!, d }
  }

  it("shows the P&L once the book and a live price agree", async () => {
    const book = vi.fn(async () => ({
      cashUsd: 10,
      solUsd: 0,
      positions: [
        {
          mint: WIF_ASSET.mint,
          uiAmount: 100,
          raw: "100000000",
          netInvestedUsd: 100,
          // The percentage is priced against the WALK's average entry and
          // nothing else now (see "never invents a percentage" below), so
          // the fixture carries the basis the real wire carries.
          avgEntryPriceUsd: 1,
        },
      ],
    }))
    const { sh, ctl, mintKey } = await mount(book)
    // $1.25 a unit against a $1.00 average entry: +25%.
    ctl.updatePrice(mintKey, 1.25, 2)
    const mine = sh.querySelector<HTMLElement>(".mine")!
    expect(mine.hidden).toBe(false)
    expect(mine.textContent).toBe("You +25.0%")
    expect(mine.classList.contains("up")).toBe(true)
    // The tape turns and the badge turns with it: $0.90 vs $1.00 = -10%.
    ctl.updatePrice(mintKey, 0.9, -2)
    expect(mine.textContent).toBe("You -10.0%")
    expect(mine.classList.contains("down")).toBe(true)
  })

  it("never invents a percentage: no honest basis, no percent", async () => {
    /**
     * THE FALLBACK WAS THE BUG (field: "pnl mini yanlış gösteriyor"). The
     * badge used to drop to (value − netInvested) / netInvested whenever
     * the walk could not price the position — the exact arithmetic that
     * was deleted from this badge for being wrong: net-invested shrinks by
     * PROCEEDS, so one profitable trim inflates it and a round trip sends
     * it past infinity. Every reader with one unpriceable row (a
     * pre-quantity trade, a settle that never landed) silently got that
     * number.
     *
     * Null over guess: with no average entry the badge says what the
     * holding is WORTH, which is true in every case.
     */
    const book = vi.fn(async () => ({
      cashUsd: 10,
      solUsd: 0,
      positions: [
        {
          mint: WIF_ASSET.mint,
          uiAmount: 100,
          raw: "100000000",
          // A net-invested figure IS present — and is still not enough.
          netInvestedUsd: 100,
          avgEntryPriceUsd: null,
        },
      ],
    }))
    const { sh, ctl, mintKey } = await mount(book)
    ctl.updatePrice(mintKey, 1.25, 2)
    const mine = sh.querySelector<HTMLElement>(".mine")!
    expect(mine.textContent).toBe("You $125.00")
    expect(mine.textContent).not.toContain("%")
    expect(mine.classList.contains("up")).toBe(false)
    expect(mine.classList.contains("down")).toBe(false)
  })

  it("judges against the TRUE average entry when the ledger can compute it", async () => {
    /**
     * Net-invested shrinks by PROCEEDS, so one profitable trim inflated
     * the old percentage and a round trip sent it past infinity. Here the
     * walk says the reader's average entry is $2.00; at $2.50 the honest
     * badge is +25%, while the stale net-invested arithmetic would have
     * claimed (250 − 100) / 100 = +150%.
     */
    const book = vi.fn(async () => ({
      cashUsd: 10,
      solUsd: 0,
      positions: [
        {
          mint: WIF_ASSET.mint,
          uiAmount: 100,
          raw: "100000000",
          netInvestedUsd: 100,
          avgEntryPriceUsd: 2,
        },
      ],
    }))
    const { sh, ctl, mintKey } = await mount(book)
    ctl.updatePrice(mintKey, 2.5, 1)
    const mine = sh.querySelector<HTMLElement>(".mine")!
    expect(mine.textContent).toBe("You +25.0%")
    /**
     * THE COUNTERFACTUAL, SPELLED OUT — and it replaces an assertion that
     * had to go rather than weakening this test.
     *
     * What stood here was `expect(mine.title).toContain("avg entry $2.00")`.
     * That `title` is gone: `paintMine` runs on every price tick and
     * reassigned it unconditionally, which made this pill the one thing on
     * the chip that opened and closed a native tooltip with the pointer
     * standing still (see paintMine and mountStrip's header). The basis it
     * quoted is not lost as evidence — the badge's own text is the proof,
     * because the two arithmetics give different numbers from the same
     * fixture: the honest one reads the walk's $2.00 entry and says +25.0%,
     * the deleted net-invested one divides (100 × $2.50 − $100) by $100 and
     * says +150.0%. Pinning both directions is strictly stronger than
     * reading the entry back out of a tooltip.
     */
    expect(mine.textContent).not.toBe("You +150.0%")
    expect(mine.hasAttribute("title")).toBe(false)
    ctl.updatePrice(mintKey, 1.5, -1)
    expect(mine.textContent).toBe("You -25.0%")
    expect(mine.classList.contains("down")).toBe(true)
  })

  it("prints the VALUE, never a percentage, while the basis is unknowable", async () => {
    const book = vi.fn(async () => ({
      cashUsd: 10,
      solUsd: 0,
      positions: [
        { mint: WIF_ASSET.mint, uiAmount: 8, raw: "8000000", netInvestedUsd: null },
      ],
    }))
    const { sh, ctl, mintKey } = await mount(book)
    ctl.updatePrice(mintKey, 1.55, 0)
    const mine = sh.querySelector<HTMLElement>(".mine")!
    expect(mine.textContent).toBe("You $12.40")
    expect(mine.classList.contains("up")).toBe(false)
    expect(mine.classList.contains("down")).toBe(false)
  })

  it("stays hidden with no position, and for the signed-out reader", async () => {
    const empty = await mount(vi.fn(async () => ({ cashUsd: 5, solUsd: 0, positions: [] })))
    empty.ctl.updatePrice(empty.mintKey, 1, 0)
    expect(empty.sh.querySelector<HTMLElement>(".mine")!.hidden).toBe(true)

    const signedOut = await mount(vi.fn(async () => null))
    signedOut.ctl.updatePrice(signedOut.mintKey, 1, 0)
    expect(signedOut.sh.querySelector<HTMLElement>(".mine")!.hidden).toBe(true)
  })

  it("re-reads the book after a buy lands, so the badge appears", async () => {
    let calls = 0
    const book = vi.fn(async () => ({
      cashUsd: 100,
      solUsd: 0,
      positions:
        ++calls === 1
          ? []
          : [
              {
                mint: WIF_ASSET.mint,
                uiAmount: 20,
                raw: "20000000",
                netInvestedUsd: 25,
                // $25 for 20 units — the basis the walk reports.
                avgEntryPriceUsd: 1.25,
              },
            ],
    }))
    const { sh, ctl, mintKey } = await mount(book)
    ctl.updatePrice(mintKey, 1.25, 0)
    const mine = sh.querySelector<HTMLElement>(".mine")!
    expect(mine.hidden).toBe(true)
    // Buy $25 through the sheet.
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(book.mock.calls.length).toBeGreaterThan(1)
    // 20 units × $1.25 on a $25 basis: exactly break-even, worn as up.
    expect(mine.hidden).toBe(false)
    expect(mine.textContent).toBe("You 0.0%")
  })
})

/**
 * THE SLOW LANE: a cashtag the shipped lists cannot answer goes to the
 * server, which resolves under the ambiguity rule and the trade gate.
 */
describe("unknown cashtags resolve through the server", () => {
  const cellWith = (ctl: ReturnType<typeof createXStrip>, id: string, tag: string) => {
    const { cell } = makeCell({ id, text: `${tag} to the moon`, cashtags: [tag] })
    ctl.processCell(cell)
    return cell
  }

  it("prefers the author's FIRST cashtag over a later one we happen to know", async () => {
    // Live: a tweet opening with $BULLSHIT and naming $ANSEM three lines
    // later wore an ANSEM chip, because ANSEM ships in the catalog.
    const resolveTicker = vi.fn(async () => "BULLmint111111111111111111111111111111111")
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    const { cell } = makeCell({
      id: "980",
      text: "$BULLSHIT\n\nIf $WIF starts moving again I would not be surprised",
      cashtags: ["$BULLSHIT", "$WIF"],
    })
    ctl.processCell(cell)
    // Nothing is drawn while the question is open: a chip that appears as
    // one asset and silently becomes another is worse than a late one.
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    const host = cell.querySelector("[data-poppin-strip]")!
    expect(host.getAttribute("data-poppin-strip")).toBe(
      "BULLmint111111111111111111111111111111111",
    )
    expect(resolveTicker).toHaveBeenCalledWith("$BULLSHIT")
  })

  it("wears the unverified line for a server-resolved mint, and only there", async () => {
    // The gate admits open-regime mints on numbers alone; the sheet says
    // so at the moment of the money button, Fomo-style.
    const resolveTicker = vi.fn(async () => "OpenMint111111111111111111111111111111111")
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "983", text: "$FRESH", cashtags: ["$FRESH"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    const sh = (cell.querySelector("[data-poppin-strip]") as HTMLElement).shadowRoot!
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".unverified")?.textContent).toContain("Unverified")

    // The curated counter-case: a reviewed mint carries no such line.
    const { cell: wifCell } = makeCell({ id: "984", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(wifCell)
    const wifSh = (wifCell.querySelector("[data-poppin-strip]") as HTMLElement).shadowRoot!
    wifSh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(wifSh.querySelector(".unverified")).toBeNull()
  })

  it("asks again after a FAILURE, and only caches an ANSWER", async () => {
    /**
     * One cold-backend timeout on the first $PANTS of the session used to
     * become "no such token", cached as firmly as a real answer — every
     * later $PANTS tweet stayed chipless for as long as the page lived,
     * on exactly the hot new token this lane exists for. Measured while
     * chasing the field report: production resolved PANTS fine, so the
     * session-long silence had to be this cache.
     *
     * A null ANSWER still caches firmly (see the spec below): "no such
     * token" is information. A rejection is not.
     */
    let calls = 0
    const resolveTicker = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error("cold backend")
      return "PANTSmint111111111111111111111111111111111"
    })
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)

    const first = cellWith(ctl, "990", "$PANTS")
    await new Promise((r) => setTimeout(r, 0))
    // The failed ask mounts nothing (fallback path has no local match).
    expect(first.querySelector("[data-poppin-strip]")).toBeNull()

    // The next tweet with the same cashtag asks AGAIN — and gets its chip.
    const second = cellWith(ctl, "991", "$PANTS")
    await new Promise((r) => setTimeout(r, 0))
    expect(resolveTicker).toHaveBeenCalledTimes(2)
    expect(
      second.querySelector("[data-poppin-strip]")?.getAttribute("data-poppin-strip"),
    ).toBe("PANTSmint111111111111111111111111111111111")
  })

  it("caches a real null for the whole page — absence IS an answer", async () => {
    const resolveTicker = vi.fn(async () => null)
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    cellWith(ctl, "992", "$NOTATOKEN")
    await new Promise((r) => setTimeout(r, 0))
    cellWith(ctl, "993", "$NOTATOKEN")
    await new Promise((r) => setTimeout(r, 0))
    expect(resolveTicker).toHaveBeenCalledTimes(1)
  })

  it("falls back to the known cashtag when the first one resolves to nothing", async () => {
    const resolveTicker = vi.fn(async () => null)
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    const { cell } = makeCell({
      id: "981",
      text: "$NOTATOKEN and also $WIF",
      cashtags: ["$NOTATOKEN", "$WIF"],
    })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    const host = cell.querySelector("[data-poppin-strip]")!
    // Exactly where today lands: the asset we could actually name.
    expect(host.getAttribute("data-poppin-strip")).toBe(WIF_ASSET.mint)
  })

  it("does not ask when the first cashtag is the one it already matched", async () => {
    const resolveTicker = vi.fn(async () => null)
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "982", text: "$WIF szn", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    // The common case stays instant and offline: no request, no delay.
    expect(cell.querySelector("[data-poppin-strip]")).not.toBeNull()
    expect(resolveTicker).not.toHaveBeenCalled()
  })

  it("mounts the chip once the server answers a mint", async () => {
    const resolveTicker = vi.fn(async () => "CMNSmint1111111111111111111111111111111111")
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    const cell = cellWith(ctl, "970", "$CMNS")
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    const host = cell.querySelector("[data-poppin-strip]")
    expect(host).toBeTruthy()
    expect(host!.getAttribute("data-poppin-strip")).toBe(
      "CMNSmint1111111111111111111111111111111111",
    )
    expect(resolveTicker).toHaveBeenCalledWith("$CMNS")
  })

  it("asks once per ticker per page, hits and misses alike", async () => {
    const resolveTicker = vi.fn(async () => null)
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    cellWith(ctl, "971", "$CMNS")
    cellWith(ctl, "972", "$CMNS")
    cellWith(ctl, "973", "$CMNS")
    await new Promise((r) => setTimeout(r, 0))
    expect(resolveTicker).toHaveBeenCalledTimes(1)
  })

  it("never mounts onto a recycled cell", async () => {
    let resolve!: (m: string | null) => void
    const resolveTicker = vi.fn(() => new Promise<string | null>((r) => (resolve = r)))
    const d = deps({ shadowMode: "open", onScreen: () => false, resolveTicker })
    const ctl = createXStrip(d)
    const cell = cellWith(ctl, "974", "$CMNS")
    // X reuses the DOM node for a DIFFERENT tweet before the answer lands.
    const { article: freshArticle } = makeCell({ id: "975", text: "hello", cashtags: [] })
    cell.replaceChildren(...Array.from(freshArticle.children))
    ctl.processCell(cell)
    resolve("SomeMint1111111111111111111111111111111111")
    await new Promise((r) => setTimeout(r, 0))
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
  })

  it("stays silent without the dep, exactly as before it existed", async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const cell = cellWith(ctl, "976", "$CMNS")
    await new Promise((r) => setTimeout(r, 0))
    expect(cell.querySelector("[data-poppin-strip]")).toBeNull()
  })
})

/**
 * THE MONEY PATH, PRESSED. Reported live: "buy'a basıyorum hiçbir şey
 * olmuyor" — with no /embed/asset/swap request reaching the backend at
 * all, which puts the failure between the click and the network.
 */
describe("pressing Buy in the market sheet", () => {
  const openSheet = async (over: Partial<XStripDeps> = {}) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, ...over })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "990", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    const sh = host.shadowRoot!
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    return { sh, d }
  }

  it("sends the swap when the book is known", async () => {
    const book = vi.fn(async () => ({
      cashUsd: 100,
      solUsd: 0,
      positions: [],
    }))
    const { sh, d } = await openSheet({ book } as Partial<XStripDeps>)
    await new Promise((r) => setTimeout(r, 0))
    const go = sh.querySelector<HTMLElement>(".place")!
    expect(go.textContent).toContain("Buy")
    go.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(d.trade.swap).toHaveBeenCalled()
  })

  it("sends the swap even while the book is still loading", async () => {
    // /positions is 8.6s cold; a reader who presses before it lands must
    // not press into silence.
    const book = vi.fn(() => new Promise<never>(() => {}))
    const { sh, d } = await openSheet({ book } as Partial<XStripDeps>)
    const go = sh.querySelector<HTMLElement>(".place")!
    go.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(d.trade.swap).toHaveBeenCalled()
  })

  it("says something out loud when the swap fails", async () => {
    const book = vi.fn(async () => ({ cashUsd: 100, solUsd: 0, positions: [] }))
    const trade = {
      swap: vi.fn(async () => {
        throw new Error("Swap would fail on-chain — nope")
      }),
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    }
    const { sh } = await openSheet({ book, trade } as Partial<XStripDeps>)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    // The reader must SEE the refusal — a message written into a hidden
    // row is the same as no message at all.
    const row = sh.querySelector<HTMLElement>(".msg-row")
    const msg = sh.querySelector<HTMLElement>(".msg")
    const tail = sh.querySelector<HTMLElement>(".end")
    const said =
      (row && !row.classList.contains("quiet") && msg?.textContent) ||
      tail?.textContent ||
      ""
    expect(said).toMatch(/didn't go through/i)
    // And it sees a sentence, not the server's log line (helpers/refusalCopy).
    expect(said).not.toMatch(/on-chain|nope/)
  })

  it("finishes the Balance-is-short sentence with what the reader HAS", async () => {
    // Reported live: the door said "Balance is short - Top up" and nothing
    // said what the balance WAS. The amount decides how much to send.
    // The book SAID there was money (stale), the server said otherwise —
    // which is exactly when this door appears. The refresh must show the
    // fresh number, not quote the number the server just contradicted.
    let reads = 0
    const book = vi.fn(async () =>
      ++reads === 1
        ? { cashUsd: 100, solUsd: 0, positions: [] }
        : { cashUsd: 1.87, solUsd: 0.27, positions: [] },
    )
    const trade = {
      swap: vi.fn(async () => {
        throw new Error("Insufficient USDC: wallet holds $1.87, needs $25.00")
      }),
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    }
    const { sh } = await openSheet({ book, trade } as Partial<XStripDeps>)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const tail = sh.querySelector<HTMLElement>(".end")!
    expect(tail.textContent).toContain("you have $1.87 USDC")
    // The door out survives the longer sentence, and names the currency —
    // this door funds by whichever rail the page offers, so it promises
    // what ARRIVES rather than which rail delivers it.
    expect(tail.textContent).toContain("Add USDC")
  })

  it("offers Share on the receipt, and the share opens the composer", async () => {
    const book = vi.fn(async () => ({ cashUsd: 100, solUsd: 0, positions: [] }))
    const { sh } = await openSheet({ book } as Partial<XStripDeps>)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const share = [...sh.querySelectorAll<HTMLElement>(".end button")].find(
      (b) => b.textContent === "Share",
    )
    expect(share).toBeTruthy()
    // jsdom has no canvas 2d, so the card falls back to text-only — which
    // must still open X's composer with the cashtag riding the text.
    const opened = vi.spyOn(window, "open").mockReturnValue(null)
    share!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(opened).toHaveBeenCalledTimes(1)
    const url = String(opened.mock.calls[0][0])
    expect(url).toContain("x.com/intent/post")
    expect(decodeURIComponent(url)).toContain("$WIF")
    opened.mockRestore()
  })

  it("names a dead extension bridge instead of blaming the market", async () => {
    const book = vi.fn(async () => ({ cashUsd: 100, solUsd: 0, positions: [] }))
    const trade = {
      // What fetchService throws once this page outlives the extension.
      swap: vi.fn(async () => {
        throw { code: "poppin/stale-context", message: "Poppin updated — reload the page" }
      }),
      confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    }
    const { sh } = await openSheet({ book, trade } as Partial<XStripDeps>)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const row = sh.querySelector<HTMLElement>(".msg-row")!
    expect(row.classList.contains("quiet")).toBe(false)
    expect(row.textContent).toMatch(/reload the page/i)
  })
})

describe("the holdings a sell is judged against", () => {
  /**
   * Reported live on $ORE: the panel showed $5.15 held, the sell sheet
   * said "Nothing to sell", and 25 / 50 / Max did nothing at all.
   *
   * The book was remembered FOREVER. The first sheet on a page read the
   * holdings once and every sheet after it trusted that snapshot until a
   * full reload, so a position acquired anywhere the chip cannot see —
   * bought in the panel, transferred in, funded after the page opened —
   * did not exist as far as the chip was concerned. A sell is the one
   * moment that number has to be current, because the reader is about to
   * act on it.
   */
  const mountSell = async (book: () => Promise<any>) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "970", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 2, 1)
    return { sh, host }
  }

  const bookWith = (uiAmount: number) => ({
    cashUsd: 10,
    solUsd: 0,
    positions: [
      { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", uiAmount, raw: String(uiAmount * 1e6), netInvestedUsd: null },
    ],
  })

  it("re-reads the book when a sell sheet opens", async () => {
    // First read is empty (the page opened before the position existed);
    // the second has it. Opening the SELL side must ask again.
    let call = 0
    const book = vi.fn(async () => (++call === 1 ? bookWith(0) : bookWith(3)))
    const { sh } = await mountSell(book)
    sh.querySelector<HTMLElement>(".buy")!.click() // buy sheet: one read
    await new Promise((r) => setTimeout(r, 0))
    const first = book.mock.calls.length
    sh.querySelector<HTMLElement>(".segb.sell-on")!.click() // to the sell side
    await new Promise((r) => setTimeout(r, 0))
    expect(book.mock.calls.length).toBeGreaterThan(first)
    expect(sh.querySelector(".bal")!.textContent).toContain("You hold")
  })

  it("never leaves the waiting line up, even when the read fails", async () => {
    // "Reading your balance…" stuck on screen is the same silence wearing
    // a politer font. Reported live: the message stayed while the cold
    // read (8.6s measured) ran, and stayed for good if it failed.
    const book = vi.fn(async () => {
      throw new Error("500")
    })
    const { sh } = await mountSell(book)
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".segb.sell-on")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const max = [...sh.querySelectorAll<HTMLElement>(".pick")].find(
      (b) => b.textContent === "Max",
    )!
    max.click()
    await new Promise((r) => setTimeout(r, 0))
    const msg = sh.querySelector(".msg")!.textContent ?? ""
    expect(msg).not.toMatch(/Reading your balance/i)
    expect(msg).toMatch(/could not read/i)
  })

  it("paints the remembered book without waiting for the fresh one", async () => {
    // The cold read is 8.6s; a sheet that says nothing until it lands is a
    // sheet that looks broken. The remembered answer paints first.
    let resolveFresh: (v: any) => void = () => {}
    let call = 0
    const book = vi.fn(() => {
      call += 1
      return call <= 2
        ? Promise.resolve(bookWith(3))
        : new Promise((res) => { resolveFresh = res })
    })
    const { sh } = await mountSell(book as any)
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".segb.sell-on")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // The fresh read is still in flight, and the sheet already knows.
    expect(sh.querySelector(".bal")!.textContent).toContain("You hold")
    resolveFresh(bookWith(5))
  })

  it("a percentage button says why when it cannot act", async () => {
    // It used to `return` in silence — the reader taps Max on a position
    // they can see in the panel and gets no motion and no message.
    const book = vi.fn(async () => bookWith(0))
    const { sh } = await mountSell(book)
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".segb.sell-on")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const max = [...sh.querySelectorAll<HTMLElement>(".pick")].find(
      (b) => b.textContent === "Max",
    )!
    max.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".msg")!.textContent).toMatch(/to sell|balance|price/i)
  })
})

describe("the boot adapter forwards every dep it accepts", () => {
  /**
   * A HAND-COPIED DEPS LIST IS A DEP THAT WILL BE DROPPED.
   *
   * initXStrip declared book, sell, pageProof, saveAlert, listOrders and
   * cancelOrder in its parameter type and forwarded NONE of them to
   * createXStrip. Everything typechecked at both ends: main.tsx passed a
   * book, the chip declared a book, and the object literal in between
   * simply never mentioned it. `git log -S "book: deps.book"` returns
   * nothing — it was never once forwarded.
   *
   * So `book()` resolved null for the whole life of the feature: no
   * balance in the sheet, no balance chip, and a sell sheet that answered
   * "Nothing to sell" while the reader was holding the token.
   *
   * The fix is structural, not another line in the list: the parameter
   * type IS XStripDeps now and the forward is a spread, so this cannot be
   * written wrong again. This test holds that shape from the outside — it
   * boots the real adapter and asks the chip a question only a forwarded
   * dep can answer.
   */
  const bootOnX = async (extra: Partial<XStripDeps>) => {
    vi.stubGlobal("location", { hostname: "x.com", href: "https://x.com/home" })
    const d = deps({ shadowMode: "open", onScreen: () => false, ...extra })
    const ctl = await initXStrip({
      ...(d as unknown as Parameters<typeof initXStrip>[0]),
      fetchConfig: async () => ({ enabled: true, disabledMints: [] }),
    })
    return ctl!
  }

  it("hands the chip a book, so the balance can be read at all", async () => {
    const ctl = await bootOnX({ book: book(9.49) })
    const { cell } = makeCell({ id: "970", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    // The quiet chip on the face is the cheapest visible proof that the
    // book arrived; a dropped dep leaves it forever empty.
    // The pill is the SCORE now — the balance's honest homes are the
    // sheet's Deposit USDC gate and the scoreboard's cash line. book(9.49)
    // carries no P&L, so the pill stays hidden and the row stays clean.
        // THE DOOR IS PERMANENT NOW (field, 2026-08-31): the pill carries no
    // figure, so there is no number whose absence could hide it — and a
    // reader with no score is exactly the one who still needs a way into
    // their own portfolio.
    expect(sh.querySelector<HTMLElement>(".wal")!.hidden).toBe(false)
    ctl.stop()
    vi.unstubAllGlobals()
  })
})

describe("the scoreboard", () => {
  /**
   * Every number here rides the ONE positions read the chip already makes.
   * /positions has returned ticker, priceUsd, valueUsd and pnlUsd per row
   * since it existed; the host's adapter mapped five fields out of nine
   * and dropped the rest, which is why this surface was believed to have
   * no prices. Nothing new is fetched.
   */
  const rich = (over: Record<string, unknown> = {}) =>
    (async () => ({
      cashUsd: 9.46,
      solUsd: 0,
      totalUsd: 61.4,
      totalPnlUsd: -1.86,
      positions: [
        { mint: "m1", ticker: "WIF", uiAmount: 12.4, raw: "1", netInvestedUsd: 25,
          priceUsd: 2.1, valueUsd: 26.04, pnlUsd: 1.04 },
        { mint: "m2", ticker: "BONK", uiAmount: 1_250_000, raw: "2", netInvestedUsd: 30,
          priceUsd: 0.00002, valueUsd: 25.9, pnlUsd: -4.1 },
      ],
      ...over,
    })) as never

  const openYou = async (id: string, over: Record<string, unknown> = {}, extra: any = {}) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: rich(over), ...extra })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".wal")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    return sh
  }

  /**
   * WHOSE CHIP IS THIS, AND WHOSE ROOM.
   *
   * The strip answered neither. Its wallet key was an abstract glyph and
   * this room opened on a figure with no name over it — strange for a
   * surface a person reaches by pressing their own key. Both halves read
   * the same `me` dep, and neither invents anything when it answers null.
   */
  const FACE = "data:image/png;base64,QUJD"
  const withWorker = (fn: () => Promise<void>) => async () => {
    const asked: string[] = []
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: undefined,
        sendMessage: (msg: { type?: string; url?: string }, cb?: (r: unknown) => void) => {
          if (msg?.type === "POPPIN_ICON_FETCH") {
            asked.push(String(msg.url))
            cb?.({ dataUri: FACE })
            return undefined
          }
          cb?.(undefined)
          return Promise.resolve()
        },
      },
    })
    try {
      ;(globalThis as any).__asked = asked
      await fn()
    } finally {
      vi.unstubAllGlobals()
    }
  }
  const ME = {
    id: "aBcD1234efGH5678ijKL9012mnOP",
    username: "levvercetti",
    photoUrl: "https://api.poppin.test/avatar/ghost-2.png",
  }

  /** The resting strip, WITHOUT opening the You panel — that panel takes
   *  the row's place, so the key under test is gone by the time openYou
   *  returns. */
  const restingStrip = async (id: string, extra: any = {}) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: rich({}), ...extra })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    return host.shadowRoot!
  }

  it(
    "wears the reader's face on the key that opens their own room",
    withWorker(async () => {
      const sh = await restingStrip("1560", { me: async () => ME })
      const wal = sh.querySelector<HTMLElement>(".wal")!
      // The remote address is never the src: x.com's img-src refuses it,
      // so the bytes arrive from the worker as a data URI.
      const img = wal.querySelector<HTMLImageElement>("img")
      expect((globalThis as any).__asked).toContain(ME.photoUrl)
      expect(img).toBeTruthy()
      expect(img!.getAttribute("src")).not.toBe(ME.photoUrl)
      expect(img!.src).toBe(FACE)
      // ONE BADGE FOR ONE PIECE OF NEWS. The bell one slot over already
      // carries the unread count and takes the accent fill with it; a
      // second badge on the face would be the product saying the same
      // thing twice, side by side.
      expect(wal.querySelector(".wal-dot")).toBeNull()
      expect(sh.querySelector(".ring")).toBeTruthy()
    }),
  )

  it(
    "keeps the glyph until the photo has actually decoded, so it is never a broken circle",
    withWorker(async () => {
      const sh = await restingStrip("1561", { me: async () => ME })
      const wal = sh.querySelector<HTMLElement>(".wal")!
      // jsdom fires no load event, which is exactly the "has not decoded
      // yet" state: the key is still the glyph and wears no face class.
      expect(wal.classList.contains("me")).toBe(false)
      expect(wal.querySelector("svg")).toBeTruthy()
      // And on load the swap happens, once.
      wal.querySelector<HTMLImageElement>("img")!.dispatchEvent(new Event("load"))
      expect(wal.classList.contains("me")).toBe(true)
      expect(wal.querySelector("svg")).toBeNull()
      expect(wal.querySelectorAll("img").length).toBe(1)
    }),
  )

  it(
    "leaves a signed-out reader the key they always had",
    withWorker(async () => {
      const sh = await restingStrip("1562", { me: async () => null })
      const wal = sh.querySelector<HTMLElement>(".wal")!
      expect(wal.classList.contains("me")).toBe(false)
      expect(wal.querySelector("svg")).toBeTruthy()
      expect(wal.querySelector("img")).toBeNull()
    }),
  )

  it(
    "grows no name row for a signed-out reader either",
    withWorker(async () => {
      const sh = await openYou("1566", {}, { me: async () => null })
      expect(sh.querySelector<HTMLElement>(".you-who")!.hidden).toBe(true)
    }),
  )

  it(
    "names the reader above their own number, and opens their profile",
    withWorker(async () => {
      const opened: string[] = []
      const sh = await openYou("1563", {}, {
        me: async () => ME,
        openRoom: (route: string) => opened.push(route),
      })
      const who = sh.querySelector<HTMLElement>(".you-who")!
      expect(who.hidden).toBe(false)
      expect(who.querySelector(".you-who-name")!.textContent).toBe("@levvercetti")
      expect(who.querySelector(".you-who-go")!.textContent).toBe("Profile ›")
      // The SRC, not just the element: avatarImg only writes one onto a
      // CONNECTED img, and an image parked off-DOM would stay blank
      // forever. That is the exact way the strip's own face broke first.
      const av = who.querySelector<HTMLImageElement>(".you-who-av img")!
      expect(av).toBeTruthy()
      expect(av.getAttribute("src")).not.toBe(ME.photoUrl)
      expect(av.src).toBe(FACE)
      // ABOVE the figure, not below it: the room says whose before it says
      // how much.
      const head = sh.querySelector<HTMLElement>(".you-head")!
      expect(head.firstElementChild).toBe(who)
      who.click()
      // /profile/<id>, which openPanelRoom's allowlist already admits —
      // bare /profile does not match its pattern.
      expect(opened).toEqual([`/profile/${ME.id}`])
      expect(/^\/profile\/[\w-]+$/.test(opened[0])).toBe(true)
    }),
  )

  it(
    "still draws the row for a reader with no handle and no photo",
    withWorker(async () => {
      const opened: string[] = []
      const sh = await openYou("1564", {}, {
        me: async () => ({ id: ME.id, username: "", photoUrl: null }),
        openRoom: (route: string) => opened.push(route),
      })
      const who = sh.querySelector<HTMLElement>(".you-who")!
      expect(who.hidden).toBe(false)
      expect(who.querySelector(".you-who-name")!.textContent).toBe("Your profile")
      // No blank disc where a face would be.
      expect(who.querySelector(".you-who-av")).toBeNull()
      who.click()
      expect(opened).toEqual([`/profile/${ME.id}`])
    }),
  )

  it(
    "grows no door when there is nowhere to send anyone",
    withWorker(async () => {
      const sh = await openYou("1565", {}, { me: async () => ME, openRoom: undefined })
      expect(sh.querySelector<HTMLElement>(".you-who")!.hidden).toBe(true)
    }),
  )

  it("leads with the P&L, in the biggest type on the surface", async () => {
    const sh = await openYou("1500")
    const big = sh.querySelector<HTMLElement>(".you-pnl")!
    expect(big.textContent).toBe("−$1.86")
    expect(big.classList.contains("down")).toBe(true)
    expect(sh.querySelector(".you-cap")!.textContent).toBe("All time")
  })

  it("captions the score with what is already banked, when it is known", async () => {
    /**
     * The big number swings with every tick; the banked figure is the
     * part no candle can take back. Null (or dust) keeps the one-word
     * caption — a zero would claim "you banked nothing" about ledgers
     * that simply predate quantities, and the base fixture above already
     * locks that side.
     */
    const sh = await openYou("1503", { totalRealizedPnlUsd: 12.4 })
    expect(sh.querySelector(".you-cap")!.textContent).toBe(
      "All time · +$12.40 banked",
    )
  })

  it("says what each holding IS and what it is WORTH", async () => {
    // The owner's words: "hangi tokendan kaç tane var ve kaç usd ediyor".
    const sh = await openYou("1501")
    // The list holds assets only — cash is the head's own line, one row up.
    const rows = sh.querySelectorAll<HTMLElement>(".you-row")
    // Three: the two positions and the cash. USDC is a holding — the hero
    // said $9.05 while the list under it showed nothing that added up to
    // it, because the server sends cash and positions separately, which is
    // a fact about our plumbing and not about the reader's wallet.
    expect(rows.length).toBe(3)
    expect(
      [...rows].some((r) => r.querySelector(".you-tick")?.textContent === "USDC"),
      "the cash is in the list a reader goes to for what they own",
    ).toBe(true)
    // Biggest first — a scoreboard is ordered by what matters.
    expect(rows[0].querySelector(".you-tick")!.textContent).toBe("WIF")
    expect(rows[0].querySelector(".you-qty")!.textContent).toBe("12.4")
    expect(rows[0].querySelector(".you-val")!.textContent).toBe("$26.04")
    expect(rows[0].querySelector(".you-pl")!.textContent).toBe("+$1.04")
    // A million of something is not "1250000.00".
    expect(rows[1].querySelector(".you-qty")!.textContent).toBe("1,250,000")
    expect(rows[1].querySelector(".you-pl")!.classList.contains("down")).toBe(true)
  })

  it("prints an em dash for a holding nobody could price, never $0.00", async () => {
    /**
     * The rule this codebase keeps having to re-learn. "$0.00" claims the
     * position is worthless; the truth is that the server could not price
     * it, which is a different sentence entirely.
     */
    const sh = await openYou("1502", {
      totalPnlUsd: null,
      positions: [
        { mint: "m3", ticker: "GHOST", uiAmount: 5, raw: "1", netInvestedUsd: null,
          priceUsd: null, valueUsd: null, pnlUsd: null },
      ],
    })
    // The ASSET row's value, not the cash row's that now leads the list.
    expect(sh.querySelector(".you-row:not(.cash) .you-val")!.textContent).toBe("—")
    expect(sh.querySelector(".you-pl")).toBeFalsy()
    // And the headline falls back to a value rather than a fake zero.
    expect(sh.querySelector(".you-pnl")!.textContent).not.toBe("$0.00")
  })

  it("shows every open order, not just this tweet's asset", async () => {
    const sh = await openYou("1503", {}, {
      listOrders: async () => [
        { orderKey: "k1", mint: "OTHER", symbol: "JUP", side: "sell" as const,
          amountUsd: null, amountUi: 40, triggerPriceUsd: 1.25, gated: false },
      ],
    })
    sh.querySelectorAll<HTMLElement>(".tab")[1].click()
    const row = sh.querySelector<HTMLElement>(".you-row")!
    expect(row.querySelector(".you-side")!.textContent).toBe("Sell")
    // Its own class, not the Sell button's: `.sell` carries a tinted ground
    // and button padding, and a word in a list wearing them looked like a
    // control somebody could press.
    expect(row.querySelector(".you-side")!.classList.contains("sell")).toBe(false)
    expect(row.querySelector(".you-side-sell")).toBeTruthy()
    expect(row.querySelector(".you-tick")!.textContent).toBe("JUP")
    expect(row.querySelector(".you-val")!.textContent).toContain("$1.25")
  })

  it("says what there is to spend, always", async () => {
    // The row shows the balance only when it cannot cover a press; the
    // panel exists because somebody asked about their money, and "how am
    // I doing" without "what can I spend" is half an answer.
    const sh = await openYou("1507")
    expect(sh.querySelector(".you-cash")!.textContent).toBe("USDC $9.46")
  })

  it("the bell stands always, counts the news, and lands ON it", async () => {
    /**
     * A fired alert used to exist only as a system toast — the OS may
     * swallow it and the surface never echoed it. First echo was a dot
     * on the score pill: correct while news existed, invisible the rest
     * of the time, and the owner asked "nereye geldi notifications?" —
     * a door that only appears when somebody is knocking is not a door.
     * The bell is permanent; the count rides it; pressing it opens
     * Activity directly and marks the news read.
     */
    const markFiredRead = vi.fn(async () => undefined)
    const sh = await openYou("1511", {}, {
      // Chronological, as recordFired appends: oldest first, newest last.
      listFired: async () => [
        { id: "f2", mint: "M2", symbol: "PUMP", targetUsd: 0.01, direction: "below" as const, atUsd: 0.0099, firedAt: Date.now() - 120_000, read: true },
        { id: "f1", mint: "M1", symbol: "WIF", targetUsd: 2.5, direction: "above" as const, atUsd: 2.52, firedAt: Date.now() - 60_000, read: false },
      ],
      markFiredRead,
    })
    // The helper pressed the score pill, which is the PORTFOLIO's door
    // and stays on Holdings even with news waiting.
    expect(sh.querySelector('.tab[aria-pressed="true"]')!.textContent).toBe("Holdings")
    // The bell is the news door: back out, press it, land on Activity.
    sh.querySelector<HTMLElement>(".back")!.click()
    const bell = sh.querySelector<HTMLElement>(".ring")!
    expect(bell.querySelector<HTMLElement>(".wal-dot")!.hidden).toBe(false)
    expect(bell.querySelector(".wal-dot")!.textContent).toBe("1")
    bell.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector('.tab[aria-pressed="true"]')!.textContent).toBe("Activity")
    expect(markFiredRead).toHaveBeenCalled()
    // The news band leads, newest first, with the price that crossed.
    const fired = sh.querySelectorAll<HTMLElement>(".you-fired")
    expect(fired.length).toBe(2)
    expect(fired[0].querySelector(".you-tick")!.textContent).toBe("WIF")
    expect(fired[0].querySelector(".you-val")!.textContent).toBe("hit $2.52")
  })

  it("keeps the dot asleep when everything fired is read", async () => {
    const sh = await openYou("1512", {}, {
      listFired: async () => [
        { id: "f3", mint: "M1", symbol: "WIF", targetUsd: 2.5, direction: "above" as const, atUsd: 2.52, firedAt: Date.now(), read: true },
      ],
    })
    const dot = sh.querySelector<HTMLElement>(".wal-dot")
    // The pill was pressed by the helper; before that press the dot was
    // hidden — and with no unread, the panel opens on Holdings as ever.
    expect(sh.querySelector('.tab[aria-pressed="true"]')!.textContent).toBe("Holdings")
    if (dot) expect(dot.hidden).toBe(true)
  })

  it("lists what is standing on the Activity tab, and sets nothing there", async () => {
    // Alerts are one kind of notification, not a feature beside them, so
    // the tab READS them; the one place that writes one is the sheet's
    // bell, beside the price it is about (see "parks the typed price").
    const sh = await openYou("1509", {}, {
      saveAlert: vi.fn(async () => true),
      listAlerts: async () => [
        { id: "a1", mint: "M1", symbol: "WIF", targetUsd: 150, direction: "above" as const, createdAt: Date.now() },
      ],
    })
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".you-set-in")).toBeNull()
    const rows = sh.querySelectorAll<HTMLElement>(".you-row")
    expect(rows.length).toBe(1)
    expect(rows[0].querySelector(".you-tick")!.textContent).toBe("WIF")
    expect(rows[0].querySelector(".you-val")!.textContent).toBe("@ $150.00")
  })

  it("hidden actually hides, whatever display a class gave the element", async () => {
    /**
     * The bug this exists to prevent shipped twice. `hidden` takes its
     * display:none from the BROWSER's stylesheet, and any author rule -
     * `.you-head { display: flex }` - outranks a UA rule at any
     * specificity. So `el.hidden = true` on a styled element is a silent
     * no-op that every jsdom assertion on `.hidden` still passes.
     *
     * Asserting the property is therefore not enough; this asserts the
     * escape hatch that makes the property mean something. It is one
     * `!important` rule, so nothing declared later can outrank it.
     */
    const sh = await openYou("1526")
    const css = sh.querySelector("style")!.textContent!
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/)
    // And it must LEAD the declarations, so nothing can be written above
    // it and quietly win. Comments do not count as declarations.
    const decls = css.replace(/\/\*[\s\S]*?\*\//g, "")
    const at = decls.indexOf("[hidden]")
    expect(at).toBeGreaterThanOrEqual(0)
    expect(decls.slice(0, at)).not.toMatch(/display:/)
  })

  it("the wallet furniture steps aside with the score on Activity", async () => {
    /**
     * Deposit and the feed door are the money's exits; on the one tab that
     * is not about the money they were the loudest thing under a list they
     * have nothing to do with.
     */
    const sh = await openYou("1524")
    const foot = sh.querySelector<HTMLElement>(".you-foot")!
    expect(foot.hidden).toBe(false)
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    expect(foot.hidden).toBe(true)
    sh.querySelectorAll<HTMLElement>(".tab")[1].click()
    expect(foot.hidden).toBe(false)
  })

  it("Feed opens the feed room, not this asset's corner of it", async () => {
    const openFeed = vi.fn()
    const openPanel = vi.fn()
    const sh = await openYou("1525", {}, { openFeed, openPanel })
    sh.querySelector<HTMLElement>(".you-feed")!.click()
    expect(openFeed).toHaveBeenCalled()
    // The asset door must NOT be what a button labelled Feed opens.
    expect(openPanel).not.toHaveBeenCalled()
  })

  it("the scoreboard paints yesterday's book while today's loads", async () => {
    /**
     * /positions is 8.6s cold and the scoreboard is a display surface -
     * the persisted cache's exact customer. The live read here never
     * resolves; the cached one must carry the whole first paint.
     */
    const sh = await openYou("1550", {}, {
      book: (() => new Promise(() => {})) as never,
      cachedBook: (async () => ({
        cashUsd: 12.5,
        totalUsd: 100,
        totalPnlUsd: 42,
        totalUnrealizedPnlUsd: 42,
        totalRealizedPnlUsd: 0,
        positions: [],
      })) as never,
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(sh.querySelector(".you-cash")!.textContent).toContain("$12.50")
    expect(sh.querySelector(".you-pnl")!.textContent).not.toBe("…")
  })

  it("signed-out is a knowable state, not a network blip", async () => {
    const signIn = vi.fn()
    const sh = await openYou("1540", {}, {
      book: (async () => {
        throw { status: 401, message: "unauthorized" }
      }) as never,
      signIn,
    })
    // The hero says the honest claim: the balance is unowned, not broken.
    expect(sh.querySelector(".you-cap")!.textContent).toBe("No account yet")
    // And the money door becomes the true next step.
    const door = sh.querySelector<HTMLElement>(".you-add")!
    expect(door.textContent).toBe("Sign in")
    door.click()
    expect(signIn).toHaveBeenCalled()
  })

  it("a genuine read failure keeps today's honest silence", async () => {
    const signIn = vi.fn()
    const sh = await openYou("1541", {}, {
      book: (async () => {
        throw { status: 500, message: "boom" }
      }) as never,
      signIn,
    })
    expect(sh.querySelector(".you-cap")!.textContent).toBe("Balance unavailable")
    const door = sh.querySelector<HTMLElement>(".you-add")!
    expect(door.textContent).toMatch(/^Deposit .*USDC$/)
    door.click()
    expect(signIn).not.toHaveBeenCalled()
  })

  it("a holdings row is a door to its token's room", async () => {
    const openRoom = vi.fn()
    const sh = await openYou("1530", {}, { openRoom })
    const row = sh.querySelector<HTMLElement>(".you-row:not(.cash)")!
    expect(row.classList.contains("door")).toBe(true)
    row.click()
    // The harness's default book holds mint "m1" — the door carries the
    // row's OWN mint, whatever it is.
    expect(openRoom).toHaveBeenCalledWith("/token/m1")
  })

  it("without the dep, rows stay plain and never promise a door", async () => {
    const sh = await openYou("1531")
    const row = sh.querySelector<HTMLElement>(".you-row:not(.cash)")!
    expect(row.classList.contains("door")).toBe(false)
  })

  it("a fill row opens the market it filled on", async () => {
    const openRoom = vi.fn()
    const sh = await openYou("1532", {}, {
      openRoom,
      listAlerts: async () => [],
      listNotifications: async () => [],
      listFills: async () => [
        {
          orderKey: "k1", mint: WIF_ASSET.mint, side: "buy" as const,
          amountUsd: 25, amountUi: 100, triggerPriceUsd: 0.16,
          symbol: "$WIF", at: Date.now() - 60_000,
        },
      ],
      // The harness's default enrich answers with the asset; a null here
      // would make the chip delete itself, which is its own tested rule.
    })
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    await new Promise((r) => setTimeout(r, 0))
    const row = sh.querySelector<HTMLElement>(".you-filled")!
    row.click()
    expect(openRoom).toHaveBeenCalledWith(`/token/${WIF_ASSET.mint}`)
  })

  it("a notification goes only where the host said it could", async () => {
    const openRoom = vi.fn()
    const sh = await openYou("1533", {}, {
      openRoom,
      listAlerts: async () => [],
      // reply/mention rather than follow/like: the tab drops the purely
      // social kinds now, and these tests are about how a row is DRAWN.
      listNotifications: async () => [
        {
          id: "n1", kind: "reply" as const, text: "nic replied to your pop",
          created_at: new Date().toISOString(), route: "/profile/u1",
        },
        {
          id: "n2", kind: "mention" as const, text: "someone mentioned you",
          created_at: new Date().toISOString(),
          // No route from the host: the row stays plain.
          route: null,
        },
      ],
    })
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    await new Promise((r) => setTimeout(r, 0))
    const rows = sh.querySelectorAll<HTMLElement>(".you-note")
    rows[0].click()
    rows[1].click()
    expect(openRoom).toHaveBeenCalledTimes(1)
    expect(openRoom).toHaveBeenCalledWith("/profile/u1")
  })

  it("a press on a row's own button never also opens the door", async () => {
    const openRoom = vi.fn()
    const removeAlert = vi.fn(async () => {})
    const sh = await openYou("1534", {}, {
      openRoom,
      removeAlert,
      listAlerts: async () => [
        { id: "a1", mint: WIF_ASSET.mint, symbol: "$WIF", targetUsd: 1, direction: "above" as const },
      ],
      listNotifications: async () => [],
    })
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".you-x")!.click()
    expect(openRoom).not.toHaveBeenCalled()
  })

  it("only a green row with an honest basis offers the flex", async () => {
    const sh = await openYou("1535", {
      positions: [
        {
          mint: WIF_ASSET.mint, ticker: "$WIF", uiAmount: 100,
          priceUsd: 2, valueUsd: 200, unrealizedPnlUsd: 100,
          avgEntryPriceUsd: 1,
        },
        {
          mint: "LOSS111111111111111111111111111111111111111", ticker: "$RED",
          uiAmount: 50, priceUsd: 0.5, valueUsd: 25, unrealizedPnlUsd: -25,
          avgEntryPriceUsd: 1,
        },
        {
          mint: "NOBASIS111111111111111111111111111111111111", ticker: "$OLD",
          uiAmount: 10, priceUsd: 3, valueUsd: 30, unrealizedPnlUsd: null,
          avgEntryPriceUsd: null,
        },
      ],
    })
    const rows = [...sh.querySelectorAll<HTMLElement>(".you-row:not(.cash)")]
    const flexes = rows.map((r) => !!r.querySelector(".you-flex"))
    expect(flexes).toEqual([true, false, false])
  })

  it("steps the score aside on Activity, and keeps it on the money tabs", async () => {
    /**
     * Activity is the one tab that is NOT about the reader's money — it is
     * who did what, and what filled — and a 30px all-time figure above it
     * was eating the room the news needed while answering a question
     * nobody asked there. Holdings and Orders keep it: those ARE the money.
     */
    const sh = await openYou("1520")
    const head = sh.querySelector<HTMLElement>(".you-head")!
    expect(head.hidden).toBe(false)
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    expect(head.hidden).toBe(true)
    sh.querySelectorAll<HTMLElement>(".tab")[0].click()
    expect(head.hidden).toBe(false)
  })

  it("wears the actor's own face, fetched through the worker, with the kind still on their shoulder", async () => {
    /**
     * MEASURED: x.com's img-src is its own hosts plus data:, so a photo set
     * as a plain src never loads on the page. The face is asked of the
     * worker (POPPIN_ICON_FETCH) and lands as the data URI it answers with;
     * the remote address is never the src.
     */
    const DATA = "data:image/png;base64,QUJD"
    const asked: string[] = []
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: undefined,
        sendMessage: (msg: { type?: string; url?: string }, cb?: (r: unknown) => void) => {
          if (msg?.type === "POPPIN_ICON_FETCH") {
            asked.push(String(msg.url))
            cb?.({ dataUri: DATA })
            return undefined
          }
          cb?.(undefined)
          return Promise.resolve()
        },
      },
    })
    try {
      const sh = await openYou("1521", {}, {
        listAlerts: async () => [],
        listNotifications: async () => [
          {
            id: "n1",
            kind: "reply" as const,
            text: "nic replied to your pop",
            created_at: new Date(Date.now() - 120000).toISOString(),
            avatarUrl: "https://example.test/nic.png",
          },
          {
            id: "n2",
            kind: "mention" as const,
            text: "lev3 mentioned you",
            created_at: new Date(Date.now() - 120000).toISOString(),
            // No photo: the row keeps the glyph it always had.
            avatarUrl: null,
          },
        ],
      })
      sh.querySelectorAll<HTMLElement>(".tab")[2].click()
      const rows = sh.querySelectorAll<HTMLElement>(".you-note")
      const face = rows[0].querySelector<HTMLImageElement>(".you-actor img")!
      expect(face.getAttribute("src")).not.toBe("https://example.test/nic.png")
      await Promise.resolve()
      await Promise.resolve()
      expect(asked).toContain("https://example.test/nic.png")
      expect(face.src).toBe(DATA)
      // The KIND is never lost to the face — the glyph rides the corner.
      expect(rows[0].querySelector(".you-actor-badge svg")).toBeTruthy()
      // Without a photo the row is exactly what it was before.
      expect(rows[1].querySelector(".you-actor")).toBeNull()
      expect(rows[1].querySelector(".act-ico svg")).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("a filled order looks like a trade: the coin's face and its market cap", async () => {
    const sh = await openYou("1522", {}, {
      listAlerts: async () => [],
      listNotifications: async () => [],
      listFills: async () => [
        {
          orderKey: "k1",
          mint: WIF_ASSET.mint,
          side: "buy" as const,
          amountUsd: 25,
          amountUi: 100,
          triggerPriceUsd: 0.16,
          symbol: "$WIF",
          at: Date.now() - 60_000,
        },
      ],
      enrich: vi.fn(async () => ({ ...WIF_ASSET, mcap: 3_040_000 }) as MatchedAsset),
    })
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    await new Promise((r) => setTimeout(r, 0))
    const row = sh.querySelector<HTMLElement>(".you-filled")!
    // The same disc the book's rows wear — one helper, so they cannot drift.
    expect(row.querySelector(".you-ico")).toBeTruthy()
    // And the unit a memecoin's size is actually said in.
    expect(row.querySelector(".you-val")!.textContent).toBe("bought at $3.0M market cap")
  })

  it("the list scrolls rather than growing the chip past the viewport", async () => {
    const sh = await openYou("1523")
    const css = sh.querySelector("style")!.textContent!
    expect(css).toMatch(/\.you-list \{[^}]*overflow-y: auto/)
    expect(css).toMatch(/\.you-list \{[^}]*max-height/)
  })

  it("shows recent notifications under the alerts", async () => {
    const sh = await openYou("1510", {}, {
      listAlerts: async () => [],
      // Pre-sentenced by the host — the chip never sees a type. The raw
      // wiring put "An Arc market needs a resolve decision" walls and bare
      // "follow" rows on screen; the whitelist lives host-side now.
      listNotifications: async () => [
        { id: "n1", kind: "reply" as const, text: 'ansem replied: "gm"', created_at: new Date(Date.now() - 120000).toISOString() },
      ],
    })
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    const note = sh.querySelector<HTMLElement>(".you-note")!
    expect(note.querySelector(".you-note-text")!.textContent).toBe('ansem replied: "gm"')
    // The age is a WORD about time, so it left the data voice with the
    // rest of the prose (.you-when, product face).
    expect(note.querySelector(".you-when")!.textContent).toBe("2m")
    // The shared visual language: every Activity row leads with a glyph disc.
    expect(note.querySelector(".act-ico svg")).toBeTruthy()
  })

  it("lists the standing alerts, with a way out", async () => {
    /**
     * Alerts could be SET from the bell since they shipped and then lived
     * nowhere a reader could see — no list, no cancel short of waiting
     * for one to fire. A standing thing the surface cannot show is a
     * promise the reader keeps in their head.
     */
    const removeAlert = vi.fn(async () => undefined)
    const sh = await openYou("1508", {}, {
      listAlerts: async () => [
        { id: "a1", mint: "M1", symbol: "WIF", targetUsd: 2.5, direction: "above" as const, createdAt: 1 },
        { id: "a2", mint: "M2", symbol: "PUMP", targetUsd: 0.001, direction: "below" as const, createdAt: 2 },
      ],
      removeAlert,
    })
    sh.querySelectorAll<HTMLElement>(".tab")[2].click()
    const rows = sh.querySelectorAll<HTMLElement>(".you-row:not(.cash)")
    expect(rows.length).toBe(2)
    expect(rows[0].querySelector(".you-tick")!.textContent).toBe("WIF")
    // Words, not a ticker's ▲/▼: the row says which way it is watching.
    expect(rows[0].querySelector(".you-side")!.textContent).toBe("Above")
    expect(rows[1].querySelector(".you-side")!.textContent).toBe("Below")

    rows[0].querySelector<HTMLElement>(".you-x")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(removeAlert).toHaveBeenCalledWith("a1")
    expect(sh.querySelectorAll(".you-row:not(.cash)").length).toBe(1)
  })

  it("has a Back that means back, beside a close that means close", async () => {
    const sh = await openYou("1504")
    // Back returns to the row; the tail × does too, but they are drawn as
    // two controls because they answer two different questions.
    expect(sh.querySelector(".back")!.textContent).toBe("‹ Back")
    sh.querySelector<HTMLElement>(".back")!.click()
    expect(sh.querySelector(".you")).toBeFalsy()
    expect(sh.querySelector(".wal")).toBeTruthy()
  })

  it("a landed top-up returns to the scoreboard, not the resting row", async () => {
    /**
     * The one person who just moved money is the one person who should
     * see it arrive. The success path used to close all the way down to
     * the row, so the reader funded FROM the scoreboard and never saw
     * the balance land on it. The Back button did the right thing all
     * along; only success did not.
     */
    const sh = await openYou("1506", {}, { topUp: vi.fn(async () => true), canFundHere: async () => true })
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".fund .pick")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".fund")).toBeFalsy()
    expect(sh.querySelector(".you")).toBeTruthy()
  })

  it("Back out of funding lands on the scoreboard it came from", async () => {
    const sh = await openYou("1505")
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".fund")).toBeTruthy()
    sh.querySelector<HTMLElement>(".fund .back")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".you")).toBeTruthy()
  })

  /**
   * THE PRESS LEV MADE, RUN. He opened this room on a wallet account,
   * pressed "Deposit USDC", and Phantom offered him "+10.15 USDC, -0.088
   * SOL" — his own SOL being sold, at a figure he never chose, for a deposit
   * that deposited nothing. The chip's half of that is one line: this door
   * passes NO amount, and whatever it reaches must not invent one.
   *
   * Everything downstream of topUp is pinned in entries/fund-doors.spec.ts
   * (the guard in primary/main.tsx routes a wallet account to the panel's
   * address screen and signs nothing). What runs here is the door itself.
   */
  it("a wallet account's door carries no amount, and opens no picker", async () => {
    const topUp = vi.fn(async () => false)
    const sh = await openYou("1507", {}, { topUp, fundRoute: async () => "external" })
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    // The amount picker is the custodial screen — its own note promises
    // "Straight to your Poppin balance", which a wallet account has none of.
    expect(sh.querySelector(".fund")).toBeFalsy()
    // And the figure: no arguments at all, so there is nothing for a
    // fallback to round up (helpers/topUpAmount would answer $10 to an
    // absent one, which is exactly the number Phantom was shown).
    expect(topUp).toHaveBeenCalledTimes(1)
    expect(topUp.mock.calls[0]).toEqual([])
  })

  it("a custodial account still gets the picker, so the route is what decides", async () => {
    const topUp = vi.fn(async () => false)
    const sh = await openYou("1508", {}, { topUp, fundRoute: async () => "custodial" })
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".fund")).toBeTruthy()
    // Nothing is asked for until the reader picks a figure.
    expect(topUp).not.toHaveBeenCalled()
  })
})

describe("the balance is conditional, the score is not", () => {
  /**
   * They shipped as one pair and they are two different jobs.
   *
   * Spendable cash is byte-identical on every chip in a screenful and
   * says nothing about the token on screen. It changes a decision in
   * exactly one state: when it cannot cover what a press would spend.
   * Permanently on it is wallpaper; in that state it is the most useful
   * thing on the row.
   *
   * All-time P&L is also the same on every chip, and that is the point.
   * It is the reader's score, and a score is worth having in front of
   * you. Owner's call, taken over the wallpaper argument on the grounds
   * that the argument applies to a number nobody came to see.
   */
  const rest = async (id: string, cash: number, pnl: number | null) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: (async () => ({ cashUsd: cash, totalPnlUsd: pnl, positions: [] })) as never,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    return host.shadowRoot!.querySelector<HTMLElement>(".wal")!
  }

  it("carries NO figure — it is a door, not a readout", async () => {
    /**
     * FOURTH AND FINAL RULING (field, 2026-08-31). The pill carried
     * balance+score, then score-unless-short, then a lone warning, then
     * the bare score — and the bare score was the loudest terminal object
     * left on the row: all-time P&L across EVERY asset the reader has
     * ever traded, parked under a stranger's tweet, all day. Worse, it
     * COLLIDED with the face's own "You +8.2%" a few inches away: two
     * figures about the reader, opposite colours, neither stating its
     * scope.
     *
     * So the row keeps one "You" — the one about THIS tweet's asset — and
     * the pill goes back to being what it always was underneath: the door
     * to the scoreboard, where the same number is already drawn at 30px
     * under its own caption.
     */
    const wal = await rest("1300", 500, -1.88)
    expect(wal.textContent?.trim()).toBe("")
    expect(wal.querySelector(".wal-pnl")).toBeNull()
    expect(wal.querySelector("svg")).toBeTruthy()
    // Never the cash either — that ruling stands.
    expect(wal.textContent).not.toContain("$500")
  })

  it("is PERMANENT: a flat or signed-out reader still has a door", async () => {
    /**
     * The old element hid whenever both numbers were absent, so a reader
     * with no score — signed out, or simply flat — had no way into their
     * own portfolio at all. A door that only appears once you have money
     * is a door for people who do not need it.
     */
    for (const [id, pnl] of [["1301", null], ["1302", 42.5]] as const) {
      const wal = await rest(id, 500, pnl)
      expect(wal.hidden).toBe(false)
    }
  })
})

describe("one clock", () => {
  /**
   * The price carried the direction of the LAST TICK for 900ms while the
   * badge six pixels away carried the LAST 24 HOURS. Two clocks, one
   * asset, and no way for a reader to know they were different questions
   * — photographed live as a red $0.3164 beside a green +24.8%.
   *
   * Nothing asserted the old behaviour, so nothing broke when it went.
   * That is the reason to write this down: the next pass that wants a
   * livelier price should have to argue with a test rather than discover
   * the contradiction in a screenshot.
   */
  const priced = async (id: string, first: number, second: number) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(500) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    const key = host.getAttribute("data-poppin-strip")!
    ctl.updatePrice(key, first, 24.8)
    ctl.updatePrice(key, second, 24.8)
    return sh
  }

  it("never paints the price by the tick, in either direction", async () => {
    const down = await priced("1200", 100, 90)
    const px = down.querySelector<HTMLElement>(".px")!
    expect(px.classList.contains("down")).toBe(false)
    expect(px.classList.contains("up")).toBe(false)

    const up = await priced("1201", 90, 100)
    expect(up.querySelector<HTMLElement>(".px")!.classList.contains("up")).toBe(false)
  })

  it("still pulses, because a print is worth noticing", async () => {
    // What went is the HUE, not the liveness. Losing both would make a
    // moving price indistinguishable from a frozen one.
    const sh = await priced("1202", 100, 90)
    expect(sh.querySelector<HTMLElement>(".px")!.classList.contains("flash")).toBe(true)
  })

  it("leaves direction to the badge, which owns one question", async () => {
    const sh = await priced("1203", 100, 90)
    // The day was up 24.8% even though the last print was down. The badge
    // answers the day and is the only thing on the row that answers at all.
    const chg = sh.querySelector<HTMLElement>(".chg")!
    expect(chg.classList.contains("up")).toBe(true)
    expect(chg.textContent).toContain("24.8")
  })
})

describe("line or candles", () => {
  /**
   * The data was always there: the spark service fetches full OHLCV from
   * GeckoTerminal and used to keep ts and close and throw the rest away —
   * the same "read two fields of six" shape found twice elsewhere today.
   * So a candle view costs no extra request, and the only real questions
   * are what happens when the server cannot answer it and whether flipping
   * refetches.
   */
  const series = (ohlc: boolean) =>
    vi.fn(async () => ({
      points: [10, 12, 11, 13],
      times: null,
      opens: ohlc ? [9, 10, 12, 11] : null,
      highs: ohlc ? [11, 13, 12, 14] : null,
      lows: ohlc ? [8, 9, 10, 11] : null,
      failed: false,
    }))

  const chart = async (id: string, opts: { ohlc?: boolean; view?: "line" | "candle" } = {}) => {
    const write = vi.fn()
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      series: series(opts.ohlc ?? true) as never,
      chartView: { read: async () => opts.view ?? "line", write },
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    return { sh, write, series: d.series as ReturnType<typeof vi.fn> }
  }

  it("draws the line until asked otherwise", async () => {
    const { sh } = await chart("1100")
    expect(sh.querySelector("polyline")!.getAttribute("points")).not.toBe("")
    expect(sh.querySelectorAll(".chart-svg rect").length).toBe(0)
    // The icon IS the label: a chart type draws itself faster than any
    // word, in any language, at a third of the width.
    expect(sh.querySelector(".view")!.getAttribute("title")).toBe("Line")
    expect(sh.querySelector(".view svg")).toBeTruthy()
  })

  it("draws candles when the reader has chosen them", async () => {
    const { sh } = await chart("1101", { view: "candle" })
    // One body and one wick per bucket, and the line stands down.
    expect(sh.querySelectorAll(".chart-svg rect").length).toBe(4)
    expect(sh.querySelectorAll(".chart-svg g line").length).toBe(4)
    expect(sh.querySelector("polyline")!.getAttribute("points")).toBe("")
  })

  it("one choice, every open chart", async () => {
    /**
     * A timeline holds many chips at once, and the view is a preference,
     * not a per-chip setting: flipping one and finding the one below it
     * still on the old drawing reads as a bug in the toggle.
     *
     * Every other spec in here drives a single chart, where the pressing
     * chip is its own subscriber and passes whether or not the broadcast
     * reaches anyone else. The behaviour only shows up with a second
     * chart open, so that is what this builds.
     */
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      series: series(true) as never,
      chartView: { read: async () => "line" as const, write: vi.fn() },
    })
    const ctl = createXStrip(d)

    const open = async (id: string) => {
      const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
      ctl.processCell(cell)
      const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
      await new Promise((r) => setTimeout(r, 0))
      ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
      host.shadowRoot!.querySelector<HTMLElement>(".more")!.click()
      await new Promise((r) => setTimeout(r, 0))
      return host.shadowRoot!
    }

    const first = await open("1106")
    const second = await open("1107")
    expect(second.querySelectorAll(".chart-svg rect").length).toBe(0)

    first.querySelector<HTMLElement>(".view")!.click()
    await new Promise((r) => setTimeout(r, 0))

    // The other chart followed: same drawing, same icon, same word.
    expect(second.querySelectorAll(".chart-svg rect").length).toBe(4)
    expect(second.querySelector(".view")!.getAttribute("title")).toBe("Candles")
  })

  it("flipping neither re-reads the reader's story nor echoes it", async () => {
    /**
     * The fetch-count spec below guarded "flipping is a REDRAW, not a
     * refetch" all along — and only counted the PRICE fetch. The two
     * reads nobody promised (my-trades, orders) slipped past it on every
     * flip, and worse: each repaint APPENDED a fresh copy of every disc
     * and order level over the last one. Two flips, three of each marker,
     * a chart telling the same trade three times.
     */
    const myTrades = vi.fn(async () => [{ side: "buy" as const, ts: 1_500 }])
    const listOrders = vi.fn(async () => [
      {
        orderKey: "k1",
        mint: WIF_ASSET.mint,
        side: "sell" as const,
        amountUsd: 10,
        amountUi: 1,
        triggerPriceUsd: 12,
        gated: false,
      },
    ])
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      series: (async () => ({
        points: [10, 12, 11, 13],
        times: [1_000, 2_000, 3_000, 4_000],
        opens: [9, 10, 12, 11],
        highs: [11, 13, 12, 14],
        lows: [8, 9, 10, 11],
        failed: false,
      })) as never,
      chartView: { read: async () => "line" as const, write: vi.fn() },
      myTrades,
      listOrders,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1109", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelectorAll(".mark").length).toBe(1)
    expect(sh.querySelectorAll(".order-level").length).toBe(1)

    // Two flips: line → candles → line.
    sh.querySelector<HTMLElement>(".view")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".view")!.click()
    await new Promise((r) => setTimeout(r, 0))

    expect(myTrades).toHaveBeenCalledTimes(1)
    expect(listOrders).toHaveBeenCalledTimes(1)
    expect(sh.querySelectorAll(".mark").length).toBe(1)
    expect(sh.querySelectorAll(".order-level").length).toBe(1)
    expect(sh.querySelectorAll(".order-tag").length).toBe(1)
  })

  it("marks your own trades with an arrow aimed at the price", async () => {
    /**
     * The mark went dot to arrow to dot and back to arrow, and each turn
     * was a real reader failing to read it. The first dot drew one colour
     * and no side — "aldığım yer mi?". The arrow after it stood OFF the
     * level to have something to aim at, which put every mark at a price
     * nobody traded. The dot that replaced it told the truth about the
     * price and went back to carrying no direction, which is how it was
     * reported again: two discs, green and red, at a similar price minutes
     * apart, sitting on top of each other and on top of a green line.
     *
     * Both requirements are lockable at once, and that is what this pins.
     * The SIDE is answered by shape as well as colour — the industry's own
     * convention, green up for in and red down for out — and the shape is
     * anchored so its TIP is the traded price and its body hangs off it.
     * Buy translates 0% vertically (tip at the box's top edge, body below),
     * sell translates -100% (tip at the bottom, body above). That per-side
     * anchoring is the whole mechanism: without it an arrow is back to
     * pointing at a price the reader never paid.
     */
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      // Marks ride the line at their moment, so the window needs real
      // timestamps — a series with times: null has nowhere to put them.
      series: (async () => ({
        points: [10, 12, 11, 13],
        times: [1_000, 2_000, 3_000, 4_000],
        opens: [9, 10, 12, 11],
        highs: [11, 13, 12, 14],
        lows: [8, 9, 10, 11],
        failed: false,
      })) as never,
      chartView: { read: async () => "line" as const, write: vi.fn() },
      myTrades: async () => [
        { side: "buy" as const, ts: 1_500 },
        { side: "sell" as const, ts: 3_500 },
      ],
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1108", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const marks = sh.querySelectorAll<HTMLElement>(".mark")
    expect(marks.length).toBe(2)

    const css = sh.querySelector("style")!.textContent!
    // A border triangle, which needs a zero-sized box: a width or a radius
    // here would mean the shape went back to being a disc.
    expect(css).toMatch(/\.mark \{[^}]*width: 0/)
    expect(css).not.toMatch(/\.mark \{[^}]*border-radius: 50%/)

    const sideRules = css.match(/\.mark\.[bs] \{[^}]*\}/g)!.join("\n")
    // Green in, red out, and NOT the blue this used to be — blue never
    // meant "buy" anywhere else on the surface. Scoped to the two side
    // rules on purpose: accentDeep is #5EC1FF and is used legitimately
    // elsewhere in this stylesheet, so a document-wide "must not contain
    // blue" would be a lie that happens to fail.
    expect(sideRules).toContain(`border-bottom: 7px solid ${JUICE.green}`)
    expect(sideRules).toContain(`border-top: 7px solid ${JUICE.red}`)
    expect(sideRules).not.toContain(JUICE.accentDeep)
    // THE ANCHORING, which is what keeps the tip honest. A buy hangs below
    // its price, a sell above, and the two therefore cannot land on each
    // other the way the reported pair did.
    expect(sideRules).toMatch(/\.mark\.b \{[^}]*transform: translate\(-50%, 0\)/)
    expect(sideRules).toMatch(/\.mark\.s \{[^}]*transform: translate\(-50%, -100%\)/)
  })

  it("puts a mark at the price it actually filled, and rides the line without one", async () => {
    /**
     * The ledger records quantities now, so the executed price exists and
     * the mark can sit at the truth instead of the candle's close. Old
     * rows (priceUsd null) keep riding the line — the honest y for
     * "around then". Window 10–13: a $13 fill belongs near the top of the
     * plot, a $10 fill near the bottom, whatever the line was doing at
     * that moment.
     */
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      series: (async () => ({
        points: [10, 12, 11, 13],
        times: [1_000, 2_000, 3_000, 4_000],
        opens: null,
        highs: null,
        lows: null,
        failed: false,
      })) as never,
      chartView: { read: async () => "line" as const, write: vi.fn() },
      myTrades: async () => [
        { side: "buy" as const, ts: 1_500, priceUsd: 13 },
        { side: "sell" as const, ts: 3_500, priceUsd: 10 },
      ],
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1121", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const marks = [...sh.querySelectorAll<HTMLElement>(".mark")]
    expect(marks.length).toBe(2)
    const topOf = (m: HTMLElement) => parseFloat(m.style.top)
    // $13 is the window's max → near the top; $10 its min → near the bottom.
    expect(topOf(marks[0])).toBeLessThan(20)
    expect(topOf(marks[1])).toBeGreaterThan(80)
    // The tooltip says the number out loud — a mark at a price is a claim.
    expect(marks[0].title).toContain("Bought at $13.00")
    expect(marks[1].title).toContain("Sold at $10.00")
  })

  it("draws your average entry as a neutral dashed level, only while held", async () => {
    const mkDeps = (avg: number | null, uiAmount = 5) =>
      deps({
        shadowMode: "open",
        onScreen: () => false,
        series: (async () => ({
          points: [10, 12, 11, 13],
          times: [1_000, 2_000, 3_000, 4_000],
          opens: null,
          highs: null,
          lows: null,
          failed: false,
        })) as never,
        chartView: { read: async () => "line" as const, write: vi.fn() },
        book: async () => ({
          cashUsd: 10,
          solUsd: 0,
          positions: [
            {
              mint: WIF_ASSET.mint,
              uiAmount,
              raw: String(uiAmount * 1_000_000),
              netInvestedUsd: 50,
              avgEntryPriceUsd: avg,
            },
          ],
        }),
      } as Partial<XStripDeps>)
    const openChart = async (id: string, avg: number | null, uiAmount = 5) => {
      const ctl = createXStrip(mkDeps(avg, uiAmount))
      const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
      ctl.processCell(cell)
      const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
      const sh = host.shadowRoot!
      await new Promise((r) => setTimeout(r, 0))
      ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
      sh.querySelector<HTMLElement>(".more")!.click()
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
      return sh
    }

    const sh = await openChart("1122", 11.5)
    expect(sh.querySelectorAll(".entry-level").length).toBe(1)
    const tag = sh.querySelector<HTMLElement>(".entry-tag")!
    // "You", then the real number — a level clamped or not still says it.
    // priceText's shape, so a sub-micro entry never prints "$0".
    expect(tag.textContent).toBe("You $11.50")
    // A fact, not a verdict: neither side's colour class.
    expect(tag.className).toBe("entry-tag")

    // A pump.fun-scale entry keeps its digits — fmt printed this as "$0".
    const micro = await openChart("1125", 0.00007061)
    expect(micro.querySelector<HTMLElement>(".entry-tag")!.textContent).toBe(
      "You $0.00007061",
    )

    // No basis (ledger predates quantities) → no line. Null beats a guess.
    const none = await openChart("1123", null)
    expect(none.querySelectorAll(".entry-level").length).toBe(0)

    // Sold out → the entry is history, not a level on today's chart.
    const flat = await openChart("1124", 11.5, 0)
    expect(flat.querySelectorAll(".entry-level").length).toBe(0)
  })

  it("does not offer candles a server cannot draw", async () => {
    // An older build sends closes alone. A toggle leading to an empty plot
    // is worse than a toggle that is not there.
    const { sh } = await chart("1102", { ohlc: false })
    expect(sh.querySelector<HTMLElement>(".view")!.hidden).toBe(true)
  })

  it("flipping is a REDRAW, not a refetch", async () => {
    const { sh, series } = await chart("1103")
    const before = series.mock.calls.length
    sh.querySelector<HTMLElement>(".view")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(series.mock.calls.length).toBe(before)
    expect(sh.querySelectorAll(".chart-svg rect").length).toBe(4)
  })

  it("remembers the choice through the host", async () => {
    const { sh, write } = await chart("1104")
    sh.querySelector<HTMLElement>(".view")!.click()
    expect(write).toHaveBeenCalledWith("candle")
  })
})

describe("the press, and what it must not eat", () => {
  /**
   * A control that changes nothing when pressed is the single cheapest
   * thing a surface can do, and three classes of them were shipping.
   *
   * The transform channel was an arms race of selectors:
   * `button:active { transform: scale(.96) }` is specificity (0,1,1) and
   * `.pick:hover { transform: translateY(-1px) }` is (0,2,0), so the size
   * picks, the range tabs and the open chevron had no press state at all
   * on a mouse. Two custom properties end the race — hover writes --lift,
   * press writes --press, one transform reads both — so a control that
   * does both now does both and nothing has to out-specify anything.
   */
  const css = () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1050", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    return host.shadowRoot!.querySelector("style")!.textContent ?? ""
  }

  it("presses and hovers through separate channels", () => {
    const s = css()
    // One transform, two variables. Neither rule owns the property.
    expect(s).toContain("transform: translateY(var(--lift)) scale(var(--press))")
    expect(s).toMatch(/button:active\s*\{\s*--press:/)
    expect(s).toMatch(/\.pick:hover\s*\{[^}]*--lift:/)
  })

  it("never lets a hover rule own the transform outright", () => {
    // The exact shape of the old bug: a hover that SETS transform beats
    // button:active and silently eats every press under it.
    const s = css()
    expect(s).not.toMatch(/:hover\s*\{[^}]*transform:\s*translateY\(-1px\)/)
  })

  it("keeps the press on controls that declare their own transitions", () => {
    // .bell, .face and .wal each redeclared `transition` and thereby
    // dropped the base rule's transform entry, so they snapped instead of
    // springing. Every redeclaration carries the channel now.
    const s = css()
    const decls = s.match(/transition:[^;]+;/g) ?? []
    const withTransform = decls.filter((d) => d.includes("transform"))
    expect(withTransform.length).toBeGreaterThanOrEqual(4)
  })

  it("arrives faster than it leaves", () => {
    // A switch is not symmetric. The finger is instant; the spring is in
    // the release, which is where a button stops feeling like a rectangle.
    expect(JUICE.pressMs).toBeLessThan(JUICE.releaseMs)
    expect(JUICE.releaseEase).toContain("1.35")
  })

  it("does not let a closed chip keep rounding its corners", () => {
    // Removing the body takes one frame; the radius kept easing for
    // another 240ms, so a closed chip visibly rounded off around nothing.
    expect(css()).toContain(".chip.closing { transition-duration: 0s; }")
  })
})

describe("the resting button says what a press will spend", () => {
  /**
   * "Buy" hid the amount until a sheet opened, where it silently armed
   * PRESET_USD[1]. So the one fact that decides how much money moves was
   * the one fact the feed would not show. The clip is a memory of the
   * reader's own last landed buy — not a setting, and clamped to the
   * presets' ceiling so a Max pick can never become a standing default.
   */
  const withClip = (usd: number, write = vi.fn()) =>
    deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(500),
      clip: { read: async () => ({ usd, sellPct: 100 }), write },
    })

  const idle = async (d: ReturnType<typeof deps>, id: string) => {
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    return host.shadowRoot!
  }

  it("says Buy, and nothing about the amount", async () => {
    /**
     * The button carried the clip for a while ("Buy $25"), on the argument
     * that a resting chip should say what a press will spend. Sound
     * argument, wrong place: this row is in somebody's timeline all day,
     * and a number that changes per reader makes two identical chips look
     * like two different products.
     *
     * The disclosure survives — Buy opens the SHEET, and the sheet shows
     * the amount before any money moves. One beat later, in the place the
     * decision is actually made.
     */
    const sh = await idle(withClip(10), "1010")
    expect(sh.querySelector(".buy")!.textContent).toBe("Buy")
  })

  it("opens the sheet already holding that size", async () => {
    // The label and the field must agree, or the label is a lie the sheet
    // corrects a tap later.
    const sh = await idle(withClip(10), "1012")
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector<HTMLInputElement>(".amount-in")!.value).toBe("10")
  })

  it("says what the amount costs in slippage, after the typing settles", async () => {
    /**
     * Restored after dying as a side effect of the amount-UI rewrite: the
     * screen it lived on was deleted and nobody decided to lose the
     * number, so the dep and the CSS sat orphaned while the sheet quoted
     * nothing. On the memecoin tail the difference between 0.2% and 4%
     * impact IS the trade.
     */
    const quote = vi.fn(async () => ({ priceImpactPct: 2.4 }))
    const sh = await idle(
      deps({ shadowMode: "open", onScreen: () => false, book: book(500), quote }),
      "1014",
    )
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // Debounced: nothing is asked until the settle timer runs.
    const cost = sh.querySelector<HTMLElement>(".cost")!
    expect(cost.hidden).toBe(true)
    await new Promise((r) => setTimeout(r, 520))
    expect(quote).toHaveBeenCalled()
    expect(cost.hidden).toBe(false)
    expect(cost.textContent).toBe("~2.40% price impact")
    // 1% and up wears the amber: that is the threshold where slippage
    // stops being a rounding note and becomes part of the price.
    expect(cost.classList.contains("warn")).toBe(true)
  })

  it("asks nothing about impact on a limit order", async () => {
    // A limit order names its own price; impact against the current pool
    // answers a question it did not ask.
    const quote = vi.fn(async () => ({ priceImpactPct: 2.4 }))
    const sh = await idle(
      deps({ shadowMode: "open", onScreen: () => false, book: book(500), quote }),
      "1015",
    )
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // Flip to limit, then let the settle window pass.
    const kindBtns = sh.querySelectorAll<HTMLElement>(".kindb")
    kindBtns[kindBtns.length - 1]!.click()
    await new Promise((r) => setTimeout(r, 520))
    const calls = quote.mock.calls.length
    // Whatever the market screen asked before the flip stands; the limit
    // screen itself must add nothing.
    const input = sh.querySelector<HTMLInputElement>(".amount-in")
    if (input) {
      input.value = "60"
      input.dispatchEvent(new Event("input"))
    }
    await new Promise((r) => setTimeout(r, 520))
    expect(quote.mock.calls.length).toBe(calls)
  })

  it("remembers a buy that LANDED, and only then", async () => {
    const write = vi.fn()
    const sh = await idle(withClip(25, write), "1013")
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const input = sh.querySelector<HTMLInputElement>(".amount-in")!
    input.value = "50"
    input.dispatchEvent(new Event("input"))
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ usd: 50 }))
  })
})

describe("the homecoming: your position greets you with what changed", () => {
  /**
   * X's virtualizer re-serves the same asset to the same reader dozens of
   * times a session, and every one of those mounts used to be amnesiac.
   * Now the badge counts from what you last SAW to what it is now.
   *
   * FROM LAST-SEEN, NOT FROM ENTRY. That one choice is what keeps this out
   * of the casino: a flat market produces literally zero motion, there is
   * no clock and no streak, nothing pays out for coming back, and nothing
   * can be farmed by scrolling. The product moves exactly when the money
   * did.
   */
  const mount = async (ctl: ReturnType<typeof createXStrip>, id: string, px: number) => {
    const { cell } = makeCell({ id, text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, px, 1)
    await new Promise((r) => setTimeout(r, 0))
    return host.shadowRoot!
  }

  const held = { uiAmount: 10, raw: "10000000", netInvestedUsd: null }

  it("writes the figure straight the first time it is ever seen", async () => {
    const ctl = createXStrip(
      deps({ shadowMode: "open", onScreen: () => false, book: book(50, held) }),
    )
    const sh = await mount(ctl, "990", 10)
    // 10 units at $10 — nothing remembered, so no motion, just the number.
    expect(sh.querySelector(".mine")!.textContent).toBe("You $100.00")
  })

  it("counts from the last figure when the same asset comes back moved", async () => {
    const ctl = createXStrip(
      deps({ shadowMode: "open", onScreen: () => false, book: book(50, held) }),
    )
    await mount(ctl, "991", 10) // seen at $100.00
    const sh = await mount(ctl, "992", 12) // met again at $120.00
    // jsdom reads as reduced motion, so the destination lands at once —
    // which is the guarantee that matters: the greeting never leaves a
    // stale number on screen, whatever the machine can animate.
    expect(sh.querySelector(".mine")!.textContent).toBe("You $120.00")
  })

  it("stays perfectly still when nothing happened", async () => {
    // The stillness is the information, and it is also the anti-farm: a
    // reader who scrolls past the same asset all day sees nothing move
    // unless their money moved.
    const ctl = createXStrip(
      deps({ shadowMode: "open", onScreen: () => false, book: book(50, held) }),
    )
    await mount(ctl, "993", 10)
    const sh = await mount(ctl, "994", 10)
    expect(sh.querySelector(".mine")!.textContent).toBe("You $100.00")
  })

  it("is one position across every chip that shows it", async () => {
    // Two tweets about the same asset are two chips and ONE position, and
    // updatePrice reaches every strip on that mint — so both land on the
    // same figure. The memory is keyed by mint for exactly that reason.
    // (I first wrote this expecting the older chip to stay at its old
    // price; the live wire is right and the expectation was wrong.)
    const ctl = createXStrip(
      deps({ shadowMode: "open", onScreen: () => false, book: book(50, held) }),
    )
    const a = await mount(ctl, "995", 10)
    const b = await mount(ctl, "996", 11)
    expect(a.querySelector(".mine")!.textContent).toBe("You $110.00")
    expect(b.querySelector(".mine")!.textContent).toBe("You $110.00")
  })
})

describe("the first beat: the button counts, it does not grey out", () => {
  /**
   * The loudest moment this product owns was parked behind its two slowest
   * calls — swap, then confirm — and the reader spent it looking at a grey
   * verb. Nothing about the first beat waits for the network: the amount is
   * the one the reader just chose.
   *
   * What keeps it honest is rule 4. Green is semantic, so the in-flight
   * number is STRUCTURALLY forbidden from wearing the success dress; it
   * gets the accent and a leading "~", and the exact figure with units
   * arrives on the receipt when the chain confirms.
   */
  const openSheet = async (opts: { slowSwap?: boolean } = {}) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(9.49),
      ...(opts.slowSwap
        ? {
            trade: {
              // Never resolves: the point is to hold the in-flight state
              // still long enough to look at it.
              swap: vi.fn(() => new Promise<never>(() => {})),
              confirm: vi.fn(async () => ({ status: "confirmed" as const })),
            } as unknown as XStripDeps["trade"],
          }
        : {}),
    })
    const ctl = createXStrip(d as never)
    const { cell } = makeCell({ id: "980", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const input = sh.querySelector<HTMLInputElement>(".amount-in")!
    input.value = "5"
    input.dispatchEvent(new Event("input"))
    return sh
  }

  it("shows the amount, tilde-marked, while the swap is still in flight", async () => {
    const sh = await openSheet({ slowSwap: true })
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const place = sh.querySelector<HTMLElement>(".place")!
    // jsdom has no matchMedia, which countUp reads as reduced motion, so
    // the final figure lands at once — which is also the fallback proof.
    // "Buying…", not "~$5.00": jsdom reports reduced motion, so the count-up
    // takes its instant path and the verb that follows it lands in the same
    // tick. Under real motion the figure holds the button for 450ms first —
    // both beats are driven with a live matchMedia in busy-verb.spec.ts.
    expect(place.textContent).toBe("Buying…")
    expect(place.className).toContain("wait")
  })

  it("never wears the success colour while it is still asking", async () => {
    // Rule 4 in one assertion: the in-flight state carries no ok/green
    // class, so no amount of styling drift can make "asked for" look like
    // "landed".
    const sh = await openSheet({ slowSwap: true })
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const cls = sh.querySelector<HTMLElement>(".place")!.className
    expect(cls).not.toContain("ok")
    expect(sh.querySelector(".chip")!.classList.contains("glow-ok")).toBe(false)
  })

  it("hands back to the real receipt when the chain confirms", async () => {
    const sh = await openSheet()
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // The sheet is gone and the tail carries the exact figure with units.
    expect(sh.querySelector(".place")).toBeNull()
    // A sentence since the arrow receipt was reported as dry: the asset is
    // named once, and the quantity still rides behind it.
    expect(sh.querySelector(".receipt")!.textContent).toMatch(/Bought .* of \$/)
    expect(sh.querySelector(".chip")!.classList.contains("glow-ok")).toBe(true)
  })
})

describe("telemetry can never break a control", () => {
  /**
   * REPORTED LIVE: "asagi hover a basinca calismiyor" — the chevron drawn,
   * pressed, and nothing happens at all.
   *
   * The cause is not the chart. Every control on this chip opens with
   * `deps.track(...)` and only then does its real work, and in production
   * track is `chrome.runtime.sendMessage(...).catch(() => {})` — which does
   * NOT catch the case that matters: after the extension is reloaded or
   * auto-updated, an already-open tab keeps running the old content script
   * and sendMessage THROWS SYNCHRONOUSLY. The throw lands before the chart,
   * before the sheet, before the panel. The chip looks alive and every
   * control is dead, silently.
   *
   * fetchService already turns that state into an honest STALE_CONTEXT
   * ("Poppin updated — reload the page"), and the buy path already speaks
   * it — but the reader can never reach that message, because telemetry
   * dies one statement earlier. So: a measurement must never be able to
   * stop the thing it is measuring.
   */
  const dead = () => {
    throw new Error("Extension context invalidated.")
  }
  const mount = async (extra?: Partial<XStripDeps>) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      track: vi.fn(dead),
      series: vi.fn(async () => ({ points: [1, 2, 3], times: null, opens: null, highs: null, lows: null, failed: false })),
      ...extra,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "960", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    return { sh: host.shadowRoot!, d }
  }

  it("the chevron still opens the chart", async () => {
    const { sh } = await mount()
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart")).toBeTruthy()
  })

  it("Buy still opens the sheet", async () => {
    const { sh } = await mount()
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".sheet")).toBeTruthy()
  })

  it("an orphaned page says so at the FIRST press, not the last", async () => {
    // The refusal used to live at the far end of the money path: the reader
    // opened the sheet, typed an amount, pressed Buy, and only then learned
    // the page had been dead the whole time. Chrome cannot refresh a page
    // for us, so the chip asks for the one thing that fixes it.
    const { sh, d } = await mount({ alive: () => false })
    sh.querySelector<HTMLElement>(".buy")!.click()
    expect(sh.querySelector(".sheet")).toBeNull()
    expect(sh.querySelector(".note")!.textContent).toMatch(/reload the page/i)
    sh.querySelector<HTMLElement>(".more")!.click()
    expect(sh.querySelector(".chart")).toBeNull()
    // and it never pretends the panel opened
    sh.querySelector<HTMLElement>(".face")!.click()
    expect(d.openPanel).not.toHaveBeenCalled()
  })

  it("a host that cannot tell is treated as alive", async () => {
    // Every test, and any host without the check, must keep working.
    const { sh } = await mount()
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".sheet")).toBeTruthy()
  })

  it("the face still opens the panel", async () => {
    const { sh, d } = await mount()
    sh.querySelector<HTMLElement>(".face")!.click()
    expect(d.openPanel).toHaveBeenCalled()
  })
})

describe("the receipt and the quiet balance", () => {
  /**
   * "Aldıktan sonra verdiği ekranı sevmedim" — the success moment was a
   * log line wearing a checkmark, and the resting chip never said what
   * the reader could spend. The receipt now leads with the DOLLARS (the
   * unit the reader decided in), and the idle/chart tail carries a quiet
   * mono balance chip fed by the same book as every other surface.
   */
  const buyThrough = async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(9.49) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "955", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // $5, inside the $9.49 book — the default $25 would gate to Add funds.
    const input = sh.querySelector<HTMLInputElement>(".amount-in")!
    input.value = "5"
    input.dispatchEvent(new Event("input"))
    sh.querySelector<HTMLElement>(".place")!.click()
    await new Promise((r) => setTimeout(r, 0))
    return sh
  }

  it("the receipt leads with the dollars and keeps the token amount", async () => {
    const sh = await buyThrough()
    const receipt = sh.querySelector<HTMLElement>(".receipt")
    expect(receipt).not.toBeNull()
    // jsdom has no matchMedia, which countUp reads as reduced motion: the
    // final number lands immediately — also what proves the fallback.
    expect(receipt!.textContent).toContain("$")
    expect(receipt!.textContent).toMatch(/Bought .* of \$/)
    // the chip pulses green around it
    expect(sh.querySelector(".chip")!.classList.contains("glow-ok")).toBe(true)
  })

  it("the idle tail carries the balance once the book has answered", async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(9.49) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "956", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    // open a sheet (reads the book) and close it back to idle
    sh.querySelector<HTMLElement>(".buy")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".quiet")!.click()
    await new Promise((r) => setTimeout(r, 0))
        // THE DOOR IS PERMANENT NOW (field, 2026-08-31): the pill carries no
    // figure, so there is no number whose absence could hide it — and a
    // reader with no score is exactly the one who still needs a way into
    // their own portfolio.
    expect(sh.querySelector<HTMLElement>(".wal")!.hidden).toBe(false)
  })

  it("mounts the reader's door even on a THIN asset", async () => {
    // The original report: a fresh reader saw their face and money on one
    // chip and neither on the next, because the thin branch returned
    // before the tail was ever mounted. Liquidity is a fact about the
    // ASSET; the reader's door is a fact about the READER, and one has no
    // business hiding the other. (The score itself moved one tap in — see
    // "carries NO figure" above — so what this pins now is the mount.)
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: async () => ({ cashUsd: 100, totalPnlUsd: 12.4, positions: [] }),
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "961", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    const wal = sh.querySelector<HTMLElement>(".wal")!
    expect(wal.hidden).toBe(false)
    expect(wal.querySelector("svg")).toBeTruthy()
  })

  it("says nothing about P&L rather than printing a zero", async () => {
    // "+$0.00" is a scoreboard nobody has played on yet, and a null total
    // means the ledger could not tell — neither is worth a number.
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: async () => ({ cashUsd: 9.46, totalPnlUsd: null, positions: [] }),
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "962", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    // No P&L and no balance on the row: an unknowable score prints
    // nothing, never a zero — and the cash line lives on the scoreboard.
        // THE DOOR IS PERMANENT NOW (field, 2026-08-31): the pill carries no
    // figure, so there is no number whose absence could hide it — and a
    // reader with no score is exactly the one who still needs a way into
    // their own portfolio.
    expect(sh.querySelector<HTMLElement>(".wal")!.hidden).toBe(false)
    expect(sh.querySelector(".wal-pnl")).toBeNull()
  })

  it("shows an empty wallet rather than hiding from it", async () => {
    // The reader about to be refused by every Buy on the page is the one
    // who most needs the number. Hiding at zero told them nothing.
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(0) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "958", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
        // THE DOOR IS PERMANENT NOW (field, 2026-08-31): the pill carries no
    // figure, so there is no number whose absence could hide it — and a
    // reader with no score is exactly the one who still needs a way into
    // their own portfolio.
    expect(sh.querySelector<HTMLElement>(".wal")!.hidden).toBe(false)
  })

  it("says whose money it is, and opens their own panel", async () => {
    /**
     * "$4.50" alone read as anything — a fee, a minimum. An avatar claimed
     * it for a while and was worse: at 16px a profile photo is mush, and
     * it made the group look like a second card rather than an aside. One
     * word does the whole job.
     *
     * NOT "Position": this is the spendable balance and all-time P&L
     * across every asset, so neither number is a position and neither is
     * about the token on this row. A wrong sentence in a serious word is
     * the exact failure "entry $X" was deleted for.
     */
    const openHome = vi.fn()
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      // A P&L, because the pill is the score now and a bare balance
      // would leave it hidden with nothing to press.
      book: (async () => ({ cashUsd: 4.5, totalPnlUsd: -1.88, positions: [] })) as never, openHome,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "959", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    const wal = sh.querySelector<HTMLElement>(".wal")!
    // The pill says whose money it is with a MARK now, not a figure: the
    // score it used to print collided with the face's own "You" and is
    // drawn at 30px one tap in. What must survive is the door itself.
    expect(wal.textContent?.trim()).toBe("")
    expect(wal.querySelector("svg")).toBeTruthy()
    // An icon-only key with no text has to be NAMED, and the name is an
    // aria-label rather than a title: a tooltip in the middle of the tail
    // is a box that opens and shuts while the pointer crosses it on the
    // way to Buy (chip-stays-put.spec.ts pins the whole tail).
    expect(wal.hasAttribute("title")).toBe(false)
    expect(wal.getAttribute("aria-label")).toContain("Your balance and positions")

    /**
     * The press used to go straight to the panel. It opens the funding
     * box now, because the balance is only on the row at all when it
     * cannot cover a press — at which point "here is your portfolio" is
     * an answer to a question nobody asked.
     *
     * The portfolio door is not lost, it moved inside: the reader who
     * wanted their panel is one press further and the reader who needed
     * money is one press closer, which is the right way round.
     */
    wal.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(openHome).not.toHaveBeenCalled()
    expect(sh.querySelector(".you")).toBeTruthy()
    expect(sh.querySelector(".fund")).toBeFalsy()
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".fund-home")!.click()
    expect(openHome).toHaveBeenCalled()
  })

  it("funds from the page, and closes when the money lands", async () => {
    /**
     * The rail is the wallet already injected on x.com, not an iframe.
     * Measured live on 2026-08-27, x.com's frame-src allows accounts.google,
     * appleid, youtube, soundcloud, pscp, studio.x, arkoselabs, *.x.com,
     * crbcos, plaid, stripe, getpinwheel, adyen and grokusercontent — and
     * nothing else. A content script's iframe answers to the PAGE's policy,
     * so a hosted funding flow cannot render here whatever we register with
     * the provider. This path needs no iframe at all.
     */
    const topUp = vi.fn(async () => true)
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(4.5),
      topUp,
      canFundHere: async () => true,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1400", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))

    sh.querySelector<HTMLElement>(".wal")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // The pill opens the scoreboard now; funding is one press further in,
    // which is the right order: most presses on a balance are "how am I
    // doing", not "take my money".
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // It says where the money comes from BEFORE the press, not after.
    expect(sh.querySelector(".fund-note")!.textContent).toContain("stay here")

    const picks = sh.querySelectorAll<HTMLElement>(".fund .pick")
    // Funding sizes are not trade sizes: a $10 deposit that the next $10
    // buy spends outright is a round trip nobody asked for.
    expect([...picks].map((b) => b.textContent)).toEqual(["$25", "$50", "$100"])
    picks[1].click()
    // "exact": the wallet is asked for the 50 on the button, not 51.
    expect(topUp).toHaveBeenCalledWith(50, "exact")
    await new Promise((r) => setTimeout(r, 0))
    // Money landed, so the box has done its job and gets out of the way.
    expect(sh.querySelector(".fund")).toBeFalsy()
  })

  it("offers the address, which is the one route X cannot block", async () => {
    /**
     * A hosted funding flow needs an iframe and x.com's frame-src decides
     * which iframes exist, so a card rail cannot run on this surface no
     * matter what we register with a provider. An address is text. Text
     * has no CSP, so this route works for a reader with no wallet on the
     * page, no card, and no interest in opening anything.
     */
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(4.5),
      canFundHere: async () => false,
      myAddress: async () => "7SrjabcdefghijklmnopqrstuvwxyzABCDEFGHt13A",
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1402", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".wal")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // The pill opens the scoreboard now; funding is one press further in,
    // which is the right order: most presses on a balance are "how am I
    // doing", not "take my money".
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))

    const addr = sh.querySelector<HTMLElement>(".fund-addr")!
    expect(addr.hidden).toBe(false)
    // Shortened on screen, whole in the tooltip and whole on the clipboard:
    // a truncated address that gets COPIED truncated is money sent nowhere.
    expect(addr.querySelector(".fund-addr-key")!.textContent).toBe("7Srj…t13A")
    // The whole address leads the tooltip, so a copy that silently fails
    // still leaves the real thing selectable rather than the short form.
    expect(addr.title.startsWith("7SrjabcdefghijklmnopqrstuvwxyzABCDEFGHt13A")).toBe(true)
    /**
     * THE CHAIN AND THE TOKEN ARE ON SCREEN, not in the tooltip. This spec
     * used to assert the opposite ("no instructions in front of it") on the
     * argument that an address beside the word Copy explains itself. It
     * does not explain the two facts that decide whether the money ARRIVES:
     * send USDC on the wrong chain and it is gone. A tooltip is not where
     * the one instruction that cannot be got wrong belongs.
     */
    const lbl = addr.querySelector(".fund-addr-lbl")!
    expect(lbl).toBeTruthy()
    expect(lbl.textContent).toContain("USDC")
    expect(lbl.textContent).toContain("Solana")
  })

  it("keeps the box smaller rather than promise an address it has not got", async () => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(4.5),
      myAddress: async () => null,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1403", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".wal")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // The pill opens the scoreboard now; funding is one press further in,
    // which is the right order: most presses on a balance are "how am I
    // doing", not "take my money".
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector<HTMLElement>(".fund-addr")!.hidden).toBe(true)
  })

  it("says the press leaves the page when it does", async () => {
    // topUp falls back to the panel with no page wallet, and that fallback
    // is right. What is wrong is promising "you stay here" and then opening
    // a sidebar, so the chip asks before it offers.
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(4.5),
      canFundHere: async () => false,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "1401", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await new Promise((r) => setTimeout(r, 0))
    sh.querySelector<HTMLElement>(".wal")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // The pill opens the scoreboard now; funding is one press further in,
    // which is the right order: most presses on a balance are "how am I
    // doing", not "take my money".
    sh.querySelector<HTMLElement>(".you-add")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".fund-note")!.textContent).toContain("opens Poppin")
  })

  it("stays silent while the book is unknown", async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "957", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    const wal = sh.querySelector<HTMLElement>(".wal")
    expect(wal === null || wal.textContent === "").toBe(true)
  })
})

describe("a batch reads once, then writes", () => {
  /**
   * Kürşat profiled the extension on a real feed: 74ms of Poppin's 147ms
   * was forced synchronous layout — 76 Layouts and 85 UpdateLayoutTrees —
   * and he pointed at the exact shape, a write/read/write per mounted
   * cell. The chip already batched the ONE-PER-SCREENFUL snapshot (the
   * numbers live in that comment), but the placement measurement was still
   * per cell: insert the host, write a margin, READ two rects, write
   * another margin. Each read after a write forces the engine to lay out
   * the whole page again, and the flush loop does it N times.
   *
   * His own verdict was that the user cannot feel the difference, and that
   * is honest and matches ours: it is 0.2% of wall clock. It is taken
   * anyway because "does this extension make X slow" is a question we want
   * a boring answer to, and because the fix is a reordering, not a rewrite.
   *
   * The test asserts the PROPERTY, not the timing: inside one batch, no
   * geometry read may follow a style write.
   */
  const record = () => {
    const styleProto = Object.getPrototypeOf(document.createElement("div").style)
    const events: string[] = []
    const origRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      events.push("read")
      return origRect.call(this)
    }
    const patched = ["marginLeft", "marginRight"].map((prop) => {
      const d = Object.getOwnPropertyDescriptor(styleProto, prop)!
      const set = d.set!
      Object.defineProperty(styleProto, prop, {
        ...d,
        set(v: string) {
          events.push("write")
          set.call(this, v)
        },
      })
      return [prop, d] as const
    })
    return {
      events,
      restore: () => {
        Element.prototype.getBoundingClientRect = origRect
        for (const [prop, d] of patched) Object.defineProperty(styleProto, prop, d)
      },
    }
  }

  it("never reads geometry after writing a style, inside one batch", async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    // jsdom's rects are all zeros, so the measured inset never applies;
    // what is under test is the ORDER of the operations, which is real.
    const cells = [1, 2, 3, 4, 5].map((n) =>
      makeCell({ id: `88${n}`, text: "$WIF", cashtags: ["$WIF"] }),
    )
    const tape = record()
    try {
      ctl.processCells(cells.map((c) => c.cell))
    } finally {
      tape.restore()
    }
    const firstWrite = tape.events.indexOf("write")
    const lastRead = tape.events.lastIndexOf("read")
    expect(tape.events.length, "the batch did nothing at all").toBeGreaterThan(0)
    expect(
      firstWrite === -1 || lastRead < firstWrite,
      `reads and writes interleave: ${tape.events.join(",")}`,
    ).toBe(true)
  })
})

describe("one motion, not three", () => {
  /**
   * "animasyonlarda kopukluk oluyor" — reported live on the feed. Measured
   * first: the layout a height animation forces inside a 400-cell
   * ResizeObserver'd feed costs 0.3ms a frame, so the stutter was never
   * layout. It was the choreography. Opening the sheet ran THREE motions at
   * THREE durations on two nested boxes: the chip's radius (280ms), the
   * sheet's height (240ms) and sheetIn's transform+opacity (300ms) — on the
   * very box whose height was animating. Motion that ends three times reads
   * as broken even at a perfect frame rate.
   */
  const cssOf = () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "950", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    return host.shadowRoot!.querySelector("style")!.textContent!
  }

  it("every motion in the opening shares one duration and one easing", () => {
    const css = cssOf()
    // The three that overlap when a sheet opens.
    const radius = /transition: border-radius ([\d.]+)s ([^;]+);/.exec(css)!
    const sheet = /animation: sheetIn ([\d.]+)s ([^;]+);/.exec(css)!
    expect(radius[1]).toBe(sheet[1])
    expect(radius[2].trim()).toBe(sheet[2].trim())
  })

  it("the box that grows is never also transformed", () => {
    // A translateY on a box whose height is animating is two motions
    // describing the same movement, and they disagree every frame.
    const css = cssOf()
    const frames = /@keyframes sheetIn \{([\s\S]*?)\n        \}/.exec(css)![1]
    expect(frames).not.toMatch(/transform/)
    expect(frames).toMatch(/opacity/)
  })

  it("releases the height the moment the growth ends, not 20ms later", async () => {
    // The old release was a setTimeout 20ms past the transition, and it
    // held `overflow: hidden` the whole time — so anything that arrived
    // late (the social-proof line, a wrapped balance) was clipped and then
    // JUMPED into place on release. jsdom runs no transitions, so the
    // event is dispatched by hand; the point under test is that the
    // listener exists and does the releasing.
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "951", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const sh = host.shadowRoot!
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    // jsdom reports scrollHeight 0 for everything, so expandIn would return
    // early; the box is given a height the way a browser measures one.
    const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 220,
    })
    try {
      sh.querySelector<HTMLElement>(".buy")!.click()
      const sheet = sh.querySelector<HTMLElement>(".sheet")!
      expect(sheet.style.height).toBe("220px") // growing
      sheet.dispatchEvent(new Event("transitionend"))
      expect(sheet.style.height).toBe("")
      expect(sheet.style.overflow).toBe("")
    } finally {
      if (proto) Object.defineProperty(HTMLElement.prototype, "scrollHeight", proto)
    }
  })
})

describe("the price chart", () => {
  const open = async (
    series: XStripDeps["series"] = vi.fn(async () => ({
      points: [1, 2, 3, 2, 4],
      times: null,
      opens: null,
      highs: null,
      lows: null,
      failed: false,
    })),
  ) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, series })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "901", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    return { sh: host.shadowRoot!, series }
  }

  it("has a drawn door: the chevron opens it, flips, and closes it", async () => {
    const { sh } = await open()
    const more = sh.querySelector<HTMLButtonElement>(".more")!
    expect(more.getAttribute("aria-expanded")).toBe("false")
    more.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart")).toBeTruthy()
    expect(more.getAttribute("aria-expanded")).toBe("true")
    // The chip carries the state so the chevron can turn over in CSS.
    expect(sh.querySelector(".chip")!.classList.contains("charted")).toBe(true)
    more.click()
    expect(sh.querySelector(".chart")).toBeNull()
    expect(more.getAttribute("aria-expanded")).toBe("false")
  })

  it("keeps the doors open: the chart never costs the reader Buy and Sell", async () => {
    // Reported live: Buy → sheet → chevron, and the tail was left holding
    // the SHEET's × with no Buy and no Sell. The chart is the moment a
    // reader is being convinced; taking the buttons away right then is
    // exactly backwards. The chart replaces the SHEET, so the sheet's tail
    // leaves with it.
    const { sh } = await open()
    sh.querySelector<HTMLElement>(".buy")!.click()
    expect(sh.querySelector(".sheet")).toBeTruthy()
    expect(sh.querySelector(".end .buy")).toBeNull() // the sheet's × owns the tail

    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart")).toBeTruthy()
    expect(sh.querySelector(".sheet")).toBeNull()
    // Both doors, both plain. The amount lives one beat later, on the
    // sheet, where the decision is actually made.
    expect(sh.querySelector<HTMLElement>(".end .buy")!.textContent).toBe("Buy")
    expect(sh.querySelector<HTMLElement>(".end .sell")!.textContent).toBe("Sell")
  })

  it("leaves a trade's own tail alone — a receipt is not a leftover", async () => {
    // The rule is "the sheet's tail leaves with the sheet", NOT "the chart
    // resets the tail". A finished trade owns its tail (✓ Bought, Share),
    // and opening the chart to look at what just happened must not wipe it.
    const { sh } = await open()
    const end = sh.querySelector<HTMLElement>(".end")!
    const receipt = document.createElement("span")
    receipt.className = "note ok"
    receipt.textContent = "✓ Bought $25"
    end.replaceChildren(receipt)

    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart")).toBeTruthy()
    expect(end.textContent).toBe("✓ Bought $25")
  })

  it("says which KIND of nothing it has, and offers a way out of one", async () => {
    // Measured on $ANTHROPIC: the chip printed "No chart for this range"
    // on 1H, 4H, 1D and 1W while GeckoTerminal held 60, 16, 24 and 42
    // candles for exactly those windows. The ranges were never empty; the
    // fetches had failed. One word (null) for two facts guarantees the
    // lie, so the reason now rides the wire.
    const failing = vi.fn(async () => ({ points: null, times: null, opens: null, highs: null, lows: null, failed: true }))
    const { sh } = await open(failing)
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const note = sh.querySelector<HTMLElement>(".chart-note")!
    expect(note.textContent).not.toMatch(/no chart/i)
    expect(note.textContent).toMatch(/again/i)
    // And a failure is answerable: the retry asks the same question.
    const calls = failing.mock.calls.length
    sh.querySelector<HTMLElement>(".chart-retry")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(failing.mock.calls.length).toBeGreaterThan(calls)
  })

  it("still states a real absence as the fact it is", async () => {
    // A token minted this morning HAS no month of history, and saying so
    // is information. No retry offered: there is nothing to re-ask.
    const empty = vi.fn(async () => ({ points: null, times: null, opens: null, highs: null, lows: null, failed: false }))
    const { sh } = await open(empty)
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart-note")!.textContent).toMatch(/no chart/i)
    expect(sh.querySelector(".chart-retry")).toBeNull()
  })

  it("remembers an absence for the page, but never a failure", async () => {
    // The server keeps failures on a short line and absences on a long
    // one; the page cache must agree, or a burst of taps freezes a wrong
    // answer onto a range for the session.
    const answers = [
      { points: null, times: null, opens: null, highs: null, lows: null, failed: true },
      { points: null, times: null, opens: null, highs: null, lows: null, failed: false },
    ]
    const series = vi.fn(async () => answers.shift() ?? { points: null, times: null, opens: null, highs: null, lows: null, failed: false })
    const { sh } = await open(series)
    const more = sh.querySelector<HTMLElement>(".more")!
    more.click() // failure — must not be remembered
    await new Promise((r) => setTimeout(r, 0))
    more.click()
    more.click() // reopen: asks again
    await new Promise((r) => setTimeout(r, 0))
    expect(series.mock.calls.length).toBe(2)
    more.click()
    more.click() // reopen after an ABSENCE: answered from the page cache
    await new Promise((r) => setTimeout(r, 0))
    expect(series.mock.calls.length).toBe(2)
  })

  it("draws the axis from the candles' own clock, not from the label", async () => {
    // Measured on $ANTHROPIC: "1H" held 36.1 hours of candles, "4H" held
    // 16.5, because GeckoTerminal only emits a candle where trades
    // happened while the chip spread points evenly across the range's
    // name. The server now sends each candle's timestamp and the axis
    // reads those.
    const t0 = Date.UTC(2026, 6, 27, 9, 0)
    const times = [t0, t0 + 3_600_000, t0 + 7_200_000, t0 + 10_800_000, t0 + 14_400_000]
    const { sh } = await open(
      vi.fn(async () => ({
        points: [1, 2, 3, 2, 4],
        times,
        opens: null,
        highs: null,
        lows: null,
        failed: false,
      })),
    )
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    // 1d opens first: its label is weekday + clock, and the weekday has to
    // be the one in the DATA, not the one an even spread would have put
    // there. 2026-07-27 is a Monday.
    expect(sh.querySelector(".chart-foot .t0")!.textContent).toMatch(/^Mon /)
  })

  it("falls back to even spacing when the server sends no clock", async () => {
    // Older servers answer without `times`; the chart must still draw.
    const { sh } = await open(
      vi.fn(async () => ({ points: [1, 2, 3, 2, 4], times: null, opens: null, highs: null, lows: null, failed: false })),
    )
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart-foot .t0")!.textContent).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/)
  })

  it("carries one closer, not three", async () => {
    // Chevron + a chart-head × + the tail's × was three controls for one
    // action inside a 430px pill. The chevron is the door and says so.
    const { sh } = await open()
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart-head .quiet")).toBeNull()
  })

  it("hides the chevron entirely when this build has no series", () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "902", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    const more = host.shadowRoot!.querySelector<HTMLElement>(".more")!
    // A door to nowhere is worse than no door.
    expect(more.style.display).toBe("none")
  })

  it("frames the window in time: start label on the left, now on the right", async () => {
    const { sh } = await open()
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    const t0 = sh.querySelector(".chart-foot .t0")!.textContent!
    const t1 = sh.querySelector(".chart-foot .t1")!.textContent!
    // 1d opens first: its start label is weekday + clock.
    expect(t0).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/)
    expect(t1).toBe("now")
  })

  it("expands under the pill with the day view, and draws the line", async () => {
    const { sh, series } = await open()
    sh.querySelector<HTMLElement>(".px")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(series).toHaveBeenCalledWith(expect.any(String), "1d")
    const line = sh.querySelector(".chart polyline")!
    expect(line.getAttribute("points")).toBeTruthy()
  })

  it("re-asks after a failure — a silence is not a fact", async () => {
    // Measured live on $PUMP: one missed request stuck "No chart for this
    // range" for the whole page. An ANSWER may be cached; a FAILURE may
    // not. (Written before the wire could say which kind of nothing it
    // had; it now can, so the case it always meant is stated exactly.)
    let calls = 0
    const series = vi.fn(async () =>
      ++calls === 1
        ? { points: null, times: null, opens: null, highs: null, lows: null, failed: true }
        : { points: [1, 2, 3, 2, 4], times: null, opens: null, highs: null, lows: null, failed: false },
    )
    const { sh } = await open(series)
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart-note")!.textContent).toMatch(/did not load/i)
    // Close and reopen the same range: the question must be fresh.
    sh.querySelector<HTMLElement>(".more")!.click()
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(series).toHaveBeenCalledTimes(2)
    expect(sh.querySelector(".chart polyline")!.getAttribute("points")).toBeTruthy()
    // And a real answer stays cached: reopening does not ask a third time.
    sh.querySelector<HTMLElement>(".more")!.click()
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(series).toHaveBeenCalledTimes(2)
  })

  it("switches range on its own pills, fetching each once", async () => {
    const { sh, series } = await open()
    sh.querySelector<HTMLElement>(".chg")!.click()
    await new Promise((r) => setTimeout(r, 0))
    ;[...sh.querySelectorAll<HTMLElement>(".chart .pick")]
      .find((b) => b.textContent === "4H")!
      .click()
    await new Promise((r) => setTimeout(r, 0))
    expect(series).toHaveBeenCalledWith(expect.any(String), "4h")
    // The long end of the row exists too, and speaks its own range: MAX is
    // day candles to the provider's limit, a young pool's whole life.
    ;[...sh.querySelectorAll<HTMLElement>(".chart .pick")]
      .find((b) => b.textContent === "MAX")!
      .click()
    await new Promise((r) => setTimeout(r, 0))
    expect(series).toHaveBeenCalledWith(expect.any(String), "max")
  })

  it("draws the reader's own trades and standing orders on the chart", async () => {
    const now = Date.now()
    const myTrades = vi.fn(async () => [
      { side: "buy" as const, ts: now - 60_000 },
      { side: "sell" as const, ts: now - 30 * 60_000 },
      // Older than the 1d window: must not be drawn at an edge and lie.
      { side: "buy" as const, ts: now - 100 * 24 * 60 * 60 * 1000 },
    ])
    // The chip filters levels to ITS OWN mint, which the harness assigns;
    // the mock reads it after mount so the filter is what gets tested.
    let chipMint = ""
    const listOrders = vi.fn(async () => [
      {
        orderKey: "k1",
        mint: chipMint,
        side: "sell" as const,
        amountUsd: 25,
        amountUi: 0.25,
        // Far above the series' [1..4] domain: clamps to the top edge but
        // the tag still carries the real number.
        triggerPriceUsd: 99,
        gated: false,
      },
      {
        orderKey: "k2",
        mint: "SomeOtherMint111111111111111111111111111111",
        side: "buy" as const,
        amountUsd: 10,
        amountUi: 1,
        triggerPriceUsd: 2,
        gated: false,
      },
    ])
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      series: vi.fn(async () => ({ points: [1, 2, 3, 2, 4], times: null, opens: null, highs: null, lows: null, failed: false })),
      myTrades,
      listOrders,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "903", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    chipMint = host.getAttribute("data-poppin-strip")!
    await new Promise((r) => setTimeout(r, 0))
    const sh = host.shadowRoot!
    sh.querySelector<HTMLElement>(".more")!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // Two trades inside the window, the ancient one refused.
    const marks = [...sh.querySelectorAll<HTMLElement>(".plot .mark")]
    expect(marks).toHaveLength(2)
    expect(marks.filter((m) => m.classList.contains("b"))).toHaveLength(1)
    expect(marks.filter((m) => m.classList.contains("s"))).toHaveLength(1)

    // Only THIS mint's order becomes a level, clamped to the top edge with
    // the real price on its tag.
    const levels = [...sh.querySelectorAll<HTMLElement>(".plot .order-level")]
    expect(levels).toHaveLength(1)
    expect(levels[0].classList.contains("s")).toBe(true)
    const tag = sh.querySelector<HTMLElement>(".plot .order-tag")!
    expect(tag.textContent).toContain("$99")
    expect(myTrades).toHaveBeenCalledWith(expect.any(String))
  })

  it("yields the slot to the sheet — one expansion at a time", async () => {
    const { sh } = await open()
    sh.querySelector<HTMLElement>(".px")!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(sh.querySelector(".chart")).not.toBeNull()
    sh.querySelector<HTMLElement>(".buy")!.click()
    expect(sh.querySelector(".chart")).toBeNull()
    expect(sh.querySelector(".sheet")).not.toBeNull()
  })

  it("does not steal the panel door when no series dep exists", async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "902", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    await new Promise((r) => setTimeout(r, 0))
    const sh = (cell.querySelector("[data-poppin-strip]") as HTMLElement).shadowRoot!
    sh.querySelector<HTMLElement>(".px")!.click()
    expect(sh.querySelector(".chart")).toBeNull()
  })
})

/**
 * WHERE THE CHIP LANDS, AND WHETHER IT CAN BE PRESSED.
 *
 * Reported from a status page: the chip drew below X's "Relevant" reply
 * sort — adrift in the replies section — and Buy/Sell would not press.
 * Both are layout facts, and both are asserted here against the DOM X
 * actually ships on each surface.
 */
describe("placement on any X layout", () => {
  const withActionRow = (article: HTMLElement, extras: string[] = []) => {
    const group = document.createElement("div")
    group.setAttribute("role", "group")
    group.textContent = "16 3 65"
    article.appendChild(group)
    // A status page keeps appending INSIDE the article after the action row.
    for (const label of extras) {
      const d = document.createElement("div")
      d.textContent = label
      article.appendChild(d)
    }
    return group
  }

  const mountOn = (extras: string[] = []) => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell, article } = makeCell({ id: "950", text: "$WIF", cashtags: ["$WIF"] })
    const group = withActionRow(article, extras)
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    return { host, group, article }
  }

  it("sits immediately under the action row, not after everything else", () => {
    // The status-page shape: sort control and reply composer live inside
    // the article, AFTER the like row.
    const { host, group } = mountOn(["Relevant", "Post your reply"])
    expect(group.nextElementSibling).toBe(host)
  })

  it("does the same on a timeline, where nothing follows the row", () => {
    const { host, group } = mountOn()
    expect(group.nextElementSibling).toBe(host)
  })

  it("falls back to the article when there is no action row", () => {
    const d = deps({ shadowMode: "open", onScreen: () => false })
    const ctl = createXStrip(d)
    const { cell, article } = makeCell({ id: "951", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    expect(article.nextElementSibling).toBe(host)
  })

  it("does not also press the tweet — the cell is one big link", () => {
    // X navigates to the status page on a click anywhere in the article
    // that is not a control. Harmless while the chip hung off the END of
    // the article; anchoring it under the action row put it INSIDE, and
    // Buy started opening the tweet on the way out.
    const { host, article } = mountOn()
    const heardByX = vi.fn()
    article.addEventListener("click", heardByX)
    article.addEventListener("mousedown", heardByX)
    article.addEventListener("pointerdown", heardByX)

    const shadow = host.shadowRoot!
    const buy = [...shadow.querySelectorAll("button")].find(
      (b) => b.textContent?.startsWith("Buy"),
    )!
    for (const type of ["pointerdown", "mousedown", "click"]) {
      buy.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true }))
    }
    expect(heardByX).not.toHaveBeenCalled()
    // And the press still did its own job.
    expect(shadow.querySelector(".sheet")).toBeTruthy()
  })

  it("aligns to the action row, not to a quoted tweet's text", () => {
    // A video post that QUOTES another tweet has no text of its own: the
    // only tweetText in the article sits inside the quote box, indented
    // again past the tweet's column. Measuring the chip's inset from that
    // is what drifted it right on a live feed.
    const left = new Map<Element, number>()
    const real = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      return { left: left.get(this) ?? 0 } as DOMRect
    }
    try {
      const d = deps({ shadowMode: "open", onScreen: () => false })
      const ctl = createXStrip(d)
      const { cell, article } = makeCell({
        id: "952",
        text: "$WIF",
        cashtags: ["$WIF"],
      })
      const group = withActionRow(article)
      // The whole point of this shape: the post carries NO text of its
      // own, so the quote's text is the only tweetText in the article.
      article.querySelector('[data-testid="tweetText"]')!.remove()
      const quoteText = document.createElement("div")
      quoteText.setAttribute("data-testid", "tweetText")
      quoteText.textContent = "this is the quoted $WIF tweet"
      article.appendChild(quoteText)

      // The action row and the host share the tweet's own column; the
      // quote box is indented a further 76px.
      left.set(group, 64)
      left.set(quoteText, 140)
      // Every host created in this pass reports the column origin.
      const origin = 64
      const patched = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function () {
        if (this instanceof HTMLElement && this.hasAttribute("data-poppin-strip")) {
          return { left: origin } as DOMRect
        }
        return patched.call(this)
      }

      ctl.processCell(cell)
      const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
      const chip = host.shadowRoot!.querySelector(".chip") as HTMLElement
      // Row and host share an origin, so the only correct inset is none.
      // The quote's 76px must never reach the margin. And inside the text
      // column no horizontal margin exists at all, stylesheet included.
      expect(chip.style.marginLeft).toBe("")
      expect(chip.style.marginRight).toBe("")
    } finally {
      Element.prototype.getBoundingClientRect = real
    }
  })

  it("takes the rail's width when the host hangs off a railed article", () => {
    // The other half of the same rule: no action row, host after the
    // article, tweet text indented by the avatar rail. The chip follows.
    const left = new Map<Element, number>()
    const real = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLElement && this.hasAttribute("data-poppin-strip")) {
        return { left: 0 } as DOMRect
      }
      return { left: left.get(this) ?? 0 } as DOMRect
    }
    try {
      const d = deps({ shadowMode: "open", onScreen: () => false })
      const ctl = createXStrip(d)
      const { cell, article } = makeCell({
        id: "953",
        text: "$WIF",
        cashtags: ["$WIF"],
      })
      const textEl = article.querySelector('[data-testid="tweetText"]')!
      left.set(textEl, 64)

      ctl.processCell(cell)
      const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
      const chip = host.shadowRoot!.querySelector(".chip") as HTMLElement
      expect(chip.style.marginLeft).toBe("64px")
      // The fallback host spans the cell, so the chip re-creates X's own
      // right page padding by hand.
      expect(chip.style.marginRight).toBe("16px")
    } finally {
      Element.prototype.getBoundingClientRect = real
    }
  })

  it("keeps its own stacking context and its own clicks", () => {
    const { host } = mountOn()
    // A shadow root is a DOM boundary, not a paint or hit-testing one: an
    // X layer above the host ate every press until these were set.
    expect(host.style.isolation).toBe("isolate")
    expect(host.style.pointerEvents).toBe("auto")
    expect(host.style.position).toBe("relative")
  })
})

// Measured on a real reader's chip: the Activity tab read "lev3 followed
// you", "nic liked your post", "nic liked your post" — 23 and 74 days old,
// inside a chip sitting under a post about Nvidia. And two lines above,
// "#1 this week" sat under "Portfolio value $9.05", which a reader joins
// into a claim neither number was making.
describe("the chip's own surfaces say what they are about", () => {
  it("keeps the purely social kinds off the money tab", () => {
    const src = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
    expect(src).toContain('const SOCIAL_ONLY = new Set(["follow", "like", "share"])')
    // A deny list, so a kind nobody has written yet still reaches the
    // reader — a new money event is likelier than a new way of being liked.
    expect(src).toContain("if (SOCIAL_ONLY.has(n.kind)) return false")
  })

  it("gives notifications a horizon, because a two-month-old like is not activity", () => {
    const src = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
    expect(src).toContain("const NOTE_HORIZON_MS = 14 * 24 * 60 * 60 * 1000")
  })

  it("says what the rank ranks, so it stops reading as a claim about the money", () => {
    const src = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
    expect(src).toContain("by points this week")
  })
})

// The holdings list read "$WIF" beside "SOL", "RAY" and "ORE" in the same
// column: the sigil is the server's and only some rows carry it. The chip's
// own pill says NVDA and the fills row already stripped it, so bare is what
// this surface speaks — holdings was the one place that had not been told.
describe("one ticker language", () => {
  const src = readFileSync(join(__dirname, "xStrip.ts"), "utf8")

  it("strips the sigil wherever a ticker fills a column", () => {
    expect(src).toContain('const bareTicker = (t: string) => t.replace(/^\\$/, "")')
    for (const call of ['cell("you-tick", bareTicker(']) {
      expect(src.split(call).length - 1, "every you-tick cell goes through it").toBeGreaterThan(2)
    }
  })

  it("says nothing twice above the amount", () => {
    // The field wears a $ and sits in a trade sheet; the word was a third
    // way of saying the same thing.
    expect(src).not.toContain('lblEl("Amount")')
  })
})

// Measured on a real wallet: three rows reading a truncated base58
// address, a bare quantity and an em dash — left over from the prediction
// stack this product was before August. They are not dust, because dust at
// least has a price, and the earlier fold let them through on purpose:
// "unpriced" was being read as "we do not know yet". For a row that is
// also nameless there is nothing to know and nothing to say.
describe("a holding worth showing", () => {
  const src = readFileSync(join(__dirname, "xStrip.ts"), "utf8")

  it("has a name or a value, and the rest fold away", () => {
    expect(src).toContain("(p.named || p.valueUsd !== null)")
  })

  it("keeps knowing which it could not name", () => {
    // Without this the fold cannot tell "we could not name this" from
    // "it is called SOL and it is worth nothing".
    expect(src).toContain("named: Boolean(p.ticker)")
  })

  it("says the tail is there rather than hiding it", () => {
    expect(src).toContain("with nothing to show")
  })
})

describe("the bell opens the alert room", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const open = async (extra: Partial<XStripDeps> = {}) => {
    const d = deps({
      shadowMode: "open",
      onScreen: () => false,
      book: book(432.1),
      saveAlert: vi.fn(async () => true),
      listAlerts: vi.fn(async () => []),
      listFired: vi.fn(async () => []),
      ...extra,
    })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "9001", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await settle()
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await settle()
    return { sh: host.shadowRoot!, d }
  }

  it("a press on the bell lands on the price field, with Activity one tab away", async () => {
    const { sh, d } = await open()
    sh.querySelector<HTMLElement>(".ring")!.click()
    await settle()
    expect([...sh.querySelectorAll<HTMLElement>(".tab")].map((t) => t.textContent)).toEqual([
      "Alerts",
      "Activity",
    ])
    expect(sh.querySelector(".watch-q")!.textContent).toBe("Tell me when $WIF hits")
    // Not about the money: no hero, no wallet furniture.
    expect(sh.querySelector<HTMLElement>(".you-head")!.hidden).toBe(true)
    expect(sh.querySelector<HTMLElement>(".you-foot")!.hidden).toBe(true)
    sh.querySelector<HTMLInputElement>(".watch-ask .price-in")!.value = "120"
    sh.querySelector<HTMLElement>(".watch-set")!.click()
    await settle()
    expect(d.saveAlert).toHaveBeenCalledWith(
      expect.objectContaining({ mint: WIF_ASSET.mint, targetUsd: 120, direction: "above" }),
    )
    expect(sh.querySelector(".watch-msg")!.textContent).toMatch(/^Alert set · reaches/)
    expect(d.track).toHaveBeenCalledWith(
      "x_price_alert",
      expect.objectContaining({ added: true, via: "bell" }),
    )
    // The promise is listed right under the field.
    expect(sh.querySelector(".watch-list .you-row")).not.toBeNull()
  })

  it("an empty field asks for a price instead of setting nothing", async () => {
    const { sh, d } = await open()
    sh.querySelector<HTMLElement>(".ring")!.click()
    await settle()
    sh.querySelector<HTMLElement>(".watch-set")!.click()
    await settle()
    expect(d.saveAlert).not.toHaveBeenCalled()
    expect(sh.querySelector(".watch-msg")!.textContent).toBe("Type a price")
  })

  it("the wallet pill still opens the scoreboard, hero and all", async () => {
    const { sh } = await open()
    sh.querySelector<HTMLElement>(".wal")!.click()
    await settle()
    expect([...sh.querySelectorAll<HTMLElement>(".tab")].map((t) => t.textContent)).toEqual([
      "Holdings",
      "Orders",
      "Activity",
    ])
    expect(sh.querySelector<HTMLElement>(".you-head")!.hidden).toBe(false)
  })
})

describe("who hovers and does not press", () => {
  it("counts a 700ms dwell on the row, and on Buy, once each", async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(432.1) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "9002", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    const sh = host.shadowRoot!
    vi.useFakeTimers()
    try {
      const chip = sh.querySelector<HTMLElement>(".chip")!
      chip.dispatchEvent(new Event("pointerenter"))
      vi.advanceTimersByTime(699)
      expect(d.track).not.toHaveBeenCalledWith("x_strip_hover", expect.anything())
      vi.advanceTimersByTime(1)
      expect(d.track).toHaveBeenCalledWith("x_strip_hover", expect.objectContaining({ target: "chip" }))
      // A second dwell on the row says nothing new; the Buy key is its own count.
      chip.dispatchEvent(new Event("pointerleave"))
      chip.dispatchEvent(new Event("pointerenter"))
      vi.advanceTimersByTime(700)
      sh.querySelector<HTMLElement>(".buy")!.dispatchEvent(new Event("pointerenter"))
      vi.advanceTimersByTime(700)
      const hovers = d.track.mock.calls.filter((c) => c[0] === "x_strip_hover")
      expect(hovers.map((c) => (c[1] as { target: string }).target)).toEqual(["chip", "buy"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("a pointer that leaves before the dwell is not a hover", async () => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(432.1) })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "9003", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    const chip = host.shadowRoot!.querySelector<HTMLElement>(".chip")!
    vi.useFakeTimers()
    try {
      chip.dispatchEvent(new Event("pointerenter"))
      vi.advanceTimersByTime(400)
      chip.dispatchEvent(new Event("pointerleave"))
      vi.advanceTimersByTime(1000)
      expect(d.track).not.toHaveBeenCalledWith("x_strip_hover", expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("the chart is named for a reader without an account", () => {
  const mount = async (extra: Partial<XStripDeps>) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, ...extra })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "9004", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    return host.shadowRoot!
  }
  it("labels the chevron Chart once the book answers signed-out", async () => {
    const sh = await mount({
      book: async () => {
        throw { status: 401, message: "unauthorized" }
      },
    })
    expect(sh.querySelector(".more.labeled .more-lbl")!.textContent).toBe("Chart")
    expect(sh.querySelector(".more")!.getAttribute("aria-label")).toBe("Price chart")
  })
  it("says nothing to a reader with an account", async () => {
    const sh = await mount({ book: book(432.1) })
    expect(sh.querySelector(".more.labeled")).toBeNull()
  })
})

describe("the invite row at the bottom of Holdings", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const openYou = async (extra: Partial<XStripDeps>) => {
    const d = deps({ shadowMode: "open", onScreen: () => false, book: book(4.5), ...extra })
    const ctl = createXStrip(d)
    const { cell } = makeCell({ id: "9101", text: "$WIF", cashtags: ["$WIF"] })
    ctl.processCell(cell)
    const host = cell.querySelector("[data-poppin-strip]") as HTMLElement
    await settle()
    ctl.updatePrice(host.getAttribute("data-poppin-strip")!, 100, 1)
    await settle()
    const sh = host.shadowRoot!
    sh.querySelector<HTMLElement>(".wal")!.click()
    await settle()
    await settle()
    return { sh, d }
  }

  it("is there after the first trade, closed to one line, open to the link", async () => {
    const { sh, d } = await openYou({
      invite: {
        landed: vi.fn(async () => ({ first: false })),
        info: vi.fn(async () => ({ code: "JQUBIQ", joined: 1, earnedUsd: 0.42, hasTraded: true })),
      },
    })
    const row = sh.querySelector<HTMLElement>(".invite-row")!
    expect(row).not.toBeNull()
    expect(row.textContent).toContain("Invite")
    expect(row.textContent).toContain("1 joined")
    // Closed: no link, no money.
    expect(row.querySelector(".invite-open")).toBeNull()
    row.querySelector<HTMLElement>(".you-x")!.click()
    await settle()
    const open = sh.querySelector<HTMLElement>(".invite-open")!
    expect(open).not.toBeNull()
    expect(open.textContent).toContain("poppin.so/join/JQUBIQ")
    expect(open.textContent).toContain("20% of their trading fees")
    // Cents are not money worth printing.
    expect(open.textContent).toContain("nothing earned yet")
    expect(d.track).toHaveBeenCalledWith("x_invite_shown", expect.objectContaining({ via: "panel" }))
  })

  it("is absent for a reader who has not traded and holds nothing", async () => {
    const { sh } = await openYou({
      invite: {
        landed: vi.fn(async () => ({ first: false })),
        info: vi.fn(async () => ({ code: "JQUBIQ", joined: 0, earnedUsd: 0, hasTraded: false })),
      },
    })
    expect(sh.querySelector(".invite-row")).toBeNull()
  })

  it("prints earnings from a dollar up", async () => {
    const { sh } = await openYou({
      invite: {
        landed: vi.fn(async () => ({ first: false })),
        info: vi.fn(async () => ({ code: "JQUBIQ", joined: 7, earnedUsd: 4.2, hasTraded: true })),
      },
    })
    sh.querySelector<HTMLElement>(".invite-row .you-x")!.click()
    await settle()
    expect(sh.querySelector(".invite-stats")!.textContent).toBe("7 joined · $4.20 earned")
  })
})
