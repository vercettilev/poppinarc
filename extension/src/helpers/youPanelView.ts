/**
 * WHAT THE "YOU" PANEL SAYS, decided away from the DOM.
 *
 * The panel is a scoreboard: one big number, then what you hold and what
 * it is worth. All of that is arithmetic and rules about missing data, and
 * none of it is markup — so it lives here, where it can be argued with in
 * a test instead of read off a screenshot.
 *
 * ── THE ONE RULE THAT KEEPS COMING BACK ─────────────────────────────────
 * UNKNOWABLE IS NEVER ZERO. A position whose basis predates the ledger has
 * a null P&L, and printing "$0.00" for it tells a reader they broke even
 * when the truth is that nobody knows. Every field below is nullable for
 * that reason and every formatter answers "—" rather than a number it does
 * not have. This is the same rule `totalPnlUsd` was already documented
 * with; the panel just has more places to break it.
 */

/**
 * Deliberately as loose as the wire. Every priced field is optional AND
 * nullable, because a host that predates this panel sends none of them and
 * the server sends null for anything it could not price. One shape for
 * both, so nothing has to be normalised twice or asserted with `as`.
 */
export interface YouPosition {
  mint: string
  ticker?: string
  uiAmount: number
  priceUsd?: number | null
  valueUsd?: number | null
  pnlUsd?: number | null
}

export interface YouBook {
  cashUsd: number
  totalUsd?: number
  totalPnlUsd?: number | null
  /** What the OPEN book is up or down right now. The hero reads this. */
  totalUnrealizedPnlUsd?: number | null
  positions: YouPosition[]
}

/**
 * The headline, which is the whole point of the panel.
 *
 * P&L when there is one, because that is the number people open this for.
 * Portfolio value when the ledger cannot compute a P&L — a fresh account
 * has holdings worth something and no basis to judge them against, and
 * "$0.00" in the biggest type on the surface would be a lie in the loudest
 * available voice.
 */
export type Headline =
  | { kind: "unrealized"; usd: number }
  | { kind: "pnl"; usd: number }
  | { kind: "value"; usd: number }
  | { kind: "unknown" }

export function headline(book: YouBook): Headline {
  /**
   * UNREALIZED FIRST — what the OPEN book is doing right now.
   *
   * The hero used to be totalPnlUsd, which folds realized and unrealized
   * together and so keeps counting money the reader already took out: a
   * reader holding $1.59 of one coin saw "−$954.89 · All time", a number
   * about trades that are over, in the biggest type on the surface. Asked
   * for by name from the field ("ora UnPNL olmalı"), and it is the number
   * a holder actually watches. Banked stays in the caption, where what is
   * already yours belongs.
   *
   * Falls back to the all-time figure for an older server that does not
   * send the unrealized total, so the panel never loses its headline.
   */
  const un = book.totalUnrealizedPnlUsd
  if (un !== null && un !== undefined && Math.abs(un) >= 0.005) {
    return { kind: "unrealized", usd: un }
  }
  const pnl = book.totalPnlUsd
  // Half a cent, matching the resting chip's own threshold: a P&L that
  // rounds to zero is a scoreboard nobody has played on yet.
  if (
    (un === null || un === undefined) &&
    pnl !== null &&
    pnl !== undefined &&
    Math.abs(pnl) >= 0.005
  ) {
    return { kind: "pnl", usd: pnl }
  }
  const holdings = book.positions.reduce(
    (sum, p) => (p.valueUsd == null ? sum : sum + p.valueUsd),
    0,
  )
  // Holdings + USDC. Adding the SOL balance made the hero larger than the
  // sum of every row beneath it, while the cash line right under it says
  // "USDC $12.40" — the headline and the detail disagreed by the SOL.
  const total = holdings + book.cashUsd
  if (total > 0) return { kind: "value", usd: total }
  return { kind: "unknown" }
}

/** "$12.40", "−$1.86", "+$3.02" — signed only when a sign means something. */
export function usdText(usd: number, signed: boolean): string {
  const abs = Math.abs(usd)
  // GROUPED. "$1234.56" is a bank statement's number; a person reads
  // "$1,234.56" without counting digits, and the scoreboard's whole job is
  // to be read at a glance.
  const body = `$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  if (!signed) return body
  // The minus is U+2212, not a hyphen: at 20px a hyphen next to a dollar
  // sign reads as a dash between two words.
  return usd < 0 ? `−${body}` : `+${body}`
}

/**
 * A holding's quantity, at a precision that survives both ends of this
 * market. 12.4 of something is not 12.400000, and 0.0000031 of something
 * is not 0.00 — a memecoin position rounded to two places reads as
 * nothing at all, which is how a reader concludes they own nothing.
 */
export { qtyText } from "./qtyText"

/** Biggest first, because a scoreboard is ordered by what matters. */
export function rankPositions<T extends YouPosition>(positions: T[]): T[] {
  return [...positions].sort((a, b) => {
    // A position we cannot price is not "worth zero", it is unranked, so it
    // sorts to the bottom rather than competing with real numbers.
    const av = a.valueUsd ?? -1
    const bv = b.valueUsd ?? -1
    if (av !== bv) return bv - av
    return (a.ticker ?? a.mint).localeCompare(b.ticker ?? b.mint)
  })
}
