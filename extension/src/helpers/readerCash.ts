/**
 * DOES THE READER HAVE MONEY TO TRADE WITH — and the third answer, which is
 * neither yes nor no.
 *
 * WHY THIS EXISTS. Measured 2026-09-21: seven strangers have ever signed in.
 * Their whole history is panel opens of 0,1,1,2,3,1,1; the funding screen was
 * opened by none of them, traded on by none of them, and no deposit has ever
 * landed. Funding was deliberately moved out of onboarding and asked "at the
 * first trade" instead (entries/welcome/App.tsx) — a theory that needs
 * somebody to attempt a trade, and nobody does. So the ask moves to the one
 * screen every session already opens, and the condition is the BALANCE rather
 * than the sign-in method: a wallet account that already holds USDC is spared
 * without a special case, and a custodial account stops being asked the
 * moment its deposit lands.
 *
 * THE WHOLE POINT OF THIS FILE IS THE UNKNOWN CASE. `cashUsd` is typed
 * `number` on the wire and is not one until the server has answered: a book
 * that has not loaded, a read that failed, an older server that omits the
 * field. `?? 0` turns every one of those into "this reader has no money", and
 * a funding prompt over an unknown balance lands on precisely the person who
 * has just funded — the one reader the prompt exists to stop bothering. An
 * unknown balance is null here, and null is never nothing.
 *
 * NaN PASSES A NULL CHECK (`NaN == null` is false), so the question asked is
 * Number.isFinite and not a comparison against null or undefined. That
 * shortcut has shipped a wrong number to production in this repo before.
 */

/** Anything carrying a cash figure, including a response that carries none. */
export type CashBook = { cashUsd?: number | null } | null | undefined

/** The spendable balance the server actually stated, or null when it did not. */
export function knownCashUsd(book: CashBook): number | null {
  const cash = book?.cashUsd
  return typeof cash === "number" && Number.isFinite(cash) ? cash : null
}

/**
 * Known to hold nothing spendable. An unknown balance answers false, which is
 * what keeps the funding door off a screen that is still loading one.
 */
export function hasNoCash(book: CashBook): boolean {
  const cash = knownCashUsd(book)
  return cash !== null && cash <= 0
}
