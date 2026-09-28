import { afterEach, describe, expect, it, vi } from "vitest"
import { arcNetworkFrom, capabilitiesFor, type Capabilities } from "./edition"

/**
 * THE STORE BUILD MUST NOT MOVE. With the flag unset every capability is on,
 * whatever else the env says; with it set, only what arc-api serves is on.
 */
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const ALL_KEYS: Array<keyof Capabilities> = [
  "telemetry",
  "sitePresence",
  "gamification",
  "social",
  "autoPost",
  "discover",
  "orderWatch",
  "alertsMirror",
  "ticks",
  "depositWatch",
  "solanaRails",
  "feeLines",
  "keyExport",
]

describe("the edition flag", () => {
  it("is off unless the build says exactly \"true\"", async () => {
    const { ARC_EDITION, CAP } = await import("./edition")
    expect(ARC_EDITION).toBe(false)
    for (const k of ALL_KEYS) expect(CAP[k]).toBe(true)
  })

  it("is on in an Arc build, and the capabilities follow it", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "true")
    vi.resetModules()
    const { ARC_EDITION, CAP } = await import("./edition")
    expect(ARC_EDITION).toBe(true)
    for (const k of ALL_KEYS) expect(CAP[k]).toBe(false)
  })

  it("reads anything but \"true\" as the store", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "TRUE")
    vi.resetModules()
    const { ARC_EDITION } = await import("./edition")
    expect(ARC_EDITION).toBe(false)
  })

  it("lets an Arc build opt into the deposit feed and the ticks socket by env", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "true")
    vi.stubEnv("NEXT_PUBLIC_ARC_TICKS", "true")
    vi.stubEnv("NEXT_PUBLIC_ARC_DEPOSIT_WATCH", "true")
    vi.resetModules()
    const { CAP } = await import("./edition")
    expect(CAP.ticks).toBe(true)
    expect(CAP.depositWatch).toBe(true)
    expect(CAP.telemetry).toBe(false)
  })
})

describe("capabilitiesFor", () => {
  it("gives the store everything, and ignores the opt-ins", () => {
    const store = capabilitiesFor(false, { ticks: "false", depositWatch: "false" })
    for (const k of ALL_KEYS) expect(store[k]).toBe(true)
  })

  it("gives the Arc edition nothing arc-api does not serve", () => {
    const arc = capabilitiesFor(true)
    for (const k of ALL_KEYS) expect(arc[k]).toBe(false)
    expect(capabilitiesFor(true, { ticks: "true" }).ticks).toBe(true)
    expect(capabilitiesFor(true, { depositWatch: "yes" }).depositWatch).toBe(false)
  })
})

describe("the Arc network", () => {
  it("is testnet unless the build says mainnet", async () => {
    expect(arcNetworkFrom(undefined)).toBe("testnet")
    expect(arcNetworkFrom("testnet")).toBe("testnet")
    expect(arcNetworkFrom("Mainnet")).toBe("testnet")
    expect(arcNetworkFrom("mainnet")).toBe("mainnet")
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "mainnet")
    vi.resetModules()
    const { ARC_NETWORK } = await import("./edition")
    expect(ARC_NETWORK).toBe("mainnet")
  })
})
