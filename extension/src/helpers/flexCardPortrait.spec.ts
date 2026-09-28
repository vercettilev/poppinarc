import { describe, it, expect } from "vitest"
import { flexParts } from "./flexCard"
import { drawFlexCard, evidenceRow, flexPortraitModel, heroPercent } from "./flexCardPortrait"

/** A context that records what was written, so the card's words can be read. */
function recordingCtx() {
  const texts: string[] = []
  const grad = { addColorStop: () => {} }
  const ctx = {
    texts,
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 0,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: () => {},
    fillText: (t: string) => void texts.push(t),
    measureText: (t: string) => ({ width: t.length * 20 }),
    beginPath: () => {},
    moveTo: () => {},
    arcTo: () => {},
    arc: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: () => {},
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
  }
  return ctx
}

const open = () =>
  flexParts({ ticker: "SOL", uiAmount: 0.176, priceUsd: 187.42, avgEntryPriceUsd: 142 })!

describe("heroPercent", () => {
  it("drops the decimal once the number is big enough to carry itself", () => {
    expect(heroPercent(32.01)).toBe("+32%")
    expect(heroPercent(412.4)).toBe("+412%")
  })
  it("keeps one decimal for a small move, where it is most of the story", () => {
    expect(heroPercent(4.24)).toBe("+4.2%")
  })
  it("groups the thousands of a moonshot", () => {
    expect(heroPercent(1240)).toBe("+1,240%")
  })
})

describe("flexPortraitModel", () => {
  it("leads an open gain with the PERCENT and keeps the dollars as evidence", () => {
    const m = flexPortraitModel("SOL", open())!
    expect(m.hero).toBe("+32%")
    expect(m.badge).toBe("POPPED")
    expect(m.subline).toBe("on $SOL · still holding")
    expect(m.stats.map((s) => s.label)).toEqual(["IN", "NOW", "PROFIT"])
    expect(m.stats[0].value).toBe("$24.99")
    expect(m.stats[1].value).toBe("$32.99")
    // The difference of the two printed numbers, so the row adds up.
    expect(m.stats[2].value).toBe("+$8.00")
  })

  it("drops the cents where they no longer carry weight", () => {
    const big = flexParts({ ticker: "WIF", uiAmount: 1000, priceUsd: 10.437, avgEntryPriceUsd: 2.04 })!
    const m = flexPortraitModel("WIF", big)!
    expect(m.stats[0].value).toBe("$2,040")
    expect(m.stats[2].value).toBe("+$8,397")
  })

  it("credits the caller whose tweet it was", () => {
    const p = flexParts({
      ticker: "SOL",
      uiAmount: 1,
      priceUsd: 2,
      avgEntryPriceUsd: 1,
      callerSourceUrl: "https://x.com/Trader_XO/status/123",
    })!
    expect(flexPortraitModel("SOL", p)!.subline).toBe("on $SOL · still holding · via @Trader_XO")
  })

  it("banks a closed win in dollars, with no percent and no row to invent", () => {
    const closed = flexParts({ ticker: "SOL", uiAmount: 0, priceUsd: 187, realizedPnlUsd: 7.99 })!
    const m = flexPortraitModel("SOL", closed)!
    expect(m.badge).toBe("BANKED")
    expect(m.hero).toBe("+$7.99")
    expect(m.stats).toEqual([])
  })

  it("answers nothing for a loss, which keeps the honest red landscape card", () => {
    const down = flexParts({ ticker: "SOL", uiAmount: 1, priceUsd: 90, avgEntryPriceUsd: 100 })!
    expect(flexPortraitModel("SOL", down)).toBeNull()
  })
})

describe("evidenceRow", () => {
  it("adds up as printed, even where separate rounding would drift a cent", () => {
    for (const [a, b] of [[24.992, 32.98592], [0.1049, 0.2951], [1999.6, 2500.4], [999.995, 1000.004]]) {
      const r = evidenceRow(a, b)
      expect(Math.round((r.cost + r.profit) * 100)).toBe(Math.round(r.value * 100))
    }
  })
})

describe("drawFlexCard", () => {
  it("writes the person, the badge, the number and the evidence", () => {
    const ctx = recordingCtx()
    drawFlexCard(ctx as never, flexPortraitModel("SOL", open())!, { handle: "lev" })
    expect(ctx.texts).toEqual(
      expect.arrayContaining(["@", "lev", "POPPED", "+32%", "on $SOL · still holding", "$24.99", "+$8.00", "poppin.so/@lev"]),
    )
  })

  it("signs as poppin.so and draws no pill when there is no handle", () => {
    const ctx = recordingCtx()
    drawFlexCard(ctx as never, flexPortraitModel("SOL", open())!, { handle: null })
    expect(ctx.texts).toContain("poppin.so")
    expect(ctx.texts).not.toContain("@")
  })
})
