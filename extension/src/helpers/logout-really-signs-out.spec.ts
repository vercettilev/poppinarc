import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * LOGOUT HAS TO REACH THE CONTEXT THAT HOLDS THE SESSION.
 *
 * Reported 2026-09-22: "logout çalışmıyor". Pressing Logout showed the
 * success toast and left the reader signed in, and reopening the panel did
 * not send them back to onboarding either.
 *
 * One cause under both symptoms. The panel signed out ITS OWN Firebase and
 * then sent CLEAR_STORE, which wipes storage and nothing else — but the
 * session does not live in storage. The BACKGROUND ran
 * signInWithCustomToken, and lib/axios asks the background for a token on
 * every request, so it kept answering with a live one. getCurrentUser kept
 * succeeding, so `isUserLoggedIn` stayed true, so the panel's own
 * open-the-welcome-page gate never fired.
 *
 * Source pins, because the defect is which message is sent, not what any
 * one function computes. A harness that stubs chrome.runtime proves the stub.
 */
const read = (p: string) => readFileSync(join(__dirname, p), "utf8")
const signOut = read("signOut.ts")
const background = read("../entries/background/main.ts")

/** The LOGOUT handler's body, so a match elsewhere cannot pass for one here. */
const handler = (): string => {
  const at = background.indexOf('request.action === "LOGOUT"')
  expect(at).toBeGreaterThan(-1)
  /* To the next top-level handler, not a fixed character count: the body
     carries a long WHY comment and a window sized to it once silently
     stopped reaching the code it was meant to pin. */
  const rest = background.slice(at)
  const end = rest.indexOf("\n  if (request.", 10)
  expect(end).toBeGreaterThan(-1)
  return rest.slice(0, end)
}

/**
 * The same body with the prose removed. The WHY comments here name the very
 * calls this file forbids — that is what they are for — so an assertion that
 * scans the raw text forbids its own explanation.
 */
const code = (): string => handler().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "")

describe("signing out", () => {
  it("tells the background, which is the context holding the session", () => {
    expect(signOut).toMatch(/sendMessage\(\{ action: "LOGOUT" \}/)
  })

  it("does not settle for CLEAR_STORE, which never touched the session", () => {
    // The word survives in the comment that explains why it was wrong, which
    // is the point of keeping it. What must not come back is SENDING it.
    expect(signOut).not.toMatch(/sendMessage\(\{\s*action:\s*"CLEAR_STORE"/)
  })

  it("still signs out this document's own Firebase first", () => {
    // Both are needed: the panel's instance drives the UI, the background's
    // drives every request.
    expect(signOut).toMatch(/auth\.signOut\(\)/)
  })

  it("signs the background out and wipes its storage", () => {
    const h = handler()
    expect(h).toMatch(/auth\.signOut\(\)/)
    expect(h).toMatch(/chrome\.storage\.local\.clear\(\)/)
    expect(h).toMatch(/chrome\.storage\.sync\.clear\(\)/)
  })

  it("keeps the alerts, which belong to the browser rather than the session", () => {
    // CLEAR_STORE destroyed these on every sign-out; the real handler reads
    // them before the wipe and writes them back after.
    const h = handler()
    expect(h).toMatch(/LOGOUT_SURVIVORS/)
    expect(h).toMatch(/survivesLogout\(kept\)/)
  })

  it("clears the session cookie through the route that exists", () => {
    /* FirebaseAuthGuard falls back to the poppin_access_token cookie when
       there is no Bearer header, and lib/axios sends it with every request.
       So the cookie IS the session: a logout that has not cleared it has
       not happened, which is exactly what a reader saw twice — panel closes,
       reopen, still signed in. Both old attempts pointed at
       app.poppin.so/logout, a route apps/auth has never had. */
    const h = code()
    expect(h).toMatch(/backendApi\(\{ url: "\/auth\/logout", method: "POST"/)
    expect(h).not.toMatch(/nextApi\(/)
  })

  it("waits for the cookie rather than firing and forgetting it", () => {
    const h = code()
    const call = h.indexOf('url: "/auth/logout"')
    const reply = h.indexOf("sendResponse({ success: true")
    expect(call).toBeGreaterThan(-1)
    expect(reply).toBeGreaterThan(call)
    expect(h).toMatch(/await backendApi/)
  })

  it("reports a cookie it could not clear instead of claiming success", () => {
    expect(handler()).toMatch(/cookieCleared/)
  })

  it("no longer opens an iframe at a route that does not exist", () => {
    expect(signOut).not.toMatch(/iframe\.src\s*=/)
  })

  it("replies only after every local fact has landed", () => {
    // The reply is what releases the panel to close itself. It used to sit
    // inside the .then of a network call, so a blocked request left the
    // storage full and the reply unsent; now it is last, after the cookie
    // and after the wipe, and it carries whether the cookie actually went.
    const h = code()
    const cookie = h.indexOf('url: "/auth/logout"')
    const wipe = h.indexOf("chrome.storage.local.clear()")
    const reply = h.indexOf("sendResponse({ success: true")
    expect(cookie).toBeGreaterThan(-1)
    expect(wipe).toBeGreaterThan(cookie)
    expect(reply).toBeGreaterThan(wipe)
  })
})
