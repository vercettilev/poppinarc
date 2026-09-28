import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
/** Comments are where the history lives; the words readers see are the rest. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
import { NOTIFY_ROWS } from "~/helpers/notifyPrefs"

describe("settings, in the order a person asks", () => {
  const s = stripComments(read("views/Settings.tsx"))

  it("opens on who you are, then what reaches you, then what goes out", () => {
    const account = s.indexOf("ACCOUNT")
    const tell = s.indexOf("TELL ME WHEN")
    const sharing = s.indexOf("SHARING")
    expect(account).toBeGreaterThan(-1)
    expect(account).toBeLessThan(tell)
    expect(tell).toBeLessThan(sharing)
    expect(s).toMatch(/Sign out/)
  })

  it("gives the server's mail its own switch, on the account", () => {
    expect(s).toMatch(/Email when Chrome is closed/)
    expect(s).toMatch(/notifications_enabled: value/)
  })

  it("speaks in the product's words: no star, no em dash, no code voice", () => {
    expect(s).not.toMatch(/starred/)
    expect(s).not.toMatch(/—/)
    expect(s).not.toMatch(/has not asked for it/)
    expect(NOTIFY_ROWS.find((r) => r.kind === "move")!.description).not.toMatch(/star/)
  })
})
