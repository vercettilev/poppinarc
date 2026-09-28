/**
 * WHEN SOMEBODY YOU FOLLOW TRADES — the rulebook that decides whether that
 * becomes a notification or stays a fact.
 *
 * A ping from a person you chose to follow is the strongest signal this
 * product can send, and the fastest way to lose it is to send it every time.
 * A notification that arrives constantly is filtered out within a day, and it
 * takes the one that mattered with it. So four rules, all of them here, all
 * of them testable without a browser:
 *
 * 1. CONSENSUS OVER CHATTER. Trades are grouped by ASSET, not by person.
 *    "Ada and 2 others bought $WIF" is one arrival that says more than three
 *    arrivals ever could — agreement between people is the news, not the
 *    individual act.
 *
 * 2. BUYS INVITE, SELLS INFORM. A buy is something the reader can join in one
 *    tap. A sell is only news if they HOLD the thing, and then it is real
 *    news; a sale of something they do not own is somebody else's business.
 *
 * 3. DUST STAYS QUIET. Below the floor it is not a conviction, it is a tap.
 *
 * 4. RARITY IS ENFORCED, not hoped for. One ping per asset per cooldown, and
 *    a ceiling per round. Both are anchored to what was ALREADY SAID rather
 *    than to what happened, so a loud hour cannot borrow against a quiet one.
 *
 * Deliberately NOT here: who to follow, when to poll, how to draw it. This
 * file turns rows into decisions and nothing else.
 */

export interface FollowTradeRow {
  userId: string
  name: string
  mint: string
  symbol: string | null
  side: "buy" | "sell"
  amountUsd: number
  at: number
}

/** What the reader holds, so a sell can be judged relevant. Mints only. */
export type HeldMints = ReadonlySet<string>

export interface SpokenMark {
  /** When we last said something about this mint. */
  at: number
}

export type SpokenMarks = Record<string, SpokenMark>

export interface FollowTradeNews {
  mint: string
  symbol: string | null
  side: "buy" | "sell"
  /** Distinct people, newest first. Never post counts. */
  names: string[]
  peopleCount: number
  totalUsd: number
  at: number
}

export const FOLLOW_MARKS_KEY = "poppin_follow_marks"
export const FOLLOW_SEEN_KEY = "poppin_follow_seen_at"

/** Below this a trade is a tap, not a conviction. */
export const DUST_USD = 10
/** One ping per asset per hour, however many people trade it. */
export const COOLDOWN_MS = 60 * 60 * 1000
/** A ceiling per round, so a busy hour cannot flood a quiet reader. */
export const MAX_PER_ROUND = 3

export function followTradeNews(input: {
  rows: readonly FollowTradeRow[]
  held: HeldMints
  marks: SpokenMarks
  now: number
}): { news: FollowTradeNews[]; nextMarks: SpokenMarks } {
  const { rows, held, marks, now } = input
  const nextMarks: SpokenMarks = { ...marks }

  // Group by mint AND side: somebody buying and somebody selling the same
  // asset in the same hour is two different pieces of news, and averaging
  // them into one line would report a crowd that does not exist.
  const groups = new Map<string, FollowTradeRow[]>()
  for (const r of rows) {
    if (!r?.mint || !Number.isFinite(r.amountUsd)) continue
    if (r.amountUsd < DUST_USD) continue
    // Rule 2: a sale only matters to somebody holding the thing.
    if (r.side === "sell" && !held.has(r.mint)) continue
    const key = `${r.side}:${r.mint}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }

  const candidates: FollowTradeNews[] = []
  for (const list of groups.values()) {
    // An asset nobody has spoken about yet is not "spoken about at epoch 0" —
    // the absent mark has to be its own case, or a fresh reader is silenced
    // by a cooldown that never started.
    const spokenAt = marks[list[0].mint]?.at
    if (spokenAt && now - spokenAt < COOLDOWN_MS) continue

    // Distinct people, newest first. One person trading the same asset five
    // times in an hour is one person, and saying "5 people" would be a lie
    // told by a GROUP BY.
    const seen = new Set<string>()
    const names: string[] = []
    let totalUsd = 0
    let at = 0
    for (const r of [...list].sort((a, b) => b.at - a.at)) {
      totalUsd += r.amountUsd
      at = Math.max(at, r.at)
      if (seen.has(r.userId)) continue
      seen.add(r.userId)
      names.push(r.name)
    }
    candidates.push({
      mint: list[0].mint,
      symbol: list[0].symbol,
      side: list[0].side,
      names,
      peopleCount: seen.size,
      totalUsd,
      at,
    })
  }

  // When more happened than the ceiling allows, the loudest agreement wins:
  // most people first, then most money. A cap that dropped the strongest
  // signal because it arrived second would be worse than no cap.
  candidates.sort(
    (a, b) => b.peopleCount - a.peopleCount || b.totalUsd - a.totalUsd,
  )
  const news = candidates.slice(0, MAX_PER_ROUND)
  for (const n of news) nextMarks[n.mint] = { at: now }
  return { news, nextMarks }
}

/** "$WIF" stays "$WIF"; a nameless mint becomes its first four characters. */
function ticker(symbol: string | null, mint: string): string {
  if (!symbol) return `${mint.slice(0, 4)}…`
  return symbol.startsWith("$") ? symbol : `$${symbol}`
}

/** "Lev", "Lev and 2 others": the same phrasing the room repeats, so the
 *  notification and the line it lands on cannot drift apart. */
export function people(names: string[], count: number): string {
  if (count === 1) return names[0]
  if (count === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]} and ${count - 1} others`
}

/**
 * The words. The name leads because the name is why this is worth reading —
 * "$WIF is moving" is a ticker alert, "Ada bought $WIF" is a person you chose.
 */
export function followTradeNotification(n: FollowTradeNews): {
  title: string
  message: string
} {
  const t = ticker(n.symbol, n.mint)
  const who = people(n.names, n.peopleCount)
  const usd = n.totalUsd >= 1000
    ? `$${(n.totalUsd / 1000).toFixed(1)}k`
    : `$${Math.round(n.totalUsd)}`
  /* A SELL INFORMS, A BUY INVITES, and that rule decides the verb. "Copy"
     is the word the whole category uses (eToro, Zerion, every Solana bot,
     measured 2026-09-19) and the one a reader already has a meaning for,
     so the buy says it. The sell keeps its own words: turning "somebody
     sold what you hold" into an invitation to sell is a nudge about the
     reader's own position, which this notification has never been. */
  if (n.side === "sell") {
    return {
      title: `${who} sold ${t}`,
      message: `${usd} worth, and you hold it. Tap to open ${t}.`,
    }
  }
  return {
    title: `${who} bought ${t}`,
    message:
      n.peopleCount > 1
        ? `${usd} between them. Tap to copy.`
        : `${usd} worth. Tap to copy.`,
  }
}
