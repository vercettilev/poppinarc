import { describe, expect, it } from "vitest"
import { ordersFor, ordersRender } from "./openOrdersView"

const WIF = { mint: "MINT_WIF", orderKey: "a" }
const BONK = { mint: "MINT_BONK", orderKey: "b" }

describe("which orders belong on a surface", () => {
  it("narrows to the asset a surface is about", () => {
    expect(ordersFor([WIF, BONK], "MINT_WIF")).toEqual([WIF])
  })

  it("shows the whole book where the reader is the subject", () => {
    expect(ordersFor([WIF, BONK])).toEqual([WIF, BONK])
  })

  it("keeps 'still asking' distinct from 'none', filtered or not", () => {
    expect(ordersFor(null, "MINT_WIF")).toBeNull()
    expect(ordersFor(null)).toBeNull()
    // An asset with no orders is empty, not unknown.
    expect(ordersFor([BONK], "MINT_WIF")).toEqual([])
  })
})

describe("what to draw", () => {
  it("draws nothing at all while the answer is in flight", () => {
    // The failure this prevents: "No standing orders" printed over an order
    // that exists, on the screen somebody opened to check on it.
    expect(ordersRender(null, true)).toEqual({ kind: "nothing" })
    expect(ordersRender(null, false)).toEqual({ kind: "nothing" })
  })

  it("says none only where somebody went looking", () => {
    expect(ordersRender([], true)).toEqual({ kind: "empty-line" })
    expect(ordersRender([], false)).toEqual({ kind: "nothing" })
  })

  it("draws the list whenever there is one, everywhere", () => {
    expect(ordersRender([WIF], false)).toEqual({ kind: "list" })
    expect(ordersRender([WIF], true)).toEqual({ kind: "list" })
  })
})
