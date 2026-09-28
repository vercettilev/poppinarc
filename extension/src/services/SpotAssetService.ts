import type { PriceAlert } from "~/helpers/priceAlerts"
import { sendApiRequest } from "~/lib/fetchService"

/**
 * The card's three backend calls, against the real /embed/asset/* routes.
 *
 * Two of them are public and read-only (match, quote) — a reader viewing a page
 * must not acquire a trading credential just because the page mentioned SpaceX.
 * The third spends custodial USDC and goes through the extension's normal
 * Firebase identity.
 */

export interface AssetPageSignals {
  url?: string
  pathname?: string
  title?: string
  h1?: string
  metaDescription?: string
  bodyExcerpt?: string
}

export interface MatchedAsset {
  mint: string
  symbol: string
  name: string
  confidence: "confident" | "thematic"
  /**
   * HOW the page was identified, not how strongly.
   *
   * "exact"    the backend READ the asset off the page — a venue's dedicated
   *            URL for it, or the page printing its own mint. A CoinGecko
   *            coin page is not evidence about its subject, it IS its
   *            subject.
   * "inferred" the text scorer weighed the prose and concluded.
   *
   * This is what decides whether the card opens itself, because it needs no
   * threshold: `score` is an unbounded weighted sum and any cut-off on it
   * would be invented. Optional so an older backend simply reads as
   * inferred, which is the quiet behaviour.
   */
  certainty?: "exact" | "inferred"
  score: number
  /** The name a person says out loud ("SpaceX", "Circle"). Curated. */
  displayName: string
  /** 24h price change in PERCENT, or null when Jupiter had no answer. */
  change24hPct: number | null
  indicativeUsd: number | null
  /** The asset's own mark, from Jupiter. null renders as no logo. */
  icon: string | null
  /** Market cap USD. */
  mcap: number | null
  holderCount: number | null
  /** Hourly USD closes, last 24h, oldest first. null = no chart. */
  spark24h: number[] | null
  /**
   * THE GATE'S EVIDENCE, DISCLOSED — the pool facts the trade gate already
   * read before allowing this mint a sheet. Null field = Ultra did not say;
   * absent block = an older server. Rendered by helpers/safetyLine.
   */
  safety?: {
    liquidityUsd: number | null
    poolCreatedAtMs: number | null
    mintAuthorityRetained: boolean | null
    freezeAuthorityRetained: boolean | null
  } | null
  /** From Jupiter, never a constant. null when it could not be reached. */
  decimals: number | null
  issuer:
    | "backpack-securities"
    | "xstocks"
    | "prestocks"
    | "ondo"
    | "tether"
    | "native-spl"
    | "wormhole"
    | "bridged"
    | null
  /** Applying to THIS reader, resolved from the request IP. Usually empty. */
  restrictions: ("us-persons")[]
  matchedDirect: string[]
  matchedThematic: string[]
}

const SPOT_DEBUG = process.env.POPPIN_TEST_BUILD === "true"

const post = async <T,>(url: string, data: unknown): Promise<T> => {
  // The request leaves via chrome.runtime.sendMessage and the BACKGROUND
  // performs the fetch — so it never appears in the page's Network panel, only
  // in the service worker's. A stall here is invisible from the page; these
  // two lines are the page-side evidence of whether the bridge answered.
  const t0 = Date.now()
  if (SPOT_DEBUG) console.info("[poppin-spot] bridge →", url)
  try {
    const r = await sendApiRequest<T>({ url, method: "POST", data, apiType: "backend" })
    if (SPOT_DEBUG) console.info(`[poppin-spot] bridge ← ${url} ok in ${Date.now() - t0}ms`)
    return r
  } catch (e) {
    if (SPOT_DEBUG) console.info(`[poppin-spot] bridge ← ${url} FAILED in ${Date.now() - t0}ms`, e)
    throw e
  }
}

/**
 * "Is this page about a tradeable asset?"
 *
 * Returns `{ asset: null }` for the overwhelming majority of pages, which is
 * the normal case and not an error. Any failure is also treated as "no asset"
 * by the caller: a page that shows nothing because the backend was unwell is
 * indistinguishable, to the reader, from a page that shows nothing because
 * there was nothing to show — and that is the correct outcome for both.
 */
