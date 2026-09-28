import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * A LIST FROM AN EVENTUALLY CONSISTENT SOURCE IS NEVER ASKED ONCE.
 *
 * Reported: place a standing order, open the You panel, and it is not
 * there. Reload the page and it is. Nothing was cached and nothing failed
 * — the panel fetched the list exactly once, on open, and the source had
 * not caught up yet. /embed/asset/orders reads Jupiter's getTriggerOrders,
 * which indexes the order account after the transaction lands, so the one
 * moment a reader is most likely to look is the one moment the answer is
 * most likely to be stale. Reloading worked because that mounted a new
 * chip, which is not a cure, it is a coincidence.
 *
 * Measured on the reported order: placed, and present at Jupiter at
 * 09:09:04 on 2026-09-14. The source was right. The asking was wrong.
 *
 * Three things hold this shut, and the third is as important as the other
 * two: the retry is BOUNDED. An empty order list is a perfectly ordinary
 * answer, and a panel that keeps polling to disbelieve it is the flicker
 * amplifier the chip's own remount cure was written against.
 */
const SRC = readFileSync(join(__dirname, "xStrip.ts"), "utf8")

/** The panel's own scope, so a same-named helper elsewhere cannot stand in. */
const PANEL = SRC.slice(
  SRC.indexOf('const showYou = ('),
  SRC.indexOf('const walChip = ()'),
)

describe("the You panel's order list", () => {
  it("is fetched through one reusable helper, not a single shot", () => {
    expect(PANEL).toContain("const loadOrders = ()")
    // Called on open. Without this the panel starts empty and only a tab
    // switch would ever fill it.
    expect(PANEL.includes("\n      loadOrders()")).toBe(true)
  })

  it("asks again when the reader opens the tab", () => {
    // The fix for the actual report: the reader places an order, then goes
    // looking for it. That second look has to be a second question.
    expect(PANEL).toContain('if (key === "orders") loadOrders()')
  })

  it("retries once when the tab is open and the list came back empty", () => {
    expect(PANEL).toContain("orderRetryLeft")
    expect(PANEL).toMatch(/orderRetryLeft\s*-=\s*1/)
  })

  it("bounds that retry, so an empty list is allowed to be the answer", () => {
    // One. A panel that polls forever to disbelieve an empty list is the
    // failure this codebase already paid for once, in remounts.
    expect(PANEL).toMatch(/let orderRetryLeft = 1\b/)
  })

  it("never blanks the list on a failed request", () => {
    // This had no catch at all, so one refused request left the tab empty
    // for the life of the page with nothing on screen to say why.
    const at = PANEL.indexOf("const loadOrders = ()")
    const body = PANEL.slice(at, at + 1400)
    expect(body).toContain(".catch(")
  })
})

/**
 * WHAT A CANCEL OWES THE READER.
 *
 * Three faults found on the owner's screen, one after another, all in the
 * same handful of lines:
 *
 *   the press did nothing and said nothing   (no .catch at all)
 *   the reason printed as "[object Object]"  (the bridge throws a plain
 *                                             object, not an Error)
 *   the balance stayed put after it worked   (escrow returned, nobody read)
 *
 * They are pinned together because they are one idea: a control that moves
 * money has to report every outcome it can have, including the ones it does
 * not like.
 */
describe("cancelling a standing order", () => {
  const HANDLER = PANEL.slice(
    PANEL.indexOf('btn("you-x", "Cancel"'),
    PANEL.indexOf('r.appendChild(x)'),
  )

  it("catches a refusal instead of dropping it", () => {
    expect(HANDLER).toContain(".catch(")
  })

  it("prints words, never the shape of the error", () => {
    // String() on the bridge's plain object gives "[object Object]", which
    // is what the owner actually saw.
    expect(HANDLER).toContain("failureReason(err)")
    expect(HANDLER).not.toContain("String(err)")
    // One implementation, shared with the background, which logs the same
    // refusals into chrome://extensions and printed "[object Object]" there
    // on the same afternoon.
    expect(SRC).toContain('from "~/helpers/failureReason"')
  })

  it("can always leave the state it enters", () => {
    // Disabled for the request, re-enabled on both settle paths AND on a
    // timeout, because a promise that never settles takes neither.
    expect(HANDLER).toContain('x.textContent = "Cancelling…"')
    expect(HANDLER).toMatch(/setTimeout/)
    expect(HANDLER).toContain("settled")
  })

  it("re-reads the balance, because the escrow came back", () => {
    // refreshBook, not book. book() is memoised for 20 seconds, so the
    // first version of this asked the cache and got the answer from before
    // the cancel — the panel kept showing the old number and the bug was
    // reported a second time. The cache is right to exist (/positions is
    // 8.6s cold); it is the wrong thing to ask when you are the reason the
    // answer changed.
    expect(HANDLER).toContain("refreshBook().then")
    expect(HANDLER).not.toMatch(/[^h]book\(\)\.then/)
  })

  it("does not rebuild the panel to do it", () => {
    // showYou() here would reset the tab to Holdings and teleport a reader
    // who is still looking at their orders. That is the whole reason the
    // list is patched in place.
    //
    // Comments come out first: this file's house style NAMES showYou() when
    // explaining why it is not called, and a scan that cannot tell code
    // from prose fails on the explanation rather than the mistake.
    const code = HANDLER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).not.toContain("showYou(")
  })
})
