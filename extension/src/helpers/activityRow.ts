import { USDC_MINT } from "~/helpers/depositWatch"
import { NATIVE_SYMBOL, shortAddress } from "~/arc/chain"

/**
 * WHAT ONE ROW OF THE ACTIVITY LIST SAYS.
 *
 * Two things were wrong on this list, and both came from the same habit:
 * the number and the unit were fetched from different places and nobody
 * checked they agreed.
 *
 * A swap row read "Swapped Swap" with a bare unlabelled number beside it.
 * The word was a placeholder standing in for a token symbol, and the
 * number was the row's `amount` column, which for a swap is RAW input
 * units (terminal.service writes `quote.inAmount`) while every other
 * writer on that column writes UI units. So a $10 buy rendered as
 * "10000000.00" with nothing after it to say what those were.
 *
 * The fix is not a better label for `amount`. It is to stop reading it:
 * the swap's metadata carries both legs, and under USDC pinning one leg is
 * always USDC, whose 6 decimals are a constant we do not have to look up.
 * That leg is also the one the reader wants — a buy cost dollars, a sell
 * returned them. Works on rows already in the database; no migration.
 *
 * A pre-pinning token-to-token row has no USDC leg and therefore no honest
 * dollar figure. It says what it was and states no amount, rather than
 * picking a side.
 *
 * DIRECTION IS ABOUT THE ROW'S SUBJECT, not about dollars: green when the
 * thing named enters the wallet, red when it leaves. That is the house
 * rule ("green in, red out"), and it keeps Bought/Received on one side and
 * Sold/Sent on the other instead of colouring a buy by what its money did.
 */

export interface ActivityTxLike {
  transaction_type: string
  amount: string
  token_mint?: string | null
  metadata?: string | Record<string, unknown> | null
}

export interface ActivityRow {
  /** Bought / Sold / Swapped / Sent / Received. */
  verb: string
  /** What the verb acted on: a symbol, a pair, "SOL", "NFT". */
  subject: string
  /** Ready to print. "" when no amount can be stated honestly. */
  amountText: string
  kind: "buy" | "sell" | "swap" | "send" | "receive"
  /** Does the subject enter or leave the wallet? null = we cannot say. */
  direction: "in" | "out" | null
}

const USDC_DECIMALS = 6

/** A mint we cannot name reads as itself, not as the word "TOKEN". Nobody
 *  holds a token called TOKEN, and a pump.fun mint's own tail is more
 *  recognizable to its holder than a placeholder is. */
export const shortMint = (mint: string): string =>
  mint.length > 12 ? (mint.startsWith("0x") ? shortAddress(mint) : `${mint.slice(0, 4)}…${mint.slice(-4)}`) : mint

/** Memecoin quantities run to seven figures. Past a thousand the decimals
 *  are noise and the separators are the whole point. */
export const tokenCountText = (n: number): string =>
  n >= 1000
    ? Math.round(n).toLocaleString("en-US")
    : n.toFixed(n >= 1 ? 2 : 4)

const asNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : null
}

const parseMeta = (
  meta: ActivityTxLike["metadata"],
): Record<string, unknown> | null => {
  if (!meta) return null
  if (typeof meta !== "string") return meta
  try {
    const parsed = JSON.parse(meta)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function activityRow(
  tx: ActivityTxLike,
  /** Resolve a mint to a symbol; return null when it is not known. */
  symbolOf: (mint: string) => string | null,
): ActivityRow {
  const name = (mint: string) => symbolOf(mint) || shortMint(mint)

  if (tx.transaction_type === "swap") {
    const meta = parseMeta(tx.metadata)
    const inMint = typeof meta?.inputMint === "string" ? meta.inputMint : null
    const outMint = typeof meta?.outputMint === "string" ? meta.outputMint : null
    const usd = (raw: unknown) => {
      const n = asNumber(raw)
      return n === null ? "" : `$${(n / 10 ** USDC_DECIMALS).toFixed(2)}`
    }

    if (inMint === USDC_MINT && outMint) {
      return {
        verb: "Bought",
        subject: name(outMint),
        amountText: usd(meta?.inputAmount),
        kind: "buy",
        direction: "in",
      }
    }
    if (outMint === USDC_MINT && inMint) {
      return {
        verb: "Sold",
        subject: name(inMint),
        amountText: usd(meta?.outputAmount),
        kind: "sell",
        direction: "out",
      }
    }
    // Either a legacy token-to-token swap, or metadata we cannot read.
    // Name what we can, claim no number.
    return {
      verb: "Swapped",
      subject:
        inMint && outMint
          ? `${name(inMint)} → ${name(outMint)}`
          : tx.token_mint
            ? name(tx.token_mint)
            : "tokens",
      amountText: "",
      kind: "swap",
      direction: null,
    }
  }

  const outgoing = tx.transaction_type.startsWith("send")
  const value = asNumber(tx.amount) ?? 0
  const subject = tx.transaction_type.includes("nft")
    ? "NFT"
    : tx.token_mint
      ? name(tx.token_mint)
      : // A mintless row is the chain's native money: SOL, or USDC on Arc.
        NATIVE_SYMBOL

  return {
    verb: outgoing ? "Sent" : "Received",
    subject,
    amountText: `${outgoing ? "-" : "+"}${tokenCountText(value)} ${subject}`,
    kind: outgoing ? "send" : "receive",
    direction: outgoing ? "out" : "in",
  }
}
