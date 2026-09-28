import { describe, expect, it, beforeEach, vi } from "vitest"
import { mountSpotCard } from "./mount"
import { PRESET_USD, type SpotAsset, type SpotCardHandlers } from "./SpotCard"

/**
 * The card is the one surface a reader ever sees, and the one piece a normal
 * unit test cannot cover: it lives inside a shadow root, on a page whose CSS is
 * written by someone else and is frequently hostile.
 *
 * poppin-v2 checked this with a browser harness — a page with deliberately
 * aggressive styling (Comic Sans on `*`, `!important` everywhere, borders on
 * every div) and a human looking at the result. This is that harness as an
 * assertion: the same hostile rules, applied to the same card, with the
 * outcome checked rather than eyeballed.
 *
 * WHAT IT CAN AND CANNOT PROVE. jsdom implements shadow DOM attachment and
 * scoping but not cascade or layout, so "the card renders at 13px" is not
 * assertable here. What IS assertable, and is what actually broke in practice:
 * that the boundary EXISTS, that it is CLOSED, that page rules are not inside
 * it, and that our own stylesheet is. A regression in any of those is how page
 * CSS gets in, and none of them needs layout to detect.
 */

const HOSTILE_CSS = `
  * { font-family: "Comic Sans MS", cursive !important; color: magenta !important; }
  div { border: 3px solid orange !important; padding: 40px !important; }
  button { background: hotpink !important; font-size: 40px !important; }
  input { display: none !important; }
`

const asset: SpotAsset = {
  mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
  symbol: "SPCX",
  name: "SpaceX",
  displayName: "SpaceX",
  decimals: 6,
  usdPrice: 135.07,
  change24hPct: 2.14,
  category: "equity",
  issuer: "backpack-securities",
  restrictions: ["us-persons"],
  // Holding > 0 so the Sell surface renders and the isolation tests cover it.
  balance: { uiAmount: 0.02726, raw: "27260" },
}

const handlers = (): SpotCardHandlers => ({
  onExpand: vi.fn(),
  onAmount: vi.fn(),
  onConfirm: vi.fn(),
  onDismiss: vi.fn(),
  onPosts: vi.fn(),
  onOpenPanel: vi.fn(),
  onPost: vi.fn(async () => ({ kind: "ok" }) as const),
  onReply: vi.fn(async () => ({ kind: "ok" }) as const),
  onVote: vi.fn(async () => true),
  onAuthor: vi.fn(),
  onCopyTrade: vi.fn(),
  onToggleWatch: vi.fn(),
  onGate: vi.fn(),
  onOpenThread: vi.fn(async () => [
    { id: "r1", text: "agreed", author: "deniz" },
  ]),
})

/** The card's root is behind a CLOSED shadow root, so the test has to keep the
 *  reference `attachShadow` returned — exactly as a page script could not. */
let captured: ShadowRoot | undefined
const origAttach = Element.prototype.attachShadow

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>"
  const style = document.createElement("style")
  style.textContent = HOSTILE_CSS
  document.head.appendChild(style)

  captured = undefined
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const r = origAttach.call(this, { ...init, mode: "open" })
    captured = r
    return r
  }
})

const host = () => document.querySelector("[data-poppin-spot-card]")!

/**
 * Preact batches state updates into a microtask, so the DOM is one tick behind
 * a click. Every interaction below awaits this — without it the assertions run
 * against the pre-click render and fail in a way that looks like the component
 * is broken rather than the test being early.
 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe("SpotCard — isolation from a hostile page", () => {
  it("mounts behind a shadow root rather than into the page", () => {
    mountSpotCard(asset, handlers())
    expect(host()).toBeTruthy()
    // Nothing of ours in the light DOM: no card markup for page CSS to reach.
    expect(document.body.querySelector(".wrap")).toBeNull()
    expect(host().querySelector(".wrap")).toBeNull()
    expect(captured!.querySelector(".wrap")).toBeTruthy()
  })

  it("asks for a CLOSED root, so page scripts cannot walk into it", () => {
    // The spy above forces `open` to get a handle; what matters is what the
    // card ASKED for. A page script calling host.shadowRoot on the real thing
    // gets null, which is what keeps a trade button unreachable from the page.
    const spy = vi.spyOn(Element.prototype, "attachShadow")
    mountSpotCard(asset, handlers())
    expect(spy).toHaveBeenCalledWith({ mode: "closed" })
    spy.mockRestore()
  })

  it("carries its own stylesheet inside the boundary", () => {
    mountSpotCard(asset, handlers())
    const css = captured!.querySelector("style")!.textContent!
    // The reset is the isolation. Without it the card inherits the page.
    expect(css).toContain(":host { all: initial; }")
    // And the type scale the design is built on.
    for (const size of ["11px", "12px", "13px", "15px", "18px"]) {
      expect(css, size).toContain(size)
    }
  })

  it("does not let the page's stylesheet inside the boundary", () => {
    mountSpotCard(asset, handlers())
    const inside = [...captured!.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("")
    expect(inside).not.toContain("Comic Sans")
    expect(inside).not.toContain("hotpink")

    /**
     * `!important` is the third marker of foreign CSS — a hostile page leans
     * on it to force its way in. But it is also the ONE place our own
     * stylesheet legitimately needs it: a prefers-reduced-motion block has to
     * beat every hover and state rule in the sheet, and that is exactly what
     * the accessibility guidance asks for.
     *
     * So the assertion is narrowed rather than dropped, and it still has
     * teeth: every `!important` must sit inside a reduced-motion block, and a
     * stray one anywhere else fails this test the way it always did.
     */
    const importants = [...inside.matchAll(/!important/g)].map((m) => m.index ?? 0)
    for (const at of importants) {
      const before = inside.slice(0, at)
      const openedAt = before.lastIndexOf("@media (prefers-reduced-motion")
      const closedAfter = openedAt === -1 ? -1 : before.indexOf("\n}", openedAt)
      expect(
        openedAt !== -1 && closedAfter === -1,
        `!important at ${at} is outside a prefers-reduced-motion block`,
      ).toBe(true)
    }
  })

  it("survives the page replacing document.body", () => {
    // SPA route changes do this. The card hangs off documentElement precisely
    // so a body swap does not take it with them.
    mountSpotCard(asset, handlers())
    document.body.remove()
    document.documentElement.appendChild(document.createElement("body"))
    expect(host()).toBeTruthy()
  })

  it("replaces a previous card instead of stacking a second", () => {
    // The content script can be injected more than once per tab; two cards
    // would mean two quote loops against the same page.
    mountSpotCard(asset, handlers())
    mountSpotCard(asset, handlers())
    expect(document.querySelectorAll("[data-poppin-spot-card]")).toHaveLength(1)
  })
})

