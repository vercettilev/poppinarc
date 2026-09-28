import type { SpotPositionsResponse } from "~/services/SpotAssetService"

/**
 * THE PANEL'S COLD OPEN, PAID FOR IN THE BACKGROUND.
 *
 * /positions is 8.6 seconds cold and 186ms warm — and 8.6 seconds on the
 * first open of a money surface reads as "the app is broken", which is the
 * one first impression a trading product cannot buy back.
 *
 * The background's position watch already reads the book every two minutes
 * for its own reasons. This cache is that read, kept: the watch WRITES what
 * it fetched, the panel's display surfaces PAINT it instantly on open and
 * swap in the fresh read when it lands. Under normal use the panel never
 * opens cold again, because somebody else already paid for the warmth.
 *
 * DISPLAY SURFACES ONLY, by rule: the trade sheets keep reading live,
 * because "can this order be paid for" answered off a stale balance is a
 * wrong answer about money. A stale PORTFOLIO PAINTING is just yesterday's
 * newspaper with today's edition already on the way.
 */

export const BOOK_CACHE_KEY = "poppin_book_cache"
/** Older than this is not a warm start, it is a wrong one. */
export const BOOK_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Pure, so the staleness rule is testable without chrome in the room. */
export function isFreshBook(at: number, now: number, maxAgeMs = BOOK_CACHE_MAX_AGE_MS): boolean {
  return Number.isFinite(at) && at > 0 && now - at <= maxAgeMs
}

export async function readBookCache(): Promise<SpotPositionsResponse | null> {
  try {
    if (!chrome?.storage?.local) return null
    const stored = await chrome.storage.local.get(BOOK_CACHE_KEY)
    const hit = stored?.[BOOK_CACHE_KEY]
    if (!hit?.book || !isFreshBook(hit.at, Date.now())) return null
    return hit.book as SpotPositionsResponse
  } catch {
    return null
  }
}

export async function writeBookCache(book: SpotPositionsResponse): Promise<void> {
  try {
    if (!chrome?.storage?.local) return
    await chrome.storage.local.set({ [BOOK_CACHE_KEY]: { book, at: Date.now() } })
  } catch {
    // A cache that failed to write is a cold open, which is where we started.
  }
}
