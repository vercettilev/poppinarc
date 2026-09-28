import { describe, expect, it } from "vitest"
import { qrPath } from "./QrCode"

/**
 * The deposit QR.
 *
 * A fake one shipped and survived: three CSS corner squares and a letter,
 * commented "Placeholder". Nothing caught it because nothing ever asked the
 * one question that matters — does the picture depend on the address?
 *
 * These are cheap tests for a screen where being wrong means somebody's money
 * goes to a stranger.
 */

const ADDR = "6Us6FZXx1bsSqzaRhLWyeortHW5dDjsQyKwNH9frTuDA"
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"

describe("the deposit QR", () => {
  it("DRAWS THE ADDRESS — a different address is a different symbol", () => {
    // The one assertion the fake could never have passed.
    expect(qrPath(ADDR).path).not.toBe(qrPath(OTHER).path)
  })

  it("is deterministic, so the same address always scans the same", () => {
    expect(qrPath(ADDR).path).toBe(qrPath(ADDR).path)
  })

  it("emits a real symbol, not a decoration", () => {
    const { path, count } = qrPath(ADDR)
    // A Solana address at error-correction H needs a version well past the
    // 21-module minimum, and the grid is always odd and square.
    expect(count).toBeGreaterThanOrEqual(25)
    expect(count % 2).toBe(1)
    // Every module is one rect; a symbol this size is hundreds of them, not
    // the four shapes the placeholder drew.
    const modules = path.match(/M\d+ \d+h1v1h-1z/g) ?? []
    expect(modules.length).toBeGreaterThan(200)
  })

  it("keeps every module inside the grid it declares", () => {
    // An off-by-one here puts ink in the quiet zone, which is the difference
    // between "scans on every phone" and "scans on mine".
    const { path, count } = qrPath(ADDR)
    for (const m of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      expect(Number(m[1])).toBeLessThan(count)
      expect(Number(m[2])).toBeLessThan(count)
    }
  })

  it("places the three finder patterns", () => {
    // Top-left, top-right, bottom-left. Their absence is the one defect a
    // human eye cannot spot but every scanner fails on.
    const { path, count } = qrPath(ADDR)
    const dark = new Set(
      [...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`),
    )
    const corners: Array<[number, number]> = [
      [0, 0],
      [count - 1, 0],
      [0, count - 1],
    ]
    for (const [x, y] of corners) expect(dark.has(`${x},${y}`)).toBe(true)
  })
})