describe("SpotCard — behaviour", () => {
  const openPanel = async () => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    const buy = captured!.querySelector('[data-act="buy"]') as HTMLButtonElement
    buy.click()
    await tick()
    return { ctl, h }
  }

  it("starts collapsed — no panel until Buy", () => {
    mountSpotCard(asset, handlers())
    expect(captured!.querySelector("[data-panel]")).toBeNull()
    // Human name leads; the ticker is the sub-line. Price and 24h change
    // render from the data, plain.
    expect(captured!.querySelector(".name")!.textContent).toBe("SpaceX")
    expect(captured!.querySelector(".ticker")!.textContent).toBe("$SPCX")
    expect(captured!.querySelector(".price")!.textContent).toBe("$135.07")
    expect(captured!.querySelector(".chg")!.textContent).toBe("+2.1%")
  })

  it("offers Sell whatever the balance says", () => {
    /**
     * This asserted the opposite for a long time, and the owner reversed
     * it: an absent Sell does not read as "you hold none of this", it
     * reads as "this product cannot sell". A capability the reader cannot
     * see is one they do not believe in.
     *
     * The chip in the feed was corrected first and the card followed,
     * because half a correction is worse than none — a reader who sees
     * Sell on the row and loses it on the card learns the button comes and
     * goes for reasons they cannot predict.
     */
    for (const balance of [
      null,
      { uiAmount: 0, raw: "0" },
      { uiAmount: 7.32, raw: "7320000" },
    ]) {
      mountSpotCard({ ...asset, balance }, handlers())
      expect(captured!.querySelector('[data-act=\'sell\']')).not.toBeNull()
    }
  })

  it("names the issuer in the PANEL, and not on the collapsed card", async () => {
    const { } = await openPanel()
    // The disclosure the §7 bypass owes a reader: who holds the authorities.
    // It moved off the collapsed card — a glance surface — to the panel,
    // where the decision it informs is made.
    expect(captured!.querySelector(".issuer")!.textContent).toBe(
      "issued by Backpack Securities",
    )
  })

  it("omits the issuer line for an open-mint asset", async () => {
    const h = handlers()
    mountSpotCard({ ...asset, issuer: null, category: "token" }, h)
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector(".issuer")).toBeNull()
  })

  it("shows the restriction line in the PANEL, not on the collapsed card", async () => {
    await openPanel()
    expect(captured!.querySelector(".warn")!.textContent).toBe(
      "Issuer restricts US persons · this may fail",
    )
  })

  it("renders no restriction line for an unrestricted reader", async () => {
    const h = handlers()
    mountSpotCard({ ...asset, restrictions: [] }, h)
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector(".warn")).toBeNull()
  })

  it("offers 10 / 25 / 100 and fills the amount on one tap", async () => {
    const { h } = await openPanel()
    const chips = [...captured!.querySelectorAll("[data-preset]")]
    expect(chips.map((c) => c.textContent)).toEqual(
      PRESET_USD.map((v) => `$${v}`),
    )
    ;(chips[1] as HTMLButtonElement).click()
    await tick()
    const input = captured!.querySelector("[data-amount]") as HTMLInputElement
    expect(input.value).toBe("25")
    expect(h.onAmount).toHaveBeenCalledWith(25, "buy")
  })

  it("lights the tapped chip and only that one", async () => {
    await openPanel()
    const chips = () =>
      [...captured!.querySelectorAll("[data-preset]")].map((c) =>
        c.getAttribute("aria-pressed"),
      )
    ;(captured!.querySelectorAll("[data-preset]")[2] as HTMLButtonElement).click()
    await tick()
    expect(chips()).toEqual(["false", "false", "true"])
  })

  it("the market button names the money, and asks when there is none", async () => {
    const { ctl } = await openPanel()
    const confirm = () =>
      captured!.querySelector('[data-act="confirm"]') as HTMLButtonElement
    // A preset tap: the shared rulebook's words reach the button verbatim.
    ;(captured!.querySelector('[data-preset="25"]') as HTMLButtonElement)?.click()
    await tick()
    if (confirm()) expect(confirm().textContent).toContain("Buy $25")
    // Empty the field: "Buy $0" is not a sentence anybody meant, so the
    // disarmed key asks for the missing thing instead.
    const input = captured!.querySelector("[data-amount]") as HTMLInputElement
    input.value = ""
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    expect(confirm().textContent).toContain("Type an amount")
    void ctl
  })

  it("enables Confirm as soon as the parent says an amount is valid", async () => {
    const { ctl } = await openPanel()
    const confirm = () =>
      captured!.querySelector('[data-act="confirm"]') as HTMLButtonElement
    expect(confirm().disabled).toBe(true)
    ctl.setQuote("0.1851 SPCX · 0.04% impact", { canConfirm: true })
    await tick()
    expect(confirm().disabled).toBe(false)
  })

  it("disables Confirm again when the quote errors", async () => {
    const { ctl } = await openPanel()
    ctl.setQuote("0.1851 SPCX", { canConfirm: true })
    ctl.setQuote("Quote unavailable", { error: true })
    await tick()
    const q = captured!.querySelector("[data-quote]")!
    expect(q.className).toContain("err")
    expect(
      (captured!.querySelector('[data-act="confirm"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it("shows the optimistic outcome WITHOUT the success colour", async () => {
    // A signature means submitted, not settled. Pending keeps the neutral
    // surface so the later correction is an update, not a contradiction.
    const { ctl } = await openPanel()
    ctl.setOutcome("Bought 0.1851 SPCX", "pending")
    await tick()
    const q = captured!.querySelector("[data-quote]")!
    expect(q.textContent).toBe("Bought 0.1851 SPCX")
    expect(q.className).toContain("pending")
    expect(q.className).not.toContain("done")
  })

  it("goes green only once the chain confirms", async () => {
    const { ctl } = await openPanel()
    ctl.setOutcome("Bought 0.1851 SPCX", "pending")
    ctl.setOutcome("Bought 0.1851 SPCX", "done")
    await tick()
    expect(captured!.querySelector("[data-quote]")!.className).toContain("done")
  })

  it("shows a chain failure in the error style", async () => {
    const { ctl } = await openPanel()
    ctl.setOutcome("The transaction failed on chain", "error")
    await tick()
    expect(captured!.querySelector("[data-quote]")!.className).toContain("err")
  })

  it("takes Confirm away for good once there is an outcome", async () => {
    const { ctl } = await openPanel()
    ctl.setQuote("0.1851 SPCX", { canConfirm: true })
    ctl.setOutcome("Bought 0.1851 SPCX", "pending")
    await tick()
    expect(
      (captured!.querySelector('[data-act="confirm"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it("reports the typed amount to onConfirm", async () => {
    const { ctl, h } = await openPanel()
    const input = captured!.querySelector("[data-amount]") as HTMLInputElement
    input.value = "42"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    // Confirm is disabled until the parent says the amount is quotable, and a
    // disabled button swallows the click — enable it as the real flow does.
    ctl.setQuote("0.31 SPCX", { canConfirm: true })
    await tick()
    ;(captured!.querySelector('[data-act="confirm"]') as HTMLButtonElement).click()
    expect(h.onConfirm).toHaveBeenCalledWith(42, "buy")
  })

  it("dismisses and removes itself from the page", async () => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ;(captured!.querySelector('[data-act="dismiss"]') as HTMLButtonElement).click()
    await tick()
    expect(h.onDismiss).toHaveBeenCalled()
    ctl.destroy()
    expect(document.querySelector("[data-poppin-spot-card]")).toBeNull()
  })

  it("keeps Sell through every balance change", async () => {
    /**
     * The bug this originally pinned was real and is still worth guarding
     * from the other side: balance was fetched ONCE at mount and never
     * again, so the card answered "do you own any" from before you owned
     * any. Now that Sell is unconditional the button cannot disappear —
     * but the balance still has to keep flowing, because the SHEET behind
     * it sizes a sale from it.
     */
    const ctl = mountSpotCard({ ...asset, balance: null }, handlers())
    expect(captured!.querySelector('[data-act="sell"]')).not.toBeNull()

    ctl.setBalance({ uiAmount: 7.32, raw: "7320000" })
    await tick()
    expect(captured!.querySelector('[data-act="sell"]')).not.toBeNull()

    ctl.setBalance({ uiAmount: 0, raw: "0" })
    await tick()
    expect(captured!.querySelector('[data-act="sell"]')).not.toBeNull()
  })

  it("does not claim Solana issued a native token", async () => {
    // "issued by Solana" states the obvious and teaches readers to skip
    // disclosures. The line exists to name the counterparty holding an
    // underlying asset; a native SPL token has neither.
    const h = handlers()
    mountSpotCard({ ...asset, issuer: "native-spl", category: "token" }, h)
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector(".issuer")).toBeNull()

    // A real counterparty still gets named — that disclosure is owed.
    mountSpotCard(asset, handlers())
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector(".issuer")!.textContent).toBe(
      "issued by Backpack Securities",
    )
  })

  it("names the asset on the buttons that spend money", () => {
    mountSpotCard(asset, handlers())
    // A lone verb is the one control a person presses without re-reading the
    // surface it came from — and this surface is somebody else's page.
    expect(captured!.querySelector('[data-act="buy"]')!.textContent).toBe("Buy SPCX")
    expect(captured!.querySelector('[data-act="sell"]')!.textContent).toBe("Sell SPCX")
  })

  it("strips the catalog's dollar sign from prose", () => {
    // Catalog symbols carry their own "$" for memecoins. "Buy $WIF" reads as
    // a price the moment it sits next to a verb.
    mountSpotCard({ ...asset, symbol: "$WIF" }, handlers())
    expect(captured!.querySelector('[data-act="buy"]')!.textContent).toBe("Buy WIF")
    // The ticker line still wants the sign, and must not double it.
    expect(captured!.querySelector(".ticker")!.textContent).toBe("$WIF")
  })
})

describe("the edge tab — collapsed is a place, not an ending", () => {
  /** Keep-alive check: with both trees mounted, "there" means VISIBLE -
   *  an element whose wrapper is display:none is retreated, not gone. */
  const visible = (sel: string): boolean => {
    const el = captured!.querySelector(sel)
    if (!el) return false
    for (let p = el as HTMLElement | null; p; p = p.parentElement) {
      if (p.style?.display === "none") return false
    }
    return true
  }

  it("can arrive collapsed, and opens on a click", async () => {
    mountSpotCard(asset, handlers(), { startCollapsed: true })
    // No card SHOWING, just the tab. (Both trees stay mounted now - the
    // keep-alive that stops a collapse from eating drafts - so the check
    // is visibility, not existence.)
    expect(visible(".wrap")).toBe(false)
    const pill = captured!.querySelector('[data-act="open-pill"]') as HTMLButtonElement
    expect(pill).not.toBeNull()

    pill.click()
    await tick()
    expect(visible(".wrap")).toBe(true)
    expect(visible('[data-act="open-pill"]')).toBe(false)
  })

  it("× retreats to the tab instead of destroying the card", async () => {
    // The regression this exists to prevent: dismiss used to call destroy(),
    // which took the host out of the DOM and left the page with no way back
    // until a reload. One stray click cost the reader the whole feature.
    const ctl = mountSpotCard(asset, handlers())
    ctl.collapse()
    await tick()
    // The exit is SHOWN first — the card is still there, wearing its leave.
    expect(captured!.querySelector(".wrap.leaving")).not.toBeNull()

    await new Promise((r) => setTimeout(r, 200))
    expect(visible(".wrap")).toBe(false)
    expect(visible('[data-act="open-pill"]')).toBe(true)
    // Still on the page. That is the whole point.
    expect(document.querySelector("[data-poppin-spot-card]")).not.toBeNull()
    // And the card TREE survived the retreat - the drafts live here.
    expect(captured!.querySelector(".wrap")).not.toBeNull()
  })

  it("opening from the panel's strip un-collapses first", async () => {
    // expand() used to only bump the nonce, which opened a keypad inside a
    // tab nobody could see.
    const ctl = mountSpotCard(asset, handlers(), { startCollapsed: true })
    ctl.expand()
    // Longer than a microtask: the tab has to be replaced by the card, and
    // only THEN can the card's expand effect run and open the panel. Preact
    // defers effects past the commit, so this crosses two frames, not two
    // microtasks.
    await new Promise((r) => setTimeout(r, 150))
    expect(captured!.querySelector("[data-panel]")).not.toBeNull()
  })

  it("settles into the edge instead of parking a logo on the page", async () => {
    // The rudeness this prevents: a fully opaque mark pinned to the vertical
    // centre of the viewport, forever, on content the reader came for. It
    // arrives visible so it can be learned, then gets out of the way.
    mountSpotCard(asset, handlers(), { startCollapsed: true })
    const pill = () => captured!.querySelector(".pill")!
    expect(pill().className).not.toContain("pill-rest")

    await new Promise((r) => setTimeout(r, 4100))
    expect(pill().className).toContain("pill-rest")
  }, 10_000)

  it("rests as a chevron, never as a logo", async () => {
    // The point of the resting state: a logo is a claim about who we are, a
    // chevron is an instruction about what this does, and only the second
    // has earned a permanent place on somebody else's page.
    mountSpotCard(asset, handlers(), { startCollapsed: true })
    // Both marks exist from the start; which one shows is a class away.
    expect(captured!.querySelector(".pill-chevron")).not.toBeNull()
    expect(captured!.querySelector(".pill .mark")).not.toBeNull()

    await new Promise((r) => setTimeout(r, 4100))
    expect(captured!.querySelector(".pill")!.className).toContain("pill-rest")

    const css = captured!.querySelector("style")!.textContent!
    expect(css).toContain(".pill.pill-rest .mark { opacity: 0; }")
    expect(css).toContain(".pill.pill-rest .pill-chevron { opacity: .8; }")
    // Narrow and ON screen — a handle you can see, not a cropped edge.
    expect(css).toMatch(/\.pill\.pill-rest \{[^}]*width: 14px/)
    // Hover has to restore BOTH the width and the identity, or the tab grows
    // without saying what it became.
    expect(css).toContain(".pill.pill-rest:hover .mark { opacity: 1; }")
  }, 10_000)

  it("does not retreat while something is unread", async () => {
    // The badge rides on the pill, so retreating would carry the count off
    // screen — politeness to the page at the reader's expense.
    const ctl = mountSpotCard(asset, handlers(), { startCollapsed: true })
    ctl.setUnread(2)
    await new Promise((r) => setTimeout(r, 4100))
    expect(captured!.querySelector(".pill")!.className).not.toContain("pill-rest")
    expect(captured!.querySelector("[data-unread]")!.textContent).toBe("2")

    // Read them, and the tab is free to get out of the way again.
    ctl.setUnread(0)
    await tick()
    expect(captured!.querySelector(".pill")!.className).toContain("pill-rest")
  }, 10_000)

  it("a new voice brings the tab back out of the edge", async () => {
    // A nudge performed 22px off screen at .42 opacity is a nudge nobody
    // sees, so arriving conversation has to undo the retreat as well.
    const ctl = mountSpotCard(asset, handlers(), { startCollapsed: true })
    await new Promise((r) => setTimeout(r, 4100))
    expect(captured!.querySelector(".pill")!.className).toContain("pill-rest")

    ctl.setPosts([
      { id: "p1", text: "hi", author: "ada", authorId: "u-ada", upvotes: 0, upvoted: false, replyCount: 0 },
    ])
    await tick()
    expect(captured!.querySelector(".pill")!.className).not.toContain("pill-rest")
  }, 10_000)

  it("vanishes entirely while the page is fullscreen", () => {
    // Somebody who put a video fullscreen has said they want that and
    // nothing else. Dimming is not an answer here; absence is.
    mountSpotCard(asset, handlers(), { startCollapsed: true })
    const el = host() as HTMLElement
    expect(el.style.display).toBe("")

    Object.defineProperty(document, "fullscreenElement", {
      value: document.body,
      configurable: true,
    })
    document.dispatchEvent(new Event("fullscreenchange"))
    expect(el.style.display).toBe("none")

    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    })
    document.dispatchEvent(new Event("fullscreenchange"))
    expect(el.style.display).toBe("")
  })

  it("the tab moves only when a voice ARRIVES, never on a timer", async () => {
    const ctl = mountSpotCard(asset, handlers(), { startCollapsed: true })
    const pill = () => captured!.querySelector(".pill")!
    expect(pill().className).not.toContain("pill-nudge")

    ctl.setPosts([
      { id: "p1", text: "hi", author: "ada", authorId: "u-ada", upvotes: 0, upvoted: false, replyCount: 0 },
    ])
    await tick()
    expect(pill().className).toContain("pill-nudge")

    // Re-reading the SAME conversation is not news — a vote refetch must not
    // make the tab twitch.
    ctl.setPosts([
      { id: "p1", text: "hi", author: "ada", authorId: "u-ada", upvotes: 1, upvoted: true, replyCount: 0 },
    ])
    await new Promise((r) => setTimeout(r, 620))
    expect(pill().className).not.toContain("pill-nudge")
  })
})

