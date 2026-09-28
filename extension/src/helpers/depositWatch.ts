import { USDC_MINT as EDITION_USDC_MINT } from "~/arc/chain"

/**
 * "YOU RECEIVED 1,000 USDC" — the decision half of the deposit watcher,
 * kept pure the way orderFillWatch keeps watchStep pure.
 *
 * The background polls GET /wallets/external-transfers with a cursor (the
 * last signature it has seen); the server answers only traffic Poppin did
 * not create itself — deposits in, external sends out — already classified
 * one-asset-one-direction. This file decides what to SAY about it and how
 * the cursor advances. Asked for in so many words: "poppin hesabıma fund
 * atınca you received 3 sol diye notification gelmesin mi?"
 *
 * Adversarially reviewed before shipping; three of its rules exist because
 * a reviewer broke the first draft:
 *
 * — GENESIS. A fresh wallet has no history, so the seed poll used to learn
 *   nothing and stay in seed state forever — and the seed rule then
 *   swallowed the user's FIRST deposit, the one this feature is for. The
 *   server now says `ok` (looked and saw) separately from `cursor` (what
 *   it saw), and an empty history seeds to GENESIS: everything after it
 *   deserves its toast.
 *
 * — SPOKEN SET. A reorged or lagging RPC node can fail to find the cursor
 *   and answer the newest window as if it were all new. The last spoken
 *   signatures are remembered, and nothing is said twice.
 *
 * — SPEAK RULES. Anybody can send dust or a token whose creator named it
 *   "USDC" to any visible wallet. A toast is Poppin's voice: it speaks
 *   only for money the product can name, above a floor, never for a
 *   symbol impersonating the canon, and at most a few per poll.
 */

export const DEPOSIT_CURSOR_KEY = "poppin_deposit_cursor"
export const DEPOSIT_SPOKEN_KEY = "poppin_deposit_spoken"
export const SPOKEN_CAP = 40
/** More than this per poll is a spam burst, not a morning of deposits. */
export const SPEAK_CAP = 3

/** Cursor value meaning "seeded at an empty history: announce everything
 *  that ever appears". Not a signature (signatures are base58, ~88 chars),
 *  so it can never collide with one. */
export const GENESIS = "genesis"

/**
 * The edition's USDC: the Solana mint in the store build, Arc's ERC-20
 * (lowercase) in the Arc edition, where arc-api reports every USDC transfer
 * under that address and never as a mintless native row.
 */
export const USDC_MINT: string = EDITION_USDC_MINT
export const SOL_MINT = "So11111111111111111111111111111111111111112"

export interface ExternalTransferRow {
  signature: string
  direction: "in" | "out"
  /** null = native SOL. */
  mint: string | null
  amountUi: number
  at: string | null
}

export interface TransferAnswer {
  /** True when the server actually looked at the chain — even if it saw
   *  nothing. False means "could not look": hold state, retry next tick. */
  ok: boolean
  cursor: string | null
  transfers: ExternalTransferRow[]
}

/**
 * One poll's verdict. Seed (no stored cursor) never announces: with
 * existing history it records where that history ends, with empty history
 * it records GENESIS — and from GENESIS on, everything is news.
 */
export function depositStep(
  prevCursor: string | null,
  answer: TransferAnswer,
): { notify: ExternalTransferRow[]; nextCursor: string | null } {
  if (!answer.ok) return { notify: [], nextCursor: prevCursor }
  if (prevCursor === null) {
    return { notify: [], nextCursor: answer.cursor ?? GENESIS }
  }
  return { notify: answer.transfers, nextCursor: answer.cursor ?? prevCursor }
}

/**
 * Whether this transfer deserves Poppin's voice at all. `symbol` and
 * `usdPrice` come from the caller's asset lookup (null when unresolved).
 *
 * The rules, each bought by an abuse scenario:
 * — SOL and USDC speak on their own names; any OTHER mint must resolve
 *   through the product's asset lookup or it stays quiet (airdrop spam is
 *   a stranger's ad, and an unnameable token is spam until proven money).
 * — A resolved symbol that IMPERSONATES the canon (a non-canonical mint
 *   calling itself USDC or SOL) is the attacker naming their own token
 *   after the money; it never speaks.
 * — Below a cent is a knock, not a deposit: USDC under $0.01, priced
 *   tokens under $0.01 of value, unpriced-but-named tokens stay quiet
 *   too — a toast that cannot say what the amount is worth is exactly
 *   the shape dust spam wants.
 */
export function shouldSpeak(
  t: ExternalTransferRow,
  symbol: string | null,
  usdPrice: number | null,
): boolean {
  if (t.mint === null) return true // SOL floor already applied server-side
  if (t.mint === USDC_MINT) return t.amountUi >= 0.01
  if (!symbol) return false
  const canon = symbol.trim().toUpperCase()
  if (canon === "USDC" || canon === "SOL" || canon === "WSOL" || canon === "USD")
    return false
  if (usdPrice === null || !(t.amountUi * usdPrice >= 0.01)) return false
  return true
}

/**
 * The amount, in the way its unit is actually spoken: dollars with two
 * places and thousands commas, SOL and tokens trimmed to what is real.
 */
export function fmtTransferAmount(amountUi: number, mint: string | null): string {
  if (mint === USDC_MINT) {
    return amountUi.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  const places = amountUi >= 1 ? 4 : 6
  return String(parseFloat(amountUi.toFixed(places)))
}

/**
 * Title carries the fact, message carries what it means here. The words a
 * wallet's money deserves: plain, warm, no jargon. `symbol` is resolved by
 * the caller (SOL, USDC, or the asset lookup's ticker).
 */
export function depositNotification(
  t: ExternalTransferRow,
  symbol: string,
  /** The ticker of the buy this deposit was for, when the reader pressed Deposit on one. */
  ready: string | null = null,
): { title: string; message: string } {
  const amount = fmtTransferAmount(t.amountUi, t.mint)
  if (t.direction === "in") {
    /**
     * "Ready when you are" is a promise the product keeps for USDC only —
     * a buy spends USDC alone. Saying it over an inbound SOL transfer was
     * the congratulation at the end of a mistake the deposit screen used to
     * invite: land SOL, be told it is ready, then meet "Deposit USDC" on
     * the next press. USDC lands ready; anything else lands, and says so.
     */
    const isUsdc = t.mint === USDC_MINT
    const tick = ready ? (ready.startsWith("$") ? ready : `$${ready}`) : null
    return {
      title: `Received ${amount} ${symbol}`,
      message: isUsdc
        ? tick
          ? `Your ${tick} buy is ready.`
          : "Landed in your Poppin balance. Ready when you are."
        : "In your wallet. Swap it to USDC to trade with it.",
    }
  }
  return {
    title: `Sent ${amount} ${symbol}`,
    message: "Left your Poppin wallet on chain.",
  }
}
