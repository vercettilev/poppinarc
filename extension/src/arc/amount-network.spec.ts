import { describe, expect, it } from "vitest"
import { cleanAmountInput, parseAmount } from "./AmountPicker"
import { depositPlaces, placeHint, placeInstruction } from "./NetworkSelect"

/**
 * The Add money screen's two choices: any amount (not only the three
 * shortcuts), and the network, Arc first, each with the sentence that says
 * what happens to money sent there.
 */
describe("typing an amount", () => {
  it("keeps digits and one point with two decimals", () => {
    expect(cleanAmountInput("75")).toBe("75")
    expect(cleanAmountInput("$1,250.999")).toBe("1250.99")
    expect(cleanAmountInput("12.3.4")).toBe("12.34")
    expect(cleanAmountInput("abc")).toBe("")
    expect(cleanAmountInput("123456789")).toBe("1234567")
  })

  it("is a number only when it is a positive amount", () => {
    expect(parseAmount("75")).toBe(75)
    expect(parseAmount("12.5")).toBe(12.5)
    expect(parseAmount("12.")).toBe(12)
    expect(parseAmount("0")).toBeNull()
    expect(parseAmount("")).toBeNull()
    expect(parseAmount(".")).toBeNull()
  })
})

describe("the network", () => {
  const ARC = "0xcf158f2d0bb2000000000000000000000e4a284a2"
  const others = [
    { network: "Solana", address: "So1AnaAddrCaseMatters1111111111111111111111", minUsdc: "5" },
    { network: "Base", address: "0x0000000000000000000000000000000000000b45", minUsdc: "1" },
    { network: "Polygon", address: "0x0000000000000000000000000000000000000909" },
  ]

  it("puts Arc first, then the server's order", () => {
    expect(depositPlaces(ARC, others).map((p) => p.network)).toEqual(["Arc", "Solana", "Base", "Polygon"])
    expect(depositPlaces("", others)).toEqual([])
  })

  it("says what happens to money sent on each", () => {
    const [arc, sol, , poly] = depositPlaces(ARC, others)
    expect(placeInstruction(arc!, 25)).toBe("Send 25 USDC on Arc. It's ready the moment it lands.")
    expect(placeInstruction(sol!, 100)).toBe("Send 100 USDC on Solana. From 5 USDC, it moves to your balance on its own.")
    expect(placeInstruction(poly!, 12.5)).toBe("Send 12.5 USDC on Polygon. It moves to your balance on its own.")
    expect(placeHint(arc!)).toBe("Straight to your balance")
    expect(placeHint(sol!)).toBe("From 5 USDC, moved to your balance for you")
  })
})
