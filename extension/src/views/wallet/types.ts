/**
 * Shared wallet view types. Split out of wallet-ui.tsx with V2-PLAN.md Faz D —
 * the 5,481-line single file is now a directory of one-component files, and
 * this is the one type they all read.
 */
export interface Token {
  name: string
  symbol: string
  amount: string
  value: string
  change: string
  icon: string
  iconBg: string
  mint?: string
  logoURI?: string
  decimals?: number
  /**
   * The balance as a NUMBER-FAITHFUL string, for arithmetic. `amount` is a
   * display string and toFixed(4) ROUNDS — 3.020272 SOL renders "3.0203",
   * which is more SOL than the wallet holds, and the Swap screen's Max used
   * to submit exactly that. Anything computing a spendable/swappable amount
   * reads this field (falling back to `amount` for rows that predate it);
   * anything painting a row keeps using `amount`.
   */
  amountExact?: string
}
