/** @jsxImportSource preact */
/*
 * THE PRAGMA ABOVE IS LOAD-BEARING. The rest of this app compiles JSX with the
 * REACT runtime (vite uses @vitejs/plugin-react; tsconfig says react-jsx), but
 * this tree is rendered by PREACT's `render` in mount.tsx. Without the pragma,
 * the JSX here produces React elements — and Preact silently DROPS any child
 * whose `constructor` is not undefined (its guard against JSON injection),
 * which React elements are. The result is not an error: render() succeeds, the
 * shadow root stays empty, and the card is invisible everywhere while every
 * log line says it mounted. That is exactly how this shipped broken; jsdom
 * tests did not catch it because the failure is in what PAINTS.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import { iconViaBackground } from "~/helpers/iconBridge"
import { TradePanel } from "./TradePanel"
import { Conversation, PostError, useConversation } from "./Conversation"
import { Face, Me, type CardActivity, type CardBook } from "./Me"
import { CardChart } from "./CardChart"
import type { Reader, TradeIntent } from "~/helpers/tradeSheetModel"
import { countTradeProof } from "~/helpers/tradeProof"
import { receiptText } from "~/helpers/receiptText"
// Glyph DESCRIPTORS and a renderer that touches neither MUI nor the theme —
// which is the whole reason they cross the shadow-root boundary MUI cannot,
// so the side panel and this card draw the SAME marks at the same weight.
import { ChipGlyphIcon } from "../ChipGlyphIcon"
import { CHIP_GLYPH_SIZE, GLYPH_REPLY } from "../chipGlyphs"

/**
 * The spot trade card. One asset, one action — two when the reader actually
 * holds the asset.
 *
 * ── COLLAPSED: WHAT A PERSON GLANCES AT ─────────────────────────────────────
 * Identity on the left (human name over ticker), the MARKET on the right —
 * and the price is the largest type on the card. The name is recognition;
 * the number is the story, which is the hierarchy every trading surface a
 * reader already trusts uses. The 24h move renders as a tinted chip, signed
 * ("+2.1%"), never glowing text. "SPCX · issued by Backpack Securities" was
 * a cataloguing detail wearing the headline's clothes; the issuer line still
 * exists — in the panel, as fine print at the decision.
 *
 * The display name is CURATED (catalog displayName), never derived: deriving
 * from the ticker gives "SPCX", deriving from the registered name gives
 * "Circle Internet Group" on a surface with room for one word.
 *
 * ── ACTIONS ─────────────────────────────────────────────────────────────────
 * Buy and Sell, ALWAYS, and the reasoning reversed on the owner's call.
 *
 * This read: "Sell only when the balance is > 0 — a sell button for
 * something not held is dead weight." That misreads what an absent button
 * says. It does not read as "you hold none of this"; it reads as "this
 * product cannot sell". A capability the reader cannot see is one they do
 * not believe in, which costs far more than a quiet second key.
 *
 * The chip in the feed was corrected first and this followed, because half
 * a correction is worse than none: a reader who sees Sell on the row and
 * then loses it on the card learns that the button comes and goes for
 * reasons they cannot predict. Pressing it with nothing held is answered
 * by the sheet, which knows how to say "nothing to sell".
 *
 * ── THE PANEL ───────────────────────────────────────────────────────────────
 * Keypad order, top to bottom: the amount (largest element, centered,
 * focused on arrival), preset chips under it, the quote line, the CTA, the
 * disclosures as fine print last. The question first, suggested answers
 * second, consequences third, paperwork at the bottom.
 *
 * ── MOTION ──────────────────────────────────────────────────────────────────
 * An arrival, 150–200ms ease-out on state changes, a 3% press scale, and one
 * earned success moment (a check that draws itself when a fill CONFIRMS —
 * feedback for a decision already made, which is exactly the line between
 * celebration and pressure). No pulse, no blink, no countdown, no
 * manufactured urgency — this surface offers a securities trade, and motion
 * that pressures is §1's adware in animation form. The idle drift pauses
 * under the cursor and while any panel is open: targets hold still.
 */

/** Mirrors pagePosts.PostOutcome — the card must not import the data layer. */
export type PostOutcome =
  | { kind: "ok" }
  | { kind: "signed_out" }
  | { kind: "failed"; message?: string }

export type CardCategory =
  | "equity"
  | "commodity"
  | "token"
  | "memecoin"
  | "unknown"
export type CuratedIssuer =
  | "backpack-securities"
  | "xstocks"
  | "prestocks"
  | "ondo"
  | "tether"
  | "native-spl"
  | "wormhole"
  | "bridged"
export type IssuerRestriction = "us-persons"
export type TradeMode = "buy" | "sell"

/** One post, already flattened to plain text by pagePosts.sanitisePostText. */
export interface CardPost {
  id: string
  text: string
  author: string
  /**
   * Back on the view type after being argued OFF it: it left as "an API
   * detail the vote endpoint happens to want", and that reasoning still
   * holds for votes. It returns because the author is now a DESTINATION —
   * tapping the name opens their profile — and a navigation target is reader
   * data, not request plumbing.
   */
  authorId: string
  upvotes: number
  upvoted: boolean
  replyCount: number
  /**
   * Flagged by the spam heuristic, so nobody else can see it. Shown, not
   * hidden: silently swallowing a post the writer believes landed is the
   * failure this exists to end. The gate still does its job for everyone
   * else — this is the writer being told the truth about their own row.
   */
  hiddenFromOthers?: boolean
  /** When it was written, for the feed's clock. */
  createdAt?: string
  /** The author's face. Absent renders the initial disc instead. */
  avatarUrl?: string | null
  /** A trade receipt rather than a sentence. */
  isTrade?: boolean
  /**
   * The trade's OWN market cap, from the ledger. Absent for receipts whose
   * signature has no spot_trades row, which is most of the back catalogue;
   * the sentence then stops early instead of pricing an old trade at
   * today's size.
   */
  mcapUsd?: number | null
  /** Which way, for the tag's colour. */
  side?: "buy" | "sell" | null
  /**
   * The asset a receipt is a receipt FOR, when the row carries one.
   *
   * This is the difference between a row that reports and a row that acts:
   * with a mint the view can offer the same trade in one tap. Rows written
   * before the server stored receipts (2026-08-19) arrive without it and
   * stay sentences, which is why it is optional rather than implied by
   * isTrade.
   */
  trade?: {
    mint: string
    symbol: string
    amount: number
  } | null
}

/** One reply. Same flattening; no votes — a reply is a sentence, not a card. */
export interface CardReply {
  id: string
  text: string
  author: string
  createdAt?: string
  avatarUrl?: string | null
}

export interface SpotAsset {
  mint: string
  symbol: string
  name: string
  /** The name a person says out loud. Curated in the catalog, never derived. */
  displayName: string
  decimals: number
  usdPrice: number | null
  /** 24h change in percent; null renders as nothing, not as 0. */
  change24hPct: number | null
  category: CardCategory
  /** Curated rows only; null for open-mint assets, which have no issuer. */
  issuer: CuratedIssuer | null
  /** Restrictions applying to THIS reader — empty for almost everyone. */
  restrictions: readonly IssuerRestriction[]
  /** The reader's holding of this mint. null = unknown; both null and 0 mean
   *  no Sell button. */
  balance: { uiAmount: number; raw: string } | null
  /** The asset's own mark. null (or a URL the page's CSP blocks) = no logo. */
  icon?: string | null
  /** Market cap USD — the context line every trading surface prints. */
  mcap?: number | null
  holderCount?: number | null
  /** Hourly USD closes, last 24h, oldest first. null/short = no chart. */
  spark24h?: number[] | null
}

/** Terminal state of an attempt. `pending` is submitted-not-settled. */
export type OutcomeState = "pending" | "done" | "error"

