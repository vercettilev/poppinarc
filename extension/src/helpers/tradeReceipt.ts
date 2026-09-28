import { compactUsd } from "./tradeCard"
import { qtyText } from "./qtyText"

/**
 * WHAT A TRADE RECEIPT SAYS, in one place.
 *
 * Three surfaces now write receipts into the feed — the X chip, the page
 * card, and the wallet's Swap — and for a while the first two each carried
 * their own copy of this sentence. They drifted the moment one was
 * rewritten: the same trade said "PANTS $953 at $60.9M market cap" from the
 * chip and "Bought 1,074,603.6105 $PANTS ($953.00) on x.com via Poppin"
 * from the card, so one feed showed two products depending on where the
 * reader happened to press Buy. A third writer with a third copy would have
 * made that certain rather than likely.
 *
 * WHAT THE SENTENCE IS FOR. A reader of somebody else's trade wants the
 * SIZE OF THE BET and the SIZE OF THE THING. The quantity is nine digits
 * nobody can hold in their head, the verb is already on the tag above, and
 * the provenance is already announced by the card, so none of them are
 * here. Market cap is the memecoin-native unit — a price per token says
 * nothing on its own — and it is the trade's OWN, caught when it happened.
 */
export interface ReceiptFacts {
  /** With or without the leading $; one is stripped either way. */
  symbol: string
  side: "buy" | "sell"
  /** Dollars that moved. A sell that has not settled yet may send 0. */
  usd: number
  /** Asset units, used only when the dollars are not known yet. */
  tokens: number
  /** The market cap at trade time. Absent is normal, not an error. */
  mcap?: number | null
}

/**
 * Cents are dropped only when they are ZERO. Rounding through a Number
 * first turns 1234.50 into 1234.5, and "$1,234.5" reads as a number that
 * got cut off rather than as a price — the opposite of what dropping the
 * zeros was for.
 */
const usdText = (n: number): string => {
  const whole = Math.round(n * 100) % 100 === 0
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`
}

export function receiptSentence(t: ReceiptFacts): string {
  const sym = t.symbol.replace(/^\$+/, "")
  /**
   * Absent, the sentence simply STOPS EARLY rather than inventing one.
   * Re-reading a cap later would price a months-old trade at today's size.
   */
  const at =
    typeof t.mcap === "number" && t.mcap > 0
      ? ` at ${compactUsd(t.mcap)} market cap`
      : ""
  /**
   * A buy is remembered by what it cost. A sell has no settled dollar
   * figure until the chain says so, so it says the quantity that actually
   * left the wallet instead of a zero that would read as a free trade.
   */
  const size =
    t.side === "buy" && t.usd > 0
      ? usdText(t.usd)
      : qtyText(t.tokens)
  return `${sym} ${size}${at}`
}