describe("the page's conversation", () => {
  const withPosts = [
    { id: "p1", text: "Starship looked great today", author: "ada", authorId: "u-ada", upvotes: 3, upvoted: false, replyCount: 2 },
    { id: "p2", text: "the booster landing was the real story", author: "kemal", authorId: "u-kemal", upvotes: 0, upvoted: true, replyCount: 0 },
  ]

  it("invites the first post when the page has no conversation", async () => {
    // The invitation does NOT disappear: this card only exists on a page
    // where an asset matched, so it costs nothing extra — and hiding it
    // means no conversation can ever start, since every one is empty until
    // somebody is offered the first word. The invitation is the COMPOSER on
    // the card face; the count pill is a door and waits for a conversation
    // to exist, because a second control saying "Say something" beside a
    // field saying "Say something" was the card repeating itself.
    mountSpotCard(asset, handlers())
    const field = captured!.querySelector(".mini-compose input") as HTMLInputElement
    expect(field).not.toBeNull()
    // The placeholder IS the invitation, and it names the room it is in.
    // "Say something…" was the vaguest thing on the card: it never said
    // whether anybody had ever written here, so the safest read was nobody.
    expect(field.placeholder).toBe("What's your take?")
    expect(captured!.querySelector('[data-act="convo"]')).toBeNull()

    // The send control appears once there is something to send.
    expect(captured!.querySelector('[data-act="mini-post"]')).toBeNull()
    field.value = "first"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    expect(captured!.querySelector('[data-act="mini-post"]')).not.toBeNull()
  })

  it("switches the invitation once a conversation exists", async () => {
    // Two rooms, two sentences, one field. An empty page asks for the first
    // word; a busy one says there is something to join — which is the whole
    // difference between a form field and an invitation.
    const ctl = mountSpotCard(asset, handlers())
    const field = () =>
      captured!.querySelector(".mini-compose input") as HTMLInputElement
    expect(field().placeholder).toBe("What's your take?")

    ctl.setPosts(withPosts)
    await tick()
    expect(field().placeholder).toBe("Join the conversation")
  })

  it("carries the conversation INTO the trade panel", async () => {
    // The gap this closes: the old teaser rows were gated on `!expanded`, so
    // pressing Buy deleted the conversation from the screen — at exactly the
    // moment "what are people saying" is worth the most. Social proof beside
    // the decision is the whole move.
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(withPosts)
    await tick()
    expect(captured!.querySelector('[data-act="convo"]')).not.toBeNull()

    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector("[data-panel]")).not.toBeNull()
    // Still there, under the quote and above Confirm.
    const strip = captured!.querySelector('[data-act="convo"]')
    expect(strip).not.toBeNull()
    expect(strip!.closest("[data-panel]")).not.toBeNull()
  })

  it("shows the NEWEST voice and the count, one line", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(withPosts)
    await tick()
    // One row, not two: a pair of fixed rows is a screenshot of a
    // conversation, a single row that changes is a live one.
    expect(captured!.querySelectorAll('[data-act="convo"]').length).toBe(1)
    expect(captured!.querySelector(".convo-text")!.textContent).toBe(withPosts[0].text)
    expect(captured!.querySelector(".convo-count")!.textContent).toContain("2")
    // Two distinct authors, so two faces.
    expect(captured!.querySelectorAll(".convo-face").length).toBe(2)
  })

  it("does not print its fetch limit as the size of the conversation", async () => {
    // The card asks for one PAGE. On a page with dozens of posts it used to
    // report however many it had fetched, as though that were the total —
    // a number nobody counted, which is the same failure as the X tick.
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(withPosts, true)
    await tick()
    // The glyph rides in the same span, so read the trailing number.
    expect(captured!.querySelector(".convo-count")!.textContent).toContain("2+")

    // Server says that is everything: the number is exact, so no "+".
    ctl.setPosts(withPosts, false)
    await tick()
    expect(captured!.querySelector(".convo-count")!.textContent).toBe("2")
  })

  it("keeps the count honest whether or not the server has more", async () => {
    // The footer's "1 post / 2 posts" label went with the button; the strip's
    // glyph says "posts" without spending a word, so what is left to pin is
    // the NUMBER — exact when the server says that is everything, "+" when
    // it does not.
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts([withPosts[0]], false)
    await tick()
    expect(captured!.querySelector(".convo-count")!.textContent).toBe("1")

    ctl.setPosts([withPosts[0]], true)
    await tick()
    expect(captured!.querySelector(".convo-count")!.textContent).toBe("1+")
  })

  it("says nothing when nobody has spoken, and steps aside once the feed is open", async () => {
    const ctl = mountSpotCard(asset, handlers())
    // Empty: the composer's placeholder does the inviting on its own.
    expect(captured!.querySelector('[data-act="convo"]')).toBeNull()

    ctl.setPosts(withPosts)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    // The full list is right there; a summary of it would be the card
    // repeating itself.
    expect(captured!.querySelector("[data-posts]")).not.toBeNull()
    expect(captured!.querySelector('[data-act="convo"]')).toBeNull()
  })

  it("puts real faces on the strip, and a trimmed receipt", async () => {
    // The strip was written before avatars reached CardPost, so it drew
    // initials for everybody — the faces said "somebody" where the feed one
    // tap away said who. And it showed the raw receipt, tail and all.
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts([
      {
        id: "t1",
        text: "Bought 7.32 $WIF ($1.00) on www.coingecko.com via Poppin",
        author: "lev",
        authorId: "u-me",
        upvotes: 0,
        upvoted: false,
        replyCount: 0,
        avatarUrl: "https://example.com/lev.jpg",
        isTrade: true,
        side: "buy",
      },
    ])
    await tick()
    const face = captured!.querySelector(".convo-face") as HTMLElement
    expect(face.style.backgroundImage).toContain("lev.jpg")
    expect(face.textContent).toBe("")
    expect(captured!.querySelector(".convo-text")!.textContent).toBe("WIF $1")
  })

  it("marks the count as a count — a bare number reads as a timestamp", async () => {
    // Reported as exactly that: "14, is that minutes?". The right-hand slot
    // of a row is where feeds put a time, so the number needs a glyph.
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(withPosts, false)
    await tick()
    expect(captured!.querySelector(".convo-count svg")).not.toBeNull()
  })

  it("keeps Buy and Sell the same width — size is not an argument", () => {
    mountSpotCard(asset, handlers())
    const acts = [...captured!.querySelectorAll(".acts button")]
    expect(acts.length).toBe(2)
    // Emphasis lives in fill vs ghost; a wider Buy would read as a
    // recommendation the card has no business making.
    const flex = acts.map((b) => getComputedStyle(b as HTMLElement).flexGrow)
    expect(new Set(flex).size).toBe(1)
  })

  it("keeps the action row to the two buttons that spend money", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(withPosts)
    await tick()
    // The conversation's door is the strip; the sidebar's door is the footer.
    // Neither is allowed to stand beside Buy/Sell competing for the press.
    expect(captured!.querySelectorAll(".acts button").length).toBe(2)
    expect(captured!.querySelector('[data-act="convo"]')!.closest(".acts")).toBeNull()
    expect(
      (captured!.querySelector('[data-act="open-panel"]') as HTMLElement).closest(".brand"),
    ).not.toBeNull()
  })

  it("reads market → money → conversation, in that order", async () => {
    // Reported as a UI bug: the strip sat ABOVE Buy, which put the spend
    // control between the proof ("18 said things") and the invitation
    // ("Join the conversation") — two halves of one thing, split.
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(withPosts)
    await tick()
    const acts = captured!.querySelector(".acts")!
    const convo = captured!.querySelector('[data-act="convo"]')!
    const compose = captured!.querySelector(".mini-compose")!
    // Node.compareDocumentPosition: FOLLOWING === 4.
    expect(acts.compareDocumentPosition(convo) & 4).toBeTruthy()
    expect(convo.compareDocumentPosition(compose) & 4).toBeTruthy()
  })

  it("always offers the sidebar, and going there is a handler not a guess", async () => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    await tick()
    // No posts yet: the conversation has no door, but the sidebar still does.
    expect(captured!.querySelector('[data-act="convo"]')).toBeNull()
    const door = captured!.querySelector('[data-act="open-panel"]') as HTMLButtonElement
    expect(door).not.toBeNull()
    door.click()
    await tick()
    // And the footer door names its landing: the panel's HOME, not the
    // profile every door used to fall into.
    expect(h.onOpenPanel).toHaveBeenCalledWith("home")
    void ctl
  })

  it("gives every post a face, a time, and a direction when it is a trade", async () => {
    // The row used to be a blue name inline with its own sentence, which
    // reads as a 2009 comment thread. A face is the cheapest proof a PERSON
    // is on the other end, and on a social surface that proof is the product.
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts([
      {
        id: "t1",
        text: "Bought 7.32 $WIF ($1.00) on www.coingecko.com via Poppin",
        author: "lev",
        authorId: "u-me",
        upvotes: 0,
        upvoted: false,
        replyCount: 0,
        createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        avatarUrl: "https://example.com/lev.jpg",
        isTrade: true,
        side: "buy",
      },
      { ...withPosts[0], createdAt: new Date(Date.now() - 7_200_000).toISOString() },
    ])
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()

    const rows = [...captured!.querySelectorAll(".post")]
    // A photo becomes the disc's background; no photo falls back to an
    // initial, never to nothing.
    expect((rows[0].querySelector(".post-ava") as HTMLElement).style.backgroundImage).toContain("lev.jpg")
    expect(rows[1].querySelector(".post-ava")!.textContent).toBe("A")

    expect(rows[0].querySelector(".post-tag")!.textContent).toBe("Buy")
    expect(rows[1].querySelector(".post-tag")).toBeNull()

    expect(rows[0].querySelector(".post-when")!.textContent).toBe("3m")
    expect(rows[1].querySelector(".post-when")!.textContent).toBe("2h")

    // The receipt drops the tail written for X. The reader IS on
    // coingecko.com and the Poppin wordmark is six pixels below.
    expect(rows[0].querySelector(".post-text")!.textContent).toBe("WIF $1")
  })

  it("opens the conversation and renders posts as plain text", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(withPosts)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    const texts = [...captured!.querySelectorAll(".post-text")].map((n) => n.textContent)
    expect(texts).toEqual(withPosts.map((p) => p.text))
  })

  it("shows the post it just accepted, without waiting for the refetch", async () => {
    // The failure this replaces: press Post, and the card looks EXACTLY as
    // it did a second ago while a refetch flies somewhere out of sight. The
    // writer's only evidence their sentence existed was that the field went
    // empty, which is also what a silent failure looks like.
    const h = handlers()
    h.onPost = vi.fn(async () => ({ kind: "ok" as const }))
    mountSpotCard(asset, h)

    const field = captured!.querySelector(".mini-compose input") as HTMLInputElement
    field.value = "first words on this page"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    ;(captured!.querySelector('[data-act="mini-post"]') as HTMLButtonElement).click()
    await tick()
    await tick()

    // The conversation is open and the sentence is in it — no server yet.
    expect(captured!.querySelector("[data-posts]")).not.toBeNull()
    const texts = [...captured!.querySelectorAll(".post-text")].map((n) => n.textContent)
    expect(texts).toContain("first words on this page")
  })

  it("does not echo when the parent already delivered the post", async () => {
    // The real flow awaits its own refetch and calls setPosts BEFORE onPost
    // resolves, so most of the time there is no gap to cover — and an echo
    // fired blindly printed the reader's sentence twice, once as the server's
    // row and once as ours.
    const h = handlers()
    let ctl: ReturnType<typeof mountSpotCard>
    h.onPost = vi.fn(async (text: string) => {
      ctl.setPosts([
        { id: "srv", text, author: "lev", authorId: "u-me", upvotes: 0, upvoted: false, replyCount: 0 },
      ])
      return { kind: "ok" as const }
    })
    ctl = mountSpotCard(asset, h)

    const field = captured!.querySelector(".mini-compose input") as HTMLInputElement
    field.value = "only once please"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    ;(captured!.querySelector('[data-act="mini-post"]') as HTMLButtonElement).click()
    await tick()
    await tick()

    const texts = [...captured!.querySelectorAll(".post-text")].map((n) => n.textContent)
    expect(texts).toEqual(["only once please"])
  })

  it("lets the server's list replace the echo", async () => {
    const h = handlers()
    h.onPost = vi.fn(async () => ({ kind: "ok" as const }))
    const ctl = mountSpotCard(asset, h)
    const field = captured!.querySelector(".mini-compose input") as HTMLInputElement
    field.value = "mine"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    ;(captured!.querySelector('[data-act="mini-post"]') as HTMLButtonElement).click()
    await tick()
    await tick()

    // The real list lands. The optimistic row must not survive alongside it,
    // or the writer sees their post twice.
    ctl.setPosts(withPosts)
    // Two flushes: one paints the server's list, the effect that notices it
    // clears the echo, and that clear paints on the next.
    await tick()
    await tick()
    const texts = [...captured!.querySelectorAll(".post-text")].map((n) => n.textContent)
    expect(texts).toEqual(withPosts.map((p) => p.text))
  })

  it("keeps Post disabled until something is typed", async () => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setPosts(withPosts)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    const post = () => captured!.querySelector('[data-act="post"]') as HTMLButtonElement
    expect(post().disabled).toBe(true)

    const draft = captured!.querySelector("[data-draft]") as HTMLInputElement
    draft.value = "  "
    draft.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    // Whitespace is not a post.
    expect(post().disabled).toBe(true)

    draft.value = "nice launch"
    draft.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    expect(post().disabled).toBe(false)
  })
})

