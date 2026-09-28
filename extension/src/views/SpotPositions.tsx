import { PageAssetStrip } from "~/components/PageAssetStrip"
import { FrontDoorEmpty, PopDoors } from "~/components/PopDoors"
import { FundDoor } from "~/components/FundDoor"
import { hasNoCash } from "~/helpers/readerCash"
import { InviteRow } from "~/components/InviteRow"
import { CAP } from "~/config/edition"
import { pageCanCarryAsset } from "~/helpers/pageAsset"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { JUICE, JUICE_BUY_FILL } from "~/theme/juice"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import { readBookCache, writeBookCache } from "~/helpers/bookCache"
import { alpha, Box, Typography } from "@mui/material"
import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { OpenOrders } from "~/components/OpenOrders"
import { TradeSheet } from "~/components/TradeSheet"
import { useCountUp } from "~/hooks/useCountUp"
import { mintsWithUnreadFills, PENDING_FILLS_KEY } from "~/helpers/orderFillWatch"
import {
  listOrdersAsset,
  positionsAsset,
  seriesAsset,
  type SpotPosition,
  type SpotPositionsResponse,
} from "~/services/SpotAssetService"
import { flexCardData, flexParts } from "~/helpers/flexCard"
import { shareTradeCard } from "~/helpers/tradeCard"
import { flexPortraitModel } from "~/helpers/flexCardPortrait"
import { flexTweetText, gatherFlexAssets, shareFlexCard, warmFlexAssets } from "~/helpers/flexShare"
import { UserService } from "~/services/UserService"
import { ACCENT, DIM, GREEN, PANEL_CARD, PANEL_PILL, RED } from "~/helpers/panelSurface"
import { priceText } from "~/helpers/priceText"
import { qtyText } from "~/helpers/qtyText"
import { PORTFOLIO_CAPTION, portfolioTotalUsd } from "~/helpers/portfolioTotal"
import { openPnl } from "~/helpers/openPnl"

/**
 * The book — every catalog asset the reader holds, priced, with PnL.
 *
 * Same visual language as the card and the leaderboard: near-black ground,
 * one accent, Apple's red/green pair, tabular numbers. The ONE number this
 * screen exists for is total PnL — it gets display type and color; every
 * row under it is supporting detail.
 *
 * PnL honesty is inherited from the endpoint: null means "basis unknowable"
 * (a holding that predates the trade ledger), and null renders as an em
 * dash, never as $0.00 — zero is a claim of break-even and we can't make it.
 */

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })

