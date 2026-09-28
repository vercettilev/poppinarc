/**
 * LEGACY OR VERSIONED, READ FROM THE MESSAGE, NOT FROM BYTE ZERO.
 *
 * THIS WAS THE BUG THAT KEPT EVERY WALLET TRADE FROM EVER HAPPENING.
 * A serialized transaction begins with its SIGNATURE ARRAY: a compact-u16
 * count, then 64 bytes per signature. The version byte belongs to the
 * MESSAGE, which starts after all of that. The first test looked at
 * bytes[0] and called it the version.
 *
 * bytes[0] is the signature count, and it is 1 for everything a single
 * wallet signs. So the test answered "legacy" for every transaction there
 * is. A legacy deposit transfer parsed anyway and reached Phantom, which
 * is why the deposit door worked and nothing else did: `Transaction.from`
 * on a versioned swap throws "Versioned messages must be deserialized
 * with VersionedMessage.deserialize()", the bridge caught it, and the chip
 * said "Phantom could not sign this trade" without Phantom ever opening.
 * Measured against a live Jupiter swap on 2026-09-19; not one external
 * trade had ever settled in production.
 */
export function isVersionedTx(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  // compact-u16: 7 bits per byte, high bit continues. Three bytes at most.
  let offset = 0
  let count = 0
  for (let shift = 0; shift <= 14; shift += 7) {
    const b = bytes[offset++]
    if (b === undefined) return false
    count |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
  }
  const first = bytes[offset + count * 64]
  return first !== undefined && (first & 0x80) !== 0
}

export function txBytesFromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
