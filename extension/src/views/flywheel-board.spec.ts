import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
/** Comments are where the history lives; the words readers see are the rest. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the board tells no lies about money", () => {
  const f = stripComments(read("views/FlywheelLeaderboard.tsx"))

  it("promises no cash reward that is not built", () => {
    expect(f).not.toMatch(/[Cc]ash rewards?/)
  })

  it("draws a podium only with three people on it", () => {
    expect(f).toMatch(/const showPodium = rows\.length >= 3/)
    expect(f).toMatch(/\{i \+ \(showPodium \? 4 : 1\)\}/)
  })

  it("says so when the viewer has no rank instead of inventing one", () => {
    expect(f).toMatch(/not on the board yet/)
    expect(f).toMatch(/data\?\.viewerRank != null &&/)
  })

  it("the Trade door opens where trades happen, not the social feed", () => {
    expect(f).toMatch(/label: "Trade", value: "1pt \/ \$1", to: "\/discover"/)
  })

  it("v2: friends are a share of their volume, being early is a seat, nothing social", () => {
    expect(f).toMatch(/label: "Bring a friend", value: "\+20%"/)
    expect(f).toMatch(/label: "Be early", value: "×2"/)
    expect(f).not.toMatch(/Share a trade/)
    expect(f).toMatch(/Your invites/)
    expect(f).toMatch(/seats left/)
    // The pool line exists only when the pool is above zero.
    expect(f).toMatch(/data\.pool\.poolUsd > 0 &&/)
  })

  it("v2.1: the race is said in dollars, and nothing mentions a streak", () => {
    expect(f).toMatch(/more to pass @/)
    expect(f).toMatch(/Leading by/)
    expect(f).not.toMatch(/Trade often/)
    expect(f).not.toMatch(/active days/)
  })

  it("keeps em dashes out of the words readers see", () => {
    expect(f).not.toMatch(/—/)
  })
})