describe("the thread", () => {
  const posts = [
    { id: "p1", text: "Starship looked great", author: "ada", authorId: "u-ada", upvotes: 3, upvoted: false, replyCount: 2 },
  ]

  const openFeed = async () => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setPosts(posts)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    return h
  }

  it("opens a post's replies and offers a way back", async () => {
    const h = await openFeed()
    ;(captured!.querySelector('[data-act="thread"]') as HTMLButtonElement).click()
    await tick()
    await tick()

    expect(h.onOpenThread).toHaveBeenCalledWith("p1")
    const reply = captured!.querySelector(".reply")!
    expect(reply.textContent).toContain("agreed")
    // A reply is a post with a smaller voice, not a different object. Before
    // this it was a name and a sentence jammed into one line, and the moment
    // the author's right margin moved into the head row it rendered as
    // "Levreply" — two words with nothing between them.
    expect(reply.querySelector(".post-head-row")).not.toBeNull()
    expect(reply.querySelector(".post-ava")!.textContent).toBe("D")
    expect(reply.querySelector(".post-author")!.textContent).toBe("deniz")
    // A one-way door is a trap: the reader can always get back to the feed.
    // One ← in the header, at the same place in every view — the thread's
    // parent is the feed, so this lands there and the ← stays (the feed's
    // own parent is the card).
    const back = () => captured!.querySelector('[data-act="back"]') as HTMLButtonElement
    expect(back()).not.toBeNull()

    back().click()
    await tick()
    expect(captured!.querySelector(".reply")).toBeNull()
    expect(captured!.querySelector('[data-act="thread"]')).not.toBeNull()
  })

  it("gives the thread's opening post the same row as the feed", async () => {
    // It had its own older copy: a blue name run straight into the sentence,
    // no face, no clock, and an untrimmed trade receipt. Every improvement
    // made to the feed row had simply missed it.
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setPosts([
      {
        id: "p1",
        text: "Bought 7.32 $WIF ($1.00) on www.coingecko.com via Poppin",
        author: "lev",
        authorId: "u-me",
        upvotes: 0,
        upvoted: false,
        replyCount: 1,
        createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        avatarUrl: "https://example.com/lev.jpg",
        isTrade: true,
        side: "buy",
      },
    ])
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    ;(captured!.querySelector('[data-act="thread"]') as HTMLButtonElement).click()
    await tick()
    await tick()

    const head = captured!.querySelector(".post-head")!
    expect((head.querySelector(".post-ava") as HTMLElement).style.backgroundImage).toContain("lev.jpg")
    expect(head.querySelector(".post-tag")!.textContent).toBe("Buy")
    expect(head.querySelector(".post-when")!.textContent).toBe("3m")
    expect(head.querySelector(".post-text")!.textContent).toBe("WIF $1")
  })

  it("votes through the existing endpoint rather than a new one", async () => {
    const h = await openFeed()
    ;(captured!.querySelector('[data-act="vote"]') as HTMLButtonElement).click()
    await tick()
    expect(h.onVote).toHaveBeenCalledWith("p1", false)
  })

  it("un-likes, including a post the SERVER says is already liked", async () => {
    // The first guard refused every press after the first, which stopped the
    // count inflating and also made a like permanent. And a Set could only
    // ever say "liked", so un-liking a post that arrived liked had nowhere
    // to record itself and the button stuck after one press.
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setPosts([{ ...posts[0], upvotes: 3, upvoted: true }])
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    const btn = () => captured!.querySelector('[data-act="vote"]') as HTMLButtonElement
    expect(btn().getAttribute("aria-pressed")).toBe("true")

    btn().click()
    await tick()
    await tick()
    expect(h.onVote).toHaveBeenLastCalledWith("p1", true)
    expect(btn().getAttribute("aria-pressed")).toBe("false")
    expect(btn().querySelector(".num")!.textContent).toBe("2")

    // And back again, as many times as they like — the direction changes,
    // the permission never does.
    btn().click()
    await tick()
    await tick()
    expect(h.onVote).toHaveBeenLastCalledWith("p1", false)
    expect(btn().getAttribute("aria-pressed")).toBe("true")
    expect(btn().querySelector(".num")!.textContent).toBe("3")
  })

  it("never lets one reader inflate a count, however many times they press", async () => {
    // The API returns no `isUpvoted`, so every press used to say "not voted
    // yet, add one" and the count climbed as fast as somebody could click:
    // five presses, five votes. Now five presses is five TOGGLES, and the
    // count lands where an odd number of them should land — one above where
    // it started, never five.
    const h = await openFeed()
    const btn = () => captured!.querySelector('[data-act="vote"]') as HTMLButtonElement
    for (let i = 0; i < 5; i++) {
      btn().click()
      await tick()
      await tick()
    }
    expect(btn().getAttribute("aria-pressed")).toBe("true")
    expect(btn().getAttribute("aria-label")).toBe("Unlike")
    expect(btn().querySelector(".num")!.textContent).toBe("4")
    // Alternating, so the server is never told to like something twice.
    expect(h.onVote).toHaveBeenNthCalledWith(1, "p1", false)
    expect(h.onVote).toHaveBeenNthCalledWith(2, "p1", true)
  })

  it("puts a refused like back", async () => {
    const h = handlers()
    h.onVote = vi.fn(async () => false)
    const ctl = mountSpotCard(asset, h)
    ctl.setPosts(posts)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    const btn = () => captured!.querySelector('[data-act="vote"]') as HTMLButtonElement
    btn().click()
    await tick()
    await tick()
    // Leaving a like on screen that the server rejected is the card lying
    // about the reader's own action.
    expect(btn().getAttribute("aria-pressed")).toBe("false")
  })
})

