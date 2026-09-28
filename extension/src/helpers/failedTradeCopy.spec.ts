import { describe, it, expect } from "vitest"
import { failedTradeCopy } from "./failedTradeCopy"

describe("failedTradeCopy", () => {
  it("tells a buyer their money did not move", () => {
    const c = failedTradeCopy("buy")
    expect(c.verb).toBe("Buy")
    expect(c.reassurance).toBe("Nothing was spent")
  })

  it("tells a seller they still hold it, not that nothing was spent", () => {
    const c = failedTradeCopy("sell")
    expect(c.verb).toBe("Sell")
    expect(c.reassurance).toBe("Nothing was sold")
  })

  it("names the state plainly and offers the way forward", () => {
    for (const side of ["buy", "sell"] as const) {
      const c = failedTradeCopy(side)
      expect(c.status).toBe("Didn't go through")
      expect(c.action).toBe("Try again")
    }
  })
})
