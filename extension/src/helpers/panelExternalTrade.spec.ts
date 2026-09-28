import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tradeViaPage } from "./panelExternalTrade"

type G = { chrome?: unknown }
const g = globalThis as unknown as G
let answer: unknown

beforeEach(() => {
  answer = undefined
  g.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn((_msg: unknown, cb: (r: unknown) => void) => cb(answer)),
    },
  }
})
afterEach(() => {
  delete g.chrome
})

describe("a trade asked from the panel", () => {
  it("resolves with the page's receipt, and a sell's USDC out", async () => {
    answer = { ok: true, result: { signature: "s", dryRun: false, category: "meme", outAmountRaw: "42", shareUrl: null } }
    const r = await tradeViaPage({ side: "sell", mint: "M", amountRaw: "1" })
    expect(r.signature).toBe("s")
    expect(r.outUsdcRaw).toBe("42")
  })

  it("rejects with the page's sentence when it could not sign", async () => {
    answer = { ok: false, error: "Closed in Phantom before signing." }
    await expect(tradeViaPage({ side: "buy", mint: "M", amountUsd: 5 })).rejects.toThrow(/Closed in Phantom/)
  })

  it("rejects with a sentence when nothing answered at all", async () => {
    answer = undefined
    await expect(tradeViaPage({ side: "buy", mint: "M", amountUsd: 5 })).rejects.toThrow(/did not answer/)
  })
})
