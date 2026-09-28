/**
 * HOW MUCH OF A THING, WRITTEN SO IT IS NOT A LIE.
 *
 * One rule, in one place, because it was learned twice and applied once.
 *
 * TradeHistory worked it out first and wrote the reason down: four fraction
 * digits print any quantity under 0.00005 as zero, which turns a receipt into
 * a claim that nothing was traded at a price. The inline buy under a tweet
 * never got the memo, and on 2026-09-11 a real $1.00 purchase of Bitcoin
 * — 0.0000127 WBTC at $78,968 — came back as:
 *
 *     ✓ $1.00 → 0 WBTC
 *
 * Money moved, the chain agreed, and the only sentence the reader got said
 * they had received nothing. Every high-priced asset does this: the catalog
 * now resolves $BTC properly, which is precisely what made it visible.
 *
 * Three bands, and the reason for each:
 *
 *   >= 1000   no fraction at all. Nobody reads 1,240.0000 ORE, and the
 *             fourth decimal of a thousand-unit position is noise.
 *   >= 1      two places, trailing zeros dropped. This file said four and
 *             the You tab said two, so a buy of 12.3456 read "12.3456" on
 *             the receipt and "12.35" one tap later in Holdings. One rule
 *             now, and the shorter one: the third and fourth decimal of a
 *             twelve-unit position are noise on every surface.
 *   < 1       significant digits, not fractions. This is the band that was
 *             broken: what matters below one is the first few digits that
 *             are not zero, however far down they start.
 */
export const qtyText = (n: number): string => {
  if (!Number.isFinite(n)) return "—"
  if (n === 0) return "0"
  const abs = Math.abs(n)
  // Whole units from a thousand up, and from 999.995 up, which two places
  // would have printed as "1000.00" without the thousands mark.
  if (abs >= 999.995) return Math.round(n).toLocaleString("en-US")
  // Two places, then trailing zeros go: "12.40" is a price's habit, not a
  // quantity's, and "12.00" of something is twelve of it.
  if (abs >= 1) return n.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
  // Below one, three significant figures rather than two decimals: this is
  // the band that printed a real purchase as 0.
  const places = Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(abs))))
  return n.toFixed(places).replace(/0+$/, "").replace(/\.$/, "")
}
