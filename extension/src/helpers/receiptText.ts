import { compactUsd } from "~/helpers/tradeCard"

/**
 * THE RECEIPT READS THE SAME AGE-INDEPENDENT SENTENCE.
 *
 * A trade receipt's words are STORED on the post the moment the trade
 * lands, so the day the sentence changed, every receipt already in the
 * feed kept the old one forever. The feed is therefore two products at
 * once: new receipts say "PANTS $953 at $60.9M market cap", and every
 * older one still says "Bought 1,074,603.6105 $PANTS ($953.00) on x.com
 * via Poppin" — a nine-digit quantity, a verb the tag above it already
 * carries, and a provenance line the card already announces.
 *
 * Rewriting the rows would be the other way to fix this, and it is the
 * wrong one: it edits what a person's post SAID, and it cannot be undone.
 * This reads instead. The legacy sentence was machine-written to one exact
 * format, so it can be recognised with certainty and re-said in the new
 * shape at display time, leaving the stored words untouched.
 *
 * Certainty is the whole point of the strictness below: anything that is
 * not EXACTLY the machine's old sentence is returned verbatim, because a
 * near-miss is a human being's own words and those are never ours to edit.
 */

/**
 * The machine's old sentence, anchored end to end:
 *   Bought 1,074,603.6105 $PANTS ($953.00) on x.com via Poppin
 *
 * The host is not fixed: the chip wrote x.com, but the card wrote whatever
 * page the reader was standing on, so pinning this to x.com would have
 * left every receipt made anywhere else in the old words forever. It is
 * still tightly shaped — a bare hostname, no spaces — so the anchored
 * whole cannot swallow a sentence a person wrote.
 *
 * The ticker admits an optional leading $ for the same reason: the card
 * passed a symbol that already carried one, so those rows read "$$PANTS".
 * Quantity and dollars are grouped en-US, so both admit commas and a dot.
 */
const LEGACY =
  /^(Bought|Sold) ([\d,]+(?:\.\d+)?) \$\$?([^\s$()]+) \(\$([\d,]+(?:\.\d+)?)\) on [a-z0-9.-]+ via Poppin$/

/**
 * "953.00" -> "$953", "1,234.50" -> "$1,234.50".
 *
 * Cents are dropped only when they are ZERO — a resting whole number does
 * not need ".00" to be read as money. When they are not zero they are kept
 * in full: rounding the value through a Number first turns 1234.50 into
 * 1234.5, and "$1,234.5" reads as a number that got cut off rather than as
 * a price, which is the opposite of what dropping the zeros was for.
 */
const usdText = (raw: string): string => {
  const n = Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(n)) return `$${raw}`
  const whole = Math.round(n * 100) % 100 === 0
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`
}

/**
 * Returns the sentence to SHOW for a post. `content` unchanged unless it is
 * the machine's legacy receipt, in which case it is re-said in today's shape.
 *
 * `mcapUsd` is THE TRADE'S OWN market cap, read back out of the ledger by
 * the API (spot_trades joined to the receipt by signature) - never re-read
 * from today's market, which would price a months-old trade at today's
 * size. When the ledger has no answer, and for every row written before it
 * captured caps at all, the sentence simply stops early. That is the same
 * rule the live receipt follows, so old and new read as one product.
 */
export function receiptText(
  content: string,
  hasTransaction: boolean,
  mcapUsd?: number | null,
): string {
  // Only a post the ledger vouched for can be a receipt at all.
  if (!hasTransaction) return content
  const m = LEGACY.exec(content.trim())
  if (!m) return content
  const [, verb, qty, sym, usd] = m
  const at =
    typeof mcapUsd === "number" && mcapUsd > 0
      ? ` at ${compactUsd(mcapUsd)} market cap`
      : ""
  // A buy is remembered by what it cost; a sell by what left the wallet,
  // which is the same split today's receipt makes.
  return verb === "Bought"
    ? `${sym} ${usdText(usd)}${at}`
    : `${sym} ${qty}${at}`
}
