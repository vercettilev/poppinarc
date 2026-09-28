import { decimalsFor } from "./tradeSheetModel"

/**
 * A STANDING ORDER THAT FILLS MUST SAY SO.
 *
 * Measured before building: nothing in the codebase mentioned a fill.
 * A reader parked money on a trigger, the keepers executed it, and the
 * product said nothing — the next session opened on a position they could
 * not explain. The one moment the product provably worked FOR the reader
 * while they were away was the one moment it stayed silent.
 *
 * ── WHY DETECTION LIVES IN THE EXTENSION, NOT THE BACKEND ──────────────────
 * The backend does not store orders; it proxies Jupiter per request. Fill
 * detection server-side would mean a cron scanning every wallet — a new
 * standing process, the exact thing this product has declined before (see
 * the stop-loss note in orderMath). The extension already runs an alarm
 * loop, the fill only matters to the order's owner, and the owner is
 * precisely the person running this extension. So: the background polls the
 * same authenticated endpoint every surface uses, remembers which orderKeys
 * were active, and treats a vanished key as a question for the history list.
 *
 * Limit stated honestly: with the browser fully closed, nothing polls; the
 * notification then arrives on the next browser start, when the alarm first
 * fires and the diff still detects the vanished key. Later, not lost.
 *
 * This module is the PURE half — diff, classify, compose the words. The
 * chrome.* glue stays in the background entry where it cannot be unit
 * tested, and stays thin for exactly that reason.
 */

export interface WatchedOrder {
  orderKey: string
  mint: string
  side: "buy" | "sell"
  /** Buys are sized in dollars… */
  amountUsd: number | null
  /** …sells in units of the asset. */
  amountUi: number
  triggerPriceUsd: number
  symbol: string | null
  /** Jupiter's own status string, passed through the backend untouched. */
  status?: string
}

/** The alarm's name and cadence, shared with the background entry. */
export const ORDER_WATCH_ALARM = "checkOrderFills"
/**
 * Two minutes, not one: each poll fans out on the backend (Jupiter list +
 * price + token stats per mint), and a fill announced ninety seconds late
 * is still a surprise gift. The notification badge alarm stays at its own
 * cadence; this one is deliberately slower.
 */
export const ORDER_WATCH_PERIOD_MIN = 2

/**
 * Jupiter's history statuses are strings we do not control ("Completed",
 * "Cancelled" observed in their API docs; casing theirs). Matched loosely,
 * and in the SILENT direction on anything unrecognised: a wrong "your order
 * filled" is a lie about money, a missed one is caught by the next surface
 * that lists the book.
 */
export function classifyStatus(status: string | undefined): "filled" | "silent" {
  if (!status) return "silent"
  return /complet|fill|execut/i.test(status) ? "filled" : "silent"
}

/**
 * One watch step: which orders vanished from the active list, and which of
 * those the history list says were EXECUTED (rather than cancelled by the
 * reader or expired).
 *
 * `prevKeys === null` is the seed run — nothing is reported, because on a
 * fresh install every existing order would otherwise "vanish" into a burst
 * of notifications about fills that never happened.
 */
export function watchStep(args: {
  prevKeys: string[] | null
  active: WatchedOrder[]
  /** Fetched by the caller only when something vanished; [] otherwise. */
  history: WatchedOrder[]
}): { fills: WatchedOrder[]; nextKeys: string[] } {
  const nextKeys = args.active.map((o) => o.orderKey)
  if (args.prevKeys === null) return { fills: [], nextKeys }

  const still = new Set(nextKeys)
  const vanished = args.prevKeys.filter((k) => !still.has(k))
  if (vanished.length === 0) return { fills: [], nextKeys }

  const byKey = new Map(args.history.map((o) => [o.orderKey, o]))
  const fills = vanished
    .map((k) => byKey.get(k))
    .filter((o): o is WatchedOrder => o !== undefined)
    .filter((o) => classifyStatus(o.status) === "filled")
  return { fills, nextKeys }
}

function fmtPrice(usd: number): string {
  return usd.toLocaleString("en-US", { maximumFractionDigits: decimalsFor(usd) })
}

/**
 * The words on the notification. A fill is the product's best moment, so the
 * first line says the outcome plainly and the second says the price — and
 * "or better" is not garnish, it is the trigger contract: keepers fill at
 * the trigger price or a price more favourable, never worse.
 */
export function fillNotification(o: WatchedOrder): { title: string; message: string } {
  const name = o.symbol ? `$${o.symbol.replace(/^\$/, "")}` : `${o.mint.slice(0, 4)}…`
  if (o.side === "buy") {
    return {
      title: `Order filled: bought ${name}`,
      message: `$${o.amountUsd ?? 0} at $${fmtPrice(o.triggerPriceUsd)} or better`,
    }
  }
  return {
    title: `Order filled: sold ${name}`,
    message: `${o.amountUi.toLocaleString("en-US", {
      maximumFractionDigits: 6,
    })} ${name} at $${fmtPrice(o.triggerPriceUsd)} or better`,
  }
}

/**
 * ── THE CELEBRATION, AND WHY IT RIDES STORAGE RATHER THAN THE CLICK ────────
 * The OS notification is a doorbell, not the delivery. If the fill moment
 * only existed on the notification click, a reader who opened the panel by
 * themselves, or whose browser was closed when the fill landed, would never
 * see it. So the background WRITES each fill here, and the panel greets any
 * unseen fill for the asset it is looking at, however it got there. Seen
 * means deleted; the moment happens once.
 */
