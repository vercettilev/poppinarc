import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(__dirname, "main.ts"), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const body = stripComments(src)

/**
 * AN ALERT THAT FIRED WHILE CHROME WAS ASLEEP STILL HAPPENED.
 *
 * Two watchers share the job: this browser every minute, and the server,
 * which emails when this browser has been silent for four. Whichever sees
 * the price first marks it fired, and the other was never told — so on
 * 2026-09-19 the mail arrived and the bell's Activity band still read
 * "Nothing yet. Fills and alerts land here."
 */
describe("fired alerts come back from the server too", () => {
  it("the local check ends by asking what the server fired", () => {
    const at = body.indexOf("await syncFiredFromServer()")
    expect(at).toBeGreaterThan(0)
    // Inside checkPriceAlerts, after the local sweep has written its own.
    const fn = body.slice(body.indexOf("async function checkPriceAlerts"), at)
    expect(fn).toMatch(/PRICE_ALERTS_KEY\]: kept/)
  })

  it("reads the server's fired list and writes the same local record the chip reads", () => {
    const fn = body.slice(body.indexOf("async function syncFiredFromServer"))
    expect(fn).toMatch(/url: "\/embed\/asset\/alerts"/)
    expect(fn).toMatch(/body\?\.fired \?\? body\?\.data\?\.fired/)
    expect(fn).toMatch(/known = recordFired\(known, alert, atUsd, r\.firedAt \?\? Date\.now\(\)\)/)
    expect(fn).toMatch(/\[FIRED_ALERTS_KEY\]: known/)
  })

  it("announces it once: an alert this browser already fired is not repeated", () => {
    const fn = body.slice(body.indexOf("async function syncFiredFromServer"))
    expect(fn).toMatch(/const seen = new Set\(known\.map\(\(f\) => f\.id\)\)/)
    expect(fn).toMatch(/!seen\.has\(`\$\{r\.id\}:fired`\)/)
    expect(fn).toMatch(/if \(fresh\.length === 0\) return/)
  })

  it("stops watching an alert the server has already closed", () => {
    const fn = body.slice(body.indexOf("async function syncFiredFromServer"))
    expect(fn).toMatch(/const stillOpen = open\.filter\(\(a\) => !firedIds\.has\(a\.id\)\)/)
    expect(fn).toMatch(/writes\[PRICE_ALERTS_KEY\] = stillOpen/)
  })

  it("says nothing when it cannot reach the server, and nothing when signed out", () => {
    const fn = body.slice(body.indexOf("async function syncFiredFromServer"))
    expect(fn).toMatch(/if \(!auth\.currentUser\) return/)
    expect(fn.slice(0, fn.indexOf("if (rows.length === 0)"))).toMatch(/catch \{[\s\S]*?return\s*\}/)
  })
})
