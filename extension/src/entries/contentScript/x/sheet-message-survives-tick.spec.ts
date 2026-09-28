import { describe, expect, it } from "vitest"

/**
 * THE SAME SYMPTOM, THE SECOND CAUSE.
 *
 * "buy'a basıyorum hiçbir şey olmuyor" was reported once before and fixed
 * by making one helper own the message text and the row's visibility
 * together. It came back, from somewhere else: verdict() re-renders the
 * sheet on every price tick and ended with `msg.textContent = v.note ?? ""`,
 * so the outcome the reporter had just written was erased by the next tick.
 *
 * On a quiet token you read the message; on a busy one it was gone before
 * you looked, which is exactly the "bazen" in the report. This models that
 * ownership rule directly, because the real thing needs a live chip, a
 * shadow root and a price feed.
 */
function sheetLine() {
  let text = ""
  let claimed = false
  return {
    /** What an action writes: an outcome, or "" to hand the line back. */
    say(t: string) {
      text = t
      claimed = t !== ""
    },
    /** What every price tick writes. */
    tick(note: string | null) {
      if (!claimed) text = note ?? ""
    },
    /** A changed amount or a freshly opened sheet. */
    newIntent() {
      claimed = false
    },
    read: () => text,
  }
}

describe("the sheet's message line", () => {
  it("survives the price ticks that used to erase it", () => {
    const line = sheetLine()
    line.say("Buying…")
    line.tick(null)
    line.tick(null)
    line.tick(null)
    expect(line.read()).toBe("Buying…")
  })

  it("keeps a refusal on screen long enough to be read", () => {
    const line = sheetLine()
    line.say("The network refused the transaction")
    line.tick(null)
    expect(line.read()).toContain("refused")
  })

  it("hands the line back when the reader states a new intent", () => {
    // Otherwise the claim is permanent and the sheet can never speak again.
    const line = sheetLine()
    line.say("Didn't go through. Nothing was charged.")
    line.newIntent()
    line.tick("~0.4% price impact")
    expect(line.read()).toBe("~0.4% price impact")
  })

  it("lets the tick speak whenever no action owns the line", () => {
    const line = sheetLine()
    line.tick("$16.7M MC")
    expect(line.read()).toBe("$16.7M MC")
  })

  it("releases the claim when an action clears its own message", () => {
    const line = sheetLine()
    line.say("Buying…")
    line.say("")
    line.tick("back to normal")
    expect(line.read()).toBe("back to normal")
  })
})
