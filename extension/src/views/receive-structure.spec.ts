import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * A splice once landed the funding-hub door INSIDE the Copy button's JSX -
 * buttons nested in a button, the exchange sentence rendered mid-control,
 * and pressing the hub area also fired the copy. Shipped live before it
 * was seen. The hub door is gone (1.0.314), but the lesson stays: the
 * screen's rooms are pinned in order, structurally. Rails above the
 * address card, the watch below it, no button inside another.
 */
describe("receive's rooms stay separate", () => {
  it("one card in Blink's order, the watch below it, nothing nested", () => {
    const src = readFileSync(join(__dirname, "receive.tsx"), "utf8")
    const qr = src.indexOf("<QrCode")
    const copy = src.indexOf('aria-label="Copy address"')
    const or = src.indexOf(">\n                  OR\n")
    const blink = src.indexOf("<BlinkFund")
    const watch = src.indexOf("{(watching || extWatching) && (")
    // The card is one room in Blink's order: QR, the address pill, OR, the rails; the watch after it.
    expect(qr).toBeGreaterThan(0)
    expect(copy).toBeGreaterThan(qr)
    expect(or).toBeGreaterThan(copy)
    expect(blink).toBeGreaterThan(or)
    expect(watch).toBeGreaterThan(blink)
    // The legacy hub door and the exchange paragraph are gone for good.
    expect(src).not.toMatch(/THE HUB DOOR|Deposit from a wallet|No wallet\? Send USDC/)
    // And no button opens inside another button anywhere in the file.
    const buttons = [...src.matchAll(/component="button"/g)].map((m) => m.index)
    for (let i = 1; i < buttons.length; i++) {
      const between = src.slice(buttons[i - 1], buttons[i])
      expect(between).toMatch(/<\/Box>|<\/Typography>/)
    }
  })
})
