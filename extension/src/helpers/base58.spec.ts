import { describe, it, expect } from "vitest"
import { base58Encode } from "./base58"

const bytes = (...n: number[]) => Uint8Array.from(n)

describe("base58Encode", () => {
  it("matches the published test vectors", () => {
    // From the Bitcoin base58 test suite, which is where the alphabet and
    // the leading-zero rule both come from.
    expect(base58Encode(bytes(0x00))).toBe("1")
    expect(base58Encode(bytes(0x00, 0x00))).toBe("11")
    expect(base58Encode(bytes(0x61))).toBe("2g")
    expect(base58Encode(bytes(0x62, 0x62, 0x62))).toBe("a3gV")
    expect(base58Encode(bytes(0x63, 0x63, 0x63))).toBe("aPEr")
    expect(base58Encode(bytes(0x00, 0x61))).toBe("12g")
  })

  it("keeps every leading zero, which is a position and not a value", () => {
    expect(base58Encode(bytes(0x00, 0x00, 0x00, 0x61))).toBe("1112g")
  })

  it("answers empty for empty rather than inventing a character", () => {
    expect(base58Encode(new Uint8Array())).toBe("")
  })

  it("encodes a 64-byte signature to the length Solana uses", () => {
    // A real signature is 64 bytes and lands at 87 or 88 characters, which
    // is exactly the shape the backend's own regex checks for.
    const sig = new Uint8Array(64).fill(0xff)
    const s = base58Encode(sig)
    expect(s.length).toBeGreaterThanOrEqual(80)
    expect(s.length).toBeLessThanOrEqual(90)
    expect(/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)).toBe(true)
  })

  it("never emits the four characters base58 leaves out", () => {
    for (let i = 0; i < 256; i++) {
      expect(/[0OIl]/.test(base58Encode(bytes(i, i, i)))).toBe(false)
    }
  })
})