export const matchAsset = (signals: AssetPageSignals) =>
  post<{ asset: MatchedAsset | null }>("/embed/asset/match", signals)

/** Live price for an amount the reader typed. Public, read-only. */
export const quoteAsset = (mint: string, amountUsd: number) =>
  post<{
    outAmount: number
    pricePerUnit: number
    priceImpactPct: number
    route: string[]
  }>("/embed/asset/quote", { mint, amountUsd })

/**
 * Signature → settlement. Public and read-only; three outcomes, never two.
 * `unknown` means we stopped waiting, NOT that it failed.
 */
export const confirmAsset = (signature: string) =>
  post<{ status: "confirmed" | "unknown" | "failed"; chainError?: string }>(
    "/embed/asset/confirm",
    { signature },
  )

/**
 * Buy. Authenticated, and DRY RUN unless SPOT_SWAP_LIVE is on at the backend —
 * in which case `dryRun: true` comes back and nothing was broadcast.
 */
/** One tradeable idea the current page carries, as /candidates ranks them. */
export interface PageCandidate {
  mint: string
  symbol: string
  displayName: string
  category: string
  issuer: string | null
  score: number
  confidence: "confident" | "tentative"
  /** The words on the page that put it here — the reader can check our work. */
  matchedDirect: string[]
  priceUsd: number | null
  change24hPct: number | null
  /** null = the card cannot render this one; the row says so instead. */
  decimals: number | null
  name: string
  restrictions: string[]
  /** Also the card's pick, so the tab and the page never disagree. */
  isPagePick: boolean
}

/**
 * Everything on this page worth trading, most relevant first. Public, like
 * /match — and deliberately more talkative: the card appears uninvited and
 * must stay silent unless certain, while this answers a question the reader
 * asked by opening the Trades tab.
 */
export const candidatesForPage = (signals: AssetPageSignals) =>
  post<{ candidates: PageCandidate[] }>("/embed/asset/candidates", signals)

/** One holding in the reader's book, as /positions reports it. */
export interface SpotPosition {
  mint: string
  ticker: string
  displayName: string
  category: string
  uiAmount: number
  raw: string
  decimals: number | null
  priceUsd: number | null
  valueUsd: number | null
  change24hPct: number | null
  /** null = basis unknowable (position predates the ledger) — not zero. */
  netInvestedUsd: number | null
  /** Market cap at the reader's first buy; null when unrecorded. */
  entryMcapUsd?: number | null
  pnlUsd: number | null
  /** Dollars this mint's sells have banked; null = incomputable, not zero. */
  realizedPnlUsd?: number | null
  /** Average cost of what is still held — the chart's dashed entry line. */
  avgEntryPriceUsd?: number | null
  /** The tweet that drove the FIRST buy — caller credit on the flex card. */
  callerSourceUrl?: string | null
  /** Up or down right now, on the units the ledger can price. The one
   *  P&L both money surfaces show, so they can never disagree. */
  unrealizedPnlUsd?: number | null
}

export interface SpotPositionsResponse {
  positions: SpotPosition[]
  totalUsd: number
  /** null when NO position has a computable basis. */
  totalPnlUsd: number | null
  /** What the OPEN book is up or down right now — the headline figure. */
  totalUnrealizedPnlUsd?: number | null
  /** Banked across the whole book, exited mints included; null when no
   *  mint's ledger rows carry quantities. Older servers omit it. */
  totalRealizedPnlUsd?: number | null
  cashUsd: number
  /**
   * Spendable native SOL in USD, net of the server's gas reserve. THE WIRE
   * STILL CARRIES IT; NOTHING SPENDS IT. A buy is funded from USDC and only
   * USDC — swapInner pre-flights that balance and refuses with "Insufficient
   * USDC" — so a surface that adds this to the reader's cash is promising
   * money the server will not honour. It is here to describe the response,
   * not to be summed with cashUsd.
   */
  solUsd?: number
}

