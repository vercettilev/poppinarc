import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { whenSessionReady } from "~/helpers/sessionReady"

/**
 * THE ECHO ANNOUNCED FIRST, AND THERE WAS NO SESSION YET.
 *
 * app.poppin.so/auth relays one custom token on TWO channels within
 * milliseconds — the page's own runtime message and the content-script relay
 * — and in Chrome with the origin granted both land. The first arrival takes
 * the fresh branch and spends a network round trip inside
 * signInWithCustomToken; the second falls into the duplicate branch and
 * returns immediately. The duplicate exit learned to announce on 2026-09-22
 * (a real fix: a reader who was already signed in could otherwise press Sign
 * in forever), and announcing there meant announcing SECOND-arrived-FIRST,
 * with `auth.currentUser` still null.
 *
 * What that costs, traced: SignInStep hears EXTENSION_SIGNIN_COMPLETE and
 * runs afterAuthed() → getCurrentUser through the background's axios → no
 * Authorization header, because there is no user to take a token from. The
 * 401 routes the reader to /create-profile with SignInStep unmounted, so the
 * REAL announcement a moment later reaches nobody; and two afterAuthed() runs
 * race over poppinHasSeenOnboarding, which that function reads before it
 * writes — the second run sees the flag the first set and a newborn account
 * loses its /claim screen.
 *
 * The rule lives in helpers/sessionReady.ts so it can be RUN here (main.ts is
 * the service worker: importing it pulls in firebase and the whole chrome
 * surface). The wiring in main.ts is read as text, the way its neighbour
 * signin-announced.spec.ts reads it, with every anchor asserted before
 * anything is concluded from it.
 */

describe("an announcement that waits for the session", () => {
  let announced: number
  let onUser: ((user: unknown) => void) | null
  let onError: (() => void) | null
  let unsubscribed: number

  const subscribe = (u: (user: unknown) => void, e: () => void) => {
    onUser = u
    onError = e
    return () => {
      unsubscribed++
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    announced = 0
    onUser = null
    onError = null
    unsubscribed = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("says nothing while the session is still being fetched", () => {
    whenSessionReady({
      currentUser: () => null,
      subscribe,
      timeoutMs: 15_000,
      then: () => announced++,
    })
    // This is the duplicate arrival's moment: the first channel is still
    // inside signInWithCustomToken. Announcing here is the bug.
    expect(announced).toBe(0)
    // Firebase saying "still nobody" is not news either.
    onUser?.(null)
    expect(announced).toBe(0)
  })

  it("says it the moment Firebase hands the session over", () => {
    whenSessionReady({
      currentUser: () => null,
      subscribe,
      timeoutMs: 15_000,
      then: () => announced++,
    })
    onUser?.({ uid: "u1" })
    expect(announced).toBe(1)
    // And it lets go of the observer: this is a one-shot fact.
    expect(unsubscribed).toBe(1)
  })

  it("says it immediately when there already is one", () => {
    // The already-signed-in exit — the reader who could press Sign in
    // forever. Nothing to wait for, so nothing waits.
    whenSessionReady({
      currentUser: () => ({ uid: "u1" }),
      subscribe,
      timeoutMs: 15_000,
      then: () => announced++,
    })
    expect(announced).toBe(1)
    expect(onUser, "no observer is opened when the answer is already in hand").toBeNull()
  })

  it("says NOTHING when no session ever arrives", () => {
    whenSessionReady({
      currentUser: () => null,
      subscribe,
      timeoutMs: 15_000,
      then: () => announced++,
    })
    vi.advanceTimersByTime(15_000)
    /* A sign-in that failed must leave the Sign in button where it is. An
       announcement here would send the welcome tab to a 401 and then to
       /create-profile, which is the same wrong ending the premature one had. */
    expect(announced).toBe(0)
    expect(unsubscribed).toBe(1)
    // And a late arrival after the wait was abandoned changes nothing.
    onUser?.({ uid: "u1" })
    expect(announced).toBe(0)
  })

  it("says it once, however often Firebase speaks", () => {
    whenSessionReady({
      currentUser: () => null,
      subscribe,
      timeoutMs: 15_000,
      then: () => announced++,
    })
    // A token refresh and a second sign-in both fire this observer again;
    // the side effect moves a reader between screens, so it may not repeat.
    onUser?.({ uid: "u1" })
    onUser?.({ uid: "u1" })
    vi.advanceTimersByTime(60_000)
    expect(announced).toBe(1)
  })

  it("never throws out of the message handler it is called from", () => {
    // The duplicate exit calls this between sendResponse and closing the auth
    // tab; a throw here would leave that tab open on "One moment…" forever.
    expect(() =>
      whenSessionReady({
        currentUser: () => null,
        subscribe: () => {
          throw new Error("auth is not there")
        },
        timeoutMs: 15_000,
        then: () => announced++,
      }),
    ).not.toThrow()
    vi.advanceTimersByTime(60_000)
    expect(announced).toBe(0)
  })

  it("an observer error ends the wait silently, and the timer with it", () => {
    whenSessionReady({
      currentUser: () => null,
      subscribe,
      timeoutMs: 15_000,
      then: () => announced++,
    })
    onError?.()
    vi.advanceTimersByTime(60_000)
    expect(announced).toBe(0)
    expect(unsubscribed).toBe(1)
  })
})

describe("what the background does with it", () => {
  const src = readFileSync(join(__dirname, "main.ts"), "utf8")

  /** The text of a top-level function, braces matched. */
  const bodyOf = (name: string): string => {
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

  const door = bodyOf("announceSigninForToken")

  it("hands the wait the real session and the real observer", () => {
    expect(door.length).toBeGreaterThan(100)
    expect(door).toMatch(/currentUser: \(\) => auth\?\.currentUser \?\? null/)
    expect(door).toMatch(/subscribe: \(onUser, onError\) => onAuthStateChanged\(auth, onUser, onError\)/)
    expect(src).toMatch(/import \{ whenSessionReady \} from "~\/helpers\/sessionReady"/)
    /* NOT whenAuthSettled: it resolves on the first auth answer of the
       worker's life, which for a reader who was signed out has already
       happened and was null — it would return instantly and announce into
       exactly the emptiness this is about. */
    expect(door).not.toMatch(/whenAuthSettled/)
  })

  it("lets one token be announced once, and keys that on the token", () => {
    // Two announcements are two afterAuthed() runs, and the second one reads
    // the poppinHasSeenOnboarding flag the first has just written.
    expect(door).toMatch(/if \(lastSigninToken\.announced\) return/)
    expect(door).toMatch(/lastSigninToken\.announced = true/)
    expect(door).toMatch(/lastSigninToken\?\.token === token/)
    // The record is born unannounced, or the flag means nothing.
    expect(src).toMatch(/lastSigninToken = \{ token, at: Date\.now\(\), announced: false \}/)
    /* NEVER the uid: a reader who presses Sign in again gets a NEW token from
       login-or-create, and that press is the one this announcement exists to
       answer. Keyed on the person, the second press would go unanswered. */
    expect(door).not.toMatch(/uid/)
  })

  it("is the only way the three exits reach the broadcast", () => {
    const handler = bodyOf("handleExtensionSignin")
    expect([...handler.matchAll(/\bannounceSigninForToken\(token\)/g)]).toHaveLength(3)
    expect(handler).not.toMatch(/\bannounceSignin\(\)/)
    expect(door).toMatch(/announceSignin\(\)/)
  })
})
