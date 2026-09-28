import { describe, expect, it, vi } from "vitest"
import { askTabAwake, isNoReceiver, type TabAnswer } from "./askTabAwake"

const noSleep = async () => undefined

describe("the page beside the panel, woken if it has to be", () => {
  it("a page that answers is asked once and never woken", async () => {
    const ask = vi.fn(async (): Promise<TabAnswer> => ({ res: { ok: true }, noReceiver: false }))
    const wake = vi.fn(async () => undefined)
    expect(await askTabAwake({ ask, wake, sleep: noSleep })).toEqual({ ok: true })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(wake).not.toHaveBeenCalled()
  })

  it("a page that answered with a refusal is left alone", async () => {
    const refusal = { ok: false, error: "Closed in Phantom before signing." }
    const ask = vi.fn(async (): Promise<TabAnswer> => ({ res: refusal, noReceiver: false }))
    const wake = vi.fn(async () => undefined)
    expect(await askTabAwake({ ask, wake, sleep: noSleep })).toBe(refusal)
    expect(wake).not.toHaveBeenCalled()
  })

  it("a tab with nobody listening is woken once and asked again", async () => {
    // 2026-09-25: twelve presses, twelve "did not answer", on a tab opened
    // before the install.
    const answers: TabAnswer[] = [
      { res: undefined, noReceiver: true },
      { res: undefined, noReceiver: true },
      { res: { ok: true }, noReceiver: false },
    ]
    const ask = vi.fn(async () => answers.shift()!)
    const wake = vi.fn(async () => undefined)
    expect(await askTabAwake({ ask, wake, sleep: noSleep })).toEqual({ ok: true })
    expect(wake).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it("gives up after its waits and says nothing it did not hear", async () => {
    const ask = vi.fn(async (): Promise<TabAnswer> => ({ res: undefined, noReceiver: true }))
    const wake = vi.fn(async () => undefined)
    expect(await askTabAwake({ ask, wake, sleep: noSleep, waitsMs: [1, 1] })).toBeUndefined()
    expect(wake).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it("a tab that cannot be woken is not asked again", async () => {
    const ask = vi.fn(async (): Promise<TabAnswer> => ({ res: undefined, noReceiver: true }))
    const wake = vi.fn(async () => {
      throw new Error("Cannot access contents of the page")
    })
    expect(await askTabAwake({ ask, wake, sleep: noSleep })).toBeUndefined()
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("reads Chrome's own words for a missing listener", () => {
    expect(isNoReceiver("Could not establish connection. Receiving end does not exist.")).toBe(true)
    expect(isNoReceiver("The message port closed before a response was received.")).toBe(false)
    expect(isNoReceiver(undefined)).toBe(false)
  })
})