/**
 * One asset by mint, enriched the way /match enriches a page's match.
 *
 * The Holdings list opens a real card from a row, and a position carries none
 * of what a card is made of. `null` for anything outside the catalog — the
 * endpoint refuses to describe an arbitrary mint and so does this.
 */
/**
 * Closes for one range — and WHICH KIND OF NOTHING when there are none.
 *
 * `failed` separates "this pool has no candles at this range" from "we
 * could not reach them". Without it the chip printed a fact about the
 * asset every time an upstream request missed, which is how $ANTHROPIC
 * came to be told it had no 1H, 4H, 1D or 1W chart while GeckoTerminal
 * held 60, 16, 24 and 42 candles for exactly those windows.
 */
export interface SeriesAnswer {
  points: number[] | null
  /**
   * Epoch ms per point, same order — the candles' OWN clock.
   *
   * The chart used to place points evenly across the range's name, which
   * assumes a candle per interval. GeckoTerminal only emits a candle where
   * trades happened, so on a thin pool that assumption drew 36 hours of
   * $ANTHROPIC under a "1H" label (measured). Null when the server is an
   * older build; the chip falls back to the old arithmetic.
   */
  times: number[] | null
  /**
   * Open / high / low per bucket, same order and length as `points`, whose
   * values are the closes. Null on an older server, which is why the chart
   * treats a candle view as unavailable rather than broken when they are
   * missing — the line still draws from points alone.
   */
  opens: number[] | null
  highs: number[] | null
  lows: number[] | null
  failed: boolean
}

export const seriesAsset = (
  mint: string,
  range: "15m" | "1h" | "4h" | "1d" | "1w" | "1m" | "max",
) =>
  post<{
    points: number[] | null
    times?: number[] | null
    opens?: number[] | null
    highs?: number[] | null
    lows?: number[] | null
    failed?: boolean
  }>("/embed/asset/series", { mint, range }).then((r): SeriesAnswer => {
    const n = r.points?.length ?? 0
    // ALL THREE OR NONE, and each the right length. A candle drawn from a
    // high that belongs to a different bucket is a lie about a price, and
    // an older server answering without them must degrade to the line
    // rather than render half a candle.
    const ok = (a: unknown): a is number[] => Array.isArray(a) && a.length === n
    const whole = n > 0 && ok(r.opens) && ok(r.highs) && ok(r.lows)
    return {
      points: r.points,
      times: Array.isArray(r.times) ? r.times : null,
      opens: whole ? (r.opens as number[]) : null,
      highs: whole ? (r.highs as number[]) : null,
      lows: whole ? (r.lows as number[]) : null,
      failed: r.failed === true,
    }
  })

/**
 * `$TICKER` → mint for cashtags the shipped map has never heard of. The
 * server resolves catalog-first, then Ultra under the ambiguity rule, then
 * the trade gate — a mint can only come back if by-mint would describe it.
 */
export const byTickerAsset = (ticker: string) =>
  post<{ mint: string | null }>("/embed/asset/by-ticker", { ticker })

/**
 * How many distinct people BOUGHT from this tweet, counted from the trade
 * ledger's source_url receipts — every buy the chip drove, shared or not.
 * Replaced the shared-post proxy (countTradeProof over page posts), which
 * could only see the buyers who also chose to post about it.
 */
export const tweetProof = (url: string) =>
  post<{ buyers: number }>("/embed/asset/tweet-proof", { url })

/** One trade the signed-in reader made on this mint; the chart's markers. */
export interface MyTradeRow {
  side: "buy" | "sell"
  amountUsd: number
  /** epoch ms */
  ts: number
  /** The EXECUTED price (exact for sells, route-simulated for buys); null on
   *  rows older than the qty columns — the mark then rides the line. */
  priceUsd?: number | null
  qtyUi?: number | null
}

/**
 * MY trades on ONE mint. Authed (rides the same background bridge as every
 * other call here); the chart draws these on the price line, so a signed-out
 * reader simply gets a line with no marks.
 */
export const myTradesAsset = (mint: string) =>
  sendApiRequest<{ trades: MyTradeRow[] }>({
    url: `/spot/social/my-trades?mint=${encodeURIComponent(mint)}`,
    method: "GET",
    apiType: "backend",
  })