export interface PendingFill extends WatchedOrder {
  /** When the watch noticed it — not when the keepers executed it. */
  at: number
  /**
   * Seen by the reader. MARKED, not deleted — the record outlived its one
   * celebration the day the strip's Activity band, the card's Activity tab
   * and the panel all wanted to list fills. Deleting on dismiss meant the
   * first surface to greet a fill erased it from the other two, and the
   * unread bell had nothing to count. Same shape FiredAlert already uses,
   * for the same reasons.
   */
  read?: boolean
  /**
   * The feed post this fill wrote, when it wrote one. Carried so the
   * greeting can offer an Undo: the product acted on the reader's behalf
   * and the reversal has to be one tap from the place it says so, not a
   * hunt through a settings screen.
   */
  postId?: string | null
}

export const PENDING_FILLS_KEY = "poppin_pending_fills"

/** Newest last, deduped by orderKey, capped so storage cannot grow forever. */
export function rememberFills(
  existing: PendingFill[],
  fills: WatchedOrder[],
  at: number,
  cap = 20,
  /** orderKey → the feed post it wrote, for the Undo the greeting offers. */
  posts: Record<string, string | null> = {},
): PendingFill[] {
  const seen = new Set(existing.map((f) => f.orderKey))
  const added = fills
    .filter((f) => !seen.has(f.orderKey))
    .map((f) => ({ ...f, at, read: false, postId: posts[f.orderKey] ?? null }))
  return [...existing, ...added].slice(-cap)
}

/** How many fills the reader has not been shown yet. */
export function unreadFills(list: unknown): number {
  return Array.isArray(list)
    ? list.filter((f) => (f as PendingFill)?.read === false).length
    : 0
}

/** Every fill marked seen — what a surface does when it shows them. */
export function markFillsRead(list: PendingFill[]): PendingFill[] {
  return list.map((f) => (f.read ? f : { ...f, read: true }))
}

/**
 * This asset's UNSEEN fills, and everything else untouched. Unread is the
 * filter now: a fill the reader has already been greeted with stays in the
 * record for the Activity bands, but the celebration only ever fires once.
 */
export function splitFillsFor(
  pending: PendingFill[],
  mint: string,
): { mine: PendingFill[]; rest: PendingFill[] } {
  const mine: PendingFill[] = []
  const rest: PendingFill[] = []
  for (const f of pending) {
    if (f.mint === mint && f.read !== true) mine.push(f)
    else rest.push(f)
  }
  return { mine, rest }
}

/**
 * The share text. Same grammar as the market trade's share
 * ("Bought 12.5 $WIF ($25.00) on x.com via Poppin"), minus the hostname a
 * standing order does not have: it filled from the book, not from a page.
 */
export function fillShareText(o: WatchedOrder): string {
  const name = o.symbol ? `$${o.symbol.replace(/^\$/, "")}` : o.mint.slice(0, 4)
  const price = `$${fmtPrice(o.triggerPriceUsd)}`
  return o.side === "buy"
    ? `Limit order filled: bought ${name} at ${price} ($${o.amountUsd ?? 0}) via Poppin`
    : `Limit order filled: sold ${o.amountUi.toLocaleString("en-US", {
        maximumFractionDigits: 6,
      })} ${name} at ${price} via Poppin`
}

/**
 * WHERE AN ORDER WAS PLACED, so its fill can be posted back there.
 *
 * A fill happens in the background, hours later, on no page at all — so
 * by itself it has no idea whether the reader parked it under a tweet or
 * from the panel. The owner's rule is that a trade made on the X feed
 * belongs to the X feed's conversation, and an order is a trade that has
 * not happened yet; remembering the address at CREATION time is the only
 * moment the answer exists.
 *
 * Small, capped and self-cleaning: an entry is consumed when its fill is
 * posted, and the cap keeps a reader who parks dozens of orders from
 * growing this without bound.
 */
export const ORDER_ORIGINS_KEY = "poppin_order_origins"

const ORIGIN_CAP = 40

/** orderKey → the page address the order was placed from. */
export type OrderOrigins = Record<string, string>

export function rememberOrigin(
  existing: unknown,
  orderKey: string,
  url: string,
): OrderOrigins {
  const cur: OrderOrigins =
    existing && typeof existing === "object" ? { ...(existing as OrderOrigins) } : {}
  cur[orderKey] = url
  const keys = Object.keys(cur)
  if (keys.length > ORIGIN_CAP) {
    // Oldest-inserted first: object key order is insertion order for
    // string keys, which is exactly the eviction this wants.
    for (const k of keys.slice(0, keys.length - ORIGIN_CAP)) delete cur[k]
  }
  return cur
}

/** The address to file a fill under, and the map with that entry spent. */
export function takeOrigin(
  existing: unknown,
  orderKey: string,
  fallback: string,
): { url: string; rest: OrderOrigins } {
  const cur: OrderOrigins =
    existing && typeof existing === "object" ? { ...(existing as OrderOrigins) } : {}
  const url = typeof cur[orderKey] === "string" ? cur[orderKey] : fallback
  delete cur[orderKey]
  return { url, rest: cur }
}

/**
 * WHICH ASSETS HAVE AN UNGREETED FILL — the book's version of the question
 * FillCelebration answers for one asset.
 *
 * The greeting itself belongs in the asset's own room: the product shows one
 * card per asset, not a stack of announcements, and repeating a celebration
 * per row would be exactly that stack. But the book was ALSO silent, so an
 * order that filled while the reader was away left them looking at a list
 * with the news sitting one tap deeper and nothing pointing at it.
 *
 * So the book gets the pointer, not the party: which mints are carrying
 * something unread. Same read rule as splitFillsFor, one pass.
 */
export function mintsWithUnreadFills(list: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(list)) return out
  for (const f of list as PendingFill[]) {
    if (f && typeof f.mint === "string" && f.read !== true) out.add(f.mint)
  }
  return out
}