describe("there is always a way out", () => {
  const posts = [
    { id: "p1", text: "Starship looked great", author: "ada", authorId: "u-ada", upvotes: 3, upvoted: false, replyCount: 2 },
  ]

  it("returns from the feed to the collapsed card", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPosts(posts)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector("[data-posts]")).not.toBeNull()

    // Same control, same corner, one level up — from the feed that is the
    // card, and at the card there is nothing left to go back to.
    ;(captured!.querySelector('[data-act="back"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector("[data-posts]")).toBeNull()
    expect(captured!.querySelector('[data-act="buy"]')).not.toBeNull()
    expect(captured!.querySelector('[data-act="back"]')).toBeNull()
  })

  it("opens on the side the reader pressed", async () => {
    // Caught by hand, not by this suite, while extracting TradePanel: moving
    // `mode` into the panel dropped its opening value, so "Sell WIF" opened a
    // Buy panel. Nothing failed — there was no test. There is now.
    mountSpotCard(asset, handlers())
    ;(captured!.querySelector('[data-act="sell"]') as HTMLButtonElement).click()
    await tick()
    expect(
      captured!.querySelector('[data-mode="sell"]')!.getAttribute("aria-selected"),
    ).toBe("true")

    // And Buy still opens on Buy.
    ;(captured!.querySelector('[data-act="back"]') as HTMLButtonElement).click()
    await tick()
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(
      captured!.querySelector('[data-mode="buy"]')!.getAttribute("aria-selected"),
    ).toBe("true")
  })

  it("lets the trade panel out again — it used to be a one-way door", async () => {
    // Pressing Buy was an entrance with no exit: the only way back to the
    // card was dismissing it and getting a new one.
    mountSpotCard(asset, handlers())
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector("[data-panel]")).not.toBeNull()

    ;(captured!.querySelector('[data-act="back"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector("[data-panel]")).toBeNull()
    expect(captured!.querySelector('[data-act="buy"]')).not.toBeNull()
  })

  it("keeps the dismiss button clickable — .head used to paint over it", async () => {
    // .head animates a transform, which makes it a stacking context; it comes
    // after .x in the DOM, so without a z-index it painted on top of the
    // dismiss button and swallowed every click on it.
    const h = handlers()
    mountSpotCard(asset, h)
    const x = captured!.querySelector('[data-act="dismiss"]') as HTMLElement
    const css = captured!.querySelector("style")!.textContent!
    expect(css).toMatch(/\.x, \.nav-back \{[^}]*z-index/)
    x.click()
    await tick()
    expect(h.onDismiss).toHaveBeenCalled()
  })
})

describe("bridges to the panel", () => {
  const posts = [
    { id: "p1", text: "Starship looked great", author: "ada", authorId: "u-ada", upvotes: 3, upvoted: false, replyCount: 2 },
  ]

  it("an author's name is a door to their profile", async () => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setPosts(posts)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    ;(captured!.querySelector('[data-act="author"]') as HTMLButtonElement).click()
    expect(h.onAuthor).toHaveBeenCalledWith("u-ada")
  })

  /**
   * The receipt is a door now. These four tests are the whole contract: it
   * appears on a real buy receipt, it carries the mint the SERVER stored,
   * it stays away from sales, and it stays away from rows too old to have
   * a receipt at all.
   */
  const openConvo = async (rows: unknown[]) => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setPosts(rows as never)
    await tick()
    ;(captured!.querySelector('[data-act="convo"]') as HTMLButtonElement).click()
    await tick()
    return h
  }
  const buyRow = {
    id: "t1",
    text: "Bought 7.32 $WIF ($1.00) on www.coingecko.com via Poppin",
    author: "ada",
    authorId: "u-ada",
    upvotes: 0,
    upvoted: false,
    replyCount: 0,
    isTrade: true,
    side: "buy" as const,
    trade: { mint: "MINT_WIF", symbol: "$WIF", amount: 7.32 },
  }

  it("a buy receipt offers the same trade, with the mint the server stored", async () => {
    const h = await openConvo([buyRow])
    const copy = captured!.querySelector('[data-act="copy-trade"]') as HTMLButtonElement
    expect(copy.textContent).toContain("Buy $WIF")
    copy.click()
    expect(h.onCopyTrade).toHaveBeenCalledWith("MINT_WIF", "$WIF")
  })

  it("does not invite anyone to copy a sale", async () => {
    await openConvo([{ ...buyRow, side: "sell", text: "Sold 7.32 $WIF ($1.00)" }])
    expect(captured!.querySelector('[data-act="copy-trade"]')).toBeNull()
  })

  it("stays a sentence when the row predates stored receipts", async () => {
    // on_chain with no transaction: every trade post written before
    // 2026-08-19. There is no mint to be had, so there is no door.
    await openConvo([{ ...buyRow, trade: null }])
    expect(captured!.querySelector('[data-act="copy-trade"]')).toBeNull()
  })

  it("leaves ordinary posts alone", async () => {
    await openConvo([
      { id: "p9", text: "nice", author: "ada", authorId: "u-ada", upvotes: 0, upvoted: false, replyCount: 0 },
    ])
    expect(captured!.querySelector('[data-act="copy-trade"]')).toBeNull()
  })

  it("shows presence from 2 up, and never announces a reader to themselves", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ctl.setPresence(1)
    await tick()
    // 1 is the reader; "1 live" would be the card talking to itself.
    expect(captured!.querySelector("[data-presence]")).toBeNull()
    ctl.setPresence(3)
    await tick()
    // "live", not "online". The header pill draws the SAME number as the door
    // to the site's live chat, so the card and the header must say one word
    // for one fact — see helpers/presence.ts. This assertion is the half of
    // that rule that lives on the card.
    expect(captured!.querySelector("[data-presence]")!.textContent).toContain("3 live")
    expect(captured!.querySelector("[data-presence]")!.textContent).not.toContain("online")
  })
})

