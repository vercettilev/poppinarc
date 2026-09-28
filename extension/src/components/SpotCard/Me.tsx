/** @jsxImportSource preact */
/*
 * THE PRAGMA ABOVE IS LOAD-BEARING — same reason as SpotCard.tsx, TradePanel
 * and Conversation. Preact renders this tree; without the pragma the JSX
 * produces React elements and Preact silently drops every child.
 */
import { useEffect, useRef, useState } from "preact/hooks"
import { price, relTime, type SpotCardHandlers } from "./SpotCard"
import {
  BELL_GLYPH,
  FILL_GLYPH,
  NOTIFICATION_GLYPHS,
  type NotificationKind,
} from "~/helpers/notificationText"
import { siteFaviconUrl, siteHost, siteHoverText } from "~/helpers/siteMark"

/**
 * The reader's own book, opened without leaving the page.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The card had three doors and all three led OUT of it: the avatar, the unread
 * badge and an author's name each opened the side panel. Every one of them
 * threw the reader off the page they were reading to a surface that does not
 * know what page that was. The avatar is the one people press most, and what
 * they press it for is money — so this is what it opens now.
 *
 * ── WHY IT FETCHES ITSELF ───────────────────────────────────────────────────
 * A portfolio is a private, authenticated read, and the card is mounted on
 * every page the reader visits. Fetching it in the card would put a wallet
 * scan behind every article anybody opens, to answer a question nobody asked.
 * This component only mounts when the view is `me`, so the request happens on
 * the press that asked for it and nowhere else.
 */

/** One holding, in the terms the card shows it. */
export interface CardHolding {
  mint: string
  ticker: string
  displayName: string
  uiAmount: number
  /** null when the price lookup failed — the holding is still real. */
  valueUsd: number | null
  change24hPct: number | null
  /**
   * null means we do not know what they PAID, which is not the same as zero.
   * A position bought before the ledger existed, or moved in from elsewhere,
   * has a value we can see and a profit we cannot compute.
   */
  pnlUsd: number | null
}

export interface CardBook {
  holdings: readonly CardHolding[]
  totalUsd: number
  /**
   * Profit across the WHOLE book, or null when any single holding's basis is
   * unknown.
   *
   * The backend returns a total summed over only the holdings it can price
   * against a basis, which is the right answer to a different question. On a
   * money screen "+$12.30" reads as a claim about everything on it; if half
   * the book is excluded from that number, the number is true and the sentence
   * it forms is not. spotCardFlow collapses the partial case to null, and the
   * per-row figures still tell the reader what is actually known.
   */
  totalPnlUsd: number | null
  /** What the whole book cost. Non-null exactly when totalPnlUsd is. */
  totalInvestedUsd: number | null
  cashUsd: number
}

/**
 * One line of what happened involving this reader.
 *
 * Mirrors pagePosts.CardActivityRow — the card must not import the data layer,
 * the same rule PostOutcome and CardBook follow.
 */
export interface CardActivity {
  id: string
  kind: "mine" | "event"
  who?: string | null
  avatarUrl?: string | null
  text: string
  createdAt: string
  unread?: boolean
  isTrade?: boolean
  side?: "buy" | "sell" | null
  url?: string | null
  noteKind?: NotificationKind | null
}

/**
 * A price alert that FIRED, and one still standing — display mirrors of the
 * helpers/priceAlerts shapes, for the same reason CardActivity mirrors
 * pagePosts: the card must not import the data layer. The strip's Activity
 * band shows these; a reader who parks an alert from a tweet and then reads
 * an article deserves the same news on the card they meet there.
 */
export interface CardFired {
  id: string
  symbol: string | null
  targetUsd: number
  direction: "above" | "below"
  atUsd: number
  firedAt: number
  read: boolean
}

/** A standing order that filled — the card's mirror of PendingFill. */
export interface CardFill {
  orderKey: string
  mint: string
  symbol: string | null
  side: "buy" | "sell"
  triggerPriceUsd: number
  at: number
}

export interface CardAlert {
  id: string
  symbol: string | null
  targetUsd: number
  direction: "above" | "below"
}

/** A standing order, any mint — the strip's Orders tab, on the card. */
export interface CardOrder {
  orderKey: string
  side: "buy" | "sell"
  symbol: string | null
  amountUsd: number | null
  amountUi: number
  triggerPriceUsd: number
}

