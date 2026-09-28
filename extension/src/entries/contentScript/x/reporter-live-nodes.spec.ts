import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * "I PRESS BUY AND NOTHING HAPPENS."
 *
 * Reported on 2026-09-11 and true: the trade ran, the answer was written,
 * and it was written somewhere the reader could not see.
 *
 * The reporter captured `.sheet .msg` and `.sheet .place` once, at the press.
 * The press is not when they are needed — a buy waits on a swap and then a
 * confirmation, up to thirty seconds, and this sheet does not survive thirty
 * seconds untouched: a price tick, a re-render, X recycling the cell
 * underneath it, and the nodes are replaced. The closure kept writing into
 * the ones it held, which by then were detached.
 *
 * Every guard passed, which is what made it invisible: a detached node still
 * has a parentElement, so `Boolean(msgEl?.parentElement)` was true and the
 * write went nowhere. The sheet the reader was looking at said nothing, the
 * button still read "Buy $10", and the trade had in fact been submitted.
 *
 * Pinned at the source because this is a LIFETIME rule, not a value: nothing
 * observable distinguishes "wrote to the live node" from "wrote to a detached
 * twin" except which node it was. Comments are stripped first — a guard its
 * own documentation can satisfy is not a guard.
 */
const src = readFileSync(
  join(__dirname, "xStrip.ts"),
  "utf8",
)
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

/** The reporter, from its signature to the end of its returned closure. */
const reporter = code.slice(
  code.indexOf("const reporter = ("),
  code.indexOf("const shareBtn = ("),
)

describe("the reporter writes to the sheet that is on screen", () => {
  it("looks the nodes up through a function, not a captured const", () => {
    expect(reporter).toMatch(/const findMsg = \(\) =>[\s\S]*?querySelector/)
    expect(reporter).toMatch(/const findBtn = \(\) =>[\s\S]*?querySelector/)
  })

  it("says what it has to say into a live lookup", () => {
    // `say` runs both at the press and at the outcome; only the second one
    // can meet a replaced sheet, and it must not write into the first one's.
    const say = reporter.slice(reporter.indexOf("const say = ("))
    expect(say.slice(0, 300)).toContain("findMsg()")
  })

  it("decides 'can I say this here' from the document, not from the press", () => {
    // The old test was Boolean(msgEl?.parentElement) — true for a detached
    // node, which is exactly how a real outcome went unseen.
    expect(reporter).toMatch(/const canSay = Boolean\(findMsg\(\)\?\.isConnected\)/)
    expect(reporter).not.toMatch(/const canSay = inSheet && Boolean\(msgEl\?\.parentElement\)/)
  })

  it("restores the button on the sheet that exists now", () => {
    expect(reporter).toMatch(/const liveBtn = findBtn\(\)/)
    expect(reporter).toMatch(/liveBtn\?\.isConnected/)
  })

  it("still uses the press-time capture for the busy state, which is synchronous", () => {
    // Nothing can have been replaced in the same tick as the press, and the
    // count-up has to start on the node the finger just touched.
    expect(reporter).toMatch(/if \(inSheet\) \{/)
    expect(reporter).toMatch(/countUp\(btnEl, busyUsd, "~"/)
  })
})
