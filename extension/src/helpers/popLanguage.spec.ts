import { describe, expect, it } from "vitest"
import { handleOfSource, popCopy } from "./popLanguage"

/**
 * The tests that matter here are about the ONE sentence that can be a lie.
 * Everything else in this file is vocabulary; this is a claim about money.
 */
describe('"Nothing was charged." is earned, not default', () => {
  it("says it when nothing was ever broadcast", () => {
    expect(popCopy.ending("not-sent")).toBe("Didn't go through. Nothing was charged.")
  })

  it("says it when the chain itself reported failure", () => {
    expect(popCopy.ending("chain-failed")).toBe("Didn't go through. Nothing was charged.")
  })

  it("NEVER says it when settlement is merely unresolved", () => {
    // confirmAsset's own contract: "unknown means we stopped waiting, NOT
    // that it failed." A swap can still land after we look away.
    expect(popCopy.ending("pending")).not.toMatch(/nothing was charged/i)
    expect(popCopy.ending("pending")).not.toMatch(/didn't go through/i)
  })

  it("NEVER says it when we lost the transaction, and steers away from a retry", () => {
    const t = popCopy.ending("lost")
    expect(t).not.toMatch(/nothing was charged/i)
    // Retrying blind is how somebody buys twice.
    expect(t).toMatch(/history/i)
  })

  it("carries no code, no emoji and no exclamation in any ending", () => {
    for (const e of ["not-sent", "chain-failed", "pending", "lost"] as const) {
      const t = popCopy.ending(e)
      expect(t).not.toMatch(/!/)
      expect(t).not.toMatch(/\b(error|failed|code|0x)\b/i)
      expect(t).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    }
  })
})

describe("attribution", () => {
  it("reads the author out of a stored source url", () => {
    expect(handleOfSource("https://x.com/alldomains_/status/123")).toBe("alldomains_")
    expect(popCopy.from("alldomains_")).toBe("Popped from @alldomains_")
    expect(popCopy.from("@alldomains_")).toBe("Popped from @alldomains_")
  })

  it("returns null rather than inventing an author", () => {
    // A panel trade has no post behind it, and saying it came from someone
    // would attribute a person's own decision to a stranger.
    expect(handleOfSource(null)).toBeNull()
    expect(handleOfSource("")).toBeNull()
    expect(handleOfSource("https://poppin.so/token/abc")).toBeNull()
    // X's own paths are not people.
    expect(handleOfSource("https://x.com/i/status/123")).toBeNull()
  })
})
