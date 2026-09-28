import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * ONE PERSON, BEFORE AND AFTER THEIR SIGN-IN.
 *
 * Measured in production on 2026-09-21: not one row in user_events carried
 * a user_id and an anon_id at the same time. Everything before a sign-in
 * was filed under the install, everything after it under the account, and
 * nothing joined them — so "23 installed, 8 signed in" counted installs
 * against accounts, two populations that never touch. The only way to read
 * the step was to match timestamps within thirty minutes and hope one
 * person's sign-in was not credited to another person's install.
 *
 * The repair is one field on a request that was already being made. This
 * spec holds it there, because it is invisible: nothing breaks when the id
 * stops being sent, the funnel just quietly goes back to guessing.
 */
const src = readFileSync(join(__dirname, "main.ts"), "utf8")

const deliver = (): string => {
  const at = src.indexOf("function deliverTelemetry(")
  expect(at).toBeGreaterThan(-1)
  const rest = src.slice(at)
  /* To the next top-level declaration, which is as far as the function can
     reach. Scanning the whole file would let any other call site satisfy
     these assertions. */
  const end = rest.indexOf("\nchrome.runtime.onMessage.addListener")
  expect(end).toBeGreaterThan(-1)
  return rest.slice(0, end)
}

describe("deliverTelemetry", () => {
  it("reads the install id before it builds the event, not only after a 401", () => {
    const body = deliver()
    const read = body.indexOf("anonInstallId()")
    const post = body.indexOf('url: "/user-events"')
    expect(read).toBeGreaterThan(-1)
    expect(post).toBeGreaterThan(-1)
    // The id has to exist by the time the authenticated POST is built. When
    // it was fetched inside the catch, every signed-in event was already
    // gone by then.
    expect(read).toBeLessThan(post)
  })

  it("puts the install id in the body the authenticated route receives", () => {
    expect(deliver()).toMatch(/\.\.\.\(anon_id \? \{ anon_id \} : \{\}\)/)
  })

  it("omits the field rather than sending an empty one", () => {
    // The backend refuses anything that is not a UUID, so a null would be
    // dropped there anyway; sending it would only make the wire lie about
    // what this browser knows.
    const body = deliver()
    expect(body).not.toMatch(/anon_id: null/)
    expect(body).not.toMatch(/anon_id: ""/)
  })

  it("still falls back to the anon route when the token is refused", () => {
    const body = deliver()
    expect(body).toContain('url: "/user-events/anon"')
    expect(body).toMatch(/status !== 401/)
  })
})