/**
 * A read that always ANSWERS, even when the network does not.
 *
 * `sendApiRequest` rides chrome.runtime.sendMessage to the service worker, and
 * a message whose port is never answered leaves the await pending forever —
 * which is what "Reading your activity…" and nothing else looked like. A view
 * that can wait without end is a bug whatever the cause underneath: the reader
 * is owed either the thing or the news that it did not come.
 *
 * Resolves null on timeout, which the callers already handle as "could not
 * read" with a retry, so a slow network degrades into the same honest screen
 * as a failed one.
 */
const ANSWER_BY_MS = 12_000

function answered<T>(p: Promise<T | null> | undefined, what: string): Promise<T | null> {
  if (!p) return Promise.resolve(null)
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((r) =>
      setTimeout(() => {
        if (process.env.POPPIN_TEST_BUILD === "true") {
          console.info(`[poppin-spot] ${what} never answered in ${ANSWER_BY_MS}ms`)
        }
        r(null)
      }, ANSWER_BY_MS),
    ),
  ])
}

/**
 * A person's face, or their initial when there is no face to show.
 *
 * ── WHY AN <img> AND NOT A background-image ─────────────────────────────────
 * The reader's own avatar rendered as an empty blue disc on every screen, and
 * a CSS background cannot tell you why: null URL, a URL the host page's CSP
 * refuses (this card is a guest on somebody else's page — the asset logo
 * already carries that caveat), and a 404 all paint the same nothing. An
 * <img> has an onError, so a picture that will not load falls back to the
 * initial instead of to a blank circle, and test builds say which case it was.
 *
 * One component for both places the READER's own face appears — the footer
 * avatar and the book's identity row. Two copies of this is how the strip, the
 * panel, the thread head and the reply row each drifted from the feed.
 */
export function Face({
  name,
  url,
  className,
}: {
  name: string
  url?: string | null
  className: string
}) {
  const [broken, setBroken] = useState(false)
  const initial = name.charAt(0).toUpperCase()
  if (!url || broken) {
    if (process.env.POPPIN_TEST_BUILD === "true" && !url) {
      console.info("[poppin-spot] no avatar url for", name)
    }
    return (
      <span className={className} data-face-initial>
        {initial}
      </span>
    )
  }
  return (
    <span className={className} data-face>
      <img
        src={url}
        alt=""
        onError={() => {
          if (process.env.POPPIN_TEST_BUILD === "true") {
            console.info("[poppin-spot] avatar REFUSED by the page:", url)
          }
          setBroken(true)
        }}
      />
    </span>
  )
}

