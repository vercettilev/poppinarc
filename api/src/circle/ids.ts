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

/**
 * THE LABEL CIRCLE KEEPS FOR AN ACCOUNT: short and plain enough for any id.
 *
 * A Firebase uid (28 letters and digits) is used as it is, which is what every
 * wallet made so far carries, and what its idempotency key was derived from.
 * A longer or punctuated id, such as a wallet sign-in's `evm:<address>` (46
 * characters, 53 as the "poppin:" name), becomes a hash of itself: measured
 * 2026-09-29, Circle refused that name with "API parameter invalid" while the
 * 35-character names of Google accounts went through. The label is only a
 * label; this service finds wallets by uid in its own table.
 */
export function circleRef(uid: string): string {
  if (/^[A-Za-z0-9_-]{1,28}$/.test(uid)) return uid;
  return `h${createHash('sha256').update(uid).digest('hex').slice(0, 23)}`;
}

/**
 * A Circle failure with the field Circle named, when it named one. The SDK's
 * error message alone ("API parameter invalid") left a failed wallet with no
 * way to tell which parameter was wrong. The response body carries no secret.
 */
export function circleErrorText(e: unknown): string {
  const err = e as { message?: unknown; response?: { data?: { errors?: unknown } } } | null;
  const base = typeof err?.message === 'string' ? err.message : String(e);
  const detail = err?.response?.data?.errors;
  if (!detail) return base;
  try {
    return `${base} ${JSON.stringify(detail).slice(0, 400)}`;
  } catch {
    return base;
  }
}
