import { describe, expect, it } from "vitest"
import { terminalStage } from "./telemetryStage"

describe("the terminal stage a trade event also records", () => {
  it("files a landed trade as confirmed, on top of submitted", () => {
    // The funnel read 26 sent / 0 landed on a day with receipts on screen.
    expect(terminalStage("swap_submitted", { kind: "done" })).toBe("swap_confirmed")
  })

  it("files a refused trade as failed", () => {
    expect(terminalStage("swap_submitted", { kind: "error" })).toBe("swap_failed")
  })

  it("claims nothing for a trade still in the air", () => {
    // Neither "landed" nor "failed" is honest for a pending settlement, and
    // the receipt's own rule is that unknown is not failed.
    expect(terminalStage("swap_submitted", { kind: "pending" })).toBeUndefined()
  })

  it("claims nothing for a dry run, which bought nothing", () => {
    expect(terminalStage("swap_submitted", { kind: "info" })).toBeUndefined()
  })

  it("only ever adds to a trade event, never to an impression", () => {
    expect(terminalStage("card_shown", { kind: "done" })).toBeUndefined()
    expect(terminalStage(undefined, { kind: "done" })).toBeUndefined()
  })

  it("survives a payload with no kind, or no payload at all", () => {
    expect(terminalStage("swap_submitted", {})).toBeUndefined()
    expect(terminalStage("swap_submitted", undefined)).toBeUndefined()
    expect(terminalStage("swap_submitted", null)).toBeUndefined()
  })
})
