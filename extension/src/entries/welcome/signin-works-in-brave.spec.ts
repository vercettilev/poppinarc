import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getManifest } from "~/manifest"
import { openAuthTab, SIGNIN_RELAY_ORIGIN } from "~/helpers/openAuthTab"

/**
 * SIGN-IN CANNOT DEPEND ON A PERMISSION THE READER HAS NOT GIVEN YET.
 *
 * Brave does not inject chrome.runtime into externally_connectable pages,
 * so the auth page cannot hand its token to the extension directly there.
 * The fallback is helpers/signinRelay, which rides the primary CONTENT
 * SCRIPT — and a content script only runs where the extension has host
 * access. With <all_urls> optional and not yet granted, the relay does not
 * exist: the reader finished sign-in on the web, saw "You're in", and the
 * extension never heard a word.
 *
 * AND IT CANNOT BE REPAIRED BY REQUIRING ONE EITHER. For a day it was:
 * host_permissions: ["https://*.poppin.so/*"], one origin, ours. The store
 * build everybody is running (1.0.329) declares NO required host permission
 * at all, and Chrome disables an extension whose update adds a required
 * permission the user has not already granted, until they re-enable it by
 * hand. Most of the install base never finished onboarding and so never
 * granted <all_urls>: roughly half of it would have gone dark, silently, to
 * fix a Brave population nobody has counted.
 *
 * So the origin is OPTIONAL and it is asked for at the press of "Sign in",
 * which is a user gesture and may therefore prompt. These pin both halves:
 * an update that cannot disable anyone, and a grant that lands before the
 * auth tab navigates. Break either and the reader loses sign-in, in
 * opposite directions.
 */

/**
 * Source with comments removed. This repo explains a fix by quoting what it
 * replaced, so a naive sweep finds the defect in the paragraph about its
 * removal. The `[^:]` guard keeps `https://` out of the line-comment rule.
 */
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("the store manifest an update has to be safe to ship", () => {
  const m = getManifest(3, {}) as Record<string, unknown>

  it("declares NO required host permission at all", () => {
    // Not "a narrow one". None. A required host permission the reader has
    // not already granted is what turns the extension off on update day,
    // and the narrowness of the pattern does not soften that one bit.
    expect(m.host_permissions).toBeUndefined()
    expect(Object.keys(m)).not.toContain("host_permissions")
  })

  it("carries the exact permission shape 1.0.329 already carries", () => {
    // What every current install has already accepted, verified from git at
    // b3ee80e0. An update matching this list to the letter cannot raise a
    // new warning, so Chrome has nothing to disable the extension over.
    expect(m.permissions).toEqual(["storage", "sidePanel", "alarms", "notifications"])
    expect(m.optional_permissions).toEqual(["scripting"])
    expect(m.optional_host_permissions).toContain("<all_urls>")
  })

  it("keeps the relay's origin, optional, so it can be asked for later", () => {
    // chrome.permissions.request may only ask for origins the manifest has
    // declared optional. Drop this entry and the request below starts
    // failing at runtime, in a browser, where no test is watching.
    expect(m.optional_host_permissions).toContain(SIGNIN_RELAY_ORIGIN)
  })

  it("leaves the dev override alone, promoted and unafraid", () => {
    // A `Load unpacked` build grants everything up front or every feature
    // silently does nothing. It keeps the narrow origin too, because the
    // store build's shape is what the relay depends on and a dev build that
    // differs hides this whole class of bug.
    const dev = getManifest(3, {}, true) as Record<string, unknown>
    expect(dev.host_permissions).toEqual(["<all_urls>", SIGNIN_RELAY_ORIGIN])
  })
})

