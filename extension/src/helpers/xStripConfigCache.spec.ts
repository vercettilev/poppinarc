import { describe, expect, it } from "vitest"
import {
  isXStripConfig,
  X_STRIP_FAIL_CLOSED,
  type XStripConfig,
} from "./xStripConfigCache"

/**
 * THE KILL SWITCH MUST DEFAULT TO OFF (audit P2-28).
 *
 * initXStrip used to default to `enabled: true` when the config fetch threw,
 * so the one moment the switch mattered — the backend unreachable — was the
 * one moment it could not be used. These tests pin the two halves of the
 * replacement: the default is OFF, and a cached answer is only trusted when it
 * is actually the shape we wrote.
 */
describe("x-strip config cache", () => {
  it("fails CLOSED when there is no cached answer", () => {
    // If this ever flips to true, the remote kill switch stops existing for
    // any reader whose first strip boot cannot reach the backend.
    expect(X_STRIP_FAIL_CLOSED.enabled).toBe(false)
    expect(X_STRIP_FAIL_CLOSED.disabledMints).toEqual([])
  })

  it("accepts a well-formed cached config", () => {
    const cfg: XStripConfig = { enabled: true, disabledMints: ["mint1"] }
    expect(isXStripConfig(cfg)).toBe(true)
    expect(isXStripConfig({ enabled: false, disabledMints: [] })).toBe(true)
  })

  it("rejects anything that is not the shape we wrote", () => {
    // chrome.storage is untrusted input like any other: a partial or
    // hand-edited blob must not be able to turn the strip on.
    expect(isXStripConfig(null)).toBe(false)
    expect(isXStripConfig(undefined)).toBe(false)
    expect(isXStripConfig("enabled")).toBe(false)
    expect(isXStripConfig({})).toBe(false)
    expect(isXStripConfig({ enabled: true })).toBe(false)
    expect(isXStripConfig({ disabledMints: [] })).toBe(false)
    expect(isXStripConfig({ enabled: "yes", disabledMints: [] })).toBe(false)
    expect(isXStripConfig({ enabled: true, disabledMints: "none" })).toBe(false)
    expect(isXStripConfig({ enabled: true, disabledMints: [1, 2] })).toBe(false)
  })

  it("a rejected cache entry degrades to the fail-closed default", () => {
    // This is the composition the caller relies on:
    //   cfg = (cached if valid) ?? X_STRIP_FAIL_CLOSED
    const corrupt: unknown = { enabled: "true", disabledMints: [] }
    const resolved = isXStripConfig(corrupt) ? corrupt : X_STRIP_FAIL_CLOSED

    expect(resolved).toBe(X_STRIP_FAIL_CLOSED)
    expect((resolved as XStripConfig).enabled).toBe(false)
  })
})
