import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * A POLL MUST GIVE UP BEFORE IT FIRES AGAIN.
 *
 * Seen in the extension's error list: "Failed to fetch notifications count:
 * timeout of 90000ms exceeded". The badge alarm runs every minute and the
 * shared axios client waits ninety seconds, so a slow answer was still
 * outstanding when the next request went out, and the two stacked.
 *
 * 90s is right for the client it belongs to: a swap broadcasts and waits
 * for the chain. It is not right for a number on a badge. The default is
 * deliberately untouched here, because shortening it globally would cut a
 * confirmation off mid-flight and leave a trade whose outcome we cannot
 * report. Reads are the safe half to fix.
 *
 * What this pins is the RELATIONSHIP, not the numbers: whatever the period
 * and the timeout become, the timeout has to be the smaller one.
 */
const SRC = readFileSync(join(__dirname, "main.ts"), "utf8")

function number(pattern: RegExp): number {
  const m = pattern.exec(SRC)
  if (!m?.[1]) throw new Error(`not found: ${pattern}`)
  return Number(m[1].replace(/_/g, ""))
}

describe("a background poll and its own clock", () => {
  it("gives up well before the badge alarm comes round again", () => {
    const periodMs = number(/periodInMinutes:\s*(\d+)/) * 60_000
    const timeoutMs = number(/NOTIFY_POLL_TIMEOUT_MS\s*=\s*([\d_]+)/)
    expect(timeoutMs).toBeLessThan(periodMs)
  })

  it("uses it on the read that was hanging", () => {
    // The background polls, named rather than counted: another one added
    // later should fail this and be looked at. The unread-count poll was
    // the first of the two and went with the inbox it counted — the badge
    // it painted had no destination and could never fall.
    expect(SRC).toMatch(
      /flywheel\/leaderboard[\s\S]{0,160}timeout: NOTIFY_POLL_TIMEOUT_MS/,
    )
    expect(SRC).not.toMatch(/notifications\/count/)
  })

  it("leaves the client default alone, because a swap needs it", () => {
    const axios = readFileSync(join(__dirname, "../../lib/axios.ts"), "utf8")
    expect(axios).toMatch(/timeout:\s*90000/)
  })
})