export interface SpotCardHandlers {
  onExpand(): void
  onAmount(usd: number, mode: TradeMode): void
  onConfirm(usd: number, mode: TradeMode): void
  onDismiss(): void
  /** Opened the page's conversation. */
  onPosts?(): void
  /**
   * Submitted a post. Resolves with WHY, not just whether: "signed_out" is
   * the only outcome that should tell a reader to sign in, and the card used
   * to say it for every failure — including to readers whose session was
   * perfectly fine.
   */
  onPost?(text: string): Promise<PostOutcome>
  /** Hand off to the side panel, where the full thread lives. */
  onOpenPanel?(dest?: "feed" | "home" | "profile"): void
  /**
   * The reader's cash, this asset's holding in RAW units, and what it cost.
   *
   * Separate from onBook, which maps positions into a display shape and drops
   * exactly the two fields a trade needs: the raw u64 a sell is sized in, and
   * the basis a sell target is measured from. Same one authenticated read
   * underneath; a different question asked of it.
   */
  onReader?(mint: string): Promise<Reader | null>
  /**
   * Park a standing order. The card composes it; the rails are the same ones
   * every other surface uses, so the backend gates, verifies and signs it
   * exactly as it does a market trade.
   */
  onPlaceOrder?(intent: TradeIntent): Promise<void>
  /** This asset's standing orders, and the exit from one. */
  onListOrders?(): Promise<
    Array<{
      orderKey: string
      side: "buy" | "sell"
      amountUsd: number | null
      amountUi: number
      triggerPriceUsd: number
      gated: boolean
    }>
  >
  onCancelOrder?(orderKey: string): Promise<void>
  /**
   * The chart's data, for parity with the strip's chip chart. Fetched only
   * when the reader opens the chart (a tap on the sparkline), so a card
   * mounted on every page pays for none of it until asked.
   *   onSeries  — closes (+ times/OHLC) for one range, the line itself.
   *   onMyTrades — the reader's own fills, drawn ON the line at the price
   *                they executed at.
   *   onSaveAlert — park a price alert from the chart's bell; resolves
   *                 whether it saved (a duplicate or a bad target is false).
   */
  onSeries?(
    mint: string,
    range: import("~/helpers/chartMath").SparkRange,
  ): Promise<import("~/services/SpotAssetService").SeriesAnswer>
  onMyTrades?(
    mint: string,
  ): Promise<
    ReadonlyArray<{ side: "buy" | "sell"; ts: number; priceUsd?: number | null }>
  >
  onSaveAlert?(targetUsd: number): Promise<boolean>
  /**
   * The reader's own book — holdings, what they are worth, what they cost.
   *
   * Called by the `me` view when it opens, and by nothing else: a portfolio is
   * an authenticated read, and the card is mounted on every page anybody
   * visits. null means the read failed; the view says so rather than showing
   * an empty book, because "you own nothing" and "we could not look" are
   * different sentences and only one of them is ever true by accident.
   */
  onBook?(): Promise<CardBook | null>
  /** The persisted book, display-grade: paints instantly while onBook's
   *  live read (8.6s cold) lands and corrects. Never used for trading. */
  onBookCached?(): Promise<CardBook | null>
  /**
   * What this reader said, and what others did about it, as one list.
   *
   * Same contract and same reason as onBook: authenticated, fetched on the
   * press that opens the tab, null when the read failed. The card does not
   * know whose activity it is asking for — the flow does.
   */
  onActivity?(): Promise<readonly CardActivity[] | null>
  /** Tapped a holding — open that asset's card with the panel already open. */
  onTradeHolding?(mint: string): void
  /**
   * The Activity band's alert news — fired alerts, standing alerts, and the
   * read-mark. Local storage reads via the flow (the card is a view and
   * views do not touch chrome.*); same data the strip's band shows, so the
   * bell a reader learns on X is the bell they meet here.
   */
  onListFired?(): Promise<readonly import("./Me").CardFired[] | null>
  onListAlerts?(): Promise<readonly import("./Me").CardAlert[] | null>
  /** Standing orders that FILLED — the news the Activity tab leads with. */
  onListFills?(): Promise<readonly import("./Me").CardFill[] | null>
  /** Resolves whether the WRITE landed — the row leaves only on true. */
  onRemoveAlert?(id: string): Promise<boolean>
  onMarkFiredRead?(): Promise<void>
  /**
   * ALL standing orders, every mint — distinct from onListOrders, which the
   * trade panel keeps filtered to the card's own asset. The Me view is the
   * reader's whole book, and money committed on chain belongs on it.
   */
  onListAllOrders?(): Promise<readonly import("./Me").CardOrder[] | null>
  onCancelAnyOrder?(orderKey: string): Promise<void>
  /** Opened one post's thread. Returns its replies. */
  onOpenThread?(postId: string): Promise<readonly CardReply[]>
  /** Replied to a post. Same three-outcome contract as onPost. */
  onReply?(postId: string, text: string): Promise<PostOutcome>
  /**
   * Upvoted or un-upvoted. The card sends what it KNOWS — which post, and what
   * it is currently showing — and not the author id the endpoint happens to
   * want; that is an API detail, and a view type that carries it starts
   * shaping the card around the request instead of the reader.
   */
  onVote?(postId: string, currentlyUpvoted: boolean): Promise<boolean>
  /** Tapped an author's name — open their profile in the panel. */
  onAuthor?(userId: string): void
  /** Star or unstar this asset. Absent = the surface cannot persist it. */
  onToggleWatch?(): void
  /**
   * Take the same trade a receipt in the feed records.
   *
   * The mint decides where it lands, and the mount makes that call: this
   * card's own asset opens the card's own trade panel, anything else opens
   * the side panel on that asset. A card cannot become a different asset,
   * and the panel is where an asset that is not this page's lives.
   */
  onCopyTrade?(mint: string, symbol: string): void
  /** Tapped the onboarding ladder's CTA (sign in / top up). */
  onGate?(gate: "signin" | "topup"): void
}

export interface SpotCardProps {
  asset: SpotAsset
  handlers: SpotCardHandlers
  /** Quote line text; the parent owns quoting. */
  quote: string
  /** Secondary quote line — route/impact detail, rendered small and muted. */
  quoteSub?: string
  quoteError?: boolean
  /** Enables Confirm. The parent sets it once an amount is valid. */
  canConfirm?: boolean
  /** When set, replaces the quote line and disables Confirm for good.
   *  A DONE outcome may carry a share affordance — the flywheel's door. */
  outcome?:
    | {
        text: string
        state: OutcomeState
        share?: {
          /** Post the trade to this page's Poppin conversation. */
          onPoppin: () => Promise<boolean>
          /** Amplify an EXISTING Poppin post on X. Needs onPoppin first —
           *  the link X carries points at the post. */
          onX: () => Promise<boolean>
        }
      }
    | undefined
  /**
   * The page's conversation. Empty is a REAL state, not a hidden one: the
   * composer on the card face invites the first post instead of the surface
   * pretending conversations don't exist here.
   *
   * I argued the opposite first — that an empty conversation offered
   * everywhere is a badge stuck to the web — and that was the silence rule
   * applied to the wrong surface. This card only exists on a page where an
   * ASSET MATCHED, which is a handful of pages, not the web. It is already
   * here for another reason; the invitation costs nothing extra, and hiding it
   * means a conversation can never start, since every conversation is empty
   * until someone is offered the first word. (The count pill on the brand row
   * is the part that DOES wait for activity — it is a door, and a door to an
   * empty room beside an open invitation was the card saying "say something"
   * twice.)
   *
   * That objection becomes correct again the day this card mounts on pages
   * with no asset. If that happens, gate the composer on activity.
   */
  posts?: readonly CardPost[]
  /**
   * The server said there are more than we fetched (`hasNextPage`).
   *
   * The card asks for one PAGE of the conversation, not the conversation,
   * and it used to derive its count from what came back — so a page with
   * dozens of posts still reported the fetch limit as though it were the
   * total. Cursor pagination means no exact number exists to print; this
   * is the honest half of one, and it renders as a `+`.
   */
  postsHasMore?: boolean
  /**
   * Poppin users on this page right now. Rendered from 2 up: a count of 1 is
   * the reader themselves, and announcing "1 live" to the only person here is
   * the card talking to itself. null = unknown = nothing.
   *
   * THE WORD IS "live", AND IT IS THE SAME WORD THE HEADER USES. The panel's
   * header pill draws this same number as the door to the site's live chat;
   * this line said "online" while that one said "live", which is one product
   * speaking two words for one fact. helpers/presence.ts holds the rule.
   * The card is NOT a control — it states the number and opens nothing.
   */
  presence?: number | null
  /** Whether this asset is on the reader's watchlist. null = unknown, and
   *  unknown draws nothing: a star that guesses is a star that lies. */
  watched?: boolean | null
  /**
   * The reader's unread notifications. > 0 puts a badge on the mark, which
   * becomes the door to the inbox. 0 and null both render nothing — an inbox
   * with nothing in it is not news.
   */
  unread?: number | null
  /**
   * The reader themselves, when known: balance chip + avatar. Personalization
   * is the cheapest premium there is — a card that knows your face and your
   * buying power reads as YOURS, not as an ad. null/absent renders nothing
   * (signed out, or the probe failed — same silence rule as everything).
   */
  me?: { name: string; photoUrl: string | null } | null
  cashUsd?: number | null
  /**
   * ONBOARDING_V2's ladder: what stands between this reader and a trade.
   * "signin" and "topup" replace the Confirm button with the ONE next step —
   * the quote still shows above it, because "you would have gotten 0.034
   * SPCX" converts better than a wall. null/absent = nothing in the way,
   * normal trading UI (also the flag-off behaviour, byte for byte).
   */
  gate?: "signin" | "topup" | null
  /**
   * Imperative expand, as a NONCE: each increment opens the card once. The
   * side panel's asset strip drives this through the controller — a closed
   * shadow root is unreachable from outside by design, so "open the card"
   * has to arrive as data.
   */
  expandSignal?: number
  /** Which side the expand signal asked for. Absent means buy. */
  expandMode?: TradeMode
  /**
   * 'up'/'down' for the ~700ms after a live tick moves the price, then
   * absent — mount.tsx owns the timer. Absent (not present at all, never
   * mounted with one) is the far more common case: most pages never watch
   * a mint's price and this prop simply does not apply to them.
   */
  priceFlash?: "up" | "down" | null
  /**
   * The card is on its way out to the pill. Purely visual: mount.tsx keeps
   * the tree alive for the length of the exit animation so the card can be
   * SEEN leaving. Without it the card vanished between frames, which reads
   * as a crash rather than a close — and made collapsing look like two
   * unrelated objects swapping instead of one object moving.
   */
  leaving?: boolean
}

