import { describe, expect, it } from "vitest"
import { fee, units } from "./RoutePreview"

describe("the route card's numbers", () => {
  it("print whole units the way a person reads them", () => {
    expect(units(0.210536304)).toBe("0.2105")
    expect(units(31.0245)).toBe("31.02")
    expect(units(1204.6)).toBe("1,205")
    expect(units(0.0000123456)).toBe("0.00001235")
    expect(units(0)).toBe("0")
  })

  it("say a free leg is free and a tiny fee is tiny", () => {
    expect(fee(0)).toBe("free")
    expect(fee(0.002)).toBe("under 1¢")
    expect(fee(1.36)).toBe("$1.36")
    expect(fee(null)).toBe("")
  })
})
