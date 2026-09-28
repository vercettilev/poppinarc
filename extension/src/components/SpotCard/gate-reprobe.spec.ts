import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The ladder must notice when the reader obeys it. The probe ran once at
 * mount, so the reader who pressed "Sign in to trade", signed in, and came
 * back faced the same gate until a full reload - the ladder punishing
 * exactly the reader who did what it asked. Source guards, because the flow
 * has no unit harness: they pin the three facts the fix is made of.
 */
const src = readFileSync(join(__dirname, "spotCardFlow.ts"), "utf8")

describe("the gate ladder re-probes on return", () => {
  it("a gate press arms the next visibility return", () => {
    expect(src).toMatch(/gatePressed = true/)
    expect(src).toMatch(/visibilitychange/)
    // And only an armed return probes: no polling, no free re-reads.
    expect(src).toMatch(/!gatePressed\) return/)
  })

  it("a funded answer lowers the wall instead of only ever raising it", () => {
    expect(src).toMatch(/card\.setGate\(null\)/)
  })

  it("the listener dies with the card", () => {
    expect(src).toMatch(/removeEventListener\("visibilitychange"/)
  })

  it("each door names its landing", () => {
    expect(src).toMatch(/dest === "feed"\) openFeedForPage/)
    expect(src).toMatch(/dest === "home"\) openMyPanel\(\)/)
  })
})
