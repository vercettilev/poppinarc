/**
 * WHAT THE READER WAS TRYING TO DO when the money ran out.
 *
 * The chip's Deposit door and the panel's Top up link know the shortfall and
 * the coin; the address screen they open did not, so it could only say
 * "send USDC". The intent is written here the moment a door is pressed and
 * read by three things: the address screen (the amount to say, and where to
 * return to when the money lands), the deposit watcher (how many minutes the
 * money took, and which Buy the toast should open), and nothing else.
 *
 * Two ages. The screen reads it for fifteen minutes: nobody waits longer at
 * an address, and a stale number would be somebody else's buy. The watcher
 * reads it for a day: an exchange withdrawal can take that long, and the
 * measurement is exactly that wait.
 */
export const TOP_UP_INTENT_KEY = "poppinTopUpIntent"
export const TOP_UP_INTENT_SCREEN_MS = 15 * 60_000
export const TOP_UP_INTENT_WATCH_MS = 24 * 60 * 60_000

/** The buy behind the door: the coin, the dollars typed, its ticker, the page. */
export type TopUpContext = {
  mint: string
  buyUsd?: number | null
  ticker?: string | null
  sourceUrl?: string | null
}

export type TopUpIntent = {
  /** The cover amount to ask for, whole dollars; null when the door had no number. */
  usd: number | null
  at: number
  mint?: string | null
  buyUsd?: number | null
  ticker?: string | null
  sourceUrl?: string | null
  /** Why the door opened the address screen instead of moving money itself, in the server's words. */
  note?: string | null
}

export function rememberTopUpIntent(
  usd?: number | null,
  ctx?: TopUpContext,
  note?: string | null,
  now = Date.now(),
): void {
  const intent: TopUpIntent = {
    usd: typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? Math.ceil(usd) : null,
    at: now,
    mint: ctx?.mint ?? null,
    buyUsd:
      typeof ctx?.buyUsd === "number" && Number.isFinite(ctx.buyUsd) && ctx.buyUsd > 0
        ? Math.round(ctx.buyUsd * 100) / 100
        : null,
    ticker: ctx?.ticker ?? null,
    sourceUrl: ctx?.sourceUrl ?? null,
    note: typeof note === "string" && note.length > 0 && note.length < 160 ? note : null,
  }
  try {
    void chrome.storage.local.set({ [TOP_UP_INTENT_KEY]: intent })
  } catch {
    // No extension context (a stale page after an update): nothing to remember into.
  }
}

/**
 * THE DOOR WITH NO BUY BEHIND IT MUST NOT ERASE ONE.
 *
 * The panel's front-door funding ask (components/FundDoor.tsx) has no amount
 * and no coin — nobody typed a number at it — so it wrote an EMPTY intent,
 * and an empty intent is still an intent: it overwrote the `{usd, mint}` a
 * chip's Deposit door had written minutes earlier. The reader then landed on
 * an address screen that no longer knew what their buy was for, and the money
 * that arrived returned them nowhere.
 *
 * So it writes only when there is nothing live to lose. The timestamp is
 * worth having (it is what the deposit watcher times), but never at the price
 * of the coin somebody is actually waiting to buy — and an older door's
 * timestamp is the more honest start of that wait anyway.
 */
export async function rememberTopUpIntentIfNone(now = Date.now()): Promise<void> {
  if (await readTopUpIntent(TOP_UP_INTENT_SCREEN_MS, now)) return
  rememberTopUpIntent(null, undefined, null, now)
}

export async function readTopUpIntent(
  maxAgeMs = TOP_UP_INTENT_SCREEN_MS,
  now = Date.now(),
): Promise<TopUpIntent | null> {
  try {
    const got = await chrome.storage.local.get(TOP_UP_INTENT_KEY)
    const v = (got as Record<string, unknown>)?.[TOP_UP_INTENT_KEY] as TopUpIntent | undefined
    if (!v || typeof v.at !== "number" || now - v.at > maxAgeMs || now < v.at) return null
    return {
      usd: typeof v.usd === "number" ? v.usd : null,
      at: v.at,
      mint: typeof v.mint === "string" && v.mint ? v.mint : null,
      buyUsd: typeof v.buyUsd === "number" ? v.buyUsd : null,
      ticker: typeof v.ticker === "string" && v.ticker ? v.ticker : null,
      sourceUrl: typeof v.sourceUrl === "string" ? v.sourceUrl : null,
      note: typeof v.note === "string" && v.note ? v.note : null,
    }
  } catch {
    return null
  }
}

/** Whole minutes since the door was pressed; null without an intent. */
export function minutesSince(intent: TopUpIntent | null, now = Date.now()): number | null {
  if (!intent) return null
  return Math.max(0, Math.round((now - intent.at) / 60_000))
}
