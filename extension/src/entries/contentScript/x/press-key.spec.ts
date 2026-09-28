import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pressKey } from "./inlineBuy"

/**
 * ONE PRESS, ONE KEY — the thing the server's dedup is only as good as.
 *
 * Before this, no trade the extension sent carried a key at all, and the
 * server invented a random one PER REQUEST to satisfy a type. That is
 * precisely what lets a double-submit buy twice: two presses, two keys,
 * two trades. The comment above that fallback said it existed to prevent
 * exactly what it caused.
 */
describe("pressKey", () => {
  it("is different every call, because presses are", () => {
    // A key derived from the arguments (mint+amount+minute) would collapse
    // two deliberate $25 buys of one token into one trade.
    const keys = new Set(Array.from({ length: 200 }, () => pressKey()))
    expect(keys.size).toBe(200)
  })

  it("is long enough to be a key even without crypto", () => {
    const real = globalThis.crypto
    try {
      // Some content-script contexts have no crypto. Trading unprotected
      // is not the fallback; a weaker key is.
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true })
      const k = pressKey()
      expect(k.length).toBeGreaterThan(16)
      expect(pressKey()).not.toBe(k)
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true })
    }
  })
})

describe("every money press carries one", () => {
  const strip = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
  const inline = readFileSync(join(__dirname, "inlineBuy.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it("the buy mints it at the press handler", () => {
    expect(strip).toMatch(/idempotencyKey: pressKey\(\)/)
  })

  it("the sell mints it at the press handler", () => {
    expect(strip).toMatch(/deps\.sell\([^)]*pressKey\(\)\)/)
  })

  it("the order runner mints its own", () => {
    // Every caller of runInlineOrder is a press, so minting inside it means
    // one press cannot accidentally send two different keys.
    expect(inline).toMatch(/idempotencyKey: pressKey\(\)/)
  })

  it("never derives a key from the trade's own arguments", () => {
    // mint+amount+time looks stable and is: it makes two deliberate
    // identical buys indistinguishable, and the second one silently
    // returns the first one's receipt.
    for (const src of [strip, inline]) {
      expect(src).not.toMatch(/idempotencyKey:\s*`\$\{.*mint/)
      expect(src).not.toMatch(/idempotencyKey:\s*.*\bmint\s*\+/)
    }
  })
})
