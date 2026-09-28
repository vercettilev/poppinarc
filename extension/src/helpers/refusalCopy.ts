/**
 * WHAT A READER IS SHOWN WHEN THE SERVER SAYS NO.
 *
 * Every trade surface printed the server's own message whenever it was
 * under 120 characters, and half of those messages are written for us:
 * "a positive amountUsd is required", "mint and a raw integer amountRaw are
 * required", "Trade would fail on-chain — Error processing Instruction 3".
 * Measured 2026-09-26: a new reader's first two buys each ended on
 * "a positive amountUsd is required", printed in red under the chip.
 *
 * The rule: a message passes through only when it reads like a sentence
 * written for a person. The known developer messages get a sentence of
 * their own, and anything else that looks like a log line gets the caller's
 * fallback. The raw message is not lost: callers keep it for telemetry.
 */

/** Known refusals, in order, each with the sentence a reader can act on.
 *  A null sentence means "no better words than the caller's fallback". */
const KNOWN: ReadonlyArray<[RegExp, string | null]> = [
  [/positive amountUsd/i, "Type an amount first."],
  [/amountRaw|Sell order needs an amount/i, "Pick how much to sell first."],
  [/triggerPriceUsd|Trigger price must be a positive number/i, "Type a price first."],
  [/slippage|0x1771|\b6001\b/i, "The price moved while you pressed. Try again."],
  [/would fail on-chain|failed verification/i, null],
  [/^User wallet not found/i, null],
  [/^Which wallet\?/i, null],
  [/^That signature is not this /i, null],
]

/** A sentence for a person: starts with a capital, names no code. */
function readsAsASentence(message: string): boolean {
  /* A wallet shortened to "4AnB…r8ss" is ours on purpose (the wrong-wallet
     sentence names it), and a base58 slice can look like camelCase. */
  const m = message.replace(/\([^()]*…[^()]*\)/g, "")
  if (!/^[A-Z]/.test(m)) return false
  // camelCase or snake_case identifiers: amountUsd, orderKey, cohort_rank
  if (/\b[a-z]+[A-Z][A-Za-z]*\b/.test(m) || /[a-z]_[a-z]/i.test(m)) return false
  // a raw error appended after a dash, the way the server wraps a cause
  if (/\s[—-]\s/.test(m)) return false
  if (/\b(null|undefined|NaN|TypeError|fetch|HTTP|status code|JSON|RPC|Instruction)\b/i.test(m)) return false
  if (/0x[0-9a-f]{2,}/i.test(m)) return false
  return true
}

export function plainReason(raw: string | undefined | null, fallback: string): string {
  const m = typeof raw === "string" ? raw.trim() : ""
  if (!m || m.length >= 120) return fallback
  for (const [pattern, sentence] of KNOWN) {
    if (pattern.test(m)) return sentence ?? fallback
  }
  return readsAsASentence(m) ? m : fallback
}

/** The message an error carries, whatever shape it arrived in. */
export function messageOf(e: unknown): string | undefined {
  const m = (e as { message?: unknown })?.message
  return typeof m === "string" && m.length > 0 ? m : undefined
}
