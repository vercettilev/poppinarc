import { describe, expect, it } from "vitest"
import { isRateLimited } from "./rateLimited"

describe("isRateLimited", () => {
  it("reads the axios shape, which is how the panel's queries fail", () => {
    expect(isRateLimited({ response: { status: 429 } })).toBe(true)
    expect(isRateLimited({ response: { status: 500 } })).toBe(false)
    expect(isRateLimited({ response: { status: 401 } })).toBe(false)
  })

  it("reads a bare status too", () => {
    expect(isRateLimited({ status: 429 })).toBe(true)
    expect(isRateLimited({ status: 404 })).toBe(false)
  })

  it("recognises the exact sentence that reached the panel", () => {
    // What a reader actually saw on 2026-09-24, once the message was all
    // that survived the trip across the extension port.
    expect(
      isRateLimited(new Error("ThrottlerException: Too Many Requests")),
    ).toBe(true)
  })

  it("reads the sentence wherever axios left it", () => {
    // An axios rejection keeps the server's body one level down and puts
    // its own wording on top. Reading only `message` missed this shape.
    expect(
      isRateLimited({
        response: { data: { message: "ThrottlerException: Too Many Requests" } },
      }),
    ).toBe(true)
  })

  it("does not turn every sentence with a limit in it into a rate limit", () => {
    // The loose version of the last rule would have caught all of these,
    // and told a reader to wait for something that will never clear.
    expect(isRateLimited(new Error("Daily limit reached"))).toBe(false)
    expect(isRateLimited(new Error("Too many decimals"))).toBe(false)
    expect(isRateLimited(new Error("Request failed"))).toBe(false)
    expect(isRateLimited({ response: { data: { message: "Daily limit reached" } } })).toBe(false)
  })

  it("answers false for the things that are not errors at all", () => {
    expect(isRateLimited(null)).toBe(false)
    expect(isRateLimited(undefined)).toBe(false)
    expect(isRateLimited("429")).toBe(false)
    expect(isRateLimited(429)).toBe(false)
  })
})