describe("the star", () => {
  it("draws nothing while membership is unknown — a guessed star lies", async () => {
    mountSpotCard(asset, handlers())
    await tick()
    expect(captured!.querySelector('[data-act="watch"]')).toBeNull()
  })

  it("renders the truth it is told, and reports the press", async () => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setWatched(false)
    await tick()
    const star = captured!.querySelector('[data-act="watch"]') as HTMLButtonElement
    expect(star.getAttribute("aria-pressed")).toBe("false")
    star.click()
    expect(h.onToggleWatch).toHaveBeenCalled()

    // The flow owns storage; the card only ever draws what it is told.
    ctl.setWatched(true)
    await tick()
    expect(
      (captured!.querySelector('[data-act="watch"]') as HTMLElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true")
  })
})

/**
 * THE INBOX BADGE ON THE MARK IS GONE. It opened the panel's social inbox,
 * which closed on 2026-09-20. The unread count survives on the reader's own
 * face two slots over, where it counts fired alerts and opens the Activity
 * tab — covered by "your own face" below.
 */

describe("the reader's own book", () => {
  const hold = (over = {}) => ({
    mint: "m1", ticker: "SOL", displayName: "Solana",
    uiAmount: 0.4213, valueUsd: 34.2, change24hPct: 5.7, pnlUsd: 4.1,
    ...over,
  })
  const book = (over = {}) => ({
    holdings: [hold()],
    totalUsd: 34.2, totalPnlUsd: 4.1, totalInvestedUsd: 30.1, cashUsd: 5.05,
    ...over,
  })
  const settled = async (sel: string) => {
    for (let i = 0; i < 60; i++) {
      if (captured!.querySelector(sel)) return
      await tick()
    }
    throw new Error(`never rendered: ${sel}`)
  }

  const opened = async (b: ReturnType<typeof book> | null = book()) => {
    const h = { ...handlers(), onBook: vi.fn(async () => b) }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: null })
    await tick()
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    // Preact defers effects, so a fixed number of ticks is a number nobody
    // can defend — three of these tests were flaky on exactly that. Wait for
    // the view to stop saying it is loading instead.
    for (let i = 0; i < 60; i++) {
      if (
        captured!.querySelector("[data-me]") &&
        !captured!.querySelector("[data-book-loading]")
      ) {
        return h
      }
      await tick()
    }
    throw new Error("the book view never settled")
  }

  it("opens IN the card instead of throwing the reader at the panel", async () => {
    const h = await opened()
    expect(captured!.querySelector("[data-me]")).not.toBeNull()
    // The whole point: the avatar used to be a one-way trip off the page.
    expect(h.onOpenPanel).not.toHaveBeenCalled()
    expect(h.onBook).toHaveBeenCalled()
  })

  it("leads with the value and keeps the token count underneath", async () => {
    await opened()
    expect(captured!.querySelector("[data-hold=\"SOL\"]")!.textContent).toContain("$34.20")
    expect(captured!.querySelector("[data-hold=\"SOL\"]")!.textContent).toContain("0.4213")
  })

  it("HIDES the total profit when any holding's basis is unknown", async () => {
    // The rule this view exists to keep: a total is read as a claim about
    // everything on the screen. Summed over half the book it is a true number
    // forming a false sentence, and false in the flattering direction.
    await opened(book({ totalPnlUsd: null, totalInvestedUsd: null }))
    expect(captured!.querySelector("[data-total-pnl]")).toBeNull()
    // The row that DOES know still says so — withholding the total is not
    // withholding everything.
    expect(captured!.querySelector("[data-hold=\"SOL\"]")!.textContent).toContain("+$4.10")
  })

  it("shows the total profit when the whole book can answer", async () => {
    // The strip's framing came to the card: when profit is knowable it IS
    // the hero ("All time"), and the portfolio value steps down into the
    // line beneath it with the percent.
    await opened()
    const t = captured!.querySelector("[data-total-pnl]")!.textContent!
    expect(t).toContain("+$4.10")
    const line = captured!.querySelector("[data-portfolio-line]")!.textContent!
    expect(line).toContain("13.6%")
    expect(line).toContain("held")
  })

  it("says the read failed rather than drawing an empty book", async () => {
    // "You own nothing" and "we could not look" are different sentences, and
    // only one of them is ever true by accident.
    await opened(null)
    expect(captured!.querySelector('[data-act="book-retry"]')).not.toBeNull()
    expect(captured!.querySelector("[data-hold]")).toBeNull()
  })

  it("puts nothing that spends money on a portfolio screen", async () => {
    await opened()
    expect(captured!.querySelector('[data-act="buy"]')).toBeNull()
    expect(captured!.querySelector('[data-act="mini-post"]')).toBeNull()
  })

  const acts = [
    { id: "n-1", kind: "event" as const, who: "ada", text: "liked your post", createdAt: "2026-08-19T10:00:00Z", unread: true, url: "https://www.coingecko.com/en/coins/dogwifhat" },
    { id: "p-1", kind: "mine" as const, text: "wif is the only honest coin", createdAt: "2026-08-19T09:00:00Z", url: "https://www.coingecko.com/en/coins/dogwifhat" },
  ]

  it("shows whose screen this is, with their face", async () => {
    const h = { ...handlers(), onBook: vi.fn(async () => book()) }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: "https://example.test/lev.png" })
    await tick()
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    await settled("[data-hold]")
    const img = captured!.querySelector(".me-who-ava img") as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toContain("lev.png")
  })

  it("falls back to an initial when the page refuses the picture", async () => {
    // A blank blue disc on every screen was the symptom, and a CSS background
    // cannot tell null from blocked from 404 — they all paint the same
    // nothing. An <img> can, so a refused picture degrades to a letter.
    const h = { ...handlers(), onBook: vi.fn(async () => book()) }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: "https://example.test/blocked.png" })
    await tick()
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    await settled(".me-who-ava img")
    const img = captured!.querySelector(".me-who-ava img") as HTMLImageElement
    img.dispatchEvent(new Event("error"))
    await tick()
    expect(captured!.querySelector(".me-who-ava img")).toBeNull()
    expect(captured!.querySelector(".me-who-ava")!.textContent).toBe("L")
  })

  it("makes a holding a door to that asset's card", async () => {
    const h = { ...handlers(), onBook: vi.fn(async () => book()), onTradeHolding: vi.fn() }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: null })
    await tick()
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    await settled("[data-hold]")
    ;(captured!.querySelector('[data-hold="SOL"]') as HTMLButtonElement).click()
    // The mint, not the ticker: two catalog rows can print the same symbol and
    // only one of them is the thing this reader holds.
    expect(h.onTradeHolding).toHaveBeenCalledWith("m1")
  })

  it("does not read activity until its tab is opened", async () => {
    const h = { ...handlers(), onBook: vi.fn(async () => book()), onActivity: vi.fn(async () => acts) }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: null })
    await tick()
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    await settled("[data-hold]")
    // Landing on Holdings must not have cost a second authenticated read.
    expect(h.onActivity).not.toHaveBeenCalled()
    ;(captured!.querySelector('[data-tab="activity"]') as HTMLButtonElement).click()
    await settled("[data-activity]")
    expect(h.onActivity).toHaveBeenCalled()
  })

  it("keeps your own posts visible even when nobody has touched them", async () => {
    // The reason the two lists are merged rather than split: a
    // notifications-only tab cannot show a post nothing happened to, and
    // that is the post its author most wants to find.
    const h = { ...handlers(), onBook: vi.fn(async () => book()), onActivity: vi.fn(async () => acts) }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: null })
    await tick()
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    await settled("[data-hold]")
    ;(captured!.querySelector('[data-tab="activity"]') as HTMLButtonElement).click()
    await settled("[data-activity]")
    const rows = captured!.querySelectorAll("[data-activity]")
    expect(rows.length).toBe(2)
    expect(captured!.querySelector('[data-activity="mine"]')!.textContent).toContain("honest coin")
    expect(captured!.querySelector('[data-activity="event"]')!.textContent).toContain("ada")
  })

  it("names the page each row happened on, with the address on hover", async () => {
    const h = { ...handlers(), onBook: vi.fn(async () => book()), onActivity: vi.fn(async () => acts) }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: null })
    await tick()
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    await settled("[data-hold]")
    ;(captured!.querySelector('[data-tab="activity"]') as HTMLButtonElement).click()
    await settled("[data-activity]")
    // The mark alone in the row; the address lives in a child the pointer can
    // reach and SELECT. A native title= would have been fewer lines and would
    // have given the reader a URL they could see but not copy.
    const site = captured!.querySelector(".me-act-site") as HTMLElement
    expect(site.getAttribute("data-site")).toBe("coingecko.com")
    expect(site.querySelector("[data-site-url]")!.textContent).toBe(
      "posted on coingecko.com/en/coins/dogwifhat",
    )
  })

  it("sends the badge where the badge is pointing", async () => {
    // An avatar wearing a count that opened a portfolio would be pointing at
    // one thing and delivering another.
    const h = { ...handlers(), onBook: vi.fn(async () => book()), onActivity: vi.fn(async () => acts) }
    const ctl = mountSpotCard(asset, h)
    ctl.setMe({ name: "lev", photoUrl: null })
    ctl.setUnread(2)
    await tick()
    expect(captured!.querySelector("[data-me-unread]")!.textContent).toBe("2")
    ;(captured!.querySelector('[data-act="me"]') as HTMLButtonElement).click()
    await settled("[data-activity]")
    // Straight to Activity — the tab the count was pointing at.
    expect(
      captured!.querySelector('[data-tab="activity"]')!.getAttribute("aria-selected"),
    ).toBe("true")
    // The book IS still read, and that is not a leak: the money block sits
    // ABOVE the tabs and shows on both, so the total is on screen either way.
    // The lazy rule applies to activity, which is below the fold of the press.
    expect(h.onBook).toHaveBeenCalled()
  })

  it("steps back to the card, like every other view", async () => {
    await opened()
    ;(captured!.querySelector('[data-act="back"]') as HTMLButtonElement).click()
    await tick()
    expect(captured!.querySelector("[data-me]")).toBeNull()
    expect(captured!.querySelector('[data-act="buy"]')).not.toBeNull()
  })
})

