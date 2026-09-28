import { createHash } from 'node:crypto';

/**
 * A UUID that is the same every time for the same inputs.
 *
 * WHY THIS EXISTS. The Wallets SDK makes up a fresh idempotency key whenever
 * the caller does not pass one, so a retried request is a NEW request: a
 * wallet created twice, a transfer sent twice. Every mutating Circle call in
 * this service passes a key derived from what the call is FOR (this user's
 * Arc wallet, this action's swap leg), so a retry after a timeout or a
 * restart asks Circle for the thing it already did and gets it back.
 *
 * Shaped as a v4 UUID (version and variant bits set) because Circle validates
 * the format, not the randomness.
 */
export function stableUuid(...parts: string[]): string {
  const h = createHash('sha256').update(parts.join('\u0000')).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
