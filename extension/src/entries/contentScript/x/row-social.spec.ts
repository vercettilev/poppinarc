import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const code = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
const host = readFileSync(join(__dirname, "../primary/main.tsx"), "utf8")

/**
 * WHAT THE ROW SAYS ABOUT PEOPLE.
 *
 * Two additions, both read off Fomo's own home screen: faces for who you
 * follow that is in an asset, and a line for what the tweet's author has
 * driven. Both are cheap to get wrong in ways no screenshot would show.
 */
/**
 * THE CROWD IS GONE FROM THE ROW, and the tests that held it are gone with
 * it rather than relaxed. The faces of people you follow who are in an
 * asset put a SECOND identity on a 38px row that already carries the
 * reader's own wallet key, with nothing saying which was which; the founder
 * read his own followed account as himself twice. Smaller, ringed and
 * counted did not fix it, so the idea left.
 *
 * entries/contentScript/x/crowd-is-not-an-identity.spec.ts is the guard
 * against it returning, including the per-page request that fed it.
 */

describe("the author line", () => {
  it("reports what the author DROVE, never what they hold", () => {
    // Publishing a named person's P&L needs a consent that does not exist
    // anywhere in this product. This is the aggregate the callers board
    // already computes and already publishes.
    expect(code).toMatch(/buyers/)
    expect(code).not.toMatch(/authorPnl|authorPosition|authorHolds/)
  })

  it("keeps the N>=3 floor even though the server applies it", () => {
    // Belt and braces on purpose: an aggregate of one names a person's
    // trade, and this is the surface where that would be published widest.
    expect(code).toMatch(/c\.buyers < 3/)
  })

  it("takes the handle from the permalink, the same capture the server groups by", () => {
    // If the two ends disagreed about what "the author" is, the line would
    // silently attach one account's record to another account's tweet.
    expect(code).toMatch(/x\|twitter\)\\\.com\\\/\(\[\^\/\?#\]\+\)\\\/status/i)
    expect(code).toMatch(/authorHandle\.toLowerCase\(\)/)
  })
})
