import { describe, it, expect, vi } from "vitest"
import { brandFile, bytesToBase64, fetchBrandAsDataUri } from "./brandAssets"

describe("brandFile", () => {
  it("knows the three brand files and nothing else", () => {
    expect(brandFile("font-700")?.path).toBe("fonts/PoppinSans-NormalBold.ttf")
    expect(brandFile("mark")?.path).toBe("icons/logo.png")
  })

  it("refuses paths, prototype keys and non-strings, so it cannot proxy a read", () => {
    for (const k of ["../manifest.json", "fonts/PoppinSans-NormalBold.ttf", "__proto__", "toString", 7, null, undefined]) {
      expect(brandFile(k)).toBeNull()
    }
  })
})

describe("fetchBrandAsDataUri", () => {
  const ok = (bytes: number[]) =>
    ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as Response

  it("returns the file as a data URI with its own type", async () => {
    const fetchImpl = vi.fn(async () => ok([1, 2, 3]))
    const uri = await fetchBrandAsDataUri("font-700", {
      getURL: (p) => `chrome-extension://abc/${p}`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(uri).toBe("data:font/ttf;base64,AQID")
    expect(fetchImpl).toHaveBeenCalledWith("chrome-extension://abc/fonts/PoppinSans-NormalBold.ttf")
  })

  it("never fetches for an unknown key", async () => {
    const fetchImpl = vi.fn()
    expect(
      await fetchBrandAsDataUri("../secrets", { getURL: (p) => p, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("answers null for a missing or empty file rather than a broken URI", async () => {
    const missing = vi.fn(async () => ({ ok: false }) as Response)
    expect(await fetchBrandAsDataUri("mark", { getURL: (p) => p, fetchImpl: missing as unknown as typeof fetch })).toBeNull()
    const empty = vi.fn(async () => ok([]))
    expect(await fetchBrandAsDataUri("mark", { getURL: (p) => p, fetchImpl: empty as unknown as typeof fetch })).toBeNull()
  })
})

describe("bytesToBase64", () => {
  it("matches the platform encoder across the chunk boundary", () => {
    const big = new Uint8Array(0x8000 * 2 + 17).map((_, i) => (i * 31) % 256)
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString("base64"))
  })
})
