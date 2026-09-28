import { describe, expect, it } from "vitest"
import { BOOK_CACHE_MAX_AGE_MS, isFreshBook } from "./bookCache"

/**
 * The staleness rule. A warm start is only a gift while the book is
 * recognisably TODAY'S — beyond that, painting it is showing the reader a
 * portfolio that no longer exists.
 */
describe("what counts as warm", () => {
  it("accepts a recent write and refuses an ancient one", () => {
    expect(isFreshBook(1_000, 2_000)).toBe(true)
    expect(isFreshBook(0, BOOK_CACHE_MAX_AGE_MS)).toBe(false) // at=0 is "never"
    expect(isFreshBook(1, 2 + BOOK_CACHE_MAX_AGE_MS)).toBe(false)
  })

  it("sits exactly on the boundary rather than off by one", () => {
    expect(isFreshBook(1, 1 + BOOK_CACHE_MAX_AGE_MS)).toBe(true)
  })

  it("refuses garbage timestamps rather than warming off them", () => {
    expect(isFreshBook(NaN, 5)).toBe(false)
    expect(isFreshBook(-5, 5)).toBe(false)
  })
})
