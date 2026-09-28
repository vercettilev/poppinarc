import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  hostPrefersTab,
  noteAutoOpenCollapsed,
  noteCardWanted,
} from "./hostRest"

/**
 * The certainty gate answers "are we right about the page?"; this answers
 * "does this reader on this host still want the interruption?". Two
 * collapses of a self-opened card without a trade is the reader's answer.
 */
const store: Record<string, unknown> = {}
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: store[k] })),
        set: vi.fn(async (o: Record<string, unknown>) => {
          Object.assign(store, o)
        }),
      },
    },
  })
})

describe("per-host card fatigue", () => {
  it("two collapses rest the host; one does not", async () => {
    await noteAutoOpenCollapsed("dexscreener.com")
    expect(await hostPrefersTab("dexscreener.com")).toBe(false)
    await noteAutoOpenCollapsed("dexscreener.com")
    expect(await hostPrefersTab("dexscreener.com")).toBe(true)
    // Another host is unaffected: fatigue is not global.
    expect(await hostPrefersTab("pump.fun")).toBe(false)
  })

  it("wanting the card again clears the host", async () => {
    await noteAutoOpenCollapsed("dexscreener.com")
    await noteAutoOpenCollapsed("dexscreener.com")
    await noteCardWanted("dexscreener.com")
    expect(await hostPrefersTab("dexscreener.com")).toBe(false)
  })

  it("a broken storage keeps today's behaviour, never throws", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => {
            throw new Error("gone")
          }),
          set: vi.fn(async () => {
            throw new Error("gone")
          }),
        },
      },
    })
    await expect(noteAutoOpenCollapsed("x.com")).resolves.toBeUndefined()
    expect(await hostPrefersTab("x.com")).toBe(false)
  })
})