const pct = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`

/** Signed money, for a figure whose sign is the point. */
const signed = (usd: number): string =>
  `${usd >= 0 ? "+" : "-"}${price(Math.abs(usd))}`

/** Enough decimals to be true, few enough to be read. */
const amount = (n: number): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 })

export interface MeProps {
  handlers: SpotCardHandlers
  /**
   * Cash as the CARD already knows it, used as the opening figure so the
   * screen is never blank on arrival. The fetched book replaces it.
   */
  cashUsd?: number | null
  /**
   * The reader, for the identity row. This screen is about THEM and showed no
   * sign of them — a portfolio with a face on it reads as your account, one
   * without reads as a report about somebody.
   */
  me?: { name: string; photoUrl: string | null } | null
  /**
   * Which list to land on. The avatar opens Holdings; the unread badge opens
   * Activity, because a badge that dumped the reader on a portfolio would be
   * pointing at something and then showing them something else.
   */
  initialTab?: "book" | "orders" | "activity"
}

export function Me({ handlers, cashUsd, me, initialTab = "book" }: MeProps) {
  const [tab, setTab] = useState<"book" | "orders" | "activity">(initialTab)
  const [book, setBook] = useState<CardBook | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // A ref, not the effect's own dependency list: an effect that fires twice
  // (StrictMode in dev, a remount under a fast back-and-forth) would send two
  // wallet scans for one press. The retry button drives `attempt` instead.
  const asked = useRef(-1)

  useEffect(() => {
    if (asked.current === attempt) return
    asked.current = attempt
    let live = true
    setFailed(false)
    /**
     * CACHED FIRST, FRESH ON LANDING. The persisted book paints the room
     * in a beat; the live read (8.6s cold, 186ms warm) replaces it. The
     * settled flag keeps a slow cache read from clobbering a fast fresh
     * one, and a failed fresh read behind a painted cache stays QUIET -
     * yesterday's true book beats an error screen.
     */
    let settled = false
    let painted = false
    void Promise.resolve(handlers.onBookCached?.() ?? null).then((cached) => {
      if (!live || settled || !cached) return
      painted = true
      setBook(cached)
    })
    void answered(handlers.onBook?.(), "onBook").then((b) => {
      if (!live) return
      settled = true
      if (b) setBook(b)
      // A failed fresh read behind a painted cache stays quiet: the state
      // variable can't be read here (stale closure), the local flag can.
      else if (!painted) setFailed(true)
    })
    return () => {
      live = false
    }
  }, [attempt, handlers])

  // Activity is fetched on the press that opens it, never before — same rule
  // as the book, one tab further in. A reader who only ever looks at holdings
  // costs two calls fewer than a screen that eagerly loads both.
  const [acts, setActs] = useState<readonly CardActivity[] | null>(null)
  const [actFailed, setActFailed] = useState(false)
  const [actAttempt, setActAttempt] = useState(0)
  const actAsked = useRef(-1)

  // The alert bands ride the SAME press that opens Activity: fired and
  // standing alerts are local storage reads (cheap, never a network), and
  // opening the tab marks the fired news read — the strip's contract, so a
  // reader who saw the news here does not meet a stale badge there.
  const [fired, setFired] = useState<readonly CardFired[] | null>(null)
  const [alerts, setAlerts] = useState<readonly CardAlert[] | null>(null)
  const [fills, setFills] = useState<readonly CardFill[] | null>(null)

  // EVERY press re-reads, not just the first: the asked-refs below reset
  // when a tab is LEFT. Without this, the second Activity open skipped the
  // mark-read (badge lit over the very tab that clears it) and the second
  // Orders open served a stale list under live Cancel buttons — the exact
  // failure the strip re-reads per open to prevent.
  useEffect(() => {
    if (tab !== "activity") actAsked.current = -1
    if (tab !== "orders") ordAsked.current = -1
  }, [tab])

  useEffect(() => {
    if (tab !== "activity") return
    if (actAsked.current === actAttempt) return
    actAsked.current = actAttempt
    let live = true
    setActFailed(false)
    void answered(handlers.onActivity?.(), "onActivity").then((rows) => {
      if (!live) return
      if (rows) setActs(rows)
      else setActFailed(true)
    })
    void answered(handlers.onListFired?.(), "onListFired").then((rows) => {
      if (live && rows) setFired(rows)
    })
    void answered(handlers.onListFills?.(), "onListFills").then((rows) => {
      if (live && rows) setFills(rows)
    })
    void answered(handlers.onListAlerts?.(), "onListAlerts").then((rows) => {
      if (live && rows) setAlerts(rows)
    })
    void handlers.onMarkFiredRead?.()
    return () => {
      live = false
    }
  }, [tab, actAttempt, handlers])

  // Orders: fetched on the press that opens the tab, refetched after a
  // cancel — a stale list under a Cancel button invites cancelling a fill.
  const [orders, setOrders] = useState<readonly CardOrder[] | null>(null)
  const [ordFailed, setOrdFailed] = useState(false)
  const [ordAttempt, setOrdAttempt] = useState(0)
  const ordAsked = useRef(-1)
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== "orders") return
    if (ordAsked.current === ordAttempt) return
    ordAsked.current = ordAttempt
    let live = true
    setOrdFailed(false)
    void answered(handlers.onListAllOrders?.(), "onListAllOrders").then((rows) => {
      if (!live) return
      if (rows) setOrders(rows)
      else setOrdFailed(true)
    })
    return () => {
      live = false
    }
  }, [tab, ordAttempt, handlers])

  const cancelOrder = (orderKey: string) => {
    if (cancelling) return
    setCancelling(orderKey)
    void Promise.resolve(handlers.onCancelAnyOrder?.(orderKey))
      .catch(() => undefined)
      .then(() => {
        setCancelling(null)
        setOrdAttempt((n) => n + 1)
      })
  }

  const loading = !book && !failed
  const actLoading = !acts && !actFailed
  // The card's own cash until the book lands, so the first paint already says
  // something true rather than a dash that resolves into a number.
  const cash = book?.cashUsd ?? (typeof cashUsd === "number" ? cashUsd : null)

  return (
    <div className="me-view" data-me>
      {me && (
        <div className="me-who">
          <Face name={me.name} url={me.photoUrl} className="me-who-ava" />
          <span className="me-who-n">{me.name}</span>
        </div>
      )}

      {/* THE HERO IS THE SCORE, the strip's framing: when profit across the
          whole book is knowable AND worth a sentence, IT takes the big type
          ("All time") and the portfolio value steps down into the line —
          a trading product's first number is how the trader is DOING, not
          what the pile weighs. Below half a cent the score is noise wearing
          a plus sign (a fully-exited breakeven book read "+$0.00" in
          green), so the value keeps the headline there, same guard the
          strip's headline applies. */}
      {(() => {
        const heroPnl =
          book?.totalPnlUsd !== null &&
          book?.totalPnlUsd !== undefined &&
          Math.abs(book.totalPnlUsd) >= 0.005
            ? book.totalPnlUsd
            : null
        return (
          <div className="me-hero">
            <span className="stat-k">{heroPnl !== null ? "All time" : "Portfolio"}</span>
            {heroPnl !== null ? (
              <span
                className={`me-hero-n ${heroPnl >= 0 ? "up" : "down"}`}
                data-total-pnl
              >
                {signed(heroPnl)}
              </span>
            ) : (
              <span className="me-hero-n">
                {/* A book whose every holding went unpriced is not worth $0.00 —
                    same honesty rule as the profile, same field failure behind it. */}
                {book
                  ? book.holdings.length > 0 &&
                    book.holdings.every((h) => h.valueUsd === null)
                    ? "—"
                    : price(book.totalUsd)
                  : "—"}
              </span>
            )}
            {heroPnl !== null && book && (
              <span className="me-hero-d" data-portfolio-line>
                {price(book.totalUsd)} held
                {book.totalInvestedUsd
                  ? ` · ${pct((heroPnl / book.totalInvestedUsd) * 100)}`
                  : ""}
              </span>
            )}
          </div>
        )
      })()}

      {/* Named in the money's own name — "Cash" made a reader ask which
          currency; the strip already says USDC and two surfaces disagreeing
          about what the money is called is how trust leaks. */}
      {cash !== null && (
        <div className="me-cashline">
          <span className="stat-k">USDC</span> {price(cash)}
        </div>
      )}

      {/* Three lists now: Holdings, Orders, My activity. Orders earned the
          third slot when the card learned to show ALL standing orders with
          their exits — money committed on chain was invisible on every
          non-X page. Notifications still share the activity stream: events
          ON your posts belong in the same time-ordered list. */}
      <div className="me-tabs" role="tablist">
        {(["book", "orders", "activity"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            data-tab={t}
            aria-selected={tab === t ? "true" : "false"}
            onClick={() => setTab(t)}
          >
            {t === "book" ? "Holdings" : t === "orders" ? "Orders" : "Activity"}
          </button>
        ))}
      </div>

      {/* data-book-loading is a TEST HOOK and says so. Preact defers effects,
          so a test that counts ticks to reach this view is counting a number
          nobody can defend; waiting for this attribute to leave is waiting for
          the thing the test actually means. */}
      {tab === "book" && loading && (
        <div className="me-note" data-book-loading>
          Reading your book…
        </div>
      )}

      {tab === "book" && failed && (
        <div className="me-note">
          Could not read your book.{" "}
          <button
            type="button"
            className="me-retry"
            data-act="book-retry"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {tab === "book" && book && book.holdings.length === 0 && (
        <div className="me-note">
          Nothing held yet. Anything you buy from a card shows up here.
        </div>
      )}

      {tab === "book" && book && book.holdings.length > 0 && (
        <div className="me-holds">
          {book.holdings.map((h) => (
            <button
              type="button"
              className="me-hold"
              key={h.mint}
              data-hold={h.ticker}
              disabled={!handlers.onTradeHolding}
              onClick={() => handlers.onTradeHolding?.(h.mint)}
            >
              {/* Two columns, each reading top-down from strongest to
                  weakest: what it is over how much of it, and what it is
                  worth over what that has done. The quantity moved to the
                  left because it belongs to the ASSET, not to the money —
                  it was sharing a line with the profit and the two were
                  being read as one figure. */}
              <div className="me-hold-l">
                <span className="me-hold-t">{h.ticker}</span>
                <span className="me-hold-n">
                  {amount(h.uiAmount)} · {h.displayName}
                </span>
              </div>
              <div className="me-hold-r">
                <span className="me-hold-v">
                  {h.valueUsd !== null ? price(h.valueUsd) : "—"}
                </span>
                {h.pnlUsd !== null && (
                  <span className={`me-hold-p ${h.pnlUsd >= 0 ? "up" : "down"}`}>
                    {signed(h.pnlUsd)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === "orders" && orders === null && !ordFailed && (
        <div className="me-note" data-orders-loading>
          Reading your orders…
        </div>
      )}

      {tab === "orders" && ordFailed && (
        <div className="me-note">
          Could not read your orders.{" "}
          <button
            type="button"
            className="me-retry"
            data-act="orders-retry"
            onClick={() => setOrdAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {tab === "orders" && orders && orders.length === 0 && (
        <div className="me-note">
          No standing orders. Park one from any asset's limit sheet.
        </div>
      )}

      {tab === "orders" && orders && orders.length > 0 && (
        <div className="me-holds">
          {orders.map((o) => {
            const sym = (o.symbol ?? "…").replace(/^\$/, "")
            return (
              <div className="me-ord" key={o.orderKey} data-order={o.orderKey}>
                <div className="me-hold-l">
                  <span className={`me-ord-s ${o.side}`}>
                    {o.side === "buy" ? "Buy" : "Sell"}{" "}
                    {o.side === "buy" && o.amountUsd !== null
                      ? `${price(o.amountUsd)} of ${sym}`
                      : `${amount(o.amountUi)} ${sym}`}
                  </span>
                  <span className="me-hold-n">
                    at {price(o.triggerPriceUsd)}
                  </span>
                </div>
                <button
                  type="button"
                  className="me-ord-x"
                  data-act="cancel-order"
                  disabled={cancelling !== null}
                  onClick={() => cancelOrder(o.orderKey)}
                >
                  {cancelling === o.orderKey ? "…" : "Cancel"}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {tab === "activity" && actLoading && (
        <div className="me-note" data-activity-loading>
          Reading your activity…
        </div>
      )}

      {/* A FILLED ORDER LEADS. An alert is news about the market; a fill
          is news about the reader's own money, and until now the only
          announcement was an OS toast nobody sees twice. Same disc
          language as the strip's band, one rung up in the order. */}
      {tab === "activity" && fills && fills.length > 0 && (
        <div className="me-acts" data-fills-band>
          {fills
            .slice()
            .reverse()
            .slice(0, 6)
            .map((f) => (
              <div className="me-act" key={f.orderKey} data-fill={f.orderKey}>
                <span
                  className={`me-act-kind ${f.side === "buy" ? "up" : "down"}`}
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: FILL_GLYPH }}
                />
                <span className="me-act-t">
                  <span className="me-act-who">
                    {(f.symbol ?? `${f.mint.slice(0, 4)}…`).replace(/^\$/, "")}{" "}
                  </span>
                  <span className="me-act-x">
                    {f.side === "buy" ? "bought at" : "sold at"}{" "}
                    {price(f.triggerPriceUsd)}
                  </span>
                </span>
                <span className="me-act-meta">
                  <span className="me-act-when">
                    {relTime(new Date(f.at).toISOString())}
                  </span>
                </span>
              </div>
            ))}
        </div>
      )}

      {/* THE NEWS FIRST: alerts that fired since last look, then the
          stream. Same order and same glyph-disc language as the strip's
          Activity band, because a reader who learned the bell on X must
          meet the same bell here. */}
      {tab === "activity" && fired && fired.length > 0 && (
        <div className="me-acts" data-fired-band>
          {fired.slice(0, 6).map((f) => (
            <div className="me-act" key={f.id} data-fired={f.id}>
              <span
                className={`me-act-kind ${f.direction === "above" ? "up" : "down"}`}
                aria-hidden
                dangerouslySetInnerHTML={{ __html: BELL_GLYPH }}
              />
              <span className="me-act-t">
                <span className="me-act-who">{f.symbol ?? "Alert"} </span>
                <span className="me-act-x">hit {price(f.atUsd)}</span>
              </span>
              <span className="me-act-meta">
                <span className="me-act-when">{relTime(new Date(f.firedAt).toISOString())}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "activity" && actFailed && (
        <div className="me-note">
          Could not read your activity.{" "}
          <button
            type="button"
            className="me-retry"
            data-act="activity-retry"
            onClick={() => setActAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {tab === "activity" &&
        acts &&
        acts.length === 0 &&
        !(fired?.length || alerts?.length || fills?.length) && (
        <div className="me-note">
          Nothing yet. Anything you post, and anything anyone does about it,
          lands here.
        </div>
      )}

      {tab === "activity" && acts && acts.length > 0 && (
        <div className="me-acts">
          {acts.map((a) => (
            <div
              className={`me-act${a.unread ? " unread" : ""}`}
              key={a.id}
              data-activity={a.kind}
            >
              {/* YOUR row wears YOUR face; somebody else's deed wears the
                  deed's mark — the same tinted glyph disc the strip's
                  Activity band and the side panel use, so all three surfaces
                  speak one visual language. The face was rendering an empty
                  grey disc for your own posts once (no "who" — the actor is
                  the reader, right there in `me`), and for events the actor's
                  name is already bold in the sentence; at this row height the
                  disc says more than a 22px photograph did. */}
              {a.kind === "event" && a.noteKind ? (
                <span
                  className="me-act-kind"
                  aria-hidden
                  dangerouslySetInnerHTML={{
                    __html: NOTIFICATION_GLYPHS[a.noteKind],
                  }}
                />
              ) : (
                <Face
                  name={a.kind === "mine" ? (me?.name ?? "you") : (a.who ?? "·")}
                  url={a.kind === "mine" ? (me?.photoUrl ?? a.avatarUrl) : a.avatarUrl}
                  className="me-act-ava"
                />
              )}
              <span className="me-act-t">
                {/* Your own post is the sentence itself; somebody else's
                    action is a name plus what they did. One row shape, two
                    grammars — which is what makes the merged list readable. */}
                {a.kind === "event" && a.who && (
                  <span className="me-act-who">{a.who} </span>
                )}
                {a.isTrade && a.side && (
                  <span className={`post-tag ${a.side}`}>{a.side}</span>
                )}
                <span className="me-act-x">{a.text}</span>
              </span>
              {/* WHERE it happened, top-right, the same mark the side panel
                  puts beside a post — favicon, host, full address on hover.
                  Not a link: this card is a guest on somebody else's page and
                  navigating them away from it is not ours to do. */}
              {/* WHERE it happened: the mark alone, because the host name was
                  the second-widest thing in a 370px row and it repeats on
                  every line — twelve pixels of icon carry the same
                  recognition. The full address is one hover away and it is
                  SELECTABLE: a URL you can read but not copy is a URL you
                  have to retype, which is the version nobody uses. */}
              <span className="me-act-meta">
                {a.url && siteFaviconUrl(a.url, 32) && (
                  <span className="me-act-site" data-site={siteHost(a.url)}>
                    <img src={siteFaviconUrl(a.url, 32)!} alt={siteHost(a.url) ?? ""} />
                    <span className="me-act-url" data-site-url>
                      {siteHoverText(a.url)}
                    </span>
                  </span>
                )}
                <span className="me-act-when">{relTime(a.createdAt)}</span>
              </span>
              {a.unread && <span className="me-act-dot" aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}

      {/* The panel is not replaced, it is no longer the FIRST stop. Everything
          a reader wants most of the time is above this line; the full profile
          keeps its door, one press further away than it used to be. */}
      {handlers.onOpenPanel && (
        <button
          type="button"
          className="me-more"
          data-act="open-panel"
          onClick={() => handlers.onOpenPanel?.("profile")}
        >
          Open full profile
        </button>
      )}
    </div>
  )
}
