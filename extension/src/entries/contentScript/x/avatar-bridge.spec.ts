import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const strip = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

/**
 * x.com's img-src is its own hosts plus data:, so a profile photo set as a
 * plain src never shows on the page. Every person's picture the chip draws
 * goes through the worker, like token icons, and lands as a data URI.
 */
describe("chip avatars pass through the worker", () => {
  it("one door for every person's picture", () => {
    expect(strip).toMatch(/function avatarImg\(url: string\): HTMLImageElement/)
    expect(strip).toMatch(/void iconViaBackground\(url\)\.then\(\(uri\) => \{\s*if \(uri && img\.isConnected\) img\.src = uri/)
    /* The crowd stack used to be a third caller here
       (`person.avatarUrl ? avatarImg(person.avatarUrl)`). It left the row
       with the rest of that idea; the two doors below are the survivors,
       and the rule they prove — x.com blocks a remote avatar, so bytes come
       through the worker as a data URI — is unchanged by its going. */
    expect(strip).toMatch(/const img = avatarImg\(url\)/)
  })

  it("never sets a remote photo as a plain src", () => {
    expect(strip).not.toMatch(/src: person\.avatarUrl/)
    expect(strip).not.toMatch(/^\s*img\.src = url\s*$/m)
  })
})