export interface MyHistoryRow {
  mint: string
  /** Curated ticker, or null off-catalog — print the short mint then. */
  symbol: string | null
  side: "buy" | "sell"
  amountUsd: number
  feeUsd: number
  /** epoch ms */
  at: number
  signature: string
  /** Executed quantity and price, when the ledger row carries them. */
  qtyUi?: number | null
  priceUsd?: number | null
  /** The X status permalink that drove the trade, when recorded. */
  sourceUrl: string | null
  /**
   * True for a trade that never reached the chain. Only ever present when
   * the call asked for it (withFailed), so a caller that did not ask can
   * keep treating every row as a real trade.
   */
  failed?: boolean
}

/**
 * MY whole ledger, all mints, newest first — the panel's trade history.
 * Failed rows are excluded server-side by default: a swap that never landed
 * shown as a trade is a lie with the reader's money in it. withFailed asks
 * for them back, flagged, for a view that draws them as not having happened
 * (the history list). Anything that sums or charts these rows must NOT ask.
 */
export const myHistoryAsset = (limit = 50, opts: { withFailed?: boolean } = {}) =>
  sendApiRequest<{ trades: MyHistoryRow[] }>({
    url: `/spot/social/my-history?limit=${limit}${opts.withFailed ? "&withFailed=1" : ""}`,
    method: "GET",
    apiType: "backend",
  })

/** One caller on the leaderboard: whose tweets drove the most trading. */
export interface CallerRow {
  handle: string
  buyers: number
  volumeUsd: number
  avatarUrl: string | null
  onPoppin: boolean
}

/**
 * THE WINS RAIL — biggest REALISED trades, with the trader's name.
 *
 * Opt-in only: the server returns rows for people who set public_wins.
 * An empty rail means nobody has said yes yet, which is a correct answer
 * and not a fault.
 */
export interface WinRow {
  name: string
  avatarUrl: string | null
  mint: string
  symbol: string | null
  realizedUsd: number
}
/** One card per asset: the realised win on a closed lot and its return. */
export interface BestLot {
  mint: string
  symbol: string | null
  realizedUsd: number
  /** Return on what was closed, in percent; null when the walk had no cost. */
  pct: number | null
}
/** Somebody else's best closed lots — empty unless they publish them. */
export const winsFor = (userId: string, limit = 5) =>
  sendApiRequest<{ wins: BestLot[] }>({
    url: `/spot/social/wins/${encodeURIComponent(userId)}?limit=${limit}`,
    method: "GET",
    apiType: "backend",
  })
/** Your own, whether or not you publish them. */
export const myWins = (limit = 5) =>
  sendApiRequest<{ wins: BestLot[] }>({
    url: `/spot/social/my-wins?limit=${limit}`,
    method: "GET",
    apiType: "backend",
  })

export const topWins = (limit = 5) =>
  sendApiRequest<{ wins: WinRow[] }>({
    url: `/spot/social/top-wins?limit=${limit}`,
    method: "GET",
    apiType: "backend",
  })

/**
 * WHERE THE READER STANDS. Limit 1, because the chip's scoreboard wants
 * the RANK and not the board: viewerRank is the viewer's place in the
 * FULL sorted list, computed server-side, so a one-row response carries
 * it just as well as a fifty-row one.
 */
export const myRank = (period: "week" | "all" = "week") =>
  sendApiRequest<{ viewerRank: number | null; viewer: { points: number } | null }>({
    url: `/flywheel/leaderboard?period=${period}&limit=1`,
    method: "GET",
    apiType: "backend",
  })

/** The caller leaderboard — public, aggregate-only, N>=3 floor. */
export const callersBoard = (period: "week" | "all", limit = 10) =>
  sendApiRequest<{ callers: CallerRow[] }>({
    url: `/spot/social/callers?period=${period}&limit=${limit}`,
    method: "GET",
    apiType: "backend",
  })

/**
 * One asset by mint. `refused` arrives INSTEAD of an asset when the trade
 * gate declined but the token could still be named — so a room can say
 * which token it is refusing rather than calling it unknown.
 */
export const assetByMint = (mint: string) =>
  post<{
    asset: MatchedAsset | null
    refused?: { symbol: string; name: string } | null
  }>("/embed/asset/by-mint", { mint })

