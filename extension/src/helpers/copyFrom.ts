/**
 * WHAT BROUGHT THE READER HERE, KEPT FOR THE ROOM THEY ARRIVE IN.
 *
 * The followed-trade notification already says it all: "Lev bought $WIF ·
 * $250 worth." Tapping it opens that coin's room with the Buy sheet
 * already on, which is the whole of the industry's one-tap copy (Zerion's
 * flow, measured 2026-09-19: live signal, token page, today's price).
 *
 * But the sentence died at the door. The reader crossed from a
 * notification that named a person and an amount into a Buy sheet that
 * mentioned neither, and had to remember why they were there. So the news
 * is written down when the notification is raised and read back by the
 * room.
 *
 * NOT IN THE NOTIFICATION ID. The id already carries the side, the moment
 * and the mint, and the mint has to stay last for the shared click parser;
 * a person's name and an amount in there would be a fourth meaning in a
 * string three parsers already share.
 */
export const COPY_FROM_KEY = "poppinCopyFrom"

/** Older than this and it is history, not a reason to be standing here. */
export const COPY_FROM_TTL_MS = 24 * 60 * 60_000

export interface CopyFrom {
  mint: string
  side: "buy" | "sell"
  /** Who traded, already sentenced by followTrades' own `people()`. */
  who: string
  /** THEIR size, shown as context and never used as the reader's amount. */
  usd: number
  at: number
}

export function readCopyFrom(
  raw: unknown,
  mint: string,
  now = Date.now(),
): CopyFrom | null {
  const c = raw as CopyFrom | undefined
  if (!c || typeof c !== "object") return null
  if (c.mint !== mint) return null
  if (typeof c.at !== "number" || now - c.at > COPY_FROM_TTL_MS) return null
  if (c.side !== "buy" && c.side !== "sell") return null
  if (typeof c.who !== "string" || !c.who) return null
  return { mint: c.mint, side: c.side, who: c.who, usd: Number(c.usd) || 0, at: c.at }
}

/** "Lev bought $250 of this · 2m ago" — one line, the four facts, no more. */
export function copyFromLine(c: CopyFrom, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - c.at) / 60_000))
  const when =
    mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`
  const size = c.usd >= 1000 ? `$${(c.usd / 1000).toFixed(1)}k` : `$${Math.round(c.usd)}`
  return `${c.who} ${c.side === "sell" ? "sold" : "bought"} ${size} of this · ${when}`
}

/**
 * THE AMOUNT IS THE READER'S, NEVER THE TRADER'S.
 *
 * eToro scales a copy to the copier's own allocation and every Solana bot
 * asks for a fixed per-copy amount; not one of them spends the leader's
 * absolute size on the follower's behalf. Somebody else's $500 against a
 * $20 balance is a sheet that opens on "balance is short" (Lev, on the
 * same point: "onun beş yüz doları senin yirmi dolarına uymuyor").
 *
 * So the sheet opens on what THIS reader last spent, and on the middle
 * preset before they have spent anything.
 */
export const LAST_TRADE_USD_KEY = "poppinLastTradeUsd"
export const DEFAULT_COPY_USD = 25

export function copyAmountUsd(stored: unknown): number {
  const n = Number(stored)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COPY_USD
}
