import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * THE COACH APPEARED ON SOME RUNS AND NOT OTHERS, and the reason was a
 * flag spent by a chip that was no longer on the page.
 *
 * The strip calls maybeCoach on EVERY chip that lands, and x.com recycles
 * timeline cells constantly. The first chip to call took the module's
 * claim, went away to read storage, had its cell recycled mid-read, CLEARED
 * the pending flag, and only then noticed it was gone. The flag was spent,
 * the claim was never released, and the coach was lost for that reader for
 * good — reported by the founder as "sometimes it shows, sometimes it
 * doesn't", which is exactly what a race looks like from the outside.
 *
 * EACH TEST TAKES A FRESH MODULE, because the claim is module state by
 * design ("idempotent per page: the strip calls this on every landing, it
 * acts once"). Sharing one instance across tests would let a passing test
 * spend the claim and make the next one fail for a reason that has nothing
 * to do with the code.
 */
const fresh = async () => {
  vi.resetModules()
  return (await import("./chipCoach")).maybeCoach
}

const connectedChip = (): HTMLElement => {
  const el = document.createElement("div")
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("the onboarding coach", () => {
  it("does not spend the flag for a chip that left the page", async () => {
    const maybeCoach = await fresh()
    const orphan = document.createElement("div") // never appended: isConnected is false
    const clear = vi.fn(async () => {})
    await maybeCoach({ chip: orphan, pending: async () => true, clear, track: vi.fn() })
    // The flag is the reader's one chance at the coach. An absent chip must
    // not be able to burn it.
    expect(clear).not.toHaveBeenCalled()
  })

  it("hands the turn to the next chip instead of keeping the claim", async () => {
    const maybeCoach = await fresh()
    const orphan = document.createElement("div")
    await maybeCoach({ chip: orphan, pending: async () => true, clear: async () => {}, track: vi.fn() })
    // A timeline lands another chip a fraction of a second later. Before the
    // fix the module-level claim stayed taken and this second call returned
    // silently, forever.
    const chip = connectedChip()
    const clear = vi.fn(async () => {})
    await maybeCoach({ chip, pending: async () => true, clear, track: vi.fn() })
    expect(clear).toHaveBeenCalled()
    expect(document.querySelector(".coach")).not.toBeNull()
  })

  it("still acts once per page when the flag is set and the chip is real", async () => {
    const maybeCoach = await fresh()
    const clear = vi.fn(async () => {})
    await maybeCoach({ chip: connectedChip(), pending: async () => true, clear, track: vi.fn() })
    expect(clear).toHaveBeenCalledTimes(1)
    // A second landing on the same page must not draw a second card.
    await maybeCoach({ chip: connectedChip(), pending: async () => true, clear, track: vi.fn() })
    expect(clear).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll(".coach").length).toBe(1)
  })

  it("releases the claim when nothing was pending, so a later chip can still ask", async () => {
    const maybeCoach = await fresh()
    const clear = vi.fn(async () => {})
    await maybeCoach({ chip: connectedChip(), pending: async () => false, clear, track: vi.fn() })
    expect(clear).not.toHaveBeenCalled()
    expect(document.querySelector(".coach")).toBeNull()
    // The flag arrives a moment later (the welcome tab wrote it after this
    // page had already drawn a chip). The claim must not be stuck.
    await maybeCoach({ chip: connectedChip(), pending: async () => true, clear, track: vi.fn() })
    expect(clear).toHaveBeenCalledTimes(1)
  })
})
