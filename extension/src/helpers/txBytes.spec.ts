import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isVersionedTx, txBytesFromBase64 } from "./txBytes"

/**
 * THE TEST THAT WOULD HAVE CAUGHT IT.
 *
 * `isVersionedTx` used to read bytes[0] and call it the version. bytes[0]
 * is the SIGNATURE COUNT, which is 1 for everything a single wallet signs,
 * so every transaction answered "legacy" — and the MAIN-world bridge then
 * handed a versioned Jupiter swap to `Transaction.from`, which throws
 * "Versioned messages must be deserialized with VersionedMessage
 * .deserialize()". The chip said "Phantom could not sign this trade" and
 * Phantom never opened. Not one wallet trade had ever settled in
 * production. Measured against a live Jupiter swap on 2026-09-19.
 *
 * The wire format is written out here rather than produced by web3.js:
 * its instruction encoder needs a Node Buffer this environment does not
 * have, and a test of BYTES should state the bytes anyway.
 *
 *   [compact-u16 signature count][64 bytes per signature][message…]
 *
 * A v0 message begins with 0x80 | version. A legacy message begins with
 * its header's first field, a small count, so its high bit is clear.
 */
const SIG = 64

/** compact-u16, the same varint the runtime uses for array lengths. */
function compactU16(n: number): number[] {
  const out: number[] = []
  let rest = n
  for (;;) {
    const byte = rest & 0x7f
    rest >>= 7
    if (rest === 0) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

const tx = (signatures: number, firstMessageByte: number): Uint8Array =>
  Uint8Array.from([
    ...compactU16(signatures),
    ...new Array(signatures * SIG).fill(0),
    firstMessageByte,
    // A little message body, so the bytes after the marker are real.
    0x00,
    0x01,
    0x02,
  ])

const legacy = (signatures = 1) => tx(signatures, 0x01)
const versioned = (signatures = 1) => tx(signatures, 0x80)

describe("isVersionedTx reads the message, not the signature count", () => {
  it("both shapes start with the same first byte, so byte zero cannot decide", () => {
    expect(legacy()[0]).toBe(versioned()[0])
    expect(legacy()[0]).toBe(1)
  })

  it("answers versioned for a v0 message and legacy for a legacy one", () => {
    expect(isVersionedTx(versioned())).toBe(true)
    expect(isVersionedTx(legacy())).toBe(false)
  })

  it("skips every signature, not just one", () => {
    expect(isVersionedTx(versioned(3))).toBe(true)
    expect(isVersionedTx(legacy(3))).toBe(false)
  })

  it("reads a two-byte signature count", () => {
    // 128 signatures is absurd on chain and exactly the case a one-byte
    // read gets wrong, which is the point of a varint test.
    expect(isVersionedTx(versioned(128))).toBe(true)
    expect(isVersionedTx(legacy(128))).toBe(false)
  })

  it("says legacy for empty or truncated bytes rather than guessing", () => {
    expect(isVersionedTx(new Uint8Array())).toBe(false)
    expect(isVersionedTx(new Uint8Array([1]))).toBe(false)
    expect(isVersionedTx(versioned().slice(0, 20))).toBe(false)
  })
})

describe("txBytesFromBase64", () => {
  it("round-trips the bytes a transaction is sent as", () => {
    const bytes = versioned()
    const b64 = Buffer.from(bytes).toString("base64")
    expect(Array.from(txBytesFromBase64(b64))).toEqual(Array.from(bytes))
  })
})

describe("the bridge asks both ways before giving up", () => {
  const src = readFileSync(join(__dirname, "..", "entries/contentScript/pageWallet.ts"), "utf8")

  it("falls back to the other parse rather than dying on one guess", () => {
    expect(src).toMatch(/tx = parse\(guess\)/)
    expect(src).toMatch(/tx = parse\(!guess\)/)
  })

  it("sends the reason back, so a refusal is never just the word failed", () => {
    expect(src).toMatch(/const detail = e instanceof Error \? e\.message\.slice\(0, 200\)/)
    expect(src).toMatch(/error: code === 4001 \? "cancelled" : "failed", detail/)
  })
})