/**
 * §13 cuts discovery flows, portfolios, PnL and position panels. Three amounts
 * are none of those — they are the same single decision the card already asks
 * for, with the two most common answers pre-typed.
 */
// The values live in helpers/tradeMath now — the panel's trade sheet uses the
// same three amounts, and two copies is how they drifted to 1/5/20 there.
// Re-exported so this file's existing importers (TradePanel) are unchanged.
export { PRESET_USD, SELL_FRACTIONS } from "~/helpers/tradeMath"

export const ISSUER_LABEL: Record<CuratedIssuer, string> = {
  "backpack-securities": "Backpack Securities",
  xstocks: "xStocks",
  // Plain SPL tokens have no wrapping counterparty; the honest label is the
  // chain itself. Portal-wrapped collateral names the bridge, because the
  // bridge is who actually holds the underlying.
  "native-spl": "Solana",
  wormhole: "Wormhole Portal",
  prestocks: "PreStocks",
  ondo: "Ondo Global Markets",
  tether: "Tether Gold",
  // The honest generic: the wrapper exists but its brand was not verified,
  // and a guessed bridge name on a money surface is a lie with a logo.
  bridged: "Bridged asset",
}

export const RESTRICTION_NOTE: Record<IssuerRestriction, string> = {
  "us-persons": "Issuer restricts US persons · this may fail",
}

export const price = (n: number | null): string => {
  if (n === null || !Number.isFinite(n)) return ""
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 1 ? 4 : 2,
  })}`
}

/** "$1.2T" / "$136.7M" / "$83.2B" — the market-cap dialect. null → "". */
const compactUsd = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return ""
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ]
  for (const [div, u] of units) {
    if (n >= div) {
      const v = n / div
      return `$${v >= 100 ? Math.round(v) : v.toFixed(1)}${u}`
    }
  }
  return `$${Math.round(n)}`
}

/** "251.9K" — holder counts. */
const compactCount = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return ""
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${Math.round(n)}`
}

/**
 * "2m", "3h", "5d" — a feed's clock.
 *
 * Every social surface prints this and it is not decoration: a conversation
 * with no timestamps cannot be read for freshness, and freshness is most of
 * why anybody opens one. Absolute dates are for archives.
 */
