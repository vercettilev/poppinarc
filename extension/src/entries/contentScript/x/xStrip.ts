import type { TopUpContext } from "~/helpers/topUpIntent"
import { LAST_TRADE_USD_KEY } from "~/helpers/copyFrom"
import { messageOf } from "~/helpers/refusalCopy"
import { contractAddressesIn } from "~/arc/addresses"
import { ARC_EDITION, CAP } from "~/config/edition"
import { CHAIN, shortAddress, USDC_MINT as EDITION_USDC_MINT } from "~/arc/chain"
import { PRESET_USD, pocketPick, reasonOf } from "~/helpers/tradeMath"
import type { TopUpMode } from "~/helpers/topUpAmount"
import { earnedText, inviteLink, joinedText } from "~/helpers/invite"
import {
  headline as youHeadline,
  qtyText,
  rankPositions,
  usdText,
} from "~/helpers/youPanelView"
import {
  JUICE,
  JUICE_BUY_FILL,
  JUICE_GRADIENT,
  JUICE_SCAN,
  JUICE_SELL_FILL,
  JUICE_SHEEN,
} from "~/theme/juice"
import { ensureBrandFont } from "~/helpers/brandFont"
import { pageIsLight } from "~/helpers/pageIsLight"
import { createScanTally } from "~/helpers/scanTally"
import type { SiteAdapter } from "./siteAdapter"
import { NEWS_SITE } from "./newsSite"
import { REDDIT_SITE } from "./redditSite"
import { X_SITE } from "./xSite"
import { dbg } from "~/helpers/poppinDebug"
import { failureReason } from "~/helpers/failureReason"
import { drawLineFromLeft } from "~/helpers/lineDraw"
import { priceText } from "~/helpers/priceText"
import type { SeriesAnswer } from "~/services/SpotAssetService"
import { compactUsd, shareTradeCard } from "~/helpers/tradeCard"
import { flexCardData, flexParts } from "~/helpers/flexCard"
import { flexPortraitModel } from "~/helpers/flexCardPortrait"
import { flexTweetText, gatherFlexAssets, shareFlexCard, warmFlexAssets } from "~/helpers/flexShare"
import {
  pointTimes,
  priceToY,
  scrubIndex,
  SPARK_RANGES,
  candleGeometry,
  sparkGeometry,
  sparkXY,
  timeLabel,
  timeToX,
  type SparkRange,
} from "~/helpers/chartMath"
import {
  fenceKeys,
  fencePointerMotion,
  fencePointers,
  normalizeDecimal,
} from "~/helpers/decimalInput"
import { iconViaBackground } from "~/helpers/iconBridge"
import {
  capIsMeaningful,
  compactCount,
  safetyLine,
  wrapsSomethingElse,
} from "~/helpers/safetyLine"
import type { MatchedAsset } from "~/services/SpotAssetService"
import {
  outcomeReason,
  pressKey,
  runInlineBuy,
  runInlineOrder,
  type InlineBuyServices,
  type InlineBuyOutcome,
  type InlineOrderServices,
} from "./inlineBuy"
import { formatTriggerPrice } from "~/helpers/orderMath"
import {
  fractionRaw,
  viewTradeSheet,
  type Reader,
} from "~/helpers/tradeSheetModel"

/** Re-exported so the chip's own specs keep one import path. */
export { fractionRaw }
import { BELL_GLYPH, NOTIFICATION_GLYPHS } from "~/helpers/notificationText"
import { makeAlert, type FiredAlert, type PriceAlert } from "~/helpers/priceAlerts"
import {
  COACH_STYLE,
  coachPending,
  markCoachSeen,
  maybeCoach,
} from "~/helpers/chipCoach"
import { createChipSeenWatch } from "~/helpers/chipSeen"
import { claimHost } from "~/helpers/orphanSweep"
import type { PendingFill } from "~/helpers/orderFillWatch"
import { proofText } from "~/helpers/tradeProof"
import { isCuratedMint, matchTweet, type XMatch, type XMatchRow } from "./xMatch"
import {
  readXStripConfigCache,
  writeXStripConfigCache,
  X_STRIP_FAIL_CLOSED,
  type XStripConfig,
} from "~/helpers/xStripConfigCache"

/**
 * The trade strip under tradeable tweets — the feed itself as the venue.
 *
 * Blinks needed every publisher to stand up an Action endpoint before a
 * timeline could act on anything; that is why it starved. Here the publisher
 * is whoever wrote the tweet, and they already published the only thing we
 * need: the words. The strip turns the mention into the venue, on device,
 * without X or the author being asked.
 *
 * ── EVERYTHING BELOW WAS MEASURED, NOT ASSUMED (live x.com, 2026-08-20) ─────
 * · The timeline is HARD-virtualized: ~4-5 `article[data-testid="tweet"]`
 *   exist at any moment, inside `div[data-testid="cellInnerDiv"]` wrappers
 *   that X positions with transforms.
 * · A foreign sibling appended NEXT TO the article survived scrolling away
 *   and back (12k px measured) — React did not reconcile it away. That
 *   measurement is kept for its history and NO LONGER DESCRIBES THIS CODE:
 *   the chip is mounted INSIDE the article now, directly under the tweet's
 *   own action row, because "after the article" landed it below the reply
 *   sort control on a status page (see mountStrip). Inside React's own
 *   subtree there is no such guarantee — a re-render of that subtree can
 *   take a foreign child with it.
 * · At ~40k px the SAME DOM cell came back holding a DIFFERENT tweet, with
 *   the foreign node still attached. X recycles cells.
 *
 * Those two facts are the design's centre, and they pull in opposite
 * directions. A boolean "processed" mark — on the cell, on the article,
 * anywhere — survives recycling exactly like the probe did, and afterwards it
 * vouches for a tweet it never saw. So the mark is an IDENTITY,
 * `data-poppin-x="<statusId>"`, and every pass re-reads the cell's actual
 * permalink: same id, nothing to do; different id, the old strip is torn down
 * and the new tweet judged from scratch. Buy-under-the-wrong-tweet is the one
 * failure this feature cannot survive; it is handled by construction, not by
 * hoping.
 *
 * AND THE MARK IS NOT PAIRED WITH A PRESENCE CHECK — deliberately, after
 * one was written and taken back out. The argument for it: an identity on
 * the CELL cannot see a chip removed from inside the ARTICLE, so if React
 * ever reconciles our host away the mark keeps vouching for a chip that is
 * gone. The argument against it, which wins: nobody has ever measured that
 * happening (the 12k px probe above measured the opposite), while a
 * re-mount on "mark matches, chip missing" is driven by the idle flush at
 * the bottom of this file — up to ~8 times a second — and every re-mount is
 * a brand-new host that arrives CLOSED and replays the 0.32s `stripIn`
 * entrance, plus a fresh TickTarget, walRefresher and clipLabel that only
 * prune on their own next call. If the removal it heals were real and
 * recurring, "the chip vanished once" would become "the chip re-enters
 * three to eight times a second", which is the flicker this file was being
 * repaired for, faster. A silent missing chip until the cell recycles is
 * the cheaper failure. Anyone re-adding the heal owes it a measurement, an
 * attempt cap per cell, and no entrance animation on a heal.
 *
 * ── WHY THE OBSERVER WATCHES EVERYTHING AND DOES ALMOST NOTHING ─────────────
 * X is a SPA; timelines mount and unmount across Home, search, profiles,
 * threads. Chasing the "right" container is a losing game, so the observer
 * watches `document.body` and pays for it by being nearly free per record:
 * map the mutation target to its cell, put the cell in a Set, and flush the
 * Set on idle. Matching itself was measured at 0.1ms for every visible tweet
 * — the budget problem is not the scan, it is doing layout work eagerly,
 * which the idle flush avoids.
 */

/**
 * The ticker as a tweet would write it. The catalog's lowercase-x wrapper
 * suffix is OUR naming (TSLAx, HOODx); uppercasing it into the strip printed
 * "$HOODX" under a Robinhood tweet — a ticker that exists nowhere. Strip the
 * wrapper, keep everything else verbatim-uppercased.
 */
export function displayTicker(ticker: string): string {
  const raw = ticker.replace(/^\$/, "")
  const m = /^([A-Z0-9.]{2,})x$/.exec(raw)
  return (m ? m[1] : raw).toUpperCase()
}

/**
 * The offsets offered as one tap. Round numbers a person actually thinks in,
 * not a slider of every value.
 *
 * ── THEY ARE MEASURED FROM DIFFERENT THINGS, AND THAT IS THE POINT ─────────
 * A BUY has no history to measure against, so its offsets come off the live
 * price: "if it comes off ten percent I want it."
 *
 * A SELL does. Offering "+10%" against the tape tells a holder nothing —
 * if the price is already 30% under what they paid, selling ten percent
 * above today is still a loss, and a control that calls that +10% is lying
 * about the only number that matters. Sell offsets are TAKE-PROFIT targets
 * measured from the average entry, which is what "I'm up ten percent" means
 * to the person who owns the thing.
 *
 * When the basis is unknowable the targets are not silently re-based onto
 * the tape — the sheet says so and falls back to a plain price.
 */
const DROP_PCTS = [5, 10, 20] as const
const GAIN_PCTS = [10, 25, 50] as const

/**
 * A sell is sized as a fraction of what is held, not in dollars: the reader
 * is deciding how much of a position to let go, and "half" is the thought
 * they actually have. 100% is offered because trimming to dust is nobody's
 * plan and the raw units make an exact exit safe.
 */
const SELL_PCTS = [25, 50, 100] as const
/** The scoreboard's rooms; `watch` is the bell's, the alert composer. */
type YouTab = "holdings" | "orders" | "alerts" | "watch"

/**
 * The site the strip is reading. X until a second adapter is passed in, and
 * every selector below comes from it rather than from a constant here, so a
 * second feed is an object rather than a second copy of this file.
 */
const ID_ATTR = "data-poppin-x"

const ACCENT = JUICE.accent
const RED = JUICE.red
/**
 * What a reader tops up with, which is NOT what they trade with.
 * PRESET_USD is a trade size and answers "how much of this token";
 * these answer "how long until I am back here". Sharing one list would
 * make the smallest useful top-up the smallest useful buy, and a $10
 * deposit that a $10 buy immediately spends is a round trip nobody
 * wanted.
 */
const FUND_USD = [25, 50, 100] as const

/**
 * A person's picture, past the host's image policy. x.com's img-src is its
 * own hosts plus data: (measured), so a profile photo, Google's or the ghost
 * from api.poppin.so, never loads as a plain src on the page. The worker
 * fetches it and the bytes come back as a data URI, the road token icons
 * already take. The img stays blank, never broken, until then.
 */
function avatarImg(url: string): HTMLImageElement {
  const img = document.createElement("img")
  img.alt = ""
  img.referrerPolicy = "no-referrer"
  if (url.startsWith("data:")) img.src = url
  else
    void iconViaBackground(url).then((uri) => {
      if (uri && img.isConnected) img.src = uri
    })
  return img
}
const GREEN = JUICE.green

export interface TweetFacts {
  /** The status id from the tweet's permalink — its identity. */
  id: string
  /**
   * The tweet's absolute permalink. The panel opens HERE rather than on
   * x.com/home: measured against production, the home feed matches no asset
   * at all while a permalink matches correctly — and a tweet is a URL, which
   * is the unit Poppin attaches a conversation to anyway.
   */
  url: string
  text: string
  /** Anchor texts X linkified as cashtags, in DOM order. */
  cashtags: string[]
  /**
   * The handle the tweet was posted from, read straight out of the permalink
   * — no extra DOM work, it was already in hand. An account whose name is an
   * asset's name is evidence about the tweet, and it used to be discarded.
   */
  author: string
}

/**
 * What a tweet IS, read off its article. Null when the article has no
 * permalink yet — X renders in stages, and a half-rendered tweet is "ask
 * again later", not "no".
 */
export function extractTweet(article: Element, site: SiteAdapter = X_SITE): TweetFacts | null {
  const link = site.permalink(article)
  if (!link) return null
  const { id, url } = link
  const author = site.authorOf(url, article) ?? ""
  const textEls = site.textNodes(article)
  const text = [site.title(article), ...textEls.map((el) => el.textContent ?? "")]
    .filter((part) => part.length > 0)
    .join("\n")
  /**
   * CASHTAGS FROM THE LINKS, THEN FROM THE WORDS.
   *
   * Reading only the anchors was right for X and wrong as a rule: X
   * linkifies a cashtag when it recognises the symbol and leaves it as
   * plain text when it does not, which is precisely the case for a young
   * token, the one a reader is most likely to be looking at. Measured in
   * the field: a sweep of seventy cells on a live timeline reported ONE
   * cashtag, on a feed that visibly carried more.
   *
   * The anchors still go first, because an anchor is the site saying "this
   * is a symbol" and it carries the exact casing. The scan of the words
   * only adds what the anchors missed, and it is what a feed that
   * linkifies nothing, Reddit or a news page, will rely on entirely.
   */
  const cashtags: string[] = []
  const seen = new Set<string>()
  const take = (raw: string): void => {
    const t = raw.trim()
    if (t.length < 2 || !t.startsWith("$")) return
    const key = t.toUpperCase()
    if (seen.has(key)) return
    seen.add(key)
    cashtags.push(t)
  }
  for (const textEl of textEls) {
    for (const a of textEl.querySelectorAll("a")) take(a.textContent ?? "")
  }
  for (const m of text.matchAll(/\$[A-Za-z][A-Za-z0-9]{0,14}\b/g)) take(m[0])
  return { id, url, text, cashtags, author }
}

/**
 * One inferred strip per asset ON SCREEN AT A TIME.
 *
 * The problem this solves was measured in the first field test: nine
 * screenshots of a crypto feed, five of them wearing the same $SOL strip —
 * individually right, cumulatively wallpaper. The author's own $ mark always
 * shows; the INFERRED tier yields to a copy of itself.
 *
 * ── WHY THIS REPLACED A TIMER ───────────────────────────────────────────────
 * That observation was SPATIAL — five at once, in one screenful — and the
 * first fix was a two-minute per-mint cooldown, which is TEMPORAL. The two do
 * not line up, and the mismatch is not academic: "Solana looks good here",
 * alone on the screen with nothing else near it, showed no chip at all,
 * because some other tweet had said "solana" ninety seconds earlier and gone.
 * A reader scrolls past thirty tweets in two minutes, so the timer spent most
 * of its life suppressing chips nobody could have found repetitive.
 *
 * Screen position answers the actual question. Two Solana tweets in one
 * screenful still get one strip between them; a Solana tweet on its own
 * always gets one, no matter what scrolled by before it.
 */
function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect()
  const h = window.innerHeight || document.documentElement.clientHeight
  return r.bottom > 0 && r.top < h
}

export interface XStripDeps {
  /** The feed being read. Omitted means X, which is every caller today. */
  site?: SiteAdapter

  /** Full asset by mint — the same call the panel's strip uses. Cached here. */
  enrich(mint: string): Promise<MatchedAsset | null>
  /**
   * Open the docked card on this asset, on this side. SELL's door: selling
   * needs the balance, the fractions and the card's gates around them. Buy
   * does not leave the feed any more — see runInlineBuy.
   */
  openTrade(matched: MatchedAsset, side: "buy" | "sell"): void
  /** The buy itself: the same two endpoints every money surface uses. */
  trade: InlineBuyServices
  /** The standing-order leg — buy at a lower price, parked on chain. */
  order: InlineOrderServices
  /** Subscribe this mint to the live tick stream (fire-and-forget). */
  watchPrice(mint: string): void
  /**
   * Stop the stream when the last chip for a mint has left the page.
   * Without it the worker keeps polling Jupiter for every mint anybody
   * ever scrolled past, for the life of the tab — the registry below
   * already forgets the mint, but the poll it started outlived it.
   */
  unwatchPrice?(mint: string): void
  /** Price impact for a given size, so the chip can say what a buy costs. */
  quote(mint: string, usd: number): Promise<{ priceImpactPct: number } | null>
  /**
   * Closes for a mint over a range, oldest first — the tap-the-price chart.
   * Optional: without it the price is just a number, exactly as before.
   */
  series?(mint: string, range: SparkRange): Promise<SeriesAnswer>
  /**
   * `$TICKER` → mint for a cashtag the SHIPPED lists cannot answer. The
   * matcher stays offline and instant; this is the slow lane behind it,
   * asked only when a tweet carries a cashtag the bundle has never heard
   * of. Server-side it is catalog + Ultra + the same trade gate, so a mint
   * arriving here is one the whole money path will accept.
   */
  resolveTicker?(ticker: string): Promise<string | null>
  /**
   * The AI reader, for a post no rule placed (arc/readerClient.ts). Null is
   * "not about an asset we trade", and the post stays without a chip.
   */
  readText?(id: string, text: string): Promise<{ row: XMatchRow; reason: string } | null>
  /**
   * The signed-in reader's own trades on this mint, oldest or newest first
   * (the chart re-sorts nothing; it only places). Absent or failing reads
   * as "no marks", never as an error — a line with no history on it is a
   * complete answer for a fresh account.
   */
  myTrades?(
    mint: string,
  ): Promise<Array<{
    side: "buy" | "sell"
    ts: number
    /** The EXECUTED price when the ledger row carries quantities; null on
     *  older rows — the mark then rides the line as before. */
    priceUsd?: number | null
  }> | null>
  /** Hand the reader to the sidebar, on this asset, from this tweet. */
  openPanel(mint: string, tweetUrl: string): void
  /**
   * Put this trade on the Poppin feed, filed under the X FEED's own
   * address rather than the tweet it came from. Optional: absent means
   * the trade is still recorded in the ledger and simply not posted.
   */
  postTrade?(t: {
    mint: string
    symbol: string
    side: "buy" | "sell"
    usd: number
    tokens: number
    signature: string
    /** The coin's own metadata image, so the receipt in the feed has a
     *  face. Absent leaves the feed's own initial, as before. */
    iconUrl?: string | null
    /** Market cap at the moment of the trade — the unit a memecoin's size
     *  is actually said in, and the receipt's whole context. */
    mcap?: number | null
  }): Promise<void>
  /** The full-page sign-in flow, for a 401 mid-buy. */
  signIn(): void
  /**
   * An empty balance mid-buy.
   *
   * Given what the reader was TRYING to spend, so the surface that handles
   * it can offer exactly that rather than a number nobody asked about. It
   * answers whether money actually landed: true means the chip should throw
   * away its cached book and let them press Buy again, and anything else
   * means the reader has been sent somewhere (the panel) or changed their
   * mind, and the chip says nothing further.
   */
  topUp(usd?: number, mode?: TopUpMode, ctx?: TopUpContext): Promise<boolean> | void
  /**
   * Which rail "Deposit USDC" takes. A wallet account's money lives in its
   * own wallet, so its door is the panel's address screen (through topUp),
   * not the chip's amount picker, whose "Straight to your Poppin balance"
   * would be a lie there. Absent reads as custodial.
   *
   * THAT IS THE WHOLE RULE AGAIN, restored 2026-09-22. topUp had drifted
   * into signing a SOL → USDC conversion for a wallet account, so this
   * branch quietly became "open Phantom and sell the reader's SOL" under a
   * button that said Deposit. The address screen is the only destination on
   * this side; the guard that keeps it there is in primary/main.tsx's topUp.
   */
  fundRoute?(): Promise<"external" | "custodial">
  /**
   * The price the chip paints, for mints this chip does not watch: the
   * Activity list's "% away" for an alert on another asset. Absent, or
   * absent for a mint, and the enrich cache's quote price stands in.
   */
  midPrices?(mints: string[]): Promise<Map<string, number>>
  /**
   * The invite door, opened by the first landed trade. `landed()` records
   * that this browser has seen one and says whether it was the first;
   * `info()` answers the reader's code and counts, or null when signed out.
   * Absent, and no invite surface exists on the chip.
   */
  invite?: {
    landed(): Promise<{ first: boolean }>
    info(): Promise<{ code: string; joined: number; earnedUsd: number; hasTraded: boolean } | null>
  }
  /**
   * The reader's points standing: the multiplier a seat is worth, and the
   * seat's own number when they hold one. A landed receipt says "+N pts";
   * the receipt that CLAIMS the seat says the seat instead, once.
   */
  points?: {
    status(): Promise<{ mult: number; seat: number | null }>
  }
  /**
   * Does this page have an injected wallet? Optional: a surface that cannot
   * answer (a test, a page with no bridge) simply keeps the old wording.
   */
  hasWallet?(): Promise<boolean>
  track(event: string, payload: Record<string, unknown>): void
  /** Mints the remote config has switched off. */
  disabledMints: ReadonlySet<string>
  /**
   * The reader's book: spendable cash, and every position with the raw units
   * the sell endpoint takes and the basis a sale is judged against.
   *
   * Optional because a chip that cannot read it is still a working chip — the
   * lines that need it are left out rather than faked.
   */
  book?(): Promise<{
    cashUsd: number
    /** All-time P&L, open and closed. Null = unknowable, never 0. */
    totalPnlUsd?: number | null
    /** Everything the reader owns, priced. */
    totalUsd?: number
    positions: Array<{
      mint: string
      uiAmount: number
      raw: string
      /** null = basis unknowable (predates the ledger). NEVER zero. */
      netInvestedUsd: number | null
      /** Market cap at the reader's first buy; null when unrecorded. */
      entryMcapUsd?: number | null
      /**
       * THESE WERE ALREADY ON THE WIRE. /positions has returned ticker,
       * priceUsd, valueUsd and pnlUsd per row all along, and the host's
       * adapter mapped five fields out of nine and dropped the rest — the
       * same "read two of six and discard the rest" this codebase has now
       * found in the verifier, in Ultra's mcap and in GeckoTerminal's
       * OHLCV. Nothing new is fetched to fill them in.
       */
      ticker?: string
      priceUsd?: number | null
      valueUsd?: number | null
      pnlUsd?: number | null
      /** Dollars this mint's sells banked; null = incomputable, never 0. */
      realizedPnlUsd?: number | null
      /** Up or down right now, on the units the ledger can price. */
      unrealizedPnlUsd?: number | null
      /** True average cost of what is still held — the honest basis the
       *  face badge and the chart's entry line are drawn from. */
      avgEntryPriceUsd?: number | null
    }>
    /** Banked across the whole book, exited mints included. */
    totalRealizedPnlUsd?: number | null
    /** What the OPEN book is up or down right now — the headline. */
    totalUnrealizedPnlUsd?: number | null
  } | null>
  /** Sell exact-in RAW units — the same endpoint the card's sell uses. */
  sell?(
    mint: string,
    amountRaw: string,
    sourceUrl?: string,
    /** This press's identity, so a retry cannot sell twice. */
    idempotencyKey?: string,
  ): Promise<{ signature: string; dryRun: boolean }>
  /**
   * How many distinct people bought from this tweet — counted from the
   * trade ledger's source_url receipts, every buy the chip drove whether
   * or not anybody posted about it. Behind the sheet tap ONLY: the
   * timeline rule stands, no network per tweet.
   */
  pageProof?(tweetUrl: string): Promise<{ buyers: number } | null>
  /**
   * The reader's own Poppin username (no @), for the share card's
   * poppin.so/@handle brand line. null when signed out or unknown — the
   * card then wears the plain address, never a broken one.
   */
  myHandle?(): Promise<string | null>
  /**
   * Park a price alert — the free step before an order. True when saved,
   * false when the same ask already stands. Storage is the caller's;
   * the chip only derives and hands over.
   */
  saveAlert?(alert: PriceAlert): Promise<boolean>
  /** The standing alerts, for the scoreboard's Activity tab. */
  listAlerts?(): Promise<PriceAlert[]>
  removeAlert?(id: string): Promise<void>
  /**
   * Recent product notifications, PRE-SENTENCED by the host. The chip
   * renders `text` verbatim and never sees a type: the first wiring handed
   * raw types through and the reader met a wall of "An Arc market needs a
   * resolve decision" rows from a retired product, plus a bare "follow" —
   * a type name wearing a sentence's seat. The host owns the whitelist
   * and the words; the chip owns the pixels.
   */
  listNotifications?(): Promise<
    Array<{
      id: string
      /** A closed design vocabulary, not the DB's type column: the host
       *  maps whatever eras the table holds onto these six, and the chip
       *  picks a glyph. Unknown never reaches here — it died at the
       *  host's whitelist. */
      kind: "follow" | "reply" | "comment" | "mention" | "like" | "share"
      text: string
      created_at: string
      /** The actor's own photo, when the host knows it. A person's face
       *  turns a log line into somebody you know; absent falls back to the
       *  kind's glyph, which is what every row wore before. */
      avatarUrl?: string | null
      /** Where this news can be visited, as a panel route — the host
       *  decides, the chip only opens. Absent, the row stays plain. */
      route?: string | null
    }>
  >
  /**
   * WHO THE READER FOLLOWS IS IN WHAT. Resolved ONCE per page by the host
   * and handed to every chip, which picks out its own mint — a timeline
   * mounts dozens of rows and a per-mint lookup would be dozens of
   * requests for a decoration.
   *
   * Absent, or empty, and the row simply carries no faces. This is the
   * one piece of the row that is allowed to be missing without the row
   * being wrong.
   */
  /**
   * WHAT THIS TWEET'S AUTHOR HAS DRIVEN — how many distinct readers bought
   * from their calls. Resolved once per page like the crowd above.
   *
   * NOT the author's own position, which is the thing Fomo's home screen
   * shows and the thing we cannot honestly show yet: that would publish a
   * named person's P&L, and no consent for it exists anywhere in the
   * product. This is the number the callers board already computes and
   * already publishes — an aggregate of OUR users' behaviour, with the
   * same N>=3 floor the rest of the source_url surface keeps, because an
   * aggregate of one names a person's trade.
   */
  callerFor?(handle: string): Promise<{ buyers: number } | null>
  /**
   * THE READER'S OWN PLACE, for the scoreboard only. Deliberately NOT on
   * the resting row: your rank is the same number under every tweet, and a
   * figure that never varies with what it sits beside is wallpaper. It
   * belongs where somebody has already asked how they are doing.
   */
  myRank?(): Promise<{ rank: number | null } | null>
  /** Alerts that FIRED — the news the pill counts and Activity lists. */
  listFired?(): Promise<FiredAlert[]>
  /** Standing orders that FILLED — same news channel as a crossed alert. */
  listFills?(): Promise<PendingFill[]>
  /** Mark every fired alert seen; the pill's dot goes back to sleep. */
  markFiredRead?(): Promise<void>
  /**
   * Live unread count. The host wires it to storage.onChanged, so an alert
   * firing in the background lights every pill on the page WITHOUT a
   * single network request — the news is already on this machine.
   */
  /**
   * News for this chip's bell. `alive` lets the provider drop the watcher
   * when the chip is recycled: a timeline mounts these for as long as
   * somebody scrolls, and a subscription with no way to end retains every
   * chip that ever existed.
   */
  watchUnread?(cb: (n: number) => void, alive: () => boolean): void
  /**
   * The size the reader last actually bought (helpers/clip). Read once per
   * page so the resting chip can say what a press will do; written after a
   * buy or sell lands. Absent hosts fall back to the preset, exactly as
   * before, so nothing depends on this existing.
   */
  clip?: {
    read(): Promise<{ usd: number; sellPct: number }>
    write(clip: { usd: number; sellPct: number }): void
  }
  /** The reader's standing orders, and the exit from one. */
  listOrders?(): Promise<
    Array<{
      orderKey: string
      mint: string
      /** Already carried by TriggerOrderRow; the panel prints it. */
      symbol?: string | null
      side: "buy" | "sell"
      amountUsd: number | null
      amountUi: number
      triggerPriceUsd: number
      gated: boolean
    }>
  >
  cancelOrder?(orderKey: string): Promise<unknown>
  /** The panel, opened on the reader's own portfolio rather than an asset. */
  openHome?(): void
  /** The feed room itself — no asset, no tweet. See openFeedInPanel. */
  openFeed?(): void
  /** The persisted book, display-grade: paints the scoreboard instantly
   *  while the live read (8.6s cold) lands and corrects. Never trades. */
  cachedBook?(): ReturnType<NonNullable<XStripDeps["book"]>>
  /**
   * The homecoming's memory, across pages: the last P&L figure each mint's
   * badge SHOWED this reader. Real remembered numbers only - no clock, no
   * invented deltas, nothing farmable. Absent, the greeting still works
   * within one page's life exactly as before.
   */
  mineSeen?: {
    read(): Promise<Record<string, number>>
    write(mint: string, v: number): void
  }
  /** A panel room by route — the news rows' door. See openPanelRoom. */
  openRoom?(route: string): void
  /**
   * WHO IS READING, so the chip can say whose it is.
   *
   * The strip is the one surface a reader sees all day and it answered
   * nothing about identity: the wallet key was an abstract glyph and the
   * reader's own room opened on a number with no name over it. Two
   * surfaces use this and neither invents anything when it answers null —
   * signed out keeps the glyph and grows no name row.
   *
   * `id` is a Firebase uid and goes straight into a panel route, so the
   * provider validates it; see readerIdentity in the content script, which
   * also caches it once per page (a timeline mounts dozens of strips).
   */
  me?(): Promise<{ id: string; username: string; photoUrl: string | null } | null>
  /**
   * Whether money can be added WITHOUT leaving this page — i.e. whether an
   * injected wallet is present on x.com.
   *
   * The chip asks before it offers, rather than finding out after the
   * press. topUp() already falls back to the panel when there is no page
   * wallet, and that fallback is correct; what is not correct is a button
   * that says "add funds here" and then opens a sidebar. Absent hosts read
   * as "cannot", which is the safe answer: the panel door is still there.
   */
  canFundHere?(): Promise<boolean>
  /**
   * The reader's own custodial Solana address, for the one funding route
   * that needs nothing from anybody: they send USDC to it from wherever
   * they already hold it.
   *
   * This is the answer to "can we do it without leaving X at all". A
   * hosted card flow cannot run here — x.com's frame-src decides that,
   * not us — but an address is text, and text has no CSP.
   */
  myAddress?(): Promise<string | null>
  /**
   * Line or candles, remembered across pages. Absent hosts keep the line,
   * which is what shipped, so nothing depends on this existing.
   */
  chartView?: {
    read(): Promise<"line" | "candle">
    write(v: "line" | "candle"): void
  }
  /**
   * Is this page's extension context still there? Reloading or auto-updating
   * the extension orphans every tab that was already open: the chip stays on
   * screen, fully drawn, and nothing behind it can ever answer again. Absent
   * in tests and in any host that cannot tell, which reads as alive.
   */
  alive?(): boolean
  /**
   * Test seam. The chip's shadow is CLOSED in production, which is the right
   * posture on somebody else's page — X can neither read nor restyle what we
   * mount. It also means no test can see a single thing the chip renders, and
   * for a long time nothing here was covered beyond "did a host appear".
   * Opening it under test costs production nothing and covers the sheet.
   */
  shadowMode?: "open" | "closed"
  /** Test seam for the cooldown clock. */
  now?(): number
  /** Test seam for "is this strip in the reader's screenful right now". */
  onScreen?(el: Element): boolean

  /**
   * CALLED THE FIRST TIME A CHIP LANDS ON THIS PAGE.
   *
   * Two Poppin surfaces at once is incoherent, and on a news article it
   * was literally visible: a row under the headline and, at the same
   * moment, the page card's tab on the right rail. The chip is the more
   * specific answer — it is attached to the thing the reader just read —
   * so it is the one that stays, and the page's general answer stands
   * down. Once per page: a feed mounts dozens and the card only needs
   * telling once.
   */
  onFirstChip?(): void
}

export interface XStripController {
  /** Judge one cell now. Exposed for tests; production goes through flush. */
  processCell(cell: Element): void
  /** Judge a batch: one screenful snapshot, one forced layout, N chips. */
  processCells(cells: readonly Element[]): void
  scan(root?: ParentNode): void
  /** The book changed under the page (a deposit landed): every wallet pill and open sheet re-reads. */
  onBookChanged(): void
  stop(): void
  /** A live tick for a mint — every mounted strip showing it updates. */
  updatePrice(mint: string, usdPrice: number, change24hPct: number | null): void
  /** A sign-in landed elsewhere: drop the 401 verdict, warm fresh, repaint. */
  onSignedIn(): void
  /** Print what the last pass saw, even if it saw nothing. Diagnostics only. */
  reportSweep(): void
}

type Book = NonNullable<Awaited<ReturnType<NonNullable<XStripDeps["book"]>>>>

export function createXStrip(deps: XStripDeps): XStripController {
  /**
   * WHICH FEED THIS INSTANCE IS READING. X unless told otherwise, so every
   * existing caller keeps the behaviour it had. Held per instance rather
   * than per module because two feeds can be open in two tabs at once, and
   * a module-level selector would have made the second tab read the first
   * one's DOM.
   */
  const site = deps.site ?? X_SITE
  const CELL = site.cell
  const ARTICLE = site.post

  /**
   * A MEASUREMENT MUST NEVER STOP THE THING IT MEASURES.
   *
   * Every control on this chip opens by reporting itself and only then
   * does its work. In production that report is chrome.runtime.sendMessage,
   * which THROWS SYNCHRONOUSLY once the extension has been reloaded or
   * auto-updated under an open tab — a `.catch()` on the returned promise
   * never sees it. So the throw landed before the chart, before the sheet,
   * before the panel: the chip stayed on screen looking alive while every
   * control was dead and said nothing. Reported from the field as "asagi
   * hover a basinca calismiyor".
   *
   * fetchService already turns that same state into an honest refusal
   * ("Poppin updated — reload the page") and the buy path already speaks
   * it — the reader simply could never reach it, because telemetry died one
   * statement earlier. One wrapper here covers all twelve call sites; the
   * deps implementation is guarded too, and neither is redundant, because
   * this file must not care what a host does with a report.
   */
  /**
   * AN ORPHANED CHIP MUST SAY SO, not fail quietly.
   *
   * Even with telemetry no longer able to throw, a page whose extension was
   * reloaded under it cannot reach the service worker: the chart never
   * loads, the balance never arrives, the trade dies at the network. The
   * refusal existed only at the far end of the money path, so the reader
   * composed a whole order before learning the page was already dead.
   *
   * Chrome does not update the page. Only a refresh does, so that is what
   * the chip asks for, at the first press rather than the last.
   */
  const dead = () => deps.alive !== undefined && !deps.alive()

  const track: XStripDeps["track"] = (event, payload) => {
    try {
      /**
       * EVERY STRIP EVENT CARRIES THE HOST, stamped at the one chokepoint
       * they all pass through rather than at each of the thirty call sites.
       *
       * `page_scanned` has always carried it and `card_shown` never did, so
       * on 2026-09-23 all 13,832 chips answered "(kayıt yok)" when asked
       * where they were drawn. The product's whole claim is "tweet, Reddit
       * post, or any website", and the one event that could have measured
       * it was the one event with no address on it. Scans said x.com 7,446
       * to Reddit 5; whether CHIPS follow that shape was unanswerable.
       *
       * The payload spreads last, so a caller that already knows better
       * than `location` wins.
       */
      deps.track(event, {
        host: location.hostname,
        ...((payload as Record<string, unknown>) ?? {}),
      })
    } catch {
      // An orphaned page cannot report. It can still work until it is
      // asked for money, and that path has words of its own.
    }
  }
  /**
   * THE DENOMINATOR. One summary per document rather than a row per tweet,
   * because the funnel's first question — of the chances we had, how many
   * did we take — cannot be asked at all today: nothing in this extension
   * has ever emitted page_scanned, so the funnel begins at card_shown and
   * every "the chip does not appear" report has been an anecdote with no
   * rate behind it. See helpers/scanTally.
   */
  const tally = createScanTally({
    track,
    host: typeof location !== "undefined" ? location.hostname : "",
  })

  /**
   * WHAT YOUR POSITION LOOKED LIKE THE LAST TIME YOU SAW IT, per mint, for
   * this page's life.
   *
   * X's virtualizer recycles cells, so the same asset is re-served to the
   * same reader dozens of times in a session — and every one of those
   * mounts was amnesiac. This is the whole of the "homecoming": when a chip
   * mounts for something you hold and the number has MOVED since you last
   * laid eyes on it, the badge counts from the old figure to the new one
   * inside the entrance that was already running.
   *
   * FROM LAST-SEEN, NOT FROM ENTRY, and that single choice is what keeps it
   * out of the casino. A flat market produces literally zero motion; there
   * is no clock, no streak, nothing that pays out for coming back, and
   * nothing a reader could farm by scrolling. The product moves exactly
   * when their money did.
   */
  /**
   * SHOULD ANYTHING MOVE. One answer, for every animation this file runs.
   *
   * The stylesheet's `@media (prefers-reduced-motion: reduce)` blanket kills
   * `animation` and `transition` — and reaches NEITHER of the two things
   * this file animates in JavaScript. element.animate() is the Web
   * Animations API, which no media query touches, so a reader who asked
   * their operating system to stop motion still got every tail swap sliding
   * at them. The count-up already had this guard written correctly and
   * inline; it was never lifted out, so the other caller never got it.
   *
   * NO matchMedia AT ALL READS AS REDUCED (jsdom, odd embeds): stillness
   * that could not check the preference is always correct, an animation
   * that could not check it is a guess about somebody's health.
   */
  /**
   * WHERE THE REWARD LIVES. Everything else this file needs from the outside
   * world arrives through XStripDeps, and the one bare `chrome.` call in
   * here used to be a comment describing one. This stays a direct lookup
   * rather than a seventh dependency — it is a decoration, and threading it
   * through every caller and every spec would cost more than it is worth —
   * but it is GUARDED, because the call site sits inside the done ceremony.
   * An exception thrown while decorating a landed trade would take the
   * receipt down with it, and a reader who just spent real money would be
   * told nothing at all. No chrome, no ornament, receipt intact.
   */
  const rewardUrl = (): string => {
    try {
      return chrome?.runtime?.getURL?.("pop-reward.webp") ?? ""
    } catch {
      return ""
    }
  }

  const reducedMotion = () =>
    typeof matchMedia !== "function" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches

  /**
   * LINE OR CANDLES, and the reader's choice outlives one chart.
   *
   * Not a per-chip toggle: somebody who thinks in candles thinks in candles
   * on every asset, and making them re-pick on each tweet is the kind of
   * amnesia the homecoming already fixed elsewhere. Page-scoped like the
   * clip, persisted through the host so it survives a reload.
   */
  let chartView: "line" | "candle" = "line"
  const chartViewSwitches = new Set<(v: "line" | "candle") => void>()
  if (deps.chartView) {
    void deps.chartView.read().then((v) => {
      chartView = v
      for (const apply of chartViewSwitches) apply(v)
    })
  }

  const lastMineShown = new Map<string, number>()
  /**
   * THE REAL HOMECOMING crosses the page boundary: closing the laptop on
   * "You +8.2%" and opening X tomorrow to +31% used to paint the new
   * figure with zero motion, because this map died with the page. The
   * persisted copy seeds it; in-page memory still wins (fresher).
   */
  void deps.mineSeen?.read().then((remembered) => {
    for (const [mint, v] of Object.entries(remembered)) {
      if (!lastMineShown.has(mint) && typeof v === "number") {
        lastMineShown.set(mint, v)
      }
    }
  })
  /**
   * THE CLIP, page-scoped and read once. It decides two labels and one
   * default, and the labels are the point: today "Buy" hides the amount
   * until a sheet opens, so the single fact that governs how much money
   * moves is the one the feed will not show. Saying it at rest is strictly
   * more disclosure than saying nothing.
   */
  let clip = { usd: PRESET_USD[1] as number, sellPct: 100 }
  /**
   * HOLD-TO-BUY's arming time. Long enough that no scroll-thumb ever
   * fires it (X's own long-press menus arm around here), short enough
   * that the sweep reads as a beat and not a chore.
   */
  const HOLD_BUY_MS = 650
  /** Resting buttons that show the clip, so a late read can correct them.
   *  Each entry drops ITSELF once its chip leaves the document — see the
   *  note at relabelHold. Iterated over a copy, because the callbacks
   *  mutate this set. */
  const clipLabels = new Set<() => void>()
  /** Mounted strips' wal refreshers, for the sign-in flip (see onSignedIn).
   *  Guarded by host.isConnected inside, so a recycled cell costs nothing. */
  const walRefreshers = new Set<() => void>()
  /** Open sheets' balance readers, so a book change reaches every sheet that is up. */
  const sheetRefreshers = new Set<() => void>()
  if (deps.clip) {
    void deps.clip.read().then((c) => {
      clip = c
      // Every resting chip already mounted repaints its label; a chip that
      // mounts later reads the updated value on its own.
      for (const relabel of [...clipLabels]) relabel()
    })
  }
  const enrichCache = new Map<string, Promise<MatchedAsset | null>>()
  /**
   * ONE read of the reader's book for the whole page, and only once a sheet
   * is opened. /positions is 8.6s cold and 186ms warm, which is fine for a
   * fact fetched when someone starts composing an order and unaffordable for
   * one fetched per chip on a scrolling feed. Cleared after a trade so the
   * next sheet reflects it.
   *
   * It answers all three questions at once — cash, the holding in raw units,
   * and the basis a sale is judged against. The sheet used to read cash here
   * and the holding from /balance, which was two round trips for facts that
   * arrive together, and /balance cannot answer the third at all.
   */
  let bookOnce: Promise<Book | null> | null = null
  /**
   * Whether this page has an injected wallet, asked ONCE and remembered.
   * It decides only the wording of the funding button (see the rulebook), so
   * an unanswered probe simply leaves the old words in place.
   */
  let walletOnPage = false
  let walletAsked = false
  /** Tweet URL → its proof count. One read per tweet, behind the tap. */
  const proofCache = new Map<string, Promise<{ buyers: number } | null>>()
  /** The standing orders, read once per page and dropped after any change. */
  let ordersOnce: Promise<
    Awaited<ReturnType<NonNullable<XStripDeps["listOrders"]>>>
  > | null = null
  /**
   * When the remembered book was taken. It used to be remembered FOREVER:
   * the first sheet on a page read the holdings once and every sheet after
   * it trusted that snapshot until a full reload, so a position acquired
   * anywhere else — bought in the panel, transferred in, funded after the
   * page opened — did not exist as far as the chip was concerned. Measured
   * live on $ORE: the panel showed $5.15 held while the sell sheet said
   * "Nothing to sell" and the 25/50/Max buttons did nothing at all.
   *
   * Reads inside the chip still invalidate it directly (a buy knows the
   * book changed). This is for everything the chip cannot see.
   */
  let bookAt = 0
  const BOOK_TTL_MS = 20_000
  /**
   * WHY the book is empty, not just THAT it is. `.catch(() => null)` folded
   * signed-out, a cold read and a server failure into one silence, so the
   * funnel's most important state — a reader with no account yet — was
   * indistinguishable from a network blip everywhere downstream: the sheet
   * armed a green Buy that could not buy, and the first "Sign in to trade"
   * arrived only as the 401 after the press. The background hands errors
   * over with their status, so a 401 is knowable here; everything else
   * stays the honest "unknown" it always was.
   */
  let bookAuth: "unknown" | "signed-out" | "ok" = "unknown"
  const book = () => {
    if (!deps.book) return Promise.resolve(null)
    if (bookOnce === null || now() - bookAt > BOOK_TTL_MS) {
      bookAt = now()
      bookOnce = deps
        .book()
        .then((b) => {
          bookAuth = "ok"
          return b
        })
        .catch((e) => {
          bookAuth =
            (e as { status?: number } | null)?.status === 401
              ? "signed-out"
              : "unknown"
          return null
        })
    }
    return bookOnce
  }
  /**
   * Ask again, WITHOUT throwing away the answer we already have.
   *
   * /embed/asset/positions was measured at 8.6s cold and 186ms warm, so a
   * sell sheet that waits for a fresh read before saying anything leaves
   * "Reading your balance…" on screen for most of ten seconds. The
   * remembered book answers instantly and this replaces it when it lands;
   * callers re-judge on the second answer.
   */
  const refreshBook = (): Promise<Book | null> => {
    if (!deps.book) return Promise.resolve(null)
    const p = deps.book().catch(() => null)
    void p.then((b) => {
      // A failed refresh must not overwrite a good remembered book.
      if (b !== null) {
        bookOnce = Promise.resolve(b)
        bookAt = now()
      }
    })
    return p
  }
  /** Everything one sheet needs about the reader, from the one read. */
  const readerFor = (mint: string, fresh = false): Promise<Reader | null> =>
    (fresh ? refreshBook() : book()).then((b) => {
      if (!b) return null
      const pos = b.positions.find((p) => p.mint === mint) ?? null
      return {
        cashUsd: b.cashUsd,
        uiAmount: pos?.uiAmount ?? 0,
        raw: pos?.raw ?? "0",
        /**
         * WHERE THEY GOT IN, as a market cap. This used to be
         * netInvestedUsd / uiAmount — net cash out over units still held —
         * which is a cost basis only for a position never sold and goes
         * negative after a profitable round trip. The cap is recorded at
         * the trade instead: no division, no basis, nothing to drift.
         */
        entryMcapUsd: pos?.entryMcapUsd ?? null,
      }
    })
  const shownMints = new Set<string>()
  /**
   * `shownMints` counts chips this code MOUNTED; this counts the ones a
   * reader actually had in front of them. helpers/chipSeen says why the
   * two are different claims and why only their ratio answers the
   * question the funnel has been asking wrong.
   */
  const seenWatch = createChipSeenWatch({
    track,
    /**
     * THE CARD WAITS FOR A CHIP SOMEBODY IS LOOKING AT.
     *
     * It used to draw on the first chip that MOUNTED, which on a feed that
     * mounts cells above and below the fold is usually a chip nobody sees.
     * Measured 2026-09-25: 212 chips placed, 38 seen, and of ten readers
     * shown a card that day not one pressed Next, while the same four
     * steps clicked through by hand in five seconds. The card was fine;
     * it was being drawn where nobody was looking.
     */
    onSeen: (el) => {
      const chip = (el as HTMLElement).closest?.(".chip") ?? el
      void maybeCoach({
        chip: chip as HTMLElement,
        pending: coachPending,
        clear: markCoachSeen,
        track,
      })
    },
  })
  const now = deps.now ?? (() => Date.now())
  const visible = deps.onScreen ?? onScreen
  /**
   * Tweets that already earned a name-tier strip.
   *
   * The rule above stops the SAME asset wallpapering ONE SCREEN across
   * DIFFERENT tweets. Left alone it would also forget tweets: X recycles
   * cells, so scrolling past a name-tier post and back could tear its strip
   * down and then refuse to put it back, and the post would silently lose its
   * Buy on the return trip.
   *
   * A tweet that has already earned a strip is not new wallpaper, it is the
   * same one wall. It gets through regardless of what else is on screen.
   */
  const nameShownFor = new Set<string>()
  /** mint → live updaters of every strip currently showing it. */
  /**
   * WHO WANTS THIS MINT'S PRICE — and it has to be able to SHRINK.
   *
   * This was a Set of bare callbacks with an `add` and no `delete`: the
   * only removal in the file is the whole-map clear in stop(). X recycles
   * timeline cells constantly, so every chip a reader scrolled past stayed
   * registered for the life of the tab, and each retained callback holds
   * its host, its shadow root and every closure variable behind it. A long
   * session therefore kept hundreds of dead chips alive AND made every
   * price tick loop over all of them.
   *
   * The callback already checked `host.isConnected` and returned, so no
   * dead chip ever PAINTED. That is exactly what made this invisible: the
   * symptom is not a wrong pixel, it is a tab that gets slower for an hour
   * and then stops.
   *
   * The host rides along so the registry can prune itself on the next
   * tick, with no teardown plumbing to forget at a call site.
   */
  type TickTarget = { host: Element; fn: (usd: number, chg: number | null) => void }
  const tickTargets = new Map<string, Set<TickTarget>>()
  const watched = new Set<string>()

  /**
   * FAILURE IS NOT ABSENCE — the same split the ticker lane already makes,
   * and the place where getting it wrong costs the most.
   *
   * This used to be `.catch(() => null)` written straight into the cache, so
   * one cold backend or one dropped request became "there is no such asset",
   * remembered as firmly as a real answer for the whole life of the page.
   * The consequence is not a missing detail: the chip mounts, asks here, and
   * on a null DELETES ITSELF (`host.remove()`), so every later tweet about
   * that token stayed chipless too — measured live on $PANTS, where by-ticker
   * and by-mint both answer perfectly from the server.
   *
   * A NULL from the server still caches firmly: "no such asset" is an answer,
   * and re-asking would be a request per tweet. A REJECTION drops out of the
   * cache so the next tweet asks again.
   */
  const enrich = (mint: string) => {
    let p = enrichCache.get(mint)
    if (!p) {
      const asked = deps.enrich(mint)
      p = asked.catch(() => null)
      if (enrichCache.size > 40) enrichCache.clear()
      enrichCache.set(mint, p)
      asked.catch(() => {
        // Only evict OUR entry: a clear() above may already have replaced it.
        if (enrichCache.get(mint) === p) enrichCache.delete(mint)
      })
    }
    return p
  }

  /**
   * OUR STRIP FOR THIS CELL, WHEREVER THE ADAPTER PUT IT.
   *
   * On a feed the chip is mounted inside the post, so looking within the
   * cell finds it. On an article the cell IS the headline and the chip is
   * its next sibling, so the same lookup found nothing and every guard
   * built on it read "no chip here" forever.
   */
  const stripOf = (cell: Element): HTMLElement | null => {
    const inside = cell.querySelector<HTMLElement>("[data-poppin-strip]")
    if (inside) return inside
    const next = cell.nextElementSibling
    return next?.matches("[data-poppin-strip]") ? (next as HTMLElement) : null
  }

  /**
   * HOW OFTEN A CELL MAY BE REBUILT, and why there is a ceiling at all.
   *
   * CNBC server-renders and then hydrates, and React removes children of a
   * container it manages that it did not put there — so the chip appeared
   * under the headline and vanished a moment later. The cure is to notice
   * and mount again, and the danger in that cure is a page whose framework
   * removes it every time: two loops racing forever, on somebody else's
   * site, with our name on it.
   *
   * Three tries. Enough for a hydration pass and a re-render after it, far
   * short of a fight.
   */
  const REMOUNTS_ALLOWED = 3
  const remounts = new Map<string, number>()

  /**
   * WHAT THE SCAN ACTUALLY SAW, for a reader with the console open.
   *
   * `tally` above answers this for the funnel, in aggregate, a minute at a
   * time. That is the right shape for a rate and the wrong shape for the
   * question a person asks while staring at a tweet that has no chip: did
   * you even look at it. Until now the only honest answer was "cannot
   * tell", because a cell with nothing tradeable in it left no trace at
   * all — and neither did a cell the strip never reached, so a missing
   * chip and a missing strip were indistinguishable.
   *
   * Coalesced rather than one line per cell: X hard-virtualizes the
   * timeline and re-serves the same handful of cells on every scroll, so a
   * line each would bury the console in seconds and tell the reader less.
   */
  /** The page card is told once, on the first chip. See onFirstChip. */
  let toldTheHost = false

  const sweep = {
    cells: 0,
    noArticle: 0,
    half: 0,
    tagged: 0,
    matched: 0,
    mounted: 0,
    ceiling: 0,
    named: new Set<string>(),
  }
  let sweepSaid = -1
  let sweepTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * The first report always speaks, even when it has nothing to report.
   *
   * The earlier version only spoke when the count had moved, so a strip
   * that found NO posts said nothing — which is indistinguishable from a
   * strip that never started, and is precisely the case a reader is trying
   * to diagnose. Measured on Reddit: no line at all, and the absence was
   * read as "the strip never ran" when the truth was "the selectors found
   * nothing". A diagnostic that cannot report zero cannot do its job.
   */
  const saySweep = (): void => {
    if (sweepTimer) return
    sweepTimer = setTimeout(() => {
      sweepTimer = null
      if (sweep.cells === sweepSaid) return
      sweepSaid = sweep.cells
      const named = sweep.named.size > 0 ? ` (${[...sweep.named].join(", ")})` : ""
      dbg(
        `scanned ${sweep.cells} cells: ${sweep.tagged} carried a cashtag, ` +
          `${sweep.matched} named something tradeable${named}, ` +
          `${sweep.mounted} chips mounted, ${sweep.ceiling} held back as a ` +
          `repeat, ${sweep.half} were half-rendered, ${sweep.noArticle} ` +
          `held no tweet`,
      )
    }, 1500)
  }

  function processCell(cell: Element): void {
    sweep.cells++
    saySweep()
    // The cell IS the post on a site that has no wrapper around it. Reddit
    // measured [0 article, 1 shreddit-post] on a post page, so a lookup
    // that only ever searched INSIDE the cell found nothing at all there.
    const article = cell.matches?.(ARTICLE) ? cell : cell.querySelector(ARTICLE)
    if (!article) {
      sweep.noArticle++
      // Recycled into a non-tweet (separator, "show more"). Whatever we
      // attached belongs to a tweet that is gone.
      stripOf(cell)?.remove()
      cell.removeAttribute(ID_ATTR)
      return
    }

    const facts = extractTweet(article, site)
    if (!facts) {
      sweep.half++
      return // half-rendered; a later mutation will bring the rest
    }

    /**
     * SEEN, AND STILL IT — ONE VERDICT PER TWEET, AND NO SECOND GUESS.
     *
     * A "did we leave a chip here, and is it still here?" presence check
     * lived on this line for one round and was taken back out. It is the
     * kind of repair that reads as free and is not: the removal it heals
     * has never been measured (see the header), it cannot explain a
     * hover-triggered symptom at all — nothing in this file listens for
     * hover and the observer watches childList — and the flush that drives
     * this function fires on idle with a 300ms timeout / 120ms fallback.
     * So a removal that RECURRED would have been answered by re-mounting a
     * brand-new host, closed, with its 0.32s entrance, several times a
     * second: the loudest possible version of the flicker it was meant to
     * cure, plus a fresh TickTarget, walRefresher and clipLabel per pass.
     *
     * The mark keeps its ONE job, which is the job it was written for:
     * buy-under-the-wrong-tweet. Same id, we are done here; different id,
     * everything below runs again from scratch.
     */
    if (cell.getAttribute(ID_ATTR) === facts.id) {
      // Seen, and still it — but a mark is not a chip. If the host took
      // ours away, come back, a bounded number of times.
      if (stripOf(cell)) return
      const tried = remounts.get(facts.id) ?? 0
      if (tried >= REMOUNTS_ALLOWED) return
      remounts.set(facts.id, tried + 1)
      dbg(`remounting ${facts.id}: the page removed the chip (${tried + 1})`)
    }

    // A different tweet lives here now (or it is brand new). Old verdicts —
    // strip or silence — are about somebody else.
    stripOf(cell)?.remove()
    cell.setAttribute(ID_ATTR, facts.id)

    const match = matchTweet(facts.text, facts.cashtags, deps.disabledMints, facts.author)
    if (facts.cashtags.length > 0) sweep.tagged++
    if (match) {
      sweep.matched++
      sweep.named.add(`${match.row.ticker} by ${match.tier}`)
    }

    /* Everything the tweet said besides an address, in the order it was
       always asked. The address lane below falls back to exactly this. */
    const proceed = (): void => {
      /**
       * THE AUTHOR'S FIRST `$` IS THE SUBJECT — including when we have never
       * heard of it.
       *
       * The matcher's own rule is that the first cashtag wins, and in practice
       * it had become "the first cashtag we happen to know". Measured live: a
       * tweet opening with "$BULLSHIT" and mentioning "$ANSEM" three lines
       * later wore an ANSEM chip, because ANSEM is in the shipped catalog and
       * BULLSHIT is not. The reader's verdict was the correct one — "asıl konu
       * bullshit coin, ansem değil" — and no amount of local list-growing
       * fixes the class, because the subject of a memecoin tweet is usually a
       * token younger than our last build.
       *
       * So when the first cashtag is not what we matched, the server is asked
       * about it BEFORE anything mounts. Nothing is drawn in the meantime: a
       * chip that appears as ANSEM and silently becomes BULLSHIT is worse than
       * one that appears 300ms later already right. The local match is carried
       * along as the fallback, so a miss lands exactly where today lands.
       */
      const firstTag = facts.cashtags[0]
      const firstKey = firstTag?.replace(/^\$/, "").toUpperCase() ?? ""
      const matchedKey = match?.row.ticker.replace(/^\$/, "").toUpperCase() ?? ""
      if (deps.resolveTicker && firstKey && firstKey !== matchedKey) {
        resolveFirstCashtag(cell, article, facts, firstTag, match)
        return
      }

      if (!match) {
        if (deps.readText) askReader(cell, article, facts)
        return
      }

      if (match.tier === "name" && !nameShownFor.has(facts.id)) {
        /**
         * THREE, NOT ONE. The anti-wallpaper rule was born from a real
         * screenshot (five $SOL strips in one screenful) and it overshot:
         * measured live on a memecoin timeline, a tweet reading "useless
         * and fartcoin had a baby" showed NO chip, then showed one after a
         * scroll — same tweet, same asset, different scroll position. A
         * chip that appears depending on where the page happens to sit does
         * not read as restraint, it reads as broken, and the owner's rule
         * is the plainer one: "twitter'ın gösterdiği yerde biz
         * göstermiyoruz saçmalık."
         *
         * A ceiling still exists, because the wallpaper report was also
         * real. It is just high enough that a feed genuinely about one
         * token stops being punished for it.
         */
        if (mintsOnScreen().filter((m) => m === match.row.mint).length >= 3) {
          sweep.ceiling++
          return
        }
        nameShownFor.add(facts.id)
        // A strip mounted earlier in THIS batch is on screen too, even though
        // the snapshot was taken before it existed.
        if (inBatch) onScreenNow?.push(match.row.mint)
      }

      mountStrip(cell, article, match, facts.url)
    }

    /**
     * A CONTRACT ADDRESS IS THE MOST EXACT THING A TWEET CAN SAY.
     *
     * Memecoins are shared by address far more than by cashtag
     * ("CA: 7GCi…"), and a cashtag is a name anybody can take while an
     * address is the token. Until 2026-09-27 the chip never read one, so
     * a tweet made of a CA and nothing else had no chip. An address is
     * now asked about first, through the same by-mint gate the page card
     * uses; a wallet, a pool or a mint the gate declines comes back null
     * and the tweet takes the path it always had. A local match that IS
     * the address needs no question.
     */
    // Base58 runs in the store build, 0x addresses in the Arc edition.
    const addresses = contractAddressesIn(facts.text)
    if (addresses.length > 0 && !(match && addresses.includes(match.row.mint))) {
      resolveAddress(cell, article, facts, addresses, proceed)
      return
    }
    proceed()
  }

  /**
   * THE READER LANE: no rule placed this post, so the AI reader is asked
   * whether it is about an asset we trade, and why. Nothing is drawn while it
   * thinks, and the same recycled-cell checks as the other lanes run before
   * anything mounts: the cell may hold another post by the time it answers.
   */
  function askReader(cell: Element, article: Element, facts: TweetFacts): void {
    void deps
      .readText!(facts.id, facts.text)
      .then((hit) => {
        if (!hit) return
        if (!cell.isConnected || cell.getAttribute(ID_ATTR) !== facts.id) return
        if (stripOf(cell)) return
        if (deps.disabledMints.has(hit.row.mint)) return
        sweep.named.add(`${hit.row.ticker} by ai`)
        mountStrip(cell, article, { row: hit.row, tier: "ai", reason: hit.reason }, facts.url)
      })
      .catch(() => {
        // No answer is the answer: the post keeps no chip, as before the reader.
      })
  }

  /**
   * THE ADDRESS LANE. One by-mint question per ADDRESS per page, through the
   * enrich cache, so a CA pasted into fifty replies costs one call. A null is
   * an answer (a wallet, a pool, a mint the gate declines) and the tweet goes
   * on to the lanes it always had. The same recycled-cell checks as the
   * ticker lane run before anything mounts.
   */
  function resolveAddress(
    cell: Element,
    article: Element,
    facts: TweetFacts,
    addresses: string[],
    otherwise: () => void,
  ): void {
    void (async () => {
      let hit: { mint: string; symbol: string; name: string } | null = null
      for (const mint of addresses) {
        if (deps.disabledMints.has(mint)) continue
        const asset = await enrich(mint)
        if (asset) {
          hit = { mint, symbol: asset.symbol, name: asset.name }
          break
        }
      }
      if (!cell.isConnected || cell.getAttribute(ID_ATTR) !== facts.id) return
      if (stripOf(cell)) return
      if (!hit) {
        dbg(`no chip from the address in ${facts.id}: the gate describes none of ${addresses.length}`)
        otherwise()
        return
      }
      const ticker = hit.symbol || hit.mint.slice(0, 4)
      sweep.named.add(`${ticker} by address`)
      mountStrip(
        cell,
        article,
        { row: { mint: hit.mint, ticker, name: hit.name || ticker, displayName: hit.name || ticker }, tier: "address" },
        facts.url,
      )
    })()
  }

  /**
   * THE SLOW LANE for the author's own `$`. The offline lists answer most
   * cashtags in zero time; the ones they cannot — this week's launch, the
   * mid-tail nobody curated — go to the server, which resolves under the
   * ambiguity rule and the trade gate. One request per TICKER per page, not
   * per tweet: a hot cashtag scrolling by in fifty cells costs one call,
   * and a miss is cached as firmly as a hit.
   *
   * The FIRST cashtag is the one asked about — the same author's-emphasis
   * rule the offline matcher documents. By the time an answer arrives the
   * cell may be gone or re-tweeted; both are checked before mounting.
   */
  const tickerLane = new Map<string, Promise<string | null>>()
  function resolveFirstCashtag(
    cell: Element,
    article: Element,
    facts: TweetFacts,
    tag: string,
    fallback: XMatch | null,
  ): void {
    const mountFallback = () => {
      if (!fallback) return
      if (!cell.isConnected || cell.getAttribute(ID_ATTR) !== facts.id) return
      if (stripOf(cell)) return
      mountStrip(cell, article, fallback, facts.url)
    }

    const key = tag.replace(/^\$/, "").toUpperCase()
    /**
     * THE SLOW LANE SAYS WHY IT GAVE UP.
     *
     * A cashtag the bundle has never heard of has five ways to end without a
     * chip and, until this line, all five looked identical from the outside:
     * a tweet with no chip on it. $BULLSHIT has now cost three
     * investigations on that basis. Every server-side leg was measured clean
     * on 2026-09-11 — by-ticker resolves it with and without the sigil,
     * quote prices $1 of it through Meteora, the kill switch is
     * {"enabled":true,"disabledMints":[]}, and it is absent from the shipped
     * catalog, which is exactly what routes it here — so whatever remains is
     * one of the branches below, and a reader can now read WHICH.
     *
     * Through helpers/poppinDebug rather than console.debug: production
     * deletes every console.debug in the bundle, so the first version of
     * this line could not be read in the browser it was written for. Not an
     * error either — none of these is a fault. Four are ordinary answers and
     * the fifth is a recycled cell.
     */
    const gaveUp = (why: string, name?: string) => {
      dbg(`no chip for ${tag}: ${why}`)
      tally.dropped(why, name)
    }

    if (!deps.resolveTicker) {
      gaveUp("resolveTicker is not wired into this strip")
      mountFallback()
      return
    }
    if (!/^[A-Z0-9]{2,10}$/.test(key)) {
      gaveUp(`"${key}" is not 2-10 letters or digits, so the lane refuses it`)
      mountFallback()
      return
    }

    let lane = tickerLane.get(key)
    if (!lane) {
      /**
       * FAILURE IS NOT ABSENCE, in the cache above all places.
       *
       * This used to be `.catch(() => null)`: one cold-backend timeout on
       * the first $PANTS of the session became "no such token", cached as
       * firmly as a real answer, and every later $PANTS tweet stayed
       * chipless for as long as the page lived — on exactly the hot new
       * token this lane exists for. (Measured while chasing that report:
       * production resolves PANTS fine; the silence had to be client-side.)
       *
       * A NULL from the server still caches firmly — "no such token" is an
       * answer. A REJECTION drops out of the lane so the next tweet asks
       * again, the same failure/absence split the icon cache already
       * settled on.
       */
      const asked = deps.resolveTicker(tag)
      lane = asked.catch(() => null)
      tickerLane.set(key, lane)
      asked.catch(() => tickerLane.delete(key))
    }
    void lane.then((mint) => {
      // Still the same tweet, still unclaimed? Scrolling recycles cells and
      // an answer must never mount onto somebody else's article.
      if (!cell.isConnected) {
        gaveUp("the cell left the page before the answer came back")
        return
      }
      if (cell.getAttribute(ID_ATTR) !== facts.id) {
        gaveUp("X recycled the cell onto another tweet while we asked")
        return
      }
      if (stripOf(cell)) return
      if (!mint) {
        /* The one reason whose FIX is a name: this ticker is what the
           catalog would need to grow by, so it rides along. Every other
           reason is either about the page or already carries its own
           ticker in the reason text. */
        gaveUp("the server has no tradeable mint under that ticker", key)
        mountFallback()
        return
      }
      if (deps.disabledMints.has(mint)) {
        gaveUp(`${mint} is on the kill switch's disabled list`)
        mountFallback()
        return
      }
      mountStrip(
        cell,
        article,
        { row: { mint, ticker: key, name: key, displayName: key }, tier: "cashtag" },
        facts.url,
      )
    })
  }

  function mountStrip(
    cell: Element,
    article: Element,
    match: XMatch,
    tweetUrl: string,
  ): void {
    const { row, tier } = match
    const host = document.createElement("div")
    host.setAttribute("data-poppin-strip", row.mint)
    claimHost(host)
    // Asked of the anchor, before the chip joins the tree: the page's own
    // ground is the one thing the chip cannot read about itself.
    const lightPage = pageIsLight(article)
    /**
     * NO `title` ON THE RESTING ROW — and this is a bug fix, not tidying.
     *
     * A native tooltip is a BOX the browser opens after a dwell, hides the
     * instant the pointer moves, and opens again with different text over
     * the next element that has one. The tail of this row is four controls
     * (bell · wallet · Buy · Sell) inside about 150px, and a reader
     * choosing between Buy and Sell sweeps across all of them: box, gone,
     * box, gone, different box. Reported exactly that way — "the box keeps
     * closing and re-opening while I move the mouse around the buy/sell
     * area".
     *
     * The first repair removed `host.title = "Poppin"` and moved the name
     * onto the badge, which fixed almost nothing: a child's own title
     * always beat the host's anyway, so the four titles in the tail were
     * the whole symptom and all four survived. The second removed those
     * four — and then EXEMPTED `.mine` and `.who`, on the reasoning that a
     * pointer at that end of the row is reading rather than choosing
     * between keys. Both halves of that exemption were wrong.
     *
     *   POSITION. `.mine` and `.who` are the last children of `.face`,
     *   i.e. the elements immediately before `.more` and then `.end`.
     *   They sit ON the approach to Buy, not at the far end of anything.
     *
     *   THE TIMER, which is worse. `paintMine` rebuilt `.mine`'s children
     *   and reassigned its `title` unconditionally, and `paintMine` runs
     *   from `paintMarket` — the PRICE PAINT. So a reader who HOLDS the
     *   token and dwells on that pill got a box that closed and re-opened
     *   on the tick cadence with the pointer standing perfectly still. A
     *   tooltip needs a movement to flicker; that one needed nothing, and
     *   it was the strongest instance of the very mechanism the previous
     *   pass had diagnosed.
     *
     * So the rule is no longer "no title where the pointer travels", which
     * is a judgement about where a pointer goes and can be argued with. It
     * is: NOTHING ON THE RESTING ROW CARRIES A TITLE — `.row` and every
     * descendant, before and after any number of price ticks. Pinned in
     * chip-stays-put.spec.ts.
     *
     * The names the tail's controls need live on `aria-label`, read aloud
     * on request and drawing no box. The two facts that lived ONLY in a
     * box are not renamed: your exact units and average entry are the
     * first two lines of the position card the face opens — views/TokenView
     * renders "You hold <units> · <value>" and "Average entry <price>" for
     * exactly this holding — and the crowd is already drawn on the row as
     * faces and a count. The follower NAMES are the one thing this removal
     * costs, and a box that opens and shuts on the way to Buy is too much
     * to pay for them.
     *
     * Titles DO remain on the surfaces the reader SUMMONS — the fund
     * panel's address, the chart's view toggle and its trade marks, the
     * sheet's bell and its unverified-token warning, the open-orders hold
     * note. None of those exists until it is opened, and none is on the
     * sweep between the keys.
     *
     * The sheet, though, IS written by a timer, so it is one place
     * `.mine`'s trick — a box blinking at a motionless pointer — could
     * come back.
     * `sheetTick` calls `verdict`, and reading that function through, the
     * nodes it can write on a tick are the reading line, the balance, the
     * message and its row, the primary button's text and class, and each
     * size pick's `aria-pressed`. What keeps the box shut is that none of
     * them carries a title; the bell and the unverified warning do, and
     * the tick does not reach them. Pinned rather than promised —
     * chip-stays-put.spec.ts opens the sheet, ticks it, and fails if a
     * node the tick writes has a title, or if any title in the chip
     * changes across those ticks.
     */
    /**
     * ITS OWN STACKING CONTEXT, AND ITS OWN EVENTS.
     *
     * Reported from a status page: the chip drew and Buy/Sell would not
     * press. A shadow root is a DOM boundary, NOT a paint or hit-testing
     * one — the host is still an ordinary child of X's tree, so an
     * overlapping X layer (the detail page stacks more of them than the
     * timeline) can sit on top and eat every click while the chip looks
     * perfectly fine. `isolation` gives the chip a stacking context of its
     * own, and the explicit pointer-events refuses to inherit a `none` from
     * any wrapper X decides to put around it.
     */
    host.style.cssText =
      "position:relative;z-index:1;isolation:isolate;pointer-events:auto"

    // X binds single-key shortcuts on the document ("." loads posts, "l"
    // LIKES the tweet). A keystroke in our price field must not also be a
    // keystroke on X — see helpers/decimalInput for the incident.
    fenceKeys(host)
    // And the whole cell is one big link to the status page. Now that the
    // chip lives INSIDE the article, a press on Buy must not also be a
    // press on the tweet.
    fencePointers(host)
    // Same boundary, one layer quieter: a pointer sweeping across our keys
    // is not a pointer sweeping across X's cell, and X's cell is a React
    // subtree that re-renders on its own hover state — with our host as a
    // foreign child of it. Move events are the only ones that actually get
    // out (mouseover/mouseout between two of our own controls are stopped
    // by shadow retargeting; see the helper), and nothing of ours needs
    // them above the host.
    fencePointerMotion(host)
    const shadow = host.attachShadow({ mode: deps.shadowMode ?? "closed" })

    const ticker = displayTicker(row.ticker)

    /**
     * THE JEWEL CHIP. Two designs bracketed this one: a bordered Poppin card
     * ("intrusive") and a bare grey line ("belli belirsiz"). The reference
     * that survived both verdicts is X's OWN price chip — the small dark
     * pill it renders above cashtag tweets: native-shaped, but its green
     * price is pure market energy. This strip is that pill grown two quiet
     * controls:
     *
     *   · the PRICE wears the day's verdict color and PULSES on live ticks —
     *     the dopamine is the market moving, not our chrome
     *   · Buy is small but LIT: the one accent-filled thing on the row,
     *     with a soft glow. Sell stays ghost-grey until hovered — it earns
     *     color only when wanted
     *   · everything else is X's room: Chirp, X's greys, a pill that hugs
     *     its content instead of claiming the column
     *
     * Every state of the buy flow swaps inside the same 32px pill. Nothing
     * ever changes height under a scrolling thumb.
     */
    shadow.innerHTML = `
      <style>
        /*
         * HIDDEN MEANS HIDDEN, EVERYWHERE IN THIS ROOT.
         *
         * The hidden attribute gets its display:none from the browser's own
         * sheet, and an author rule as ordinary as .you-head { display:
         * flex } beats a UA rule at any specificity - so setting el.hidden
         * on anything this file gives a display to is a silent no-op. The
         * trap had already been paid for five times over as per-class
         * .x[hidden] { display: none } patches, and it was paid again the
         * moment two more elements learned to hide themselves. One
         * important rule ends the whole class of bug: nothing declared
         * below can outrank it, so the sixth patch never has to be written.
         */
        [hidden] { display: none !important; }
        /* The onboarding coach's card. Below the hidden rule on purpose:
           that rule must lead every declaration in this root, and the
           coach has display declarations of its own. */
        ${COACH_STYLE}
        /* ── THE FINISH ──────────────────────────────────────────────────
           The difference between "a fine extension" and "a firm with a
           design budget" is not more elements, it is fewer hues and more
           LIGHT. Three moves carry the whole upgrade:

           1. MATERIAL, NOT FILL. The pill gets a barely-there top light
              (gradient + inset highlight) and a soft drop — the Stripe/
              Apple recipe that makes a surface read as an object.
           2. ONE MEANING PER COLOR. The price sits white; the 24h chip
              alone wears the verdict; the accent exists only on Buy. On a
              live tick the price flashes the DIRECTION OF THAT PRINT —
              green uptick, red downtick, exchange-terminal style — then
              settles back to white. Color is an event, not a state.
           3. MOTION WITH INTENT. One spring entrance, a 150ms crossfade
              between flow states, and a 96% press scale. Nothing loops,
              nothing bounces twice. */
        /**
         * WHEN THE PAGE WILL NOT LEND A GROUND, THE KEYS BRING THEIR OWN.
         *
         * The chip paints no background and writes in near-white ink,
         * which is what makes it read as part of X or Reddit rather than
         * a box dropped on them. On a white article that same drawing is
         * a price nobody can read and buttons that look bleached —
         * measured on CNBC.
         *
         * CORRECTED. The first cure gave the ground to the CHIP. It fixed
         * the reading and it cost the structure: a filled capsule with a
         * hairline and a drop, wrapped around the price, Buy and Sell
         * together. Reported against the Reddit row side by side — there
         * every key is its own shape and nothing contains them, which is
         * the language this whole row is written in. A container says
         * "one control". This row has four.
         *
         * So the ground moves to where the unreadability actually was.
         * Not the chip: the WASHES. Every key here is a translucent wash
         * over whatever sits behind it, and on white there is nothing
         * behind it worth washing. Each key now carries its own floor,
         * and carries it as its wash ALREADY COMPOSITED over JUICE.ground
         * — so the pixels on CNBC are the pixels on Reddit, byte for
         * byte. Nothing is filled that was not filled before; the ground
         * travels with the key instead of being borrowed from a page that
         * has none. That equality is the rule and not a coincidence:
         * row-colour.spec recomputes all six values from the washes they
         * stand for, so changing a wash names the hex that stopped
         * matching.
         *
         * background-COLOR, not the shorthand, and not a style choice:
         * .buy.holding paints the hold-to-buy sweep with background-image,
         * and these selectors outrank it. The shorthand would reset that
         * image to none and the sweep would simply never appear on a news
         * page — a dead feature with nothing on screen to say so.
         *
         * :not(.open), because .chip.open grows a real JUICE.ground on
         * every surface and the tail keys give theirs up to it (see "One
         * surface at a time"). A floor under a key already standing on
         * that surface is the nested ring that rule exists to remove.
         *
         * :not(.live), because an unread bell takes the accent as a whole
         * button. These selectors carry four classes and .ring.live
         * carries two, so without the exclusion the light-page floor wins
         * and the one state the bell exists to show goes quiet.
         */
        .chip.on-light:not(.open) .lead,
        .chip.on-light:not(.open) .ring:not(.live),
        .chip.on-light:not(.open) .wal { background-color: #141E2D; }
        .chip.on-light:not(.open) .ring:not(.live):hover,
        .chip.on-light:not(.open) .wal:hover { background-color: #1D2B3F; }
        .chip.on-light:not(.open) .buy { background-color: #14282A; }
        .chip.on-light:not(.open) .buy:hover { background-color: #18342F; }
        .chip.on-light:not(.open) .sell { background-color: #211C26; }
        .chip.on-light:not(.open) .sell:hover { background-color: #30222B; }
        /**
         * AND THE SIGNATURE, WHICH IS INK AND NOT A KEY.
         *
         * Reported on CNBC: hovering opened a wide gap between Sell and the
         * bell with nothing drawn in it. That gap was this wordmark. It is
         * the one thing in the tail that is pure text, so when the ground
         * moved off the chip and onto the keys it was the only child left
         * without a floor, writing rgba(255,255,255,.52) onto white.
         *
         * It does not get a floor of its own. A signature in a pill is a
         * badge, and this is meant to be the quietest thing on the row. It
         * gets the same PRESENCE instead: on Reddit it composites to
         * #8B8D8E for 5.68:1 against that page, and rgba(0,0,0,.6) on white
         * is 5.74:1. The same voice at the same volume, on the other side
         * of the paper.
         */
        .chip.on-light:not(.open) .pmark { color: rgba(0,0,0,.6); }
        /**
         * AND IT TAKES ONLY THE WIDTH ITS KEYS OCCUPY.
         *
         * On a feed the chip spans the post's whole text column, which is
         * right there: it makes the row a deliberate part of the post
         * rather than buttons orphaned mid-column. An article has no text
         * column to belong to, the headline above IS the cell, so the chip
         * stops where its last key does and leaves the rest of the line to
         * the page.
         *
         * The row's own padding is deliberately NOT overridden here any
         * more. It existed to keep the keys off the inside edge of the
         * capsule this pass removed. With no capsule there is no edge, and
         * 12px of it would only push the keys off the headline's left
         * margin they now line up with. The open state's arithmetic
         * (.chip.open .row and .chip.open .face, which pay each other
         * back) is the feed's and needs no light-page copy either.
         */
        .chip.on-light { align-self: flex-start; width: fit-content; max-width: 100%; }
        /**
         * AND OPENING IT MUST NOT MAKE IT SMALLER.
         *
         * Reported: pressing Buy on an article narrows the chip. Measured
         * in a 1100px column: 333px at rest, 370px with the tail revealed,
         * 356px once the sheet is open. So the object shrank by 14px under
         * the finger that pressed it, which is the opposite of what opening
         * is supposed to mean.
         *
         * The cause is the hug above applying in both states. At rest the
         * content is a row of keys; opened, those keys are replaced by the
         * sheet, and the sheet is narrower. fit-content faithfully followed
         * the content down.
         *
         * A floor alone would not be enough. The sheet's own max-content is
         * 356px, so 356 is not a comfortable width it happens to have, it
         * is the narrowest it can be — every child in there stretches, and
         * what sets that number is the two segmented controls. Rendered at
         * 480 and 520 the presets and the confirm stop being cramped.
         *
         * 520, then, with two jobs: comfortably above the 370px the row
         * reaches at its widest, so pressing always grows; and capped, so
         * the one state that DOES paint a ground never becomes a dark band
         * drawn across an article. min() keeps it honest in a column
         * narrower than the cap.
         *
         * A feed needs none of this. There the chip already spans the
         * post's text column at rest, so opening changes its height and
         * nothing else.
         */
        .chip.on-light.open { width: min(100%, 520px); }

        .chip {
          /* FULL WIDTH OF THE TWEET'S TEXT COLUMN, not content-hugging.
             As an inline pill it stopped wherever its last button happened
             to land, which on a wide window left a gap to the right and read
             as CUT OFF rather than compact — the buttons looked orphaned
             mid-row. Spanning the same column the tweet's own text spans
             makes it a deliberate part of the post: market facts anchored
             left, the two decisions anchored right, aligned with everything
             X puts in that column. Margins already matched the tweet's text
             inset (68px avatar rail, 16px right edge); only the box was
             wrong. */
          display: flex; flex-direction: column; align-items: stretch;
          /* 38, and the row below says 38 too. They said 32 and 36 for a
             while, which is not a design decision but a disagreement: the
             chip won, the row was squeezed to 30, and every pill inside it
             lost the padding it was written to have. Measured — the
             ticker's text box is 16px and it was sitting in a 28px pill,
             a ratio of 1.75 against roughly 2.5 on the surfaces this gets
             compared to. */
          /* HEIGHT IS NO LONGER A NUMBER. 38px was picked when this row
             was a caption under a tweet; the brief is now that the feed
             should be FUN to sit in, and a 38px strip of 12px type is a
             status bar. The row is sized by what is in it: a 30px asset
             disc, a 19px price, and two keys big enough to want to press.
             The 32-vs-36 note above is kept for its lesson (a number
             nobody owns gets argued over forever); the number it settled
             is gone. */
          /* X'S SCALE, NOT OURS. 46px of controls hanging under a 15px
             tweet is why the field read this as bolted on: the row was
             correct in isolation and a foot taller than everything it sat
             beside. X's own inline buttons land around 32-34px, its body
             is 15px, its action icons are 18px. Those are the numbers this
             row has to speak. */
          min-height: 36px; width: auto;
          /* NO horizontal margins in the stylesheet. The chip now mounts
             inside the tweet's own text column (after the action row), which
             already starts and ends exactly where the chip should — a baked
             64px here was the avatar rail paid a second time, and it kept
             winning silently whenever the measured inset was 0 and set no
             inline override. The article-level fallback is the only layout
             that still needs horizontal margins, and mountStrip sets those
             inline, from measurement. */
          margin: 4px 0 10px 0;
          padding: 0;
          /* NOTHING AT REST. The row is five separate controls lying on
             X's own ground, the way X's own reply/repost/like controls
             lie on it — not a bar pasted across the column. A container
             around them said "this is one widget"; five buttons say
             "these are five things you can press", which is what they
             are.

             The shell is not deleted, it is EARNED: press anything and it
             comes back, because the sheet and the chart need a surface to
             open onto. Transparent border rather than none, so the box
             model does not shift by 2px on the way in. */
          background: none;
          /* PREMIUM IS A THINNER LINE, NOT A BRIGHTER ONE. The stroke was
             loud enough to be the first thing the eye read, which made the
             object look drawn rather than made. Almost invisible now — the
             top highlight already does the separating, and a border's only
             remaining job is to stop the ground bleeding into the feed. */
          border: 1px solid transparent;
          /* AN OBJECT ON THE PAGE, NOT A TINT OF IT. On X's near-black a
             drop shadow does almost nothing — there is nothing darker to
             cast onto. What separates a raised surface from its background
             at this contrast is the TOP EDGE catching light and the bottom
             edge losing it, so the highlight carries the weight and the
             shadow only seats it. The old inset was .05 white: technically
             present, visually absent, which is why the chip read as a
             darker patch of feed rather than a thing lying on it. */
          /* AN EDGE IS A PROMISE THAT SOMETHING CAN BE PRESSED — rule 8,
             and the reason three rounds of lowering opacity did not land.
             The eye was not counting saturation, it was counting closed
             shapes: eight grounds and eleven strokes inside a 36px band.
             Alpha moves none of them.

             The hairline stays, because it is what tells a Poppin pixel
             from an X pixel and because it is doing a second job nobody
             wrote down: JUICE.ground (#0E1420) is about HALF the
             luminance of X's Dim theme (#15202B), so without it the chip
             reads as a hole punched in the feed with its top light on the
             wrong edge. What goes is the 28px cyan halo, which was the
             single widest painted thing on the row, and the dark crescent
             under the hairline, which at radius 999px is a second stroke
             tracing the first. */
          box-shadow: none;
          border-radius: 999px;
          /* Opening, the radius rides the height: one movement, one timing.
             CLOSING, the body is removed in a single frame while this kept
             easing for another 240ms — so the corners visibly rounded off
             around a box that was already gone. A movement whose subject
             has left is not a movement, it is a leftover. The closing
             class drops the duration to zero for exactly that frame. */
          transition: border-radius ${JUICE.motionMs / 1000}s ${JUICE.motionEase};
          font-family: "TwitterChirp", -apple-system, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          color: ${JUICE.text};
          animation: stripIn .32s ${JUICE.releaseEase};
          box-sizing: border-box;
        }
        /* The header row and the chip agree on one height now. They used to
           disagree, which is how the row ended up shorter than either of
           them claimed. */
        /* SPACING IS THE ONLY GROUPING A SINGLE ROW HAS. One gap of 8px
           between every element made six things read as six things: the
           asset, its price, its change, the chevron, the reader's wallet
           and the two actions all equally far apart, so the eye could not
           tell which belonged with which. The row breathes in three groups
           now — what this asset IS, the door to its history, and what YOU
           can do — and the wider gaps are the seams. */
        /* TALLER, AND THE EXTRA HEIGHT ALL GOES TO THE PRIMARY. The bar
           was 32px because that is what fits; 36 is what a thumb wants, and
           the four pixels buy a Buy button somebody can hit without aiming.
           The shell reads calmer at this height too — the same elements
           with more air around them is most of what "premium" means on one
           row. */
        /* SPACING IS THE GROUPING, AND IT ONLY WORKS AS A LADDER. One
           11px gap between every element made six things read as six
           things, equally far apart, so the eye could not tell which
           belonged with which. Three clearly separated steps instead —
           6 inside a group, 4 for a control that acts on the thing beside
           it, 18 for the seam between "what this asset IS" and "what YOU
           can do". Each step is far enough from the last to be read as a
           different kind of distance rather than a rounding error. */
        .row {
          display: flex; align-items: center; gap: 0;
          height: 38px; padding: 0; box-sizing: border-box;
        }
        /* The chevron belongs to the price, not to the wallet: it opens
           that asset's own history, so it sits close to what it acts on. */
        /* Its hover lives with the rest of the capsule's states further
           down; this used to declare a second, dimmer background here that
           the later rule overrode and nobody ever saw. */

        /* ── THE ORDER SHEET ─────────────────────────────────────────────
           A standing order was being composed inside a 32px pill: a preset
           row, an "@", a 76px number field and a Place button, all on one
           line. Every part was present and none of it was legible, the
           price field was the width of four digits, and the balance — the
           one number that decides whether an order can even be placed —
           was nowhere on screen.

           A limit order is not a smaller buy, it is a different decision:
           the reader is picking a PRICE, which is a number they have to
           read, compare against the current one, and change their mind
           about. That needs room, so the chip opens into it rather than
           compressing it. The pill stays the header, the sheet unfolds
           beneath, and the whole thing is one object the entire time. */
        /* THE SURFACE, once something is open on it. Same object the row
           used to wear all day, now only worn when it is holding
           something. The Dim-theme note still applies and is the reason
           the hairline comes back with the ground rather than after it:
           JUICE.ground is about half the luminance of X's Dim, so a
           ground without an edge reads as a hole. */
        /* 20, AND IT IS DERIVED RATHER THAN CHOSEN. The frame is drawn on
           the BORDER box and the content lives in the PADDING box, so the
           corner the eye actually compares a button against is 20 - 1 (the
           hairline .chip declares) = 19px. The header row is 38px and its
           children are centre-aligned, so a key of any height H is inset
           (38-H)/2 from the top and its own corner is H/2 — and
           (38-H)/2 + H/2 = 19 for EVERY H. 19 is therefore the only
           padding-box radius at which the tail keys can ever be concentric
           with the frame, and 20 is the only border-box radius that gives
           it. At the old 18 no inset value could have made them concentric;
           the reported "corners bleeding into the frame" was the visible
           half of that. */
        .chip.open {
          height: auto; border-radius: 20px;
          background: ${JUICE_SHEEN}, ${JUICE.ground};
          border-color: rgba(122,183,255,.09);
          /* The landing's surface depth: a real drop into the page plus a
             faint brand glow seating it. The resting row stays bare — this
             is the OPENED surface, the reader summoned it, and a summoned
             surface floating off the timeline is the landing's own move. */
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.13),
            0 2px 10px -4px rgba(0,0,0,.7),
            0 18px 44px -14px rgba(0,0,0,.6),
            0 4px 30px -8px rgba(104,198,255,.22);
        }
        /* One surface at a time: inside the open shell the asides go back
           to being ink, or the nested rings this pass removed come
           straight back. Buy and Sell keep theirs — they move money in
           every state. */
        .chip.open .lead,
        .chip.open .face,
        .chip.open .more,
        .chip.open .wal {
          background: none; box-shadow: none;
        }
        /* THE FRAME NEEDS AN INSET; THE RESTING ROW MUST NOT HAVE ONE.
           Reported: expanded, the Buy and Sell keys touch the chip's outer
           border. They did — .chip, .row and .end between them declared no
           right-hand padding at all, so the last key's border box sat
           exactly on the frame's padding box. At rest that is invisible,
           because .chip paints no ground and no border there; opening
           grows a real ground, a real hairline and a real radius around
           content that was never inset for any of them. And the rule right
           above is why it is these two keys and nothing else: everything
           in the tail gives up its ground when the chip opens, so Buy and
           Sell are the only closed shapes left to collide with the corner.

           OPEN-STATE ONLY, deliberately. .row has run at padding 0 since
           the chip stopped having a shell: the resting row is aligned edge
           to edge with the tweet's own text column (see mountStrip's
           placement pass, which MEASURES that alignment), and padding here
           would push it off that line for the 99% of its life when there
           is no frame to be inset from. Only the open state has a frame.

           4px, which is not a taste either: the keys are locked to 30px
           (see .buy/.sell below) inside a 38px row, so the row's own
           centring already inset them 4px top and bottom. 4px each side is
           what makes that inset the same on all three exposed edges. */
        .chip.open .row { padding: 0 4px; }
        /* AND THE LEFT CLUSTER DOES NOT MOVE WHEN THE CHIP OPENS. Without
           this the row's new 4px would slide the badge, ticker and price
           4px right the instant a chart or a sheet appeared — a snap, on
           the one element on this row whose left edge is supposed to be
           welded to the tweet's text column. The 4px comes back out of
           .face's own 6px, which is free: that padding exists to seat the
           badge inside .lead's capsule, and the rule directly above
           removes that capsule's ground in exactly this state. 4 + 2 = the
           same 6px from the frame the badge sits at when resting, so
           .callr below keeps the offset it has always had too. */
        .chip.open .face { padding-left: 2px; }
        /* PAID FOR, NOT SPENT. The seam between "what this asset IS" and
           "what YOU can do" is 10px, and the long comment on .end says in
           so many words that these numbers were MEASURED against a ~500px
           tweet column after a field report clipped a ticker to "BU…", and
           that changing them means re-measuring. So this inset does not
           get to cost the row anything: the 8px .chip.open .row takes is
           given back as the 4px .face no longer needs plus the 4px trimmed
           off this seam, and the open row wants exactly as many pixels as
           the resting one. The seam only narrows while a chart or a sheet
           is open — the state where the reader is looking at that surface
           rather than scanning the row. */
        /* The seam used to give 4px back when the chip opened, which paid
           half the open frame's inset. That payment made sense while .end
           was right-aligned and its padding was the gap in front of a tail
           pinned to the far edge. The cluster follows the price now, so
           the only thing that payment buys is Buy and Sell sliding 4px
           left the moment a reader opens the chart — movement on the two
           controls that must never move. The face still pays its half; the
           chip is 4px wider open than closed, and 4px on the right of a
           left-anchored chip is nothing the old geometry was worried
           about. */
        .chip.open .end { padding-left: 10px; }
        .chip.closing { transition-duration: 0s; }
        .sheet {
          display: flex; flex-direction: column; gap: 11px;
          padding: 6px 14px 14px;
          animation: sheetIn ${JUICE.motionMs / 1000}s ${JUICE.motionEase};
        }
        /* A REPLACEMENT IS NOT AN ARRIVAL. Flipping Buy↔Sell or
           Now↔When-it-hits rebuilds this element, which replays the
           entrance above and fades a surface the reader is already looking
           at. The height already knows better (showSheet measures the old
           sheet and grows the new one FROM it); this is the same rule
           applied to the other channel. Applied by showSheet, and only
           when there was a previous sheet to replace. */
        .sheet.settled { animation: none; }
        /* Opacity only: the HEIGHT is the movement. A translateY here was
           a second animation describing the same motion at a different
           rate, and the two disagreed every frame. */
        @keyframes sheetIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        /* ── THE TWO AXES ────────────────────────────────────────────────
           Market and Limit used to sit at different depths of the same
           menu, which asked the reader to remember where each one lived.
           They are siblings, so they are drawn as siblings, and so are Buy
           and Sell. Both controls are one row: the sheet answers "what
           happens when I press the button" in the same place every time. */
        .head { display: flex; align-items: center; gap: 10px; }
        .tabs { display: flex; flex: 1; min-width: 0; }
        /* The pricing switch rides ABOVE the direction, not beside it: one
           tap, always legible, never competing with the control that has a
           colour and moves the money. */
        .kind { display: flex; gap: 2px; flex-shrink: 0; }
        /* Same reasoning as .segb: "When it hits" is a mode a reader can
           take, not one the sheet has taken away. */
        .kindb {
          padding: 5px 9px; border-radius: 7px;
          font-size: 11.5px; font-weight: 700; color: ${JUICE.text2};
          background: rgba(255,255,255,.045);
          letter-spacing: .02em;
        }
        .kindb:hover { color: ${JUICE.text2}; background: rgba(255,255,255,.05); }
        .kindb[aria-pressed="true"] {
          color: #9FD9FF; background: rgba(104,198,255,.12);
          box-shadow: inset 0 0 0 1px rgba(104,198,255,.28);
        }
        .seg {
          display: flex; flex: 1; gap: 2px; padding: 2px;
          background: ${JUICE.well}; border-radius: 10px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
        }
        /**
         * AN UNCHOSEN OPTION IS NOT A DISABLED ONE.
         *
         * Both of these sat as the dimmest ink in the palette on no ground
         * at all, beside a sibling wearing a full gradient. Reported from
         * the field as "Sell looks switched off" — which is the correct
         * reading of that drawing, and the wrong thing to tell a reader
         * about a direction they can absolutely take.
         *
         * A ground rather than a hairline: the group already has a hairline
         * of its own, and a second one inside it draws a table. This lifts
         * the ink one step and gives the option something to sit on, which
         * is the least a surface can do to say "you may press this". The
         * chosen one keeps the fill, so the distinction is undamaged.
         */
        .segb {
          flex: 1; padding: 6px 0; border-radius: 8px;
          font-size: 12.5px; font-weight: 700; color: ${JUICE.text2};
          background: rgba(255,255,255,.045);
        }
        .segb:hover { color: ${JUICE.text}; background: rgba(255,255,255,.08); }
        /* THE ACTIVE DIRECTION IS FILLED, in its own color — the same
           gradient the confirm button wears, so the sheet reads as one
           statement from the tab to the money button. A grey "active"
           answered which tab was pressed but not what the sheet was FOR. */
        /* GREEN IN, RED OUT — the same pair as the row this sheet opened
           from. The buy side was the brand accent here while the chip above
           it drew Buy in green, so the two halves of one gesture disagreed
           about what colour a buy is. Sell was already red, which is how
           the mismatch stayed invisible: only one of the two was wrong. */
        .segb[aria-pressed="true"] {
          background: ${JUICE_BUY_FILL}; color: ${JUICE.onBuyFill};
          box-shadow: inset 0 1px 0 rgba(255,255,255,.35),
                      0 1px 10px -2px ${JUICE.buyGlow};
        }
        .seg .segb[aria-pressed="true"].sell-on {
          background: ${JUICE_SELL_FILL}; color: ${JUICE.onSellFill};
          box-shadow: inset 0 1px 0 rgba(255,255,255,.28),
                      0 1px 6px -2px ${JUICE.sellGlow};
        }
        /* Borrowed wholesale from the sheet: same padding, same preset row,
           same close button. A funding panel that invented its own layout
           would be a third grammar on a surface that already has two. */
        .fund { gap: 10px; }
        .fund-title {
          font-size: 19px; font-weight: 800; letter-spacing: -.02em;
          color: ${JUICE.text}; line-height: 1.1;
        }
        .fund-note {
          font-size: 12.5px; font-weight: 500; color: ${JUICE.text2};
        }
        /* The amounts ARE the screen's subject, so they are the biggest
           pressable thing on it. */
        .fund .pick { padding: 13px 0; font-size: 16px; }
        /* THE SCOREBOARD. Bigger than anything else on this surface, and
           that is the point: the row it opens from spent three rounds
           getting quieter so that a screen somebody deliberately opened
           could afford to be loud. */
        .you { gap: 10px; }
        .back {
          align-self: flex-start; padding: 2px 0;
          font-size: 12.5px; font-weight: 700; color: ${JUICE.text3};
        }
        .back:hover { color: ${JUICE.text}; }
        .you-head { display: flex; flex-direction: column; gap: 1px;
                    align-items: flex-start; }
        /* THE NAME ROW, above the number. A pill rather than a bare line:
           it is the only thing in this header a reader can press, and a
           pressable thing on a surface of figures has to look different
           from the figures. Sized to its content so it never reads as a
           banner across the top of somebody's own money. */
        .you-who {
          display: flex; align-items: center; gap: 8px;
          margin: 0 0 9px; padding: 5px 11px 5px 5px;
          border: 0; border-radius: 999px; cursor: pointer;
          font-family: inherit;
          background: ${JUICE.well};
          box-shadow: inset 0 0 0 1px rgba(122,183,255,.14);
          transition: background-color .15s ease, box-shadow .15s ease;
        }
        .you-who:hover { background: rgba(122,183,255,.11);
                         box-shadow: inset 0 0 0 1px rgba(104,198,255,.38); }
        .you-who[hidden] { display: none; }
        /* No avatar when there is no photo: the row still names you and
           still opens, and a blank disc would be the only empty shape on
           the surface. */
        .you-who-av { width: 24px; height: 24px; border-radius: 50%;
                      overflow: hidden; flex-shrink: 0; display: block; }
        .you-who-av img { width: 100%; height: 100%; display: block;
                          border-radius: 50%; object-fit: cover; }
        /* The handle is a name, so it wears the product's face, not the
           terminal's. The figure below it is data and keeps the mono. */
        .you-who-name { font-size: 12.5px; font-weight: 700; color: ${JUICE.text};
                        max-width: 148px; overflow: hidden;
                        text-overflow: ellipsis; white-space: nowrap; }
        .you-who-go { font-size: 12.5px; font-weight: 700; color: ${JUICE.accentInk};
                      flex-shrink: 0; }
        .you-pnl {
          font-family: ${JUICE.mono}; letter-spacing: -.02em;
          font-size: 30px; font-weight: 700; line-height: 1.05;
          font-variant-numeric: tabular-nums; color: ${JUICE.text};
        }
        .you-pnl.up { color: ${GREEN}; }
        .you-pnl.down { color: ${RED}; }
        /* Sentence case, no tracking. AN UPPERCASE LETTER-SPACED LABEL is
           the caption grammar of a terminal; the same words in the product's
           own voice read as a person talking. */
        .you-cap {
          font-size: 11.5px; font-weight: 600; color: ${JUICE.text3};
        }
        /* Its own line under the cash, in the product's face rather than
           the terminal's: a rank is a place, not a measurement. */
        .you-rank {
          font-size: 12px; font-weight: 800; color: ${JUICE.accentInk};
          margin-top: 3px;
        }
        .you-rank[hidden] { display: none; }
        .you-cash[hidden] { display: none; }
        .you-cash {
          font-family: ${JUICE.mono}; letter-spacing: -.01em;
          font-variant-numeric: tabular-nums;
          font-size: 12.5px; font-weight: 600; color: ${JUICE.text2};
          margin-top: 4px;
        }
        .you-dir-above { color: ${GREEN}; }
        .you-dir-below { color: ${RED}; }
        /* ONE LIT THING PER GROUP. Three filled wells side by side made the
           tab strip read as a toolbar — the same grammar the chart's range
           row was carrying. Rest is ink, hover is a whisper of ground, and
           the tab you are ON is the single lit pill. */
        .tabs { display: flex; gap: 6px; }
        .tab {
          padding: 5px 12px; border-radius: 999px; font-size: 12px;
          font-weight: 600; color: ${JUICE.text3}; background: none;
        }
        .tab:hover { color: ${JUICE.text2}; background: rgba(255,255,255,.06); }
        .tab[aria-pressed="true"] {
          color: ${JUICE.onAccent}; background: ${JUICE_GRADIENT};
          box-shadow: inset 0 1px 0 rgba(255,255,255,.3),
                      0 4px 14px -4px rgba(104,198,255,.5);
        }
        /* NOT A TABLE. Ruled rows are a blotter's grammar — the hairlines
           were doing the work a little breathing room does better. Rows are
           quiet cards now: they separate by space, and they answer the
           pointer, because most of them ARE pressable. */
        /* THE LIST SCROLLS ON ITS OWN. It used to grow the whole panel, so
           a reader with real news got a chip taller than the viewport and
           no way to reach the foot. A bounded box with its own scroll keeps
           Deposit and Feed reachable however much has happened. */
        .you-list {
          display: flex; flex-direction: column; gap: 4px;
          max-height: 300px; overflow-y: auto; overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,.18) transparent;
        }
        .you-list::-webkit-scrollbar { width: 6px; }
        .you-list::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,.18); border-radius: 999px;
        }
        .you-list::-webkit-scrollbar-track { background: transparent; }
        .you-row {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: 12px;
          background: rgba(255,255,255,.028);
          transition: background-color .15s ease;
        }
        .you-row:hover { background: rgba(255,255,255,.055); }
        /* THE REWARD DRESS. "Your order filled" is the best news this
           surface delivers and it rendered pixel-identical to a plain
           holdings row. Honest colors only: green = your money moved,
           accent = market news. Glyphs, tints, no motion - arrival's
           one-shot is the cascade's job. */
        .you-filled {
          background: rgba(48,209,88,.07);
          box-shadow: inset 2px 0 0 ${GREEN};
        }
        .you-dist {
          font: 700 10.5px/1 ${JUICE.mono}; color: ${JUICE.text3};
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .you-fired {
          background: rgba(104,198,255,.06);
          box-shadow: inset 2px 0 0 rgba(104,198,255,.55);
        }
        /* A row that goes somewhere says so with the cursor; the ones that
           do not (a standing alert whose action is Remove) stay arrows, so
           the hand never promises a door that is not there. */
        .you-row.door { cursor: pointer; }
        .you-flex {
          font-size: 11px; font-weight: 700; color: ${JUICE.text3};
          padding: 3px 7px; border-radius: 8px; flex: 0 0 auto;
          background: rgba(255,255,255,.05);
        }
        .you-flex:hover { color: ${JUICE.text}; background: rgba(255,255,255,.1); }
        /* The book's own face, same recipe as the chip's .badge so a coin
           looks like itself on every surface. */
        .you-ico {
          position: relative; width: 22px; height: 22px; border-radius: 50%;
          flex-shrink: 0; display: grid; place-items: center; overflow: hidden;
          background: rgba(104,198,255,.14); color: #9FD9FF;
          font-size: 9.5px; font-weight: 700;
        }
        .you-ico img {
          position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; opacity: 0; transition: opacity .25s ease-out;
        }
        .you-ico-init { transition: opacity .25s ease-out; }
        .you-tick {
          font-size: 12.5px; font-weight: 700; color: ${JUICE.text};
          min-width: 0; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; flex: 1;
        }
        .you-qty, .you-val, .you-pl {
          font-family: ${JUICE.mono}; letter-spacing: -.01em;
          font-variant-numeric: tabular-nums; flex-shrink: 0;
        }
        .you-qty { font-size: 12px; color: ${JUICE.text3}; }
        .you-val { font-size: 12.5px; font-weight: 700; color: ${JUICE.text}; }
        .you-pl { font-size: 11.5px; font-weight: 700; min-width: 52px;
                  text-align: right; }
        .you-pl.up { color: ${GREEN}; }
        .you-pl.down { color: ${RED}; }
        .you-side { font-size: 11px; font-weight: 700; flex-shrink: 0; }
        .you-side-buy { color: ${JUICE.buyInk}; }
        .you-side-sell { color: ${JUICE.sellInk}; }
        .you-x {
          font-size: 11px; font-weight: 700; color: ${JUICE.text3};
          padding: 3px 8px; flex-shrink: 0;
        }
        .you-x:hover { color: ${RED}; }
        .you-empty {
          font-size: 12px; color: ${JUICE.text3}; padding: 10px 2px;
        }
        /* WHOEVER DID IT, with the kind on their shoulder. */
        .you-actor {
          position: relative; width: 22px; height: 22px; flex-shrink: 0;
          align-self: flex-start;
        }
        .you-actor img {
          width: 100%; height: 100%; border-radius: 50%; object-fit: cover;
          display: block; background: rgba(255,255,255,.06);
        }
        .you-actor-badge {
          position: absolute; right: -3px; bottom: -3px;
          width: 13px; height: 13px; border-radius: 50%;
          display: grid; place-items: center;
          background: ${JUICE.ground};
          box-shadow: 0 0 0 1.5px ${JUICE.ground};
          color: ${JUICE.accentInk};
        }
        .you-actor-badge svg { width: 9px; height: 9px; display: block; }
        /* A notification is a sentence: it wraps, it is prose, and it takes
           the room the row has rather than being clipped to a ticker's
           width. */
        .you-note-text {
          flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.35;
          color: ${JUICE.text}; overflow-wrap: anywhere;
        }
        /* "2m", "3h" — words about time, so the product's own face rather
           than the terminal voice the numbers beside them wear. */
        .you-when {
          font-size: 11px; color: ${JUICE.text3}; flex-shrink: 0;
          align-self: flex-start; padding-top: 1px;
        }
        /* The unread count, riding the pill's corner. Accent blue, NOT
           red: red means loss on this row, and "you have news" is not a
           loss. Absolute against the pill so it costs the ladder no
           width. */
        /* THE DOORS ARE INK, THE KEYS ARE KEYS. The tail used to seat four
           equally-weighted capsules in a straight line — bell, wallet, Buy,
           Sell — so the eye counted a toolbar and the row had no primary at
           all. The two doors (your news, your money) drop their ground and
           their hairline: they rest as marks, answer the pointer with a
           whisper of ground, and leave the only closed shapes on the row to
           the two controls that actually move money. */
        /* A BUTTON YOU CAN SEE BEFORE YOU HOVER IT. This was a 15px grey
           glyph on no ground: the notification surface was invisible until
           the pointer found it, so the swing it already performed on
           arrival was a gesture nobody was looking at. It now has a ground
           at rest and LIGHTS UP when there is something to read. */
        .ring {
          position: relative;
          display: grid; place-items: center;
          width: 30px; height: 30px; padding: 0; flex-shrink: 0;
          border-radius: 50%; color: ${JUICE.text2};
          background: rgba(122,183,255,.06);
          box-shadow: inset 0 0 0 1px rgba(122,183,255,.14);
          transition: color .15s ease, background-color .15s ease,
                      box-shadow .15s ease;
        }
        .ring svg { width: 15px; height: 15px; display: block; }
        .ring:hover { color: ${JUICE.text}; background: rgba(122,183,255,.14); }
        /* Unread is not a colour change on a grey glyph. The whole button
           takes the accent, so the eye finds it on a page it is not
           looking at. */
        .ring.live {
          color: ${JUICE.onAccent};
          background: ${JUICE.accent};
          box-shadow: inset 0 0 0 1px rgba(104,198,255,.5),
                      0 0 16px -4px rgba(104,198,255,.8);
        }
        .ring.live:hover { color: ${JUICE.onAccent}; background: ${JUICE.accentHi}; }
        .chip.open .ring { background: none; box-shadow: none; }
        .wal-dot {
          position: absolute; top: -5px; right: -4px;
          min-width: 15px; height: 15px; padding: 0 3px;
          display: grid; place-items: center;
          border-radius: 999px;
          background: ${JUICE.accent}; color: ${JUICE.onAccent};
          font-size: 9.5px; font-weight: 800; line-height: 1;
          box-shadow: 0 0 0 2px #000;
        }
        .wal-dot[hidden] { display: none; }
        .you-set-go {
          font-size: 12px; font-weight: 700; color: ${JUICE.accentInk};
          padding: 5px 12px; border-radius: 999px;
          background: rgba(104,198,255,.12);
          box-shadow: inset 0 0 0 1px rgba(104,198,255,.25);
        }
        .act-ico {
          width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
          display: grid; place-items: center;
        }
        .act-ico svg { width: 12px; height: 12px; display: block; }
        .act-accent { color: ${JUICE.accentInk}; background: rgba(104,198,255,.12); }
        .act-up { color: ${GREEN}; background: rgba(48,209,88,.12); }
        .act-down { color: ${RED}; background: rgba(255,69,58,.12); }
        .you-note-text {
          font-weight: 600; color: ${JUICE.text}; font-size: 12.5px;
        }
        .you-foot { display: flex; align-items: stretch; }
        /**
         * THE ONE ACTION A WALLET NEEDS, DRESSED AS IT.
         *
         * The owner's ask, quoted where this button is built, is that
         * depositing be unmissable. It was a .pick — the same faint wash
         * and grey ink as the Feed button beside it — so the primary
         * action and "somewhere to go next" were the same object at
         * different widths. The neighbour's own comment gives it away:
         * it calls itself "no fill" in contrast to a fill this button
         * never had.
         *
         * Brand, not green: juice.spec.ts states the exclusion outright —
         * funding sits in the confirm's slot and is NOT a trade, so a
         * button that moves money into a wallet must not wear the colour
         * that means a trade went through. Same edge and travel as every
         * other key in the product.
         */
        /**
         * .pick.you-add, NOT .you-add — the third time this file has been
         * bitten by the same thing today.
         *
         * The button carries both classes, and .pick is declared LATER
         * with a ground of its own. Equal specificity, so the later rule
         * won and the money door rendered as a quiet outline among the
         * quiet outlines, on the one screen where a short balance needs it
         * to be unmissable. Specificity rather than reordering, because a
         * rule that only works while it sits below another one is a trap
         * set for whoever tidies this file next.
         */
        .pick.you-add {
          flex: 1; padding: 11px 0;
          background: ${JUICE_GRADIENT}; color: ${JUICE.onAccent};
          font-size: 14px; font-weight: 800;
          box-shadow: 0 2px 0 #2E86C9, 0 4px 12px -7px rgba(104,198,255,.45);
          transform: translateY(0);
          transition: transform .1s ease-out, box-shadow .1s ease-out,
                      filter .15s ease-out;
        }
        .pick.you-add:hover { filter: brightness(1.07); background: ${JUICE_GRADIENT}; }
        .pick.you-add:active {
          transform: translateY(2px);
          box-shadow: 0 0 0 #2E86C9, 0 2px 8px -8px rgba(104,198,255,.4);
        }
        /* The quieter neighbour, and now it actually is one: same height,
           no fill. Depositing is the action a wallet needs; the feed is
           somewhere to go next. */
        .you-feed { flex: none; padding: 11px 14px; margin-left: 6px; }
        .fund-addr {
          display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
          padding: 10px 12px; border-radius: 12px;
          background: rgba(255,255,255,.04);
          font-size: 11.5px; font-weight: 600; color: ${JUICE.text3};
          text-align: left;
        }
        .fund-addr:hover { background: rgba(255,255,255,.07); }
        /* The instruction, in the product's own voice, ahead of the data. */
        .fund-addr-lbl {
          flex-basis: 100%; font-size: 11.5px; font-weight: 600;
          color: ${JUICE.text2};
        }
        .fund-addr[hidden] { display: none; }
        .fund-addr:hover { color: ${JUICE.text2}; }
        .fund-addr-key {
          font-family: ${JUICE.mono}; letter-spacing: -.01em;
          font-size: 12.5px; color: ${JUICE.text}; flex: 1;
        }
        .fund-addr-copy { color: ${JUICE.accentInk}; flex-shrink: 0; }
        .fund-home {
          align-self: flex-start; padding: 4px 0;
          font-size: 12px; font-weight: 600; color: ${JUICE.text3};
        }
        .fund-home:hover { color: ${JUICE.text2}; }
        .sheet .lbl {
          font-size: 11.5px; font-weight: 700; letter-spacing: .01em;
          color: ${JUICE.text3};
        }
        .sheet .field { display: flex; align-items: center; gap: 10px; }
        /* THE PRICE IS THE POINT, so it is the biggest thing in the sheet.
           Tabular figures so digits do not dance while it is typed into. */
        .price-box {
          display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0;
          background: ${JUICE.well};
          border: 1px solid ${JUICE.border};
          border-radius: 13px; padding: 10px 14px;
          transition: border-color .18s ease, background-color .18s ease,
                      box-shadow .18s ease;
        }
        .price-box:focus-within {
          border-color: rgba(104,198,255,.6);
          background: rgba(104,198,255,.06);
          box-shadow: 0 0 0 3px rgba(104,198,255,.12);
        }
        .price-box .cur { font-size: 19px; font-weight: 700; color: ${JUICE.text3}; }
        .price-in {
          flex: 1; min-width: 0; border: 0; outline: none; background: none;
          font: inherit; font-size: 23px; font-weight: 800; color: ${JUICE.text};
          font-variant-numeric: tabular-nums; letter-spacing: -.01em;
          padding: 0; -moz-appearance: textfield;
        }
        .price-in::placeholder { color: ${JUICE.text3}; }
        .price-in::-webkit-outer-spin-button,
        .price-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        /* The live verdict on what was just typed. It is the reason the
           reader can pick a price without doing arithmetic. */
        /* HOW FAR FROM THE TAPE IS NOT A TRADE RESULT. This was a filled
           green/red pill beside the price field — the dress the product
           reserves for money that actually moved, worn by a reading about
           distance. It is ink now: no ground, no radius, no direction
           colours, and it disappears when it has nothing to say. */
        .dist {
          font-size: 12.5px; font-weight: 700; white-space: nowrap;
          padding: 6px 2px;
          font-variant-numeric: tabular-nums;
          color: ${JUICE.text2};
          transition: color .18s ease;
        }
        .dist:empty { display: none; }
        .dist.good, .dist.bad { color: ${JUICE.text2}; }
        /* The words in the reading stay prose; only the figure is data. */
        .dist .dist-w {
          font-family: "TwitterChirp", -apple-system, "Segoe UI", Roboto, sans-serif;
          font-weight: 600; color: ${JUICE.text3};
        }
        /* THE AMOUNT, typed. Same control the card has always had, so the
           two surfaces stop being two products — and the presets fill it
           rather than replacing it. */
        /* ONE GAP, because this and .price-box are the same control with
           two jobs: a well, a currency sign, a big tabular figure. They
           drifted to 4px and 2px, and at 23px type the wider one reads as
           "$ 25" — a sign floating beside a number rather than the front
           of it, which is how no other money figure in the product is set
           (screenshot, 2026-09-20). */
        .amount {
          display: flex; align-items: center; gap: 2px;
          background: ${JUICE.well};
          border: 1px solid ${JUICE.border};
          border-radius: 13px; padding: 10px 14px;
          transition: border-color .18s ease, box-shadow .18s ease;
        }
        .amount:focus-within {
          border-color: rgba(104,198,255,.6);
          box-shadow: 0 0 0 3px rgba(104,198,255,.12);
        }
        .amount-cur { font-size: 19px; font-weight: 700; color: ${JUICE.text2}; }
        .amount-in {
          flex: 1; min-width: 0; border: 0; outline: none; background: none;
          font: inherit; font-size: 23px; font-weight: 800; color: ${JUICE.text};
          font-variant-numeric: tabular-nums; letter-spacing: -.01em;
          padding: 0; -moz-appearance: textfield;
        }
        .amount-in::placeholder { color: ${JUICE.text3}; }
        .amount-in::-webkit-outer-spin-button,
        .amount-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .picks { display: flex; gap: 7px; }
        /* THE SIZES: three outlined wells was the same control-panel
           grammar the tabs and the ranges were wearing. The outline goes;
           what is left is a soft key at rest and ONE obviously-lit pill
           for the size you are on. The lit hue still follows the direction
           (see .side-sell below) — selection is brand, a trade is green or
           red, and those stay different jobs. */
        .pick {
          flex: 1; padding: 9px 0; border-radius: 999px;
          font-size: 13.5px; font-weight: 700; color: ${JUICE.text2};
          background: rgba(255,255,255,.045);
          border: 0;
          font-variant-numeric: tabular-nums;
          transition: transform .12s ease, color .15s ease,
                      background-color .15s ease, box-shadow .15s ease;
        }
        .pick:hover {
          color: ${JUICE.text}; background: rgba(255,255,255,.08);
          --lift: -1px;
        }
        .pick[aria-pressed="true"] {
          background: rgba(104,198,255,.22); color: #CDEAFF;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.18),
                      0 4px 14px -5px rgba(104,198,255,.55);
        }
        /* On the sell side the same candy turns red: one sheet, one color
           story, decided by the direction the reader picked. */
        .side-sell .pick:hover { color: #FF8C83; }
        .side-sell .pick[aria-pressed="true"] {
          background: rgba(255,69,58,.2); color: #FFB3AD;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.14),
                      0 4px 14px -5px rgba(255,69,58,.5);
        }
        .side-sell .amount:focus-within {
          border-color: rgba(255,107,97,.6);
          box-shadow: 0 0 0 3px rgba(255,69,58,.10);
        }
        .side-sell .price-box:focus-within {
          border-color: rgba(255,107,97,.6);
          background: rgba(255,69,58,.05);
          box-shadow: 0 0 0 3px rgba(255,69,58,.10);
        }
        /* The footer stacks: balance as a quiet line of fact, then the
           confirm at FULL WIDTH — the one glowing object at the bottom of
           the sheet, impossible to miss and worth pressing. The old layout
           parked a small button bottom-right behind a divider, with the
           empty balance slot holding a blank band open above it. */
        .foot {
          display: flex; flex-direction: column; align-items: stretch;
          gap: 9px; padding-top: 2px;
        }
        .bal { font-size: 12.5px; color: ${JUICE.text2};
               font-variant-numeric: tabular-nums; }
        .bal:empty { display: none; }
        .bal b { color: ${JUICE.text}; font-weight: 700; }
        .bal b.up { color: ${GREEN}; }
        .bal b.down { color: ${RED}; }
        .bal.low b { color: ${JUICE.amber}; }
        /* The last thing touched before money moves, so it is the last
           place an ambiguous direction is acceptable — and it was blue on
           a buy. The recipe is unchanged; the hue is now supplied by the
           direction through --money-glow rather than baked into it. */
        .place {
          padding: 12px 20px; border-radius: 13px; font-size: 14px;
          letter-spacing: .01em;
          --money-glow: ${JUICE.buyGlow};
          --money-glow-hi: ${JUICE.buyGlowHi};
          background: ${JUICE_BUY_FILL}; color: ${JUICE.onBuyFill};
          box-shadow: ${JUICE.glowMoney};
          /* The landing's two signatures, ported. overflow clips the sweep
             (shadows render outside overflow, so the glow is untouched);
             z-index:0 gives the ::after its own stacking room. */
          position: relative; overflow: hidden; z-index: 0;
        }
        /* THE KEY BREATHES. The one ambient motion on an open sheet — the
           landing gave it to the button that wants to be pressed, and this
           is that button with money behind it. Direction-aware through the
           same --money-glow the static shadow reads, so a sell key breathes
           red and the fund key breathes brand. Dead under the surface's
           reduced-motion blanket, like everything else. */
        @keyframes placeBreathe {
          0%, 100% { box-shadow: ${JUICE.glowMoney}; }
          50%      { box-shadow: ${JUICE.glowMoneyHover}; }
        }
        .place:not(.wait) { animation: placeBreathe 4.5s ease-in-out infinite; }
        /* THE SHINE SWEEP: one diagonal light crossing the key on aim,
           exactly the landing CTA's. Not on .wait — a light show on a
           button that is only reporting progress promises the wrong thing. */
        .place::after {
          content: ""; position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(115deg, transparent 32%,
                      rgba(255,255,255,.5) 50%, transparent 68%);
          transform: translateX(-130%);
        }
        .place:not(.wait):hover::after {
          animation: placeShine .9s cubic-bezier(.16, 1, .3, 1);
        }
        @keyframes placeShine { to { transform: translateX(130%); } }
        .place:hover { background: linear-gradient(180deg, #6FEB9E, #2FD46C);
                       box-shadow: ${JUICE.glowMoneyHover}; }
        /* Not disabled — a dead button teaches nothing. It stays pressable
           and says what is missing, which is how the reader learns the
           rule without reading one. */
        /* A sell button must never wear the buy accent. The pill already
           gives Sell its own colour at rest; the sheet's confirm is the last
           thing touched before money moves, so it is the last place an
           ambiguous direction is acceptable. */
        .place.sell-side {
          --money-glow: ${JUICE.sellGlow};
          --money-glow-hi: ${JUICE.sellGlowHi};
          background: ${JUICE_SELL_FILL}; color: ${JUICE.onSellFill};
          box-shadow: inset 0 1px 0 rgba(255,255,255,.28),
                      0 4px 18px -4px ${JUICE.sellGlow};
        }
        .place.sell-side:hover { background: linear-gradient(180deg, #FF8C83, #FF574C); }
        /* ADDING MONEY IS NOT BUYING. Same button, same position, one
           press earlier in the story: it moves USDC into a wallet and
           nothing is bought, so it must not wear the colour that means a
           trade went through. Rule 4, and it is the reason the buy fill
           could not simply be applied to every .place. */
        .place.fund-side {
          --money-glow: rgba(104,198,255,.78);
          --money-glow-hi: rgba(104,198,255,.9);
          background: ${JUICE_GRADIENT}; color: ${JUICE.onAccent};
        }
        .place.fund-side:hover { background: linear-gradient(180deg, #9ADBFF, #6FC9FF); }
        /* WAITING IS NOT DISABLED. The grey here was the right dress for a
           dead verb and the wrong one for a live number: an in-flight
           amount is the product working, so it wears the accent's own text
           on the accent's own quiet ground — near the success colour it is
           about to become, and structurally never that colour (rule 4). */
        .place.wait {
          background: rgba(104,198,255,.10); color: #9FD9FF;
          font-variant-numeric: tabular-nums;
          box-shadow: inset 0 0 0 1px rgba(104,198,255,.22);
        }
        .place.wait:hover { background: rgba(104,198,255,.14); color: #BFE6FF; }
        @keyframes armed {
          0%   { transform: none; }
          45%  { transform: scale(1.045); }
          100% { transform: none; }
        }
        .place.arm { animation: armed .32s cubic-bezier(.16, 1, .3, 1),
                                placeBreathe 4.5s ease-in-out infinite; }
        /* ── STANDING ORDERS ALREADY ON THE BOOK ──────────────────────
           An order placed from a tweet used to vanish the moment the sheet
           closed: the only place it could be seen or cancelled was the
           panel, which is a different surface and, on X, a different frame
           of mind. A reader about to place a second order at the same price
           deserves to know the first one exists, right where they are. */
        .open-orders { display: flex; flex-direction: column; gap: 5px;
                       border-top: 1px solid rgba(255,255,255,.07);
                       padding-top: 10px; }
        .oo {
          display: flex; align-items: center; gap: 8px;
          font-size: 12.5px; color: ${JUICE.text2};
          font-variant-numeric: tabular-nums;
        }
        /* The sentence's words are prose; only its two figures are data. */
        .oo { flex-wrap: wrap; }
        .oo .oo-verb {
          font-family: "TwitterChirp", -apple-system, "Segoe UI", Roboto, sans-serif;
          color: ${JUICE.text3}; font-weight: 600;
        }
        .oo .oo-n { font-weight: 700; color: ${JUICE.text}; }
        .oo .oo-gated {
          flex-basis: 100%; font-size: 10.5px; font-weight: 600;
          color: ${JUICE.amber};
          font-family: "TwitterChirp", -apple-system, "Segoe UI", Roboto, sans-serif;
        }
        .oo .oo-x { margin-left: auto; padding: 3px 8px; font-size: 11.5px;
                    color: ${JUICE.text3}; border-radius: 7px; }
        .oo .oo-x:hover { color: #ff6b61; background: rgba(255,69,58,.10); }
        /* Its own row. Sharing the footer with the balance and the button
           made three variable-width things fight for one line, and on a sell
           — where the balance carries units, worth and entry — it wrapped. */
        /* An empty message row is not empty — it holds an empty <span> — so
           :empty never fired and the sheet drew a blank band above a
           second divider. It collapses on the class the code actually sets. */
        /* The Fomo-style honesty line: an open-regime mint — admitted by
           the gate on numbers alone, reviewed by nobody — says so, quietly,
           right where the money button lives. Amber like .thin, its sibling
           in the "we will not pretend" family. */
        .unverified {
          display: flex; align-items: center; justify-content: center;
          gap: 5px; font-size: 11.5px; font-weight: 600; color: ${JUICE.amber};
        }
        .msg-row { min-height: 0; }
        .msg-row.quiet { display: none; }
        /* The bell: quiet until hovered, because it is the SECONDARY answer
           on this row — the primary one costs money and glows. */
        .bell {
          padding: 8px 10px; border-radius: 10px; font-size: 14px;
          background: ${JUICE.well};
          border: 1px solid ${JUICE.border};
          flex-shrink: 0; filter: grayscale(1) opacity(.6);
          /* Keeps the press: a bare transition rule here used to REPLACE
             the base rule's transform entry, so this control snapped
             instead of springing. Every redeclaration on this surface
             carries the transform channel now. */
          transition: transform ${JUICE.releaseMs}ms ${JUICE.releaseEase},
                      filter .15s ease, border-color .15s ease;
        }
        .bell:hover { filter: none; border-color: rgba(255,255,255,.24); }

        /* The receipts' count, green like participation, quiet like a fact. */
        .proof {
          font-size: 11.5px; font-weight: 700; color: ${GREEN};
          background: rgba(48,209,88,.10); border-radius: 999px;
          padding: 4px 10px; align-self: flex-start;
          font-variant-numeric: tabular-nums;
        }
        .sheet .msg { font-size: 12.5px; font-weight: 600; color: ${JUICE.text2}; }
        .sheet .msg.err { color: ${RED}; }
        /* Declared once, from the token. There was a second copy further up
           spelling the same green as the literal #30D158 — identical today,
           and the kind of pair where a palette change moves one and not the
           other. */
        .sheet .msg.ok { color: ${GREEN}; }
        /* ── MOTION IS A PREFERENCE, NOT A DECISION WE GET TO MAKE ───────
           This block used to name two animations out of eighteen, which is
           the same as not having it: a reader who has asked their system to
           stop moving things still got the pill's spring entrance, the
           crossfade between flow states, the price tick pulse and every
           hover transition. Vestibular sensitivity is not a rounding error.

           Blanket, then re-allow nothing: no animation on this chip carries
           meaning that its end state does not already carry. */
        /* ── THE SUCCESS BEAT ─────────────────────────────────────────
           The one moment that has EARNED motion: money moved. The chip
           exhales green for 700ms and the receipt pops in with a small
           spring — once, then still. Errors get none of this; a failure
           announced with fanfare is a product mocking its reader. */
        .chip.glow-ok { animation: glowOk ${JUICE.cinemaMs}ms ${JUICE.cinemaEase}; }
        @keyframes glowOk {
          0%   { box-shadow: inset 0 1px 0 rgba(255,255,255,.05),
                             0 0 0 0 rgba(48,209,88,0);
                 border-color: ${JUICE.border}; }
          30%  { box-shadow: inset 0 1px 0 rgba(255,255,255,.05),
                             0 0 34px -2px rgba(48,209,88,.65);
                 border-color: rgba(48,209,88,.55); }
          70%  { box-shadow: inset 0 1px 0 rgba(255,255,255,.05),
                             0 0 22px -4px rgba(48,209,88,.35);
                 border-color: rgba(48,209,88,.3); }
          100% { box-shadow: inset 0 1px 0 rgba(255,255,255,.05),
                             0 0 0 0 rgba(48,209,88,0);
                 border-color: ${JUICE.border}; }
        }
        .note.ok { animation: okPop .45s cubic-bezier(.2, 1.4, .4, 1); }
        @keyframes okPop {
          from { opacity: 0; transform: scale(.92); }
          60%  { transform: scale(1.03); }
          to   { opacity: 1; transform: none; }
        }
        /* RULE 6 — THE DATA SPEAKS MONO. Numbers, balances, chart axes
           and order tags carry the terminal voice; names, labels and
           sentences stay in the product face. Listed here, enforced by
           theme/juice.spec.ts on every surface.

           WITH ONE EXEMPTION, AND IT IS THE WHOLE POINT OF THIS SURFACE.
           The resting row lives inside somebody else's page, where every
           glyph around it is Chirp. A monospace price six pixels from
           Chirp body text is the single loudest signal that this object
           was bolted on — reported from the field exactly that way: juicy,
           and obviously not native.

           So the resting row keeps the FUNCTION of rule 6 and drops the
           costume: tabular-nums still lines the digits up on every tick,
           which is what the mono was actually buying. Everything the
           reader SUMMONED — the sheet, the chart, the scoreboard — is our
           surface, not X's, and keeps the terminal voice. */
        .amount-in, .price-in, .bal, .dist,
        .chart-note, .order-tag, .entry-tag, .oo, .oo-n,
        .receipt {
          font-family: ${JUICE.mono}; letter-spacing: -.01em;
        }
        .px, .chg, .mine, .wal {
          font-variant-numeric: tabular-nums; letter-spacing: -.01em;
        }

        @media (prefers-reduced-motion: reduce) {
          .chip, .chip *, .sheet, .sheet * {
            animation: none !important;
            transition: none !important;
          }
        }
        /* The landing's arrival: rise, a hair past, settle. One movement,
           and the overshoot is what makes a surface LAND instead of fade. */
        @keyframes stripIn {
          0%   { opacity: 0; transform: translateY(5px) scale(.985); }
          70%  { opacity: 1; transform: translateY(-1px) scale(1.005); }
          100% { opacity: 1; transform: none; }
        }
        /* The asset's mark identifies; it does not lead. 20px is enough to
           be a face and not so much that it outranks the price. */
        .badge {
          /* The asset's face, at a size a face deserves. 20px with a 9px
             letter was a favicon; this is the first thing the eye lands on
             and the only picture in the row. */
          width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
          display: grid; place-items: center; overflow: hidden;
          background: linear-gradient(140deg, #3AA6FF, #1D6FD0);
          color: #FFFFFF; font-size: 11px; font-weight: 800;
        }
        .badge img { width: 100%; height: 100%; object-fit: cover;
                     opacity: 0; transition: opacity .25s ease-out; }
        /* THE LEFT CLUSTER IS THE DOOR TO THE APP.
           The card is a channel to the sidebar, not a destination — so on X,
           where the chip is the only surface a reader ever sees, routing
           through the card would be a detour past the thing it exists to
           reach. Left is "take me there", right is "do it here". Reusing
           the pixels that were already showing the asset costs the row
           nothing, and X's own price chip works the same way, arrow and all. */
        /* ONE CAPSULE, TWO DOORS. The asset pill and the chart chevron
           wore separate rings, and the owner read them as clutter: two
           boxes for what is really one subject and its disclosure. The
           capsule now owns the ground and the ring; the two buttons
           inside are flat and keep their own hover and press, so the
           merge costs no affordance — only an edge. */
        .lead {
          display: flex; align-items: center;
          min-width: 0; flex-shrink: 1;
          border-radius: 999px;
          /* X BUILDS ITS INLINE FURNITURE OUT OF A HAIRLINE ON THE PAGE'S
             OWN GROUND, not out of a filled slab. The navy gradient plus a
             drop shadow made this the heaviest object in the column, which
             is precisely what "not native" looks like. A near-transparent
             wash and one border, the way X's own pills are built. */
          background: rgba(122,183,255,.06);
          box-shadow: inset 0 0 0 1px rgba(122,183,255,.16);
        }
        /* THE SECOND STAGE OF THE SQUEEZE, which clipping .pair alone did
           not cover. .pair is the valve and it clips, so the ticker
           ellipsises and the price is cut inside the pair's own box — but
           .face carries "min-width: 0", and min-width:0 is exactly the
           declaration that removes a flex item's automatic minimum size.
           Once .pair is at zero the algorithm keeps shrinking .face past
           the sum of what is left, and what is left is all frozen:
           .badge (24px, flex-shrink:0), .chg (flex-shrink:0; it ships in
           the markup unhidden, and paintMine hides it in two places —
           once a position exists, and while there is no change figure to
           print — so the case below counts it as present, which is the
           wide side of the question), .mine, .who. Frozen children in a
           box narrower than
           they are lay out from the main-start edge and overflow to the
           RIGHT: over .more, and into .end, where they show through
           .sell's rgba(255,255,255,.05) ground. That is the same failure
           the pair's clip was written for, one level out.

           So the face clips too. The order of surrender is then read
           right-to-left off the markup, and it is the order the row would
           choose: the faces first, then your position, then the day's
           change. Nothing inside this button can reach .end at any width.

           The cut is at the PADDING box, and the 5px top/bottom above is
           what keeps it off anything that MOVES: .px lifts 1.5px on a live
           tick, .pair's own clip already contains that lift, and .pair
           sits inside this box's CONTENT box — so the face's cut is a
           further 5px out from it. Take the vertical padding away and this
           clip starts shaving the pulse — pinned in chip-frame.spec.ts.

           .lead is deliberately NOT clipped: it is the parent of two
           BUTTONS, and an overflow clip on it would also clip their
           2px/1px-offset focus outlines, which is a real loss for a real
           user to fix a squeeze this one already stops. */
        .face {
          display: flex; align-items: center; gap: 7px;
          min-width: 0; flex-shrink: 1;
          overflow: hidden;
          padding: 5px 4px 5px 6px; margin: 0; border-radius: 999px 0 0 999px;
          background: none; border: 0; cursor: pointer;
          font: inherit; color: inherit; min-width: 0;
          transition: transform ${JUICE.releaseMs}ms ${JUICE.releaseEase},
                      opacity .15s ease;
        }
        .face:hover { opacity: .82; }
        .face:active { transform: scale(.96); }
        /* TICKER AND PRICE ON ONE LINE, side by side. This reverses the
           column that shipped here days ago, on the owner's call after
           looking at it in a real feed, and the old argument deserves an
           answer rather than a deletion: it said that side by side, "two
           facts at one weight gave the eye nowhere to land". The premise
           was wrong. The two facts are not at one weight and never were —
           10px/700/uppercase/grey against 15px/800/white is the entire
           hierarchy, and it does not depend on which LINE a word sits on.

           What the column actually cost was SHAPE. Stacked, this pair is
           two line boxes (~31px) inside a .face that adds 5px of padding
           top and bottom — a ~41px capsule sitting in a row pinned to 38px
           (.row), taller than the 30px .more/.ring/.wal buttons beside it,
           and outside the 32-34px band .chip up top commits this whole row
           to because it is X's own inline-button scale. Side by side the
           pair is one 18px line box, .face is sized by the 24px badge
           instead (24 + 10 = 34px), and the two facts read as one phrase.
           The row's own height is fixed, so nothing in X's timeline moves.

           CENTRE, NOT BASELINE — a browser fact, not a preference.
           Baseline is the right answer for two type sizes on one line, and
           it is not available here: .sym carries "overflow: hidden" (pinned
           below by a field bug), which makes it a SCROLL CONTAINER, and a
           scroll container does not expose the baseline of its text — the
           engine synthesizes one from its border box, which would hang the
           ticker about 2px high off the price. Centring is what is left,
           and for UPPERCASE beside digits it draws almost the same picture:
           neither has a descender, so the two cap heights centre on one
           axis. It has the second virtue of not caring what line-height
           X's page inherits into "button { font: inherit }".

           5px, deliberately tighter than the 7px .face puts between its own
           children: on one line, proximity is the only thing left saying
           these two facts are one subject.

           And the class is .pair now, not .stack. A rule named "stack" that
           lays out a row is the same kind of lie the comments in this file
           are forbidden to tell.

           ── HOW THIS PAIR IS ALLOWED TO FAIL ─────────────────────────────
           Un-stacking moved the pair's intrinsic width from max(sym, px) to
           sym + 5 + px — about +26px for a short ticker and up to +60px at
           the 9ch cap — on a row .end already records as having WANTED
           511px inside a ~500px X column. So a squeeze is not a hypothesis
           here, it is the measured normal case with the balance warning up,
           and the only question a layout gets to answer is which way it
           breaks.

           It breaks by ELLIPSIS. This box is the shrink target inside
           .face (every other child there declares flex-shrink: 0, and the
           one that declares nothing is an 11px glyph that cannot go below
           its own min-content), it can go to zero, and it CLIPS — so
           nothing inside it can paint over .end and show through .sell's
           translucent ground, which is precisely what happened while the
           pair shrank with overflow visible and both its children refused
           to give a pixel. Inside the clip the ticker is
           the one that yields (see .sym) and the price never does, so the
           first thing a reader loses is letters off a name whose disc is
           still sitting beside it — not digits off a number.

           overflow: hidden, not auto. A clip that ellipsises is honest
           about having run out of room; a scroll container hides a fact
           behind a gesture nobody knows is available.

           And the padding/margin pair is what keeps the clip HORIZONTAL.
           A clip cuts at the PADDING box, so 3px of vertical padding puts
           the top and bottom edges out of the way of anything that moves:
           .px lifts 1.5px on a live tick (tickPulse), and a box clipping at
           the exact top of its line box would shave the digits mid-pulse —
           a clip installed for width quietly eating a movement. The equal
           negative margin hands the 6px straight back, so the pair occupies
           exactly the height it did before and the row does not move.
           Sideways there is no padding, so the ellipsis still bites at the
           first pixel it has to. */
        .pair {
          display: flex; flex-direction: row; align-items: center;
          gap: 5px; min-width: 0; flex-shrink: 1;
          overflow: hidden;
          padding: 3px 0; margin: -3px 0;
        }
        /* HIERARCHY, WHICH THE ROW DID NOT HAVE. Ticker, price and change
           all sat at roughly one weight, so the eye had nowhere to land
           first and the whole row read as a caption. The price is the fact
           somebody stopped scrolling for; it gets the size. The ticker
           names it and steps back a little. */
        .sym {
          /* A LABEL now, not a peer of the price. Uppercase, small, quiet:
             it says which asset, and then gets out of the way. */
          font-weight: 700; font-size: 10px; letter-spacing: .06em;
          text-transform: uppercase;
          color: ${JUICE.text3};
          /* THE TICKER YIELDS AGAIN — AND IT IS NOT THE OLD BUG COMING
             BACK. Read the whole trade before touching this line.

             "flex-shrink: 0" arrived here with the field report it names.
             The ticker was then a direct child of .face and the only
             shrinkable thing on it, so it paid for every pixel FIRST and
             $SOL arrived as "S…". Freezing it did not create room, it
             MOVED the failure: with every child of .face frozen, a squeeze
             has to leave the box instead. That was affordable because the
             same pass took MC off the face and handed the row 50-60px of
             slack to leave with.

             The slack is spent. Putting the ticker beside the price again
             costs 26-60px (see .pair) on a row .end records as having
             WANTED 511px inside a ~500px column — and "leave the box",
             with nothing on the way out clipping, means the 15px price
             paints across .end and shows through Sell's ground.

             So the ticker narrows again, and the difference from the old
             bug is WHEN. Then it paid first, while MC was still on the
             row: a name giving way for a number nobody had asked for. Now
             it is the last thing left to give — the price never gives, the
             tail never gives — it gives INSIDE a box that clips, and the
             disc to its left still names the asset while the letters are
             short. A shortened name is a legible failure. A price lying
             across the Sell key is not.

             overflow: hidden is doing double duty: it makes the ellipsis
             possible AND it is what lets this flex item shrink below its
             own text (a flex item's automatic minimum size is zero once it
             is not overflow: visible). The 9ch cap stays for the opposite
             direction — a pathological ticker eating the whole row. */
          flex-shrink: 1; max-width: 9ch; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .px {
          display: inline-block;
          /* THE HEADLINE OF THE ROW — but X's headline size, not ours.
             19px out-shouted the tweet it was attached to. At 15px it
             matches the body text exactly and still leads its own row,
             because the ticker BESIDE it is 10px and grey. (This read
             "above" while the pair was a column; the hierarchy did not
             move when the column did — see .pair.) */
          font-size: 15px; letter-spacing: -.01em;
          /* The one thing on the left that never gives way — and now the
             only one, which is what makes the ticker's ellipsis the row's
             pressure valve instead of a decoration. A price that shrinks
             is a price that drops a digit, and "$0.004" where "$0.004945"
             was is not a smaller truth, it is a different one. */
          flex-shrink: 0;
          font-weight: 800; font-variant-numeric: tabular-nums;
          /* NO HALO AT REST. A glowing number is the neon-ticker signature,
             and it made a READOUT the brightest object on a row whose
             brightest object should be the thing you can press — in the
             brand blue, which does not describe market facts. The size,
             the tabular figures and the tick pulse already say "this just
             printed"; the glow belongs to surfaces the reader summoned. */
          color: ${JUICE.text};
          transition: color .45s ease;
        }
        /* MC came OFF the resting face (field, 2026-08-31): on a real
           timeline the row clipped it to "MC $60." — truncated money text
           is worse than absent — and it was the straw that made the row
           read as a terminal strip. The number lives one tap away in the
           chart's own header and in the sheet's safety line. */
        /* THE PRICE HAS NO COLOUR, and that is the fix for a real
           contradiction: this ink was painted by the LAST TICK while the
           badge six pixels away was painted by the LAST 24 HOURS. Two
           clocks, two answers, one asset — photographed live as a red
           price beside a green +24.8%.

           Direction now lives in exactly one place on this row. The price
           keeps its pulse, which says "that just printed" without
           claiming to say which way. */
        .px.flash { animation: tickPulse .5s cubic-bezier(.16, 1, .3, 1); }
        @keyframes tickPulse {
          0% { transform: translateY(-1.5px); }
          100% { transform: none; }
        }
        /* NEWS ARRIVING IS A MOMENT — the game grammar. The badge pops in
           with a small overshoot (release curve, rule 7's springiness
           budget), the bell swings once from its hanger and settles. Both
           one-shot, both only on ARRIVAL; read news leaves silently. The
           swing lives on the SVG because the button's transform channel
           belongs to the press system. */
        .wal-dot.pop { animation: dotPop .32s ${JUICE.releaseEase}; }
        @keyframes dotPop {
          0% { transform: scale(.4); opacity: 0; }
          70% { transform: scale(1.12); opacity: 1; }
          100% { transform: none; opacity: 1; }
        }
        .ring svg { transform-origin: 50% 15%; }
        /* IT SHAKES, AND IT ASKS TO BE PRESSED. The old swing was a polite
           13-degree nod on an invisible button. Arrival now rings twice as
           far and twice as fast, because the whole job of this gesture is
           to be caught in peripheral vision while somebody is reading
           somebody else's tweet. Still ONE SHOT and still only on arrival:
           a thing that shakes on a timer is the orbit this product already
           removed once. */
        .ring svg.swing { animation: bellSwing .82s ${JUICE.motionEase}; }
        @keyframes bellSwing {
          0%   { transform: rotate(0); }
          12%  { transform: rotate(-26deg); }
          28%  { transform: rotate(22deg); }
          44%  { transform: rotate(-16deg); }
          60%  { transform: rotate(11deg); }
          76%  { transform: rotate(-6deg); }
          88%  { transform: rotate(3deg); }
          100% { transform: rotate(0); }
        }
        /* The button breathes once behind the shake, so the eye is pulled
           by a change in AREA as well as angle. Rides box-shadow, never
           transform, which belongs to the press system. */
        .ring.live.rang { animation: ringPulse .82s ${JUICE.motionEase}; }
        @keyframes ringPulse {
          0%   { box-shadow: inset 0 0 0 1px rgba(104,198,255,.5), 0 0 0 0 rgba(104,198,255,.55); }
          55%  { box-shadow: inset 0 0 0 1px rgba(104,198,255,.5), 0 0 0 9px rgba(104,198,255,0); }
          100% { box-shadow: inset 0 0 0 1px rgba(104,198,255,.5), 0 0 16px -4px rgba(104,198,255,.8); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ring svg.swing, .ring.live.rang { animation: none; }
        }
        /* Every list the scoreboard paints CASCADES in: each row arrives a
           beat after the one above it, capped at ten beats so a long book
           does not stagger forever. Rebuilt lists (tab switches, repaints)
           re-run it because replaceChildren makes new nodes — which is
           exactly the tab-switch animation, for free. Same arrival
           composite as stripIn (fade + small rise = one movement). */
        .you-list > * { animation: rowIn .28s ${JUICE.motionEase} backwards; }
        /* Re-paints of the SAME tab arrive still — the cascade is a tab's
           entrance, not a data refresh's. */
        .you-list.still > * { animation: none; }
        .you-list > *:nth-child(1) { animation-delay: 0ms; }
        .you-list > *:nth-child(2) { animation-delay: 26ms; }
        .you-list > *:nth-child(3) { animation-delay: 52ms; }
        .you-list > *:nth-child(4) { animation-delay: 78ms; }
        .you-list > *:nth-child(5) { animation-delay: 104ms; }
        .you-list > *:nth-child(6) { animation-delay: 130ms; }
        .you-list > *:nth-child(7) { animation-delay: 156ms; }
        .you-list > *:nth-child(8) { animation-delay: 182ms; }
        .you-list > *:nth-child(9) { animation-delay: 208ms; }
        .you-list > *:nth-child(n+10) { animation-delay: 234ms; }
        @keyframes rowIn {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: none; }
        }
        /* THE BUY BURST: eight sparks leaving the receipt, green and
           accent, gone in two thirds of a second. Spawned by JS only when
           motion is allowed — under reduced motion the blanket below would
           freeze them mid-air as permanent confetti, so they are simply
           never born there. */
        /* The chip anchors the burst; relative costs nothing to a flex
           column and gives the sparks their origin. */
        .chip { position: relative; }
        .burst { position: absolute; width: 0; height: 0; pointer-events: none; }
        .burst i {
          position: absolute; left: -2px; top: -2px; width: 5px; height: 5px;
          border-radius: 50%;
          animation: spark calc(${JUICE.cinemaMs}ms * .82) ${JUICE.cinemaEase} forwards;
          animation-delay: calc(${JUICE.cinemaMs}ms * .12);
        }
        .burst i:nth-child(odd) { background: ${GREEN}; }
        .burst i:nth-child(even) { background: ${ACCENT}; width: 4px; height: 4px; }
        /* Rule 4 reaches the confetti too. A sell celebrated in green is
           the success dress on the opposite direction, and this surface
           forbids that everywhere else it can be measured. */
        .burst-sell i:nth-child(odd) { background: ${RED}; }
        /* THE REWARD. A disc, because the animation is authored on the brand
           ground and clipped to a circle it IS the logo rather than a sticker
           laid on top of one. It rises out of the receipt, holds while the
           glasses drop, and leaves — 1.6s end to end, the length of the
           animation itself and not a beat longer. */
        /*
          THE LANDING PLAYS ON ONE CLOCK.
       
          Rule 7, applied to the moment that was breaking it hardest. The
          same movement — a trade arriving — used to be drawn five times at
          five durations with three curves: the row at 150ms, the reward at
          420, okPop at 450, the sparks at 620 and the chip's glow at 700.
          Nothing was wrong with any one of them; what was wrong is that the
          moment finished four times, and a moment that finishes four times
          reads as four things happening near each other rather than one
          thing happening.
       
          Everything below is now ${JUICE.cinemaMs}ms on ${JUICE.cinemaEase},
          and what differs between the parts is their DELAY, not their clock.
          Staggered is not unsynchronised: they start apart and land together.
       
          The register is the one picked from four in a side-by-side mockup:
          a hero leads, the rest fall in behind it, and a light crosses the
          surface once. It is the slowest tier this product owns and it is
          spent here because a trade landing is rare, consequential, and
          already sitting inside a wait of several seconds — see cinemaMs in
          theme/juice.ts for where it is forbidden to go.
        */
        .end.landed > * {
          animation: landIn calc(${JUICE.cinemaMs}ms * .62) ${JUICE.cinemaEase} both;
        }
        .end.landed > *:nth-child(1) { animation-delay: 0ms; }
        .end.landed > *:nth-child(2) { animation-delay: calc(${JUICE.cinemaMs}ms * .12); }
        .end.landed > *:nth-child(3) { animation-delay: calc(${JUICE.cinemaMs}ms * .2); }
        .end.landed > *:nth-child(4) { animation-delay: calc(${JUICE.cinemaMs}ms * .26); }
        @keyframes landIn {
          from { opacity: 0; transform: translateY(9px); }
          to   { opacity: 1; transform: none; }
        }
        /* What leaves goes UP and what arrives comes from BELOW: the row is
           replaced, not repainted, and the direction is what says so. */
        .end.leaving > * {
          animation: landOut calc(${JUICE.cinemaMs}ms * .3) ${JUICE.cinemaEase} forwards;
        }
        @keyframes landOut { to { opacity: 0; transform: translateY(-7px); } }

        /* The chip takes the weight of the moment for one beat. */
        .chip.landed { animation: chipLand ${JUICE.cinemaMs}ms ${JUICE.cinemaEase}; }
        @keyframes chipLand {
          0%   { transform: scale(1); }
          22%  { transform: scale(1.028); }
          100% { transform: scale(1); }
        }
        /* And one light crosses it, once. The recipe is placeShine's, moved
           up from the button to the whole surface for the one moment that
           earns it. */
        .chip-sweep {
          position: absolute; inset: 0; border-radius: 999px;
          overflow: hidden; pointer-events: none; z-index: 4;
        }
        .chip-sweep::after {
          content: ""; position: absolute; top: 0; bottom: 0; width: 38%;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,.13), transparent);
          transform: translateX(-140%);
          animation: chipSweep calc(${JUICE.cinemaMs}ms * .78) ${JUICE.cinemaEase} forwards;
          animation-delay: calc(${JUICE.cinemaMs}ms * .1);
        }
        @keyframes chipSweep { to { transform: translateX(330%); } }

        /* THE REWARD. A disc, because the animation is authored on the brand
           ground and clipped to a circle it IS the logo rather than a sticker
           laid on top of one. It arrives with the receipt and leaves with it,
           so it has no exit of its own: a fade-out at the end would have
           emptied the circle while the element stayed. Its entrance is the
           shared one above — it is one of the row's children now, and that
           is the whole point. */
        .pop-reward {
          flex: 0 0 auto; width: 22px; height: 22px;
          border-radius: 50%; pointer-events: none;
          filter: drop-shadow(0 3px 8px rgba(0,0,0,.4));
        }
        .burst-neutral i:nth-child(odd) { background: ${ACCENT}; }
        @keyframes spark {
          0% { transform: none; opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(.4); opacity: 0; }
        }
        /* The day's verdict, and it was competing with the price. Smaller
           and tighter: a footnote to the number, not a second number. */
        /* INK, NOT A PILL — and this file already knew it. The argument
           was written here first: an edge is a promise that something can
           be pressed, and the day's change cannot be. I gave it a pill
           anyway, which was a preference dressed as a reason.

           Two things settled it against me. The rule above (an edge is a
           promise) is the file's own and was not answered, only ignored.
           And Fomo, whose grammar the rest of this pass follows, draws the
           change as plain coloured text with a direction mark and reserves
           the bordered chip for the market cap — a labelled FACT, not a
           verdict. Two enclosed shapes fewer on a row that was already
           criticised for being busy.

           The direction arrow does the work the ground was doing: it
           marks the figure as a verdict at a glance, and it costs no edge.
           .mine keeps its ground, because that one is a different KIND of
           fact — yours, not the market's — and without a difference in
           dress the two percentages on this row are confusable. */
        .chg {
          font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
          letter-spacing: 0; flex-shrink: 0;
        }
        .chg.up { color: ${JUICE.buyInk}; }
        .chg.down { color: ${JUICE.sellInk}; }
        /* THE READER'S OWN STAKE, on the face. The market's verdict (.chg)
           and yours are different facts and wear different clothes: yours
           carries the word "You", brand-tinted when the basis is unknowable,
           green or red once there is a real P&L to report. Inside the face
           button on purpose — your position is a door to the panel. */
        .mine {
          font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
          letter-spacing: 0; flex-shrink: 0; white-space: nowrap;
          padding: 3px 7px; border-radius: 999px;
          color: #9FD9FF; background: rgba(104,198,255,.13);
        }
        /* The hue STAYS on this one. Rule 4 names profit and loss as its
           literal territory, and a holder scanning a timeline should not
           have to parse a minus glyph at 11px to learn which way they are.
           What went is the pill around it. */
        .mine.up { color: ${JUICE.buyInk}; background: rgba(48,209,88,.14); }
        .mine.down { color: ${JUICE.sellInk}; background: rgba(255,69,58,.13); }
        .mine[hidden] { display: none; }
        /* NO .who HERE ANY MORE (backticks stay out of this comment: it lives
           inside a template literal, and one would end the stylesheet). It was the stack of faces of people you
           follow who are in this asset — true, and more expensive than it
           returned. Two faces on one 38px row with the reader's own wallet
           key one slot over, and nothing saying which was which: the founder
           read his own followed account as himself and reported it as a bug
           twice, on a product he wrote. It was made smaller, ringed and
           always counted first, and the read after that was that the idea
           itself was extra complexity on the row that carries the money.
           This row's budget belongs to the price and the two decisions. The
           panel still says how many friends are trading, where there is
           space to say it. */
        /* THE AUTHOR'S TRACK RECORD, on its own line because it is about
           the PERSON above the row rather than about the asset in it.
           Sentence case in the product's face, not a badge: it is a
           sentence, and a pill would make it look like another score. */
        .callr {
          font-size: 12px; font-weight: 600; color: ${JUICE.text3};
          padding: 6px 2px 0;
          display: flex; align-items: center; gap: 5px;
        }
        .callr[hidden] { display: none; }
        /* The AI reader's line: why this post got this chip, when no rule
           placed it. Quiet like the caller line, with the word that says
           who is talking. */
        .why {
          font-size: 12px; font-weight: 500; color: ${JUICE.text3};
          padding: 6px 2px 0;
          display: flex; align-items: baseline; gap: 6px;
        }
        .why[hidden] { display: none; }
        .why .ai {
          font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
          color: ${JUICE.accent};
        }
        .callr b {
          color: ${JUICE.text2}; font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
        /* Pushed to the far edge: the decisions live where the eye lands
           after reading the numbers, and where X's own row actions sit. */
        /* THE ACTIONS NEVER LOSE. The chip lives in the tweet's own text
           column, which is a fixed width — so every pixel the shell gained
           came out of somebody's Sell button, and the last pass grew the
           bar, grew Buy and added a word until Sell fell off the end.
           Reported exactly that way.

           Order of surrender, and it is deliberate: the reader's wallet
           goes first (an aside), then the ticker (the disc still names the
           asset), then the change badge. Buy and Sell are the product; they
           are the last things standing and they never shrink. */
        /* THESE NUMBERS ARE MEASURED, NOT CHOSEN. Field report: a tweet
           for $BULLSHIT showed "BU…" on a row with visible empty space in
           it. Reproduced against this exact stylesheet in a shadow root
           at real column widths, and the row turned out to want 511px
           while X's tweet text column gives about 500.
           
           The first instinct was to change WHO pays — the file's own
           surrender order says the reader's wallet goes first, then the
           ticker, and .end { flex-shrink: 0 } was quietly preventing
           that. Measuring it killed the idea: the wallet is not an aside
           any more. It only appears when the balance cannot cover a
           press, which makes it a warning, and a warning does not give
           way to a word. Letting it shrink just clipped a NUMBER instead
           of a word, which is worse.
           
           So the row was made to want less instead. Trimming the seam,
           the pill paddings and one gap recovers about 20px, and 20px is
           the whole argument: measured at a 500px column with the
           balance warning up, the ticker goes from 37px of the 58 it
           needs to all 58. Every other state gains the same headroom.
           Change these and re-measure, or the ticker starts paying
           again. */
        /**
         * THE KEYS SIT WITH THE PRICE, NOT AT THE FAR EDGE.
         *
         * margin-left:auto threw the money to the right rail and left a
         * long void across the middle of the row, so the chip read as two
         * widgets sharing a line rather than one control. Measured against
         * the host instead of against taste: Reddit packs its own vote,
         * comment, repost and share cluster hard left, and this row was the
         * only full-width thing on the post.
         *
         * So the cluster follows the pill. The chip becomes one object, it
         * matches the rhythm of the furniture above it, and the reader's
         * eye travels from the asset to its buttons without crossing empty
         * space.
         *
         * The padding is untouched at 10px: the spec below records that
         * these numbers were measured against a ~500px column after a
         * field report clipped a ticker to "BU…", and that opening the
         * chip must cost the row no width. Only the auto margin goes.
         */
        .end { display: flex; align-items: center; gap: 7px;
               padding-left: 10px; flex-shrink: 0; }

        /**
         * WHO PUT THIS HERE.
         *
         * Field note from Reddit: the resting chip carried the company's
         * logo, the host's accent colour and the word "Buy", and nothing
         * anywhere said Poppin. On a page about money an unattributed Buy
         * button is indistinguishable from something malicious, and asking
         * a reader to trust it was asking for something we had not earned.
         *
         * It goes at the LEFT EDGE OF THE MONEY, not beside the price:
         * the price already wears the asset's own logo, and two marks a
         * few pixels apart read as a collision.
         *
         * AND IT IS A WORD, NOT A GLYPH. The first attempt put the logo
         * here at 13px and it simply became a sixth icon in a row of
         * icons — the eye counted a control it could not name, which is
         * the opposite of what a signature is for. Type cannot be mistaken
         * for a button. It carries more air than the icon gap so the eye
         * reads it as a label on the group rather than a member of it.
         *
         * AND IT RESTS HIDDEN, with the two doors. A signature under every
         * post in a feed is the same mistake as a control under every
         * post: repeated often enough it stops being information and
         * becomes furniture, and this file's own rule is that a thing
         * which appears everywhere is wallpaper. It arrives with the
         * pointer, which is the moment a reader is asking what this is.
         *
         * The order property rather than DOM position, so the stagger's
         * nth-child delays keep pointing at the controls they were tuned
         * for.
         */
        .pmark {
          margin-right: 0;
          /* OUR TYPE, AND THE ONLY PLACE IT BELONGS. The chip's body
             deliberately borrows the host's face so the row looks native;
             a signature set in the host's font is not a signature at all,
             which is what the first version was — Poppin written in
             TwitterChirp. This is the brand face, lowercase, as drawn. */
          font: 700 11px/1 PoppinSans, -apple-system, "Segoe UI", Roboto, sans-serif;
          letter-spacing: -.01em;
          color: rgba(255,255,255,.52);
          white-space: nowrap;
          flex-shrink: 0;
          opacity: 0;
          transition: opacity ${JUICE.motionMs}ms ${JUICE.motionEase};
        }

        /**
         * THE TWO DOORS REST CLOSED.
         *
         * Bell and wallet are secondary and permanent: they cost a reader
         * attention on every chip on the page, and both are reachable one
         * press away — the sheet's own "When it hits" IS the alert, in
         * words. Five controls on a resting row, three of them unlabelled
         * glyphs, is a toolbar rather than an offer.
         *
         * They keep their space so the row cannot reflow under the
         * pointer, and they return for hover, for keyboard focus, and
         * whenever the wallet has something to say — a dot nobody can see
         * is not a notification.
         */
        /**
         * THE SECONDARY CONTROLS TAKE NO ROOM UNTIL THEY ARE WANTED.
         *
         * .ring is the bell and .wal is the wallet. Named explicitly
         * because the first version of this rule targeted .bell, which
         * reads like the bell and is applied to nothing.
         *
         * They used to rest invisible but KEEP their width, so the row
         * could not reflow under the pointer. That bought stillness at the
         * price of a permanent void between the price and the keys, and
         * the keys are the reason the row exists. They collapse now, so at
         * rest the money sits against the asset it belongs to.
         *
         * The negative margin cancels this flex row's own gap, which is
         * inserted between items whatever their width — three collapsed
         * controls would otherwise still hold 21px open.
         *
         * On the way in they are staggered: the signature, then the bell,
         * then the wallet. A stagger is what turns a reflow from a jolt
         * into a gesture, and the order is deliberate — identity answers
         * first, because the question a hovering reader is asking is what
         * this thing is. On the way out they leave together; nobody
         * choreographs a departure they are already looking away from.
         */
        .pmark, .ring, .wal {
          /* AFTER the keys, on all three. Opening between the price and Buy
             moved the primary action ~115px to the right exactly as a
             reader was travelling towards it: the button ran away from the
             pointer reaching for it. Growing rightward into empty column
             costs nobody anything. Declared here rather than on .pmark
             alone, which is where it first landed — the signature moved
             and the two doors stayed, so the keys still walked. */
          order: 1;
          opacity: 0;
          max-width: 0;
          margin-left: -7px;
          overflow: hidden;
          pointer-events: none;
          transition: opacity ${JUICE.motionMs}ms ${JUICE.motionEase},
                      max-width ${JUICE.motionMs}ms ${JUICE.motionEase},
                      margin-left ${JUICE.motionMs}ms ${JUICE.motionEase};
        }
        .pmark { margin-right: 0; }
        /* The coach-hold class rides along with hover and focus: the
           onboarding card names the bell and the wallet, and both are
           invisible until a pointer arrives. Declared here rather than in
           COACH_STYLE because that sheet is injected FIRST, so an equal
           specificity there loses to these rules and the reveal would stop
           working with nothing to show for it.

           NO BACKTICKS IN THIS COMMENT. It lives inside a template
           literal, and one backtick ends the stylesheet at that character
           with no error until the page renders nothing. */
        .chip.coach-hold .pmark,
        .chip.coach-hold .ring,
        .chip.coach-hold .wal,
        .chip:hover .pmark, .chip:focus-within .pmark,
        .chip:hover .ring, .chip:focus-within .ring,
        .chip:hover .wal, .chip:focus-within .wal,
        .ring:focus-visible, .wal:focus-visible,
        /* Both the bell and the wallet mark unread with .wal-dot, so one
           selector covers the pair. This is the case that must not wait
           for a pointer: a notification nobody can see is not a
           notification, so the control holds its ground and its width
           whether or not anyone is hovering. */
        .ring:has(.wal-dot:not([hidden])),
        .wal:has(.wal-dot:not([hidden])) {
          opacity: 1;
          max-width: 60px;
          margin-left: 0;
          pointer-events: auto;
        }
        .chip.coach-hold .pmark,
        .chip:hover .pmark, .chip:focus-within .pmark { margin-left: 4px; }
        .chip:hover .pmark, .chip:focus-within .pmark { transition-delay: 0ms; }
        .chip:hover .ring, .chip:focus-within .ring { transition-delay: 55ms; }
        .chip:hover .wal, .chip:focus-within .wal { transition-delay: 110ms; }
        /**
         * A TOUCH SCREEN CANNOT HOVER, AND THESE WERE ONLY REACHABLE BY
         * HOVERING. The wordmark, the bell and the wallet sit at opacity 0
         * with pointer-events: none until :hover or :focus-within — which
         * on a touchscreen laptop means the alert room and the reader's
         * own book have no door at all until something inside the chip
         * takes focus. The query describes the PRIMARY pointer, so a
         * touchscreen with a mouse attached still gets the quiet version.
         * (No backticks in here: this block lives inside a template
         * literal, and one backtick ends the stylesheet.)
         */
        @media (hover: none) {
          /* Scoped to .chip, like every other rule that opens these — and
             unlike the resting rule, which is the bare selector list. Two
             rules with the SAME selector line merge for any scanner that
             reads this stylesheet as text, and chip-frame.spec.ts reads it
             exactly that way to prove the doors rest closed. */
          .chip .pmark, .chip .ring, .chip .wal {
            opacity: 1; max-width: 60px; margin-left: 0; pointer-events: auto;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pmark, .ring, .wal { transition: none; }
          .chip:hover .pmark, .chip:hover .ring, .chip:hover .wal,
          .chip:focus-within .pmark, .chip:focus-within .ring,
          .chip:focus-within .wal { transition-delay: 0ms; }
        }
        /**
         * PRESS AND HOVER COMPOSE, THEY DO NOT FIGHT.
         *
         * button:active with transform scale(.96) is specificity (0,1,1)
         * and .pick:hover with translateY(-1px) is (0,2,0), so
         * the hover owned the transform channel outright and the size
         * picks, the range tabs and the open chevron had NO press state at
         * all on a mouse. Every control on the busiest part of the surface
         * silently ate the finger.
         *
         * Two custom properties fix it structurally rather than by an
         * arms race of selectors: hover writes --lift, press writes
         * --press, and one transform reads both. A control that does both
         * now does both, and nothing has to out-specify anything.
         *
         * The press ARRIVES faster than it LEAVES (rule 7 still holds —
         * one movement, one timing per direction). The release carries the
         * overshoot, which is where a switch stops feeling like a
         * rectangle.
         */
        button {
          border: 0; background: none; cursor: pointer; font: inherit;
          /* 600, not 700. Once the row around them is ink, the two doors
             are the only closed shapes on it, and that is where the
             hierarchy comes from now — bought by subtraction rather than
             by shouting louder than everything else. */
          font-size: 12.5px; font-weight: 600;
          padding: 5px 11px; border-radius: 999px;
          color: ${JUICE.text2}; flex-shrink: 0;
          --lift: 0px;
          --press: 1;
          transform: translateY(var(--lift)) scale(var(--press));
          transition: transform ${JUICE.releaseMs}ms ${JUICE.releaseEase},
                      background-color .15s ease,
                      color .15s ease, box-shadow .15s ease;
        }
        button:active {
          --press: ${JUICE.pressScale};
          transition-duration: ${JUICE.pressMs}ms;
        }
        button:focus-visible { outline: 2px solid rgba(104,198,255,.55); outline-offset: 1px; }
        /* THE ONE BRIGHT OBJECT, and it should look like it can be
           pressed. A flat fill with a glow reads as a label; a lit top
           edge and a dark bottom one read as a KEY, which is what a
           hypercasual surface gets its physicality from. Same two brand
           stops, nothing new in the palette — the depth is in the edges. */
        /* TACTILE, NOT NEON. The last pass pushed the glow up and it
           crossed a line: a wide bright halo reads as gaming UI, and this
           is somebody's money on somebody else's feed. The physicality
           belongs in the EDGES — a lit top, a dark underside — and the
           glow only has to seat the key on the surface. Softer and
           tighter: it should say "tap me", not "casino". */
        /* The one place the interaction layer is allowed to be
           hypercasual: a chunky, obviously-pressable key. Everything else
           on this bar got quieter so that this could get bigger without
           shouting. */
        /* COLOUR BELONGS TO FACTS, NOT TO CONTROLS.

           Fomo's rule, read off their own product: the only filled button
           on their home screen is Deposit, and it is brand blue. Green and
           red never touch a button there. They are what a NUMBER does.

           This row had green meaning two things six pixels apart: "went
           up" on the change pill, and "press here" on the key. Two
           meanings for one hue on one row is why it read as loud without
           reading as clear.

           So the resting row's keys are DOORS and wear the brand. The
           confirm inside the sheet stays green for buy and red for sell,
           because that is the moment direction genuinely is the subject,
           and juice.spec.ts still enforces it there. Same boundary rule 6
           just drew: on X's page we speak carefully, on our own surface we
           speak our language.

           Sell becomes a neutral outline for the same reason. Not quieter
           because selling matters less, quieter because only one thing per
           row can be the primary door. */
        /**
         * FILL MEANS COMMITMENT. HUE MEANS DIRECTION.
         *
         * Replaces the older rule that kept direction colour off these keys
         * entirely. That rule was solving a real problem the wrong way
         * round: it made HUE carry "is this a fact or a control", which is
         * not a thing hue is good at, and it left the one control that
         * moves money wearing a filled brand blue — the same blue as
         * Reddit's Join and X's Follow, on the two surfaces this chip lives
         * on. The key read as a feature of whichever page it landed on.
         *
         * Two channels now, each carrying exactly one meaning. FILL says
         * something has been chosen: nothing on the resting row is filled,
         * because nothing is committed, and the fill arrives with the
         * decision in the sheet. HUE says which way, which is the language
         * every trading surface already speaks and belongs to no host.
         *
         * What the old rule was protecting survives intact: the sheet's
         * confirm still owns the only filled direction on the surface, so
         * it still marks the moment rather than decorating it.
         */
        .buy, .go {
          background: rgba(74,222,128,.10);

          /* X'S BUTTON, OUR PHYSICS. 12/20 padding at 800 weight built a
             44px key under a 15px tweet. X's own Follow and Post buttons
             are ~32px with 14px bold type, and matching them is what makes
             a filled green button read as part of the page rather than as
             an advert dropped into it. The edge and the travel survive the
             shrink; they were never the loud part. */
          color: ${JUICE.buyFillHi}; padding: 7px 15px; font-size: 14px; font-weight: 700;
          /* THE KEY OWNS ITS OWN HEIGHT. "button { font: inherit }" above
             takes the line-height with the font, and nothing in this sheet
             — not :host, not .chip, not button — ever declares one, so it
             came from whichever X container the chip happened to land in:
             the same key measured 31px on one surface and 34px on another,
             which is also why it never matched the 30px .ring and .wal
             sitting beside it. 16 + 7 + 7 = 30px, on every page, which is
             what makes the 4px inset the frame was given a MEASURED number
             rather than a hope. */
          line-height: 16px;
          letter-spacing: -.01em;
          /* A TOP FACE AND A SIDE YOU CAN SEE. The 3px solid under the key
             is its edge, not a shadow: it does not blur, and the key drops
             exactly that far when pressed, so the face lands where the side
             was. Oldest trick in games, one box-shadow. */
          /* The EDGE is the physicality; the glow only seats the key on the
             surface. A wide bright halo is what makes a timeline feel like
             a casino, and this row is passed on every scroll — so the
             bloom is tight and dim, and the fun lives in the travel. */
          /* ONE declaration, because box-shadow does not merge: a second
             one later in the rule replaces the first outright, which is
             how the hairline vanished and a blue edge survived under a
             green key. The edge carries the direction too — it is the
             most visible millimetre of the control. */
          box-shadow: inset 0 0 0 1px rgba(74,222,128,.42),
                      0 2px 0 #148A45,
                      0 4px 10px -7px rgba(74,222,128,.4);
          transform: translateY(0);
          transition: transform .1s ease-out, box-shadow .1s ease-out,
                      filter .15s ease-out;
        }
        /* HOLD TO SEND IT. The sweep is the countdown and the disclosure
           in one: a green fill crossing the key for exactly as long as the
           hold takes to arm. Function never rides the animation — under
           reduced motion the hold still fires, there is simply no sweep. */
        /* The hold sweep crosses the key in the key's OWN colour. It was
           still green after the key went brand, so arming a buy repainted
           it back to the hue this row no longer uses for controls. */
        .buy.holding {
          background-image: linear-gradient(90deg,
            rgba(255,255,255,.42), rgba(255,255,255,.42));
          background-repeat: no-repeat;
          background-size: 0% 100%;
          animation: holdFill ${HOLD_BUY_MS}ms linear forwards;
        }
        @keyframes holdFill {
          from { background-size: 0% 100%; }
          to   { background-size: 100% 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .buy.holding { animation: none; }
        }
        /* Pressed, the key sinks: the lit edge goes and the shadow tucks
           under, so the finger gets the same answer a real switch gives. */
        .buy:active, .go:active {
          transform: translateY(2px);
          /* Pressed: the edge collapses and the key sits down. Green,
             like the edge it is collapsing — this is the state a
             screenshot never shows, which is why the old rule was broken
             here twice. */
          box-shadow: inset 0 0 0 1px rgba(74,222,128,.42),
                      0 0 0 #148A45,
                      0 2px 7px -8px rgba(74,222,128,.35);
        }
        /* SAME BUG THE SELL KEY HAD, and worth naming because it is the
           shape of every colour change in a long stylesheet: this rule
           survived the move to brand, sat later in the cascade, and won.
           Hovering the blue key turned it green. A screenshot cannot catch
           it — only a pointer can — so a colour change is not finished
           when the resting state looks right.

           A filled key does not need a different colour on aim; it needs
           to look lit. */
        /* Brightness on a wash, never a new ground: this is the exact line
           where the old rule was broken twice, because a later rule wins
           the cascade and a screenshot has no pointer. */
        .buy:hover, .go:hover { background: rgba(74,222,128,.16); }
        /* Sell carries its meaning AT REST, quietly. It used to be neutral
           grey until hovered, which made the pair read as one real control
           and one afterthought — and on a row about money the two directions
           deserve equal legibility. Muted red at rest, full red and a tint on
           hover: present, never competing with Buy's fill. */
        /* Buy is the key; Sell is its quieter twin, not an afterthought.
           Beside a button with real edges, bare text read as a link nobody
           had finished. It gets the same seat and the same edges in its own
           colour — still unmistakably the second choice, by weight and by
           ground, but no longer unfinished. */
        /* RED IS FOR INTENT, NOT FOR REST. A red control sitting beside
           Buy competes for the one place the eye should go, and shouts a
           verdict about a trade nobody has asked for yet. It rests in the
           quiet grey every secondary wears and finds its colour the moment
           somebody reaches for it. */
        /* The pair a trader reads without reading: green in, red out. Sell
           carries the RED as text on a quiet ground rather than as a second
           filled key — two shouting buttons on one row is how a bar stops
           having a primary at all. Recognition from the colour, hierarchy
           from the treatment. */
        /* Sell is Buy's equal, in the other direction — same seat, same
           padding, same treatment, one hue apart. */
        /* SAME PHYSICALITY, A TENTH OF THE VOLUME. Sell keeps the tinted
           ground and coloured ink it has always had; what it gains is the
           edge and the travel, so it is obviously a key without being a
           second traffic light. */
        /* Ink and a hairline, no fill. See .buy above for why. */
        .sell {
          color: ${JUICE.sellInk};
          padding: 7px 15px; font-size: 14px; font-weight: 700;
          /* Same seat, same padding, and now the same locked line box —
             see .buy. Declared here rather than as a shared .buy, .sell
             rule on purpose: a third place .sell is written is the exact
             shape theme/no-dead-rules.spec.ts exists to catch. */
          line-height: 16px;
          letter-spacing: -.01em;
          background: rgba(255,122,112,.08);
          /* The edge carries the direction here too: it is the most
             visible millimetre of the control, and a white one under a red
             key reads as a leftover. */
          box-shadow: inset 0 0 0 1px rgba(255,122,112,.34),
                      inset 0 1px 0 rgba(255,255,255,.05),
                      0 2px 0 #A52019;
          transform: translateY(0);
          transition: transform .1s ease-out, box-shadow .1s ease-out,
                      background-color .15s ease-out;
        }
        .sell:hover { background: rgba(255,122,112,.14); }
        .sell:active {
          transform: translateY(2px);
          box-shadow: inset 0 0 0 1px rgba(255,122,112,.34),
                      0 0 0 #A52019,
                      inset 0 1px 0 rgba(255,255,255,.07),
                      inset 0 0 0 1px rgba(255,255,255,.16);
        }
        /* SELL IS ALWAYS THERE. It was briefly hidden when the book said
           you hold nothing, on the argument that a key which can only
           refuse is a dead end. The owner caught what that actually
           teaches: an absent Sell does not read as "you have none of
           this", it reads as "this product cannot sell". A capability the
           reader cannot see is a capability they do not believe in, and
           that costs far more than one quiet key on a row.

           So both directions are always on the row, and the volume does
           the work the hiding was trying to do: Buy is filled, Sell is
           neutral.

           The red :hover and :active that used to live HERE are deleted.
           They survived the colour change and, sitting later in the
           cascade, quietly won: the neutral key turned red again the
           moment a pointer touched it. Invisible in a screenshot, which is
           exactly the class of thing a static render cannot catch — a
           state only a finger reaches. Its replacements are up with the
           rule they belong to. */
        .amt {
          color: ${JUICE.text}; padding: 4px 11px;
          background: ${JUICE.well};
          border: 1px solid ${JUICE.border};
          box-shadow: inset 0 1px 0 ${JUICE.well};
        }
        .amt:hover { border-color: rgba(104,198,255,.55); color: #86D2FF;
                     background: rgba(104,198,255,.08); }
        .amt-input {
          width: 76px; flex-shrink: 1; min-width: 48px;
          border: 1px solid ${JUICE.border}; border-radius: 999px;
          background: ${JUICE.well}; color: ${JUICE.text};
          font: inherit; font-size: 12px; font-weight: 700;
          font-variant-numeric: tabular-nums;
          padding: 4px 10px; box-sizing: border-box; outline: none;
          -moz-appearance: textfield;
        }
        .amt-input:focus { border-color: rgba(104,198,255,.55); }
        .amt-input::-webkit-outer-spin-button,
        .amt-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .quiet { padding: 5px 7px; color: ${JUICE.text3}; }
        .quiet:hover { color: ${JUICE.text}; }
        .note { font-size: 12px; color: ${JUICE.text2}; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis; padding: 0 4px; }
        .note.ok { color: ${GREEN}; font-weight: 700; }
        .note.err { color: ${RED}; }
        .act { color: ${ACCENT}; padding: 5px 8px; }
        .act:hover { background: rgba(104,198,255,.12); }
        .cost { font-size: 11px; font-weight: 600; color: ${JUICE.text3};
                font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cost.warn { color: ${JUICE.amber}; }
        /* The gate's numbers, in the data voice. Amber ONLY for a live
           authority — thin LP and young pools stay neutral: the gate
           enforced the floors, colour here would be a second governor. */
        .safe { font-size: 10.5px; font-weight: 600; color: ${JUICE.text3};
                padding: 0 2px; font-variant-numeric: tabular-nums; }
        .safe.warn { color: ${JUICE.amber}; }
        .thin { font-size: 11px; font-weight: 700; color: ${JUICE.amber};
                background: rgba(245,165,36,.10); padding: 2px 7px;
                border-radius: 999px; white-space: nowrap;
                box-shadow: inset 0 0 0 1px rgba(245,165,36,.16); }
        /* THE DOOR TO THE CHART IS DRAWN, NOT REMEMBERED. Tapping the
           price still works, but nothing about a number says "press me" —
           the chevron does. It turns over while the chart is open, which
           is also the only "close me" a disclosure control needs. */
        /* A DOOR, NOT A DESTINATION. At 22px in text3 it was cutting the
           bar in half and drawing more eye than the price it belongs to.
           Smaller and dimmer: present for anyone looking for it, invisible
           to anyone who is not. */
        /* The points a landed trade earned, on its receipt. QUIET: this
           was a gold pill and it outshone the thing that had just
           happened. Gold now means exactly one thing in the product, and
           it happens once in a lifetime — the seat line below. */
        .pts { font: 600 12px ui-monospace, "SF Mono", Menlo, monospace; color: #8CA3BD; white-space: nowrap; }
        /* THE SEAT, ANNOUNCED ONCE, on the receipt that claimed it. */
        .seat-under { margin: 8px 0 2px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-top: 1px solid rgba(255,214,102,.2); padding-top: 9px; }
        .seat-badge { font: 800 11px ui-monospace, "SF Mono", Menlo, monospace; color: #FFD666; background: rgba(255,214,102,.14); padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
        .seat-rest { color: #8CA3BD; font-size: 12.5px; }
        /* The invite line under the first receipt, and the Holdings row. */
        .invite-under { margin: 8px 0 2px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .invite-line { color: #8CA3BD; font-size: 13px; }
        .invite-line b { color: #EAF2FB; font-weight: 600; }
        .invite-copied { color: #4ADE80; font-size: 13px; font-weight: 700; }
        .invite-code { font: 600 12.5px ui-monospace, "SF Mono", Menlo, monospace; color: #68C6FF; background: rgba(104,198,255,.08); padding: 3px 8px; border-radius: 8px; }
        .invite-copy {
          border: 0; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 13px; line-height: 16px;
          padding: 7px 14px; border-radius: 999px; white-space: nowrap;
          background: rgba(104,198,255,.12); color: #68C6FF; box-shadow: inset 0 0 0 1px rgba(104,198,255,.28);
        }
        .invite-copy:hover { background: rgba(104,198,255,.2); }
        .invite-row { margin-top: 8px; border-top: 1px solid rgba(122,183,255,.12); padding-top: 10px; }
        .invite-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .invite-lbl { font-weight: 700; color: #EAF2FB; font-size: 13.5px; }
        .invite-lbl small { color: #5E6F85; font-weight: 600; font-size: 12px; margin-left: 8px; }
        .invite-open { margin-top: 10px; display: grid; gap: 8px; }
        .invite-rule { color: #8CA3BD; font-size: 12.5px; }
        .invite-linkbox { display: flex; align-items: center; gap: 8px; }
        .invite-linkbox .invite-code { flex: 1; padding: 8px 10px; border-radius: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .invite-stats { font: 600 12.5px ui-monospace, "SF Mono", Menlo, monospace; color: #8CA3BD; }
        /* The alert room: one sentence, one field, one key. */
        .watch-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 4px 0 10px; }
        .watch-q { flex: 1 0 100%; font-size: 14px; font-weight: 700; color: #EAF2FB; letter-spacing: -.01em; }
        .watch-ask .price-box { flex: 1 1 140px; }
        .watch-set {
          border: 0; cursor: pointer; font-family: inherit; font-weight: 800; font-size: 13px; line-height: 1;
          background: #68C6FF; color: #06202E; border-radius: 999px; padding: 11px 18px;
          transition: background .12s, transform .12s;
        }
        .watch-set:hover { background: #8AD4FF; }
        .watch-set:active { transform: translateY(1px) scale(.98); }
        .watch-msg { flex: 1 0 100%; font-size: 12.5px; min-height: 0; }
        .watch-msg.ok { color: #4ADE80; }
        .watch-msg.err { color: #FF7A70; }
        /* The chevron, named, for a reader who has no account yet. */
        .more.labeled { width: auto; padding: 0 9px 0 7px; grid-auto-flow: column; column-gap: 5px; }
        .more-lbl { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: rgba(140,163,189,.95); }
        .more {
          display: grid; place-items: center;
          /* Flat inside the capsule — the .lead wrapper owns the ground
             and the ring now. The 30px stays: sharing a box does not
             shrink a thumb. */
          width: 30px; height: 30px; padding: 0; flex-shrink: 0;
          border-radius: 0 999px 999px 0; color: rgba(116,132,154,.75);
          background: none;
          --turn: 0deg;
          /* The radius is asymmetric now (capsule end), so the SPIN moves
             to the glyph: rotating the button would swing its flat edge
             to the outside of the capsule. */
          transform: scale(var(--press));
          transition: color .15s ease, background-color .15s ease,
                      transform ${JUICE.releaseMs}ms ${JUICE.releaseEase};
        }
        .more svg { width: 9px; height: 5px; display: block;
          transform: rotate(var(--turn));
          transition: transform .18s ease; }
        .more:hover { color: ${JUICE.text}; background: rgba(255,255,255,.07); }
        /* The open state TURNS it; the press SCALES it. Two properties on
           one transform, composed through variables, so opening the chart
           never costs the chevron its press. */
        .chip.charted .more { --turn: 180deg; color: #9FD9FF; }
        /* The tap-the-price chart. Same expansion grammar as the sheet: the
           chip grows, nothing overlays the page. */
        .chart { padding: 8px 10px 9px; display: flex; flex-direction: column;
                 gap: 6px; }
        .chart-head { display: flex; align-items: center; gap: 4px; }
        .ranges { display: flex; gap: 4px; flex: 1; }
        .ranges .pick.on { color: #07070A; background: ${ACCENT}; }
        /* The view switch sits at the end of the timeframe row and reads as
           its quieter neighbour: same height, no fill, no accent. The
           timeframe is the choice a reader makes constantly; how it is
           drawn is one they make once.

           ONE RULE. This was declared twice, a hundred lines apart, and the
           later one won — so the button had no fill, exactly as the comment
           above says, while the code directly under that comment gave it a
           well and a border. The comment was right and dead. Merged here,
           with the behaviour that was actually shipping. */
        .view {
          flex-shrink: 0; padding: 0; border-radius: 999px;
          width: 34px; height: 34px;
          display: grid; place-items: center;
          color: ${JUICE.text3};
          background: none;
          border: 1px solid transparent;
        }
        .view svg { width: 14px; height: 12px; display: block; }
        .view:hover {
          color: ${JUICE.text2};
          background: rgba(255,255,255,.06);
          border-color: transparent;
        }
        .view[hidden] { display: none; }
        /* The plot wraps the svg so the scrub overlays can be positioned in
           PAGE pixels: viewBox units stretch with preserveAspectRatio:none,
           and a circle drawn inside the svg would render as an ellipse. */
        .plot { position: relative; }
        /* No dot lattice. The grid was the single loudest "trading
           terminal" tell on the surface (field, 2026-08-31), and the line
           with its glow carries the shape alone — the landing's chart
           proved a clean dark well reads premium, not empty. */
        .chart-svg { width: 100%; height: 72px; display: block;
                     border-radius: 8px;
                     background: ${JUICE_SCAN}, ${JUICE.well}; }
        .scrub-line {
          position: absolute; top: 0; bottom: 0; width: 1px;
          background: rgba(255,255,255,.22); pointer-events: none;
          display: none;
        }
        .scrub-dot {
          position: absolute; width: 7px; height: 7px; border-radius: 50%;
          transform: translate(-50%, -50%); pointer-events: none;
          box-shadow: 0 0 0 2.5px rgba(22,24,28,.9);
          display: none;
        }
        /* THE READER'S OWN HISTORY, on the line — and OBVIOUS about which
           way the money went.

           This went through a dot first, and the dot failed: it said
           "something happened here" and the reader asked "aldığım yer mi?"
           A mark that needs asking has failed. The answer then was arrows,
           on the reasoning that a shape which POINTS carries direction —
           a buy pointing up at the line from below, a sell down from
           above.

           It is a dot again now, and that is not the failed one coming
           back. The dot that failed had ONE colour and no side at all;
           these are the same green and red as Buy and Sell, three
           surfaces deep by now, so the side is answered before the shape
           is even read. What the arrows were buying was already paid for
           by colour.

           And the shape earns something back. An arrow cannot sit on the
           point it describes — it has to stand 8px off and aim at it, so
           every mark was drawn at a price the reader never traded. A
           circle has no direction to lose, so it sits ON the point: this
           is where your money went in, at this price, at this moment.

           Tokens, not literals. The pair here was #5EC1FF and #FF6B61,
           which is drift — blue never meant "buy" anywhere else on this
           surface. */
        /*
          YOUR FILLS, AS THE WHOLE MARKET DRAWS THEM.
       
          Two dots, one green one red, at nearly the same price minutes
          apart: reported as unreadable, and it was. A circle carries no
          direction, so colour was doing all the work — at eight pixels,
          against a line that is itself green, on a dark plot. Worse, two
          trades close in time landed on top of each other, because both
          sides were anchored the same way.
       
          The convention every terminal shares (TradingView's execution
          markers, which DexScreener and the Solana front ends embed) is an
          ARROW: green pointing up for a buy, red pointing down for a sell,
          aimed at the level. It reads without colour, which is what makes
          it legible at this size.
       
          It also settles the objection that removed arrows from here once
          before: an offset mark "sits at a price the reader never traded".
          True of a shape centred off the level, not of one that POINTS at
          it. THE TIP IS THE TRUTH AND THE BODY IS THE DIRECTION — a buy
          hangs below its price with the tip touching it, a sell hangs
          above. Nothing is drawn at a price nobody traded, and the two
          sides now separate themselves: the pair in that report would sit
          apart, one under the line and one over it, without any nudging.
       
          drop-shadow rather than box-shadow for the dark halo: these are
          border triangles, so their box is 0x0 and a box-shadow would ring
          nothing at all. drop-shadow follows the rendered shape.
        */
        .mark {
          position: absolute; width: 0; height: 0; pointer-events: none;
          border-left: 4.5px solid transparent;
          border-right: 4.5px solid transparent;
          filter: drop-shadow(0 0 1.5px rgba(14,20,32,.95))
                  drop-shadow(0 0 1px rgba(14,20,32,.9));
        }
        /* Tip at the TOP edge of the box, so translate(-50%, 0) puts the
           point exactly on the traded price and the body hangs below. */
        .mark.b {
          border-bottom: 7px solid ${GREEN};
          transform: translate(-50%, 0);
        }
        /* Tip at the BOTTOM edge, so the body hangs above. */
        .mark.s {
          border-top: 7px solid ${RED};
          transform: translate(-50%, -100%);
        }
        /* A standing order is a LEVEL, not a moment: a dashed line across
           the chart at its trigger price, labelled with the real number so
           a level clamped to the edge still tells the truth. */
        .order-level {
          position: absolute; left: 0; right: 0; height: 0;
          border-top: 1px dashed rgba(255,255,255,.35);
          pointer-events: none;
        }
        .order-level.b { border-color: rgba(94,193,255,.55); }
        .order-level.s { border-color: rgba(255,107,97,.55); }
        .order-tag {
          position: absolute; right: 2px; transform: translateY(-50%);
          font-size: 9px; font-weight: 700; letter-spacing: .02em;
          padding: 1px 5px; border-radius: 999px;
          background: rgba(22,24,28,.92); pointer-events: none;
          font-variant-numeric: tabular-nums;
        }
        .order-tag.b { color: #8AD4FF; box-shadow: inset 0 0 0 1px rgba(94,193,255,.4); }
        .order-tag.s { color: #FF8C83; box-shadow: inset 0 0 0 1px rgba(255,107,97,.4); }
        /* YOUR AVERAGE ENTRY is a fact, not a verdict, so it wears neutral
           ink — green and red stay reserved for directions. Tagged on the
           LEFT so it cannot stack under an order tag at a nearby price. */
        .entry-level {
          position: absolute; left: 0; right: 0; height: 0;
          border-top: 1px dashed rgba(255,255,255,.4);
          pointer-events: none;
        }
        .entry-tag {
          position: absolute; left: 2px; transform: translateY(-50%);
          font-size: 9px; font-weight: 700; letter-spacing: .02em;
          padding: 1px 5px; border-radius: 999px; color: ${JUICE.text2};
          background: rgba(22,24,28,.92); pointer-events: none;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.22);
          font-variant-numeric: tabular-nums;
        }
        /* When the reader's finger is on the line, the footer answers with
           the exact moment; at rest it frames the window. */
        /* THE RANGES GO QUIET. Eight outlined wells in a row was a control
           panel; the landing's category pills proved the calmer grammar —
           rest is INK, the chosen one is the single lit pill, hover is a
           whisper of ground. Same buttons, a different weight budget. */
        .ranges .pick {
          flex: 0 0 auto; padding: 6px 10px; font-size: 11.5px;
          background: none; border-color: transparent; color: ${JUICE.text3};
        }
        .ranges .pick:hover {
          background: rgba(255,255,255,.06); color: ${JUICE.text2};
          border-color: transparent; box-shadow: none;
        }
        .ranges .pick[aria-pressed="true"] {
          background: ${JUICE_GRADIENT}; color: ${JUICE.onAccent};
          border-color: transparent;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.3),
                      0 4px 14px -4px rgba(104,198,255,.5);
        }
        .chart-foot {
          display: flex; align-items: baseline; gap: 8px;
          font-size: 10.5px; color: ${JUICE.text3};
          font-variant-numeric: tabular-nums;
        }
        .chart-foot .t0, .chart-foot .t1 { flex-shrink: 0; }
        /* The size of the thing, under the shape of it. Data voice (mono,
           tabular) because it is a number, quiet because the chart above
           is what the reader came for. */
        /* A caption, not a readout: the size of the thing in the product's
           own face. "Sun 23:00" and "now" (t0/t1) left the mono list with
           it — words about time are prose; the price span (.chart-note)
           stays terminal because it IS live data. */
        .chart-cap {
          font-variant-numeric: tabular-nums;
          font-size: 10.5px; font-weight: 600; color: ${JUICE.text3};
          padding: 2px 2px 0;
        }
        .chart-foot .t1 { margin-left: auto; }
        .chart-note { font-size: 10.5px; color: ${JUICE.text3};
                      font-variant-numeric: tabular-nums;
                      white-space: nowrap; overflow: hidden;
                      text-overflow: ellipsis; }
        .chart-note.live { color: ${JUICE.text}; font-weight: 700; }
        /* The way out of a failure. Quiet: it sits in the chart's footer
           beside a sentence, so it reads as the rest of that sentence, not
           as a fourth control competing with the ranges. */
        .chart-retry {
          border: 0; background: none; padding: 0 0 0 2px; cursor: pointer;
          font: inherit; font-weight: 700; color: ${JUICE.accent};
          text-decoration: underline; text-underline-offset: 2px;
        }
        .chart-retry:hover { color: ${JUICE.accentHi}; }
        /* THE RECEIPT. The one moment the product pays off, so it dresses
           up: dollars first, mono, green, popped in. */
        .receipt {
          font-weight: 700; color: ${GREEN};
          animation: okPop .45s cubic-bezier(.2, 1.4, .4, 1);
          white-space: nowrap;
        }
        /* The quiet balance — the reader's face and their number, and a
           door: it opens the panel on their own portfolio. The pfp is the
           ownership claim no label needs; "$4.50" alone read as anything. */
        /* THE AVATAR CAME OUT. At 16px a profile photo is mush — clutter
           rather than identity, and a reader does not need to be told which
           face is theirs. What is left is the two numbers that are actually
           about them, in a container quiet enough to read as an aside
           rather than a second card. */
        /* The portfolio door, dressed exactly like the news door beside it. */
        /* THE SAME BUTTON AS THE BELL, because they are a pair of doors
           and the code has said so since the glyph was drawn ("same stroke
           weight so the pair reads as a set"). When the bell gained a
           ground at rest, this one keeping no background broke that set:
           two adjacent icon buttons, one visible and one not, which reads
           as a rendering bug rather than a hierarchy.

           (No backticks in this file's CSS comments. The stylesheet is a
           template literal, so one closes it and the parse error lands
           hundreds of lines away.) */
        .wal {
          display: grid; place-items: center;
          width: 30px; height: 30px; padding: 0; flex-shrink: 0;
          border-radius: 50%; color: ${JUICE.text2};
          background: rgba(122,183,255,.06);
          box-shadow: inset 0 0 0 1px rgba(122,183,255,.14);
          transition: transform ${JUICE.releaseMs}ms ${JUICE.releaseEase},
                      background-color .15s ease, color .15s ease;
        }
        .wal svg { width: 15px; height: 15px; display: block; }
        .wal:hover { color: ${JUICE.text}; background: rgba(122,183,255,.14); }
        /* THE SAME KEY, WEARING A FACE. No fill behind a photograph: the
           well was there to give a thin glyph a ground, and a face is its
           own ground. The hairline stays, a shade brighter, so the key is
           still a key and the photo still has an edge against a dark
           timeline. object-fit because a profile photo is any aspect ratio
           anyone uploaded, and a squashed face is worse than a cropped one. */
        /* The photo is in the DOM from the moment it is asked for and
           shows only once it has decoded — see the comment at walChip. */
        .wal img { display: none; }
        .wal.me { background: none; overflow: hidden; padding: 0;
                  box-shadow: inset 0 0 0 1px rgba(122,183,255,.34); }
        .wal.me img { width: 100%; height: 100%; display: block;
                      border-radius: 50%; object-fit: cover; }
        .wal.me:hover { background: none;
                        box-shadow: inset 0 0 0 1px rgba(104,198,255,.62); }
        /* The pronoun in the product's own face; only the figure is data. */
        .mine-lbl { font-family: "TwitterChirp", -apple-system, "Segoe UI",
                              Roboto, sans-serif;
                    color: ${JUICE.text3};
                    font-weight: 600; }
        /* The reader's own group sits a shade brighter than the feed so it
           reads as theirs at a glance, before any number is parsed. */
        .wal:empty, .wal[hidden] { display: none; }
      </style>
      <div class="chip">
        <div class="row">
          <span class="lead">
          <button class="face" aria-label="Open $${ticker} in the Poppin sidebar">
            <!-- No title on the disc either: the face's own aria-label
                 already says "the Poppin sidebar", so the brand name was
                 costing a box that opens under a moving pointer to repeat
                 something the control beneath it already says. -->
            <span class="badge"><span class="init">${ticker.charAt(0)}</span><img alt=""></span>
            <!-- SOL, not $SOL. The disc beside it already says which
                 asset this is, so the cashtag was pure financial syntax on
                 a row that is trying not to read as a terminal. The tweet
                 above still carries the $ — that is where it means
                 something. The aria-label keeps it for a screen reader,
                 which has no disc to look at. -->
            <span class="pair">
              <span class="sym">${ticker}</span>
              <span class="px"></span>
            </span>
            <span class="chg"></span>
            <span class="mine" hidden></span>
          </button>
          <button class="more" aria-label="Price chart" aria-expanded="false">
            <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          </span>
          <span class="end"></span>
        </div>
        <div class="callr" hidden></div>
        <div class="why" hidden><span class="ai">AI</span><span class="because"></span></div>
      </div>`

    if (match.reason) {
      const why = shadow.querySelector<HTMLElement>(".why")!
      why.querySelector<HTMLElement>(".because")!.textContent = match.reason
      why.hidden = false
    }

    const px = shadow.querySelector<HTMLElement>(".px")!
    const chg = shadow.querySelector<HTMLElement>(".chg")!
    const mineEl = shadow.querySelector<HTMLElement>(".mine")!

    /**
     * THE POSITION LIVES WHERE THE READER SCROLLS. The panel has always
     * known what you hold; the feed never told you, so meeting your own
     * asset felt like meeting a stranger's. The face now wears your stake:
     * "You +8.2%" once a basis exists, "You $12.40" while it is unknowable
     * (which is NOT zero and is never printed as a percentage of it).
     *
     * Network discipline holds: this reads the SAME one-per-page book the
     * sheet reads — a signed-out reader costs nothing new and shows
     * nothing. The percentage re-prices on every live tick, because a
     * position badge frozen at mount time is wrong within a minute.
     */
    let myUi = 0
    let myAvgEntry: number | null = null
    /** Only the FIRST paint after a mount may animate; ticks just repaint. */
    let mineGreeted = false
    const paintMine = () => {
      if (!(myUi > 0) || lastUsd === null) {
        mineEl.hidden = true
        // Nothing held: the day's move carries the face again.
        chg.hidden = lastChange === null
        return
      }
      /**
       * ONE PERCENTAGE ON THE FACE. The market's day and the reader's own
       * position were two signed, coloured, tabular percentages six pixels
       * apart — the ticker-tape adjacency this file already fought once
       * over the price's colour. When the reader HOLDS this asset their own
       * number wins (it is why they stopped scrolling); the day's move is
       * one tap away in the chart, which already has it.
       */
      chg.hidden = true
      const value = myUi * lastUsd
      /**
       * THE HONEST BASIS, in order of honesty. The average-cost entry
       * price is immune to partial sells (net-invested shrinks by
       * PROCEEDS, so one profitable trim inflated the old percentage and
       * a round trip sent it past infinity); when the ledger can compute
       * it, the badge is price-now vs price-paid and nothing else. The
       * net-invested figure stays only as the fallback for rows that
       * predate quantities, and the bare dollar value catches the rest.
       */
      /**
       * NO FALLBACK FORMULA. This used to drop to
       * (value − netInvested) / netInvested when the walk could not price
       * the position — the EXACT arithmetic deleted from this badge for
       * being wrong: net-invested shrinks by PROCEEDS, so one profitable
       * trim inflates it and a round trip sends it past infinity. Keeping
       * it "as a fallback" meant every reader whose ledger has one
       * unpriceable row (a pre-quantity trade, a settle that never landed)
       * silently got the wrong percentage — reported as "pnl mini yanlış
       * gösteriyor".
       *
       * Null over guess, the same rule the rest of the surface keeps: with
       * no honest basis the badge says what the holding is WORTH, which is
       * true in every case and is never a percentage of a number we made
       * up.
       */
      const hasBasis =
        myAvgEntry !== null && Number.isFinite(myAvgEntry) && myAvgEntry > 0
      const figure = hasBasis
        ? ((lastUsd - myAvgEntry!) / myAvgEntry!) * 100
        : value
      /**
       * THE PRONOUN IS PROSE, THE FIGURE IS DATA. "You" was set in
       * monospace along with the number — a terminal reading a sentence,
       * on the most personal string on the row. The label is a sibling in
       * the product's own face now; only the figure keeps the mono (and
       * the counter animates the figure, which is all it ever needed to).
       */
      const fmt = (v: number) =>
        hasBasis ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : `$${v.toFixed(2)}`

      if (hasBasis) {
        const shown = Number(figure.toFixed(1))
        mineEl.classList.toggle("up", shown >= 0)
        mineEl.classList.toggle("down", shown < 0)
      } else {
        mineEl.classList.remove("up", "down")
      }

      /**
       * THE HOMECOMING, and it happens at most once per mount. A remembered
       * figure that differs is counted to; anything else is written
       * straight. Ticks after the greeting repaint without motion, because
       * the badge already moves on its own every three seconds and two
       * animations describing one change is rule 7's exact complaint.
       */
      const seen = lastMineShown.get(row.mint)
      // Label + figure, two nodes: the counter owns only the figure.
      mineEl.replaceChildren()
      const mineLbl = document.createElement("span")
      mineLbl.className = "mine-lbl"
      mineLbl.textContent = "You "
      const mineN = document.createElement("span")
      mineN.className = "mine-n"
      mineEl.append(mineLbl, mineN)
      if (!mineGreeted && seen !== undefined && Math.abs(seen - figure) > 1e-9) {
        countTo(mineN, seen, figure, fmt)
      } else {
        mineN.textContent = fmt(figure)
      }
      mineGreeted = true
      lastMineShown.set(row.mint, figure)
      deps.mineSeen?.write(row.mint, figure)
      /**
       * AND NO `title` HERE — this pill is where the reported strobe
       * actually lived, not merely another tooltip.
       *
       * Everything above runs on EVERY price tick: the `replaceChildren`
       * above destroys and rebuilds whatever the pointer is resting on,
       * and a `title` written beside it was reassigned just as often. A
       * native tooltip closes and re-opens when its title is reassigned,
       * so a holder who simply STOPPED here — no movement at all — watched
       * a box blink on the price feed's cadence. See mountStrip's header
       * for the rule this belongs to; "You hold 1,234 WIF · avg entry
       * $2.00" now lives where it can be read without a dwell, on the
       * position card this pill's own button opens.
       */
      mineEl.hidden = false
    }
    /**
     * THE FACES. Read from the page-wide answer the host resolved once, so
     * this costs no request of its own.
     *
     * Deduplicated by person, not by trade: somebody who bought a mint
     * three times this week is one face, and without the dedupe a single
     * active follow would fill the whole stack with itself.
     */

    /**
     * WHAT THIS AUTHOR HAS DRIVEN. Hidden unless the board actually ranks
     * them, which means the N>=3 floor has already been applied server-side
     * — the row never has to decide whether a number is too small to be an
     * aggregate.
     */
    /* The handle out of the permalink, the SAME capture the backend groups
       callers by (social-trades.controller: ^https://(x|twitter).com/<h>/status).
       Reading it here rather than threading a new field keeps the two ends
       agreeing on what "the author" means by construction. */
    const authorHandle =
      /^https:\/\/(?:x|twitter)\.com\/([^/?#]+)\/status/i.exec(tweetUrl)?.[1] ?? null
    void Promise.resolve(
      authorHandle ? deps.callerFor?.(authorHandle.toLowerCase()) : null,
    ).then((c) => {
      if (!host.isConnected || !c || c.buyers < 3) return
      const el = shadow.querySelector<HTMLElement>(".callr")
      if (!el) return
      el.replaceChildren()
      const n = document.createElement("b")
      n.textContent = String(c.buyers)
      el.append(
        document.createTextNode("\u2691 "),
        n,
        document.createTextNode(
          ` ${c.buyers === 1 ? "reader has" : "readers have"} bought from @${authorHandle}'s calls`,
        ),
      )
      el.hidden = false
    })

    const refreshMine = () => {
      void book().then((b) => {
        if (!host.isConnected) return
        const pos = b?.positions.find((p) => p.mint === row.mint) ?? null
        myUi = pos?.uiAmount ?? 0
        myAvgEntry = pos?.avgEntryPriceUsd ?? null
        paintMine()
      })
    }
    refreshMine()

    /**
     * ONE CLOCK. The price lives white and stays white.
     *
     * It used to take the direction of THIS print for 900ms while the
     * badge beside it carried the last 24 HOURS, which is two clocks
     * describing one asset six pixels apart. Photographed in the field as
     * a red $0.3164 next to a green +24.8%, and a reader has no way to
     * know those are different questions.
     *
     * The pulse stays. A print is an event worth noticing; which way it
     * went is the badge's job and only the badge's.
     */
    let lastUsd: number | null = null
    const paintMarket = (usd: number | null, changePct: number | null, flash: boolean) => {
      if (usd !== null) {
        // Four significant figures, fixed within a magnitude — see
        // helpers/priceText for why six decimals was a wall.
        px.textContent = priceText(usd)
        if (flash && lastUsd !== null && usd !== lastUsd) {
          // Restartable pulse: yank the class, force a style flush, re-add.
          px.classList.remove("flash")
          void px.offsetWidth
          px.classList.add("flash")
        }
        lastUsd = usd
      }
      paintMine()
      if (changePct !== null) {
        /* Round FIRST, then decide the sign and the colour from the rounded
           number. Going the other way, a change of -0.04 printed "-0.0%" in
           red: a minus sign attached to nothing, wearing a verdict. Flat is
           green, matching the pill's rule that red means an actual decline. */
        const shown = Number(changePct.toFixed(1))
        const up = shown >= 0
        /* The mark, not a plus sign: a triangle reads as direction before
           it is read as a character, which is the whole job of this figure
           on a row somebody is scrolling past. */
        chg.textContent = `${shown > 0 ? "\u25B2" : shown < 0 ? "\u25BC" : ""} ${Math.abs(shown).toFixed(1)}%`
        chg.classList.toggle("up", up)
        chg.classList.toggle("down", !up)
      }
    }

    let lastChange: number | null = null
    /**
     * ENRICHMENT IS ALSO THE PERMISSION SLIP.
     *
     * by-mint answers null for any mint §7 will not admit, and that verdict is
     * TIME-VARYING: five rows the generator had just confirmed came back
     * refused minutes later, because liquidity moves, pools age, and an
     * unreadable upstream is correctly reported as a failure rather than
     * guessed at. A build-time list therefore cannot be trusted at runtime —
     * it is a NAMING aid, and this call is the truth.
     *
     * So a chip that cannot be described removes itself. Better a strip that
     * never appears than one that appears, takes an amount, takes a confirm,
     * and only then admits the asset was never on offer.
     */
    void enrich(row.mint).then((m) => {
      if (!host.isConnected) return
      if (!m) {
        // The chip deletes its own host and the cell's mark stays put, so
        // this tweet is simply done: enrichment is the permission slip, and
        // a refused mint must not be re-asked on every mutation of the
        // tweet that mentions it.
        host.remove()
        return
      }
      lastChange = m.change24hPct
      paintMarket(m.indicativeUsd, m.change24hPct, false)
      const img = shadow.querySelector<HTMLImageElement>(".badge img")
      const init = shadow.querySelector<HTMLElement>(".badge .init")
      if (!m.icon) {
        // The asset has no icon to fetch — the feed answered without one.
        // Said out loud because the initial disc looks identical whether
        // the picture was missing or the fetch failed, and a reader
        // reporting "the token image is gone" cannot tell us which.
        //
        // It is no longer a REASON TO GIVE UP, which it used to be: the
        // gate below wanted m.icon before it would try anything, so an
        // enrich that answered without a URL left the letter disc up even
        // though our own endpoint — keyed by MINT, not by that URL — had
        // the picture all along. Measured on USELESS: the upstream is an
        // ipfs.io link that answers 429 from here, while
        // /embed/asset/icon?mint=… returns the real 224px logo in 0.2s.
        dbg(`no icon url for ${row.mint} (${ticker})`)
      }
      if (img) {
        // Through the background, as a data URI — a direct src here is
        // loaded under the HOST PAGE's CSP, and x.com blocks every icon
        // CDN. The initial disc stays until real pixels have decoded.
        //
        // OUR ORIGIN FIRST, the gateway only as the fallback. Three rounds
        // of client-side fixes (logging, an IPFS retry, a gateway ladder)
        // and the discs stayed blank in the field while every rung
        // measured healthy from our side — because all three still asked
        // the READER'S network to reach an IPFS gateway, and an ISP that
        // blocks one is not something a retry can vote down. The backend
        // now fetches and caches the bytes on a network we can observe,
        // and api.poppin.so is the one origin the chip already cannot
        // live without.
        const ours = `${process.env.NEXT_PUBLIC_API_URL}/embed/asset/icon?mint=${row.mint}`
        /**
         * ONE ASK, ONE RETRY, and the retry is the point.
         *
         * This runs once per mount, and a chip does not re-mount while the
         * reader is looking at it. So a single failed fetch — a service
         * worker cold off idle, a blip, a gateway refusing once — left the
         * letter disc up for the whole life of that chip while every other
         * token on the page showed its logo. That is exactly the shape the
         * field reports take ("bu tokenın görseli gelmiyor"), and the cache
         * below already knows a failure is not an absence: iconViaBackground
         * drops a null so the NEXT mount asks again. There was simply no
         * next mount.
         *
         * Our own endpoint answers in ~0.2s, so a second ask a second later
         * costs nothing and is invisible when the first one worked.
         */
        const askIcon = (): Promise<string | null> =>
          iconViaBackground(ours).then(
            (uri) => uri ?? (m.icon ? iconViaBackground(m.icon) : null),
          )
        void askIcon()
          .then(
            (uri) =>
              uri ??
              new Promise<string | null>((r) => {
                setTimeout(() => r(askIcon()), 1000)
              }),
          )
          .then((uri) => {
          if (!uri) {
            dbg(`icon fetch failed for ${ticker}: ${m.icon}`)
            return
          }
          if (!img.parentElement) return
          img.onload = () => {
            img.style.opacity = "1"
            if (init) init.style.display = "none"
          }
          // The third silent death, and the one the two debug lines above
          // cannot see: the bridge answers a well-formed data: URI whose
          // bytes the browser then refuses to DECODE. src is set, onload
          // never fires, the disc stays — with no log at all, which was
          // precisely the gap the logging was added to close.
          img.onerror = () => {
            dbg(`icon failed to decode for ${ticker}: ${m.icon}`)
          }
          img.src = uri
        })
      }
    })

    // The live wire: this mint's ticks reach every strip that shows it. The
    // updater self-prunes when its host leaves the DOM (recycling).
    /** An open sheet's re-judge, registered by showSheet: '+10.3% vs now'
     *  must judge against NOW, not the price at the last keystroke - on
     *  the memecoin tail, 'now' drifts double digits in minutes. */
    let sheetTick: (() => void) | null = null
    /**
     * WHO OWNS THE SHEET'S MESSAGE LINE RIGHT NOW.
     *
     * The same symptom twice, from two different causes. The first time,
     * "buy'a basıyorum hiçbir şey olmuyor" was a message written into a
     * row that shipped hidden; that was fixed by making one helper own the
     * text and the visibility together (see `say`).
     *
     * This is the second cause. `verdict()` re-renders the sheet on EVERY
     * price tick and ends with `msg.textContent = v.note ?? ""`, so any
     * outcome the reporter wrote there — "Buying…", or the error explaining
     * why it stopped — was erased by the next tick. On a quiet token you
     * read it; on a busy one it was gone before you looked, which is
     * exactly the reported "bazen".
     *
     * So the line is claimed while an action owns it, and the tick leaves
     * it alone until the reader states a new intent.
     */
    let msgClaimed = false
    const onTick = (usd: number, changePct: number | null) => {
      if (!host.isConnected) return
      if (changePct !== null) lastChange = changePct
      paintMarket(usd, changePct ?? lastChange, true)
      sheetTick?.()
    }
    let targets = tickTargets.get(row.mint)
    if (!targets) {
      targets = new Set()
      tickTargets.set(row.mint, targets)
    }
    targets.add({ host, fn: onTick })
    if (!watched.has(row.mint)) {
      watched.add(row.mint)
      deps.watchPrice(row.mint)
    }

    shadow.querySelector(".face")?.addEventListener("click", () => {
      if (halt()) return
      track("x_strip_open_panel", { mint: row.mint, tier })
      deps.openPanel(row.mint, tweetUrl)
    })

    /**
     * THE PRICE IS A DOOR TO ITS OWN HISTORY.
     *
     * Tapping the number or the 24h chip expands a chart under the pill —
     * 1H · 4H · 1D · 1W — instead of opening the panel like the rest of the
     * face. A price with a shape answers the question the % alone raises
     * ("up from where?") without anybody leaving the feed. Capture-phase +
     * stopPropagation so the face's panel handler never fires for these two
     * spans; everything else on the face keeps its old meaning.
     */
    const toggleChart = () => {
      if (!deps.series) return
      if (halt()) return
      if (shadow.querySelector(".chart")) closeChart()
      else {
        track("x_strip_chart", { mint: row.mint, tier })
        showChart("1d")
      }
    }
    for (const el of [px, chg]) {
      el.addEventListener(
        "click",
        (e) => {
          e.stopPropagation()
          toggleChart()
        },
        true,
      )
      el.style.cursor = "pointer"
    }
    /**
     * The DRAWN door to the same place. A price that happens to be
     * pressable is a secret; the chevron is the disclosure control every
     * reader already knows, and it flips while the chart is open. Hidden
     * entirely when this build has no series to show — a door to nowhere
     * is worse than no door.
     */
    const more = shadow.querySelector<HTMLButtonElement>(".more")!
    if (deps.series) more.addEventListener("click", toggleChart)
    else more.style.display = "none"

    /** The pill's tail is the buy flow's screen. */
    const end = shadow.querySelector<HTMLElement>(".end")!
    /** The whole object, which the order sheet opens. */
    const chip = shadow.querySelector<HTMLElement>(".chip")!
    if (lightPage) chip.classList.add("on-light")
    /** Swap the tail with a breath instead of a blink. */
    /**
     * THE MONEY, WHICH IS THE USDC. This used to be
     * max(cashUsd, solUsd) — the larger of your cash and your SOL — on the
     * theory that a buy could fall back to SOL. The server never did that:
     * swapInner pre-flights the USDC balance and refuses with "Insufficient
     * USDC". So a reader holding $50 of SOL and $2 of cash was shown $50 on
     * the scoreboard and refused at every Buy above $2.
     */
    let walUsd: number | null = null
    /**
     * ADDING MONEY WITHOUT LEAVING THE TWEET.
     *
     * Asked for as "buraya basınca direk deposit ettirebilir miyiz, sidebar
     * açmadan?", with Blink suggested as the way. Blink cannot be the way
     * HERE, and it is X's decision rather than ours: x.com serves
     *
     *   frame-src 'self' accounts.google.com appleid.apple.com youtube.com
     *   w.soundcloud.com pscp.tv studio.x.com iframe.arkoselabs.com
     *   *.x.com *.crbcos.com *.plaid.com *.stripe.com getpinwheel.com
     *   checkoutshopper-live.adyen.com artifacts.grokusercontent.com
     *
     * (read live 2026-08-27). No blink domain on it, and an iframe injected
     * by a content script answers to the PAGE's policy, so their hosted
     * flow is blocked on X no matter what we register. Blink stays what it
     * already is: the panel's rail, and app.poppin.so/fund.
     *
     * The rail that DOES work here needs no iframe at all — the wallet
     * already injected on x.com. topUp() asks our backend to build a USDC
     * transfer into the reader's own custodial account and has that wallet
     * sign it. It is the same rail the sheet's "Add funds" has been using;
     * all this adds is a door to it from the balance.
     *
     * PRESS, NOT HOVER. Hover was the suggestion and a scrolling timeline
     * is the wrong place for it: a panel that opens because the cursor
     * crossed a row opens constantly while somebody is reading, and this
     * one is about money. A press is a decision.
     *
     * IT GROWS, IT DOES NOT OVERLAY. Same grammar as the sheet and the
     * chart, which is also why there is no positioning code here and no
     * iframe for X to have an opinion about.
     */
    const showFund = (back?: () => void) => {
      closeChart()
      closeSheet()
      chip.classList.add("open")
      renderEnd(btn("quiet", "×", showIdle))

      const panel = document.createElement("div")
      panel.className = "sheet fund"
      // Back goes where the reader came FROM, which is the scoreboard when
      // they came through it and the row when they did not. A back arrow
      // that always means the same destination is a close button wearing
      // the wrong glyph.
      panel.appendChild(btn("back", "‹ Back", back ?? showIdle))

      /**
       * THE SCREEN SAYS WHAT IT IS. It opened straight into three amounts
       * under a 12px grey sentence — no title, so the loudest thing on a
       * money screen was a caption. "Add money" is the whole heading, in
       * the size a heading gets.
       */
      const title = document.createElement("div")
      title.className = "fund-title"
      /* THE DOOR AND THE ROOM AGREE. The button that opens this screen
         says "Deposit USDC" and the line under this title says "Deposit
         USDC"; the heading between them said "Add money", which is the
         one place on the path that does not name the currency — on a
         product whose whole point is that the currency is never a
         question. A heading that is vaguer than the button that reached
         it makes the reader wonder whether they arrived somewhere else. */
      title.textContent = ARC_EDITION ? "Add money" : "Deposit USDC"
      panel.appendChild(title)

      const note = document.createElement("div")
      note.className = "fund-note"
      // Says nothing it has not confirmed yet. The probe answers in a tick
      // and the line is rewritten then; until it does, the neutral sentence
      // is true in both worlds.
      // The title names the act; this says where it lands. Repeating
      // "Deposit USDC" here would spend the only two lines on one fact.
      note.textContent = "Straight to your Poppin balance."
      panel.appendChild(note)

      const picks = document.createElement("div")
      picks.className = "picks"
      const fund = (usd: number) => {
        if (halt()) return
        track("x_fund_press", { mint: row.mint, usd, tier })
        // "exact": the reader pressed "$50" and the wallet is asked for
        // 50, not the shortfall rounding that serves the trade sheet.
        void Promise.resolve(deps.topUp?.(usd, "exact")).then((funded) => {
          if (!host.isConnected) return
          if (funded) {
            /**
             * THE CACHE DIES BEFORE THE PAINT. The scoreboard that opened
             * this screen primed the 20s book TTL seconds ago, so without
             * this line refreshWal() and the return paint both served the
             * PRE-deposit number to the one reader who just moved money.
             */
            bookOnce = null
            refreshWal()
            // Back to the screen the reader funded FROM. Landing on the
            // resting row instead meant the one person who just moved
            // money never saw it arrive — the scoreboard is where the
            // new balance shows, and it is the only door to this box.
            ;(back ?? showIdle)()
          }
          // A false means topUp already did the honest thing it could —
          // opened the panel's funding screen. Nothing to add here, and
          // nothing to close: the reader is looking at another surface.
        })
      }
      for (const usd of FUND_USD) {
        picks.appendChild(btn("pick", `$${usd}`, () => fund(usd)))
      }
      panel.appendChild(picks)

      /**
       * SEND IT YOURSELF, FROM ANYWHERE.
       *
       * The route that works for everybody, including a reader with no
       * wallet on this page and no card they want to use. It is the reason
       * the answer to "Twitter'dan hiç çıkmadan yapamıyor muyuz" is yes:
       * an address is text, and X's frame policy has no opinion about
       * text. Hidden until it arrives, so a slow or refused answer leaves
       * a smaller box rather than an empty promise.
       */
      const addr = document.createElement("button")
      addr.className = "fund-addr"
      addr.hidden = true
      panel.appendChild(addr)
      void Promise.resolve(deps.myAddress?.()).then((a) => {
        if (!addr.isConnected || !a) return
        // THE ADDRESS IS THE SENTENCE. "Or send USDC on Solana to" was a
        // line of instructions in front of the only thing anybody needs,
        // and an address beside the word Copy explains itself. The chain
        // and the token live in the tooltip, where a reader who is unsure
        // can find them without everybody else reading them every time.
        // A 0x address keeps "0x" and four more, or every Arc wallet reads "0x12…".
        const short = ARC_EDITION ? shortAddress(a) : `${a.slice(0, 4)}…${a.slice(-4)}`
        /**
         * THE TWO FACTS THAT DECIDE WHETHER THE MONEY ARRIVES — which
         * token, which chain — used to live ONLY in a title attribute.
         * Send USDC on the wrong chain and it is gone; a tooltip is not
         * where you put the one instruction that cannot be got wrong.
         * They lead the row now, and the address follows them.
         */
        const lbl = document.createElement("span")
        lbl.className = "fund-addr-lbl"
        // A deposit row is where the network must be named, in both
        // editions: a bare 0x address reads as "any EVM chain", and most
        // exchange withdrawals default to Ethereum or Base, where this
        // address would not be the reader's balance.
        lbl.textContent = `Send USDC on ${CHAIN.networkName} to`
        const mono = document.createElement("span")
        mono.className = "fund-addr-key"
        mono.textContent = short
        const copy = document.createElement("span")
        copy.className = "fund-addr-copy"
        copy.textContent = "Copy"
        addr.append(lbl, mono, copy)
        // The tooltip repeats the network where the whole address is, so a
        // reader copying it by hand still reads which chain it is for.
        addr.title = ARC_EDITION
          ? `${a}\nYour own Poppin address, for USDC on ${CHAIN.networkName}.`
          : `${a}\nYour own Poppin address.`
        addr.hidden = false
        addr.addEventListener("click", () => {
          if (halt()) return
          track("x_fund_copy_address", { mint: row.mint, tier })
          void navigator.clipboard
            ?.writeText(a)
            .then(() => {
              if (!copy.isConnected) return
              copy.textContent = "Copied"
              // The scariest normie moment is "did my money arrive?", and
              // the product already answers it with a deposit ping - the
              // screen just never said so. The note is a live element that
              // rewrites itself; this is its one positive promise.
              // Only where the deposit watcher runs: the Arc edition turns
              // it on with NEXT_PUBLIC_ARC_DEPOSIT_WATCH, and until then
              // nothing would send that ping.
              if (CAP.depositWatch) note.textContent = "You'll get a ping when it lands."
              // Says it once and goes back to offering. A label stuck on
              // "Copied" stops being feedback and becomes the button's name.
              setTimeout(() => {
                if (copy.isConnected) copy.textContent = "Copy"
              }, 1400)
            })
            .catch(() => {
              if (copy.isConnected) copy.textContent = "Press ⌘C"
            })
        })
      })

      panel.appendChild(
        btn("fund-home", "Open Poppin", () => {
          if (halt()) return
          track("x_strip_open_home", { mint: row.mint, tier })
          deps.openHome?.()
        }),
      )
      chip.appendChild(panel)

      /**
       * The truth about where the money comes from, once it is known. A
       * reader with a wallet on the page stays on the page; a reader
       * without one is told the press opens Poppin BEFORE they press it,
       * rather than discovering it when a sidebar appears.
       */
      void Promise.resolve(deps.canFundHere?.()).then((here) => {
        if (!note.isConnected) return
        if (here === true) {
          note.textContent = "Paid from the wallet on this page. You stay here."
        } else if (here === false) {
          note.textContent = ARC_EDITION ? "Opens Poppin to add money." : "Adding funds opens Poppin."
        }
      })
    }
    /**
     * ONE VISUAL LANGUAGE FOR EVERY ACTIVITY ROW: a small tinted disc with
     * a stroked glyph, then the sentence, then the age. The first pass
     * rendered notifications as bare grey text next to fired alerts
     * wearing an emoji — two dialects on one list, and the reader called
     * the quiet one invisible ("çok silik duruyor"). The glyphs themselves
     * live in notificationText with the words, so the side panel and the
     * card wear the exact same discs.
     */
    const NOTE_GLYPHS: Record<string, string> = NOTIFICATION_GLYPHS
    /**
     * A COIN'S FACE, for any row about an asset. Same recipe and same
     * ours-origin road the book's rows and the chip's own badge take, so
     * one coin looks like itself everywhere on this surface.
     */
    /**
     * ONE TICKER LANGUAGE ON THIS SURFACE.
     *
     * The holdings list read "$WIF" beside "SOL", "RAY" and "ORE" in the
     * same column, because the sigil is the server's and some rows carry
     * it. The chip's own pill says NVDA and the fills row already stripped
     * it, so bare is what this surface speaks; holdings was the one place
     * that had not been told.
     */
    const bareTicker = (t: string) => t.replace(/^\$/, "")

    const coinDisc = (mint: string, ticker: string) => {
      const disc = document.createElement("span")
      disc.className = "you-ico"
      const init = document.createElement("span")
      init.className = "you-ico-init"
      init.textContent = ticker.replace(/^\$/, "").charAt(0)
      const img = document.createElement("img")
      img.alt = ""
      disc.append(init, img)
      void iconViaBackground(
        `${process.env.NEXT_PUBLIC_API_URL}/embed/asset/icon?mint=${mint}`,
      ).then((uri) => {
        if (!uri || !img.isConnected) return
        img.src = uri
        img.style.opacity = "1"
        init.style.opacity = "0"
      })
      return disc
    }

    /**
     * A PERSON'S FACE, with the kind still legible. The photo fills the
     * disc and the kind's glyph rides its corner — losing the glyph would
     * trade one ambiguity (who) for another (what they did).
     */
    const actorDisc = (url: string, glyph: string) => {
      const wrap = document.createElement("span")
      wrap.className = "you-actor"
      const img = avatarImg(url)
      const badge = document.createElement("span")
      badge.className = "you-actor-badge"
      badge.innerHTML = glyph
      wrap.append(img, badge)
      return wrap
    }

    /** The shared row-leading disc. `tone` picks the tint. */
    const actIcon = (svg: string, tone: "accent" | "up" | "down") => {
      const d = document.createElement("span")
      d.className = `act-ico act-${tone}`
      d.innerHTML = svg
      return d
    }

    /** "2m", "3h", "5d" — a notification's age, at feed precision. */
    const ago = (iso: string): string => {
      const ms = Date.now() - Date.parse(iso)
      if (!Number.isFinite(ms) || ms < 0) return ""
      const m = Math.floor(ms / 60_000)
      if (m < 60) return `${m}m`
      const h = Math.floor(m / 60)
      if (h < 24) return `${h}h`
      return `${Math.floor(h / 24)}d`
    }

    /**
     * THE SCOREBOARD. One number the size it deserves, then what you own.
     *
     * Asked for as "posisyonlarım, tuttuğum assetler, open orders sekmesi,
     * belirgin bir geri tuşu ve baya belirgin bir UPNL" — and then, on how
     * to draw a holding, "hangi tokendan kaç tane var ve kaç usd ediyor".
     *
     * The headline and every holding arrive on the ONE positions read the
     * chip already makes: the server priced those rows, and the adapter
     * that used to drop the prices on the floor no longer does. The Orders
     * tab is the deliberate exception — it reads /orders fresh on each
     * open and again after a cancel, because a stale order list under a
     * Cancel button is an invitation to cancel something that already
     * filled.
     *
     * Louder than the resting row on purpose. The row lives in a timeline
     * whether or not anybody wants it; this exists because somebody
     * pressed for it, which buys it the biggest type on the surface.
     */
    /**
     * TWO DOORS INTO ONE ROOM. The wallet pill opens the scoreboard
     * (Holdings, Orders, Activity) with the money hero on top. The bell
     * opens the same panel as the ALERT ROOM: no hero, no wallet furniture,
     * a price field first and Activity one tab away. Measured 2026-09-17:
     * 121 readers saw a chip in 30 days and 3 touched one; the first tuş
     * on the chip was a money button and the bell led to an empty list.
     * Now the bell leads to the product's cheapest promise, for everyone,
     * signed in or not.
     */
    const showYou = (initialTab?: YouTab, via: "wallet" | "bell" = "wallet") => {
      closeChart()
      closeSheet()
      chip.classList.add("open")
      renderEnd(btn("quiet", "×", showIdle))

      const panel = document.createElement("div")
      panel.className = "sheet you"

      // BACK, AND IT LOOKS LIKE BACK. The tail × closes the chip entirely;
      // this returns to the row. Two different exits, so they are drawn as
      // two different things rather than one control the reader has to
      // guess the meaning of.
      panel.appendChild(btn("back", "‹ Back", showIdle))

      const head = document.createElement("div")
      head.className = "you-head"
      const big = document.createElement("div")
      big.className = "you-pnl"
      const cap = document.createElement("div")
      cap.className = "you-cap"
      /**
       * THE CASH, always. The resting row shows the balance only when it
       * cannot cover a press, which is right for a timeline — but this
       * panel exists because somebody asked about their own money, and
       * answering "how am I doing" without "what do I have to spend" is
       * half an answer. One currency, named, same word as the deposit
       * button two rows down.
       */
      const cash = document.createElement("div")
      cash.className = "you-cash"
      /**
       * WHERE YOU STAND, next to how you are doing.
       *
       * The rank does NOT go on the resting row: your place is the same
       * number under every tweet, and a figure that never varies with what
       * it sits beside is wallpaper. Here it is answering a question the
       * reader just asked by opening this panel.
       *
       * Absent stays absent — an unranked reader (no points yet, or a read
       * that failed) gets nothing rather than "#—", which reads as a rank
       * of nothing rather than as no answer.
       */
      const rank = document.createElement("div")
      rank.className = "you-rank"
      rank.hidden = true
      /**
       * WHOSE ROOM THIS IS, and the door to the rest of it.
       *
       * This header was built once as a number, a caption, the cash and a
       * rank — and nothing in the ~1100 lines below ever added to it. So
       * the reader's own room opened with no name and no face anywhere on
       * it, which is a strange thing for the surface a person reaches by
       * pressing their own key.
       *
       * The row answers both halves in one object: the face says it is
       * yours, the handle names you, and the press opens your profile in
       * the panel — the page with the vitrine, the ledger and the invite
       * on it, which is the part of "you" this small sheet cannot hold.
       *
       * /profile/<id> rather than /profile: openPanelRoom's allowlist
       * already admits the first and not the second, and the panel resolves
       * an id that matches the reader to their own page anyway. So this
       * needed no new permission, which is the point — a door that needs a
       * widened allowlist is a door worth questioning.
       *
       * Hidden until the answer lands, and it stays hidden when the answer
       * is null. A signed-out reader gets the room exactly as it was.
       */
      const who = document.createElement("button")
      who.className = "you-who"
      who.hidden = true
      head.append(who, big, cap, cash, rank)
      panel.appendChild(head)
      void Promise.resolve(deps.me?.()).then((m) => {
        if (!m || !host.isConnected || !deps.openRoom) return
        if (m.photoUrl) {
          const av = document.createElement("span")
          av.className = "you-who-av"
          av.appendChild(avatarImg(m.photoUrl))
          who.appendChild(av)
        }
        const name = document.createElement("span")
        name.className = "you-who-name"
        // The handle if there is one; otherwise the row is still worth
        // drawing, because the face and the door are the other two thirds
        // of it and neither depends on a name.
        name.textContent = m.username ? `@${m.username}` : "Your profile"
        const go = document.createElement("span")
        go.className = "you-who-go"
        go.textContent = m.username ? "Profile ›" : "›"
        who.append(name, go)
        who.setAttribute(
          "aria-label",
          m.username ? `Open @${m.username}'s profile` : "Open your profile",
        )
        who.addEventListener("click", () => {
          if (halt()) return
          // The same event the other rows in this sheet fire when they open
          // a panel room, with the same shape — one name for one act.
          track("x_you_row_open", { route: "profile" })
          deps.openRoom?.(`/profile/${m.id}`)
        })
        who.hidden = false
      })
      void Promise.resolve(deps.myRank?.()).then((r) => {
        if (!host.isConnected || !r || r.rank === null) return
        /**
         * NAME WHAT IT RANKS.
         *
         * This is the flywheel board, sorted by POINTS, and it said only
         * "#1 this week" — two lines under "Portfolio value $9.05". A
         * reader joins those: nine dollars and first place, and either the
         * number or the board is a lie. Neither is. The rank was borrowing
         * credibility from a figure it has nothing to do with, and paying
         * for it with the figure's own.
         *
         * Four words fix it, because the problem was never the rank.
         */
        rank.textContent = `#${r.rank} by points this week`
        rank.hidden = false
      })

      const tabs = document.createElement("div")
      tabs.className = "tabs"
      const list = document.createElement("div")
      list.className = "you-list"
      panel.append(tabs, list)

      const foot = document.createElement("div")
      foot.className = "you-foot"
      // "Deposit USDC", everywhere money enters: the owner's ask is that
      // the one action a wallet needs is unmissable, and naming the
      // currency IS the instruction.
      /**
       * The money door answers the state the read discovered: with no
       * account, "Deposit USDC" is a promise the screen cannot keep, and
       * the honest first step is the sign-in the press would only reach
       * as a 401. The handler reads bookAuth at press time, so the same
       * button is always the true next step.
       */
      const moneyDoor = btn("pick you-add", ARC_EDITION ? "Add money" : "Deposit USDC", () => {
        if (bookAuth === "signed-out") {
          deps.signIn()
          return
        }
        void Promise.resolve(deps.fundRoute?.() ?? "custodial").then((route) => {
          if (!host.isConnected) return
          /**
           * NO AMOUNT, ON PURPOSE, AND NOTHING TO SIGN. A wallet account's
           * door lands on the panel's address screen — "Add USDC to your
           * wallet", and the wallet's own address — and nobody has typed a
           * figure here, so none is carried.
           *
           * Reproduced from this very button on 2026-09-22: it reached a
           * SOL → USDC conversion, and with no amount to convert, the
           * $10 fallback in helpers/topUpAmount became a Phantom approval
           * for "+10.15 USDC, -0.088 SOL" — a trade, at a number nobody
           * chose, under the word Deposit. The routing is guarded in
           * primary/main.tsx's topUp, which is the one place all three
           * money doors pass through; this call stays bare so no amount
           * can be invented on the way.
           */
          if (route === "external") void deps.topUp?.()
          else showFund(showYou)
        })
      })
      foot.appendChild(moneyDoor)
      /**
       * THE DOOR TO THE FEED, one tap deeper rather than a sixth control.
       *
       * Asked as a question — "feed'i açma butonu mu koysak? çok mu
       * kalabalık olur?" — and the resting row is the wrong place for it:
       * it already carries five things, two of which are the money, and a
       * door competing with Buy is a door that costs a trade. Here it
       * costs nothing: the reader is already inside their own screen,
       * looking at what they hold, and "what is everyone else doing" is
       * the next question that screen provokes. Trades made on X now file
       * themselves under x.com/home, so this opens a room that is
       * actually about the page they are standing on.
       */
      foot.appendChild(
        btn("pick you-feed", "Feed", () =>
          // The feed, not this asset's corner of it. Falls back to the old
          // door only where a host never supplied the new one.
          deps.openFeed ? deps.openFeed() : deps.openPanel(row.mint, tweetUrl),
        ),
      )
      panel.appendChild(foot)
      chip.appendChild(panel)

      /**
       * THE NEWS ROWS BECOME DOORS. Activity existed because "the only
       * announcement was an OS toast nobody sees twice" — but a surface
       * that announces and cannot act is the same dead end with better
       * typography. A fill opens its token's room, a crossed alert opens
       * the market it watched, a holding opens the room where Buy more,
       * Sell and Flex already wait. Rows with no honest destination stay
       * plain, and a press on a row's own button never also opens a door.
       */
      const doorTo = (r: HTMLElement, route: string) => {
        if (!deps.openRoom) return
        r.classList.add("door")
        r.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("button")) return
          if (halt()) return
          track("x_you_row_open", { route: route.split("/")[1] })
          deps.openRoom?.(route)
        })
      }

      const empty = (what: string) => {
        const e = document.createElement("div")
        e.className = "you-empty"
        e.textContent = what
        return e
      }

      /** A cell that refuses to invent a number it was not given. */
      const cell = (cls: string, text: string) => {
        const el = document.createElement("span")
        el.className = cls
        el.textContent = text
        return el
      }

      let tab: YouTab = initialTab ?? (via === "bell" ? "watch" : "holdings")
      // The cascade plays ONCE per tab the reader looks at — not on every
      // async landing. paintList repaints whenever any of its four data
      // sources arrives (book, orders, fired, notifications), and rows
      // that re-staggered to opacity 0 on each landing were rule 7's
      // "same movement described twice" wearing a network timing.
      let cascadedTab: string | null = null
      /**
       * THE NEAR-MISS, spoken. A parked alert or order is the product's
       * strongest pull-back hook, and its rows never said how CLOSE the
       * market is - data the surface already holds for this mint (lastUsd,
       * every 3s) and can borrow for others from the enrich cache the fill
       * rows already ride. Real numbers only: unpriced says nothing.
       */
      const distCell = (targetUsd: number, mint: string): HTMLElement => {
        const el = cell("you-dist", "")
        const say = (liveUsd: number | null) => {
          if (liveUsd === null || !(liveUsd > 0) || !(targetUsd > 0)) return
          const pct = ((targetUsd - liveUsd) / liveUsd) * 100
          if (!Number.isFinite(pct)) return
          const away = Math.abs(pct)
          el.textContent = `· ${away >= 10 ? Math.round(away) : away.toFixed(1)}% away`
        }
        if (mint === row.mint && lastUsd !== null) {
          say(lastUsd)
          return el
        }
        // Another asset: the same mid the ticks would paint, so this row
        // and the alert that will fire agree on the distance. The quote
        // price is the stand-in only when no mid can be had.
        const fromQuote = () =>
          enrich(mint).then((m) => {
            if (!el.isConnected) return
            say(typeof m?.indicativeUsd === "number" ? m.indicativeUsd : null)
          })
        if (!deps.midPrices) {
          void fromQuote()
          return el
        }
        void deps
          .midPrices([mint])
          .then((m) => {
            const usd = m.get(mint)
            if (usd === undefined) return fromQuote()
            if (el.isConnected) say(usd)
          })
          .catch(() => fromQuote())
        return el
      }

      /**
       * THE INVITE ROW, at the bottom of Holdings, after the first trade.
       * Closed it is one line, "Invite · N joined": no money figure, since
       * a zero dollar reads as a reason not to bother. Open it is the rule
       * in one sentence, the link and a Copy key, and the two counts.
       * Earnings appear from a dollar up. Gated by the same first-trade
       * flag as the receipt line, or by holding something other than
       * cash, which is the same fact seen from the book.
       */
      let inviteInfo: Awaited<ReturnType<NonNullable<XStripDeps["invite"]>["info"]>> | undefined
      let inviteOpen = false
      const paintInviteRow = (
        list: HTMLElement,
        b: Awaited<ReturnType<NonNullable<XStripDeps["book"]>>>,
      ) => {
        if (!deps.invite) return
        const USDC = EDITION_USDC_MINT
        const holds = (b?.positions ?? []).some((p) => p.mint !== USDC && p.uiAmount > 0)
        const draw = (info: typeof inviteInfo) => {
          if (!info || !(info.hasTraded || holds)) return
          const box = document.createElement("div")
          box.className = "invite-row"
          const head = document.createElement("div")
          head.className = "invite-head"
          const lbl = document.createElement("span")
          lbl.className = "invite-lbl"
          const small = document.createElement("small")
          small.textContent = joinedText(info.joined)
          lbl.append(document.createTextNode("Invite "), small)
          const toggle = btn("you-x", inviteOpen ? "Hide" : "Show link", () => {
            if (halt()) return
            inviteOpen = !inviteOpen
            if (inviteOpen) track("x_invite_shown", { mint: row.mint, tier, via: "panel" })
            paintList(lastBook, lastOrders)
          })
          head.append(lbl, toggle)
          box.appendChild(head)
          if (inviteOpen) {
            const open = document.createElement("div")
            open.className = "invite-open"
            const rule = document.createElement("div")
            rule.className = "invite-rule"
            rule.textContent = "You earn 20% of their trading fees."
            const linkbox = document.createElement("div")
            linkbox.className = "invite-linkbox"
            const link = inviteLink(info.code)
            const code = document.createElement("code")
            code.className = "invite-code"
            code.textContent = link.replace(/^https:\/\//, "")
            const copy = btn("invite-copy", "Copy", () => {
              if (halt()) return
              track("x_invite_copy", { mint: row.mint, tier, via: "panel" })
              void copyText(link).then((ok) => {
                if (!copy.isConnected) return
                copy.textContent = ok ? "Copied" : "Could not copy"
                setTimeout(() => {
                  if (copy.isConnected) copy.textContent = "Copy"
                }, 1600)
              })
            })
            linkbox.append(code, copy)
            const stats = document.createElement("div")
            stats.className = "invite-stats"
            stats.textContent = `${joinedText(info.joined)} · ${earnedText(info.earnedUsd)}`
            open.append(rule, linkbox, stats)
            box.appendChild(open)
          }
          list.appendChild(box)
        }
        if (inviteInfo !== undefined) {
          draw(inviteInfo)
          return
        }
        void deps.invite
          .info()
          .then((info) => {
            inviteInfo = info
            if (!panel.isConnected || tab !== "holdings") return
            draw(info)
          })
          .catch(() => {
            inviteInfo = null
          })
      }

      /** A standing alert, as a row: which way, which ticker, at what, how far. */
      const standingRow = (a: PriceAlert): HTMLElement => {
        const r = document.createElement("div")
        r.className = "you-row"
        r.append(
          // A bare ▲/▼ is a ticker's shorthand; the row says which way
          // it is watching, in the product's own words.
          cell(`you-side you-dir-${a.direction}`, a.direction === "above" ? "Above" : "Below"),
          cell("you-tick", bareTicker(a.symbol ?? `${a.mint.slice(0, 4)}…`)),
          cell("you-val", `@ ${priceText(a.targetUsd)}`),
          distCell(a.targetUsd, a.mint),
        )
        if (deps.removeAlert) {
          r.appendChild(
            btn("you-x", "Remove", () => {
              if (halt()) return
              void Promise.resolve(deps.removeAlert?.(a.id)).then(() => {
                if (!panel.isConnected) return
                lastAlerts = (lastAlerts ?? []).filter((x) => x.id !== a.id)
                paintList(lastBook, lastOrders)
              })
            }),
          )
        }
        return r
      }

      /**
       * THE ALERT ROOM: one sentence, one field, one key, and the promises
       * already made under it. The same makeAlert the sheet's bell uses,
       * so direction is read off the live price at creation and frozen.
       * No account needed to set one; a signed-in reader's copy also goes
       * to the server (deps.saveAlert does that), which is what makes the
       * email possible when Chrome is closed.
       */
      const paintWatch = (list: HTMLElement) => {
        const ask = document.createElement("div")
        ask.className = "watch-ask"
        const q = document.createElement("div")
        q.className = "watch-q"
        q.textContent = `Tell me when $${ticker} hits`
        const box = document.createElement("div")
        box.className = "price-box"
        const cur = document.createElement("span")
        cur.className = "cur"
        cur.textContent = "$"
        const input = document.createElement("input")
        input.className = "price-in"
        input.type = "text"
        input.inputMode = "decimal"
        input.setAttribute("aria-label", `Price to alert at, for $${ticker}`)
        input.placeholder = lastUsd !== null ? formatTriggerPrice(lastUsd).replace("$", "") : "0.00"
        box.append(cur, input)
        const msg = document.createElement("div")
        msg.className = "watch-msg"
        const standing = document.createElement("div")
        standing.className = "watch-list"
        const paintStanding = () => {
          standing.replaceChildren(...(lastAlerts ?? []).map(standingRow))
        }
        const set = btn("watch-set", "Set", () => {
          if (halt()) return
          const typed = input.value.trim()
          const alert = makeAlert({
            mint: row.mint,
            symbol: ticker,
            targetUsd: Number(normalizeDecimal(typed)),
            marketUsd: lastUsd,
            now: Date.now(),
          })
          if (!alert) {
            msg.textContent =
              typed === "" ? "Type a price" : lastUsd === null ? "No live price yet" : "That's the price now"
            msg.className = "watch-msg err"
            input.focus()
            return
          }
          if (!deps.saveAlert) return
          void deps.saveAlert(alert).then((added) => {
            if (!panel.isConnected) return
            track("x_price_alert", { mint: row.mint, added, tier, via: "bell" })
            msg.textContent = added
              ? `Alert set · ${alert.direction === "above" ? "reaches" : "drops to"} ${priceText(alert.targetUsd)}`
              : "That alert is already set"
            msg.className = "watch-msg ok"
            if (added) {
              lastAlerts = [...(lastAlerts ?? []), alert]
              input.value = ""
              paintStanding()
            }
          })
        })
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            set.click()
          }
        })
        ask.append(q, box, set, msg)
        list.append(ask, standing)
        paintStanding()
      }

      const paintList = (b: Awaited<ReturnType<NonNullable<XStripDeps["book"]>>>,
                         orders: Awaited<ReturnType<NonNullable<XStripDeps["listOrders"]>>> | null) => {
        /**
         * THE SCORE STEPS ASIDE FOR THE NEWS. Activity is the one tab that
         * is not about the reader's money — it is who did what, and what
         * filled — and a 30px P&L above it was eating the room the news
         * needed while answering a question nobody asked on that tab.
         * Holdings and Orders keep it: those ARE the money.
         */
        head.hidden = tab === "alerts" || via === "bell"
        /**
         * ONE NUMBER, ONCE PER SCREEN. The header names the spendable cash
         * ("USDC $3.53") and the Holdings list carries a USDC row with the
         * same ticker and the same figure — verbatim, in the same viewport,
         * about a hundred pixels apart (screenshot, 2026-09-20). Both were
         * added deliberately and both are right in isolation; together they
         * read as a surface that cannot count.
         *
         * The ROW wins on Holdings, because a holdings list missing the
         * reader's largest holding is a worse lie than a missing caption.
         * Every other tab keeps the header line, because there is no row
         * there to carry it.
         */
        cash.hidden = tab === "holdings"
        /**
         * ...AND SO DOES THE WALLET FURNITURE. Deposit and the feed door
         * are the money's two exits; on the one tab that is not about the
         * money they were the loudest things on screen, under a list they
         * had nothing to do with. Both tabs that ARE the money keep them,
         * which is where a reader reaches for them anyway.
         */
        foot.hidden = tab === "alerts" || via === "bell"
        list.classList.toggle("still", cascadedTab === tab)
        cascadedTab = tab
        list.replaceChildren()
        if (tab === "watch") {
          paintWatch(list)
          return
        }
        if (tab === "holdings") {
          /**
           * USDC IS A HOLDING, and leaving it out made the headline look
           * wrong. The hero said $9.05 and the list under it showed
           * nothing that added up to it — the cash was named once, in a
           * small line beside the total, and then absent from the only
           * place a reader goes to ask what they own.
           *
           * The server sends cash and positions separately because they
           * are fetched differently, which is a fact about our plumbing
           * and not about the reader's wallet. To them it is one pile.
           */
          // The edition's cash: Solana USDC in the store, Arc's ERC-20 here.
          const USDC_MINT = EDITION_USDC_MINT
          const cashRow =
            b && b.cashUsd > 0 && !(b.positions ?? []).some((p) => p.mint === USDC_MINT)
              ? [
                  {
                    mint: USDC_MINT,
                    ticker: "USDC",
                    named: true,
                    uiAmount: b.cashUsd,
                    priceUsd: 1 as number | null,
                    valueUsd: b.cashUsd as number | null,
                    avgEntryPriceUsd: null as number | null,
                    // Cash has no gain to show: a dollar was always a
                    // dollar, and a "+$0.00" beside it would be noise
                    // pretending to be information.
                    pnlUsd: null as number | null,
                  },
                ]
              : []
          const rows = rankPositions(cashRow.concat(
            (b?.positions ?? []).map((p) => ({
              mint: p.mint,
              ticker: p.ticker ?? `${p.mint.slice(0, 4)}…`,
              /**
               * Kept so the fold below can tell "we could not name this"
               * from "it is called SOL and it is worth nothing".
               *
               * AN ADDRESS IS NOT A NAME. Three prediction-era holdings
               * survived the first fold because the server does send them
               * a ticker — and that ticker is the head of their own mint.
               * A row reading "6gS3…" with a quantity and an em dash tells
               * a reader nothing they can act on, whether the truncation
               * happened here or upstream.
               */
              named: Boolean(p.ticker) && !p.mint.startsWith((p.ticker ?? "").replace(/…$/, "")),
              uiAmount: p.uiAmount,
              priceUsd: p.priceUsd ?? null,
              valueUsd: p.valueUsd ?? null,
              avgEntryPriceUsd: p.avgEntryPriceUsd ?? null,
              // ONE DEFINITION ON BOTH SURFACES. The row used to show
              // pnlUsd (value − net invested, which folds in money already
              // taken out) under a headline that says unrealized — so the
              // panel and the chip printed different numbers for what read
              // as the same question. Unrealized here too; the older
              // server's figure is the fallback.
              pnlUsd: p.unrealizedPnlUsd ?? p.pnlUsd ?? null,
            })),
            ),
            // Ranked WITH the cash rather than after it. Appending put the
            // largest holding on the wallet at the bottom of a list sorted
            // by size, under things worth nothing.
          ).filter((p) => p.uiAmount > 0)

          /**
           * DUST IS FOLDED, NOT LISTED.
           *
           * The filter above asks whether a position exists, and a wallet
           * that has traded for a while says yes to a great many things
           * worth nothing at all. Measured on a real reader: six rows, six
           * of them reading "$0.00", under a portfolio line reading $9.05
           * that was almost entirely the USDC. The list was answering a
           * question nobody asked and burying the one holding that had a
           * number.
           *
           * Worse than noise, one of those rows read "$0.00  −$4.90": a
           * loss on a position worth nothing is a true figure that stops a
           * reader cold, and it stopped this one.
           *
           * Folded rather than hidden. The count is named, so nothing is
           * concealed — a reader who wants the tail knows it is there, and
           * the panel still lists every one of them.
           */
          /**
           * A holding is worth showing when it has a name or a value. Both
           * missing means there is nothing on the row: a truncated base58
           * address, a bare quantity, and an em dash where the money goes.
           *
           * Measured on a real wallet: three of those. They were first
           * assumed to be leftovers from the prediction stack this product
           * was before August, and reading the chain said otherwise —
           * Token-2022 mints issued by DFlow, whose metadata points at
           * c.dflow.net, bought deliberately as prediction outcomes. The
           * fold is right either way and the reason is the same: Jupiter
           * answers TOKEN_NOT_TRADABLE for them, so there is no price to
           * show and no swap to offer.
           *
           * They are not dust — dust at least has a price — and the
           * earlier fold let them through on purpose, because "unpriced"
           * was being read as "we do not know yet". For a row that is also
           * nameless there is nothing to know and nothing to say. Their
           * real home is the venue that issued them.
           */
          const DUST_USD = 0.01
          /**
           * UNPRICED IS NOT WORTHLESS. A null value means nobody could
           * price the thing, and folding those away would answer "we do
           * not know" with "it is nothing" — the row below prints an em
           * dash for exactly this case, and a spec holds it there.
           */
          const isDust = (v: number | null) => v !== null && v < DUST_USD
          const showable = (p: { valueUsd: number | null; named: boolean }) =>
            !isDust(p.valueUsd ?? null) && (p.named || p.valueUsd !== null)
          const dust = rows.filter((p) => !showable(p))
          const held = rows.filter(showable)
          /**
           * WHICH KIND OF NOTHING. "+ 9 positions with nothing to show"
           * folded two different facts into one sentence: a position priced
           * below a cent, and a position the server could not price at all.
           * This surface's own rule elsewhere is that null is never zero
           * ("—", never "$0.00", one line down) — the fold broke it, and it
           * broke it on the line that explains the gap between the hero and
           * the list (screenshot: $3.55 over a list summing to $3.53).
           */
          const unpriced = dust.filter((p) => p.valueUsd === null).length
          const tiny = dust.length - unpriced
          const foldLine = () => {
            const parts: string[] = []
            if (tiny > 0) parts.push(`${tiny} under $${DUST_USD.toFixed(2)}`)
            if (unpriced > 0)
              parts.push(`${unpriced} we could not price`)
            return `+ ${parts.join(" · ")}`
          }

          if (held.length === 0 && dust.length === 0) {
            list.appendChild(empty("Nothing held yet."))
            return
          }
          if (held.length === 0) {
            list.appendChild(empty(`${foldLine().replace(/^\+ /, "")}.`))
            return
          }
          for (const p of held) {
            const r = document.createElement("div")
            // The cash row is marked: it is a holding, but it is not a
            // position, and the things this list offers a position — a
            // flex, a gain — mean nothing for a dollar. A spec was already
            // written expecting this class before there was a row to wear
            // it.
            r.className = p.mint === USDC_MINT ? "you-row cash" : "you-row"
            /**
             * THE COIN'S OWN FACE. The book was a column of tickers — a
             * ledger's way of listing assets, and the one place on this
             * surface where the reader's own things had no picture. One
             * helper draws it for every row that is about an asset (the
             * book and the fills), so the two can never drift.
             */
            /**
             * A DOLLAR'S QUANTITY IS ITS VALUE. Every other row earns two
             * numbers because they answer different questions — how many,
             * and what that is worth. The cash row printed "3.53" and
             * "$3.53" side by side, which reads as a rendering fault
             * (screenshot, 2026-09-20). The row already knows it is cash:
             * it wears the class for it.
             */
            const isCash = p.mint === USDC_MINT
            r.append(
              coinDisc(p.mint, p.ticker),
              cell("you-tick", bareTicker(p.ticker)),
              ...(isCash ? [] : [cell("you-qty", qtyText(p.uiAmount))]),
              // "—", never "$0.00": a holding the server could not price is
              // unpriced, and zero is a different claim entirely.
              cell("you-val", p.valueUsd === null ? "—" : usdText(p.valueUsd, false)),
            )
            const pnl = p.pnlUsd
            if (pnl !== null && Math.abs(pnl) >= 0.005) {
              r.appendChild(
                cell(`you-pl ${pnl > 0 ? "up" : "down"}`, usdText(pnl, true)),
              )
            }
            /**
             * THE FLEX, WHERE THE PRIDE IS. Share existed only in the
             * transient post-buy receipt and the panel — never on the
             * screen a winner opens to admire the number. Green rows with
             * an honest basis get the same card the receipt shares, built
             * from parts this file already holds; flexParts guarantees
             * nothing dishonest ships (no basis, no card).
             */
            const parts = flexParts({
              ticker: p.ticker,
              uiAmount: p.uiAmount,
              priceUsd: p.priceUsd,
              avgEntryPriceUsd: p.avgEntryPriceUsd,
            })
            if (parts && parts.tone === "up") {
              /**
               * THE PORTRAIT FLEX when the numbers allow it, the landscape receipt
               * when they do not. flexPortraitModel only answers for a gain with
               * every number present, so a partial position never draws a
               * half-empty card; it takes the old road instead.
               */
              const model = flexPortraitModel(p.ticker, parts)
              // Warm the font and the mark now, so the press spends none of the
              // click's few seconds on them.
              if (model) warmFlexAssets()
              const fx = btn("you-flex", "Flex ↗", () => {
                if (halt()) return
                track("x_you_flex", { mint: p.mint, layout: model ? "portrait" : "landscape" })
                const report = (how: "composed" | "copied" | "text-only") => {
                  // Feedback on the button itself: this row has no tail to write
                  // into, and a label that reports then returns is the fund
                  // screen's own Copy pattern.
                  if (!fx.isConnected) return
                  fx.textContent =
                    how === "composed" ? "Ready" : how === "copied" ? "Copied" : "Opened"
                  setTimeout(() => {
                    if (fx.isConnected) fx.textContent = "Flex ↗"
                  }, 1600)
                }
                const handleAsk = Promise.resolve(deps.myHandle?.() ?? null).catch(() => null)
                if (model) {
                  const meAsk = Promise.resolve(deps.me?.()).catch(() => null)
                  void Promise.all([handleAsk, meAsk])
                    .then(([handle, me]) =>
                      gatherFlexAssets(me?.photoUrl ?? null).then((a) =>
                        shareFlexCard(model, {
                          tweetText: flexTweetText(model, p.ticker, parts.credit),
                          handle,
                          avatarUri: a.avatarUri,
                          markUri: a.markUri,
                        }),
                      ),
                    )
                    .then(report)
                  return
                }
                const cached = seriesCache.get(`${p.mint}:1d`)
                const iconAsk = Promise.race<string | null>([
                  iconViaBackground(
                    `${process.env.NEXT_PUBLIC_API_URL}/embed/asset/icon?mint=${p.mint}`,
                  ),
                  new Promise<string | null>((res) => setTimeout(() => res(null), 1800)),
                ])
                void Promise.all([
                  cached ?? Promise.resolve<SeriesAnswer>({ points: null, times: null, opens: null, highs: null, lows: null, failed: false }),
                  handleAsk,
                  iconAsk,
                  enrich(p.mint),
                ]).then(([answer, handle, iconUri, m]) => {
                  // THE WHOLE PARTS OBJECT, not just its headline. Handing
                  // shareTradeCard a bare `action` dropped the subline, the
                  // tone and the caller credit flexParts had already
                  // computed, so a loss drew green and the person whose
                  // call it was went unnamed. flexCardData is the fold the
                  // panel's own Flex already uses.
                  const bare = p.ticker.replace(/^\$/, "")
                  return shareTradeCard(flexCardData({
                    ticker: p.ticker,
                    series: answer.points,
                    mcap: m?.mcap ?? null,
                    priceUsd: p.priceUsd,
                    handle,
                    // The cashtag is load-bearing - it is what gives other
                    // extension readers a live chip under the shared tweet.
                    tweetText: `${parts.action} on $${bare}${parts.credit ? ` ${parts.credit}` : ""} · Poppin`,
                  }, parts), { iconUri }).then(report)
                })
              })
              r.appendChild(fx)
            }
            doorTo(r, `/token/${p.mint}`)
            list.appendChild(r)
          }
          if (dust.length > 0) {
            // Named, so the fold is visible rather than a disappearance.
            list.appendChild(empty(foldLine()))
          }
          paintInviteRow(list, b)
          return
        }
        if (tab === "alerts") {
          /**
           * ONE ACTIVITY FEED, not two features. The owner's second pass
           * on this tab: alerts are not a thing beside notifications,
           * they are one kind of them — "şu sana reply attı, şu token
           * alert koyduğun yere geldi". So the tab holds two bands: the
           * standing alerts (each with its way out) and the product's
           * recent notifications underneath. Setting one is the sheet's
           * bell, beside the price it is about.
           */
          /**
           * THIS TAB IS ABOUT THE READER'S MONEY.
           *
           * Measured on a real reader: the whole tab read "lev3 followed
           * you", "nic liked your post", "nic liked your post" — dated 23
           * and 74 days ago, inside a chip sitting under a post about
           * Nvidia. Nothing on the surface was about a trade, and a
           * two-month-old like is not activity, it is archaeology.
           *
           * A DENY LIST, not an allow list. Follows, likes and shares are
           * the old product and belong in the panel, which is the app.
           * Everything else passes — replies and mentions are usually
           * conversation about something the reader traded, and a kind
           * this file has never heard of is far likelier to be a new money
           * event than a new way of being liked.
           *
           * And a horizon. Alerts and fills are recent by nature; a
           * notification is not, and one from two months ago says nothing
           * about what is happening now.
           */
          const SOCIAL_ONLY = new Set(["follow", "like", "share"])
          const NOTE_HORIZON_MS = 14 * 24 * 60 * 60 * 1000
          // In the bell's room the standing alerts have their own tab.
          const rows = via === "bell" ? [] : (lastAlerts ?? [])
          const fired = lastFired ?? []
          const notes = (lastNotes ?? []).filter((n) => {
            if (SOCIAL_ONLY.has(n.kind)) return false
            const at = Date.parse(n.created_at)
            return !Number.isFinite(at) || Date.now() - at < NOTE_HORIZON_MS
          })
          const fills = lastFills ?? []
          if (
            rows.length === 0 &&
            fired.length === 0 &&
            fills.length === 0 &&
            notes.length === 0
          ) {
            list.appendChild(empty("Nothing yet. Fills and alerts land here."))
            return
          }
          /**
           * A FILLED ORDER LEADS, above even a crossed alert: an alert is
           * news about the market, a fill is news about the reader's own
           * money. Asked for on all three surfaces at once ("hem twitter
           * ui da hem sidebarda hem kartta"), and before this the only
           * announcement was an OS toast nobody sees twice.
           */
          for (const f of [...fills].reverse().slice(0, 6)) {
            const r = document.createElement("div")
            r.className = "you-row you-filled"
            const name = f.symbol
              ? f.symbol.replace(/^\$/, "")
              : `${f.mint.slice(0, 4)}…`
            /**
             * A FILL IS A TRADE, SO IT LOOKS LIKE ONE. It used to lead with
             * the generic bell-ish fill glyph and say only the trigger
             * price — the one row on this tab about the reader's own money
             * that carried neither the coin's face nor the number a
             * memecoin's size is said in. Same disc the book wears, and the
             * market cap arrives from the enrich the chip already caches.
             */
            r.append(coinDisc(f.mint, name), cell("you-tick", name))
            const line = cell(
              "you-val",
              `${f.side === "buy" ? "bought" : "sold"} at ${priceText(f.triggerPriceUsd)}`,
            )
            r.append(line, cell("you-when", ago(new Date(f.at).toISOString())))
            doorTo(r, `/token/${f.mint}`)
            void enrich(f.mint).then((m) => {
              if (!line.isConnected) return
              // Not for a wrapped asset: the figure is the wrapper's, and
              // "bought Apple at $51M MC" is a sentence about nothing.
              if (typeof m?.mcap === "number" && m.mcap > 0 && capIsMeaningful(m?.issuer)) {
                // "market cap", the same words the safety line and the
                // chart use. "MC" was the chip's third spelling of one
                // fact (screenshots, 2026-09-20).
                line.textContent = `${
                  f.side === "buy" ? "bought" : "sold"
                } at ${compactUsd(m.mcap)} market cap`
              }
            })
            list.appendChild(r)
          }
          // THE NEWS FIRST: what already happened outranks what is still
          // waiting to. Newest at the top, because that is what "news" means.
          for (const f of [...fired].reverse().slice(0, 8)) {
            const r = document.createElement("div")
            r.className = "you-row you-fired"
            r.append(
              actIcon(BELL_GLYPH, f.direction === "above" ? "up" : "down"),
              cell("you-tick", bareTicker(f.symbol ?? `${f.mint.slice(0, 4)}…`)),
              cell("you-val", `hit ${priceText(f.atUsd)}`),
              cell("you-when", ago(new Date(f.firedAt).toISOString())),
            )
            doorTo(r, `/token/${f.mint}`)
            list.appendChild(r)
          }
          for (const a of rows) list.appendChild(standingRow(a))
          // MORE OF THEM, and the list scrolls (see .you-list): eight was
          // a number chosen when the tab also carried a 30px score above it.
          for (const n of notes.slice(0, 20)) {
            const r = document.createElement("div")
            r.className = "you-row you-note"
            const what = document.createElement("span")
            // NOT .you-tick: that cell is shaped to clip a ticker to one
            // line, so every notification longer than the column was cut
            // mid-word. A sentence gets to be a sentence.
            what.className = "you-note-text"
            // The host writes these sentences; the chip only carries them.
            // textContent, so a stranger's reply stays words.
            what.textContent = n.text
            const when = document.createElement("span")
            when.className = "you-when"
            when.textContent = ago(n.created_at)
            /**
             * WHOEVER DID IT, WEARING THEIR OWN FACE. Every row led with
             * the same kind-glyph, so "nic liked your post" looked like a
             * system event rather than like nic. The photo when the host
             * knows it, the glyph when it does not — and the glyph still
             * rides the corner, so the KIND is never lost to the face.
             */
            const lead = n.avatarUrl
              ? actorDisc(n.avatarUrl, NOTE_GLYPHS[n.kind] ?? NOTE_GLYPHS.follow)
              : actIcon(NOTE_GLYPHS[n.kind] ?? NOTE_GLYPHS.follow, "accent")
            r.append(lead, what, when)
            if (n.route) doorTo(r, n.route)
            list.appendChild(r)
          }
          return
        }
        const mine = orders ?? []
        if (mine.length === 0) {
          list.appendChild(empty("No open orders. One stays open until it fills or you cancel it."))
          /**
           * A DOOR WHERE THE LOOP ENDED. The reader who came to check
           * their standing investments and found none was handed a full
           * stop; the one action that creates the pull-back hook is a tap
           * away and everything it needs is in scope. No urgency, no
           * numbers - just the exit that was missing.
           */
          list.appendChild(
            btn("you-set-go", `Set a trigger for ${ticker}`, () => {
              if (halt()) return
              showSheet({ side: "buy", kind: "limit", usd: clip.usd })
            }),
          )
          return
        }
        for (const o of mine) {
          const r = document.createElement("div")
          r.className = "you-row"
          r.append(
            // NOT `you-side sell`. That collides with the Sell BUTTON's own
            // class, which carries a tinted ground and padding, so a word in
            // a list came out wearing a button's clothes. Two classes, one
            // name, different objects — the collision is invisible in the
            // source and obvious on screen.
            cell(`you-side you-side-${o.side}`, o.side === "sell" ? "Sell" : "Buy"),
            cell("you-tick", o.symbol ?? `${o.mint.slice(0, 4)}…`),
            cell("you-qty", o.amountUsd === null ? qtyText(o.amountUi) : usdText(o.amountUsd, false)),
            cell("you-val", `@ ${priceText(o.triggerPriceUsd)}`),
            distCell(o.triggerPriceUsd, o.mint),
          )
          if (deps.cancelOrder) {
            /**
             * A CANCEL THAT FAILS HAS TO SAY SO.
             *
             * Reported as "order cancel edilmiyor", and the press really did
             * nothing: the request reached the server, the server refused it,
             * and the refusal arrived here as a rejected promise that this
             * handler had no catch for. Seven presses, seven refusals, an
             * unchanged row and not one word on screen — the reader's only
             * evidence that a control exists is that it does something.
             *
             * The server's 422 carries Jupiter's own sentence, which is
             * written for a reader ("Order size must be at least 5 USD" is
             * the house example), so it is shown rather than flattened into
             * "something went wrong".
             */
            const x = btn("you-x", "Cancel", () => {
              if (halt()) return
              x.disabled = true
              x.textContent = "Cancelling…"
              /**
               * AND IT CANNOT SIT THERE FOREVER.
               *
               * The request leaves through the background, and a bridge
               * that never answers leaves a disabled button reading
               * "Cancelling…" for the life of the page. A control that can
               * enter a state it cannot leave is a trap, whatever the
               * reason it got stuck. Longer than the server's own 20s
               * Jupiter timeout on purpose, so a slow answer still wins the
               * race and this only fires when nothing is coming.
               */
              let settled = false
              window.setTimeout(() => {
                if (settled || !panel.isConnected) return
                settled = true
                x.disabled = false
                x.textContent = "Cancel"
                r.appendChild(note("err", "No answer — try again"))
              }, 25_000)
              void Promise.resolve(deps.cancelOrder?.(o.orderKey))
                .then(() => {
                  settled = true
                  // In place, exactly as Remove-alert next door: showYou()
                  // rebuilt the whole panel, reset the tab to Holdings and
                  // replayed the hero's drumroll - the reader cancelling
                  // their third order was teleported home three times.
                  if (!panel.isConnected) return
                  lastOrders = (lastOrders ?? []).filter(
                    (y) => y.orderKey !== o.orderKey,
                  )
                  paintList(lastBook, lastOrders)
                  /**
                   * AND THE MONEY COMES BACK, so the panel says so.
                   *
                   * A standing buy holds its USDC in escrow, and the
                   * balance above counts only what is spendable — which is
                   * correct while the order stands and wrong the instant it
                   * is cancelled. Reported: cancel a $5 order against a
                   * $9 balance and the hero stayed at $4.
                   *
                   * The server confirms the cancel on chain before it
                   * answers, so by the time this runs the escrow is already
                   * back in the wallet and one fresh read is enough. No
                   * poll, no retry: unlike the order list, this source is
                   * not eventually consistent, it is just unread.
                   *
                   * refreshBook, NOT book. The first version of this called
                   * book(), which is memoised for 20 seconds — so it handed
                   * back the answer from BEFORE the cancel and the panel
                   * went on showing the old number. Reported that way, and
                   * the cache is right to exist: /positions was measured at
                   * 8.6s cold. It is just the wrong thing to ask when you
                   * are the reason the answer changed.
                   *
                   * landBook, NOT showYou. Rebuilding the panel is what the
                   * in-place patch above exists to avoid — it would reset
                   * the tab to Holdings and teleport a reader who is still
                   * looking at their orders.
                   */
                  /**
                   * A READ THAT FAILED IS NOT AN EMPTY BOOK. refreshBook
                   * resolves to null on any network failure, and
                   * landBook(null) paints the whole portfolio away — so a
                   * cancelled order plus one bad request erased every
                   * holding on screen. Keep what is already drawn; the
                   * next paint corrects it.
                   */
                  void refreshBook().then((b) => {
                    if (b) landBook(b, true)
                  })
                })
                .catch((err: unknown) => {
                  settled = true
                  const why = failureReason(err)
                  dbg(`cancel refused for ${o.orderKey}: ${why}`)
                  if (!panel.isConnected) return
                  // The order is still theirs and still standing, so the
                  // button goes back to being a button.
                  x.disabled = false
                  x.textContent = "Cancel"
                  const said = r.querySelector(".note")
                  if (said) said.remove()
                  r.appendChild(note("err", why.slice(0, 140)))
                })
            })
            r.appendChild(x)
          }
          list.appendChild(r)
        }
      }

      const mkTab = (key: YouTab, label: string) => {
        const t = btn("tab", label, () => {
          if (tab === key) return
          tab = key
          /* Which of the scoreboard's three rooms people actually enter.
             The open itself is already counted (x_strip_you_open); this
             says where they went once inside, which is the difference
             between "people check their money" and "people check their
             alerts" — two different products to double down on. */
          track("x_you_tab", { tab: key })
          if (key === "alerts") void deps.markFiredRead?.()
          for (const el of tabs.querySelectorAll("[aria-pressed]")) {
            el.setAttribute("aria-pressed", String(el === t))
          }
          paintList(lastBook, lastOrders)
          // AND ASK AGAIN, because the answer may have changed since the
          // panel opened. See loadOrders: this list is the one thing here
          // whose source is eventually consistent.
          if (key === "orders") loadOrders()
        })
        t.setAttribute("aria-pressed", String(tab === key))
        return t
      }
      if (via === "bell") {
        tabs.append(mkTab("watch", "Alerts"), mkTab("alerts", "Activity"))
      } else {
        tabs.append(
          mkTab("holdings", "Holdings"),
          // Standing orders live on the store backend only.
          ...(CAP.orderWatch ? [mkTab("orders", "Orders")] : []),
          mkTab("alerts", "Activity"),
        )
      }

      let lastBook: Awaited<ReturnType<NonNullable<XStripDeps["book"]>>> = null
      let lastOrders: Awaited<ReturnType<NonNullable<XStripDeps["listOrders"]>>> | null = null
      let lastAlerts: PriceAlert[] | null = null
      let lastFired: FiredAlert[] | null = null
      let lastFills: PendingFill[] | null = null
      let lastNotes: Awaited<ReturnType<NonNullable<XStripDeps["listNotifications"]>>> | null = null
      void Promise.resolve(deps.listFired?.()).then((f) => {
        if (!panel.isConnected) return
        lastFired = f ?? []
        if (tab === "alerts") paintList(lastBook, lastOrders)
      })
      void Promise.resolve(deps.listFills?.()).then((f) => {
        if (!panel.isConnected) return
        lastFills = f ?? []
        if (tab === "alerts") paintList(lastBook, lastOrders)
      })
      // Opening the panel ON the news counts as reading it. The dot dies
      // by the same storage write that lit it, through the host's watcher.
      if (initialTab === "alerts") void deps.markFiredRead?.()
      void Promise.resolve(deps.listAlerts?.()).then((a) => {
        if (!panel.isConnected) return
        lastAlerts = a ?? []
        if (tab === "alerts" || tab === "watch") paintList(lastBook, lastOrders)
      })
      void Promise.resolve(deps.listNotifications?.()).then((n) => {
        if (!panel.isConnected) return
        lastNotes = n ?? []
        if (tab === "alerts") paintList(lastBook, lastOrders)
      })

      big.textContent = "…"
      /**
       * CACHED FIRST, FRESH ON LANDING. /positions is 8.6s cold, and the
       * scoreboard is a pure display surface - the exact reader the
       * persisted book cache was built for, and the one surface that never
       * used it. The drumroll runs once on whichever book lands first; the
       * fresh read then counts FROM the shown figure instead of re-zeroing,
       * so a correction reads as the number settling, not the game
       * restarting. Trade sheets stay on the live read, per the cache's
       * own display-only contract.
       */
      let heroShown: number | null = null
      let freshLanded = false
      const landBook = (
        b: Awaited<ReturnType<NonNullable<XStripDeps["book"]>>>,
        fresh: boolean,
      ) => {
        if (!panel.isConnected) return
        lastBook = b
        if (!b) {
          big.textContent = "—"
          if (bookAuth === "signed-out") {
            // The balance is not unavailable, it is UNOWNED - a different
            // claim, and the one the funnel's first sentence hangs on.
            cap.textContent = "No account yet"
            moneyDoor.textContent = "Sign in"
          } else {
            cap.textContent = "Balance unavailable"
          }
          return
        }
        // Grouped like every other resting figure - "$1234.56" is a bank
        // statement's number (usdText's own words).
        cash.textContent = `USDC ${usdText(b.cashUsd, false)}`
        const h = youHeadline(b)
        if (h.kind === "unrealized" || h.kind === "pnl") {
          // The reveal IS the game: the score counts up from zero on every
          // open, the way the leaderboard's hero does. Not the homecoming
          // rule (last-seen → current) — that rule is for numbers that sit
          // on the timeline all day; this one is summoned by a press and a
          // summoned score deserves its drumroll. countTo falls back to a
          // plain paint under reduced motion.
          if (heroShown === null || Math.abs((heroShown ?? 0) - h.usd) >= 0.005) {
            countTo(big, heroShown ?? 0, h.usd, (v) => usdText(v, true))
          }
          heroShown = h.usd
          big.classList.remove("up", "down")
          big.classList.add(h.usd > 0 ? "up" : "down")
          /**
           * WHAT IS ALREADY YOURS. The big number swings with every tick;
           * the banked figure is the part no candle can take back, and
           * saying both is what makes the swing bearable. Absent (null,
           * or dust) the caption stays one word — a zero here would claim
           * "you banked nothing" about ledgers that simply predate
           * quantities.
           */
          const banked = b.totalRealizedPnlUsd
          // The hero is the OPEN book now, so the caption says which
          // question it answered — and the older server's all-time
          // fallback keeps its own honest word.
          const what = h.kind === "unrealized" ? "On what you hold" : "All time"
          cap.textContent =
            typeof banked === "number" && Math.abs(banked) >= 0.005
              ? `${what} · ${usdText(banked, true)} banked`
              : what
        } else if (h.kind === "value") {
          if (heroShown === null || Math.abs((heroShown ?? 0) - h.usd) >= 0.005) {
            countTo(big, heroShown ?? 0, h.usd, (v) => usdText(v, false))
          }
          heroShown = h.usd
          /**
           * A VALUE IS NOT A VERDICT. The P&L branch above paints the hero
           * green or red and only IT ever cleared those classes, so a
           * reader whose book turned from a scored one into an unscored
           * one kept the last verdict's colour: "Portfolio value $3.55" in
           * P&L red, which reads as a loss of $3.55. Cleared here and in
           * the unknown branch below, where the same thing was true.
           */
          big.classList.remove("up", "down")
          cap.textContent = "Portfolio value"
        } else {
          big.classList.remove("up", "down")
          big.textContent = "—"
          cap.textContent = "Nothing to score yet"
        }
        paintList(b, lastOrders)
      }
      void Promise.resolve(deps.cachedBook?.() ?? null).then((cached) => {
        // A slow cache behind a landed fresh read stays silent; and a
        // cached null is nothing to paint, not a verdict.
        if (freshLanded || !cached) return
        landBook(cached, false)
      })
      void book().then((b) => {
        freshLanded = true
        landBook(b, true)
      })
      /**
       * ORDERS ARE ASKED FOR MORE THAN ONCE, and that is not belt and braces.
       *
       * Reported: place a standing order, open this panel, and it is not
       * there until the page is reloaded. Nothing was cached and nothing
       * failed. The list simply came from a source that had not caught up
       * yet: /embed/asset/orders reads Jupiter's getTriggerOrders, which
       * indexes the order account AFTER the transaction lands. Measured on
       * the reported order — placed, and visible at Jupiter at 09:09:04.
       *
       * A list fetched exactly once, from an eventually consistent source,
       * immediately after the event that changes it, is guaranteed to be
       * wrong some of the time and has no way back. Reloading the page was
       * the only cure because that is what mounted a new chip.
       *
       * So it is asked on open, again when the reader opens the tab, and
       * once more a beat later if the tab is open and still empty. BOUNDED
       * AT ONE RETRY on purpose: an empty order list is a perfectly normal
       * answer, and a panel that polls forever to disbelieve it is the
       * flicker amplifier the chip's remount cure was written against.
       *
       * A failure leaves the last known list alone rather than blanking it,
       * and never throws: this used to have no catch at all, so one refused
       * request left the tab empty for the life of the page with nothing on
       * screen to say why.
       */
      let orderRetryLeft = 1
      const loadOrders = () => {
        void Promise.resolve(deps.listOrders?.())
          .then((o) => {
            if (!panel.isConnected) return
            // Every open order, not just this tweet's asset. The panel is
            // about the reader, and an order on another mint is still theirs.
            lastOrders = o ?? []
            if (tab === "orders") paintList(lastBook, lastOrders)
            if (tab === "orders" && lastOrders.length === 0 && orderRetryLeft > 0) {
              orderRetryLeft -= 1
              setTimeout(() => {
                if (panel.isConnected && tab === "orders") loadOrders()
              }, 2_500)
            }
          })
          .catch(() => {
            // Keep whatever was last known. Nothing to say to the reader:
            // they asked for a panel, not for a report on our network.
          })
      }
      loadOrders()
    }
    /**
     * THE PILL CARRIES THE NEWS COUNT. An alert that fires while the
     * reader scrolls used to exist only as a system toast — which the OS
     * may swallow and the product surface never echoed. The dot is the
     * echo: unread fired alerts, counted from storage, updated live by
     * the host's storage watcher, cleared the moment Activity is opened.
     * No network: the news is already on this machine.
     */
    let unreadNow = 0
    let unreadSpoken = 0
    const paintUnread = () => {
      // News ARRIVING is a moment: the badge pops in and the bell itself
      // swings once, the way a game announces a coin. News leaving (read)
      // or standing still is not a moment and gets nothing. The swing
      // rides the SVG, not the button — the button's transform channel
      // belongs to the press system and an animation there would replace
      // it mid-press (the bug the .bell comment above already documents).
      const grew = unreadNow > unreadSpoken
      unreadSpoken = unreadNow
      for (const el of shadow.querySelectorAll<HTMLElement>(".wal-dot")) {
        el.hidden = unreadNow <= 0
        el.textContent = unreadNow > 9 ? "9+" : String(unreadNow)
        if (grew) {
          el.classList.remove("pop")
          void el.offsetWidth
          el.classList.add("pop")
        }
      }
      for (const b of shadow.querySelectorAll<HTMLElement>(".ring")) {
        b.classList.toggle("live", unreadNow > 0)
        const svg = b.querySelector("svg")
        if (grew && svg) {
          // Reflow between remove and add, or the same class re-added in
          // one frame never restarts the animation.
          svg.classList.remove("swing")
          b.classList.remove("rang")
          void b.offsetWidth
          svg.classList.add("swing")
          b.classList.add("rang")
        }
      }
    }
    void Promise.resolve(deps.listFired?.()).then((f) => {
      if (!host.isConnected || !f) return
      unreadNow = f.filter((x) => !x.read).length
      // The SEED is not an arrival: news that predates the mount gets the
      // badge, never the pop and the swing — otherwise every timeline chip
      // rang its own bell on scroll-in for week-old alerts.
      unreadSpoken = unreadNow
      paintUnread()
    })
    /**
     * THE WATCHER'S FIRST ANSWER IS ALSO A SEED. The seed above counts
     * only fired ALERTS, but watchUnread counts alerts + FILLS - so with
     * one unread fill in storage, the watcher's initial callback arrived
     * as "grew" and every chip that mounted popped the dot and swung the
     * bell for week-old news, per scroll, forever. A fake arrival is worse
     * than none: it trains the reader that the ring means nothing.
     */
    let watchSeeded = false
    deps.watchUnread?.((n) => {
      if (!host.isConnected) return
      if (!watchSeeded) {
        watchSeeded = true
        unreadSpoken = Math.max(unreadSpoken, n)
      }
      unreadNow = n
      paintUnread()
    }, () => host.isConnected)

    /**
     * THE BELL IS THE DOOR TO THE NEWS, and it is ALWAYS there.
     *
     * The first pass hung the unread dot on the score pill — correct
     * while news existed and invisible the rest of the time, so the
     * reader asked "nereye geldi notifications?": a door that only
     * appears when somebody is knocking is not a door. The bell stands
     * permanently, quiet ink at rest, counting when there is news, and
     * always opens Activity directly. The pill goes back to being purely
     * the portfolio's door.
     */
    /**
     * The signature. See .pmark for why it sits here and not by the price.
     * Not a button: pressing it would be a fifth control on a row the whole
     * point of this change is to quieten, and the sidebar is already one
     * press away on the face.
     */
    const poppinMark = (): HTMLElement => {
      // The brand face is registered on the DOCUMENT, which is what lets a
      // shadow root reach it at all. Asking here rather than at boot keeps
      // a page with nothing tradeable on it from fetching a font.
      ensureBrandFont()
      const m = document.createElement("span")
      m.className = "pmark"
      m.textContent = "poppin"
      m.setAttribute("role", "img")
      // No title: the resting row forbids native tooltips, and a screen
      // reader has the label above. See the spec that holds this.
      m.setAttribute("aria-label", "Poppin")
      return m
    }

    /**
     * WHO HOVERS AND DOES NOT PRESS. Thirty days: 121 people saw a chip,
     * 3 touched one, and nothing said whether the other 118 ever came
     * near it. A pointer resting on the row, or on Buy, for 700ms is a
     * near-miss worth one count per target per chip. The background maps
     * it to card_shown, so "touched" is never inflated by a hover.
     */
    const HOVER_MS = 700
    const hoverSaid = new Set<string>()
    const armHover = (el: HTMLElement, target: "chip" | "buy") => {
      let t: ReturnType<typeof setTimeout> | null = null
      el.addEventListener("pointerenter", () => {
        if (hoverSaid.has(target)) return
        if (t) clearTimeout(t)
        t = setTimeout(() => {
          t = null
          if (hoverSaid.has(target)) return
          hoverSaid.add(target)
          track("x_strip_hover", { mint: row.mint, tier, target })
        }, HOVER_MS)
      })
      el.addEventListener("pointerleave", () => {
        if (t) clearTimeout(t)
        t = null
      })
    }
    /**
     * THE CHART IS NAMED FOR A READER WITHOUT AN ACCOUNT. The chevron on
     * the pill has always opened the chart; a first-time visitor cannot
     * know that, and the chart is the one free tap on the chip. Once the
     * book has answered signed-out, the chevron gets the word.
     */
    const labelChartForGuest = () => {
      const more = chip.querySelector<HTMLElement>(".more")
      if (!more || more.classList.contains("labeled")) return
      more.classList.add("labeled")
      const lbl = document.createElement("span")
      lbl.className = "more-lbl"
      lbl.textContent = "Chart"
      more.prepend(lbl)
    }
    /** Clipboard, honestly: true only when the browser said it took it. */
    const copyText = (text: string): Promise<boolean> =>
      typeof navigator !== "undefined" && navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(text).then(() => true, () => false)
        : Promise.resolve(false)

    /**
     * THE INVITE LINE, UNDER EVERY RECEIPT. Money went, tokens came, the
     * chip celebrated; the one sentence about inviting lands right after
     * that. Nothing is shared on the reader's behalf: the link goes to the
     * clipboard and where it is pasted is theirs.
     *
     * It used to show under the FIRST receipt only, once in a lifetime, at
     * the single moment a reader's attention is on the coin they just
     * bought. Measured 2026-09-19: zero links had ever been copied. The
     * moment is right and the frequency was wrong, so it now rides every
     * landed trade. `landed()` is still called for its own record: the
     * Holdings row opens on the first one.
     */
    const inviteLineAfterLanding = async (receiptNode: Element) => {
      if (!deps.invite) return
      try {
        await deps.invite.landed()
      } catch {
        return
      }
      const info = await deps.invite.info().catch(() => null)
      // Two awaits passed; the receipt this line belongs under may be gone
      // (× tapped, cell recycled). The next renderEnd replaces the row's
      // children, so the receipt node itself says whether it still stands.
      if (!info || !receiptNode.isConnected) return
      chip.querySelector(".invite-under")?.remove()
      const under = document.createElement("div")
      under.className = "invite-under"
      const line = document.createElement("span")
      line.className = "invite-line"
      const lead = document.createElement("b")
      lead.textContent = "Invite a friend."
      line.append(lead, document.createTextNode(" You earn 20% of their fees."))
      const link = inviteLink(info.code)
      const copy = btn("invite-copy", "Copy link", () => {
        if (halt()) return
        track("x_invite_copy", { mint: row.mint, tier, via: "receipt" })
        void copyText(link).then((ok) => {
          if (!under.isConnected) return
          under.replaceChildren()
          const said = document.createElement("span")
          said.className = ok ? "invite-copied" : "invite-line"
          said.textContent = ok ? "Link copied" : "Could not copy"
          const code = document.createElement("code")
          code.className = "invite-code"
          code.textContent = link.replace(/^https:\/\//, "")
          const tail = document.createElement("span")
          tail.className = "invite-line"
          tail.textContent = ok ? "Paste it anywhere." : "Select and copy it."
          under.append(said, code, tail)
        })
      })
      under.append(line, copy)
      chip.appendChild(under)
      track("x_invite_shown", { mint: row.mint, tier, via: "receipt" })
    }

    /**
     * THE RECEIPT SAYS THE POINTS, quietly. A point is a dollar traded,
     * times the seat. The multiplier is asked AFTER landing because the
     * first trade claims the seat on the server while the receipt is
     * already up; nothing waits, the line joins when the answer arrives,
     * and only if the receipt still stands.
     *
     * It used to say "+2 pts · ×2 seat" in a gold pill, which repeated a
     * multiplier nobody could look up and outshone the thing that had
     * just happened. The multiplier is still in the number; the word
     * "seat" belongs to the one receipt that claims it.
     */
    const pointsLineAfterLanding = async (receiptNode: Element, usd: number, mult: number) => {
      if (!(usd > 0)) return
      if (!receiptNode.isConnected) return
      const pts = Math.round(usd * mult)
      if (!(pts > 0)) return
      const line = document.createElement("span")
      line.className = "pts"
      line.textContent = `+${pts.toLocaleString("en-US")} pts`
      end.appendChild(line)
    }

    /**
     * THE SEAT, ANNOUNCED ONCE. The first landed trade claims a founding
     * seat on the server, and that receipt is the only place in the
     * product where it is worth a sentence: it is the moment it happened,
     * and it never happens again. Gold is spent here and nowhere else.
     *
     * This receipt carries nothing else — no points pill, no invite line.
     * A receipt says one thing, and this one has the rarest thing to say.
     */
    const seatLineAfterLanding = (receiptNode: Element, seat: number) => {
      if (!receiptNode.isConnected) return
      chip.querySelector(".seat-under")?.remove()
      const under = document.createElement("div")
      under.className = "seat-under"
      const badge = document.createElement("span")
      badge.className = "seat-badge"
      // The cap the server counts to (flywheel/cohort.ts FOUNDING_SEATS).
      // A constant on both sides rather than a number the chip asks for:
      // it has not changed since points v2 and a wrong "of 500" is worse
      // than no denominator at all, so the spec pins the pair.
      badge.textContent = `SEAT #${seat} / 500`
      const rest = document.createElement("span")
      rest.className = "seat-rest"
      rest.textContent = "Everything you trade counts double, forever."
      under.append(badge, rest)
      end.after(under)
      track("x_seat_claimed", { mint: row.mint, seat, tier })
    }

    /**
     * WHAT A LANDED RECEIPT SAYS, decided in one place so the three
     * passengers cannot all board at once. The seat receipt is alone; every
     * other receipt carries the quiet points and the invite line.
     */
    const afterLanding = async (receiptNode: Element, usd?: number) => {
      let first = false
      if (deps.invite) {
        try {
          first = (await deps.invite.landed()).first
        } catch {
          // The record of the first landing is not worth a dead receipt.
        }
      }
      const standing =
        deps.points && typeof usd === "number" && usd > 0
          ? await deps.points.status().catch(() => null)
          : null
      if (first && standing?.seat) {
        seatLineAfterLanding(receiptNode, standing.seat)
        return
      }
      if (standing && typeof usd === "number") {
        await pointsLineAfterLanding(receiptNode, usd, standing.mult)
      }
      await inviteLineAfterLanding(receiptNode)
    }

    const bellChip = () => {
      const b = document.createElement("button")
      b.className = "ring"
      // aria-label, and no `title` twin: the name is spoken on request, and
      // an icon-only key in the middle of the tail must not also be a box
      // that opens and shuts while the pointer crosses it (see mountStrip).
      b.setAttribute("aria-label", "Alerts and activity")
      // The SHARED bell, not a second drawing of it — this was the one
      // private copy left after the glyph moved to notificationText, and a
      // redraw there would have silently desynced this exact button.
      b.innerHTML = BELL_GLYPH
      b.querySelector("svg")?.setAttribute("aria-hidden", "true")
      const dot = document.createElement("span")
      dot.className = "wal-dot"
      dot.hidden = unreadNow <= 0
      if (unreadNow > 0) dot.textContent = unreadNow > 9 ? "9+" : String(unreadNow)
      b.appendChild(dot)
      b.classList.toggle("live", unreadNow > 0)
      b.addEventListener("click", () => {
        if (halt()) return
        track("x_strip_you_open", { mint: row.mint, tier, via: "bell" })
        // News first when there is news; otherwise the field.
        showYou(unreadNow > 0 ? "alerts" : "watch", "bell")
      })
      return b
    }

    const walChip = () => {
      const w = document.createElement("button")
      w.className = "wal"
      // A GLYPH, NOT A FIGURE. The pill is a door, not a number, so it
      // is dressed like the other door on this row: one quiet mark, a
      // permanent hit box, and the number it used to shout waiting one tap
      // in. Same 15px stroke weight as the bell so the pair reads as a set.
      w.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1"/>' +
        '<path d="M3 7.5v9A2.5 2.5 0 0 0 5.5 19H19a2 2 0 0 0 2-2v-6a1 1 0 0 0-1-1H5.5"/>' +
        '<circle cx="16.5" cy="13.5" r="1.15" fill="currentColor" stroke="none"/></svg>'
      // Same rule as the bell beside it: named for a screen reader, silent
      // for a moving pointer.
      w.setAttribute("aria-label", "Your balance and positions")
      /**
       * AND THEN IT BECOMES YOUR FACE.
       *
       * The glyph above is the signed-out drawing and the fallback; when
       * the reader has an identity, this key wears it. The slot, the size
       * and the door are all unchanged — what changes is that the strip
       * finally says WHOSE it is, which is the one question it never
       * answered at a glance.
       *
       * Replaced rather than added to. The row is 333px at rest and 370px
       * with this tail open, in a 1100px column; a fourth key would spend
       * that budget in a narrow column, and the budget belongs to the
       * price and the two keys that move money.
       *
       * The photo arrives through avatarImg, which is the ONE road any
       * person's picture takes here: x.com's img-src blocks a remote
       * avatar outright, so the bytes come from the worker as a data URI.
       * An account with no upload still has a face — the server writes a
       * ghost avatar at signup — so this is never an empty circle. And it
       * is never a BROKEN one either: the glyph only leaves once the
       * image has actually decoded.
       *
       * NO BADGE HERE. The bell one slot over already carries the unread
       * count and takes the accent fill with it; a second badge beside it,
       * counting the same news, would be the product saying one thing
       * twice.
       */
      void Promise.resolve(deps.me?.()).then((m) => {
        if (!m?.photoUrl || !w.isConnected) return
        /**
         * APPENDED FIRST, REVEALED SECOND — and that order is load-bearing.
         * avatarImg only writes the src once the worker answers AND the
         * img is connected, so an image held off-DOM until it loaded would
         * never get a src, never fire load, and never appear: a face that
         * silently never arrives. It goes in straight away, hidden by CSS,
         * and the glyph hands over only when the bytes have decoded.
         */
        const img = avatarImg(m.photoUrl)
        w.appendChild(img)
        img.addEventListener("load", () => {
          if (!w.isConnected) return
          w.querySelector("svg")?.remove()
          w.classList.add("me")
        })
      })
      w.addEventListener("click", () => {
        if (halt()) return
        track("x_strip_you_open", { mint: row.mint, tier })
        showYou()
      })
      return w
    }
    const refreshWal = () => {
      // A trade or deposit just changed the story the chart's markers
      // tell; the next chart open re-reads.
      mineOnce = null
      void book().then((b) => {
        if (!b) return
        walUsd = b.cashUsd
      })
    }
    /**
     * The chart's trades/orders read, ONE per strip rather than one per
     * range tap: mineOnce used to live inside showChart, so six range
     * flips were six /my-trades and six /orders reads for data that does
     * not change with the x-axis. Dropped in refreshWal: every money
     * event that could add a marker already refreshes the wal.
     */
    let mineOnce: Promise<
      [
        Awaited<ReturnType<NonNullable<XStripDeps["myTrades"]>>> | null,
        Awaited<ReturnType<NonNullable<XStripDeps["listOrders"]>>>,
        Book | null,
      ]
    > | null = null
    const refreshIfAlive = () => {
      if (host.isConnected) refreshWal()
      else walRefreshers.delete(refreshIfAlive)
    }
    walRefreshers.add(refreshIfAlive)
    /**
     * The resting chip asking for the balance is ONE positions read per
     * page, not per chip — bookOnce is controller-wide and every chip
     * shares it. Signed-out readers cost a single refused call. This is
     * the price of a balance visible before any sheet opens, asked for
     * from the field twice in one session.
     */
    let walAsked = false
    const askWalOnce = () => {
      if (walAsked || walUsd !== null) return
      walAsked = true
      refreshWal()
      // The identity read went out with the avatar. Keeping it would be a
      // request per page whose answer nothing draws — the exact shape of
      // the dead calls this codebase keeps finding.
    }

    const renderEnd = (...nodes: Element[]) => {
      /* THE REWARD BELONGS TO ONE RECEIPT. It used to take itself off after
         1.7s and now stays until the reader dismisses the receipt, so its
         end has to be somebody's job. Replacing the row's children below
         already does it, since the reward sits in the row; this line is
         what makes that true no matter where it is mounted, and it is why
         the reward is created AFTER this call rather than before. */
      chip.querySelector(".pop-reward")?.remove()
      chip.querySelector(".chip-sweep")?.remove()
      chip.querySelector(".invite-under")?.remove()
      chip.classList.remove("landed")
      end.classList.remove("landed", "leaving")
      end.replaceChildren(...nodes)
      if (typeof end.animate === "function" && !reducedMotion()) {
        end.animate(
          [
            { opacity: 0.35, transform: "translateX(3px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 150, easing: "cubic-bezier(.16, 1, .3, 1)" },
        )
      }
    }
    /**
     * THE SAME ROW, ON THE CEREMONY CLOCK.
     *
     * renderEnd is the product's everyday state change and stays at its
     * 150ms fade: it runs eleven times for eleven different reasons and
     * most of them are chrome. This one is the trade arriving, which
     * happens rarely, matters, and is already sitting at the end of a wait
     * of several seconds — so it gets the slowest tier this product owns.
     *
     * INTERRUPTIBLE. Nothing here queues: the classes are stamped on the
     * row that exists right now, and the next renderEnd strips them. A
     * reader who taps again mid-ceremony gets the next state immediately
     * rather than waiting for a light to finish crossing a pill.
     */
    const renderLanded = (...nodes: Element[]) => {
      chip.querySelector(".pop-reward")?.remove()
      chip.querySelector(".chip-sweep")?.remove()
      end.classList.remove("leaving")
      end.replaceChildren(...nodes)
      if (reducedMotion()) return
      end.classList.add("landed")
      chip.classList.add("landed")
      const sweep = document.createElement("span")
      sweep.className = "chip-sweep"
      chip.appendChild(sweep)
      window.setTimeout(() => {
        end.classList.remove("landed")
        chip.classList.remove("landed")
        sweep.remove()
      }, JUICE.cinemaMs + 80)
    }

    const btn = (cls: string, label: string, onTap: () => void) => {
      const b = document.createElement("button")
      b.className = cls
      b.textContent = label
      b.addEventListener("click", onTap)
      return b
    }
    const note = (cls: string, text: string) => {
      const n = document.createElement("span")
      n.className = `note ${cls}`.trim()
      n.textContent = text
      return n
    }

    /**
     * The orphan's answer, in the tail where every other answer lands.
     * Returns true when the press should go no further: there is nothing
     * behind this page any more, and pretending otherwise walks the reader
     * into a dead order sheet.
     */
    const halt = () => {
      if (!dead()) return false
      renderEnd(note("err", "Poppin updated · Reload the page"))
      return true
    }

    const openCard = (side: "buy" | "sell") => {
      track("x_strip_click", { mint: row.mint, side, tier, thin: Boolean(row.thin) })
      void enrich(row.mint).then((m) => {
        if (m) deps.openTrade(m, side)
      })
    }

    /**
     * THE THIN TAIL IS SHOWN, NOT HIDDEN — and not sold in one tap either.
     *
     * Hiding every asset under $150k liquidity would delete most of the mid
     * and low cap tail, which is the half of the market this feature exists
     * for. But a one-tap preset buy into a shallow pool spends real money on
     * slippage (measured: 0.84% median at $25-60k against 0.17% deep), and
     * the reader would never see where it went.
     *
     * So: the chip appears with its price and a plain "thin" mark, and the
     * button opens the CARD — where the amount is chosen deliberately, the
     * quote is shown before confirming, and the impact is on screen. Same
     * asset, same access, one more beat of attention.
     */
    const showIdle = () => {
      closeSheet()
      askWalOnce()
      /*
       * AN ASSET ON ANOTHER CHAIN (mint "remote:<key>", arc-api routes/remote.ts).
       * It is reached from the reader's Arc balance over CCTP, and until those
       * trades open the press shows the priced route in the sidebar instead of
       * spending anything: "Preview", never a Buy that cannot happen.
       */
      if (row.mint.startsWith("remote:")) {
        renderEnd(poppinMark(), btn("buy", "Preview", () => openCard("buy")))
        return
      }
      if (row.thin) {
        /**
         * A THIN ASSET IS STILL THE READER'S OWN WALLET. This branch used to
         * return before the balance was ever mounted, so the same reader saw
         * their face and their money on one chip and neither on the next —
         * reported from the field as exactly that. Liquidity is a fact about
         * the ASSET; the balance is a fact about the READER, and one has no
         * business hiding the other.
         */
        const mark = document.createElement("span")
        mark.className = "thin"
        mark.textContent = "thin"
        // The word is the warning; the explanation is one press away rather
        // than in a native tooltip sitting between the wallet and the key.
        // Trade opens the CARD, and the card shows the quote and the price
        // impact before any money moves — which is the same sentence this
        // title used to spend a hover on. (While PAGE_CARD_ENABLED is off,
        // the openTrade dep routes this key to the sidebar on the asset.)
        mark.setAttribute("aria-label", "Thin liquidity — a small buy moves the price")
        renderEnd(
          poppinMark(),
          bellChip(),
          walChip(),
          mark,
          btn("buy", "Trade", () => openCard("buy")),
        )
        return
      }
      /**
       * TWO WORDS, AND THE AMOUNT IS NOT ONE OF THEM.
       *
       * The button carried the clip for a while ("Buy $25"), on the
       * argument that a resting chip should say what a press will spend.
       * The argument was sound and the place was wrong: this row is in
       * somebody's timeline all day, and a number that changes per reader
       * makes two identical chips look like two different products. The
       * disclosure survives anyway — Buy opens the SHEET, and the sheet
       * shows the amount before any money moves. Nothing is hidden; it is
       * one beat later, in the place a decision is actually made.
       *
       * The clip still seeds that sheet, so the memory does its work
       * without spending a word on the face.
       */
      const buyBtn = btn("buy", "Buy", () => {
        // A hold that armed already spent the press; the click that
        // follows the finger up must not ALSO open a sheet over the
        // receipt of the buy it fired.
        if (heldFired) {
          heldFired = false
          return
        }
        if (halt()) return
        track("x_strip_click", { mint: row.mint, side: "buy", tier })
        // Straight into the sheet, market mode, seeded with the clip so the
        // label and the field agree. There used to be a preset row here
        // ($10 $25 $100) that could not take a typed amount — "10 25 100
        // dışında amount giremiyorum" — and one more state between the
        // reader and the field is one more thing to learn.
        showSheet({ side: "buy", kind: "market", usd: clip.usd })
      })
      /**
       * HOLD TO RE-BUY: press and keep pressing, and the clip fires as a
       * market buy with no sheet — the degen's second scoop of the same
       * coin, made one gesture. The sweep across the key is the countdown
       * and the disclosure window in one: letting go before it completes
       * is a plain tap that opens the sheet, where the amount is on screen
       * before any money moves — so the number is never hidden and nothing
       * is lost by never learning the gesture. The receipt that follows is
       * runBuyMarket's own — counting dollars, Share, the whole ceremony.
       *
       * The amount used to ride a `title`, i.e. a box that opened and shut
       * on this exact key while the pointer moved between it and Sell (see
       * mountStrip's note). It rides the ACCESSIBLE NAME instead: spoken on
       * request, never painted, and it still leads with the word "Buy" so
       * voice control and a screen reader both still find the key by the
       * label written on it.
       */
      let heldFired = false
      let holdT: ReturnType<typeof setTimeout> | undefined
      /**
       * SELF-PRUNING, the way walRefreshers next door already is.
       *
       * This closure holds buyBtn, which holds the shadow root, which
       * holds the whole chip. Added on every chip that renders a Buy and
       * never removed, it was the SECOND registry in this file keeping
       * every recycled chip alive for the life of the tab — the same leak
       * as tickTargets, found only by sweeping for the shape after fixing
       * the instance. Fixing one and not looking for the others is how the
       * second one survived.
       */
      const setHoldLabel = () => {
        buyBtn.setAttribute("aria-label", `Buy — hold to buy $${clip.usd} instantly`)
      }
      /**
       * THE FIRST PAINT IS NOT GATED, and the spec caught me gating it: a
       * chip is BUILT before it is mounted, so host.isConnected is still
       * false here and the label would never be set at all. The guard
       * belongs on the repeat calls, which is where the leak was.
       */
      setHoldLabel()
      const relabelHold = () => {
        if (!host.isConnected) {
          clipLabels.delete(relabelHold)
          return
        }
        setHoldLabel()
      }
      clipLabels.add(relabelHold)
      const disarmHold = () => {
        clearTimeout(holdT)
        buyBtn.classList.remove("holding")
      }
      buyBtn.addEventListener("pointerdown", () => {
        if (halt()) return
        heldFired = false
        buyBtn.classList.add("holding")
        clearTimeout(holdT)
        holdT = setTimeout(() => {
          heldFired = true
          buyBtn.classList.remove("holding")
          track("x_strip_hold_buy", { mint: row.mint, usd: clip.usd, tier })
          void runBuyMarket(clip.usd)
        }, HOLD_BUY_MS)
      })
      buyBtn.addEventListener("pointerup", disarmHold)
      buyBtn.addEventListener("pointerleave", disarmHold)
      buyBtn.addEventListener("pointercancel", disarmHold)
      renderEnd(
        poppinMark(),
        bellChip(),
        walChip(),
        buyBtn,
        btn("sell", "Sell", () => {
          if (halt()) return
          track("x_strip_click", { mint: row.mint, side: "sell", tier })
          // The sheet speaks sell too. Bouncing sells to the page card was
          // the pre-sheet arrangement, and it made the two directions feel
          // like two products.
          showSheet({ side: "sell", kind: "market" })
        }),
      )
      armHover(chip, "chip")
      armHover(buyBtn, "buy")
      void book()
        .then(() => {
          if (bookAuth === "signed-out" && host.isConnected) labelChartForGuest()
        })
        .catch(() => {})
      /* THE COACH IS NOT CALLED HERE ANY MORE. It hung off the mount, and
         a mounted chip is not a seen one: see the onSeen hook on
         seenWatch above, and the numbers that moved it there. */
    }

    /**
     * THE TRADE SHEET — the chip opens instead of compressing.
     *
     * This began as a limit-order state crammed into the pill's 32px tail:
     * three preset pills, an "@", a 76px number field and Place, on one line.
     * It grew a sheet, and then the shape of the sheet exposed the real
     * problem underneath: MARKET AND LIMIT WERE AT DIFFERENT DEPTHS. A market
     * buy was two taps in the pill; a limit buy was hidden behind a button
     * inside the amount row of that same pill. They are not parent and child,
     * they are the two ways to buy the same thing, and a reader deciding
     * between them was being asked to remember which menu each one lived in.
     *
     * So the sheet carries both axes as siblings, one segmented control each:
     *
     *        Buy | Sell        ← the direction
     *      Market | Limit      ← how the price is chosen
     *
     * Four combinations, one surface, and the answer to "what happens when I
     * press the button" is always readable in the same place. The pill keeps
     * its two-tap market buy: that path is fast and used, and a sheet is the
     * wrong tax on someone who already knows they want $25 of something.
     *
     * WHAT EACH MODE NEEDS is different, and pretending otherwise is what
     * made the old flow illegible. A buy is sized in dollars against a cash
     * balance; a sell is sized as a fraction of a holding, in the raw units
     * the server echoed back. A limit needs a price and the distance to it; a
     * market needs the impact of the size. The sheet shows exactly the fields
     * the chosen combination uses and none of the others.
     */
    type Side = "buy" | "sell"
    type Kind = "market" | "limit"
    interface SheetState {
      side: Side
      kind: Kind
      priceText: string
      usd: number
      pct: number
      /** USD escrowed in standing buys, filled once the orders land. */
      committedUsd?: number
    }

    /**
     * THE RADIUS MUST NOT OUTLIVE THE BOX. Removing the body takes one
     * frame; the corner radius was still easing back to 999px for another
     * 240ms, so a closed chip visibly rounded off around nothing. `closing`
     * kills the duration for that frame and is dropped on the next one, so
     * the OPENING keeps its easing — one movement, one timing, and no
     * movement at all when there is nothing left to move.
     */
    const closeInstantly = () => {
      chip.classList.add("closing")
      chip.classList.remove("open", "charted")
      requestAnimationFrame(() => chip.classList.remove("closing"))
    }

    const closeSheet = () => {
      sheetTick = null
      if (!shadow.querySelector(".sheet")) return
      shadow.querySelector(".sheet")?.remove()
      closeInstantly()
    }

    /**
     * GROW, DO NOT POP. The sheet and the chart used to appear at full
     * height in one frame — the radius morphed smoothly while the page
     * below jumped, which reads as a glitch wearing a transition. This
     * animates the HEIGHT from zero to measured and then releases it to
     * auto (a fixed height would clip the first content change). Closing
     * stays instant on purpose: dismissal should feel like obedience.
     * setTimeout rather than transitionend, because the fallback must fire
     * even where transitions do not run at all.
     */
    const expandIn = (el: HTMLElement, fromPx = 0) => {
      const target = el.scrollHeight
      if (!target || target === fromPx) return
      el.style.overflow = "hidden"
      el.style.height = `${fromPx}px`
      el.style.transition = `height ${JUICE.motionMs}ms ${JUICE.motionEase}`
      void el.offsetHeight
      el.style.height = `${target}px`
      /**
       * Release the moment the growth ENDS. The old release was a timer set
       * past the transition, and it held `overflow: hidden` through the
       * gap — so anything that arrived late (the social-proof line, a
       * balance that wrapped) was clipped against a height measured before
       * it existed, then jumped into place when the timer fired. The timer
       * survives only as the fallback for environments that fire no
       * transition events at all.
       */
      let released = false
      const release = () => {
        if (released) return
        released = true
        el.style.height = ""
        el.style.overflow = ""
        el.style.transition = ""
      }
      el.addEventListener("transitionend", release, { once: true })
      setTimeout(release, JUICE.motionMs + 80)
    }

    const closeChart = () => {
      if (!shadow.querySelector(".chart")) return
      shadow.querySelector(".chart")?.remove()
      closeInstantly()
      more.setAttribute("aria-expanded", "false")
    }

    /** One (mint, range) is fetched once per page; a tap is not a request. */
    const seriesCache = new Map<string, Promise<SeriesAnswer>>()

    const showChart = (range: SparkRange) => {
      // One expansion slot: a chart over a half-composed order would stack
      // two answers to two different questions.
      //
      // THE SHEET'S TAIL LEAVES WITH THE SHEET. Its × exists to close the
      // sheet; when the chart takes the slot instead, that × is a leftover
      // and the reader is left looking at a price line with no way to act
      // on it — reported live, and exactly backwards, because the chart is
      // the moment somebody is being convinced. Only the SHEET's tail is
      // restored: a trade in flight or a receipt owns its own tail and is
      // left alone.
      const hadSheet = Boolean(shadow.querySelector(".sheet"))
      /**
       * A RANGE TAP IS A REDRAW, NOT A RE-ARRIVAL. The chart rebuilds per
       * range (right: axes, series, markers all change), but replaying the
       * 0→N entrance visibly collapsed and regrew the chip for a one-row
       * data change. The old height carries across, same settle rule as
       * the sheet's flips.
       */
      const prevChart = shadow.querySelector<HTMLElement>(".chart")
      const chartFromPx = prevChart ? prevChart.offsetHeight : 0
      closeSheet()
      if (hadSheet) showIdle()
      closeChart()
      chip.classList.add("open", "charted")
      more.setAttribute("aria-expanded", "true")

      const wrap = document.createElement("div")
      wrap.className = "chart"

      const head = document.createElement("div")
      head.className = "chart-head"
      const ranges = document.createElement("div")
      ranges.className = "ranges"
      for (const r of SPARK_RANGES) {
        const b = btn("pick", r.toUpperCase(), () => showChart(r))
        if (r === range) b.classList.add("on")
        ranges.appendChild(b)
      }
      // No × here: the chevron above IS the door, it flips when open, and
      // three controls for one action inside a 430px pill is a puzzle.
      /**
       * LINE OR CANDLES. Two words, one control, on the row that already
       * holds the timeframes — a chart's two questions ("how long" and
       * "how shown") belong on one line, and a second row of chrome inside
       * a 430px pill is a puzzle.
       *
       * The candle option is only offered when the DATA can answer it. An
       * older server sends closes alone, and a toggle that leads to an
       * empty chart is worse than one that is not there.
       */
      /**
       * THE CURRENT VIEW'S OWN SHAPE, not its name. "Line" and "Candles"
       * were two words competing with six timeframe labels on one row, and
       * a chart type is the one thing that draws itself: a zigzag or three
       * little bars says it faster than any word, in any language, at a
       * third of the width.
       *
       * It shows what you are LOOKING AT and toggles to the other, which
       * is the convention every charting surface uses; the title carries
       * the sentence for anyone who wants it and for a screen reader,
       * which cannot see a glyph at all.
       */
      const LINE_ICON =
        '<svg viewBox="0 0 14 12" aria-hidden="true"><polyline points="1,9 4.5,5 7.5,7.5 13,2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      const CANDLE_ICON =
        '<svg viewBox="0 0 14 12" aria-hidden="true">' +
        '<path d="M3 1v10M7 0.5v11M11 2v8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' +
        '<rect x="1.6" y="3.5" width="2.8" height="5" rx="0.7" fill="currentColor"/>' +
        '<rect x="5.6" y="2.5" width="2.8" height="4" rx="0.7" fill="currentColor"/>' +
        '<rect x="9.6" y="4" width="2.8" height="4.5" rx="0.7" fill="currentColor"/>' +
        "</svg>"

      const viewBtn = btn("view", "", () => {
        chartView = chartView === "candle" ? "line" : "candle"
        deps.chartView?.write(chartView)
        for (const apply of chartViewSwitches) apply(chartView)
      })
      /**
       * Two jobs, deliberately separated.
       *
       * `dress` is the icon and its words, and is safe at any moment —
       * including now, while the button has no parent yet. The label used
       * to be a plain string handed to btn(), which needed no such care;
       * an icon does, because it has to change when the view does.
       *
       * `applyView` is dress PLUS a redraw: what a reader pressing the
       * toggle wants, and what a flip on another chip has to propagate.
       * It is NOT safe before the first fetch lands, since paint() needs a
       * series, so the initial state dresses only and the first real paint
       * still arrives with the data.
       *
       * Folding the two into one call here costs the chart: the
       * isConnected prune fires (no parent yet) and the button ships bare,
       * or the prune goes and paint() runs with nothing to draw.
       */
      const dress = (v: "line" | "candle") => {
        viewBtn.innerHTML = v === "candle" ? CANDLE_ICON : LINE_ICON
        viewBtn.setAttribute(
          "aria-label",
          v === "candle" ? "Candles — switch to the line" : "Line — switch to candles",
        )
        viewBtn.title = v === "candle" ? "Candles" : "Line"
      }
      const applyView = (v: "line" | "candle") => {
        // A chart that has since closed prunes itself off the broadcast.
        if (!viewBtn.isConnected) {
          chartViewSwitches.delete(applyView)
          return
        }
        dress(v)
        paint()
      }
      dress(chartView)
      chartViewSwitches.add(applyView)
      head.append(ranges, viewBtn)
      wrap.appendChild(head)

      const SVG = "http://www.w3.org/2000/svg"
      const svg = document.createElementNS(SVG, "svg")
      const W = 288
      const H = 72
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
      svg.setAttribute("preserveAspectRatio", "none")
      svg.classList.add("chart-svg")
      const line = document.createElementNS(SVG, "polyline")
      line.setAttribute("fill", "none")
      line.setAttribute("stroke-width", "1.5")
      line.setAttribute("vector-effect", "non-scaling-stroke")
      svg.appendChild(line)
      /** The candle view's own layer. Only one of the two is ever filled. */
      const candleG = document.createElementNS(SVG, "g")
      svg.appendChild(candleG)

      /**
       * The scrub overlays live OUTSIDE the svg, in page pixels: with
       * preserveAspectRatio none the viewBox stretches, and a circle drawn
       * inside would render as an ellipse of whatever the stretch is.
       */
      const plot = document.createElement("div")
      plot.className = "plot"
      const guide = document.createElement("div")
      guide.className = "scrub-line"
      const dot = document.createElement("div")
      dot.className = "scrub-dot"
      plot.append(svg, guide, dot)
      wrap.appendChild(plot)

      /**
       * The footer is the chart's voice. At rest: when the window starts,
       * the min–max it covered, and "now" at the right edge — the axis the
       * sparkline never had. Under a pointer: the exact moment and price
       * beneath the finger, which is the "hangi günde nereye gelmiş" that
       * a bare line cannot answer.
       */
      const foot = document.createElement("div")
      foot.className = "chart-foot"
      const t0 = document.createElement("span")
      t0.className = "t0"
      const note = document.createElement("div")
      note.className = "chart-note"
      note.textContent = "…"
      const t1 = document.createElement("span")
      t1.className = "t1"
      foot.append(t0, note, t1)
      wrap.appendChild(foot)

      /**
       * MARKET CAP, LIVE, UNDER THE CHART.
       *
       * Asked for straight ("grafikle birlikte current market cap canlı
       * olarak vermek de mantıklı olmaz mı") and it is: a memecoin's price
       * per token means nothing on its own — $0.008 is cheap or dear
       * depending entirely on how many exist — so the cap is the number
       * that actually says how big the thing is. It rides the SAME enrich
       * read the chip already made for the header, so the chart costs no
       * extra request, and it stays absent rather than guessing when the
       * feed has no cap for the mint.
       */
      const capLine = document.createElement("div")
      capLine.className = "chart-cap"
      capLine.hidden = true
      wrap.appendChild(capLine)
      void enrich(row.mint).then((m) => {
        if (!capLine.isConnected || !m || typeof m.mcap !== "number" || m.mcap <= 0)
          return
        // A wrapped mint's cap is the size of the wrapper, never the size
        // of the company. See helpers/safetyLine.
        if (!capIsMeaningful(m.issuer)) return
        capLine.textContent = `Market cap ${compactUsd(m.mcap)}`
        capLine.hidden = false
      })

      chip.appendChild(wrap)
      expandIn(wrap, chartFromPx)

      const key = `${row.mint}:${range}`
      /**
       * CACHE ANSWERS, NEVER SILENCES. A null here can be "this pool has no
       * week of history" or "one request missed its window" — the chip
       * cannot tell them apart, so it must not remember either for the
       * page's whole life. Measured live: a burst of range taps on $PUMP
       * stuck "No chart for this range" onto 4H, 1W and MAX while the very
       * same requests answered fine seconds later. Dropping the entry on
       * null makes the next tap a fresh question; the server's own cache
       * (short for failures, long for real absences) keeps the upstream
       * safe from the re-asking.
       */
      seriesCache.set(
        key,
        seriesCache.get(key) ??
          deps
            .series!(row.mint, range)
            .catch((): SeriesAnswer => ({ points: null, times: null, opens: null, highs: null, lows: null, failed: true }))
            .then((answer) => {
              // A FAILURE IS NEVER REMEMBERED; an absence is remembered for
              // the page. The server keeps the same two lines (short for
              // failures, long for real absences), and a page cache that
              // disagreed would freeze a wrong answer onto a range for the
              // whole session — measured on $PUMP as a burst of taps that
              // stuck "No chart" onto three ranges at once.
              if (answer.failed) seriesCache.delete(key)
              return answer
            }),
      )
      /**
       * The last answer, kept so flipping the view is a REDRAW and not a
       * refetch. Both views are two projections of one series; asking the
       * network again for a picture we already hold would be the slowest
       * possible way to change a picture.
       */
      let held: SeriesAnswer | null = null
      let scrubWired = false
      const paint = () => {
        if (!held || !wrap.isConnected) return
        drawSeries(held, JUICE.motionMs)
      }
      /**
       * The chart's arrival, in the one place that owns the movement
       * (helpers/lineDraw.ts). Which of the two weights this chip uses is
       * decided at the call site below: the ceremony is for an opening,
       * never for a range tap.
       */
      const swan = (ms: number) =>
        drawLineFromLeft(line as unknown as SVGGeometryElement, ms, JUICE.drawEase)
      const drawSeries = (answer: SeriesAnswer, drawMs = 0) => {
        const g = sparkGeometry(answer.points, W, H)
        if (!g.points) {
          /**
           * TWO KINDS OF NOTHING, said differently.
           *
           * An absence is a fact about the asset and worth stating: a
           * token minted this morning HAS no month of history. A failure
           * is a fact about us, it is temporary, and the reader can do
           * something about it — so it gets plain words and a way to
           * ask again. Printing the first sentence over the second is
           * what told $ANTHROPIC's reader there was no 1H chart while
           * sixty one-minute candles sat upstream.
           */
          if (answer.failed) {
            note.textContent = "Chart did not load."
            const again = btn("chart-retry", "Try again", () => {
              seriesCache.delete(key)
              showChart(range)
            })
            note.append(" ", again)
          } else {
            note.textContent = "No chart for this range"
          }
          return
        }
        /**
         * ONE OF THE TWO, never both. The candle view is only reachable
         * when the server actually sent opens, highs and lows — an older
         * build sends closes alone, and a toggle that leads to an empty
         * plot is worse than a toggle that is not offered.
         */
        const cg =
          chartView === "candle"
            ? candleGeometry(answer.opens, answer.highs, answer.lows, answer.points, W, H)
            : null
        const candled = Boolean(cg && cg.candles.length)
        viewBtn.hidden = !answer.opens
        candleG.replaceChildren()
        line.setAttribute("points", candled ? "" : g.points)
        line.style.display = candled ? "none" : ""
        if (!candled) swan(drawMs)

        if (candled && cg) {
          for (const c of cg.candles) {
            const colour = c.up ? GREEN : RED
            const wick = document.createElementNS(SVG, "line")
            wick.setAttribute("x1", c.x.toFixed(1))
            wick.setAttribute("x2", c.x.toFixed(1))
            wick.setAttribute("y1", c.yHigh.toFixed(1))
            wick.setAttribute("y2", c.yLow.toFixed(1))
            wick.setAttribute("stroke", colour)
            wick.setAttribute("stroke-width", "1")
            wick.setAttribute("vector-effect", "non-scaling-stroke")
            const body = document.createElementNS(SVG, "rect")
            body.setAttribute("x", (c.x - cg.bodyW / 2).toFixed(1))
            body.setAttribute("y", c.yBody.toFixed(1))
            body.setAttribute("width", cg.bodyW.toFixed(1))
            body.setAttribute("height", c.hBody.toFixed(1))
            body.setAttribute("fill", colour)
            candleG.append(wick, body)
          }
        }

        line.setAttribute("stroke", g.up ? GREEN : RED)
        // The signature glow, color-matched to the direction: the line is
        // the juiciest pixel on the chart and it should read lit, not drawn.
        // Candles do not get it — a hundred glowing rects is a smear.
        line.style.filter = candled
          ? "none"
          : `drop-shadow(0 0 4px ${g.up ? GREEN : RED}55)`
        dot.style.background = g.up ? GREEN : RED
        const fmt = (v: number) =>
          `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 6 : 2 })}`
        const atRest = `${fmt(g.min)} – ${fmt(g.max)}`
        note.textContent = atRest

        const pts = (answer.points ?? []).filter((v) => Number.isFinite(v))
        /**
         * THE AXIS READS THE CANDLES' OWN CLOCK when the server sends it.
         * pointTimes spreads n points evenly across the range, which is
         * right only if a candle exists per interval — on a thin pool it
         * is how "1H" came to label a day and a half. The fallback stays
         * for older servers.
         */
        const times =
          answer.times && answer.times.length === pts.length
            ? answer.times
            : pointTimes(range, pts.length, Date.now())
        t0.textContent = times.length ? timeLabel(range, times[0]) : ""
        t1.textContent = "now"

        /**
         * THE READER'S OWN STORY ON THE LINE. Trades become dots riding the
         * price line at their moment (spot_trades stores no fill price, and
         * the line IS the honest y for "what it traded at around then");
         * standing orders become dashed levels at their trigger price,
         * labelled with the real number so a level clamped to the chart's
         * edge still tells the truth. Positions are percentages of the
         * viewBox, so they survive any CSS size without a resize listener.
         */
        const winStart = times[0] ?? 0
        const winEnd = times[times.length - 1] ?? winStart
        /**
         * PRICE → Y UNDER THE DOMAIN THIS VIEW ACTUALLY DREW. The line is
         * scaled on closes; candles are scaled on min(lows)..max(highs) —
         * a wider domain whenever any wick pokes past a close. Overlays
         * (marks, order levels, the entry line) used to map through the
         * close scale unconditionally, so in candle view every one of
         * them sat at a subtly wrong height against the candles they
         * were annotating. One mapper, chosen by the view, clamped the
         * same way priceToY clamps.
         */
        const levelY = (price: number): { y: number } => {
          if (candled && cg && cg.max > cg.min) {
            const raw = 3 + (H - 6) - ((price - cg.min) / (cg.max - cg.min)) * (H - 6)
            return { y: Math.min(H - 3, Math.max(3, raw)) }
          }
          return priceToY(pts, price, H)
        }
        const paintMine = () => {
          // The book alone is enough now: it carries the average entry.
          if (!deps.myTrades && !deps.listOrders && !deps.book) return
          /**
           * ONE read per chart, however many times the chart repaints.
           *
           * drawSeries used to fetch here directly, which was fine while
           * drawSeries ran once — and then the line/candle toggle made
           * repainting a thing a reader does. Every flip re-hit
           * /my-trades and /orders (breaking the "flipping is a REDRAW,
           * not a refetch" promise two hundred lines up) and appended a
           * fresh copy of every disc and order level over the last one:
           * two flips, three of each marker. Found by audit, and the
           * fetch-count spec existed all along — it only counted the
           * PRICE fetch, so the two reads nobody promised kept slipping
           * past it.
           */
          mineOnce ??= Promise.all([
            deps.myTrades ? deps.myTrades(row.mint).catch(() => null) : null,
            deps.listOrders ? deps.listOrders().catch(() => []) : [],
            // The page's one cached book, for the average-entry level. Not
            // a new read: every chip on the page shares bookOnce.
            book(),
          ])
          void mineOnce.then(([mine, orders, b]) => {
            if (!wrap.isConnected || !plot.isConnected) return
            // The canvas is clean or the story is wrong: a repaint that
            // only appends turns history into an echo.
            for (const old of plot.querySelectorAll(
              ".mark, .order-level, .order-tag, .entry-level, .entry-tag",
            )) {
              old.remove()
            }
            for (const tr of mine ?? []) {
              const x = timeToX(tr.ts, winStart, winEnd, W)
              if (x === null) continue
              /**
               * AT THE PRICE IT ACTUALLY FILLED, when the ledger knows it.
               * The ledger now records quantities, so the executed price
               * exists for new rows and the mark can sit at the truth
               * instead of riding the candle's close. Old rows (null) keep
               * riding the line — the honest y for "around then".
               */
              const filled =
                typeof tr.priceUsd === "number" &&
                Number.isFinite(tr.priceUsd) &&
                tr.priceUsd > 0
              let y: number
              if (filled) {
                y = levelY(tr.priceUsd as number).y
              } else {
                const i = Math.min(
                  pts.length - 1,
                  Math.max(0, Math.round(((x - 3) / (W - 6)) * (pts.length - 1))),
                )
                // The close at that moment, mapped through the VIEW's own
                // scale — sparkXY's y is the line's domain and floats off
                // the candles.
                y = levelY(pts[i]).y
              }
              const m = document.createElement("div")
              m.className = `mark ${tr.side === "sell" ? "s" : "b"}`
              m.style.left = `${(x / W) * 100}%`
              // THE TIP IS ON THE POINT. The arrow's body hangs off it —
              // below for a buy, above for a sell, which is the CSS's job —
              // so the shape carries a direction without ever being drawn
              // at a price the reader did not trade. Still clamped, so a
              // fill at the very top or bottom of the window stays inside
              // the plot instead of bleeding past the rounded corner.
              const yDot = Math.min(H - 8, Math.max(8, y))
              m.style.top = `${(yDot / H) * 100}%`
              m.title = `${tr.side === "sell" ? "Sold" : "Bought"}${
                filled ? ` at ${priceText(tr.priceUsd as number)}` : ""
              } · ${timeLabel(range, tr.ts)}`
              plot.appendChild(m)
            }
            for (const o of (orders ?? []).filter((o) => o.mint === row.mint)) {
              const { y } = levelY(o.triggerPriceUsd)
              const lvl = document.createElement("div")
              lvl.className = `order-level ${o.side === "sell" ? "s" : "b"}`
              lvl.style.top = `${(y / H) * 100}%`
              const tag = document.createElement("span")
              tag.className = `order-tag ${o.side === "sell" ? "s" : "b"}`
              tag.style.top = `${(y / H) * 100}%`
              tag.textContent = `${o.side === "sell" ? "S" : "B"} ${fmt(o.triggerPriceUsd)}`
              plot.append(lvl, tag)
            }
            /**
             * WHERE YOU GOT IN, as a line. The true average cost of what is
             * still held (the backend's avg-cost walk — sells re-average
             * it, so a profitable round trip cannot fake a basis). Neutral
             * ink, deliberately: green and red are verdicts, and an entry
             * is a fact. Skipped when nothing is held or the ledger
             * predates quantities — no line is better than a guessed one.
             */
            const held = b?.positions.find((p) => p.mint === row.mint)
            const entry = held?.avgEntryPriceUsd
            if (
              typeof entry === "number" &&
              Number.isFinite(entry) &&
              entry > 0 &&
              (held?.uiAmount ?? 0) > 0
            ) {
              const { y } = levelY(entry)
              const lvl = document.createElement("div")
              lvl.className = "entry-level"
              lvl.style.top = `${(y / H) * 100}%`
              const tag = document.createElement("span")
              tag.className = "entry-tag"
              tag.style.top = `${(y / H) * 100}%`
              // priceText, NOT the chart's own fmt: fmt caps at six
              // decimals and prints every sub-micro memecoin entry as
              // "$0" — the exact wall priceText was built to fix.
              tag.textContent = `You ${priceText(entry)}`
              plot.append(lvl, tag)
            }
          })
        }
        paintMine()

        // The scrub reads pts/times through `held`-refreshed closures, but
        // the LISTENERS must not stack: every repaint used to add another
        // pair, so a minute of line/candle flipping left a scroll of dead
        // handlers all firing per pointer move.
        if (scrubWired) return
        scrubWired = true
        svg.addEventListener("pointermove", (e) => {
          const rect = svg.getBoundingClientRect()
          if (rect.width <= 0) return
          const i = scrubIndex(e.clientX - rect.left, rect.width, pts.length, W)
          const { x, y } = sparkXY(pts, i, W, H)
          guide.style.left = `${(x / W) * rect.width}px`
          dot.style.left = `${(x / W) * rect.width}px`
          dot.style.top = `${(y / H) * rect.height}px`
          guide.style.display = "block"
          dot.style.display = "block"
          note.textContent = `${fmt(pts[i])} · ${timeLabel(range, times[i])}`
          note.classList.add("live")
        })
        svg.addEventListener("pointerleave", () => {
          guide.style.display = "none"
          dot.style.display = "none"
          note.textContent = atRest
          note.classList.remove("live")
        })
      }

      void seriesCache.get(key)!.then((answer) => {
        if (!wrap.isConnected) return
        const opening = held === null
        held = answer
        // The ceremony belongs to the chart OPENING. Every later answer on
        // this chip is a range the reader asked to compare.
        drawSeries(answer, opening ? JUICE.cinemaMs : JUICE.motionMs)
      })
    }

    /** Two labels, one live choice. The whole control is one row of pixels. */
    const segmented = (
      labels: readonly string[],
      activeIndex: number,
      onPick: (i: number) => void,
    ) => {
      const seg = document.createElement("div")
      seg.className = "seg"
      labels.forEach((label, i) => {
        const b = btn("segb", label, () => {
          if (i !== activeIndex) onPick(i)
        })
        b.setAttribute("aria-pressed", String(i === activeIndex))
        seg.appendChild(b)
      })
      return seg
    }

    const lblEl = (text: string) => {
      const d = document.createElement("div")
      d.className = "lbl"
      d.textContent = text
      return d
    }

    const showSheet = (init: Partial<SheetState> = {}) => {
      // A sheet that has just opened owes nothing to the last one.
      msgClaimed = false
      closeChart()
      const st: SheetState = {
        side: "buy",
        kind: "limit",
        priceText: "",
        usd: PRESET_USD[1],
        pct: 50,
        ...init,
      }
      /**
       * "ALL OF IT" SURVIVES THE TICKS. The amount field holds dollars and
       * the sell is cut as a share of a worth that moves every three
       * seconds, so a sheet seeded to the whole holding drifted to 99.x%
       * by the time the reader pressed, and left dust. Set when the sheet
       * seeds the whole position, when Max is pressed, or when the typed
       * figure is the worth to the cent; cleared when the reader types a
       * smaller number or picks a fraction. While set, the share is 100.
       */
      let sellAll = false
      /**
       * A FLIP IS NOT A SECOND ENTRANCE. Buy↔Sell and Now↔When-it-hits
       * rebuild the sheet (right: the two layouts differ), but replaying
       * the 0→N entrance made the page below jump up and ease back down
       * on every segment tap, mid-composition, while the reader's eye was
       * on the amount field. The old height is measured before teardown
       * and the new sheet grows FROM it - a settle, not a re-arrival.
       */
      const prevSheet = shadow.querySelector<HTMLElement>(".sheet")
      const fromPx = prevSheet ? prevSheet.offsetHeight : 0
      closeSheet()
      chip.classList.add("open")
      /**
       * AND THE TAIL IS NOT REBUILT EITHER — same rule, the half that was
       * missed. The height already settles across a flip (above), but this
       * line ran unconditionally, and renderEnd is `replaceChildren` plus a
       * 150ms opacity .35→1 fade: every Buy↔Sell and Now↔When-it-hits tap
       * DESTROYED the × the pointer might be resting on, built a new one,
       * and faded it in. A control that blinks out and back while somebody
       * is moving across it is the "it does not stay stable" report, and
       * this is the one place on the chip where a rebuild bought nothing —
       * the sheet's tail is a single stateless close button, identical
       * before and after the flip.
       *
       * Deliberately narrow. The same skip must NOT be generalised into
       * renderEnd itself: every other tail is rebuilt because its contents
       * carry state that has just changed (the bell's unread count, the
       * clip on Buy, a receipt), and a structural "looks the same" compare
       * would silently drop those.
       */
      const tail = end.firstElementChild
      const tailIsClose =
        end.children.length === 1 &&
        tail?.classList.contains("quiet") === true &&
        tail.textContent === "×"
      if (!tailIsClose) renderEnd(btn("quiet", "×", showIdle))

      const selling = st.side === "sell"
      const limit = st.kind === "limit"

      const sheet = document.createElement("div")
      // The side rides on the root so every accent below — preset hovers,
      // focus rings, pressed states — answers to the direction with one
      // selector instead of nine class toggles.
      /**
       * ...AND NOT A SECOND FADE. `.sheet` carries `animation: sheetIn`,
       * which is an opacity 0→1 entrance, and rebuilding the sheet replays
       * it — so the surface the reader was reading blinked out and back on
       * every segment tap while its height was politely settling. Height
       * and opacity were describing the same event and disagreeing about
       * whether it had happened. `settled` says it did not: a flip is a
       * REPLACEMENT of a surface that is already on screen, so only the
       * height moves. A first open has no previous sheet and keeps its
       * entrance.
       */
      sheet.className = selling ? "sheet side-sell" : "sheet"
      if (prevSheet) sheet.classList.add("settled")

      /**
       * TWO AXES, NOT TWO PEERS.
       *
       * Buy and Sell are the decision; Market and Limit are how that decision
       * is priced. Drawn as identical side-by-side controls they read as one
       * four-way choice, and the direction — the half that moves money and
       * the half that has a colour — loses the weight it has earned. So the
       * side keeps the full-width control it had, and the type becomes a
       * quiet switch riding above it: legible, one tap, never competing.
       */
      /**
       * The amount rides across the switch, which looks wrong the first
       * time you see "$25" over "You hold 0" and is not. The field is in
       * dollars on both sides, so "sell $25 worth" is a good sentence for
       * anyone holding that much, and the one case where it is not — a
       * reader holding nothing — is already answered in words by the door
       * below: "Nothing to sell". That is louder than the stale figure.
       *
       * Tried and reverted, twice, in the order the reasoning improved:
       * clearing it always, then clearing it when the position could not
       * cover it. Both broke three specs that sell by switching sides, and
       * the specs are right — the carry is what makes a two-step sale one
       * step. The buy side's mismatch was worth fixing because only a
       * small grey line admitted it; this one says itself.
       */
      const sideSeg = segmented(["Buy", "Sell"], selling ? 1 : 0, (i) =>
        showSheet({ ...st, side: i === 0 ? "buy" : "sell" }),
      )
      sideSeg.children[1].classList.add("sell-on")

      const kindSwitch = document.createElement("div")
      kindSwitch.className = "kind"
      // NAME THE BEHAVIOUR, NOT THE TAXONOMY. "Market order" / "Limit
      // order" is an exchange's vocabulary a reader has to have learned
      // elsewhere; these are the same two taps described by what they do.
      for (const [i, label] of ["Now", "When it hits"].entries()) {
        const b = btn("kindb", label, () => {
          if ((i === 1) !== limit) showSheet({ ...st, kind: i === 0 ? "market" : "limit" })
        })
        b.setAttribute("aria-pressed", String((i === 1) === limit))
        kindSwitch.appendChild(b)
      }

      const tabs = document.createElement("div")
      tabs.className = "tabs"
      tabs.append(sideSeg)

      // ── the price leg, limit only ───────────────────────────────────────
      const input = document.createElement("input")
      input.className = "price-in"
      // text, NOT number: number inputs are locale-aware and a Turkish
      // Chrome silently refuses the dot every formatter here prints.
      input.type = "text"
      input.inputMode = "decimal"
      input.placeholder =
        lastUsd !== null ? formatTriggerPrice(lastUsd).replace("$", "") : "0.00"
      input.value = st.priceText
      const dist = document.createElement("span")
      dist.className = "dist"

      const box = document.createElement("div")
      box.className = "price-box"
      const cur = document.createElement("span")
      cur.className = "cur"
      cur.textContent = "$"
      box.append(cur, input)
      const field = document.createElement("div")
      field.className = "field"
      field.append(box, dist)

      /**
       * THE FREE STEP. A limit order needs money; "tell me when it gets
       * there" needs nothing, and it is the sentence half of X is already
       * saying under every chart. The bell parks the typed price as an
       * alert: no funds, no floor, no escrow — a tap on the shoulder,
       * decide then.
       */
      if (deps.saveAlert) {
        const bell = btn("bell", "", () => {
          const typedUsd = Number(input.value)
          const alert = makeAlert({
            mint: row.mint,
            symbol: ticker,
            targetUsd: typedUsd,
            marketUsd: lastUsd,
            now: Date.now(),
          })
          if (!alert) {
            msg.textContent =
              input.value.trim() === "" ? "Type a price to set an alert" : "No live price yet"
            msg.className = "msg err"
            msgRow.className = "msg-row"
            input.focus()
            return
          }
          void deps.saveAlert!(alert).then((added) => {
            if (!msg.parentElement) return
            track("x_price_alert", { mint: row.mint, added, tier })
            msg.textContent = added
              ? `Alert set: ${alert.direction === "above" ? "reaches" : "drops to"} $${input.value}`
              : "That alert is already set"
            msg.className = "msg ok"
            msgRow.className = "msg-row"
          })
        })
        // The SHARED bell, same as the row's, drawn at birth: it used to be
        // painted inside the click handler, so the button was an empty box
        // until somebody clicked it once.
        bell.innerHTML = BELL_GLYPH
        bell.querySelector("svg")?.setAttribute("aria-hidden", "true")
        bell.title = "Alert me at this price, no order needed"
        bell.setAttribute("aria-label", "Alert me at this price, no order needed")
        field.append(bell)
      }

      // ── the size leg ────────────────────────────────────────────────────
      /**
       * A TYPED AMOUNT, and the presets fill it.
       *
       * The chip used to offer three preset pills and nothing else, which is
       * fine for a reader who wants exactly $25 and a dead end for everyone
       * else. The card has always let the amount be typed; this is the same
       * control, so the two surfaces stop being two products.
       *
       * ONE UNIT, which is the reason the sell presets are percentages that
       * SET a dollar figure rather than a separate percentage state. A sheet
       * where the amount is dollars on one side and a fraction on the other
       * makes the reader hold two mental models for one field.
       */
      const amountWrap = document.createElement("div")
      amountWrap.className = "amount"
      const amountCur = document.createElement("span")
      amountCur.className = "amount-cur"
      amountCur.textContent = "$"
      const amountIn = document.createElement("input")
      amountIn.className = "amount-in"
      amountIn.type = "text"
      amountIn.inputMode = "decimal"
      amountIn.placeholder = "0"
      amountIn.value = st.usd > 0 ? String(st.usd) : ""
      amountWrap.append(amountCur, amountIn)

      /* A NEW AMOUNT IS A NEW INTENT, so the last outcome stops owning the
         message line. Without this the claim would be permanent and the
         sheet could never speak for itself again. */
      const setAmount = (usd: number) => {
        st.usd = usd
        amountIn.value = usd > 0 ? String(Number(usd.toFixed(2))) : ""
        msgClaimed = false
        verdict()
      }
      amountIn.addEventListener("input", () => {
        const clean = normalizeDecimal(amountIn.value)
        if (clean !== amountIn.value) amountIn.value = clean
        const n = Number(clean)
        st.usd = Number.isFinite(n) && n > 0 ? n : 0
        const typedWorth = me && lastUsd !== null ? me.uiAmount * lastUsd : null
        sellAll = typedWorth !== null && typedWorth > 0 && st.usd >= typedWorth - 0.005
        msgClaimed = false
        verdict()
      })

      const sizes = document.createElement("div")
      sizes.className = "picks"
      /**
       * BOTH SIDES SET FRACTIONS OF A THING THAT HAS A SIZE.
       *
       * The sell side always did: 25% / 50% / Max of the position. The buy
       * side used to be an adding keypad (+$10 +$25 +$100) — and the first
       * live reader with $9.49 in the wallet asked, reasonably, where his
       * balance was and why the buttons ignored it. With the book in hand
       * the buy has a size too: the spendable pocket. So the chips become
       * 25% / 50% / Max of what the buy can actually spend, and the two
       * sides finally speak one grammar. Fractions do not add — Max twice
       * is not 200% — so these SET the field; the field itself stays free
       * for any number the reader wants to type.
       *
       * Only while the book is unknown do the old +$ presets appear, as a
       * keypad for a number nobody can size yet; they are relabelled the
       * moment the reader lands (takeReader → repaintPicks).
       */
      /**
       * One line, in the sheet's own message row, late-bound because the
       * row is built below this. Used by the size buttons to explain
       * themselves instead of dying quietly.
       */
      const tell = (text: string) => {
        const el = sheet.querySelector<HTMLElement>(".msg")
        if (!el) return
        el.textContent = text
        el.className = "msg"
        const row = el.parentElement
        if (row) row.className = text ? "msg-row" : "msg-row quiet"
      }

      /**
       * What a buy can spend: USDC, full stop.
       *
       * This was max(USDC, SOL) from the two-pocket era. The SOL pocket was
       * retired 2026-08-28 and a buy spends USDC alone — so with $0 USDC and
       * $50 of SOL, Max wrote $50 into a sheet whose own line reads
       * "USDC balance $0.00" and whose button then turned into "Deposit
       * USDC". The size buttons must offer money the Confirm can actually
       * spend.
       */
      const spendableUsd = () => (me === null ? null : me.cashUsd)

      /** The sized buy grammar: a quarter, half, all of the pocket. The
       *  index maps the same three buttons the unsized keypad uses. */
      const BUY_PCTS = [25, 50, 100] as const

      const paintBuyPick = (b: HTMLButtonElement, i: number) => {
        const cap = spendableUsd()
        if (cap !== null && cap > 0) {
          const pct = BUY_PCTS[i] ?? 100
          b.textContent = pct === 100 ? "Max" : `${pct}%`
        } else {
          b.textContent = `+$${PRESET_USD[i] ?? PRESET_USD[0]}`
        }
      }

      const sizeBtns = (selling ? SELL_PCTS : PRESET_USD).map((v, i) => {
        const b = btn("pick", selling ? (v === 100 ? "Max" : `${v}%`) : `+$${v}`, () => {
          if (selling) {
            /**
             * A percentage of the position, expressed in the one unit the
             * field speaks.
             *
             * A DEAD BUTTON MUST SAY WHY. This used to `return` in silence
             * whenever the holding had not arrived or the price was
             * unknown, so a reader tapping Max on a position they could
             * see in the panel got nothing at all — no motion, no message,
             * nothing to act on. Silence is the failure mode this codebase
             * keeps rediscovering; the reasons are different every time
             * and the symptom is always "I pressed it and nothing
             * happened".
             */
            if (me === null) {
              tell("Reading your balance…")
              void readerFor(row.mint, true).then((r) => {
                if (!bal.parentElement) return
                // EVERY path clears the waiting line. Leaving it up on a
                // failed read is the same silence in a politer font.
                if (r === null) {
                  tell("Could not read your balance. Try again.")
                  return
                }
                me = r
                verdict()
                const w = lastUsd !== null ? r.uiAmount * lastUsd : null
                if (w !== null && w > 0) {
                  tell("")
                  sellAll = v === 100
                  setAmount((w * v) / 100)
                } else {
                  tell(r.uiAmount > 0 ? "Waiting for a price…" : `No $${ticker} to sell`)
                }
              })
              return
            }
            if (lastUsd === null) {
              tell("Waiting for a price…")
              return
            }
            const worth = me.uiAmount * lastUsd
            if (worth <= 0) {
              tell(`No $${ticker} to sell`)
              return
            }
            sellAll = v === 100
            setAmount((worth * v) / 100)
          } else {
            const cap = spendableUsd()
            if (cap !== null && cap > 0) {
              // A quarter, half, or all of the spendable pocket, floored
              // to the cent. Max is the whole pocket: the buy the balance
              // line already promised is one tap, not mental arithmetic.
              const pct = BUY_PCTS[i] ?? 100
              setAmount(pocketPick(cap, pct))
            } else {
              // No book yet: the old keypad, adding.
              setAmount(st.usd + v)
            }
          }
        })
        return b
      })
      sizes.append(...sizeBtns)
      /** Relabel the buy chips when the reader lands or refreshes. */
      const repaintPicks = () => {
        if (selling) return
        ;[...sizes.querySelectorAll<HTMLButtonElement>(".pick")].forEach(
          (el, i) => paintBuyPick(el, i),
        )
      }

      // ── the footer ──────────────────────────────────────────────────────
      const bal = document.createElement("span")
      bal.className = "bal"
      const msg = document.createElement("span")
      msg.className = "msg"
      const go = btn("place", "Place order", () => onGo())
      const msgRow = document.createElement("div")
      msgRow.className = "msg-row quiet"
      msgRow.append(msg)

      const foot = document.createElement("div")
      foot.className = "foot"
      foot.append(bal, go)

      const head = document.createElement("div")
      head.className = "head"
      // "When it hits" places a standing order, which the Arc edition does not have.
      head.append(tabs, ...(CAP.orderWatch ? [kindSwitch] : []))
      /**
       * AMOUNT FIRST, PRICE SECOND, on every surface.
       *
       * The amount is asked in both modes; the price only in one. Putting the
       * conditional field last means switching Market to Limit GROWS the
       * sheet downward instead of pushing the amount the reader was just
       * looking at further down the screen.
       */
      /**
       * SOCIAL PROOF, behind the tap. "12 bought from this tweet" is the
       * one number on a trading surface that moves a reader, it is counted
       * from receipts (distinct authors, never posts), and it arrives
       * quietly after the sheet is usable — never blocking it.
       */
      const proofEl = document.createElement("div")
      proofEl.className = "proof"
      proofEl.hidden = true
      // No "Amount" label: the field wears a $ and sits in a trade sheet,
      // so the word was a third way of saying the same thing. The advice
      // that shrinking this sheet would crowd it was right — the answer is
      // one fewer element, not smaller ones.
      sheet.append(head, proofEl, amountWrap, sizes)
      if (deps.pageProof) {
        let pf = proofCache.get(tweetUrl)
        if (!pf) {
          pf = deps.pageProof(tweetUrl).catch(() => null)
          proofCache.set(tweetUrl, pf)
        }
        void pf.then((r) => {
          // Three is the floor, and it is a privacy line, not a taste one:
          // "1 bought from this tweet" under a reply that says "aped in"
          // names that person's spend. An aggregate that can be un-averaged
          // is not an aggregate.
          if (!r || r.buyers < 3 || !proofEl.parentElement) return
          proofEl.textContent = proofText(r.buyers)
          proofEl.hidden = false
        })
      }
      if (limit) {
        sheet.append(
          lblEl(selling ? `Sell $${ticker} at` : `Buy $${ticker} when it drops to`),
          field,
        )
      }
      if (!isCuratedMint(row.mint)) {
        // Nobody reviewed this one; the gate admitted it on numbers alone.
        // Said at the moment of the money button, like every honest label.
        const warn = document.createElement("div")
        warn.className = "unverified"
        warn.textContent = "⚠ Unverified token"
        warn.title =
          "Not in Poppin's reviewed catalog. It passed automated liquidity, holder and age checks only."
        sheet.append(warn)
      }
      /**
       * WHAT THIS AMOUNT COSTS IN SLIPPAGE — restored, deliberately.
       *
       * The line died as a side effect of 49d44420: the confirm screen it
       * lived on was deleted and nobody decided to lose the number, so its
       * dep, its CSS and its spec mock sat orphaned while the sheet
       * quoted nothing. On the memecoin tail this product exists for, the
       * difference between 0.2% and 4% impact IS the trade, and the row's
       * "thin" tier only answers it per-asset, not per-amount.
       *
       * Quietly, and only when it is known: nothing renders until a quote
       * answers, so a dead quote endpoint costs a blank line rather than a
       * spinner. Debounced behind the typing (450ms — the settle timing
       * the sheet already uses elsewhere), and only for MARKET orders: a
       * limit order names its own price, impact against the current pool
       * is an answer to a question it did not ask.
       */
      const cost = document.createElement("div")
      cost.className = "cost"
      cost.hidden = true
      /**
       * THE GATE'S EVIDENCE, said where size is decided. The gate read the
       * pool's LP, age, holders and authorities before this mint was ever
       * allowed a sheet — and told the reader none of it, so the reader
       * alt-tabbed to a screener to learn what our server already knew.
       * Rides the enrich the header already made: zero extra requests.
       * Absent evidence renders NOTHING (helpers/safetyLine's rules);
       * amber only for a live authority, because the floors are already
       * enforced and a second verdict in colour is two governors.
       */
      const safe = document.createElement("div")
      safe.className = "safe"
      safe.hidden = true
      sheet.append(cost, safe, msgRow, foot)
      void enrich(row.mint).then((m) => {
        if (!safe.isConnected) return
        // A wrapped asset's mint and freeze authorities describe the
        // wrapper, not the company, and they are how the instrument works
        // rather than a hazard. See helpers/safetyLine.
        const line = wrapsSomethingElse(m?.issuer)
          ? null
          : safetyLine(m?.safety ?? null, m?.holderCount ?? null)
        /**
         * MARKET CAP LEADS THE LINE. The resting row dropped MC on purpose
         * ("the number lives one tap away in the sheet's safety line") and
         * the safety line then never carried it - so the one unit memecoin
         * size is spoken in was absent from the very surface where the
         * reader sizes a buy. Same enrich, zero new requests; absent stays
         * absent, never invented.
         */
        /**
         * SUPPRESSED FOR BRIDGE-WRAPPED COLLATERAL. Jupiter reports the cap
         * of the SOLANA mint, which for WBTC is the wrapped supply on this
         * chain — true, and not what "MC" promises. Reported from the field
         * as "$196.1M MC" beside a Bitcoin price. We do not hold the
         * underlying asset's cap, so the figure goes rather than gaining a
         * qualifier nobody asked for.
         */
        const cap =
          typeof m?.mcap === "number" && m.mcap > 0 && capIsMeaningful(m?.issuer)
            ? // "Market cap", not "MC" — the chart one tap away already
              // spells it out, and a chip that teaches two names for one
              // fact teaches neither (screenshots, 2026-09-20).
              `Market cap ${compactUsd(m.mcap)}`
            : null
        if (!line && !cap) return
        safe.textContent = [cap, line?.text].filter(Boolean).join(" · ")
        safe.classList.toggle("warn", Boolean(line?.warn))
        safe.hidden = false
      })
      let costTimer: ReturnType<typeof setTimeout> | undefined
      let costSeq = 0
      const askCost = () => {
        /**
         * THE QUOTE ONLY KNOWS ONE DIRECTION.
         *
         * /embed/asset/quote takes the mint as the OUTPUT (spot-swap.service
         * .ts: `quote(outputMint, amountUsd)`), so what comes back is the
         * impact of BUYING $X of this asset. The sell sheet was printing
         * that figure under a red Sell button, unlabelled — a number about
         * the opposite trade, on a money surface. It is roughly symmetric
         * on a deep pool and badly wrong on a thin one, and the reader has
         * no way to tell which they are looking at.
         *
         * Silence until there is a sell quote to ask for. A missing number
         * costs a reader nothing; a confident wrong one costs trust.
         */
        if (limit || selling || !deps.quote) return
        const usd = st.usd
        if (!(usd > 0)) {
          cost.hidden = true
          return
        }
        clearTimeout(costTimer)
        const mine = ++costSeq
        costTimer = setTimeout(() => {
          void deps.quote(row.mint, usd).then((q) => {
            // Sequenced, not just connected: a slow answer for $10 must
            // not land on a sheet now asking about $100.
            if (mine !== costSeq || !cost.isConnected || q === null) return
            const pct = q.priceImpactPct
            if (!Number.isFinite(pct)) return
            // "~<0.01%" read as "approximately less than", which is two
            // hedges for one number. The tilde belongs to a figure we are
            // rounding; "<0.01" is already the hedge.
            cost.textContent =
              pct < 0.01
                ? "<0.01% price impact"
                : `~${pct.toFixed(2)}% price impact`
            cost.classList.toggle("warn", pct >= 1)
            cost.hidden = false
          })
        }, 450)
      }
      askCost()
      sheetTick = () => verdict(true)
      chip.append(sheet)
      expandIn(sheet, fromPx)

      /**
       * WHAT THE READER CAN AFFORD is part of the verdict, not decoration.
       *
       * On a buy, a trigger order escrows its funds when it is CREATED, so
       * placing one above the cash balance is a round trip to a refusal — the
       * button becomes the door that fixes it instead of pretending. On a
       * sell, there is nothing to sell without a holding, and the honest
       * answer is to say so rather than to offer a control that cannot work.
       *
       * Until the number is known it stays out of the way. An unread balance
       * must never block a real order.
       */
      /**
       * THE DECISIONS ARE NOT THIS FILE'S ANY MORE.
       *
       * Everything below reads a view from the shared rulebook and paints
       * it. The chip is where the rules were learned, which is exactly why
       * it must not keep a private copy of them: the panel had already
       * fallen a correctness bug behind while this file was ahead, and the
       * only way that does not happen again is for all three surfaces to
       * ask one function the same question.
       */
      let me: Reader | null = null
      let latest = viewTradeSheet({
        ticker,
        marketUsd: lastUsd,
        reader: null,
        state: { ...st, priceText: input.value },
        walletOnPage,
      })

      // Asked once per page, on the first sheet anybody opens: the answer
      // cannot change while the page is open, and nobody should pay for it
      // on a feed they are only scrolling past.
      if (!walletAsked && deps.hasWallet) {
        walletAsked = true
        void deps.hasWallet().then((present) => {
          walletOnPage = present
          if (present && host.isConnected) verdict()
        })
      }

      /** Every write of the button's class goes through here, so the side
          can never be lost by editing one branch and forgetting another. */
      const paint = (cls: string) => (selling ? `${cls} sell-side` : cls)

      let wasArmed = false
      const verdict = (skipCost = false) => {
        // The field speaks dollars; a sell is CUT in raw units, so the
        // amount is carried through as the share of the holding it works
        // out to. Same conversion the card makes, in the same direction.
        const worth = me && lastUsd !== null ? me.uiAmount * lastUsd : null
        latest = viewTradeSheet({
          ticker,
          marketUsd: lastUsd,
          reader: me,
          walletOnPage,
          state: {
            ...st,
            priceText: input.value,
            pct: sellAll
              ? 100
              : worth !== null && worth > 0
                ? Math.min(100, Math.max(0, (st.usd / worth) * 100))
                : 0,
          },
        })
        const v = latest


        if (v.reading) {
          // The figure in the data voice, the words in the product's own —
          // "−10.3% vs now" reads as language rather than as a readout.
          const w = v.reading.word
          if (w && v.reading.text.endsWith(w)) {
            dist.replaceChildren(
              document.createTextNode(v.reading.text.slice(0, -w.length)),
            )
            const ws = document.createElement("span")
            ws.className = "dist-w"
            ws.textContent = w
            dist.appendChild(ws)
          } else {
            dist.textContent = v.reading.text
          }
          dist.className = v.reading.tone === "muted" ? "dist" : `dist ${v.reading.tone}`
        }

        if (v.balance) {
          // textContent, not innerHTML: a content script on somebody else's
          // page has no business parsing markup it assembled from strings.
          bal.textContent = v.balance.text
          bal.classList.toggle("low", v.balance.low)
        } else if (bookAuth === "signed-out") {
          // The sentence BEFORE the press: a signed-out reader used to
          // learn "Sign in to trade" only from the 401 after composing an
          // order. The tail door still handles the press itself.
          bal.textContent = "Sign in to trade"
          bal.classList.remove("low")
        }

        /* NOT WHILE AN ACTION OWNS THIS LINE. A tick that overwrites
           "Buying…" or a refusal makes the press look like it never
           happened. See msgClaimed. */
        if (!msgClaimed) msg.textContent = v.note ?? ""
        // An informational note (the whole-position statement) must not
        // wear the error red: it is the product agreeing, not objecting.
        msg.className = v.note ? (v.noteTone === "info" ? "msg" : "msg err") : "msg"
        msgRow.className = v.note ? "msg-row" : "msg-row quiet"
        // A live tick re-judges the READING; it must not also re-quote.
        if (!skipCost) askCost()

        for (const [i, b] of sizeBtns.entries()) {
          /**
           * THE BUY PICKS NEVER LIT UP, and it was arithmetic rather than
           * taste. The model computes `selected` as `v === state.usd` over
           * PRESET_USD ($10/$25/$100), while the chip relabels those same
           * three buttons to 25%/50%/Max and sets Math.floor(cap*pct)/100 —
           * a figure that essentially never equals a preset. So
           * aria-pressed was permanently false on the buy side and
           * .pick[aria-pressed="true"] never once fired: the reader tapped
           * a size and the button it belonged to said nothing, which is the
           * cheapest thing a surface can do.
           *
           * When the picks mean percentages, the pressed one is decided the
           * same way the sell side already decides it — by the amount the
           * tap would have produced, to the cent, so a hand-typed number
           * that happens to equal a quarter of the pocket lights the same
           * button. The model keeps owning the sell side and the unsized
           * keypad; this only answers the case it cannot see.
           */
          const cap = spendableUsd()
          const sized = !selling && cap !== null && cap > 0
          b.setAttribute(
            "aria-pressed",
            String(
              sized
                ? Math.abs(st.usd - Math.floor((cap * (BUY_PCTS[i] ?? 100)) / 100) / 100) < 0.005
                : (v.sizes[i]?.selected ?? false),
            ),
          )
        }

        go.textContent = v.action.label
        /**
         * SIGNED-OUT PRE-SWAPS THE PRIMARY. The rulebook arms a green
         * "Buy $25" for a null reader, and the press spent a full round
         * trip to fail into a 401 tail - the celebration dress on a doomed
         * press, shown to the exact person the funnel exists for. The
         * button says the true next step BEFORE the press, in the
         * not-a-trade dress the funding door already wears.
         */
        if (bookAuth === "signed-out") {
          go.textContent = "Sign in to trade"
        }
        const armed =
          v.action.armed && v.action.tone !== "fund" && bookAuth !== "signed-out"
        // Three states, three dresses. `armed` above stays what it was —
        // it gates the PULSE, and a funding button should not pulse like
        // an order that just became placeable. The class has to know about
        // funding separately, because a bright button that is not a trade
        // must not wear a trade's colour.
        const dress =
          v.action.tone === "fund" || bookAuth === "signed-out"
            ? "place fund-side"
            : paint(v.action.armed ? "place" : "place wait")
        go.className = dress
        if (armed && !wasArmed) {
          go.classList.remove("arm")
          void go.offsetWidth
          go.classList.add("arm")
        }
        wasArmed = armed
      }
      input.addEventListener("input", () => {
        const clean = normalizeDecimal(input.value)
        if (clean !== input.value) input.value = clean
        // Written BACK to the state, not only read from the DOM: flipping
        // Buy/Sell or Now/When-it-hits rebuilds the sheet from st, and the
        // amount survived that trip while the typed price vanished.
        st.priceText = clean
        verdict()
      })

      /** The button has ONE handler, and it reads the state it is wearing. */
      /**
       * ONE HANDLER, and it sends whatever the rulebook decided. The chip no
       * longer re-derives the plan here — a second derivation is a second
       * chance to disagree with the button the reader just read.
       */
      const onGo = () => {
        if (bookAuth === "signed-out") {
          track("x_signin_from_sheet", { mint: row.mint, tier })
          deps.signIn()
          return
        }
        if (latest.action.tone === "fund") {
          track("x_order_topup", { mint: row.mint, tier })
          /**
           * TOP UP WITHOUT LEAVING THE TWEET — ON A CUSTODIAL ACCOUNT.
           *
           * When the page has a wallet, topUp() moves USDC into the
           * reader's Poppin balance with one approval and resolves true;
           * the cached book is then a lie, so it goes, and the reader
           * presses Buy on the same sheet. When there is no wallet it opens
           * the panel exactly as before and resolves nothing, which is why
           * this awaits rather than assumes.
           *
           * A WALLET ACCOUNT TAKES THE OTHER ROAD AND SIGNS NOTHING. Its
           * USDC has to arrive in its own wallet, so topUp sends it to the
           * panel's address screen — "Add USDC to your wallet", carrying
           * this same shortfall so the screen can say what the buy needs —
           * and resolves false, which this branch already handles. There is
           * no conversion, no amount picker and no Phantom popup on that
           * side: pressing this must never put a trade in front of somebody
           * who pressed a funding button. The button above says so too —
           * the wallet-popup wording is gated on hasWallet, which answers
           * false for a wallet account (primary/main.tsx).
           */
          // The shortfall rides on the action itself. It used to be read
          // off the buy intent, which the fund tone never carries, so the
          // top-up always moved the $11 default under a "Top up $37.50".
          const spend = latest.action.fundUsd
          void Promise.resolve(
            deps.topUp(spend, undefined, {
              mint: row.mint,
              buyUsd: st.usd,
              ticker: row.ticker,
              sourceUrl: tweetUrl,
            }),
          ).then((funded) => {
            if (!funded || !host.isConnected) return
            bookOnce = null
            /**
             * NOT a bare verdict(): verdict reads the closure's stale `me`,
             * so cannotPay stayed true and the reader who JUST moved money
             * was told to move money - the one sentence this button must
             * never say to them. takeReader re-reads the book fresh,
             * updates `me`, re-verdicts, repaints the picks and the wal.
             */
            void readerFor(row.mint, true).then(takeReader)
          })
          return
        }
        const intent = latest.intent
        if (!intent) {
          input.focus()
          return
        }
        switch (intent.kind) {
          case "market-buy":
            void runBuyMarket(intent.usd)
            return
          case "market-sell":
            // The dollars ride along for the OUTCOME's sentence: the button
            // said "Sell $25", so the receipt must not switch to
            // "43.78234222748815%" - a unit the reader never chose, at a
            // precision nobody chose.
            void runSellMarket(intent.pct, me?.raw ?? null, st.usd)
            return
          case "limit-buy":
            void runOrder({ side: "buy", usd: intent.usd, price: intent.triggerPriceUsd })
            return
          case "limit-sell":
            void runOrder({
              side: "sell",
              amountRaw: intent.amountRaw,
              price: intent.triggerPriceUsd,
            })
        }
      }

      verdict()
      if (limit) input.focus()

      /**
       * WHAT IS ALREADY STANDING, shown where it was placed.
       *
       * An order used to disappear the second the sheet closed: the only
       * place to see or cancel it was the panel, a different surface and, on
       * X, a different frame of mind. Someone about to set a second trigger
       * at nearly the same price should not have to leave the tweet to find
       * out the first one exists.
       *
       * The exit is never gated. §7 can stop admitting a mint and the row
       * says so, but cancel stays lit — a reader must always be able to get
       * out of something they are already in.
       */
      const orders = document.createElement("div")
      orders.className = "open-orders"
      orders.hidden = true
      sheet.insertBefore(orders, foot)

      const paintOrders = (rows: Awaited<ReturnType<NonNullable<XStripDeps["listOrders"]>>>) => {
        const mine = rows.filter((o) => o.mint === row.mint)
        orders.hidden = mine.length === 0
        orders.replaceChildren()
        for (const o of mine) {
          /**
           * ONE SENTENCE PER ORDER, not a blotter row. This was four
           * columns — SIDE, size, "at", price, a status code, Cancel —
           * which is the grammar of an exchange's order book. What the
           * reader parked is a sentence: "Buying $50 if it hits $0.0042".
           * Only the two figures keep the data voice.
           */
          const line = document.createElement("div")
          line.className = "oo"
          const verb = document.createElement("span")
          verb.className = "oo-verb"
          verb.textContent = o.side === "sell" ? "Selling " : "Buying "
          const size = document.createElement("span")
          size.className = "oo-n"
          size.textContent =
            o.side === "buy" && o.amountUsd !== null
              ? `$${o.amountUsd}`
              // The quantity compacts the way every other count on this
              // surface does; the exact figure lives in the panel.
              : compactCount(o.amountUi)
          const mid = document.createElement("span")
          mid.className = "oo-verb"
          mid.textContent = " if it hits "
          const at = document.createElement("span")
          at.className = "oo-n"
          at.textContent = formatTriggerPrice(o.triggerPriceUsd)
          line.append(verb, size, mid, at)
          if (o.gated) {
            /**
             * AMBER STAYS — this is a real warning and the product does not
             * pretend those away — but "paused" was a status code with its
             * sentence hidden in a tooltip. The row says it in words.
             */
            const g = document.createElement("span")
            g.className = "oo-gated"
            g.textContent = "on hold · this market isn't taking new orders"
            g.title = "Cancelling still works."
            line.append(g)
          }
          line.append(
            btn("oo-x", "Cancel", () => {
              if (!deps.cancelOrder) return
              line.replaceChildren(note("", "Cancelling…"))
              void deps.cancelOrder(o.orderKey)
                .then(() => {
                  ordersOnce = null
                  void loadOrders()
                })
                .catch(() => {
                  line.replaceChildren(note("err", "Could not cancel"))
                })
            }),
          )
          orders.append(line)
        }
      }

      const loadOrders = () => {
        if (!deps.listOrders) return Promise.resolve()
        ordersOnce ??= deps.listOrders().catch(() => [])
        return ordersOnce.then((rows) => {
          if (orders.parentElement) paintOrders(rows)
          /**
           * WHERE THE MISSING MONEY WENT. A standing buy escrows its USDC
           * on chain, so the balance line correctly drops by that much —
           * and a reader who had parked $300 read the drop as money lost.
           * The orders are already in hand here; the total costs a sum.
           * Every mint counts, because the USDC pocket is one pocket.
           */
          const parked = rows
            .filter((o) => o.side === "buy")
            .reduce((sum, o) => sum + (o.amountUsd ?? 0), 0)
          if (parked !== st.committedUsd) {
            st.committedUsd = parked
            if (bal.parentElement) verdict()
          }
        })
      }
      void loadOrders()

      // The reader's numbers arrive late and quietly; the sheet is usable
      // without them and re-judges itself the moment they land.
      /**
       * TWO ANSWERS, IN ORDER. The remembered book paints the sheet
       * immediately; on the sell side a fresh read follows and corrects it
       * when it lands. Waiting for the fresh one first would mean a sheet
       * that says nothing for up to 8.6 seconds (the measured cold read).
       */
      /**
       * A SELL IS SIZED BY THE POSITION, NOT BY THE BUY'S DEFAULT. The
       * sheet used to open both sides at $25, so a $3 holding wore a
       * "Sell $25" it could never mean. Once the book lands, an untouched
       * sell field is reseeded to the holding's own worth — the number the
       * reader is actually deciding about. Only untouched: a figure the
       * reader typed is theirs, and a price tick later must not rewrite it
       * (seeded once, same rule as the homecoming).
       */
      let sellSeeded = false
      /**
       * AND A BUY IS SIZED BY THE POCKET, for exactly the same reason.
       *
       * The sell side learned this; the buy side did not, and the presets
       * beside it did. Measured on a live chip (screenshot, 2026-09-20):
       * $25 in the field, 25% / 50% / Max offering $0.88 / $1.77 / $3.53,
       * "USDC balance $3.53" below, and a button reading "Top up $22".
       * Four controls in one column, three of them describing a trade the
       * fourth says cannot happen.
       *
       * The rule this file already wrote for the presets applies here:
       * "the size buttons must offer money the Confirm can actually
       * spend." The default amount is a size control and was the last one
       * exempt from it.
       *
       * NOT THE SAME AS CLEARING THE FIELD, which was tried and reverted
       * because it took the funding door with it: a reader who is short
       * never learned that they were. A seeded amount leaves the balance
       * line, the presets and the Me view's Deposit door all in place —
       * what changes is that the sheet opens on a trade the reader can
       * make instead of on a demand for money they have not been asked
       * for yet.
       *
       * Only when the pocket is SMALLER than the default, only while the
       * field is untouched, and never up: someone with $400 still opens on
       * $25, because $25 is a first trade and $400 is a decision.
       */
      let buySeeded = false
      const takeReader = (r: Reader | null) => {
        if (!bal.parentElement || r === null) return
        me = r
        if (
          selling &&
          !sellSeeded &&
          st.usd === PRESET_USD[1] &&
          lastUsd !== null &&
          r.uiAmount > 0
        ) {
          sellSeeded = true
          const worth = r.uiAmount * lastUsd
          if (worth > 0) {
            sellAll = true
            setAmount(Number(worth.toFixed(2)))
          }
        }
        if (
          !selling &&
          // MARKET ONLY. A standing buy escrows its USDC the moment it is
          // created, so seeding one to the whole pocket would commit every
          // dollar the reader has to a price that may never come. The
          // limit sheet keeps its funding door, which is the honest answer
          // there: the money really does have to exist up front.
          !limit &&
          !buySeeded &&
          st.usd === PRESET_USD[1] &&
          r.cashUsd > 0 &&
          r.cashUsd < PRESET_USD[1]
        ) {
          buySeeded = true
          // The same cent-floored figure Max writes, so the field and the
          // preset beside it can never differ by a rounding.
          const all = pocketPick(r.cashUsd, 100)
          if (all > 0) setAmount(all)
        }
        verdict()
        repaintPicks()
        if (walUsd !== null && r.cashUsd > walUsd + 0.5) {
          // Money landed while the sheet was up. The button has already
          // turned itself from "Deposit $10 USDC" into "Buy $10" (the model
          // re-read the cash); the glow says why, the way a landed trade does.
          chip.classList.add("glow-ok")
          window.setTimeout(() => chip.classList.remove("glow-ok"), 1800)
        }
        walUsd = r.cashUsd
      }
      void readerFor(row.mint).then(takeReader)
      if (selling) void readerFor(row.mint, true).then(takeReader)
      /* THE BALANCE LINE STAYS TRUE WHILE THE SHEET IS UP. Money can land
         from another wallet while the reader looks at "$0.00", and it
         did: the sheet read the book once, at open. Now it re-reads every
         ten seconds while it is showing and the tab is visible, and at
         once when the background says a deposit landed. Self-pruning: the
         balance node leaving the sheet is the end of it. */
      const refreshSheet = () => {
        if (!host.isConnected || !bal.parentElement) {
          sheetRefreshers.delete(refreshSheet)
          window.clearInterval(sheetTimer)
          return
        }
        if (document.hidden) return
        void readerFor(row.mint, true).then(takeReader)
      }
      const sheetTimer = window.setInterval(refreshSheet, 10_000)
      sheetRefreshers.add(refreshSheet)
    }

    /**
     * WHERE AN OUTCOME IS READ.
     *
     * While the sheet is open the answer belongs IN it, beside the button
     * that was pressed; reporting into the pill's tail would put the answer
     * above the question. The closed-pill path still needs the tail, so both
     * exist and the open sheet wins. Doors out (sign in, top up) always take
     * the tail, because a door that leaves the page cannot live in a sheet
     * that is about to close.
     *
     * `parentElement`, not `isConnected`: inside a shadow root the latter
     * asks whether the SHADOW is a document and answers false for a node the
     * reader is looking at.
     */
    /**
     * HYPERCASUAL'S ONE HONEST TRICK: the number arrives by counting.
     * Runs the dollars 0 → amount in ~450ms; readers who asked their
     * system for reduced motion get the final number immediately, because
     * a count-up IS motion whatever technology draws it.
     */
    const countTo = (
      el: HTMLElement,
      from: number,
      to: number,
      fmt: (v: number) => string,
      /** Called once the figure has landed — on the instant path too, so a
       *  caller can hand the element on without knowing which path ran. */
      done?: () => void,
    ) => {
      /**
       * The clock here is Date.now, NOT deps.now — this is animation time,
       * and a test's frozen logic clock must not hold a count-up at $0.00
       * forever. Whether it may move at all is reducedMotion's question,
       * asked in one place for every animation in this file.
       */
      if (reducedMotion() || from === to || typeof requestAnimationFrame !== "function") {
        el.textContent = fmt(to)
        done?.()
        return
      }
      const t0 = Date.now()
      const MS = 450
      const tick = () => {
        const k = Math.min(1, (Date.now() - t0) / MS)
        // decelerate: fast out of the gate, gentle at rest (rule 7's curve)
        const eased = 1 - (1 - k) * (1 - k) * (1 - k)
        el.textContent = fmt(from + (to - from) * eased)
        if (k < 1 && el.isConnected) requestAnimationFrame(tick)
        else {
          el.textContent = fmt(to)
          done?.()
        }
      }
      requestAnimationFrame(tick)
    }
    /** The receipt's and the button's beat: 0 → the amount, in dollars. */
    const countUp = (el: HTMLElement, usd: number, prefix = "", done?: () => void) => {
      if (!(usd > 0)) {
        el.textContent = `${prefix}$${usd.toFixed(2)}`
        done?.()
        return
      }
      countTo(el, 0, usd, (v) => `${prefix}$${v.toFixed(2)}`, done)
    }

    const reporter = (
      busy: string,
      restore: string,
      doneExtras?: () => Element[],
      /** Buy hands its own receipt in; everything else keeps the note. */
      receipt?: (outcome: InlineBuyOutcome) => Element,
      /**
       * THE FIRST BEAT. When the caller knows the dollars at the moment of
       * the tap, the button counts to them instead of going grey and saying
       * "Buying…".
       *
       * The loudest moment this product owns was parked behind its two
       * slowest calls — swap, then confirm — and the reader spent it
       * looking at a grey verb. Nothing here waits for the network: the
       * amount is the one the reader just chose. What it buys is not
       * information, it is the machine answering in the same beat as the
       * finger, which is the whole of what "feels like a game" means on a
       * surface this small.
       *
       * A LEADING "~" AND NOT GREEN. Rule 4 does the safety work: green is
       * semantic here, so an in-flight number is structurally forbidden
       * from wearing the success dress, and the tilde says "asked for, not
       * yet landed" in one character. The exact figure, with units, arrives
       * on the receipt when the chain confirms.
       */
      busyUsd?: number,
      /**
       * WHICH DIRECTION LANDED. The sparks were green whatever happened,
       * so a SELL confirmed in the colour that means buy — on a surface
       * whose own comments call green "structurally forbidden" from
       * dressing anything that is not a landed buy (rule 4, and the note
       * above about the in-flight tilde makes the same argument).
       *
       * Absent for an order placement, which is neither direction landing
       * and gets the brand instead.
       */
      side?: "buy" | "sell",
    ) => {
      /**
       * LOOKED UP AGAIN EVERY TIME, NOT HELD.
       *
       * These used to be captured once, at the press. The press is not when
       * they are needed: a buy waits on a swap and then on a confirmation,
       * which is up to thirty seconds, and this sheet does not survive
       * thirty seconds untouched — a price tick, a re-render, X recycling
       * the cell underneath it and the nodes are replaced. The closure went
       * on writing into the ones it had, which by then were detached: the
       * outcome was set on an element no longer in the document, and the
       * sheet the reader was looking at said nothing at all.
       *
       * That is the whole of "I press Buy and nothing happens" as reported
       * on 2026-09-11 — the trade ran, the answer was written, and it was
       * written somewhere the reader could not see. A detached node still
       * has a parentElement, so every guard here passed while the write
       * went nowhere.
       *
       * Re-querying from the shadow root costs one selector match and can
       * only ever return something attached, which is the property the old
       * code assumed it had.
       */
      const findMsg = () => shadow.querySelector<HTMLElement>(".sheet .msg")
      const findBtn = () => shadow.querySelector<HTMLElement>(".sheet .place")
      const msgEl = findMsg()
      const btnEl = findBtn()
      const inSheet = Boolean(msgEl?.parentElement)
      /**
       * THE ROW IS HIDDEN UNTIL IT HAS SOMETHING TO SAY, and saying it means
       * un-hiding it. `.msg-row` ships `quiet` (display:none) so an empty
       * band never holds the sheet open — and every outcome that was not a
       * completed trade or a door was written into that hidden row and
       * vanished. Reported live as the worst possible symptom: "buy'a
       * basıyorum hiçbir şey olmuyor". One helper owns both halves now, so
       * a message and its visibility can never disagree again.
       */
      const say = (text: string, cls: string) => {
        // Live, because this is called both at the press and at the outcome.
        const el = findMsg()
        if (!el) return
        el.textContent = text
        el.className = cls
        const row = el.parentElement
        if (row) row.className = text ? "msg-row" : "msg-row quiet"
        // Claimed while there is something to say, released when cleared.
        msgClaimed = text !== ""
      }
      if (inSheet) {
        say("", "msg")
        if (btnEl) {
          btnEl.className = "place wait"
          if (busyUsd !== undefined && busyUsd > 0) {
            btnEl.textContent = ""
            /**
             * TWO BEATS, BECAUSE THE COUNT IS SHORTER THAN THE TRADE.
             *
             * The count answers in the same beat as the finger, which is the
             * point of it, and it is over in 450ms. A swap plus a confirm is
             * seconds. So the button spent almost all of the wait reading
             * "~$1.00" — a figure, holding still, in a colour that had
             * changed for reasons it never stated. Reported as exactly that:
             * the colour changes and nothing says it is working.
             *
             * The verb arrives when the number lands. It says the literal
             * thing, because money is moving and that is where this
             * product's voice goes plain: "Buying…", "Selling…", the same
             * words this reporter was already carrying and could not show.
             *
             * Guarded on `wait`, so a trade that beat the count home never
             * gets its finished button overwritten with a verb: the outcome
             * clears that class when it restores the label, and a closed
             * sheet takes the element off the tree entirely.
             */
            countUp(btnEl, busyUsd, "~", () => {
              if (btnEl.isConnected && btnEl.classList.contains("wait")) {
                btnEl.textContent = busy
              }
            })
          } else {
            btnEl.textContent = busy
          }
        }
      } else {
        /**
         * THE POWER GESTURE GETS THE BEAT TOO. Hold-to-buy is the loudest
         * thing this surface owns and it waited on a grey "Buying…" for a
         * swap plus a confirm, while the SHEET path counted "~$25" in the
         * same beat as the finger - the exact dead air the count-up was
         * built to kill, on the one press that skips the sheet entirely.
         */
        if (busyUsd !== undefined && busyUsd > 0) {
          const busyNote = note("", "")
          renderEnd(busyNote)
          countUp(busyNote as HTMLElement, busyUsd, "~")
        } else {
          renderEnd(note("", busy))
        }
      }
      const report = (outcome: InlineBuyOutcome) => {
        if (!host.isConnected) return
        /**
         * PENDING RE-ASKS THE CHAIN. "· confirming" used to be terminal:
         * the signature was dropped, nothing could re-poll, and the one
         * state where the reader is anxious about their money was the one
         * state the product stopped working in. Three bounded re-asks; a
         * confirmed upgrade runs the full done ceremony, a failure the
         * honest error, and after the last ask the line stays - still
         * true - without claiming what the chain would not.
         */
        if (outcome.kind === "pending" && outcome.signature && deps.trade) {
          const sig = outcome.signature
          const askAt = [2000, 6000, 15000]
          const reask = (i: number) => {
            if (i >= askAt.length || !host.isConnected) return
            setTimeout(() => {
              void deps.trade.confirm(sig).then(
                (settled) => {
                  if (!host.isConnected) return
                  if (settled.status === "confirmed") {
                    report({ ...outcome, kind: "done", text: outcome.text.replace(" · confirming", "") })
                  } else if (settled.status === "failed") {
                    report({ kind: "error", text: "The transaction failed on chain" })
                  } else {
                    reask(i + 1)
                  }
                },
                () => reask(i + 1),
              )
            }, askAt[i])
          }
          reask(0)
        }
        if (outcome.kind === "done") {
          closeSheet()
          // The beat: remove-reflow-add so a second trade pulses again.
          chip.classList.remove("glow-ok")
          void chip.offsetWidth
          chip.classList.add("glow-ok")
          chip.addEventListener(
            "animationend",
            () => chip.classList.remove("glow-ok"),
            { once: true },
          )
          // THE SPARKS. Eight of them leaving the spot where the receipt
          // lands — the game's coin sound, drawn. Born only when motion is
          // allowed: the reduced-motion blanket freezes animations, and
          // frozen confetti is permanent litter.
          //
          // They take the DIRECTION that landed. Green for a buy, red for
          // a sell, brand for an order that was merely placed.
          if (!reducedMotion()) {
            const burst = document.createElement("span")
            burst.className =
              side === "sell" ? "burst burst-sell" : side === "buy" ? "burst" : "burst burst-neutral"
            burst.style.right = "96px"
            burst.style.top = "50%"
            for (let i = 0; i < 8; i++) {
              const s = document.createElement("i")
              const ang = (i / 8) * Math.PI * 2 + 0.4
              const dist = 26 + (i % 3) * 9
              s.style.setProperty("--dx", `${Math.cos(ang) * dist}px`)
              s.style.setProperty("--dy", `${Math.sin(ang) * dist}px`)
              burst.appendChild(s)
            }
            chip.appendChild(burst)
            setTimeout(() => burst.remove(), 700)

            /* AND THE CHARACTER, which is the part the sparks were standing
               in for. Reported on 2026-09-11 as "çok kuru" — too dry — over
               a receipt that had just worked, and the reader was right: what
               landed was a tick, a number and eight dots, which is a
               notification, not a moment.
       
               The mark putting its sunglasses on is the one reward this
               brand owns, and the house note on it is old: confetti smells
               of AI, the thug-life choreography is the wanted register.
               Sparks stay — they carry the DIRECTION, in colours rule 4
               makes semantic — and the ghost carries the personality.
       
               Fetched from web_accessible_resources rather than baked in:
               34KB on the first trade that lands, and nothing at all on the
               pages that never see one. It plays once and takes itself off;
               under reduced motion it is never born, like the sparks above,
               because a frozen animation is litter rather than a reward. */
          }
          const said = receipt ? receipt(outcome) : note("ok", `✓ ${outcome.text}`)
          renderLanded(
            said,
            ...(doneExtras?.() ?? []),
            /**
             * THE RECEIPT IS A BEAT, NOT A TERMINUS. The chip that just
             * paid off was the one chip on the page that could no longer
             * trade - no ×, no Buy, until X happened to recycle the cell.
             * The exit is explicit now, and after a breath the row
             * re-offers itself: the second scoop is the loop's whole point.
             */
            btn("quiet", "×", showIdle),
          )
          /* A trade landed, so the receipt speaks: the seat if this trade
             just claimed one, otherwise the points and the invite. Orders
             merely placed do not count; money has to have moved. */
          if (side === "buy" || side === "sell") void afterLanding(said, busyUsd)
          /* AND THE CHARACTER, born AFTER the receipt because renderEnd
             clears the previous one on its way in. It stays until the reader
             takes the receipt away — reported as a moment too short to
             register — which the file it ships as already suits: 29 frames
             with a loop count of 1, so the mark drops its sunglasses on once
             and then simply wears them. An infinite loop would have made a
             permanent badge into a permanent fidget.

             Buys and sells both: this sits in the shared done ceremony, and
             an exit is as much a result as an entry. */
          if (!reducedMotion()) {
            const popSrc = rewardUrl()
            if (popSrc) {
              const pop = document.createElement("img")
              pop.className = "pop-reward"
              pop.src = popSrc
              pop.alt = ""
              /* IN THE ROW, NOT OVER IT. It hung off the chip at a fixed
                 offset from the right edge, which put it on top of the
                 receipt — reported from the field as the mark sitting on
                 the numbers. A row this crowded cannot be laid out by
                 guessing coordinates, so the reward takes its place in the
                 flow like every other part: right after the receipt it
                 belongs to, with Share and the exit pushed along. */
              const written = end.querySelector(".receipt")
              if (written) written.after(pop)
              else end.appendChild(pop)
            }
          }
          /* NO TIMER. This used to re-offer the row after eight seconds,
             on the argument that the receipt is a beat and not a terminus.
             The argument was right and the timer was wrong: the receipt
             carries SHARE, and eight seconds is not long enough to decide
             to post something. Reported from the field as "share'e
             basmayınca gidiyor". The × beside it is the exit, and an exit
             the reader chooses beats one that fires while they are still
             reading. */
          refreshWal()
          /**
           * The clip is written from a trade that LANDED, never from one
           * that was merely attempted — a memory of what somebody did, not
           * of what they tried. Buys only: a sell fraction is a decision
           * about one position's size and does not generalise to the next.
           */
          if (busyUsd !== undefined && busyUsd > 0) {
            clip = { ...clip, usd: busyUsd }
            deps.clip?.write(clip)
            for (const relabel of [...clipLabels]) relabel()
          }
          return
        }
        /* The sheet as it is NOW, not as it was at the press. If it was
           replaced while the trade ran, this finds the replacement; if it
           was closed, this finds nothing and the outcome takes the strip's
           tail, which is where a reader with no sheet open should be told. */
        const liveBtn = findBtn()
        if (liveBtn?.isConnected) {
          liveBtn.textContent = restore
          liveBtn.className = "place"
        }
        // Only an error carries a door, and a door out always takes the tail.
        const door = outcome.kind === "error" ? outcome.action : undefined
        const canSay = Boolean(findMsg()?.isConnected)
        if (door || !canSay) {
          closeSheet()
          const doorNote = note(outcome.kind === "error" ? "err" : "", outcome.text)
          const parts: Element[] = [doorNote]
          if (door === "signin") parts.push(btn("act", "Sign in", deps.signIn))
          if (door === "topup")
            parts.push(
              // NOT `deps.topUp` bare: a click handler's first argument is
              // the MouseEvent, and topUp(usd?) would have received it as
              // the amount — NaN arithmetic downstream (see the NaN
              // incident: NaN passes null guards). The door also REMEMBERS
              // the buy that failed: busyUsd is the amount the reader just
              // tried to spend, so the top-up covers the thing it is for.
              // "Add USDC", not "Top up". This door funds by whichever rail
              // the account has — the panel's address screen, or the wallet
              // already injected here — so it cannot promise which. What it
              // CAN promise is what arrives, and every rail lands USDC.
              // Every money door in the product names the currency; this was
              // the last one that did not.
              //
              // It is also the wording a WALLET account needs unchanged: its
              // rail is the address screen and the USDC lands in its own
              // wallet, which is what "Add USDC" says and what the screen
              // then repeats as "Add USDC to your wallet". Nothing is
              // converted and nothing is signed on that side (the guard is
              // in primary/main.tsx's topUp); the shortfall still rides
              // along so the screen can name it.
              btn("act", ARC_EDITION ? "Add money" : "Add USDC", () =>
                void deps.topUp?.(busyUsd, undefined, {
                  mint: row.mint,
                  buyUsd: busyUsd,
                  ticker: row.ticker,
                  sourceUrl: tweetUrl,
                }),
              ),
            )
          parts.push(btn("quiet", "×", showIdle))
          renderEnd(...parts)
          /**
           * "Balance is short" invites one question — short of WHAT, from
           * WHAT — and the tail answered neither (reported live). The book
           * is already cached page-wide, so the door can afford to finish
           * the sentence a beat later: the amount decides how much to send.
           */
          if (door === "topup") {
            // The server refusing for balance IS the proof the cached book
            // is stale — drop it first, or the door quotes the very number
            // the server just contradicted.
            bookOnce = null
            void book().then((b) => {
              if (!b || !doorNote.isConnected) return
              // One unit: a SOL tail here named money the buy cannot spend.
              doorNote.textContent =
                ARC_EDITION
                  ? `${outcome.text} · you have $${b.cashUsd.toFixed(2)}`
                  : `${outcome.text} · you have $${b.cashUsd.toFixed(2)} USDC`
            })
          }
          return
        }
        say(outcome.text, outcome.kind === "error" ? "msg err" : "msg")
      }
      return report
    }

    /**
     * THE SHARE DOOR, for either direction. It lived inside runBuyMarket
     * and closed over that function's `usd`, so the exit side - the moment
     * realized profit exists - had no way to reach it. Hoisted, with the
     * action sentence passed in; flexParts still guarantees nothing
     * dishonest can ship.
     */
    const shareBtn = (
      m2: Awaited<ReturnType<typeof enrich>>,
      action: string,
    ) =>
        btn("act", "Share", () => {
          track("x_trade_share", { mint: row.mint, tier })
          const cached = seriesCache.get(`${row.mint}:1d`)
          const handleAsk = Promise.resolve(deps.myHandle?.() ?? null).catch(
            () => null,
          )
          // The coin's face for the card, by the same road the chip's own
          // disc took (ours-origin first, gateway fallback) — usually a
          // cache hit, since the face already rendered. RACED against a
          // short clock, because "faceless rather than late" has to be
          // enforced, not hoped: a cold path here is 8s per rung, and a
          // Share that stalls past the click's user activation gets its
          // composer popup-blocked while the receipt claims success.
          const iconAsk = Promise.race<string | null>([
            iconViaBackground(
              `${process.env.NEXT_PUBLIC_API_URL}/embed/asset/icon?mint=${row.mint}`,
            ).then((uri) => uri ?? (m2?.icon ? iconViaBackground(m2.icon) : null)),
            new Promise<string | null>((r) => setTimeout(() => r(null), 1800)),
          ])
          void Promise.all([
            cached ?? Promise.resolve<SeriesAnswer>({ points: null, times: null, opens: null, highs: null, lows: null, failed: false }),
            handleAsk,
            iconAsk,
          ]).then(([answer, handle, iconUri]) =>
            shareTradeCard({
              ticker,
              action,
              series: answer.points,
              mcap: m2?.mcap ?? null,
              priceUsd: lastUsd,
              handle,
            }, { iconUri }).then((how) => {
              if (!host.isConnected) return
              renderEnd(
                note(
                  "ok",
                  how === "composed"
                    ? "Composer ready with your card"
                    : how === "copied"
                      ? "Card copied - paste it into your post"
                      : "Composer opened",
                ),
                btn("quiet", "×", showIdle),
              )
            }),
          )
        })

    /**
     * ONE TRADE AT A TIME ON THE STRIP.
     *
     * runBuyMarket / runSellMarket / runOrder each SPEND real custodial
     * USDC — SPOT_SWAP_LIVE is true in production, measured — and none of
     * them guarded re-entry. The sheet's Buy is deliberately NOT disabled
     * while a trade is in flight (the counting "$25" look is the point; see
     * the "WAITING IS NOT DISABLED" CSS note), so two fast presses fired two
     * swaps and the reader paid twice. Every OTHER surface (SpotCard's
     * TradePanel, TradeSheet) already locks its control; the strip carried
     * the money path with no lock at all — the one verified double-trade
     * vector.
     *
     * The fix keeps the look and blocks only the SECOND fire: a shared
     * in-flight flag, released when the trade settles (confirmed, timed out,
     * or errored). A genuine second trade after the first completes still
     * works, and a hold-to-buy's next scoop is never a concurrent duplicate.
     * The button still counts its dollars; it simply cannot fire twice.
     * No CSS touched.
     */
    let tradeBusy = false
    const guarded =
      <A extends unknown[]>(fn: (...a: A) => Promise<void>) =>
      async (...a: A): Promise<void> => {
        if (tradeBusy) return
        tradeBusy = true
        try {
          await fn(...a)
        } finally {
          tradeBusy = false
        }
      }

    const runBuyMarketRaw = async (usd: number) => {
      /**
       * THE RECEIPT IS A SHARE MOMENT. Fomo's loop, made native: the card
       * lands on X, the cashtag in the text gives every extension viewer a
       * live chip under that very tweet, and the share IS the funnel. The
       * PNG rides the clipboard (X's intent takes text only), so the button
       * reports which half worked.
       */
      const m = await enrich(row.mint)
      /**
       * THE RECEIPT, DRESSED FOR THE MOMENT. "✓ Bought 0.0615 ORE" was a
       * log line wearing a checkmark — flat, reported so from the field.
       * Now: the DOLLARS arrive by counting (the one honest hypercasual
       * trick), the token amount rides second in the product's own quiet
       * gray, and the chip's green pulse got braver. Dollars first because
       * that is the unit the reader decided in (rule 5).
       */
      const receipt = (outcome: InlineBuyOutcome) => {
        const r = document.createElement("span")
        r.className = "receipt"
        const dollars = document.createElement("span")
        /* A SENTENCE, NOT A FORMULA. "✓ $5.00 → 0.04794 SOL" was reported as
           dry, and the arrow is why: it reads like a conversion table, in a
           feed made of sentences. The sell beside it has always said "Sold
           $5 of your $SOL" and never read that way. Dollars still arrive by
           counting, and still come first, because dollars are the unit the
           reader decided in (rule 5).
       
           NO TOKEN QUANTITY HERE, which is a space decision rather than a
           change of mind about the number. This row already carries a chip,
           a sentence, a reward, Share and an exit, and the quantity was the
           one part of it a reader can look up: the panel's history prints an
           exact amount per trade, and it is what the zero-quantity fix was
           really for. The pending line still says "Bought 0.04794 · confirming",
           because while a trade is in the air the amount is the only thing
           the reader has. */
        r.append("✓ Bought ", dollars, ` of $${ticker}`)
        countUp(dollars, usd)
        return r
      }
      // "Popped", not "Bought": this string is both the card's headline and
      // the tweet, and it is the one moment the product is allowed its own
      // vocabulary. See helpers/popLanguage for the rule.
      const done = reporter("Buying…", `Buy $${usd}`, () => [shareBtn(m, `Popped $${usd}`)], receipt, usd, "buy")
      const outcome = await runInlineBuy(deps.trade, {
        mint: row.mint,
        usd,
        symbol: ticker,
        decimals: m?.decimals ?? null,
        // The whole caller-credit programme rides this one argument: which
        // tweet the money answered. Recorded at write time because the
        // ledger cannot reconstruct it later.
        sourceUrl: tweetUrl,
        // Minted HERE, inside the press handler, so every attempt at this
        // one press carries it and the next press gets a different one.
        idempotencyKey: pressKey(),
      })
      /* WHAT THE READER SPENDS IS WHAT THEY SPEND NEXT TIME. The copy
         flow opens its sheet on this rather than on the other person's
         size (helpers/copyFrom.ts); a landed buy is the only honest
         evidence of what this reader's normal is. */
      if (outcome.kind === "done" || outcome.kind === "pending") {
        try {
          void chrome.storage?.local?.set({ [LAST_TRADE_USD_KEY]: usd })
        } catch {
          // A stale context is not worth failing a receipt over.
        }
      }
      track("x_inline_buy", {
        mint: row.mint,
        usd,
        kind: outcome.kind,
        tier,
        // Why, when the wallet said why. The whole class of "it just says
        // failed" ends here (helpers/externalTrade.ts).
        ...("detail" in outcome && outcome.detail ? { detail: outcome.detail } : {}),
        // And why in every other case too: a failure with no reason is a
        // number nobody can act on. See outcomeReason.
        ...(outcomeReason(outcome) ? { reason: outcomeReason(outcome) } : {}),
      })
      /**
       * THE FEED GETS IT, from the one surface that had no path to it.
       * A trade made under a tweet was recorded in the ledger and posted
       * nowhere — measured, and the owner's answer was to file it under
       * the FEED's address rather than the tweet's ("direk twitter
       * feed'ine kaydedilsin, ilgili tweet'e gitmesin"). The tweet is
       * still remembered where it belongs: sourceUrl above, in the ledger,
       * which is what caller credit is paid from.
       */
      if (outcome.kind === "done") {
        // The receipt in the feed showed a blank disc where the coin's
        // face belongs. `m` is this mint's enrich, already resolved and
        // cached for the buy above, so the picture costs nothing.
        void deps.postTrade?.({
          mint: row.mint,
          symbol: ticker,
          side: "buy",
          usd,
          tokens: outcome.tokens ?? 0,
          signature: outcome.signature ?? "",
          iconUrl: m?.icon ?? null,
          mcap: m?.mcap ?? null,
        })
      }
      if (outcome.kind === "done" || outcome.kind === "pending") {
        // The holding just changed; the sheet's balance line and the face's
        // badge both read the same cache, so both heal from one refresh.
        bookOnce = null
        refreshMine()
      }
      done(outcome)
    }

    /**
     * A MARKET SELL, sized as a fraction of the holding in RAW units.
     *
     * The raw string is echoed from /balance and cut with BigInt: a balance
     * is a u64 for a reason, and rounding somebody's exit through a float is
     * the one arithmetic error this surface must never make.
     */
    const runSellMarketRaw = async (
      pct: number,
      heldRaw: string | null,
      usd?: number,
    ) => {
      /** The reader's own unit: dollars when they typed them, else a pct
       *  rounded to at most one decimal - "half still reads as half". */
      const size =
        usd !== undefined && usd > 0
          ? `$${Number(usd.toFixed(2))}`
          : `${Math.round(pct * 10) / 10}%`
      // The feed post needs UI units; the sell itself is sized in raw ones.
      const sellAsset = await enrich(row.mint)
      /**
       * THE EXIT GETS THE BEAT TOO. Selling was a grey button and a flat
       * "✓ Sold 50% of your $ORE" - money landing IN the reader's pocket,
       * the moment realized profit exists, dressed as a log line while the
       * entry side got counted dollars and a share door. Trust on the exit
       * side is what keeps the return loop alive.
       *
       * The dollars count only when the reader typed them; a fraction of a
       * holding has no figure to count and keeps its honest sentence.
       */
      const done = reporter(
        "Selling…",
        `Sell ${size}`,
        // No "of" here: composeShareText adds it, and passing it twice is
        // what produced "Sold 5.7 of $ANSEM of $ANSEM on Poppin".
        () => [shareBtn(sellAsset, `Sold ${size} $${ticker}`)],
        undefined,
        usd !== undefined && usd > 0 ? usd : undefined,
        "sell",
      )
      const sellDecimals = sellAsset?.decimals ?? null
      const amountRaw = fractionRaw(heldRaw, pct)
      if (amountRaw === "0" || !deps.sell) {
        done({ kind: "error", text: "Nothing to sell" })
        return
      }
      let outcome: InlineBuyOutcome
      try {
        // Same rule as the buy: one press, one key, minted at the press.
        const res = await deps.sell(row.mint, amountRaw, tweetUrl, pressKey())
        if (res.dryRun) {
          outcome = { kind: "info", text: "Dry run · built and verified, nothing sold" }
        } else {
          const settled = await deps.trade.confirm(res.signature).catch(() => null)
          outcome =
            settled === null || settled.status === "unknown"
              ? { kind: "pending", text: "Sold · confirming", signature: res.signature }
              : settled.status === "failed"
                ? { kind: "error", text: "The transaction failed on chain" }
                : { kind: "done", text: `Sold ${size} of your $${ticker}` }
          if (outcome.kind === "done") {
            /**
             * SELLS REACH THE FEED TOO. Buys did from the day the strip
             * learned to post and sells did not, which made the feed a
             * record of entries with no exits — the least honest half of
             * a trading history to publish. Sized in the units the reader
             * chose (a fraction of the holding), because a sell has no
             * dollar amount until it settles.
             */
            /**
             * ONLY WITH REAL DECIMALS. `10 ** (sellDecimals ?? 0)` printed
             * the RAW amount as the token count when enrich had no answer -
             * "61,408,200 PANTS" for a 61.4 sale, an invented figure off by
             * orders of magnitude, published to the feed. No decimals, no
             * receipt: the sell itself already happened and already told
             * the reader; a post that does not land must never look like a
             * trade that did not.
             */
            if (sellDecimals !== null) {
              void deps.postTrade?.({
                mint: row.mint,
                symbol: ticker,
                side: "sell",
                usd: 0,
                tokens: Number(amountRaw) / 10 ** sellDecimals,
                signature: res.signature,
                iconUrl: sellAsset?.icon ?? null,
                mcap: sellAsset?.mcap ?? null,
              })
            }
          }
        }
      } catch (err) {
        // The bridge never throws an Error: it rethrows the background's
        // plain {status, code, message} (lib/fetchService.ts), so the old
        // `instanceof Error` read was false on every failure, printed
        // "Selling failed" over the server's own sentence ("Insufficient
        // balance: …", "Swap would fail on-chain — …") and never reached
        // the sign-in branch. Same reading as the buy runner.
        const status = (err as { status?: number })?.status
        const raw = messageOf(err) ?? ""
        const reason = reasonOf(err, "That sell didn't go through. Try again.")
        outcome =
          status === 401 || status === 403 || /401|unauthor/i.test(raw)
            ? { kind: "error", text: "Sign in to trade", action: "signin" }
            : raw && raw !== reason
              ? { kind: "error", text: reason, detail: raw.slice(0, 200) }
              : { kind: "error", text: reason }
      }
      // The holding just changed, so the cached book is a lie.
      bookOnce = null
      refreshMine()
      track("x_inline_sell", {
        mint: row.mint,
        pct,
        kind: outcome.kind,
        tier,
        ...(outcomeReason(outcome) ? { reason: outcomeReason(outcome) } : {}),
      })
      done(outcome)
    }

    const runOrderRaw = async (args: {
      side: Side
      price: number
      usd?: number
      amountRaw?: string
    }) => {
      const { side, price: triggerPriceUsd, usd = 0 } = args
      const done = reporter("Placing…", "Place order")
      const priceText = formatTriggerPrice(triggerPriceUsd)
      const outcome = await runInlineOrder(deps.order, {
        mint: row.mint,
        side,
        usd,
        amountRaw: args.amountRaw,
        triggerPriceUsd,
        priceText,
      })
      track("x_inline_order", {
        mint: row.mint,
        side,
        usd,
        triggerPriceUsd,
        kind: outcome.kind,
        tier,
      })
      if (!host.isConnected) return
      // The order escrowed money and joined the book, so both caches lie.
      bookOnce = null
      ordersOnce = null
      done(outcome)
    }

    // Each spends real USDC; the wrapper lets exactly one be in flight.
    const runBuyMarket = guarded(runBuyMarketRaw)
    const runSellMarket = guarded(runSellMarketRaw)
    const runOrder = guarded(runOrderRaw)

    showIdle()

    /**
     * IMMEDIATELY AFTER THE ARTICLE, not at the end of whatever contains it.
     *
     * This was `(article.parentElement ?? cell).appendChild(host)`, which is
     * the same thing on a TIMELINE — there the article is the only child of
     * its wrapper, so appending lands right under the tweet.
     *
     * On a status page it is not. The focused tweet's wrapper also holds the
     * engagement row and the reply composer, so appending put the chip below
     * "Post your reply" — detached from the tweet it belongs to, which is the
     * one thing this control cannot afford to look like.
     *
     * `afterend` is position-independent: it lands directly after the article
     * wherever the article happens to sit, so the timeline case is unchanged
     * and every other surface is fixed by construction rather than by a
     * per-page branch. `stripOf` looks the host up with a querySelector on the
     * cell, so nothing downstream depends on where in the cell it ended up.
     */
    /**
     * DIRECTLY UNDER THE TWEET'S OWN ACTION ROW.
     *
     * `afterend` on the ARTICLE was right on a timeline, where the article
     * ends at the like row. On a status page X keeps appending inside the
     * article — the engagement counts, then the "Relevant" reply sort — so
     * "after the article" put the chip below the sort control, adrift in
     * the replies section. Same instruction, two very different results.
     *
     * The action row is the stable landmark on both: role="group" is what X
     * gives the reply/retweet/like cluster, and the chip belongs immediately
     * under it either way. The article stays as the fallback for a layout
     * where that row is absent.
     */
    const actionRow = site.actionRow(article)
    if (actionRow?.parentElement) actionRow.insertAdjacentElement("afterend", host)
    else article.insertAdjacentElement("afterend", host)
    sweep.mounted++
    if (!toldTheHost) {
      toldTheHost = true
      try {
        deps.onFirstChip?.()
      } catch {
        // Whatever the host does with this, it is not the chip's problem.
      }
    }

    /**
     * ALIGN TO THE ACTION ROW, WHICH IS THE TWEET'S OWN COLUMN.
     *
     * The chip's left edge has to land on the same line as the reply icon
     * and the tweet's text. Two earlier landmarks each broke on a real
     * tweet:
     *
     *   - text-vs-ARTICLE double-paid the avatar rail once the chip moved
     *     inside the text column, floating it a rail's width to the right.
     *   - text-vs-HOST fixed that but still trusted "the tweet's text",
     *     and a video post that QUOTES another tweet has no text of its
     *     own — the only tweetText in the article belongs to the quote box,
     *     which is indented again. Measured from that, the chip drifted a
     *     second time, and for a reason no amount of arithmetic would
     *     catch: the landmark was the wrong element, not the wrong origin.
     *
     * The action row cannot have that problem. It is the tweet's own, X
     * gives every tweet exactly one, it is never nested in a quote, and it
     * is the element the chip is already anchored to. Text stays as the
     * fallback for the article-level insertion, where there is no row.
     * Measured after insertion: before it, the host has no geometry.
     */
    const rail = actionRow ?? site.textNodes(article)[0] ?? null
    /**
     * READ NOW, WRITE LATER — or, on its own, read then write.
     *
     * This measurement used to run inline: write a margin, read two rects,
     * write another. A geometry read after a style write forces the engine
     * to lay the whole page out again, and the flush loop paid that once
     * PER CELL. Profiled on a live feed (Kürşat, 2026-08-25): 76 forced
     * Layouts and 85 UpdateLayoutTrees, 74ms of the extension's 147ms.
     *
     * Nobody can feel 74ms spread across a scroll, and the profile says so
     * plainly. It is fixed anyway because the shape is a reordering, and
     * because "is the extension making X slow" deserves an answer with no
     * asterisk. Batched, the whole flush costs ONE forced layout.
     */
    placements.push({ chip, host, rail, ownColumn: !actionRow })
    if (!inBatch) flushPlacements()

    if (!shownMints.has(row.mint)) {
      shownMints.add(row.mint)
      track("x_strip_shown", { mint: row.mint, tier })
      tally.shown()
    }
    /* Outside the dedup above on purpose. That one asks "have we mounted
       this asset yet"; this one has to start watching EVERY cell, because
       the copy that eventually crosses the viewport is rarely the first
       one mounted. chipSeen dedups the REPORT by mint, which is where the
       two counts meet. */
    seenWatch.watch(chip, { mint: row.mint, tier })
  }

  // ── the watch loop ───────────────────────────────────────────────────────
  const pending = new Set<Element>()
  let flushQueued = false

  /**
   * WHICH ASSETS ARE ON SCREEN, read ONCE per batch.
   *
   * The one-strip-per-asset-per-screenful rule needs a geometry read, and
   * geometry reads force layout. Asking inside the per-cell loop meant a
   * forced layout between every mount — the classic write/read thrash —
   * which measured, in Chrome, at:
   *
   *      10 cells   0.22 ms      batched 0.02 ms
   *      50 cells   1.24 ms      batched 0.04 ms
   *     200 cells  10.56 ms      batched 0.18 ms
   *
   * A frame is 16.67 ms. Fifty cells was survivable and two hundred was
   * most of a frame, on somebody else's feed, for a decision that does not
   * change while a batch runs. So the snapshot is taken before the batch
   * mounts anything, and strips added during the batch join it as they go.
   */
  let onScreenNow: string[] | null = null
  let inBatch = false

  /**
   * Chips waiting to be placed. Filled while a batch mounts (all writes),
   * drained in two passes: every rect read first, then every style write.
   * The engine lays out once for the first read and the rest come from the
   * same clean tree.
   */
  interface Placement {
    chip: HTMLElement
    host: HTMLElement
    rail: Element | null
    /** The article-level fallback re-creates the tweet's column by hand. */
    ownColumn: boolean
  }
  const placements: Placement[] = []

  const flushPlacements = () => {
    if (placements.length === 0) return
    const batch = placements.splice(0, placements.length)
    // PASS 1 — reads only.
    const measured = batch.map((p) => ({
      p,
      inset: p.rail
        ? Math.round(
            p.rail.getBoundingClientRect().left - p.host.getBoundingClientRect().left,
          )
        : null,
    }))
    // PASS 2 — writes only.
    for (const { p, inset } of measured) {
      // X's own 16px page padding, and only where the chip spans the cell;
      // inside the text column both margins are 0 and the sheet says so.
      if (p.ownColumn) p.chip.style.marginRight = "16px"
      if (inset !== null && inset > 0 && inset < 120) {
        p.chip.style.marginLeft = `${inset}px`
      }
    }
  }
  // A LIST, not a set: the rule counts copies now (up to three of one
  // asset may share a screenful), and a set cannot count what it dedupes.
  const mintsOnScreen = () => {
    if (inBatch && onScreenNow) return onScreenNow
    const set: string[] = []
    for (const el of document.querySelectorAll("[data-poppin-strip]")) {
      const mint = el.getAttribute("data-poppin-strip")
      if (mint && visible(el)) set.push(mint)
    }
    // A snapshot is only ever valid for the batch that took it. processCell
    // is also called on its own, and a cache that outlived one call would
    // answer the next with geometry from before it mounted anything.
    if (inBatch) onScreenNow = set
    return set
  }

  /**
   * Judge a whole batch: mount everything, then place everything. The
   * screenful snapshot and the placement pass are both batch-wide, so this
   * is the shape the feature actually runs in — `processCell` on its own
   * is the single-cell door into it.
   */
  const processCells = (cells: readonly Element[]) => {
    inBatch = true
    onScreenNow = null
    try {
      for (const cell of cells) {
        if (cell.isConnected) processCell(cell)
      }
    } finally {
      inBatch = false
      onScreenNow = null
      flushPlacements()
    }
  }

  const flush = () => {
    flushQueued = false
    const cells = [...pending]
    pending.clear()
    processCells(cells)
  }

  const queue = (cell: Element) => {
    pending.add(cell)
    if (flushQueued) return
    flushQueued = true
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback
    if (idle) idle(flush, { timeout: 300 })
    else setTimeout(flush, 120)
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target
      const el = t instanceof Element ? t : t.parentElement
      const cell = el?.closest(CELL)
      if (cell) queue(cell)
      // New cells arrive as added nodes on the container, not as mutations
      // INSIDE a cell — catch them too.
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue
        if (n.matches?.(CELL)) queue(n)
        else for (const c of n.querySelectorAll?.(CELL) ?? []) queue(c)
      }
      /**
       * AND A CHIP THAT WAS TAKEN AWAY. Where the chip sits inside its
       * cell, its removal is a mutation within the cell and the line above
       * catches it. Where the cell IS the anchor and the chip is a
       * sibling, the removal happens on the PARENT and nothing above sees
       * it — which is exactly how the chip could appear under a headline
       * and never come back.
       */
      for (const n of r.removedNodes) {
        if (!(n instanceof Element)) continue
        if (!n.matches?.("[data-poppin-strip]")) continue
        const owner = el?.querySelector?.(CELL) ?? el?.closest(CELL)
        if (owner) queue(owner)
      }
    }
  })

  const scan = (root: ParentNode = document) => {
    for (const cell of root.querySelectorAll(CELL)) queue(cell)
  }

  return {
    /**
     * A SIGN-IN JUST LANDED somewhere else in the browser. The 401 the
     * book cached is now a lie, and "Sign in to trade" on any mounted
     * chip is stale the moment the reader returns. Drop the cache, forget
     * the verdict, warm the fresh read, and let every mounted strip's wal
     * repaint - the sheet's own verdict re-reads on its next paint.
     */
    reportSweep() {
      saySweep()
    },
    onSignedIn() {
      bookAuth = "unknown"
      bookOnce = null
      for (const r of [...walRefreshers]) r()
    },
    /** The book changed under us (a deposit landed): every wallet pill and open sheet re-reads. */
    onBookChanged() {
      bookOnce = null
      bookAt = 0
      for (const r of [...walRefreshers]) r()
      for (const r of [...sheetRefreshers]) r()
    },
    processCell,
    processCells,
    scan,
    updatePrice(mint, usdPrice, change24hPct) {
      const targets = tickTargets.get(mint)
      if (!targets) return
      /**
       * THE TICK IS ALSO THE BROOM. A chip whose host has left the
       * document can never paint again, so it is dropped here rather than
       * at a teardown that every call site would have to remember. Prices
       * tick often, so the registry converges quickly after a scroll.
       */
      for (const t of targets) {
        if (!t.host.isConnected) {
          targets.delete(t)
          continue
        }
        t.fn(usdPrice, change24hPct)
      }
      // Nobody left to show it. Forget the mint entirely, so `watched`
      // can let it be re-armed if it scrolls back into view — otherwise a
      // returning chip would sit on a price stream nothing re-subscribes.
      if (targets.size === 0) {
        tickTargets.delete(mint)
        watched.delete(mint)
        // ...and tell the worker, which is the half that costs money. The
        // registry forgetting a mint never stopped the poll behind it.
        deps.unwatchPrice?.(mint)
      }
    },
    stop: () => {
      observer.disconnect()
      seenWatch.stop()
      pending.clear()
      tickTargets.clear()
    },
    start() {
      observer.observe(document.body, { childList: true, subtree: true })
      scan()
    },
  } as XStripController & { start(): void }
}

/** Hosts this feature exists on. Everywhere else it must cost zero. */
/**
 * THE FEEDS THE STRIP KNOWS. Order is precedence, and nothing overlaps
 * today; a host that matched two adapters would take the first, which is
 * the right failure because the alternative is two chips on one post.
 */
export const SITES: readonly SiteAdapter[] = [X_SITE, REDDIT_SITE, NEWS_SITE]

export function siteFor(hostname: string): SiteAdapter | null {
  return SITES.find((s) => s.matches(hostname)) ?? null
}

export function isXHost(hostname: string): boolean {
  return X_SITE.matches(hostname)
}

/**
 * Boot, config-gated. The kill switch is remote (env-driven on the backend)
 * because the one certainty about X's DOM is that it will change on a day we
 * do not choose: when the selectors rot, the feature must be stoppable
 * without shipping a build.
 */
export async function initXStrip(
  /**
   * THE CHIP'S OWN DEPS, NOT A COPY OF THEM. This used to be a hand-written
   * list of the same twenty fields, and a hand-written list is a field that
   * will be dropped: book, sell, pageProof, saveAlert, listOrders and
   * cancelOrder were all accepted here and forwarded to nothing. It
   * typechecked perfectly at both ends — the host passed them, the chip
   * declared them, and the object literal in between simply never mentioned
   * them, so the chip ran its whole life with `deps.book` undefined.
   */
  deps: Omit<XStripDeps, "disabledMints"> & {
    fetchConfig(): Promise<{ enabled: boolean; disabledMints: string[] }>
  },
): Promise<XStripController | null> {
  const site = siteFor(location.hostname)
  if (!site) return null

  /**
   * THE BOOT IS AUDIBLE NOW, because its silence was being read as evidence.
   *
   * Field case: a console full of [poppin-spot] lines and not one [poppin]
   * line was taken as "the strip never ran". It proved nothing. The strip
   * had exactly four diagnostics, all of them deep inside a cashtag's slow
   * lane, so a strip that booted and found nothing and a strip that exited
   * at the gate above produced identical output: none. Both silent exits
   * below now say which one happened, and a reader can tell the two apart
   * without reading this file.
   */
  dbg(`strip booting on ${location.hostname}, reading it as ${site.id}`)

  // FAIL CLOSED, WITH A MEMORY (audit P2-28).
  //
  // This used to default to `enabled: true` and swallow the error, on the
  // reasoning that an unreachable switch is not a reason to hide the product.
  // But the day the backend is unreachable is precisely the day the strip
  // cannot price a mint, cannot validate an asset and cannot complete a
  // trade — and it is a likely day for someone to be reaching for this switch.
  // A kill switch that is guaranteed to be unavailable when it is needed is
  // not a kill switch.
  //
  // Failing closed on its own would be too blunt (x.com is an SPA; the strip
  // boots per page load, so one 200ms blip would cost a reader the session).
  // So the last successful answer is remembered and used when the live fetch
  // throws. Live always wins; the cache only covers the gap; the hard off is
  // reserved for a first run that has never reached the backend at all.
  let cfg: XStripConfig
  try {
    cfg = await deps.fetchConfig()
    void writeXStripConfigCache(cfg)
  } catch {
    cfg = (await readXStripConfigCache()) ?? X_STRIP_FAIL_CLOSED
    dbg(`strip config unreachable, fell back to ${cfg.enabled ? "the last good answer" : "off"}`)
  }
  if (!cfg.enabled) {
    dbg(`${site.id} strip is off: the kill switch says disabled`)
    return null
  }

  const ctl = createXStrip({
    // Spread, so a dep added to XStripDeps arrives here by existing.
    ...deps,
    site,
    disabledMints: new Set(cfg.disabledMints),
  }) as XStripController & { start(): void }
  ctl.start()
  dbg(`${site.id} strip watching, ${cfg.disabledMints.length} mints disabled`)
  // Speak once even if the first pass matched nothing, so silence always
  // means "not running" and never "running and empty".
  setTimeout(() => ctl.reportSweep(), 3000)
  return ctl
}