describe("the earned moment", () => {
  it("celebrates a fill, and takes the celebration with it when the moment ends", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    ctl.setOutcome("Bought 0.005694 TSLAx", "done")
    await tick()
    expect(captured!.querySelector(".success-burst")).not.toBeNull()

    // The rule that keeps this from being a slot machine: it belongs to the
    // outcome, and the outcome is retired the moment the reader moves on.
    ctl.setQuote("0.0057 TSLAx", { canConfirm: true })
    await tick()
    expect(captured!.querySelector(".success-burst")).toBeNull()
  })

  it("does not celebrate a failure", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    ctl.setOutcome("Insufficient USDC", "error")
    await tick()
    expect(captured!.querySelector(".success-burst")).toBeNull()
  })
})

describe("a finished trade must not hold the next one hostage", () => {
  it("lets you sell what you just bought, without dismissing the card", async () => {
    // Reported from a live page: buy $2 of TSLAx, press Sell, and Confirm sell
    // was dead. The completed BUY outcome was still disabling it, and the only
    // way out was dismissing the card — at the exact moment the reader has
    // just been handed a position and wants to act on it.
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ctl.setOutcome("Bought 0.005694 TSLAx", "done")
    await tick()
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    expect(
      (captured!.querySelector('[data-act="confirm"]') as HTMLButtonElement).disabled,
    ).toBe(true)

    // Touching the amount is the gesture that means "new decision", and the
    // quote it triggers is what retires the old outcome.
    ctl.setQuote("0.0057 TSLAx", { canConfirm: true })
    await tick()
    expect(captured!.querySelector("[data-quote]")!.textContent).toContain("TSLAx")
    expect(
      (captured!.querySelector('[data-act="confirm"]') as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})

describe("the flywheel door", () => {
  const doneWithShare = async (
    onPoppin = vi.fn(async () => true),
    onX = vi.fn(async () => true),
  ) => {
    const h = handlers()
    const ctl = mountSpotCard(asset, h)
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    ctl.setOutcome("Bought 0.027 SPCX", "done", { share: { onPoppin, onX } })
    await tick()
    return { ctl, h, onPoppin, onX }
  }

  const poppinBtn = () =>
    captured!.querySelector('[data-act="share-poppin"]') as HTMLButtonElement
  const xBtn = () =>
    captured!.querySelector('[data-act="share-x"]') as HTMLButtonElement

  it("offers TWO destinations, and neither button does the other's job", async () => {
    // This replaces one button that silently created the Poppin post AND
    // opened X, while saying only "Share trade" — so a reader could not
    // tell where their trade went, or choose.
    const { onPoppin, onX } = await doneWithShare()
    expect(poppinBtn().textContent).toBe("Share on Poppin")
    expect(xBtn().textContent).toBe("Share on X")

    poppinBtn().click()
    await tick()
    await tick()
    expect(onPoppin).toHaveBeenCalled()
    expect(onX).not.toHaveBeenCalled()
  })

  it("X waits for the post it links to", async () => {
    // Not a preference: the link X carries points AT the Poppin post, so
    // there is nothing to share until that post exists.
    const { onX } = await doneWithShare()
    expect(xBtn().disabled).toBe(true)

    poppinBtn().click()
    await tick()
    await tick()
    // Sharing moved the card to the feed, so the X button followed the post
    // into the conversation rather than being stranded in the panel.
    expect(captured!.querySelector("[data-posts]")).not.toBeNull()
    expect(xBtn().disabled).toBe(false)

    xBtn().click()
    await tick()
    await tick()
    expect(onX).toHaveBeenCalled()
    // "Opened", never a tick. All we did was open X's composer; whether the
    // reader posted, edited or closed it is on the other side of a boundary
    // we cannot see across, and a checkmark there asserts a fact nobody
    // checked. It also stays pressable — the honest answer to "did that
    // work?" is to let them try again.
    expect(xBtn().textContent).toBe("Opened ↗")
    expect(xBtn().disabled).toBe(false)
  })

  it("sharing to Poppin OPENS the conversation it posted into", async () => {
    // "Where did my post go" deserves an answer you can see. The feed's own
    // "Open in Poppin →" carries on to the panel for the full view.
    const { ctl, h } = await doneWithShare()
    ctl.setPosts([
      { id: "t1", text: "Bought 0.027 SPCX", author: "lev", authorId: "u-me", upvotes: 0, upvoted: false, replyCount: 0 },
    ])
    await tick()
    poppinBtn().click()
    await tick()
    await tick()

    expect(captured!.querySelector("[data-posts]")).not.toBeNull()
    expect(captured!.querySelector(".post-text")!.textContent).toBe("Bought 0.027 SPCX")
    expect(captured!.querySelector('[data-act="open-panel"]')).not.toBeNull()
    expect(h.onPosts).toHaveBeenCalled()
  })

  it("a failed outcome gets no share buttons — nobody shares a failure by accident", async () => {
    const ctl = mountSpotCard(asset, handlers())
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    ctl.setOutcome("Insufficient USDC", "error")
    await tick()
    expect(captured!.querySelector('[data-act="share-poppin"]')).toBeNull()
    expect(captured!.querySelector('[data-act="share-x"]')).toBeNull()
  })
})

describe("the onboarding ladder", () => {
  const open = async (h = handlers()) => {
    const ctl = mountSpotCard(asset, h)
    ;(captured!.querySelector('[data-act="buy"]') as HTMLButtonElement).click()
    await tick()
    return { ctl, h }
  }

  it("signed-out: Confirm gives way to Sign in, and the quote stays visible", async () => {
    const h = handlers()
    const { ctl } = await open(h)
    ctl.setGate("signin")
    ctl.setQuote("0.0339 SPCX", { canConfirm: true })
    await tick()
    // The rung replaces the button, not the information: a reader who can see
    // what they would have gotten converts better than one facing a wall.
    expect(captured!.querySelector('[data-act="confirm"]')).toBeNull()
    expect(captured!.querySelector("[data-quote]")!.textContent).toContain("0.0339")
    ;(captured!.querySelector('[data-act="gate-signin"]') as HTMLButtonElement).click()
    expect(h.onGate).toHaveBeenCalledWith("signin")
  })

  it("signed-in but empty: the rung is Top up, and it says the wallet exists", async () => {
    const h = handlers()
    const { ctl } = await open(h)
    ctl.setGate("topup")
    await tick()
    expect(captured!.querySelector(".gate-note")!.textContent).toContain("wallet is ready")
    ;(captured!.querySelector('[data-act="gate-topup"]') as HTMLButtonElement).click()
    expect(h.onGate).toHaveBeenCalledWith("topup")
  })

  it("no gate: trading UI, untouched", async () => {
    const { ctl } = await open()
    ctl.setGate(null)
    await tick()
    expect(captured!.querySelector('[data-act="confirm"]')).not.toBeNull()
    expect(captured!.querySelector('[data-act="gate-signin"]')).toBeNull()
  })
})
