/**
 * WHAT "MAX" MAY ACTUALLY SWAP — the arithmetic behind the Swap screen's
 * Max button and its validation, kept pure so the field report that created
 * it stays a spec.
 *
 * The report: a wallet holding 3.020272 SOL pressed Max and was refused.
 * Two defects stacked. The token row's amount was the DISPLAY string, and
 * toFixed(4) rounds — "3.0203" is more SOL than the wallet holds — so Max
 * submitted money that did not exist. And even the exact balance would have
 * been refused: the backend keeps 0.001 SOL for network fees on SOL-input
 * swaps (terminal.service.ts, minSolForFees), because when you swap SOL
 * itself away, the fee must come from somewhere. Send learned this long ago
 * (send-details.tsx keeps a rent minimum back); Swap never did.
 *
 * So: Max fills balance minus the reserve for native SOL, the exact balance
 * for everything else, floored (never rounded up) at the token's decimals.
 * All arithmetic runs in RAW UNITS — floats only at the edges — so the
 * string Max fills is a number the chain can actually spend.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112"

/**
 * Mirrors the backend's minSolForFees (terminal.service.ts): the lamports a
 * SOL-input swap must leave behind for the transaction fee. If the backend
 * constant moves, this moves with it or Max starts bouncing again.
 */
export const SOL_FEE_RESERVE_LAMPORTS = 1_000_000

/** Exact-string balance → raw integer units. Round (not floor): the string
 *  is exact to `decimals` places, so the product is an integer up to float
 *  noise, and rounding removes exactly that noise. */
export function rawUnits(amountExact: string, decimals: number): number {
  const n = parseFloat(amountExact)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * Math.pow(10, decimals))
}

/** The raw units Max may fill: everything, minus the fee reserve when the
 *  asset being swapped away is the fee currency itself. */
export function swappableRaw(
  amountExact: string,
  decimals: number,
  mint: string | undefined,
): number {
  const raw = rawUnits(amountExact, decimals)
  const reserve = mint === SOL_MINT ? SOL_FEE_RESERVE_LAMPORTS : 0
  return Math.max(0, raw - reserve)
}

/** The same amount as a UI number, for validation comparisons. */
export function swappableUi(
  amountExact: string,
  decimals: number,
  mint: string | undefined,
): number {
  return swappableRaw(amountExact, decimals, mint) / Math.pow(10, decimals)
}

/** Trailing-zero trim that only ever works PAST a decimal point. The first
 *  version's regex made the dot optional, so a 0-decimals token's "500"
 *  lost its own zeros and Max filled "5" — review-caught, never shipped. */
function trimZeros(s: string): string {
  if (!s.includes(".")) return s
  return s.replace(/0+$/, "").replace(/\.$/, "")
}

/**
 * The string Max writes into the field: the swappable amount, floored at
 * the token's decimals, trailing zeros trimmed. Never scientific notation,
 * never a rounded-up digit.
 *
 * When no reserve applies, the answer IS the exact balance string, not a
 * float round trip of it — a 9-decimals token with a ten-billion balance
 * exceeds 2^53 raw units, where round-tripping overshoots by a unit or two
 * and the backend refuses money that does not exist.
 */
export function maxSwapFill(
  amountExact: string,
  decimals: number,
  mint: string | undefined,
): string {
  if (mint !== SOL_MINT) {
    const n = parseFloat(amountExact)
    if (!Number.isFinite(n) || n <= 0) return "0"
    return trimZeros(amountExact.trim())
  }
  const raw = swappableRaw(amountExact, decimals, mint)
  if (raw <= 0) return "0"
  return trimZeros((raw / Math.pow(10, decimals)).toFixed(decimals))
}
