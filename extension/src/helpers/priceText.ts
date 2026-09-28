/**
 * A PRICE, IN THE NUMBER OF DIGITS A PERSON READS.
 *
 * "$0.283814" was the chip printing everything it knew. Six decimals on a
 * 28-cent token is a wall, it takes the row's whole attention, and it is
 * the single thing that made the strip read as a terminal readout rather
 * than a product. Nobody decides anything with the sixth digit.
 *
 * SIGNIFICANT FIGURES, NOT DECIMALS. Four carries every decision at every
 * magnitude — $96.80, $0.2838, $0.00007061 — where a fixed decimal count
 * is either a wall at one end or a lie at the other. Below a cent the
 * leading zeros are not digits, they are a magnitude, so they do not count
 * against the budget.
 *
 * AND FIXED WIDTH WITHIN A MAGNITUDE, which is the half worth keeping from
 * the previous rule: a live price that gains and loses a digit as it ticks
 * makes the whole row breathe, and a row that breathes on somebody else's
 * feed is a fidget. The digit COUNT is decided by magnitude, and it only
 * changes when the magnitude does.
 */

/** How many figures actually carry a decision. */
const SIG = 4

export function priceText(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00"

  // At or above a dollar, money convention wins: cents, always both.
  if (usd >= 1) {
    return `$${usd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  // Below a dollar the leading zeros are the magnitude, not information.
  // 0.2838 -> 4 decimals; 0.00007061 -> 8. Both show four real figures.
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(usd)) - 1)
  const dp = Math.min(12, leadingZeros + SIG)
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`
}
