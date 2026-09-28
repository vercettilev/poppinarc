import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * NO CONTROLLER-SCOPED REGISTRY MAY ONLY GROW.
 *
 * Twice in this file, and the second one only turned up because I went
 * looking for the SHAPE after fixing the instance:
 *
 *   tickTargets  price-tick callbacks, one per chip, add and no delete
 *   clipLabels   Buy-button relabellers, same
 *
 * Both held a closure over a DOM node inside a chip's shadow root, so
 * every chip a reader scrolled past stayed alive for the life of the TAB.
 * X recycles timeline cells constantly. Neither ever painted anything
 * wrong — both guarded on host.isConnected — which is exactly why they
 * survived: the symptom was a tab that gets slower for an hour and then
 * stops, and no screenshot has ever shown that.
 *
 * walRefreshers had the fix from the start. This asserts the other two
 * caught up, and names the rule for the next one.
 */
const SRC = readFileSync(join(__dirname, "xStrip.ts"), "utf8")
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("registries that hold chips", () => {
  it("tickTargets prunes a chip that left the document", () => {
    expect(CODE).toMatch(/if \(!t\.host\.isConnected\) \{\s*targets\.delete\(t\)/)
    // And forgets the mint entirely once nobody is showing it, so a
    // returning chip can re-arm the price stream.
    expect(CODE).toMatch(/tickTargets\.delete\(mint\)/)
    expect(CODE).toMatch(/watched\.delete\(mint\)/)
  })

  it("clipLabels drops its own entry when its chip is gone", () => {
    expect(CODE).toMatch(/clipLabels\.delete\(relabelHold\)/)
  })

  it("walRefreshers still does what the other two copied", () => {
    expect(CODE).toMatch(/walRefreshers\.delete\(refreshIfAlive\)/)
  })

  it("every long-lived Set of callbacks has a delete", () => {
    // The rule, stated so a fourth one cannot be added without meeting it.
    for (const name of ["tickTargets", "clipLabels", "walRefreshers"]) {
      const adds = CODE.match(new RegExp(`\\b${name}\\.(?:add|set)\\(`, "g")) ?? []
      const dels = CODE.match(new RegExp(`\\b${name}\\.delete\\(`, "g")) ?? []
      expect(adds.length, `${name} is never added to — did it get renamed?`).toBeGreaterThan(0)
      expect(dels.length, `${name} can only grow`).toBeGreaterThan(0)
    }
  })

  it("iterates clipLabels over a copy, because its callbacks mutate it", () => {
    // Deleting from a Set mid-iteration is legal in JS; the copy is here
    // so the next reader does not have to know that to feel safe.
    expect(CODE).not.toMatch(/for \(const relabel of clipLabels\)/)
    expect(CODE).toMatch(/for \(const relabel of \[\.\.\.clipLabels\]\)/)
  })
})
