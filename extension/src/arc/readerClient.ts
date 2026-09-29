import type { XMatchRow } from "~/entries/contentScript/x/xMatch"
import { sendApiRequest } from "~/lib/fetchService"

/**
 * THE CHIP'S QUESTION TO THE AI READER (arc-api reader/reader.ts).
 *
 * Asked only for a post the chip's own rules could not place, and only when
 * the post shows some sign of money: most of a feed is not about money, and a
 * post that is not is never sent. Posts seen in the same moment share one
 * request (up to eight, 350 ms apart at most), and a post is asked about once
 * per page. A failed ask is not remembered as an answer, so the next sighting
 * of the post may try again.
 */

export interface ReaderHit {
  row: XMatchRow
  reason: string
}

interface ReadAnswer {
  id: string
  asset: { mint: string; ticker: string; name: string; displayName: string } | null
  reason: string | null
}

/** The same signs of money arc-api looks for before it spends a model call (reader/catalog.ts). */
const MONEY = [
  /[$€£¥]\s?\d/,
  /\b\d+(\.\d+)?\s?(%|bps|bp)\b/i,
  /\b(price|prices|market|markets|stock|stocks|shares|crypto|coin|coins|token|tokens|etf|etfs|fund|funds|rate|rates|yield|yields|bond|bonds|inflation|cpi|fed|ecb|central bank|currency|currencies|dollar|dollars|euro|euros|forex|fx|rally|rallies|dip|dips|crash|pump|dump|bull|bullish|bear|bearish|buy|buying|bought|sell|selling|sold|trade|trading|invest|investing|investor|investors|treasury|treasuries|halving|miners|mining|ath|all-time high)\b/i,
]

export function looksLikeMoney(text: string): boolean {
  return MONEY.some((re) => re.test(text))
}

const BATCH = 8
const WAIT_MS = 350
const MAX_TEXT = 1_200

const memo = new Map<string, Promise<ReaderHit | null>>()
let queue: Array<{ id: string; text: string; resolve: (v: ReaderHit | null) => void }> = []
let timer: ReturnType<typeof setTimeout> | null = null

async function flush(): Promise<void> {
  timer = null
  const batch = queue.slice(0, BATCH)
  queue = queue.slice(BATCH)
  if (queue.length) timer = setTimeout(() => void flush(), 0)
  if (!batch.length) return
  try {
    const r = await sendApiRequest<{ items?: ReadAnswer[] }>({
      url: "/embed/asset/read",
      method: "POST",
      data: { items: batch.map(({ id, text }) => ({ id, text })) },
      apiType: "backend",
    })
    const byId = new Map((r?.items ?? []).map((a) => [a.id, a]))
    for (const q of batch) {
      const a = byId.get(q.id)
      q.resolve(
        a?.asset && a.reason
          ? {
              row: { mint: a.asset.mint, ticker: a.asset.ticker, name: a.asset.name, displayName: a.asset.displayName },
              reason: a.reason,
            }
          : null,
      )
    }
  } catch {
    // Signed out, rate-limited or offline: no answer, and not remembered as one.
    for (const q of batch) {
      memo.delete(q.id)
      q.resolve(null)
    }
  }
}

export function readText(id: string, text: string): Promise<ReaderHit | null> {
  if (!id || !looksLikeMoney(text)) return Promise.resolve(null)
  const known = memo.get(id)
  if (known) return known
  const p = new Promise<ReaderHit | null>((resolve) => {
    queue.push({ id, text: text.slice(0, MAX_TEXT), resolve })
    if (queue.length >= BATCH) {
      if (timer) clearTimeout(timer)
      void flush()
    } else if (!timer) {
      timer = setTimeout(() => void flush(), WAIT_MS)
    }
  })
  if (memo.size > 500) memo.clear()
  memo.set(id, p)
  return p
}

/** Test seam. */
export function resetReaderClient(): void {
  memo.clear()
  queue = []
  if (timer) clearTimeout(timer)
  timer = null
}
