import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * TWO PHOTOS, ONE READER, ONE SCREEN.
 *
 * Seen on 2026-09-22: the chip's header wore one account's face while the
 * You room's profile row, a few hundred pixels below it, wore another's.
 *
 * Both read the same function. readerIdentity caches for five minutes and
 * nothing cleared it when the session changed, and every surface resolves
 * me() at ITS OWN mount: the wallet key paints once when the chip lands,
 * the You room builds when it is opened. Switch accounts between those two
 * moments and both faces are on screen at once, each correct for the
 * instant it was fetched.
 *
 * The memo one line above was already cleared on this message for exactly
 * the same reason — a new account may trade from a different wallet — so
 * the fix is the same line for the same event, and this spec is what keeps
 * the two together.
 */
const src = readFileSync(join(__dirname, "primary", "main.tsx"), "utf8")

const onSignedIn = (): string => {
  const at = src.indexOf('msg?.type === "EXTENSION_SIGNIN_COMPLETE"')
  expect(at).toBeGreaterThan(-1)
  const rest = src.slice(at)
  const end = rest.indexOf("return false")
  expect(end).toBeGreaterThan(-1)
  return rest.slice(0, end)
}

describe("a session change", () => {
  it("drops the cached identity, so no surface can paint the last account's face", () => {
    expect(onSignedIn()).toMatch(/meOnce\s*=\s*null/)
  })

  it("drops the cached trading wallet too, which was already the rule", () => {
    expect(onSignedIn()).toMatch(/tradingWalletMemo\s*=\s*null/)
  })

  it("keeps the identity cache short enough that a missed clear self-heals", () => {
    // Not a substitute for the clear above: five minutes of a stranger's
    // face is a bug either way. It is the floor under it.
    const ttl = src.match(/const ME_TTL_MS = ([^\n]+)/)?.[1] ?? ""
    expect(ttl).toContain("60_000")
  })

  it("has exactly one identity cache, so there is one thing to clear", () => {
    expect(src.match(/let meOnce/g)?.length ?? 0).toBe(1)
  })
})
