import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { PHANTOM_SIGNIN_ENABLED } from "~/config/features"

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("sign in with Phantom", () => {
  const step = stripComments(read("entries/welcome/components/steps/SignInStep.tsx"))

  it("opens the same bridge tab as Google, with provider=phantom", () => {
    expect(step).toMatch(/\/auth\?fromExtension=1&provider=phantom/)
    expect(step).toMatch(/Continue with Phantom/)
  })

  it("is on the welcome screen, behind a flag that can take it off", () => {
    expect(PHANTOM_SIGNIN_ENABLED).toBe(true)
    expect(step).toMatch(/\{PHANTOM_SIGNIN_ENABLED && \(/)
  })
})
