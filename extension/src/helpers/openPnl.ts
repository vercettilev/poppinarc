/**
 * WHICH P&L A MONEY SURFACE SHOWS, decided once.
 *
 * The product has two P&L concepts and they are not interchangeable:
 *
 *   totalUnrealizedPnlUsd — what the OPEN book is doing right now.
 *   totalPnlUsd           — realized and unrealized folded together, so it
 *                           keeps counting money the reader already took
 *                           out of the market.
 *
 * helpers/youPanelView.ts settled this in the chip's own words: "a reader
 * holding $1.59 of one coin saw '−$954.89 · All time', a number about
 * trades that are over, in the biggest type on the surface. Asked for by
 * name from the field (ora UnPNL olmalı)." The chip and the panel's front
 * door both took the fix. The profile's PORTFOLIO card did not, and it
 * reached production: a live screenshot on 2026-09-20 shows "$3.55" beside
 * an unlabelled red "−$1,276.44", on a book whose realized figure the same
 * card prints as "−$1.25 banked".
 *
 * WHY THIS IS NOT headline() FROM youPanelView. That function answers a
 * different question: the chip's hero IS the P&L, so it needs a value to
 * fall back to and a half-cent floor to decide when there is no score yet.
 * On a surface whose headline is the portfolio VALUE, the P&L is a second
 * line under it, and a flat open book saying "+$0.00" there is honest.
 * Same preference, different floor, and the difference is deliberate.
 */
import type { SpotPositionsResponse } from "~/services/SpotAssetService"

type Book = Pick<
  SpotPositionsResponse,
  "totalPnlUsd" | "totalUnrealizedPnlUsd"
>

export type OpenPnl = { usd: number; kind: "unrealized" | "alltime" } | null

/**
 * The open book first, the all-time figure only when the server did not
 * send one — an older server, never a preference. null stays null: no P&L
 * is not a P&L of zero.
 */
export function openPnl(book: Book | null | undefined): OpenPnl {
  if (!book) return null
  const un = book.totalUnrealizedPnlUsd
  if (typeof un === "number" && Number.isFinite(un)) {
    return { usd: un, kind: "unrealized" }
  }
  const all = book.totalPnlUsd
  if (typeof all === "number" && Number.isFinite(all)) {
    return { usd: all, kind: "alltime" }
  }
  return null
}

/**
 * NAME WHICH ONE IT IS. The front door already says "on what you hold"
 * beside its figure; the profile card said nothing at all, which is how an
 * all-time number got to sit on a surface reading as today's.
 */
export function pnlCaption(p: OpenPnl): string {
  return p?.kind === "alltime" ? "all time" : "on what you hold"
}
