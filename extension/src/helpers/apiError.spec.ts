import { describe, expect, it } from "vitest"
import { humanApiError, RATE_LIMIT_SENTENCE } from "./apiError"

/**
 * The measured payload, verbatim from the identity step's banner. The good
 * sentence was already in there — it just needed to be the only thing the
 * reader saw.
 */
const ZOD_JSON =
  '[{"code":"too_small","minimum":3,"type":"string","inclusive":true,"exact":false,"message":"Display name must be at least 3 characters","path":["display_name"]}]'

describe("humanApiError", () => {
  it("pulls the sentence out of a stringified Zod error", () => {
    expect(humanApiError({ message: ZOD_JSON }, "fallback")).toBe(
      "Display name must be at least 3 characters",
    )
  })

  it("reads the structured errors array when a caller still has it", () => {
    const e = {
      response: {
        data: {
          message: ZOD_JSON,
          errors: [{ message: "Username must be at most 15 characters", path: ["username"] }],
        },
      },
    }
    expect(humanApiError(e, "fallback")).toBe("Username must be at most 15 characters")
  })

  it("names the field when the issue only says Required", () => {
    // "Required" alone tells a reader nothing about WHAT is required.
    const e = { message: '[{"code":"invalid_type","message":"Required","path":["username"]}]' }
    expect(humanApiError(e, "fallback")).toBe("Username is required")
  })

  it("keeps an ordinary human message as written", () => {
    expect(humanApiError({ message: "Username already exists" }, "fallback")).toBe(
      "Username already exists",
    )
  })

  it("never hands a reader a brace: JSON with nothing sayable falls back", () => {
    expect(humanApiError({ message: "[]" }, "Could not save that")).toBe("Could not save that")
    expect(humanApiError({ message: "{}" }, "Could not save that")).toBe("Could not save that")
    expect(humanApiError({ message: '[{"code":"x"}]' }, "Could not save that")).toBe(
      "Could not save that",
    )
  })

  it("falls back on server-speak that says nothing", () => {
    // The background bridge's own default when it cannot read the response.
    expect(humanApiError({ message: "Unknown error" }, "Could not save that")).toBe(
      "Could not save that",
    )
    expect(humanApiError({ message: "Internal Server Error" }, "x")).toBe("x")
  })

  it("falls back on an error with nothing in it at all", () => {
    expect(humanApiError(new Error(""), "Could not save that")).toBe("Could not save that")
    expect(humanApiError(null, "Could not save that")).toBe("Could not save that")
    expect(humanApiError({}, "Could not save that")).toBe("Could not save that")
  })

  it("shows text that merely starts with a bracket rather than swallowing it", () => {
    expect(humanApiError({ message: "[staging] rate limited" }, "x")).toBe(
      "[staging] rate limited",
    )
  })
})

/**
 * A RATE LIMIT IS NOT A CRASH, and the panel told readers it was.
 * Reported live 2026-09-24: the feed printed "Error: ThrottlerException:
 * Too Many Requests", a Nest class name, at somebody listening to music.
 */
describe("a rate limit gets its own sentence", () => {
  it("answers the wait sentence, not the caller's fallback", () => {
    // The fallback would send a reader to check a connection that is fine.
    expect(humanApiError({ response: { status: 429 } }, "Check your connection")).toBe(
      RATE_LIMIT_SENTENCE,
    )
  })

  it("catches it by class name too, which is all that survives the bridge", () => {
    expect(
      humanApiError(new Error("ThrottlerException: Too Many Requests"), "nope"),
    ).toBe(RATE_LIMIT_SENTENCE)
  })

  it("never shows the reader a class name", () => {
    for (const e of [
      { response: { status: 429 } },
      new Error("ThrottlerException: Too Many Requests"),
      { response: { data: { message: "ThrottlerException: Too Many Requests" } } },
    ]) {
      expect(humanApiError(e, "fallback")).not.toMatch(/Exception/)
    }
  })

  it("leaves every other failure exactly as it was", () => {
    // The rate-limit branch runs first, so this is the guard that it did
    // not quietly swallow the errors this helper already handled well.
    expect(humanApiError(new Error("Display name is taken"), "nope")).toBe(
      "Display name is taken",
    )
    expect(humanApiError(new Error("Internal server error"), "fallback")).toBe(
      "fallback",
    )
  })
})
