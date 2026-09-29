import { describe, expect, it } from "vitest"
import { cleanAmountInput, parseAmount } from "./AmountPicker"
import { depositPlaces, landingLine, placeInstruction, sendLine } from "./NetworkSelect"

/**
 * The Add money screen's two choices: any amount (not only the three
 * shortcuts), and the network, Arc first, with one sentence under the
 * address saying what happens to money sent there.
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
    expect(placeInstruction(sol!, 100)).toBe("Send 100 USDC on Solana. We'll move it to your balance.")
    expect(placeInstruction(poly!, 12.5)).toBe("Send 12.5 USDC on Polygon. We'll move it to your balance.")
    expect(landingLine(arc!)).toBe("It's ready the moment it lands.")
  })

  it("names a network's smallest amount only while the amount is under it", () => {
    const [arc, sol, base] = depositPlaces(ARC, others)
    expect(sendLine(sol!, 2)).toBe("Send at least 5 USDC on Solana")
    expect(sendLine(sol!, undefined)).toBe("Send at least 5 USDC on Solana")
    expect(sendLine(sol!, 5)).toBe("Send 5 USDC on Solana")
    expect(sendLine(base!, 1)).toBe("Send 1 USDC on Base")
    expect(sendLine(arc!, 0.5)).toBe("Send 0.5 USDC on Arc")
    expect(sendLine(arc!, undefined)).toBe("Send USDC on Arc")
  })
})