/**
 * The price the chip paints, for many mints in one ask: the /ticks feed's
 * number, not by-mint's fee-inclusive quote. Mints Jupiter had nothing for
 * are simply absent.
 */
export const midPrices = (mints: string[]) =>
  post<{ prices: Record<string, { usd: number; change24hPct: number | null }> }>(
    "/embed/asset/prices",
    { mints },
  )

/**
 * THE SERVER'S COPY OF AN ALERT, for signed-in readers only.
 *
 * The extension keeps judging alerts itself while Chrome runs; the mirror
 * lets the server judge them while Chrome does not and say so by email.
 * Every call here is fire-and-forget at the call site: a signed-out reader
 * gets a 401, which is the correct answer and changes nothing locally.
 */
export const syncAlerts = (alerts: PriceAlert[]) =>
  post<{ kept: number }>("/embed/asset/alerts/sync", { alerts })

export const removeAlertRemote = (id: string) =>
  post<{ ok: true }>("/embed/asset/alerts/remove", { id })

/**
 * The X strip's remote switch. Env-driven on the backend so the feature can
 * be stopped the day X's DOM changes shape, without shipping a build.
 */
/** The reader's own invite code and what it has brought, for the invite row. */
export const referralStats = () =>
  sendApiRequest<{
    code: string
    referrals_count: number
    total_earned_usd: string
    pending_usd: string
    paid_usd: string
  }>({ url: "/referrals/stats", method: "GET", apiType: "backend" })

/** The week's pool and the reader's seat multiplier: what a receipt multiplies the dollars by. */
export const poolStatus = () =>
  sendApiRequest<{
    pool: {
      poolUsd: number
      viewerCohortMult: number
      viewerShareUsd: number | null
      /** The viewer's own founding-seat number; the receipt that claims it says so. */
      viewerCohortRank?: number | null
    }
    seatsLeft: number
  }>({ url: "/flywheel/pool", method: "GET", apiType: "backend" })

export const xStripConfig = () =>
  sendApiRequest<{ enabled: boolean; disabledMints: string[] }>({
    url: "/embed/asset/x-strip-config",
    method: "GET",
    apiType: "backend",
  })

/**
 * WHO YOU FOLLOW IS IN WHAT. One call per page, not one per chip: a
 * timeline mounts dozens of rows and a per-mint lookup would be dozens of
 * requests for a decoration. The answer is a flat list of recent trades by
 * people the reader follows, and each chip picks out its own mint locally.
 *
 * Nothing new is disclosed. This is the same route the social-trade
 * notifier already rides, and the product decided long ago that following
 * somebody means seeing their trades.
 */
export const followingTradesAsset = (days = 7, limit = 100) =>
  sendApiRequest<{
    trades: Array<{
      userId: string
      name: string
      avatarUrl: string | null
      mint: string
      symbol: string | null
      side: "buy" | "sell"
      amountUsd: number
      at: number
    }>
  }>({
    url: `/spot/social/following-trades?days=${days}&limit=${limit}`,
    method: "GET",
    apiType: "backend",
  })

/** The whole book. Authenticated — a portfolio is private. */
export const positionsAsset = () =>
  post<SpotPositionsResponse>("/embed/asset/positions", {})

/** The reader's balance of one mint. Authenticated; 401s silently mean 0. */
export const balanceAsset = (mint: string) =>
  post<{ uiAmount: number; raw: string; decimals: number | null }>(
    "/embed/asset/balance",
    { mint },
  )

