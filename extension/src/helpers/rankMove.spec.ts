import { describe, expect, it } from "vitest"
import { rankMove } from "./rankMove"

const NOW = Date.UTC(2026, 8, 8, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

describe("rankMove", () => {
  it("says nothing on a first sighting, and seeds", () => {
    // With nothing stored we cannot tell a rise from a fall, and "you
    // passed 6 people" to somebody who has always been seventh is a lie
    // that flatters.
    const v = rankMove(NOW, 7, null)
    expect(v?.say).toBeNull()
    expect(v?.memory).toEqual({ rank: 7, spokeAt: 0 })
  })

  it("speaks for a real climb", () => {
    const v = rankMove(NOW, 4, { rank: 7, spokeAt: 0 })
    expect(v?.say).toBe("You passed 3 people — now #4")
    expect(v?.memory.spokeAt).toBe(NOW)
  })

  it("stays quiet for a single place", () => {
    // A board moves on its own as other people trade. One place is noise.
    expect(rankMove(NOW, 6, { rank: 7, spokeAt: 0 })?.say).toBeNull()
  })

  it("never announces a fall", () => {
    // Being told you dropped four places is a punishment for opening an
    // app. The board still shows the truth; only the interruption is
    // one-way.
    expect(rankMove(NOW, 11, { rank: 7, spokeAt: 0 })?.say).toBeNull()
  })

  it("moves the baseline even when it says nothing", () => {
    // Or the next small climb is measured against a place they no longer
    // hold, and reads as bigger than it was.
    const v = rankMove(NOW, 11, { rank: 7, spokeAt: 0 })
    expect(v?.memory.rank).toBe(11)
    // And the climb from THERE is measured honestly.
    expect(rankMove(NOW, 8, v!.memory)?.say).toBe("You passed 3 people — now #8")
  })

  it("speaks at most once a day", () => {
    const spoke = { rank: 20, spokeAt: NOW - 1000 }
    expect(rankMove(NOW, 4, spoke)?.say).toBeNull()
    expect(rankMove(NOW + DAY, 4, { rank: 20, spokeAt: NOW })?.say).toBe(
      "You passed 16 people — now #4",
    )
  })

  it("has nothing to say about an unranked reader", () => {
    expect(rankMove(NOW, null, null)).toBeNull()
    expect(rankMove(NOW, 0, { rank: 7, spokeAt: 0 })).toBeNull()
  })
})