describe("the press of Sign in", () => {
  let order: string[]
  let request: ReturnType<typeof vi.fn>
  let create: ReturnType<typeof vi.fn>

  beforeEach(() => {
    order = []
    request = vi.fn(async () => {
      order.push("request")
      return true
    })
    create = vi.fn(async () => {
      order.push("create")
      return { id: 7 }
    })
    ;(globalThis as any).chrome = { permissions: { request }, tabs: { create } }
  })

  afterEach(() => {
    delete (globalThis as any).chrome
  })

  it("asks for the origin BEFORE the auth tab is created", async () => {
    await openAuthTab("https://app.poppin.so/auth?fromExtension=1&provider=google")
    /**
     * THE ORDER IS THE MECHANISM, not a tidiness. The content script is
     * injected when the tab reports `loading`, against whatever is granted
     * at that moment, so a grant that lands after the navigation arrives
     * too late to put the relay on the page that is already producing a
     * token. Move the request below chrome.tabs.create and this reads
     * ["create", "request"] and fails, which is the entire point of
     * asserting the sequence rather than the two calls.
     */
    expect(order).toEqual(["request", "create"])
  })

  it("asks for scripting alongside the origin, in one prompt", async () => {
    // There is no manifest-declared content script in the store build
    // (vite.config.ts declares one only in development), so the relay
    // reaches the auth page by programmatic injection only, and
    // background/main.ts's injectContentScripts returns early, before it
    // ever looks at a host, when `scripting` is missing. The origin on its
    // own buys access to a page we still could not put a script on.
    await openAuthTab("https://app.poppin.so/auth?fromExtension=1&provider=google")
    expect(request).toHaveBeenCalledWith({
      permissions: ["scripting"],
      origins: [SIGNIN_RELAY_ORIGIN],
    })
  })

  it("opens the tab anyway when the reader declines", async () => {
    request.mockResolvedValue(false)
    await openAuthTab("https://app.poppin.so/auth?fromExtension=1&provider=google")
    // In Chrome the page's own chrome.runtime channel needs no host
    // permission at all; the relay is only ever the Brave fallback. A "no"
    // must never cost somebody their sign-in page.
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("opens the tab anyway when the request throws", async () => {
    request.mockRejectedValue(new Error("Optional permissions must be listed"))
    await openAuthTab("https://app.poppin.so/auth?fromExtension=1&provider=phantom")
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("opens the tab anyway where the API is not there", async () => {
    ;(globalThis as any).chrome = { tabs: { create } }
    await openAuthTab("https://app.poppin.so/auth?fromExtension=1&provider=phantom")
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("routes BOTH providers through the one door that orders them", () => {
    // Google and Phantom are two buttons and were two copies of the same
    // five lines. One of them getting the grant and the other not is the
    // likeliest way this regresses, so neither is allowed to open a tab of
    // its own.
    const src = strip(
      readFileSync(join(__dirname, "components/steps/SignInStep.tsx"), "utf8"),
    )
    expect(src).not.toMatch(/chrome\.tabs\.create/)
    // Google, Phantom, and the Arc edition's wallet page.
    expect(src.match(/await openAuthTab\(/g)).toHaveLength(3)
  })

  it("spends the gesture before anything can await it away", () => {
    // chrome.permissions.request only prompts inside a live user gesture,
    // and the first `await` in a handler ends it. Both handlers must reach
    // openAuthTab with nothing awaited ahead of it.
    const src = strip(
      readFileSync(join(__dirname, "components/steps/SignInStep.tsx"), "utf8"),
    )
    for (const handler of ["handleGoogleSignIn", "handlePhantomSignIn", "handleArcWalletSignIn"]) {
      const body = src.slice(src.indexOf(`const ${handler} =`))
      const upToOpen = body.slice(0, body.indexOf("await openAuthTab("))
      expect(upToOpen).not.toMatch(/\bawait\b/)
    }
  })
})

describe("the relay itself", () => {
  it("stays scoped to that origin and nothing else", async () => {
    const { installSigninRelay } = await import("~/helpers/signinRelay")
    // A non-poppin host installs nothing at all.
    expect(installSigninRelay("example.com")).toBeInstanceOf(Function)
    expect(installSigninRelay("evil-poppin.so.attacker.com")).toBeInstanceOf(Function)
  })
})
