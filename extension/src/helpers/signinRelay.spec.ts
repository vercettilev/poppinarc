// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installSigninRelay, SIGNIN_POST_MESSAGE } from "./signinRelay"

/**
 * The channel that exists in every Chromium. Brave withholds chrome.runtime
 * from web pages, so the auth page's direct externally_connectable message
 * never leaves — measured live: a finished sign-in the extension never
 * heard. The relay is a content-script listener that forwards the page's
 * postMessage over the API a content script always has. These pin its
 * contract: right origin and shape forwarded, everything else ignored.
 */

let sendMessage: ReturnType<typeof vi.fn>
let teardowns: Array<() => void>

/**
 * jsdom's own postMessage ships events with a null source and an empty
 * origin, which would trip the relay's guards for the wrong reason. The
 * spec builds the event by hand instead — which also lets the guards be
 * tested against a WRONG source and origin, not just a missing one.
 */
const post = (
  data: unknown,
  init: { origin?: string; source?: MessageEventSource | null } = {},
) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: init.origin ?? location.origin,
      source: "source" in init ? init.source : (window as unknown as MessageEventSource),
    }),
  )
}

beforeEach(() => {
  sendMessage = vi.fn().mockResolvedValue(undefined)
  ;(globalThis as any).chrome = { runtime: { sendMessage } }
  delete (window as any).__poppinSigninRelay
  teardowns = []
})

afterEach(() => {
  for (const t of teardowns) t()
  delete (globalThis as any).chrome
  delete (window as any).__poppinSigninRelay
})

describe("installSigninRelay", () => {
  it("forwards the page's token to the background", () => {
    teardowns.push(installSigninRelay("app.poppin.so"))
    post({ type: SIGNIN_POST_MESSAGE, token: "tok-123" })
    expect(sendMessage).toHaveBeenCalledWith({
      action: "extension-signin",
      token: "tok-123",
    })
  })

  it("refuses to even listen off poppin.so", async () => {
    // x.com is where this content script spends its whole life; a sign-in
    // listener there would be surface for no reason.
    teardowns.push(installSigninRelay("x.com"))
    teardowns.push(installSigninRelay("evil-poppin.so.attacker.example"))
    post({ type: SIGNIN_POST_MESSAGE, token: "tok-123" })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("ignores every message that is not the one shape it knows", () => {
    teardowns.push(installSigninRelay("app.poppin.so"))
    post({ type: "SOMETHING_ELSE", token: "tok" })
    post({ type: SIGNIN_POST_MESSAGE }) // no token
    post({ type: SIGNIN_POST_MESSAGE, token: 42 }) // wrong type
    post({ type: SIGNIN_POST_MESSAGE, token: "" }) // empty
    post(null)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("ignores tokens from another origin or another window", () => {
    teardowns.push(installSigninRelay("app.poppin.so"))
    const msg = { type: SIGNIN_POST_MESSAGE, token: "tok-999" }
    post(msg, { origin: "https://evil.example" })
    post(msg, { source: null })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("installs once no matter how often the script is injected", async () => {
    // The background injects the content script into the same tab more
    // than once; the token must not be forwarded once per injection.
    teardowns.push(installSigninRelay("app.poppin.so"))
    teardowns.push(installSigninRelay("app.poppin.so"))
    teardowns.push(installSigninRelay("app.poppin.so"))
    post({ type: SIGNIN_POST_MESSAGE, token: "tok-once" })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
