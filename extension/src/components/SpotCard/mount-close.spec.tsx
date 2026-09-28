import { beforeEach, describe, expect, it, vi } from "vitest"
import { mountSpotCard } from "./mount"
import type { SpotAsset, SpotCardHandlers } from "./SpotCard"

/**
 * THE CLOSE THAT CANNOT BE STRANDED.
 *
 * × runs handlers.onDismiss, which runs the controller's collapse(). The
 * old collapse() returned at its first line whenever the card was already
 * "leaving", and a leaving that never finished (a paint that threw) made
 * that return permanent: a visible card with a dead ×, seen on CoinGecko.
 * These pin the contract that replaced it.
 */
const asset: SpotAsset = {
  mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  symbol: "WIF",
  name: "dogwifhat",
  displayName: "dogwifhat",
  decimals: 6,
  usdPrice: 0.1791,
  change24hPct: -1.8,
  category: "memecoin",
  issuer: null,
  restrictions: [],
  balance: null,
} as unknown as SpotAsset

const handlers = (): SpotCardHandlers =>
  new Proxy({} as SpotCardHandlers, { get: () => vi.fn(async () => undefined) })

let captured: ShadowRoot | undefined
const origAttach = Element.prototype.attachShadow
beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>"
  captured = undefined
  Element.prototype.attachShadow = function (init) {
    const root = origAttach.call(this, init)
    captured = root
    return root
  }
  vi.useFakeTimers()
})

/** Walk up from the × to the wrapper paint() toggles; hidden = collapsed. */
const cardHidden = () => {
  const x = captured!.querySelector('[data-act="dismiss"]') as HTMLElement | null
  if (!x) throw new Error("no dismiss button in the card")
  let el: HTMLElement = x
  while (el.parentElement && el.parentElement.parentElement !== null && el.parentElement.parentElement !== (captured as unknown as Node)) {
    el = el.parentElement
    if (el.parentElement && el.parentElement.parentNode === captured) break
  }
  // el is now the direct child of the mount point that wraps the card
  return el.style.display === "none"
}

describe("collapse()", () => {
  it("a second × during the exit finishes the close instead of being swallowed", () => {
    const c = mountSpotCard(asset, handlers(), { startCollapsed: false })
    expect(cardHidden()).toBe(false)
    c.collapse()
    c.collapse() // still "leaving": the old code returned here and did nothing
    expect(cardHidden()).toBe(true)
    c.destroy()
  })

  it("× on an already-collapsed card is harmless and keeps it collapsed", () => {
    const c = mountSpotCard(asset, handlers(), { startCollapsed: false })
    c.collapse()
    vi.advanceTimersByTime(500)
    expect(cardHidden()).toBe(true)
    expect(() => c.collapse()).not.toThrow()
    expect(cardHidden()).toBe(true)
    c.destroy()
  })

  it("the ordinary close still animates out and lands collapsed", () => {
    const c = mountSpotCard(asset, handlers(), { startCollapsed: false })
    c.collapse()
    expect(cardHidden()).toBe(false) // exit animation is on screen
    vi.advanceTimersByTime(200)
    expect(cardHidden()).toBe(true)
    c.destroy()
  })
})
