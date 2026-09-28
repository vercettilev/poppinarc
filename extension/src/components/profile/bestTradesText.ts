/**
 * THE WORDS ON A WIN CARD, kept apart from the card so they can be pinned.
 *
 * A figure, an asset, a return. The figure is the hero (rule 5) and rounds
 * the way the wins rail rounds; the asset is named ONCE, as a cashtag when
 * the catalog knows it and by the front of its address when it does not;
 * the return is shown only when the ledger walk could compute it — a null
 * is a missing number, never "▲ null" and never a made-up zero.
 */
import type { BestLot } from "~/services/SpotAssetService"

export const money = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`
    : `$${n.toFixed(n >= 100 ? 0 : 2)}`

/** The headline card is wide enough for the whole number, so it gets it. */
export const moneyExact = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const pctText = (p: number | null): string | null =>
  p === null ? null : `▲ ${p >= 1000 ? p.toFixed(0) : p.toFixed(p >= 100 ? 0 : 1)}%`

export const assetName = (lot: Pick<BestLot, "mint" | "symbol">) =>
  lot.symbol ? `$${lot.symbol}` : `${lot.mint.slice(0, 4)}…`

export const winCard = (lot: BestLot, headline = false) => ({
  figure: `+${headline ? moneyExact(lot.realizedUsd) : money(lot.realizedUsd)}`,
  asset: assetName(lot),
  pct: pctText(lot.pct),
})

/** Silent when there is nothing to show — for BOTH readers, identically. */
export const showVitrine = (wins: BestLot[] | null | undefined): wins is BestLot[] =>
  Array.isArray(wins) && wins.length > 0
