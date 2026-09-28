import { describe, expect, it } from "vitest"
import { isClientError, shouldRetryQuery } from "./queryRetry"

describe("shouldRetryQuery", () => {
  it("never retries a rate limit", () => {
    // The whole point. Retrying a 429 is the one case where asking again
    // is guaranteed to make the situation worse for the asker.
    expect(shouldRetryQuery(0, { response: { status: 429 } })).toBe(false)
  })

  it("never retries any other answer the server gave", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetryQuery(0, { response: { status } })).toBe(false)
    }
  })

  it("retries what nobody answered, twice", () => {
    const down = { response: { status: 503 } }
    expect(shouldRetryQuery(0, down)).toBe(true)
    expect(shouldRetryQuery(1, down)).toBe(true)
    expect(shouldRetryQuery(2, down)).toBe(false)
  })

  it("retries a dead socket, which carries no status at all", () => {
    expect(shouldRetryQuery(0, new Error("Network Error"))).toBe(true)
  })

  it("reads both shapes a failure arrives in", () => {
    expect(isClientError({ response: { status: 429 } })).toBe(true)
    expect(isClientError({ status: 429 })).toBe(true)
    expect(isClientError({ status: 500 })).toBe(false)
    expect(isClientError(null)).toBe(false)
    expect(isClientError("429")).toBe(false)
  })
})
