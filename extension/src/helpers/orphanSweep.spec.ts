import { beforeEach, describe, expect, it, vi } from "vitest"
import { claimHost, sweepOrphanRoots, watchForStrangers } from "./orphanSweep"

const corpse = (attr: string) => {
  const n = document.createElement("div")
  n.setAttribute(attr, "")
  document.documentElement.appendChild(n)
  return n
}

/**
 * A LIVE CONTEXT BEFORE ANY DOM IS TOUCHED. The watcher asks
 * extensionAlive() inside its callback, and this file mutates the document
 * in its own cleanup — so a window where `chrome` is missing lets a
 * cleanup mutation tell the observer it has died, permanently, and every
 * test after that one sees no observer at all. Stub first, mutate second.
 */
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { id: "abc" } })
  document.body.innerHTML = ""
  delete (window as unknown as Record<string, unknown>).__poppin_orphans_swept
  document.querySelectorAll("[data-poppin-spot-card],[data-poppin-strip],[data-poppin-x]").forEach((n) => n.remove())
})

describe("sweepOrphanRoots", () => {
  it("removes a dead context's card and strips", () => {
    corpse("data-poppin-spot-card")
    corpse("data-poppin-strip")
    sweepOrphanRoots()
    expect(document.querySelector("[data-poppin-spot-card]")).toBeNull()
    expect(document.querySelector("[data-poppin-strip]")).toBeNull()
  })

  it("leaves the page's own marked cells alone", () => {
    /* data-poppin-x marks a TWEET as processed; the node is the page's. */
    const cell = corpse("data-poppin-x")
    sweepOrphanRoots()
    expect(document.contains(cell)).toBe(true)
  })

  it("runs once: the second script to boot cannot bury the first's fresh work", () => {
    corpse("data-poppin-spot-card")
    sweepOrphanRoots()
    // The first script has since mounted a LIVE card.
    const fresh = corpse("data-poppin-spot-card")
    sweepOrphanRoots()
    expect(document.contains(fresh)).toBe(true)
  })
})

/**
 * THE CORPSE MUST NOT BURY THE LIVING.
 *
 * "Stranger" is symmetric — both contexts run this file, so to the orphan
 * an auto-update leaves behind, every host the NEW context mounts looks
 * foreign. It removed all of them, on every site, and the reader's symptom
 * was that the extension simply stopped appearing after an update until
 * they reloaded the page.
 *
 * The one asymmetry is Chrome's: it clears runtime.id on the context it
 * tore down. These tests drive that flag, because it is the whole fix.
 */
describe("watchForStrangers", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const alive = () => vi.stubGlobal("chrome", { runtime: { id: "abc" } })
  const dead = () => vi.stubGlobal("chrome", { runtime: {} })

  it("removes a card host this instance did not stamp, the moment it appears", async () => {
    watchForStrangers()
    const stranger = document.createElement("div")
    stranger.setAttribute("data-poppin-spot-card", "")
    document.documentElement.appendChild(stranger)
    await tick()
    expect(document.contains(stranger)).toBe(false)
  })

  it("leaves this instance's own host alone", async () => {
    watchForStrangers()
    const mine = document.createElement("div")
    mine.setAttribute("data-poppin-spot-card", "")
    claimHost(mine)
    document.documentElement.appendChild(mine)
    await tick()
    expect(document.contains(mine)).toBe(true)
  })

  it("sees a stranger nested inside an added subtree too", async () => {
    watchForStrangers()
    const wrap = document.createElement("div")
    const strip = document.createElement("div")
    strip.setAttribute("data-poppin-strip", "mint")
    wrap.appendChild(strip)
    document.documentElement.appendChild(wrap)
    await tick()
    expect(document.contains(strip)).toBe(false)
    expect(document.contains(wrap)).toBe(true)
  })

  it("stops removing anything once its own context is gone", async () => {
    watchForStrangers()
    dead()
    const live = document.createElement("div")
    live.setAttribute("data-poppin-spot-card", "")
    document.documentElement.appendChild(live)
    await tick()
    // Unstamped, so the old rule called it a stranger. It is the NEW
    // context's host, and a context that cannot reach the extension has no
    // business deciding what belongs on the page.
    expect(document.contains(live)).toBe(true)
  })

  it("does not come back to life when the flag flickers", async () => {
    // The teardown is one-way: the only repair is a reload. Once the
    // observer has let go it must stay let go, or a half-dead context
    // starts culling again the moment a stubbed global lies to it.
    watchForStrangers()
    dead()
    document.documentElement.appendChild(document.createElement("div"))
    await tick()
    alive()
    const second = document.createElement("div")
    second.setAttribute("data-poppin-strip", "mint")
    document.documentElement.appendChild(second)
    await tick()
    expect(document.contains(second)).toBe(true)
  })
})