/** Sell exact-in RAW units (echoed from /balance — no client decimal math). */
export const sellAsset = (
  mint: string,
  amountRaw: string,
  sourceUrl?: string,
  idempotencyKey?: string,
) =>
  post<{
    signature: string
    dryRun: boolean
    outUsdcRaw: string
    /** The pop card's URL, signed by the server because the secret is
     *  theirs. Null on a dry run and when the deploy has no secret, so a
     *  share affordance can be absent rather than broken. */
    shareUrl: string | null
  }>(
    "/embed/asset/sell",
    {
      mint,
      amountRaw,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  )

/**
 * `idempotencyKey` identifies ONE PRESS. Sent so the server can refuse a
 * double-submit; without it the server has nothing to dedup on and says so
 * in its own logs.
 */
/**
 * A WALLET ACCOUNT'S TRADE, in two calls around the wallet's own window:
 * the server builds it unsigned, the wallet signs and sends it on the
 * page, the signature comes back to be recorded.
 */
export const prepareExternalTrade = (body: {
  side: "buy" | "sell"
  mint: string
  amountUsd?: number
  amountRaw?: string
  sourceUrl?: string
}) =>
  post<{
    preparedId: string
    transaction: string
    outAmountRaw: string
    feeUsd: number
    category: string
  }>("/embed/asset/external/prepare", body)

/** A wallet account's standing order and its cancel, in the same two steps. */
export const prepareExternalOrder = (body: {
  mint: string
  side: "buy" | "sell"
  amountUsd?: number
  amountRaw?: string
  triggerPriceUsd: number
}) =>
  post<{ preparedId: string; transaction: string; orderKey: string }>(
    "/embed/asset/order/external/prepare",
    body,
  )

export const prepareExternalCancel = (orderKey: string) =>
  post<{ preparedId: string; transaction: string; orderKey: string }>(
    "/embed/asset/order/cancel/external/prepare",
    { orderKey },
  )

export const submitExternalOrder = (body: { preparedId: string; signature: string }) =>
  post<{ orderKey: string; signature: string; dryRun: boolean; kind: "create" | "cancel" }>(
    "/embed/asset/order/external/submit",
    body,
  )

export const submitExternalTrade = (body: {
  preparedId: string
  signature: string
  signedTx?: string
}) =>
  post<{
    signature: string
    dryRun: boolean
    category: string
    outAmountRaw: string
    outUsdcRaw?: string
    shareUrl: string | null
  }>("/embed/asset/external/submit", body)

export const swapAsset = (
  mint: string,
  amountUsd: number,
  sourceUrl?: string,
  idempotencyKey?: string,
) =>
  post<{
    signature: string
    dryRun: boolean
    category: string
    outAmountRaw: string
    /** See sellAsset: signed server-side, null when it cannot be. */
    shareUrl: string | null
  }>("/embed/asset/swap", {
    mint,
    amountUsd,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  })

/**
 * Standing orders — parked on chain with Jupiter's trigger program, filled by
 * keepers at the order's price OR BETTER. Not a watcher firing market swaps:
 * the escrow, the fill rule and the cancel are all the program's, which is
 * what lets every surface use the word "order" without lying.
 */
export interface TriggerOrderRow {
  orderKey: string
  mint: string
  side: "buy" | "sell"
  /** buy: USDC committed. sell: null — the asset leg carries the size. */
  amountUsd: number | null
  /** sell: asset units offered. buy: asset units expected at the trigger. */
  amountUi: number
  triggerPriceUsd: number
  currentPriceUsd: number | null
  status: string
  createdAt: string
  expiredAt: string | null
  symbol: string | null
  name: string | null
  icon: string | null
  /** §7 no longer admits the mint — surfaced loudly, exit stays lit. */
  gated: boolean
}

/** Place a standing order. Authenticated; dry-run follows the swap engine. */
export const createOrderAsset = (dto: {
  mint: string
  side: "buy" | "sell"
  amountUsd?: number
  amountRaw?: string
  triggerPriceUsd: number
  /** This press's identity. A double-submitted Place must not park two
   *  orders at the same price. */
  idempotencyKey?: string
}) =>
  post<{ orderKey: string; signature: string; dryRun: boolean }>(
    "/embed/asset/order",
    dto,
  )

/** Cancel one. Always available — the backend never gates an exit. */
export const cancelOrderAsset = (orderKey: string) =>
  post<{ orderKey: string; signature: string; dryRun: boolean }>(
    "/embed/asset/order/cancel",
    { orderKey },
  )

/** The reader's standing orders, described for display. Authenticated. */
export const listOrdersAsset = (status: "active" | "history" = "active") =>
  post<{ orders: TriggerOrderRow[] }>("/embed/asset/orders", { status })
