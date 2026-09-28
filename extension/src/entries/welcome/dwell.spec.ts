import { describe, it, expect } from "vitest"
import { dueMarks, DWELL_MARKS } from "./dwell"

describe("dueMarks", () => {
  it("says nothing before the first mark", () => {
    expect(dueMarks(4_999, new Set())).toEqual([])
  })

  it("fires every mark the visit has passed, not just the newest", () => {
    // A tab restored from sleep can jump past several marks at once, and
    // dropping the ones it skipped would lose the dwell entirely.
    expect(dueMarks(70_000, new Set())).toEqual([5, 15, 60])
  })

  it("never repeats a mark already sent", () => {
    expect(dueMarks(70_000, new Set([5, 15]))).toEqual([60])
    expect(dueMarks(70_000, new Set([5, 15, 60]))).toEqual([])
  })

  it("stops at the last mark, so one step cannot flood the stream", () => {
    expect(dueMarks(60 * 60 * 1000, new Set())).toEqual([...DWELL_MARKS])
  })

  it("treats a broken clock as no information rather than as a dwell", () => {
    expect(dueMarks(Number.NaN, new Set())).toEqual([])
    expect(dueMarks(-1, new Set())).toEqual([])
  })
})