const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`

/**
 * Token amounts: helpers/qtyText.ts, which exists because a private copy
 * of this exact formatter printed a real $1.00 purchase of Bitcoin as
 * "0 WBTC" — four fraction digits render anything under 0.00005 as zero.
 * That file says it plainly: "One rule, in one place, because it was
 * learned twice and applied once." This was one of the places it had not
 * reached.
 */
const amount = qtyText

export default function SpotPositions() {
  const { currentUrl } = useCurrentUrlStore()
  const [data, setData] = useState<SpotPositionsResponse | null>(null)
  /**
   * WHAT IS ALREADY COMMITTED. A buy order escrows its USDC on chain, so a
   * reader with a $200 standing buy has $200 less cash and a headline that
   * used to say so without saying why — the order that ate it listed a few
   * pixels below. The wallet's Total balance prints "+$X in open orders"
   * for exactly this reason; this screen now agrees with it. Refetched when
   * an order is cancelled below, because the escrow comes back.
   */
  const [committedUsd, setCommittedUsd] = useState(0)
  const [ordersNonce, setOrdersNonce] = useState(0)
  useEffect(() => {
    let alive = true
    listOrdersAsset("active")
      .then((r) => {
        if (!alive) return
        // Buys escrow USDC; a sell escrows the asset, which the rows already
        // stop counting for the same reason. Only dollars go on a dollar line.
        const usd = (r?.orders ?? [])
          .filter((o) => o.side === "buy")
          .reduce((sum, o) => sum + (o.amountUsd ?? 0), 0)
        setCommittedUsd(usd)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [ordersNonce])
  const [state, setState] = useState<"loading" | "ready" | "signedout" | "error">(
    "loading",
  )
  /**
   * HAS A LIVE READ ANSWERED YET — which "ready" alone does not say.
   *
   * The cached book paints this screen instantly (helpers/bookCache.ts) and
   * moves `state` to "ready" while the real read is still in the air. For a
   * headline that is the whole point: yesterday's newspaper with today's
   * edition on the way. For the funding door it is a trap, and it is the
   * exact trap that door must not fall into: somebody who deposited two
   * minutes ago opens the panel, the cache still says zero, and the one
   * reader who did the thing we asked gets asked again. So the door waits
   * for the live answer, and a cache-painted zero is treated as unknown.
   */
  const [cashIsLive, setCashIsLive] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  /**
   * The open row's mint and side. A holding you cannot act on is a receipt,
   * not a position — and the sidebar owns the money UI now, so the trade
   * happens HERE rather than sending anyone back to the page card.
   */
  const [open, setOpen] = useState<{ mint: string; side: "buy" | "sell" } | null>(null)

  /**
   * FLEX A POSITION — the shareable PnL card. Unrealized-first (the owner's
   * rule: FOMO's flex is unrealized), realized when the position is closed,
   * caller-credited when the entry came from a tweet. Composes on the click:
   * the sparkline is fetched then, the reader's @handle names the brand line,
   * and shareTradeCard copies the PNG and opens the composer with the
   * cashtag-carrying text (the chip-under-tweet loop).
   */
  const [flexing, setFlexing] = useState<string | null>(null)
  /**
   * What actually happened, on the button that asked for it. shareTradeCard
   * resolves three ways and the row has no tail to write into, so the label
   * reports and returns — the strip's own Flex button does the same. Without
   * this a reader on the text-only path (clipboard refused, composer
   * unreachable) is told nothing and goes looking for a card that is not
   * there.
   */
  const [flexNote, setFlexNote] = useState<{ mint: string; text: string } | null>(
    null,
  )
  useEffect(() => {
    if (!flexNote) return
    const t = setTimeout(() => setFlexNote(null), 1600)
    return () => clearTimeout(t)
  }, [flexNote])
  const flexPosition = async (p: SpotPosition) => {
    // A double-tap must not fire two clipboard writes and two composer tabs.
    if (flexing) return
    const parts = flexParts({
      ticker: p.ticker,
      uiAmount: p.uiAmount,
      priceUsd: p.priceUsd,
      avgEntryPriceUsd: p.avgEntryPriceUsd,
      realizedPnlUsd: p.realizedPnlUsd,
      callerSourceUrl: p.callerSourceUrl,
    })
    if (!parts) return
    setFlexing(p.mint)
    /* The portrait card when the numbers allow it; see flexCardPortrait.
       Warmed first, so the font and the mark are on their way while the
       account is being read. */
    const model = flexPortraitModel(p.ticker, parts)
    if (model) warmFlexAssets()
    try {
      // RACED AGAINST A SHORT CLOCK, never simply awaited. shareTradeCard
      // ends in navigator.clipboard.write + window.open, both gated on
      // Chrome's transient user-activation (~5s, and the panel's /positions
      // is an 8.6s cold open away). Blocking the share on two uncached
      // round-trips (the sparkline and the @handle) would blow that window
      // and get the composer popup-blocked while the clipboard write throws.
      // So the decorations are "present if quick, absent if not" — the same
      // faceless-rather-than-late rule the buy card's icon already follows.
      const raced = <T,>(pr: Promise<T>, ms: number) =>
        Promise.race<T | null>([
          pr.catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), ms)),
        ])
      if (model) {
        const user = await raced(UserService.getCurrentUser(), 1200)
        const handle = user?.username ? user.username : null
        const a = await gatherFlexAssets(user?.profile_photo_url ?? null, 1200)
        const how = await shareFlexCard(model, {
          tweetText: flexTweetText(model, p.ticker, parts.credit),
          handle,
          avatarUri: a.avatarUri,
          markUri: a.markUri,
        })
        setFlexNote({
          mint: p.mint,
          text: how === "composed" ? "Ready" : how === "copied" ? "Copied" : "Opened",
        })
        return
      }
      const [series, handle] = await Promise.all([
        raced(seriesAsset(p.mint, "1d").then((r) => r.points), 1200),
        raced(
          UserService.getCurrentUser().then((u) => (u?.username ? u.username : null)),
          1200,
        ),
      ])
    const ticker = p.ticker.replace(/^\$/, "")
    const data = flexCardData(
      {
        ticker,
        series,
        mcap: null,
        priceUsd: p.priceUsd,
        handle,
        // The cashtag is load-bearing — it is what gives other extension
        // readers a live chip under the shared tweet.
        tweetText: `${parts.action} on $${ticker}${parts.credit ? ` ${parts.credit}` : ""} · Poppin`,
      },
      parts,
    )
      const how = await shareTradeCard(data)
      setFlexNote({
        mint: p.mint,
        text: how === "composed" ? "Ready" : how === "copied" ? "Copied" : "Opened",
      })
    } finally {
      setFlexing(null)
    }
  }

  /**
   * One live read, reusable: the mount effect uses it, and so does the
   * moment a trade settles in a row's own inline sheet - the one moment
   * the rows above the sheet are guaranteed stale ("Sold" below, the
   * holding still listed above, the old total on top).
   */
  const refresh = useCallback((alive?: () => boolean) => {
    positionsAsset()
      .then((r) => {
        if (alive && !alive()) return
        setData(r ?? null)
        setState("ready")
        setCashIsLive(true)
        if (r) void writeBookCache(r)
      })
      .catch((e: { status?: number }) => {
        if (alive && !alive()) return
        setState(e?.status === 401 || e?.status === 403 ? "signedout" : "error")
      })
  }, [])

  useEffect(() => {
    let alive = true
    // Yesterday's book NOW, today's the moment it lands — the background's
    // watch keeps this cache at most two minutes old in normal use, so the
    // 8.6s cold open becomes a paint. Display only; trade sheets stay live.
    void readBookCache().then((cached) => {
      if (alive && cached) {
        setData((cur) => cur ?? cached)
        setState((st) => (st === "loading" ? "ready" : st))
      }
    })
    refresh(() => alive)
    return () => {
      alive = false
    }
  }, [refresh])

  const positions = data?.positions ?? []
  /**
   * ONE QUESTION, BOTH SURFACES. The panel led with all-time P&L while the
   * chip's scoreboard led with unrealized, so the same reader saw −$256
   * here and −$598 there and had no way to learn they were different
   * questions (they were also both wrong — see the tracked-lot fix). Both
   * say what the OPEN book is doing now; banked keeps its own line.
   */
  // The same preference the profile card and the chip use, from one file —
  // this line WAS the rule, and a second surface having to re-type it is
  // how the profile card came to read the other field for months.
  const totalPnl = openPnl(data)?.usd ?? null
  const pnlColor = totalPnl === null ? DIM : totalPnl >= 0 ? GREEN : RED
  /**
   * The cached book paints first and the live one replaces it a beat
   * later; without this both headline figures teleported to a different
   * number with nothing to say a refresh had happened. The colour above is
   * deliberately read off the TARGET, not the travelling value - the sign
   * of what is true must not flicker on the way there.
   */
  /**
   * WHICH ROWS ARE CARRYING NEWS.
   *
   * A standing order that filled while the reader was away is greeted in
   * the asset's OWN room (FillCelebration) - one card per asset, not a
   * stack of announcements. But the book was silent about it, so somebody
   * opening the panel landed on a list with the news one tap deeper and
   * nothing pointing at it. The book gets the pointer, not the party.
   */
  const [filledMints, setFilledMints] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    if (!chrome?.storage?.local) return
    const read = () =>
      void chrome.storage.local
        .get(PENDING_FILLS_KEY)
        .then((stored) => setFilledMints(mintsWithUnreadFills(stored?.[PENDING_FILLS_KEY])))
    read()
    // A fill can land while the book is open; the watch runs on its own clock.
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[PENDING_FILLS_KEY]) read()
    }
    chrome.storage.onChanged?.addListener(onChange)
    return () => chrome.storage.onChanged?.removeListener(onChange)
  }, [])

  /**
   * POSITIONS + CASH, because that is what the caption promises.
   *
   * totalUsd is the positions fold alone (spot-swap.service.ts: it sums
   * valueUsd over held mints, and USDC is excluded from those rows on
   * purpose). So a reader who deposited $100 and has not traded yet opened
   * the panel's front door to "$0.00" under a caption reading "positions +
   * cash", with "Cash $100.00 USDC" printed correctly forty pixels below.
   * The deposit-then-panic moment, on the default route. The chip's own
   * headline already adds cash (helpers/youPanelView.ts); this makes the
   * panel agree.
   */
  const portfolioUsd = portfolioTotalUsd(data)
  const shownTotal = useCountUp(portfolioUsd)
  const shownPnl = useCountUp(totalPnl)

  return (
    // Own scroll context — the panel shell does not scroll for its views.
    // flex:1 + minHeight:0, NOT height:100%. Layout's shell is a flex column
    // at 100svh with overflow:hidden; height:100% here measures the WHOLE
    // column including the header above, so the view claimed more room than
    // it was given, its bottom was clipped by the shell, and the last rows
    // were unreachable. Same bug the profile had.
    <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: "auto", boxSizing: "border-box" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2 }}>
        {/* The back arrow belongs to the pushed view, not the front door:
            at "/" there is nothing behind this screen. */}
        {location.pathname !== "/" && (
        <Box
          component="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          aria-label="Back"
          className="click-animation"
          sx={{
            ...PANEL_PILL,
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            color: "#FFFFFF",
            p: 0,
            flexShrink: 0,
            "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
        </Box>
        )}
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>Positions</Typography>
        <Box sx={{ flex: 1 }} />
        {/* The door OUT of your own book: what everyone else is trading.
            One word, right-aligned, quiet — discovery is offered, never
            pushed onto a screen that is about the reader's money. */}
        {CAP.discover && (
        <Box
          component="button"
          onClick={() => navigate("/discover")}
          className="click-animation"
          sx={{
            ...PANEL_PILL, px: 1.25, py: "5px", cursor: "pointer",
            font: "inherit", fontSize: 11.5, fontWeight: 700, color: ACCENT,
            flexShrink: 0,
          }}
        >
          Discover
        </Box>
        )}
      </Box>

      {/* What is tradable on the page the reader is looking at, above what
          they already hold. Same component the feed used to carry it in;
          it belongs at the front door, not under a timeline. */}
      {/* Asked only where a page can answer; X never can (helpers/pageAsset.ts),
          and the skeleton it held over an empty book is gone with the ask. */}
      {pageCanCarryAsset(currentUrl) && <PageAssetStrip currentUrl={currentUrl} />}

      {state === "loading" && (
        <Typography sx={{ fontSize: 13, color: DIM }}>Loading…</Typography>
      )}
      {state === "signedout" && (
        <Typography sx={{ fontSize: 13, color: DIM }}>
          Sign in to see your positions.
        </Typography>
      )}
      {state === "error" && (
        <Typography sx={{ fontSize: 13, color: DIM }}>
          Couldn&apos;t load your book. Try again in a moment.
        </Typography>
      )}

      {state === "ready" && data && (
        <>
          {/* ── NO MONEY, THE ASK. The funding ask was moved out of onboarding
              to "the first trade", which needs somebody to attempt a trade;
              6 of 7 signed-in strangers opened this panel and 0 of 7 ever
              opened the funding screen. So the ask stands here, gated on the
              BALANCE (helpers/readerCash.ts) and on a LIVE read: an unknown,
              loading, failed or cache-painted balance is not a zero, and a
              funding prompt over one lands on the reader who just funded. */}
          {/* onConnected is the same live read a settled trade uses, for the
              same reason: connecting a wallet changes WHICH wallet this book
              belongs to, so every row above is stale the instant it lands. */}
          {cashIsLive && hasNoCash(data) && <FundDoor onConnected={refresh} />}
          {/* ── THE FRONT DOOR HAS THREE STATES. No book: one sentence for
              the reader's state and the doors to where the chips are (no
              $0.00 headline, no P&L dash). A book: the headline below. */}
          {positions.length === 0 ? (
            <FrontDoorEmpty cashUsd={data.cashUsd} />
          ) : (
          <Box
            sx={{ ...PANEL_CARD, p: 2, mb: 2 }}
          >
            <Typography sx={{ fontSize: 12, color: DIM }}>
              {/* The SCOPE, named, and named in ONE place: helpers/
                  portfolioTotal.ts owns both this caption and the fold
                  under it, so the wallet screen cannot drift into a second
                  wording over a second sum. */}
              {PORTFOLIO_CAPTION}
            </Typography>
            <Typography
              sx={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums", fontFamily: JUICE.mono, textShadow: JUICE.neonText }}
            >
              {usd(shownTotal ?? portfolioTotalUsd(data) ?? 0)}
            </Typography>
            {/* THE NUMBER IS A DOOR. All-time P&L is the figure that makes
                a reader ask "from what trades?" — so pressing it opens the
                trade list that answers, instead of leaving the question on
                the screen. The chevron is the affordance; the number stays
                a number. */}
            <Typography
              component="button"
              onClick={() => navigate("/wallet-ui", { state: { tab: "trades" } })}
              className="click-animation"
              sx={{
                fontSize: 17, fontWeight: 700, color: pnlColor,
                fontVariantNumeric: "tabular-nums", fontFamily: JUICE.mono, mt: 0.25,
                background: "none", border: "none", p: 0, cursor: "pointer",
                display: "block", textAlign: "left",
              }}
            >
              {totalPnl === null ? "—" : signedUsd(shownPnl ?? totalPnl)}
              <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: DIM, ml: 0.75 }}>
                on what you hold ›
              </Box>
            </Typography>
            {/* WHAT NO CANDLE CAN TAKE BACK. The all-time figure above
                swings with every tick; this is the part already cashed
                into USDC by sells, and saying both is what makes the swing
                bearable. Hidden when the ledger cannot compute it (null)
                or when it rounds to nothing — a zero here would claim
                "you banked nothing" about rows that predate quantities. */}
            {typeof data.totalRealizedPnlUsd === "number" &&
              Math.abs(data.totalRealizedPnlUsd) >= 0.005 && (
                <Typography
                  sx={{ fontSize: 12, fontWeight: 700, color: data.totalRealizedPnlUsd >= 0 ? GREEN : RED, fontVariantNumeric: "tabular-nums", fontFamily: JUICE.mono, mt: 0.25 }}
                >
                  {signedUsd(data.totalRealizedPnlUsd)}
                  <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: DIM, ml: 0.75 }}>
                    banked
                  </Box>
                </Typography>
              )}
            <Typography sx={{ fontSize: 12, color: DIM, mt: 1 }}>
              Cash&nbsp;
              <Box component="span" sx={{ color: "#FFFFFF", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {usd(data.cashUsd)}
              </Box>
              &nbsp;USDC
            </Typography>
            {committedUsd > 0 && (
              <Typography
                component="button"
                onClick={() => navigate("/wallet-ui")}
                className="click-animation"
                sx={{ fontSize: 12, color: DIM, mt: 0.5, background: "none", border: "none", p: 0, cursor: "pointer", display: "block", textAlign: "left" }}
              >
                <Box component="span" sx={{ color: "#FFFFFF", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  +{usd(committedUsd)}
                </Box>
                &nbsp;in open orders ›
              </Typography>
            )}
          </Box>
          )}

          {/* Standing orders, between the money and the holdings: they ARE
              committed money, waiting. The component renders nothing when the
              reader has none. Cancelling one returns its escrow, so the line
              above is asked again. */}
          {CAP.orderWatch && <OpenOrders onCancelled={() => setOrdersNonce((n) => n + 1)} />}

          {/* THE INVITE DOOR, above the fold and before a trade. Measured
              2026-09-19: zero accounts had ever arrived through a link
              because both chip surfaces open only after a landed trade and
              one account has ever traded. components/InviteRow.tsx. */}
          {CAP.gamification && <InviteRow />}

          {positions.length === 0 && <PopDoors />}

          {/* ── The rows ──────────────────────────────────────────────────── */}
          {positions.map((p) => {
            // The row answers the same question the headline does.
            const rowPnl = p.unrealizedPnlUsd ?? p.pnlUsd
            const rowPnlColor = rowPnl == null ? DIM : rowPnl >= 0 ? GREEN : RED
            return (
              <Box key={p.mint} sx={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  py: 1.5,
                }}
              >
                <Box
                  sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  onClick={() =>
                    // The facts this row already holds ride along, so the
                    // token room opens named and priced instead of on "…".
                    navigate(`/token/${p.mint}`, {
                      state: {
                        seed: {
                          displayName: p.displayName ?? p.ticker,
                          symbol: p.ticker,
                          priceUsd: p.priceUsd,
                        },
                      },
                    })
                  }
                >
                  <Typography
                    sx={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {p.displayName}
                    {filledMints.has(p.mint) && (
                      /* Says WHAT happened, not just that something did:
                         "filled" is the whole news, and the room one tap
                         away carries the rest. Green because a standing
                         order filling is the good ending. */
                      <Box
                        component="span"
                        sx={{
                          ml: 0.75,
                          px: 0.75,
                          py: "1px",
                          borderRadius: "999px",
                          fontSize: 9.5,
                          fontWeight: 800,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: GREEN,
                          backgroundColor: alpha(GREEN, 0.16),
                          verticalAlign: "middle",
                        }}
                      >
                        filled
                      </Box>
                    )}
                    <Box component="span" sx={{ ml: 0.5, fontSize: 11, color: JUICE.text3 }}>›</Box>
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: DIM, fontVariantNumeric: "tabular-nums" }}>
                    {amount(p.uiAmount)} ${p.ticker.replace(/^\$/, "")}
                    {p.change24hPct !== null && (
                      <Box
                        component="span"
                        sx={{ ml: 0.75, color: p.change24hPct >= 0 ? GREEN : RED }}
                      >
                        {p.change24hPct >= 0 ? "+" : ""}
                        {p.change24hPct.toFixed(1)}% 24h
                      </Box>
                    )}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: "right" }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {p.valueUsd === null ? "—" : usd(p.valueUsd)}
                  </Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: rowPnlColor, fontVariantNumeric: "tabular-nums" }}>
                    {/* "+$12.50" answers how much; the percent answers how
                        WELL - the same figure on a $40 bag and a $4,000 bag
                        is two different trades. Basis = value minus the
                        move; only said when it is a real positive number. */}
                    {rowPnl == null
                      ? "—"
                      : (() => {
                          const basis =
                            p.valueUsd !== null && p.valueUsd - rowPnl > 0.005
                              ? p.valueUsd - rowPnl
                              : null
                          const pctTail =
                            basis !== null
                              ? ` · ${rowPnl >= 0 ? "+" : "−"}${Math.abs((rowPnl / basis) * 100).toFixed(Math.abs((rowPnl / basis) * 100) >= 100 ? 0 : 1)}%`
                              : ""
                          return `${signedUsd(rowPnl)}${pctTail}`
                        })()}
                  </Typography>
                  {typeof p.avgEntryPriceUsd === "number" &&
                    p.avgEntryPriceUsd > 0 && (
                      <Typography sx={{ fontSize: 10.5, color: DIM, fontVariantNumeric: "tabular-nums" }}>
                        in @ {priceText(p.avgEntryPriceUsd)}
                      </Typography>
                    )}
                </Box>
              </Box>

              {/* Buy more, or take it off. The card lets you trade a holding
                  from its "me" view; this is the same door, and the sidebar
                  never sends anyone back to the card to finish something. */}
              <Box sx={{ display: "flex", gap: 1, pb: 1.5 }}>
                {(["buy", "sell"] as const).map((side) => {
                  const isOpen = open?.mint === p.mint && open.side === side
                  return (
                    <Box
                      key={side}
                      component="button"
                      onClick={() => setOpen(isOpen ? null : { mint: p.mint, side })}
                      className="click-animation"
                      sx={{
                        flex: 1,
                        border: "none",
                        cursor: "pointer",
                        font: "inherit",
                        fontSize: 12.5,
                        fontWeight: 700,
                        py: "8px",
                        borderRadius: "999px",
                        // Direction colours, the chip's own: buy=green,
                        // sell=red; blue stays the brand's.
                        color: side === "buy" ? JUICE.onBuyFill : "#FFFFFF",
                        background: side === "buy" ? JUICE_BUY_FILL : RED,
                        opacity: open && !isOpen ? 0.5 : 1,
                        transition: "opacity .15s ease-out",
                      }}
                    >
                      {side === "buy" ? "Buy more" : "Sell"}
                    </Box>
                  )
                })}
                {/* FLEX ↗ — a shareable PnL card, shown only when there IS
                    something honest to flex (an unrealized gain/loss with a
                    real basis, or a closed position's realized result). */}
                {flexParts({
                  ticker: p.ticker,
                  uiAmount: p.uiAmount,
                  priceUsd: p.priceUsd,
                  avgEntryPriceUsd: p.avgEntryPriceUsd,
                  realizedPnlUsd: p.realizedPnlUsd,
                  callerSourceUrl: p.callerSourceUrl,
                }) && (
                  <Box
                    component="button"
                    disabled={flexing === p.mint}
                    onClick={() => void flexPosition(p)}
                    className="click-animation"
                    sx={{
                      flexShrink: 0,
                      border: `1px solid ${alpha("#FFFFFF", 0.16)}`,
                      cursor: flexing === p.mint ? "default" : "pointer",
                      font: "inherit",
                      fontSize: 12.5,
                      fontWeight: 700,
                      px: 1.5,
                      py: "8px",
                      borderRadius: "999px",
                      color: "#FFFFFF",
                      background: "none",
                      opacity: flexing === p.mint ? 0.5 : 1,
                    }}
                  >
                    {flexing === p.mint
                      ? "…"
                      : flexNote?.mint === p.mint
                        ? flexNote.text
                        : "Flex ↗"}
                  </Box>
                )}
              </Box>

              {open?.mint === p.mint && (
                <Box className="panel-sheet-in" sx={{ pb: 1.5 }}>
                  <TradeSheet
                    asset={{
                      mint: p.mint,
                      symbol: p.ticker,
                      displayName: p.displayName,
                      decimals: p.decimals,
                      priceUsd: p.priceUsd,
                    }}
                    mode={open.side}
                    onModeChange={(m) => setOpen({ mint: p.mint, side: m })}
                    onTraded={() => refresh()}
                  />
                </Box>
              )}
              </Box>
            )
          })}

          {positions.some((p) => p.pnlUsd === null) && (
            <Typography sx={{ fontSize: 11, color: JUICE.text3, mt: 1.5 }}>
              — means the position predates trade tracking; its profit can&apos;t
              be computed honestly, so it isn&apos;t.
            </Typography>
          )}
        </>
      )}
    </Box>
  )


}
