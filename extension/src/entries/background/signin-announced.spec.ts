import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * EVERY WAY SIGN-IN CAN END, SOMEBODY IS TOLD.
 *
 * handleExtensionSignin has three endings and only one of them used to
 * speak. The welcome tab's SignInStep waits on exactly one broadcast —
 * EXTENSION_SIGNIN_COMPLETE — to call afterAuthed() and move off the sign-in
 * screen. The two silent endings therefore produced the same picture as a
 * failure:
 *
 *   • the duplicate token (the page relays it on two channels, and the
 *     second arrival lands within 15s) — took the session, closed the auth
 *     tab, said nothing;
 *   • the reader who is ALREADY signed in as that uid — same.
 *
 * The auth tab closes either way, so from the reader's chair sign-in
 * "finished" and the welcome tab still shows a Sign in button. Pressing it
 * repeats the trip and lands on the same silent ending, forever, for
 * somebody who has had a valid session the whole time.
 *
 * This file is source-scanning rather than behavioural on purpose:
 * background/main.ts is the service worker, pulling in firebase and the
 * whole chrome surface at import time, and the thing under test is which
 * code paths reach a call — a structural fact the source can answer
 * exactly. The anchors below are asserted to exist before anything is
 * concluded from them, so a rename produces a red test and not a green
 * vacuum.
 */

const MAIN = join(__dirname, "main.ts")
const src = readFileSync(MAIN, "utf8")

/** The text of a top-level function, braces matched. */
function bodyOf(name: string): string {
  const start = src.indexOf(`function ${name}(`)
  expect(start, `function ${name} not found in background/main.ts`).toBeGreaterThan(-1)
  const open = src.indexOf("{", src.indexOf(")", start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const handler = bodyOf("handleExtensionSignin")
const announce = bodyOf("announceSignin")

/**
 * The three endings, each named by the reader it belongs to and sliced
 * between two anchors that are themselves checked. `to: null` means "to the
 * end of the handler" — the fall-through is the last thing in it.
 */
const EXITS: Array<{ who: string; from: string; to: string | null }> = [
  {
    who: "the same token arriving on the second channel within 15s",
    from: "duplicate: true",
    to: "lastSigninToken = { token, at: Date.now(), announced: false }",
  },
  {
    who: "a fresh session, signed in right here",
    from: "signInWithCustomToken(auth, token)",
    to: ".catch((error)",
  },
  {
    who: "a reader who was already signed in as that uid",
    from: "sendResponse({ success: true, user: auth.currentUser })",
    to: null,
  },
]

const sliceOf = (exit: (typeof EXITS)[number]): string => {
  const from = handler.indexOf(exit.from)
  expect(
    from,
    `anchor "${exit.from}" is gone from handleExtensionSignin — this spec can no ` +
      "longer see the exit it claims to check, so it is failing rather than passing blind.",
  ).toBeGreaterThan(-1)
  if (exit.to === null) return handler.slice(from)
  const to = handler.indexOf(exit.to)
  expect(to, `anchor "${exit.to}" is gone from handleExtensionSignin`).toBeGreaterThan(-1)
  // The duplicate branch sits BEFORE its closing anchor; the others after.
  return to > from ? handler.slice(from, to) : handler.slice(from)
}

describe("the sign-in broadcast", () => {
  it("found the handler and the announcement it is supposed to make", () => {
    // Without this the file could go green against an empty string.
    expect(handler.length).toBeGreaterThan(400)
    expect(announce.length).toBeGreaterThan(100)
  })

  for (const exit of EXITS) {
    it(`is made when sign-in ends with ${exit.who}`, () => {
      expect(
        sliceOf(exit),
        "this exit hands the reader a session and tells nobody: the welcome tab " +
          "keeps showing Sign in, and pressing it arrives back here.",
      ).toContain("announceSigninForToken(token)")
    })
  }

  it("is made from all three and nowhere less", () => {
    const calls = [...handler.matchAll(/\bannounceSigninForToken\(token\)/g)].length
    expect(calls).toBe(3)
  })

  /**
   * And none of them reaches the broadcast directly. announceSigninForToken
   * is the door that waits for `auth.currentUser` and lets one token through
   * once (entries/background/signin-waits-for-session.spec.ts): a call that
   * stepped past it would be announcing the arrival of a MESSAGE again.
   */
  it("goes through the door that waits for the session, never round it", () => {
    expect(handler).not.toMatch(/\bannounceSignin\(\)/)
  })

  it("reaches extension PAGES — the welcome tab is one", () => {
    expect(announce).toMatch(/chrome\.runtime\.sendMessage\(\{\s*type:\s*"EXTENSION_SIGNIN_COMPLETE"/)
  })

  /**
   * The half that is easiest to drop in a refactor, and the half that was
   * written down in a comment because it had already cost a release:
   * runtime.sendMessage does not reach content scripts. Losing it leaves the
   * chip that sent somebody to sign in reading "signed out" for the rest of
   * its book TTL, right at the peak of intent.
   */
  it("reaches CONTENT SCRIPTS too, which runtime.sendMessage cannot", () => {
    expect(announce).toContain("chrome.tabs.query")
    expect(announce).toMatch(/chrome\.tabs\s*\.sendMessage\([^)]*EXTENSION_SIGNIN_COMPLETE/s)
    expect(announce).toContain("x.com")
    expect(announce).toContain("twitter.com")
  })

  it("speaks with one voice — no exit keeps a private copy of the broadcast", () => {
    // Three inlined copies is how one of them loses the tabs half quietly.
    expect(handler).not.toContain("EXTENSION_SIGNIN_COMPLETE")
  })

  /**
   * Found by moving it: the tab patterns inside announceSignin contain the
   * two characters that open a block comment, and this repo reads main.ts
   * as text through a regex comment-stripper. Declared ABOVE the handler,
   * that fake comment swallowed the duplicate-token guard fund-doors.spec
   * asserts on, and a neighbouring spec went red for no reason it could
   * name. The hoist makes the order free; this keeps it from drifting back.
   */
  it("is declared after the handler, where its own text cannot blind a reader", () => {
    expect(src.indexOf("function announceSignin(")).toBeGreaterThan(
      src.indexOf("function handleExtensionSignin("),
    )
  })

  it("is the word the welcome tab is actually waiting for", () => {
    const step = readFileSync(
      join(__dirname, "..", "welcome", "components", "steps", "SignInStep.tsx"),
      "utf8",
    )
    const at = step.indexOf('message.type === "EXTENSION_SIGNIN_COMPLETE"')
    expect(
      at,
      "SignInStep no longer listens for this, so the announcement lands nowhere.",
    ).toBeGreaterThan(-1)
    expect(step.slice(at, at + 200)).toContain("afterAuthed()")
  })
})
