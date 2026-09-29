import { describe, expect, it } from "vitest"
import { getManifest } from "./manifest"

/**
 * The Arc edition installs NEXT TO the store build, so it must never carry the
 * store key (one id, one extension) and must never be mistaken for it by name.
 */
describe("manifest editions", () => {
  it("the default build keeps the store key and the store name", () => {
    const m = getManifest(3, {}) as unknown as Record<string, unknown>
    expect(m.key).toBeTypeOf("string")
    expect(String(m.name)).not.toMatch(/arc/i)
  })

  it("the Arc edition drops the key and names itself", () => {
    for (const testBuild of [false, true]) {
      const m = getManifest(3, {}, testBuild, "arc") as unknown as Record<string, unknown>
      expect(m.key).toBeUndefined()
      expect(m.name).toBe("Poppin Arc (testnet)")
      expect(String(m.description)).not.toContain("—")
    }
  })

  it("the mainnet build of the Arc edition says so, and still has no key", () => {
    const m = getManifest(3, {}, true, "arc", "mainnet") as unknown as Record<string, unknown>
    expect(m.key).toBeUndefined()
    expect(m.name).toBe("Poppin on Arc")
    expect(String(m.short_name).length).toBeLessThanOrEqual(12)
  })
})
