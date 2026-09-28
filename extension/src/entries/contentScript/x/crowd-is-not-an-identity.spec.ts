import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * ONE FACE ON THE ROW, AND IT IS THE READER'S.
 *
 * The price capsule used to carry a stack of the faces of people you follow
 * who are in this asset. It reported something true and cost more than it
 * returned: two faces on one 38px row, the reader's own 30px wallet key one
 * slot over, and nothing saying which was which. The founder read his own
 * followed account as himself and reported it as a bug twice, on a product
 * he wrote — which is the measurement, because a first-time reader has less
 * to go on than he did.
 *
 * It was made smaller, ringed and always counted first. The read after that
 * was that the idea itself was extra complexity on the row that carries the
 * money, so it is gone rather than tuned. The panel still says how many
 * friends are trading, where there is space to say it.
 *
 * This file is the guard against it coming back by accident — and against
 * the dead request it fed coming back with it.
 */
const chip = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
const page = readFileSync(join(__dirname, "..", "primary", "main.tsx"), "utf8")

describe("the chip's row", () => {
  it("has no crowd slot in its markup", () => {
    expect(chip).not.toMatch(/class="who"/)
  })

  it("has no painter for one", () => {
    expect(chip).not.toMatch(/paintWho/)
  })

  it("does not ask its host for one", () => {
    // The dep is how the surface came back last time it was removed from a
    // view but left on the interface.
    expect(chip).not.toMatch(/followingIn\??:/)
  })

  it("still carries the reader's own face, which was never the problem", () => {
    expect(chip).toMatch(/\.wal\s*\{[\s\S]*?width:\s*30px/)
  })

  it("still carries the reader's own position, which shares that corner", () => {
    // `.mine` sat beside `.who` and stays: it is about the asset, not about
    // a person, and it is the reader's own.
    expect(chip).toMatch(/class="mine"/)
  })
})

describe("the page behind it", () => {
  it("no longer fetches a crowd nobody reads", () => {
    // followingCrowd fed the stack and nothing else, so leaving it would be
    // a request per page whose answer had no reader.
    expect(page).not.toMatch(/const followingCrowd/)
    expect(page).not.toMatch(/followingTradesAsset\(/)
  })

  it("keeps the cache window the callers line still uses", () => {
    // CROWD_TTL_MS was shared; removing it with its namesake would have
    // taken the author track-record cache with it.
    expect(page).toMatch(/const CROWD_TTL_MS/)
    expect(page).toMatch(/callersOnce/)
  })
})
