import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..", "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * A TIMELINE MOUNTS CHIPS FOR AS LONG AS SOMEBODY SCROLLS.
 *
 * Anything a chip subscribes to and never releases is therefore unbounded,
 * and two of them were: one chrome.storage listener per bell, and a price
 * stream the worker kept polling for every mint ever scrolled past.
 */
describe("a recycled chip lets go of what it took", () => {
  const chip = strip(read("entries/contentScript/x/xStrip.ts"))
  const page = strip(read("entries/contentScript/primary/main.tsx"))

  it("shares one unread listener across the page instead of one per bell", () => {
    expect(page).toMatch(/const unreadWatchers = new Set<UnreadWatcher>\(\)/)
    expect(page).toMatch(/let unreadListening = false/)
    // The listener is registered once, behind the guard.
    const at = page.indexOf("chrome.storage.onChanged.addListener")
    const before = page.slice(page.lastIndexOf("ensureUnreadListener", at), at)
    expect(before).toMatch(/if \(unreadListening\) return/)
  })

  it("drops a watcher the moment its chip says it is gone", () => {
    expect(page).toMatch(/if \(!w\.alive\(\)\) unreadWatchers\.delete\(w\)/)
    // Swept on news AND on every fresh registration, because news is rare
    // and mounting is not.
    // Swept in BOTH places: when news arrives, and when a chip registers.
    const onNews = page.slice(page.indexOf("const n = alerts + fills"))
    expect(onNews.slice(0, 200)).toMatch(/sweepUnreadWatchers\(\)/)
    const onRegister = page.slice(page.indexOf("const ensureUnreadListener"))
    expect(onRegister.slice(0, 160)).toMatch(/sweepUnreadWatchers\(\)/)
    expect(chip).toMatch(/\}, \(\) => host\.isConnected\)/)
  })

  it("stops the price stream when the last chip for a mint leaves", () => {
    // The registry already forgot the mint; the poll behind it did not.
    expect(chip).toMatch(/deps\.unwatchPrice\?\.\(mint\)/)
    const at = chip.indexOf("deps.unwatchPrice?.(mint)")
    const before = chip.slice(chip.lastIndexOf("if (targets.size === 0)", at), at)
    expect(before).toMatch(/watched\.delete\(mint\)/)
    // And the page half actually sends it to the worker.
    expect(page).toMatch(/type: "POPPIN_UNWATCH_PRICE"/)
  })

  it("does not try to speak to a torn-down extension", () => {
    const at = page.indexOf('type: "POPPIN_UNWATCH_PRICE"')
    const before = page.slice(page.lastIndexOf("unwatchPrice:", at), at)
    expect(before).toMatch(/if \(!extensionAlive\(\)\) return/)
  })
})
