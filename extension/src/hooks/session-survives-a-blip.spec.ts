import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * ONLY THE SERVER CAN SIGN SOMEBODY OUT.
 *
 * useCurrentUser called auth.signOut() on `query.error` — any error — and
 * the query is retry:false, so a single timeout, a 500, or one second
 * offline ended the session. The welcome flow polls this same hook, so it
 * could fire in the middle of a brand-new account's first minute and sign
 * a person out of the account they were creating.
 */
describe("a network blip is not a sign-out", () => {
  const hook = strip(read("hooks/useCurrentUser.ts"))

  it("reaches signOut only behind a 401", () => {
    const at = hook.indexOf("auth.signOut()")
    expect(at).toBeGreaterThan(0)
    // The guard sits between the effect's entry and the call.
    const before = hook.slice(hook.lastIndexOf("useEffect", at), at)
    expect(before).toMatch(/status !== 401/)
    expect(before).toMatch(/return/)
  })

  it("still clears the local view, because stale user data is its own lie", () => {
    const at = hook.indexOf("auth.signOut()")
    const before = hook.slice(hook.lastIndexOf("useEffect", at), at)
    expect(before).toMatch(/setUser\(null\)/)
    expect(before).toMatch(/setUserOrganizations\(\[\]\)/)
    // and it clears BEFORE the 401 gate, so it happens on every error
    expect(before.indexOf("setUser(null)")).toBeLessThan(
      before.indexOf("status !== 401"),
    )
  })

  it("keeps retry off, which is what made a single failure decisive", () => {
    // Not a defect on its own — it is the reason the guard has to exist.
    expect(hook).toMatch(/retry: false/)
  })
})
