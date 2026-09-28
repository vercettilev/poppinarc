/**
 * ONE TOTAL, ONE CAPTION, ONE SOURCE.
 *
 * The product had two "my money" headlines and they could disagree at the
 * same instant. The front door said "Portfolio value · positions + cash"
 * over the /spot/positions fold; the wallet screen said "TOTAL BALANCE"
 * over a different sum built from /wallet/tokens plus native SOL at a
 * second price source. Different sets, different prices, two numbers, no
 * explanation — on a money product, that reads as a bug in the money, not
 * a difference in scope (panel audit, 2026-09-20).
 *
 * The server's positions fold is the one that can be right: it scans the
 * wallet's token accounts, prices every mint it finds in one batch with a
 * last-good backstop, and hands back the USDC separately. Every surface
 * that names the reader's money now folds THAT response through this file,
 * so the only way two screens can disagree is if they asked at different
 * moments.
 *
 * NATIVE SOL IS NOT IN IT, on purpose. The response carries `solUsd`, but
 * nothing spends it: a buy is funded from USDC and only USDC. Wrapped SOL
 * someone actually bought is a position and is already in `totalUsd`.
 */
import type { SpotPositionsResponse } from "~/services/SpotAssetService"

/** The caption every surface prints above the number. Name the SCOPE: an
 *  unlabelled total invites the reader to compare it with a number that
 *  measures something else. */
export const PORTFOLIO_CAPTION = "Portfolio value · positions + cash"

/** Positions at their price, plus the cash. null in, null out — an answer
 *  we do not have is never rendered as zero. */
export function portfolioTotalUsd(
  r: Pick<SpotPositionsResponse, "totalUsd" | "cashUsd"> | null | undefined,
): number | null {
  if (!r) return null
  const positions = Number(r.totalUsd)
  const cash = Number(r.cashUsd)
  return (
    (Number.isFinite(positions) ? positions : 0) +
    (Number.isFinite(cash) ? cash : 0)
  )
}

/** The spendable half of the same answer, for the "Cash $X USDC" line. */
export function cashUsdOf(
  r: Pick<SpotPositionsResponse, "cashUsd"> | null | undefined,
): number | null {
  if (!r) return null
  const cash = Number(r.cashUsd)
  return Number.isFinite(cash) ? cash : 0
}