export const relTime = (iso: string | undefined): string => {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/**
 * What a receipt SAYS on the card: today's sentence verbatim, the legacy
 * machine sentence re-said in today's shape.
 *
 * tradeLine used to live here, regex-trimming " on host via Poppin" off our
 * own stored output, with its own comment calling it "a compromise, not a
 * design". The debt it named is now measured and split: every CURRENT
 * writer sends transaction_data (the chip and the card both), so new
 * receipts arrive structured; the rows that return post_transaction: null
 * are a handful from the pre-transaction era and no backend join can
 * conjure rows that were never written. For their DISPLAY, receiptText
 * already owns the job - the same end-anchored, human-sentence-safe
 * re-sayer the panel's feed uses - so the card now speaks it too and the
 * two surfaces cannot drift.
 */
export const postText = (p: {
  text: string
  isTrade?: boolean
  mcapUsd?: number | null
}): string => (p.isTrade ? receiptText(p.text, true, p.mcapUsd) : p.text)

/** "$WIF" stays "$WIF"; "SPCX" becomes "$SPCX". The card used to prefix
 *  unconditionally and printed "$$WIF" for every symbol that ships its own
 *  dollar sign — which memecoins routinely do. */
const tickerText = (symbol: string): string =>
  symbol.startsWith("$") ? symbol : `$${symbol}`

/** The other direction, for prose: "Buy WIF", never "Buy $WIF". The dollar
 *  sign is ticker notation and reads as a price the moment it sits next to a
 *  verb. Same catalog symbols carry it, so this strips rather than assumes. */
const bareSymbol = (symbol: string): string => symbol.replace(/^\$/, "")

/**
 * The 24h shape of the price — the single element that makes this surface
 * read as a market instead of a label. Real hourly closes from the backend
 * (SparkService), never invented; fewer than 8 points renders nothing, the
 * same silence rule as every other missing fact.
 *
 * Drawn tall against its own min/max so the day's story fills the strip; a
 * flat-ish asset still gets a visible line via the 1e-9 floor. Direction
 * colour follows the 24h chip when it exists (the two must not disagree),
 * else the line's own endpoints. pathLength=1 normalises the draw-in
 * animation so CSS needs no measured length.
 */
const Sparkline = ({
  points,
  changePct,
}: {
  points: readonly number[]
  changePct: number | null
}) => {
  const W = 308
  const H = 44
  const PAD = 3
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = Math.max(max - min, 1e-9)
  const step = (W - PAD * 2) / (points.length - 1)
  const x = (i: number) => PAD + i * step
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - (v - min) / span)
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`
  const up = changePct !== null && Number.isFinite(changePct)
    ? changePct >= 0
    : points[points.length - 1] >= points[0]
  const c = up ? "#30D158" : "#FF453A"
  return (
    <div className="spark" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} focusable="false">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={c} stop-opacity="0.22" />
            <stop offset="100%" stop-color={c} stop-opacity="0" />
          </linearGradient>
        </defs>
        <path class="spark-area" d={area} fill="url(#spark-fill)" stroke="none" />
        <path
          class="spark-line"
          d={line}
          fill="none"
          stroke={c}
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          pathLength={1}
        />
        {/* The present moment: one dot on the last close, the price's anchor. */}
        <circle
          class="spark-now"
          cx={x(points.length - 1)}
          cy={y(points[points.length - 1])}
          r="2.6"
          fill={c}
        />
      </svg>
    </div>
  )
}

/** "+2.1%" / "−1.4%", one decimal — plain, per the brief. null → "". */
const change = (pct: number | null): string => {
  if (pct === null || !Number.isFinite(pct)) return ""
  const v = Math.abs(pct).toFixed(1)
  return pct >= 0 ? `+${v}%` : `−${v}%`
}

/**
 * The Poppin mark: white ghost inside a blue disc.
 *
 * That composition is the product's app icon (public/icons/logo.png), and it
 * is the canonical mark — sampling it gives #68C6FF for the disc, which is the
 * accent this card already uses, so the palette and the logo were the same
 * decision all along.
 *
 * Built here rather than shipped as the PNG: an <img> to a
 * web_accessible_resource is a fetch a page's CSP can refuse, and a logo that
 * sometimes fails to appear is worse than none. The ghost paths come from
 * logo.svg VERBATIM (an earlier version retyped and truncated one, drawing
 * nonsense) and are scaled to sit inside the disc.
 *
 * Two earlier attempts got this wrong in ways worth naming: LogoWithoutEye.svg
 * is the eyeless variant and reads as an anonymous blob, and the ghost alone
 * with no disc is not the mark either. Check both if it ever looks generic.
 */
function PoppinMark({ size = 14 }: { size?: number } = {}) {
  return (
    <svg
      className="mark"
      viewBox="0 0 60 60"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="30" cy="30" r="30" fill="#68C6FF" />
      <g transform="translate(30 31) scale(0.60) translate(-30 -30)">
        <path fill="#FFFFFF" d="M8.7517 22.3512C14.2684 -4.55047 60.2643 1.65009 55.5383 31.7752C52.5647 46.2756 37.9599 50.2461 25.9907 46.6125C23.2279 45.7738 20.1847 45.8113 17.7477 47.2898L13.2779 50.0015C12.0276 50.76 10.3748 50.0185 10.1589 48.5891C8.74558 39.2319 7.03935 30.7014 8.7517 22.3512Z" />
        <path fill="#0A0A0C" d="M0.797638 26.12C4.01829 10.4149 21.3481 -0.966661 36.6697 1.61319C43.2574 2.72256 49.6738 5.88322 54.1394 11.1425C58.6827 16.4932 60.9694 23.7492 59.6101 32.414L59.5955 32.5087L59.576 32.6034L59.49 33.0067C57.5964 41.6018 50.1509 50.8411 41.8367 54.3827C35.3962 57.1261 27.8778 57.2044 21.1941 55.248L20.8767 55.1532C18.9166 54.5582 17.2173 54.7087 16.0779 55.3466L15.9695 55.4101L11.4998 58.122C7.87969 60.3181 2.92054 58.3062 2.18338 53.9052L2.16678 53.8007C0.829567 44.9472 -1.03959 35.6653 0.711701 26.5536L0.797638 26.12ZM55.8562 28.5732C56.5528 11.3213 39.7201 3.04213 25.8728 5.80069H25.8748C25.752 5.82514 25.6289 5.85068 25.5066 5.87687C25.4991 5.87847 25.4916 5.88014 25.4842 5.88175C25.1138 5.96141 24.745 6.04879 24.3797 6.14444C24.3748 6.14572 24.3699 6.14707 24.365 6.14835C24.1233 6.2118 23.8826 6.27904 23.6433 6.34952C23.6345 6.35211 23.6258 6.35474 23.617 6.35733C23.3776 6.42814 23.1388 6.50309 22.9021 6.58097C22.7764 6.62234 22.6511 6.66455 22.5262 6.70792C22.2894 6.79015 22.0538 6.87629 21.8201 6.96573C21.8169 6.96695 21.8135 6.96842 21.8103 6.96964C21.5862 7.05554 21.3634 7.14466 21.1424 7.23722C21.1168 7.2479 21.0907 7.25867 21.0652 7.26944C20.9116 7.33443 20.7583 7.40142 20.6062 7.46964C20.5178 7.50931 20.4294 7.54899 20.3416 7.58976C20.2844 7.61628 20.2276 7.64383 20.1707 7.67081C20.0633 7.72172 19.9559 7.77352 19.8494 7.82608C19.7136 7.89312 19.5785 7.96143 19.4441 8.03116C19.3471 8.08152 19.2503 8.13272 19.1541 8.18448C19.0899 8.21904 19.0256 8.25379 18.9617 8.28898C18.8722 8.33827 18.7829 8.38786 18.6941 8.43839C18.5467 8.5223 18.4 8.6079 18.2547 8.69523C18.1597 8.75227 18.0655 8.81055 17.9715 8.86905C17.9236 8.89885 17.8756 8.92872 17.8279 8.9589C17.5009 9.16596 17.1794 9.38239 16.864 9.60734C16.8122 9.64431 16.7603 9.68121 16.7088 9.71866C16.0463 10.2005 15.4116 10.7227 14.8084 11.2851C14.7565 11.3334 14.7045 11.3816 14.6531 11.4306C13.9163 12.1324 13.228 12.8958 12.5965 13.7216C12.5739 13.7511 12.5515 13.7808 12.5291 13.8105C11.9879 14.5265 11.4894 15.2892 11.0379 16.0985C11.0228 16.1255 11.0079 16.1526 10.993 16.1796C9.9887 17.9994 9.2227 20.0549 8.75174 22.3515L8.67361 22.7431C8.5933 23.1609 8.52177 23.5792 8.45779 23.998C7.90293 27.6305 7.94444 31.3051 8.28104 35.0741C8.30253 35.3148 8.32558 35.5563 8.3494 35.7978C8.38282 36.1366 8.41821 36.4768 8.45584 36.8173C8.47887 37.0256 8.50266 37.2343 8.52713 37.4433C8.62598 38.2876 8.73699 39.1378 8.85526 39.9931C8.88738 40.2254 8.91967 40.4582 8.95291 40.6913C9.0004 41.0244 9.04896 41.3584 9.09842 41.6933C9.17076 42.1831 9.24457 42.675 9.3201 43.1689C9.33452 43.2631 9.34953 43.3576 9.36404 43.4521C9.62317 45.1385 9.89625 46.8493 10.159 48.5888C10.1891 48.7882 10.2468 48.975 10.3279 49.1454C10.3305 49.1509 10.3331 49.1565 10.3357 49.162C10.3603 49.2125 10.3873 49.2618 10.4158 49.3095C10.4518 49.3695 10.4913 49.427 10.533 49.4823C10.5657 49.5258 10.6005 49.5679 10.6365 49.6083C11.1672 50.2033 12.0366 50.4624 12.8357 50.204C12.8573 50.197 12.8787 50.1893 12.9002 50.1816C12.9274 50.1718 12.9552 50.1613 12.9822 50.1503C13.018 50.1357 13.0533 50.1193 13.0887 50.1025C13.1321 50.0818 13.1759 50.0601 13.2185 50.036L13.2771 50.0019L17.7478 47.29C17.8518 47.2269 17.9572 47.1662 18.0633 47.1083C18.1511 47.0604 18.2396 47.014 18.3289 46.9696C18.3893 46.9396 18.4505 46.9102 18.5115 46.8817C18.548 46.8647 18.5852 46.8474 18.6219 46.831C18.814 46.7448 19.0094 46.6666 19.2068 46.5956C20.2677 46.2143 21.3992 46.0489 22.5437 46.0624C22.6325 46.0635 22.7215 46.0651 22.8103 46.0683C23.8783 46.1066 24.9541 46.2978 25.99 46.6122C26.2669 46.6963 26.5455 46.7766 26.825 46.8525C26.8458 46.8581 26.8667 46.8635 26.8875 46.8691C27.0555 46.9143 27.2245 46.9587 27.3933 47.0009C27.4205 47.0077 27.4482 47.0137 27.4754 47.0204C27.6383 47.0607 27.802 47.1001 27.9656 47.1376C28.0014 47.1458 28.0372 47.154 28.073 47.162C28.2283 47.197 28.384 47.2311 28.5398 47.2636C28.7544 47.3083 28.9698 47.3497 29.1853 47.3896C29.3557 47.4211 29.5262 47.4519 29.6971 47.4804C29.8282 47.5023 29.9602 47.5228 30.0916 47.5429C30.2435 47.5661 30.3955 47.5885 30.5476 47.6093C30.7601 47.6384 30.9734 47.665 31.1863 47.6894C31.3693 47.7103 31.5529 47.7295 31.7361 47.747C42.1401 48.7397 52.8293 44.0985 55.4666 32.1132L55.5379 31.7753C55.6247 31.2217 55.6937 30.676 55.7469 30.1386C55.786 29.7419 55.8163 29.3496 55.8377 28.9618L55.8562 28.5732ZM29.1902 17.5067C32.3966 17.339 35.1323 19.8033 35.3006 23.0097C35.4683 26.2161 33.0051 28.9518 29.7986 29.12C26.5921 29.2879 23.8555 26.8246 23.6873 23.6181C23.652 22.9431 23.7346 22.2884 23.9148 21.6747C24.3238 22.0734 24.8904 22.3085 25.5056 22.2763C26.6751 22.2148 27.5734 21.2172 27.5125 20.0478C27.474 19.3157 27.0689 18.6876 26.4842 18.3368C27.2776 17.856 28.1989 17.5587 29.1902 17.5067ZM43.8347 16.373C47.0414 16.205 49.7769 18.6683 49.9451 21.8749C50.1131 25.0816 47.6498 27.8181 44.4431 27.9862C41.2365 28.1542 38.5009 25.69 38.3328 22.4833C38.2975 21.8084 38.3792 21.1545 38.5594 20.5409C38.9681 20.9395 39.5341 21.1745 40.1492 21.1425C41.319 21.0812 42.2192 20.0828 42.158 18.913C42.1195 18.1809 41.7134 17.5548 41.1287 17.204C41.9224 16.7229 42.843 16.4249 43.8347 16.373Z" />
      </g>
    </svg>
  )
}

/**
 * The collapsed state: a small tab on the page's right edge.
 *
 * WHY THE CARD IS NOT ALWAYS OPEN. This thing is a guest on somebody else's
 * page, and a full trade panel that arrives uninvited is the shape a store
 * reviewer reads as adware — the same objection the motion rules answer, one
 * level up. It also caused a real bug: on CoinMarketCap the open card landed
 * on top of that site's own fixed sidebar and the two read as one broken
 * widget. A tab cannot collide with anything.
 *
 * IT IS ALSO THE LATENCY FIX. The tab needs a match and nothing else, so it
 * can be on screen while the quote, the balance and the day's shape are
 * still in flight; opening it later costs nothing because that work is long
 * done. What a person waits for stops being the slowest request.
 *
 * NO IDLE ANIMATION. It pulses when something HAPPENED on this page and at
 * no other time. A permanent tab that breathes on a timer is the perpetual
 * orbit this card already removed once: motion is a claim that something
 * occurred, and a claim that repeats regardless is filtered out within a
 * day — taking the one moment that mattered with it.
 *
 * AND IT RETREATS. The first pass parked a fully opaque logo at the vertical
 * centre of every matching page, forever. Read that back as somebody
 * watching a video: our mark is sitting in the middle of their screen, on
 * content they came for, and there is no version of that which is not rude.
 * An "edge trigger" that is entirely on screen is not an edge trigger, it is
 * a badge. So it arrives visible, settles into the edge a few seconds later
 * (mount.tsx owns that timer), and comes back on hover or when a voice
 * arrives. Fullscreen removes it outright — see mount.tsx.
 */
export function SpotPill({
  onOpen,
  unread,
  nudging,
  resting,
  symbol,
}: {
  onOpen(): void
  unread?: number | null
  nudging?: boolean
  /** Settled into the edge after its arrival — see .pill-rest in style.ts. */
  resting?: boolean
  symbol: string
}) {
  return (
    <button
      className={`pill${nudging ? " pill-nudge" : ""}${resting ? " pill-rest" : ""}`}
      data-act="open-pill"
      aria-label={`Open Poppin — trade ${bareSymbol(symbol)}`}
      onClick={onOpen}
    >
      <PoppinMark size={19} />
      {/* THE ARRIVAL SAYS WHAT MATCHED. For its four full-presence seconds
          the pill used to teach only that Poppin exists; the ticker is the
          fact the reader does not yet have - especially on an inferred
          match, where nothing else on the page says an asset was found.
          Rests away with the mark. */}
      <span className="pill-tick" aria-hidden="true">
        {bareSymbol(symbol) ? `$${bareSymbol(symbol)}` : ""}
      </span>
      {/* The resting mark. NOT the logo cropped — a chevron, which is a
          different kind of object: a logo is a claim about who we are, and
          a chevron is an instruction about what this does. Only one of
          those has earned a permanent place on somebody else's page.

          It points LEFT because that is where the card comes from. */}
      <svg
        className="pill-chevron"
        viewBox="0 0 12 16"
        width="8"
        height="11"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M8.2 2.4 3.4 8l4.8 5.6"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {typeof unread === "number" && unread > 0 && (
        <span className="pill-badge" data-unread>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  )
}

export function SpotCard({
  asset,
  handlers,
  quote,
  quoteSub,
  quoteError,
  canConfirm,
  outcome,
  posts,
  presence,
  watched,
  unread,
  gate,
  me,
  cashUsd,
  expandSignal,
  expandMode,
  priceFlash,
  leaving,
  postsHasMore,
}: SpotCardProps) {
  /**
   * WHERE THE READER IS — one value, not three booleans.
   *
   * This was `expanded` + `showPosts` + `thread`, which is eight possible
   * combinations describing four real places, and the illegal ones showed:
   * the trade panel had no way back at all, so "open Buy" was a one-way door
   * and the only exit was dismissing the card and getting it again.
   *
   * One value makes the exits obvious, because every view has exactly one
   * parent: trade → card, feed → card, thread → feed. `back()` walks that
   * edge and the header's ← is the only control that needs to exist.
   */
  /**
   * The asset's mark, resolved through the background into a data URI —
   * this card lives on pages whose CSP (x.com, measured) blocks every icon
   * CDN, so a direct src fails exactly where the mark matters most. Null
   * until real pixels exist; the layout never waits on it.
   */
  const [iconUri, setIconUri] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setIconUri(null)
    if (!asset.icon) return
    void iconViaBackground(asset.icon).then((uri) => {
      if (alive && uri) setIconUri(uri)
    })
    return () => {
      alive = false
    }
  }, [asset.icon])

  /**
   * THE CARD SETTLES INTO ITS NEW SIZE INSTEAD OF LEAPING.
   *
   * Content swapped with a 180ms fade but the container had no height
   * animation, so every navigation snapped the wrap to its new size in one
   * frame - and because the card is anchored at top:50% with a -50%
   * translate, BOTH edges jumped at once. The content transition was
   * describing a move the frame refused to make.
   *
   * Measure before, measure after, tween between, then release to auto.
   * Skipped entirely under reduced motion, and released on transitionend
   * so late-arriving content is never clipped against a stale height.
   */

  const [view, setView] = useState<"card" | "trade" | "feed" | "thread" | "me">(
    "card",
  )

  /**
   * Everything the conversation knows, in one place.
   *
   * A hook rather than a component because two DIFFERENT views write through
   * it: the composer inside the feed and the one on the card face. Extracting
   * only the feed would have left `draft`/`posting`/`postError` behind and
   * needed twenty-odd props to reach back, or split the state in two — which
   * is the mistake this whole refactor exists to undo.
   */

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const prevViewRef = useRef<string | null>(null)
  const prevHeightRef = useRef<number>(0)
  useLayoutEffect(() => {
    const el = wrapRef.current
    const from = prevHeightRef.current
    const was = prevViewRef.current
    prevViewRef.current = view
    if (!el) return
    const to = el.offsetHeight
    prevHeightRef.current = to
    if (was === null || was === view || !from || !to || from === to) return
    if (
      typeof matchMedia !== "function" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }
    el.style.overflow = "hidden"
    el.style.height = `${from}px`
    el.style.transition = "height 200ms cubic-bezier(.16,1,.3,1)"
    void el.offsetHeight
    el.style.height = `${to}px`
    let released = false
    const release = () => {
      if (released) return
      released = true
      el.style.height = ""
      el.style.overflow = ""
      el.style.transition = ""
      prevHeightRef.current = el.offsetHeight
    }
    el.addEventListener("transitionend", release, { once: true })
    const t = setTimeout(release, 280)
    return () => {
      clearTimeout(t)
      release()
    }
  }, [view])
  const c = useConversation({
    posts,
    handlers,
    me,
    onPosted: () => setView("feed"),
    onThreadOpened: () => setView("thread"),
  })
  const feed = c.feed
  /** Share state stays HERE, not in the panel: the X button also renders in
   *  the feed after a share, so both views read it. */
  const [shared, setShared] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [sharedX, setSharedX] = useState(false)

  const expanded = view === "trade"
  const showPosts = view === "feed" || view === "thread"
  /**
   * The reader's own book, which is about THEM rather than the asset.
   *
   * Gated separately from the two above because it hides a different set:
   * `me` keeps the asset's head (you are still on this page, reading this
   * card) and removes everything that acts ON the asset — Buy, Sell, the
   * composer, the conversation strip. Folding it into `showPosts` would have
   * been shorter and would have put a Buy button under a portfolio.
   */
  const showMe = view === "me"
  /** Which list the `me` view lands on — set by whatever opened it. */
  const [meTab, setMeTab] = useState<"book" | "activity">("book")


  /**
   * MOTION THAT MEANS SOMETHING — the replacement for the perpetual orbit.
   *
   * The float was motion on a timer, and motion on a timer is a claim with no
   * news behind it: it says "look" forever, so it stops meaning look, and in
   * the meantime it moves a button while somebody is aiming at it. This fires
   * instead when a voice actually ARRIVES on the page — once, briefly, and
   * only while the card is closed and could be missed. A reader who watches
   * the card twitch learns that a twitch means somebody spoke, which is the
   * only thing that makes an animation worth a person's attention.
   */
  const [nudging, setNudging] = useState(false)
  const seenCount = useRef(posts?.length ?? 0)
  // Arrival is already an event; a nudge riding on top of it is two
  // announcements of one thing. The conversation usually lands within a
  // second of mount, so the card holds its peace until the entrance is over.
  const settledAt = useRef(Date.now() + 2500)
  useEffect(() => {
    const n = posts?.length ?? 0
    const grew = n > seenCount.current
    seenCount.current = n
    if (!grew || view !== "card" || Date.now() < settledAt.current) return
    setNudging(true)
    const t = setTimeout(() => setNudging(false), 560)
    return () => clearTimeout(t)
  }, [posts, view])

  const expand = useCallback(
    (m: TradeMode) => {
      // Remembered only to hand the panel its opening side. The panel owns
      // `mode` from then on; this is the initial value, not a mirror of it.
      setOpeningMode(m)
      if (expanded) return
      setView("trade")
      handlers.onExpand()
    },
    [expanded, handlers],
  )

  /**
   * Send the draft, and SHOW what happened.
   *
   * Every composer routes through here so posting means the same thing from
   * anywhere. On success the card opens the conversation with the new line
   * already in it — the reader watches their sentence become a row, which is
   * the whole confirmation they were owed and never got. Posting used to end
   * with the draft quietly clearing and the card looking untouched while a
   * refetch flew somewhere out of sight.
   */

  /** One step toward the card. Every view has exactly one parent. */
  const back = useCallback(() => {
    c.reset()
    if (view === "thread") {
      // The conversation owns what leaving a thread means — dropping the
      // reply draft with it. The card only owns where you land.
      c.closeThread()
      setView("feed")
      return
    }
    setView("card")
  }, [view, c])

  // Nonce > 0 means the panel asked for the card. Skip 0/undefined so a
  // fresh mount never self-opens — arrival stays quiet by design.
  useEffect(() => {
    if (expandSignal) expand(expandMode ?? "buy")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandSignal])

  /**
   * A nonce the panel focuses its amount on, bumped every time the panel
   * opens. The card used to reach into the input with a ref; that ref lived
   * up here purely so an effect up here could fire, which is the shape that
   * kept the whole amount-entry state stranded outside the panel.
   */
  const [focusSignal, setFocusSignal] = useState(0)
  const [openingMode, setOpeningMode] = useState<TradeMode>("buy")
  // The chart is closed at rest — the card must not grow a control that
  // competes with Buy — and opens on a tap of the sparkline, exactly the
  // way the chip's chevron opens the chip's chart.
  const [chartOpen, setChartOpen] = useState(false)
  /**
   * THE ENLARGED CHART. It renders as a SIBLING of .wrap, never inside it:
   * .wrap is position:fixed WITH a transform (translateY(-50%)), and a
   * transformed element is the containing block for any fixed descendant.
   * A "fullscreen" overlay nested in the card would have been fullscreen
   * relative to a 344px card.
   */
  const [chartBig, setChartBig] = useState(false)
  // The reader's own average entry, for the chart's dashed level. Read once
  // when the chart opens (an authenticated call the resting card must not
  // make on every page), and only if the reader holds this asset.
  const [avgEntry, setAvgEntry] = useState<number | null>(null)
  useEffect(() => {
    if (!chartOpen || !handlers.onReader) return
    let alive = true
    void handlers
      .onReader(asset.mint)
      .then((r) => {
        if (alive) setAvgEntry(r?.avgEntryPriceUsd ?? null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [chartOpen, asset.mint, handlers])
  useEffect(() => {
    if (expanded) setFocusSignal((n) => n + 1)
  }, [expanded])

  /**
   * Escape steps back, and at the card it dismisses — the same ladder the ←
   * walks, on the key every person already tries first.
   *
   * Listening on the CARD's root rather than the document: this thing lives on
   * somebody else's page, and swallowing their Escape while nobody is even
   * looking at the card would be the rudest possible bug. The card is only
   * reachable by keyboard once focus is inside it, which is exactly when
   * Escape should mean this.
   */
  const onKeyDown = useCallback(
    (e: { key: string; stopPropagation(): void }) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      // The enlarged chart is the innermost thing open, so it goes first.
      // Without this the same Escape that meant "close the chart" dismissed
      // the whole card out from under it.
      if (chartBig) {
        setChartBig(false)
        return
      }
      if (view === "card") handlers.onDismiss()
      else back()
    },
    [view, back, handlers, chartBig],
  )

  /**
   * The overlay renders OUTSIDE .wrap, so .wrap's own onKeyDown never sees
   * a key pressed while it is open. This listens where the key actually
   * lands, and only while there is something to close.
   */
  useEffect(() => {
    if (!chartBig) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setChartBig(false)
    }
    document.addEventListener("keydown", onEsc, true)
    return () => document.removeEventListener("keydown", onEsc, true)
  }, [chartBig])

  /**
   * A card that goes away takes its overlay with it. Switching mints under
   * an open chart would otherwise leave a full-screen chart of the asset
   * the reader just navigated off.
   */
  useEffect(() => {
    setChartBig(false)
  }, [asset.mint])


  const changeText = change(asset.change24hPct)
  const changeClass =
    asset.change24hPct === null ? "" : asset.change24hPct >= 0 ? "up" : "down"

  /**
   * Holder count is an on-chain wallet tally, not the issuer's real
   * shareholder base. For a tokenized equity or commodity that number is an
   * artifact of how new the wrapper is, not a legitimacy signal — a
   * SpaceX card reading "255 Holders" beside a nine-figure market cap
   * undermines the fact next to it instead of supporting it. A crypto-native
   * asset has no such mismatch: the chain IS the cap table, so the count is
   * the same honest number every trader already reads it as elsewhere.
   */
  const showHolders = asset.category === "token" || asset.category === "memecoin"
  const mcapText = compactUsd(asset.mcap)
  const holdersText = showHolders ? compactCount(asset.holderCount) : ""

  /**
   * How the conversation's size is SAID, in one place.
   *
   * The card fetches a page, not the conversation, so an exact total does
   * not exist to print — the server does cursor pagination and answers
   * `hasNextPage` instead. "20+" is the honest shape of that; printing "20"
   * on a page with hundreds would be the card asserting a number nobody
   * counted, which is the same failure as the X tick.
   */
  const countLabel = `${feed.length}${postsHasMore ? "+" : ""}`

  /**
   * A post's TEXT, formatted for what it is.
   *
   * The other half of postHead, and extracting only the head was the
   * incomplete fix: the "is this a receipt" decision was still written out
   * four separate times — once in the strip, once in the thread's opening
   * post, twice in the feed row — each carrying its own copy of the class
   * name and the trim. Three of them already differed by the time this was
   * counted, which is how the strip ended up showing a tail nobody else
   * showed.
   */
  const postBody = (p: CardPost) => (
    <>
      <span className={`post-text${p.isTrade ? " post-text-trade" : ""}`}>
        {postText(p)}
      </span>
      {/**
       * THE ROW IS A DOOR. A receipt used to be the end of the story: it
       * said what somebody did and left the reader to go find the asset
       * themselves. With the structured trade on the wire the same row can
       * hand them the trade in one tap.
       *
       * Only for BUYS. Copying a sale means selling something the reader
       * probably does not hold, and a sheet that opens onto "you hold none"
       * is a dead end dressed as an invitation.
       */}
      {p.trade && p.side !== "sell" && (
        <button
          className="post-copy"
          data-act="copy-trade"
          aria-label={`Buy ${bareSymbol(p.trade.symbol)}`}
          onClick={() => handlers.onCopyTrade?.(p.trade!.mint, p.trade!.symbol)}
        >
          Buy {tickerText(p.trade.symbol)}
        </button>
      )}
    </>
  )

  /**
   * The row above a post's text: face, name, direction, time.
   *
   * Extracted because the thread's opening post had its own older copy — a
   * blue name run straight into the sentence, no face, no clock, and an
   * untrimmed trade receipt. Every improvement made to the feed row since
   * had simply missed it, which is the third time this session a surface
   * kept a private copy of shared formatting and fell behind. One function,
   * both callers, nothing left to drift.
   */
  const postHead = (p: CardPost) => (
    <div className="post-head-row">
      <button
        className="post-ava"
        data-act="author"
        aria-label={p.author}
        onClick={() => handlers.onAuthor?.(p.authorId)}
        style={
          p.avatarUrl
            ? { backgroundImage: `url(${p.avatarUrl})`, backgroundSize: "cover" }
            : undefined
        }
      >
        {p.avatarUrl ? "" : p.author.charAt(0).toUpperCase()}
      </button>
      <button
        className="post-author"
        data-act="author"
        onClick={() => handlers.onAuthor?.(p.authorId)}
      >
        {p.author}
      </button>
      {p.isTrade && p.side && (
        <span className={`post-tag ${p.side}`}>
          {p.side === "buy" ? "Buy" : "Sell"}
        </span>
      )}
      <span className="post-when">{relTime(p.createdAt)}</span>
    </div>
  )

  /** Up to three distinct voices, as initials. Deduped by AUTHOR, not by
   *  letter: Ada and Alex are two people who happen to share an A. */
  const faces = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ initial: string; url?: string | null }> = []
    for (const p of feed) {
      const key = p.authorId || p.author
      if (seen.has(key)) continue
      seen.add(key)
      // The PHOTO when there is one. The strip was written before avatars
      // reached CardPost and kept drawing initials for everybody, so the
      // faces said "somebody" where the feed one tap away said who.
      out.push({ initial: p.author.charAt(0).toUpperCase(), url: p.avatarUrl })
      if (out.length === 3) break
    }
    return out
  }, [feed])

  /**
   * THE CONVERSATION STRIP — one line, alive, and present at the decision.
   *
   * This replaces two static teaser rows, and the reason is not space. Two
   * fixed rows are a screenshot of a conversation; one row carrying the
   * NEWEST voice changes when somebody speaks, and a thing that changes is
   * the only thing that reads as live. The card's motion rule says the same
   * in the other direction: liveness comes from what changes, not from
   * something moving on a timer.
   *
   * AND IT SURVIVES THE PANEL. The old rows were gated on `!expanded`, so
   * pressing Buy deleted the conversation from the screen — at exactly the
   * moment "what are people saying" is worth the most. Social proof beside
   * the decision is the whole move; hiding it there was backwards.
   *
   * Absent when the feed is open (the full list is right there) and when
   * nobody has spoken (the composer's placeholder does the inviting).
   */
  /**
   * How many distinct people BOUGHT on this page, counted from the trade
   * receipts already in the feed. The strip has always said how many are
   * talking; on a trading product the number that moves a reader is this
   * one — and every claim it makes is checkable in the receipts below it.
   */
  const proofBuyers = countTradeProof(feed).buyers

  const conversationStrip =
    !showPosts && feed.length > 0 ? (
      <button
        className="convo"
        data-act="convo"
        aria-label={`${countLabel} ${feed.length === 1 && !postsHasMore ? "post" : "posts"} — open the conversation`}
        onClick={() => {
          setView("feed")
          handlers.onPosts?.()
        }}
      >
        <span className="convo-faces" aria-hidden="true">
          {faces.map((f, i) => (
            <span
              className="convo-face"
              key={i}
              style={
                f.url
                  ? { backgroundImage: `url(${f.url})`, backgroundSize: "cover" }
                  : undefined
              }
            >
              {f.url ? "" : f.initial}
            </span>
          ))}
        </span>
        {proofBuyers > 0 && (
          <span className="convo-proof" data-proof>
            {proofBuyers} bought
          </span>
        )}
        <span className="convo-text">
          {postText(feed[0])}
        </span>
        {/* A BARE NUMBER AT THE END OF A ROW READS AS A TIMESTAMP. It was
            reported as exactly that — "14, is that minutes?" — and the row
            gives it every reason to: feed rows put a relative time in this
            same right-hand slot. The glyph is what makes it a count, and it
            doubles as the affordance: a speech bubble says the row opens a
            conversation without spending a word on "tap to see". */}
        <span className="convo-count">
          <ChipGlyphIcon glyph={GLYPH_REPLY} size={CHIP_GLYPH_SIZE} />
          {countLabel}
        </span>
      </button>
    ) : null

  /**
   * ONE button, rendered in TWO places — and it has to be, because sharing
   * to Poppin moves the reader to the feed, and the X button lived in the
   * panel they just left. Amplification belongs beside the thing it
   * amplifies, so it follows the post into the conversation.
   *
   * Disabled until the Poppin post exists: the link X carries points at
   * that post, so there is literally nothing to share before it.
   *
   * IT DOES NOT CLAIM A TICK, and that is not a detail. All this can do is
   * open X's composer in a new tab — whether the reader then posts, edits,
   * or closes it is on the other side of a boundary we cannot see across.
   * The first version latched to "On X ✓", which asserted a fact nobody had
   * checked: a person who opened the tab and changed their mind was told by
   * our own UI that they had shared. "Opened ↗" is the whole of what we
   * know, and the button stays pressable because the honest answer to "did
   * that work?" is to let them do it again.
   */
  const shareOnXButton = outcome?.share ? (
    <button
      className="ghost"
      data-act="share-x"
      disabled={!shared}
      title={shared ? undefined : "Share on Poppin first"}
      onClick={async () => {
        const ok = await outcome.share!.onX()
        if (ok) setSharedX(true)
      }}
    >
      {sharedX ? "Opened ↗" : "Share on X"}
    </button>
  ) : null

  return (
    <>
    <div
      ref={wrapRef}
      className={`wrap${nudging ? " nudge" : ""}${leaving ? " leaving" : ""}`}
      onKeyDown={onKeyDown}
    >
     {/*
       The card's one navigation bar: ← on the left when there is somewhere
       to go back to, × on the right always. Both sit in the card's true
       corners, clear of the content, and they are the ONLY two controls that
       never move — so "get out of here" and "go back one" are muscle memory
       instead of a hunt. The in-body back buttons this replaces lived at a
       different height in every view.
     */}
     {view !== "card" && (
       <button
         className="nav-back"
         data-act="back"
         aria-label={view === "thread" ? "Back to the conversation" : "Back to the card"}
         onClick={back}
       >
         <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
           <path
             d="M10 3.2 5.2 8l4.8 4.8"
             fill="none"
             stroke="currentColor"
             stroke-width="1.9"
             stroke-linecap="round"
             stroke-linejoin="round"
           />
         </svg>
       </button>
     )}
     <button
       className="x"
       data-act="dismiss"
       aria-label="Dismiss"
       onClick={handlers.onDismiss}
     >
       <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
         <path
           d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"
           fill="none"
           stroke="currentColor"
           stroke-width="1.9"
           stroke-linecap="round"
         />
       </svg>
     </button>

     {/* ── Collapsed head: identity column left, numbers column right ────── */}
     {/*
       NOT ON THE `me` VIEW. Every other view is still about this asset — the
       panel prices it, the feed is the conversation on this page about it —
       so keeping the head there keeps the reader's place. The book is the one
       view that is about the READER, and a Tesla header over your own
       portfolio is the card answering a question nobody asked on a screen
       that already has its own subject. The identity row in Me.tsx is that
       screen's head.
     */}
     {!showMe && (
       <div className={`head${view !== "card" ? " head-inset" : ""}`}>
         <div className="col-left">
           {/* The asset's own mark — colour and identity in one 34px square,
               which is most of what separates a market row from a label. A
               page whose CSP refuses the image simply loses the logo: the
               onError hides the element rather than leaving a broken glyph. */}
           {iconUri && (
             <img
               className="logo"
               src={iconUri}
               alt=""
               onError={(e) => {
                 ;(e.currentTarget as HTMLElement).style.display = "none"
               }}
             />
           )}
           <div className="col-id">
             <span className="name">{asset.displayName}</span>
             <div className="subrow">
               <span className="ticker">{tickerText(asset.symbol)}</span>
             {/* Live social proof at the top, beside the identity it belongs
                 to — "4 live" buried in the footer was the card's best FOMO
                 fact told in its quietest voice. Rendered from 2 up: a count
                 of 1 is the reader themselves. */}
               {typeof watched === "boolean" && handlers.onToggleWatch && (
                 <button
                   className={`watch-star${watched ? " on" : ""}`}
                   data-act="watch"
                   aria-pressed={watched}
                   aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
                   onClick={handlers.onToggleWatch}
                 >
                   <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                     <path
                       d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.87l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85L12 3.6z"
                       fill={watched ? "currentColor" : "none"}
                       stroke="currentColor"
                       stroke-width="1.6"
                       stroke-linejoin="round"
                     />
                   </svg>
                 </button>
               )}
               {typeof presence === "number" && presence >= 2 && (
                 <span className="presence" data-presence>
                   <span className="presence-dot" aria-hidden="true" />
                   {presence} live
                 </span>
               )}
             </div>
           </div>
         </div>
         <div className="col-num">
           <span className={`price${priceFlash ? ` flash-${priceFlash}` : ""}`}>
             {price(asset.usdPrice)}
           </span>
           {changeText && <span className={`chg ${changeClass}`}>{changeText}</span>}
         </div>
       </div>
     )}

     {/* The market strip: the day's shape, then the row of context numbers.
         Card face only — the panel is the amount's room, and a thread view
         is the conversation's; neither wants a chart shouldering in. */}
     {view === "card" && !expanded && (
       <>
         {/* The window the shape covers, said out loud. An unlabelled chart
             is a claim with no scale: the same line is a calm day or a
             violent hour depending on an axis nobody drew. This is a LABEL,
             not a toggle — the reader who wants to compare timeframes is
             already on a page that does that, and a control here would
             compete with the one button that spends money. */}
         {asset.spark24h && asset.spark24h.length >= 8 && !chartOpen && (
           <button
             className="spark-open"
             aria-label="Open the price chart"
             onClick={() => handlers.onSeries && setChartOpen(true)}
           >
             <div className="spark-k">24H{handlers.onSeries ? " ›" : ""}</div>
             <Sparkline points={asset.spark24h} changePct={asset.change24hPct} />
           </button>
         )}
         {/* PARITY WITH THE CHIP, one tap in. Ranges, the reader's fills at
             their executed price, standing-order levels, the average-entry
             line, and a bell to park an alert — the same features the chip's
             chart grew, reusing the same chartMath helpers and the same
             alert helper. Mounted only while open, so the data (series,
             trades, orders) is fetched on the tap and never on a resting
             card. */}
         {chartOpen && handlers.onSeries && (
           <div className="card-chart-wrap">
             <button
               className="cc-grow"
               aria-label="Enlarge the chart"
               onClick={() => setChartBig(true)}
             >
               Enlarge ⤢
             </button>
             <button
               className="cc-close"
               aria-label="Close the chart"
               onClick={() => setChartOpen(false)}
             >
               Close ✕
             </button>
             <CardChart
               mint={asset.mint}
               marketUsd={asset.usdPrice}
               avgEntryUsd={avgEntry}
               held={Boolean(asset.balance && asset.balance.uiAmount > 0)}
               onSeries={handlers.onSeries}
               onMyTrades={handlers.onMyTrades}
               onListOrders={handlers.onListOrders}
               onSaveAlert={handlers.onSaveAlert}
             />
           </div>
         )}
         {(mcapText || holdersText) && (
           <div className="statline">
             {mcapText && (
               <span className={`stat${holdersText ? "" : " stat-solo"}`}>
                 <span className="stat-k">MC</span> {mcapText}
               </span>
             )}
             {holdersText && (
               <span className="stat">
                 <span className="stat-k">Holders</span> {holdersText}
               </span>
             )}
           </div>
         )}
       </>
     )}

     {/* The button NAMES what it spends money on. "Buy" is unambiguous while
         you are looking at the card, and this card lives on somebody else's
         page, where a lone verb is the one control a person presses without
         re-reading the surface it came from. Naming the asset costs four
         characters and removes the last "wait, buy what?" */}
     {!expanded && !showMe && (
       <div className="acts">
         <button data-act="buy" onClick={() => expand("buy")}>
           Buy {bareSymbol(asset.symbol)}
         </button>
         <button data-act="sell" className="sell" onClick={() => expand("sell")}>
           Sell {bareSymbol(asset.symbol)}
         </button>
       </div>
     )}

     {/* THE CONVERSATION IS ONE BLOCK: what people said, then the field to
         say something. It used to sit ABOVE Buy, which put the money control
         between the proof and the invitation — two halves of one thing with
         a spend button wedged in the middle, and the reader read the strip
         as belonging to the price rather than to the thread it opens.

         Market, then money, then the room: the same order the panel puts
         them in, and the order the card's own header has always claimed. */}
     {!expanded && !showMe && conversationStrip}

     {expanded && (
       <TradePanel
         asset={asset}
         handlers={handlers}
         quote={quote}
         quoteSub={quoteSub}
         quoteError={quoteError}
         canConfirm={canConfirm}
         outcome={outcome}
         gate={gate}
         focusSignal={focusSignal}
         initialMode={openingMode}
         conversationStrip={conversationStrip}
         shareRow={
           outcome?.state === "done" && outcome.share ? (
             <div className="share-row">
               <button
                 data-act="share-poppin"
                 disabled={shared || sharing}
                 onClick={async () => {
                   setSharing(true)
                   const ok = await outcome.share!.onPoppin()
                   setSharing(false)
                   if (!ok) return
                   setShared(true)
                   setView("feed")
                   handlers.onPosts?.()
                 }}
               >
                 {shared ? "Shared ✓" : sharing ? "…" : "Share on Poppin"}
               </button>
               {shareOnXButton}
             </div>
           ) : null
         }
       />
     )}

     {/* The trade landed HERE, so the offer to amplify it lives here too —
         the reader arrived in this view by sharing, and the next natural
         thought is "also on X".

         It STAYS once spent, reading "On X ✓". An earlier pass removed it
         on success, which left the reader watching a button vanish as the
         only evidence anything happened — the same silent-success failure
         the Poppin button's own "Shared ✓" exists to prevent. */}
     {showPosts && !c.thread && shared && shareOnXButton && (
       <div className="share-row share-row-feed">{shareOnXButton}</div>
     )}
     {showPosts && (
       <Conversation
         c={c}
         handlers={handlers}
         postHead={postHead}
         postBody={postBody}
       />
     )}

     {/* Mounted only while it is open, which is what keeps a private,
         authenticated wallet read off every page the reader ever visits.
         See the note at the top of Me.tsx. */}
     {showMe && (
       <Me handlers={handlers} cashUsd={cashUsd} me={me} initialTab={meTab} />
     )}

     {/* Whose card this is. Quiet by design — a reader should be able to tell
         where a trade surface on someone else's page came from, and that is
         an accountability requirement before it is a branding one.

         The conversation hangs HERE rather than beside Buy/Sell, and the row
         is the reason it works: posts belong to the page and to Poppin, a
         trade belongs to the asset. Two axes, two rows — and no third button
         competing with the two that spend money. */}

     {/* ── Say it here. The composer used to live behind the posts door,
         which meant writing REQUIRED a detour — and the owner kept reading
         the card as "my post is invisible". One line, always present when
         collapsed, posting straight into the feed above it.

         THE PLACEHOLDER CARRIES THE INVITATION, and it changes with the
         room. "Say something…" was the vaguest thing on the card: a form
         field with no reason attached, which never said whether anybody
         had ever written in it, so the safest read was that nobody had.
         Empty asks a QUESTION, because a question wants an answer and an
         instruction only wants compliance; busy says there is something to
         join. Same field, two different rooms.

         This started as a LABEL ABOVE the field and that was wrong — a
         line saying "Drop the first take" over a box saying "Say
         something…" is two invitations stacked, which is the card's own
         "say something twice" bug wearing new clothes. One element, one
         voice.

         It carries no count and no faces for the same reason: when a
         conversation exists the strip directly above already shows the
         faces and the number. Proof there, invitation here. */}
     {!showPosts && !expanded && !showMe && (
       <div className="mini-compose">
         <input
           type="text"
           placeholder={
             feed.length > 0 ? "Join the conversation" : "What's your take?"
           }
           value={c.draft}
           disabled={c.posting}
           onInput={(e: { target: EventTarget | null }) => {
             c.setDraft((e.target as HTMLInputElement).value)
             c.clearError()
           }}
           onKeyDown={(e: { key: string }) => {
             if (e.key === "Enter") void c.submitPost()
           }}
         />
         {/* iMessage's rule: the send control exists once there is something
             to send. At rest the row is one quiet field. `posting` keeps it
             on screen through the in-flight beat after the draft clears. */}
         {(c.draft.trim().length > 0 || c.posting) && (
           <button
             data-act="mini-post"
             disabled={c.posting || c.draft.trim().length === 0}
             onClick={() => void c.submitPost()}
           >
             {c.posting ? "…" : "Post"}
           </button>
         )}
       </div>
     )}
     {!showPosts && !expanded && !showMe && <PostError error={c.postError} verb="post" />}

     <div className="brand">
       {/* THE MARK IS A MARK. It used to double as a badge that opened the
           panel's social inbox — a room that closed on 2026-09-20 because
           no money event could reach it. The reader's own face, two slots
           over, already opens the Activity tab when there is news, and
           that news is fired alerts and filled orders. One badge, one door,
           and it leads somewhere that holds money. */}
       <PoppinMark />
       <span className="wordmark">poppin</span>
       <div className="brand-right">
         {/* LABELLED, not bare. "$7.05" on its own beside a face is a
             number with no noun: P&L, this asset's price, what you spent
             today, what you have — all plausible, and a reader on a money
             surface should not be guessing which. It is the reader's USDC
             spending power (fetchSpendingPower), and "Balance" is the word
             for that. Same muted-key/bright-value idiom the market strip
             already uses, so the card is not inventing a second grammar. */}
         {typeof cashUsd === "number" && (
           <span className="me-cash" data-cash>
             {/* "USDC", the same word the Me view and the trade sheet use:
                 two surfaces disagreeing about what the money is called is
                 how trust leaks (Me.tsx's own rule). */}
             <span className="stat-k">USDC</span> ${cashUsd.toFixed(2)}
           </span>
         )}
         {/*
           THE BADGE DECIDES WHERE THIS GOES, which is why there is still one
           control and not two. A count on the avatar is a promise that
           pressing it shows you the thing being counted; an avatar that
           wore a badge and then opened a portfolio would be pointing at one
           thing and delivering another. With nothing waiting it opens
           Holdings, which is what people press their own face for.

           The collapsed pill keeps its own badge — when the card is open the
           pill is not on screen, so unread had nowhere to live until now.
         */}
         {me && (
           <button
             type="button"
             className="me-avatar"
             data-act="me"
             aria-label={
               unread && unread > 0 ? "Your activity" : "Your portfolio"
             }
             onClick={() => {
               setMeTab(unread && unread > 0 ? "activity" : "book")
               setView("me")
             }}
           >
             <Face name={me.name} url={me.photoUrl} className="me-face" />
             {typeof unread === "number" && unread > 0 && (
               <span className="me-avatar-badge" data-me-unread>
                 {unread > 9 ? "9+" : unread}
               </span>
             )}
           </button>
         )}
         {/* THE DOOR TO THE SIDEBAR — the one card→panel link, in the one
             slot that is always on screen.

             This was "N posts →", which opened the conversation INSIDE the
             card. That door already exists and is better: the strip above
             carries the newest voice, the faces and the count, and tapping
             it opens the same view. Two controls for one destination, and
             the duplicate wore the only footer slot the card has.

             The sidebar is the app; the card is its scout. Sending someone
             there is the move worth a permanent control — and it takes the
             card off the page on the way out, because leaving a card open
             over the thing you just left is how two surfaces argue about
             who is in front. */}
         {handlers.onOpenPanel && (
           <button
             className="panel-door"
             data-act="open-panel"
             aria-label="Open Poppin in the sidebar"
             title="Open in sidebar"
             onClick={() => handlers.onOpenPanel?.("home")}
           >
             <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
               <rect
                 x="1.65"
                 y="3.15"
                 width="12.7"
                 height="9.7"
                 rx="2.2"
                 fill="none"
                 stroke="currentColor"
                 strokeWidth="1.3"
               />
               <path
                 fill="currentColor"
                 d="M9.95 4.45h2.35c.63 0 1.15.52 1.15 1.15v4.8c0 .63-.52 1.15-1.15 1.15H9.95z"
               />
             </svg>
           </button>
         )}
       </div>
     </div>
    </div>
    {chartBig && handlers.onSeries && (
      <div
        className="cc-scrim"
        /* Tap the surround to leave, the way every sheet on this product
           closes. The chart itself stops the event so a scrub that ends
           past the plot does not dismiss what it was reading. */
        onClick={() => setChartBig(false)}
      >
        <div className="cc-stage" onClick={(e) => e.stopPropagation()}>
          <button
            className="cc-shrink"
            aria-label="Close the chart"
            onClick={() => setChartBig(false)}
          >
            Close ✕
          </button>
          <CardChart
            big
            mint={asset.mint}
            marketUsd={asset.usdPrice}
            avgEntryUsd={avgEntry}
            held={Boolean(asset.balance && asset.balance.uiAmount > 0)}
            onSeries={handlers.onSeries}
            onMyTrades={handlers.onMyTrades}
            onListOrders={handlers.onListOrders}
            onSaveAlert={handlers.onSaveAlert}
          />
        </div>
      </div>
    )}
    </>
  )
}
