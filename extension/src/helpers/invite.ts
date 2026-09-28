/**
 * WHERE THE INVITE DOOR STANDS, AND WHY IT MOVED.
 *
 * It used to stand behind the first landed trade everywhere (2026-09-17: an
 * invite from someone who has not used the product is "try it, I don't
 * know", and accounts that spread links without trading are the farming
 * profile). Measured 2026-09-19: 2,532 accounts, 45 codes ever minted,
 * ZERO accounts arrived through a link and ZERO links were ever copied,
 * because exactly one account has ever traded. A filter on a funnel nobody
 * enters filters nothing, so Lev lifted it for the panel.
 *
 * Today: the PANEL's front door carries the invite row for everyone,
 * before any trade (components/InviteRow.tsx). On the CHIP the trade
 * moment is still the moment, but it is every receipt now rather than the
 * first one in a lifetime, and the Holdings row still opens on the first.
 * This key is what records that first landing.
 */
export const FIRST_TRADE_KEY = "poppin_first_trade_landed"

export const inviteLink = (code: string) => `https://poppin.so/join/${code}`

/** The earnings sentence: cents are not shown, they read as an insult. */
export function earnedText(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)} earned` : "nothing earned yet"
}

export function joinedText(n: number): string {
  return `${n} joined`
}
