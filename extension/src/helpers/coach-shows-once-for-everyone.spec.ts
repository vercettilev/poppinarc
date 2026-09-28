import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * THE COACH IS NOT A REWARD FOR FINISHING ONBOARDING.
 *
 * It used to be: the welcome page set a flag and only a reader who reached
 * /show-me ever got the two sentences. Measured 2026-09-23, that was 9
 * people against 140 who were shown a chip, so 94 of every 100 readers met
 * a row of controls nobody had named. The rule is now "this browser has
 * never been shown it", which is a question every reader answers yes to
 * exactly once.
 */
const stored: Record<string, unknown> = {}
;(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: stored[key] }),
      set: async (patch: Record<string, unknown>) => {
        Object.assign(stored, patch)
      },
    },
  },
}

const fresh = async () => {
  vi.resetModules()
  return import("./chipCoach")
}

describe("who gets the coach", () => {
  beforeEach(() => {
    for (const k of Object.keys(stored)) delete stored[k]
  })

  it("shows it to a reader who never went through onboarding", async () => {
    // The 131. Nothing in storage, because nothing armed them.
    const { coachPending } = await fresh()
    expect(await coachPending()).toBe(true)
  })

  it("spends it on display, so the second chip is quiet", async () => {
    const { coachPending, markCoachSeen } = await fresh()
    expect(await coachPending()).toBe(true)
    await markCoachSeen()
    expect(await coachPending()).toBe(false)
    // And it stays spent across a page load, which is the whole point of
    // storing it rather than holding a module-level boolean.
    const again = await fresh()
    expect(await again.coachPending()).toBe(false)
  })

  it("treats a storage failure as ALREADY SEEN, never as pending", async () => {
    // The direction matters. A read that throws on every chip would draw
    // the card on every chip, which is the nag the one-shot exists to
    // prevent; the cost of the other direction is two lost sentences.
    const good = (globalThis as { chrome?: unknown }).chrome
    ;(globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => {
            throw new Error("no storage")
          },
          set: async () => undefined,
        },
      },
    }
    const { coachPending, markCoachSeen } = await fresh()
    expect(await coachPending()).toBe(false)
    // And a write that throws must not take the page down with it.
    await expect(markCoachSeen()).resolves.toBeUndefined()
    ;(globalThis as { chrome?: unknown }).chrome = good
  })

  it("reads any unusable value as not yet seen", async () => {
    // chrome.storage is untrusted input: a half-written or legacy value
    // must not silently cost a reader their only introduction.
    const { coachPending } = await fresh()
    for (const junk of [undefined, null, false, 0, "true", "2", {}]) {
      stored.poppin_coach_seen = junk
      expect(await coachPending()).toBe(true)
    }
  })

  /**
   * A REWRITTEN COACH IS OWED TO EVERYONE AGAIN, which the old boolean flag
   * could not express: 446 readers already carried it, and every later edit
   * would have been invisible to all of them.
   */
  it("shows a newer coach to someone who saw an older one", async () => {
    const { coachPending, COACH_VERSION, markCoachSeen } = await fresh()
    // The v1 flag was literally `true`. It counts as version 1.
    stored.poppin_coach_seen = true
    expect(await coachPending()).toBe(COACH_VERSION > 1)
    stored.poppin_coach_seen = COACH_VERSION - 1
    expect(await coachPending()).toBe(true)
    // And once spent at the current version, it is quiet again.
    await markCoachSeen()
    expect(stored.poppin_coach_seen).toBe(COACH_VERSION)
    expect(await coachPending()).toBe(false)
  })

  it("does not re-show a coach from the future", async () => {
    // A downgrade must not start nagging; the reader has seen more, not less.
    const { coachPending, COACH_VERSION } = await fresh()
    stored.poppin_coach_seen = COACH_VERSION + 1
    expect(await coachPending()).toBe(false)
  })
})
