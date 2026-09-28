import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function tsFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (/\.tsx?$/.test(e.name) && !e.name.includes(".spec.")) out.push(p)
  }
  return out
}

/**
 * EVERY DOOR THAT BRINGS MONEY IN SAYS THE SAME VERB.
 *
 * The trade sheet, the front door's empty state, the profile's portfolio
 * card, the chip and the wallet screen all offer it. A reader who pressed
 * "Add cash" and landed on "Deposit USDC" has been handed two names for
 * one act; the chip's own button said a third thing, "Top up $22", and
 * said it only when a page wallet was present — so the verb switched on a
 * fact the reader cannot see (screenshots, 2026-09-20).
 *
 * THE FIRST VERSION OF THIS SWEEP WAS VACUOUS. It matched `>Top up<`,
 * which is JSX text, and the chip builds its buttons from a model and
 * `textContent`. It passed while the loudest button in the product said
 * the wrong word. A sweep that cannot see half the product is worse than
 * no sweep: it certifies the half it cannot see.
 */
const BANNED = /(["'`])\s*(Top up|Add cash|Add funds|Add money)\b/i

describe("every door that brings money in says the same verb", () => {
  it("looks at strings, not at JSX, so the chip is inside the sweep", () => {
    // A canary: the chip's label lives in a model, as a template literal.
    // If this stops matching, the sweep below has lost its reach.
    const model = stripComments(read("helpers/tradeSheetModel.ts"))
    expect(model).toMatch(/`Deposit \$\$\{topUpAmount\(shortBy, "cover"\)\}`/)
    expect(BANNED.test('label: `Top up $${x}`')).toBe(true)
    expect(BANNED.test('<span>Top up →</span>')).toBe(false) // JSX text is not a string
    expect(BANNED.test('"Deposit USDC"')).toBe(false)
  })

  it("has no surface anywhere calling it something else", () => {
    const offenders: string[] = []
    for (const file of tsFiles()) {
      const code = stripComments(readFileSync(file, "utf8"))
      for (const line of code.split("\n")) {
        if (BANNED.test(line)) offenders.push(`${file.slice(SRC.length + 1)}: ${line.trim()}`)
      }
      // And the JSX half, which the first version of this sweep covered.
      if (/>\s*(Add cash|Top up)\s*[›→]?\s*</.test(code)) {
        offenders.push(`${file.slice(SRC.length + 1)}: JSX text`)
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([])
  })

  it("names the room the way the room names itself", () => {
    expect(stripComments(read("views/receive.tsx"))).toMatch(/"Deposit USDC"/)
    for (const f of [
      // The front door's ask moved out of PopDoors' cash line and became a
      // door of its own (components/FundDoor.tsx); same room, same verb.
      "components/FundDoor.tsx",
      "components/TradeSheet.tsx",
      "components/profile/ProfilePortfolio.tsx",
      "components/SpotCard/TradePanel.tsx",
      "views/wallet-ui.tsx",
      "entries/contentScript/x/xStrip.ts",
    ]) {
      expect(stripComments(read(f)), f).toMatch(/Deposit USDC/)
    }
  })

  it("keeps the currency only where it is the instruction", () => {
    // The address screen asks the reader to CHOOSE what to send, so the
    // label names it. The page wallet already knows, and a longer button
    // buys nothing there.
    const model = stripComments(read("helpers/tradeSheetModel.ts"))
    expect(model).toMatch(/`Deposit \$\$\{topUpAmount\(shortBy, "cover"\)\} USDC`/)
    expect(model).toMatch(/"Deposit from wallet"/)
  })
})
