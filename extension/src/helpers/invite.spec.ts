import { describe, expect, it } from "vitest"
import { earnedText, inviteLink, joinedText } from "./invite"

describe("the invite words", () => {
  it("builds the join link from the code", () => {
    expect(inviteLink("JQUBIQ")).toBe("https://poppin.so/join/JQUBIQ")
  })
  it("shows earnings only from a dollar up", () => {
    expect(earnedText(0)).toBe("nothing earned yet")
    expect(earnedText(0.42)).toBe("nothing earned yet")
    expect(earnedText(1)).toBe("$1.00 earned")
    expect(earnedText(4.2)).toBe("$4.20 earned")
  })
  it("counts the joined", () => {
    expect(joinedText(0)).toBe("0 joined")
    expect(joinedText(7)).toBe("7 joined")
  })
})
