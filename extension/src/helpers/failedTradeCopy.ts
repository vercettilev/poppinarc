/**
 * WHAT A TRADE THAT NEVER HAPPENED SAYS IN THE READER'S HISTORY.
 *
 * Approved by Lev on 2026-09-26 (variant A). The row used to be missing
 * altogether: the server excludes failed trades so that a swap which never
 * landed is not shown as a purchase, and the price of that honesty was
 * silence. The first reader to walk the whole product pressed Buy, signed,
 * saw "confirming", and then the trade quietly left their list.
 *
 * The words are literal because money is involved (the product-language
 * rule), and the one that matters most is the reassurance: nothing was
 * spent. Amber, not red, because red on this ledger means a loss and there
 * was none. "Try again" rather than a Solscan link, because a transaction
 * that never reached the chain is exactly what Solscan cannot find.
 */
export interface FailedTradeCopy {
  verb: "Buy" | "Sell"
  status: string
  reassurance: string
  action: string
}

export function failedTradeCopy(side: "buy" | "sell"): FailedTradeCopy {
  return {
    verb: side === "sell" ? "Sell" : "Buy",
    status: "Didn't go through",
    // A failed buy spent nothing; a failed sell sold nothing, and the coin
    // is still held. The sentence has to be true for the side it is on.
    reassurance: side === "sell" ? "Nothing was sold" : "Nothing was spent",
    action: "Try again",
  }
}
