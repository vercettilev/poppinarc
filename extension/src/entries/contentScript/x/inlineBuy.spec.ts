import { describe, expect, it, vi } from "vitest"
import {
  runInlineBuy,
  runInlineOrder,
  type InlineBuyServices,
  type InlineOrderServices,
} from "./inlineBuy"

/**
 * The inline buy's honesty table. Every row here was paid for on the card or
 * the panel before this module existed; a third money surface exists only on
 * the condition that it inherits them exactly.
 */

const ARGS = { mint: "M1", usd: 25, symbol: "WIF", decimals: 6 }

function services(over?: Partial<InlineBuyServices>): InlineBuyServices {
  return {
    swap: vi.fn(async () => ({ signature: "sig", dryRun: false, outAmountRaw: "12400000" })),
    confirm: vi.fn(async () => ({ status: "confirmed" as const })),
    ...over,
  }
}

describe("runInlineBuy", () => {
  it("a confirmed buy names what was bought, and carries its receipt", async () => {
    // The signature and size ride along so a caller can put the trade on
    // the feed without re-deriving what it just watched happen.
    const out = await runInlineBuy(services(), ARGS)
    expect(out).toEqual({
      kind: "done",
      text: "Bought 12.4 WIF",
      signature: "sig",
      tokens: 12.4,
    })
  })

  it("dry run says so out loud, never dressed as a purchase", async () => {
    const out = await runInlineBuy(
      services({ swap: async () => ({ signature: "s", dryRun: true, outAmountRaw: "0" }) }),
      ARGS,
    )
    expect(out.kind).toBe("info")
    expect(out.text).toContain("Dry run")
    expect(out.text).toContain("nothing bought")
  })

  it("unknown settlement is not failure — it is pending", async () => {
    const out = await runInlineBuy(
      services({ confirm: async () => ({ status: "unknown" as const }) }),
      ARGS,
    )
    expect(out.kind).toBe("pending")
    expect(out.text).toContain("confirming")
  })

  it("an unreachable confirm is ALSO pending — the trade may have landed", async () => {
    const out = await runInlineBuy(
      services({
        confirm: async () => {
          throw new Error("socket hangup")
        },
      }),
      ARGS,
    )
    expect(out.kind).toBe("pending")
  })

  it("chain rejection is the one honest failure", async () => {
    const out = await runInlineBuy(
      services({ confirm: async () => ({ status: "failed" as const }) }),
      ARGS,
    )
    expect(out).toEqual({ kind: "error", text: "The transaction failed on chain" })
  })

  it("401 is an auth answer with a door, not an error string", async () => {
    const out = await runInlineBuy(
      services({
        swap: async () => {
          throw Object.assign(new Error("unauthorized"), { status: 401 })
        },
      }),
      ARGS,
    )
    expect(out).toEqual({ kind: "error", text: "Sign in to trade", action: "signin" })
  })

  it("insufficient balance names the fix", async () => {
    const out = await runInlineBuy(
      services({
        swap: async () => {
          throw new Error("Insufficient balance: wallet holds 0")
        },
      }),
      ARGS,
    )
    expect(out.kind).toBe("error")
    expect((out as { action?: string }).action).toBe("topup")
  })

  it("any other build failure carries the server's short reason", async () => {
    const out = await runInlineBuy(
      services({
        swap: async () => {
          throw new Error("Route not found for this size")
        },
      }),
      ARGS,
    )
    expect(out).toEqual({ kind: "error", text: "Route not found for this size" })
  })

  it("unknown decimals never invent an amount", async () => {
    const out = await runInlineBuy(services(), { ...ARGS, decimals: null })
    // Zero tokens, not a guessed number: the receipt may be silent about
    // a size it cannot compute, never wrong about it.
    expect(out).toEqual({
      kind: "done",
      text: "Bought WIF",
      signature: "sig",
      tokens: 0,
    })
  })
})

/** The order leg reads the same table; these rows are the ones it adds. */
function orderServices(over?: Partial<InlineOrderServices>): InlineOrderServices {
  return {
    createOrder: async () => ({ orderKey: "OK1", signature: "sig", dryRun: false }),
    confirm: async () => ({ status: "confirmed" as const }),
    ...over,
  }
}

const ORDER_ARGS = { mint: "M", usd: 25, triggerPriceUsd: 0.18, priceText: "$0.18" }

describe("runInlineOrder", () => {
  it("lands as a promise about the fill, not a claim of a purchase", async () => {
    const out = await runInlineOrder(orderServices(), ORDER_ARGS)
    expect(out).toEqual({ kind: "done", text: "Order in · fills at $0.18 or better · open until you cancel it" })
  })

  it("dry run says so and claims nothing was placed", async () => {
    const out = await runInlineOrder(
      orderServices({
        createOrder: async () => ({ orderKey: "OK1", signature: "", dryRun: true }),
      }),
      ORDER_ARGS,
    )
    expect(out.kind).toBe("info")
    expect(out.text).toMatch(/nothing placed/)
  })

  it("401 is an auth answer with the sign-in action", async () => {
    const out = await runInlineOrder(
      orderServices({
        createOrder: async () => {
          throw Object.assign(new Error("unauthorized"), { status: 401 })
        },
      }),
      ORDER_ARGS,
    )
    expect(out).toMatchObject({ kind: "error", action: "signin" })
  })

  it("an unreachable confirm is pending, never failed", async () => {
    const out = await runInlineOrder(
      orderServices({
        confirm: async () => {
          throw new Error("rpc down")
        },
      }),
      ORDER_ARGS,
    )
    expect(out.kind).toBe("pending")
  })

  it("a failed placement transaction is named as such", async () => {
    const out = await runInlineOrder(
      orderServices({ confirm: async () => ({ status: "failed" as const }) }),
      ORDER_ARGS,
    )
    expect(out).toMatchObject({ kind: "error" })
    expect(out.text).toMatch(/failed on chain/)
  })
})
