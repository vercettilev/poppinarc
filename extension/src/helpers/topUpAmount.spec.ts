import { describe, expect, it } from "vitest"
import { topUpAmount } from "./topUpAmount"

describe("what a page wallet is asked to move", () => {
  it("a shortfall is rounded up past itself, so a price tick cannot undo the top-up", () => {
    expect(topUpAmount(41.45, "cover")).toBe(42)
    expect(topUpAmount(25, "cover")).toBe(25)
    expect(topUpAmount(4.37, "cover")).toBe(5)
  })

  it("a deposit size the reader picked is moved as named", () => {
    // The fund box says "$50"; the wallet popup used to say 51.
    expect(topUpAmount(50, "exact")).toBe(50)
    expect(topUpAmount(25, "exact")).toBe(25)
    expect(topUpAmount(100, "exact")).toBe(100)
  })

  it("never below the funding route's floor, and a missing figure gets the old default", () => {
    expect(topUpAmount(2, "exact")).toBe(5)
    expect(topUpAmount(undefined, "cover")).toBe(10)
    expect(topUpAmount(undefined, "exact")).toBe(10)
    expect(topUpAmount(Number.NaN, "cover")).toBe(10)
  })
})
