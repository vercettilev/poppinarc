import { JUICE } from "~/theme/juice"
import { Box, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { assetByMint } from "~/services/SpotAssetService"
import type { MatchedAsset, PageCandidate } from "~/services/SpotAssetService"
import { formatCompactNumber } from "~/utils/numberUtils"
import { FillCelebration } from "~/components/FillCelebration"
import { OpenOrders } from "~/components/OpenOrders"
import { TradeSheet } from "~/components/TradeSheet"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"
import {
  isWatched,
  toggleWatch,
  WATCHLIST_KEY,
  type WatchedAsset,
} from "~/helpers/watchlist"
import { ACCENT, GREEN, PANEL_CARD, RED } from "~/helpers/panelSurface"
import { CAP } from "~/config/edition"

/**
 * The page's most relevant tradeable asset, at the top of its ONE feed.
 *
 * ── WHY THIS SITS ABOVE THE FEED ────────────────────────────────────────────
 * The panel used to split into Posts and Trades tabs, and the split was
 * fragmentation, not structure: the feed already carried the trade receipts
 * (on_chain posts), so the Trades tab re-served data the reader was already
 * looking at, one tap away. The owner's call — one feed per page, the money
 * question answered once at the top — is also the CARD's own architecture:
 * market first, conversation under it. This strip is the panel agreeing with
 * the card.
 *
 * ── THE BUTTONS TRADE HERE ──────────────────────────────────────────────────
 * Buy and Sell open TradeSheet in place. The sidebar is the app: it never
 * sends a reader to the page card to finish something it started.
 *
 * ── WHY IT HOLDS ITS SPACE BEFORE IT HAS AN ANSWER ──────────────────────────
 * Reported as "the card and the logo load slower than the feed, it isn't
 * smooth" — and it was not a speed problem, it was a LAYOUT one. The feed is
 * one request; this card is three (page candidates through the content
 * script, then by-mint, then the logo's own image), so the feed painted
 * first and the card shoved it down on arrival.
 *
 * So the strip now says which of three things it is. Asking (undefined) → a
 * skeleton of the card's exact shape, and the feed starts where it will
 * stay. No asset (null) → nothing at all, collapsed. An answer → drawn into
 * the space already held. The sparkline's slot stays reserved until by-mint
 * answers for the same reason, and the logo fades over its initial instead
 * of popping in.
 *
 * Two module caches make the second visit instant: the panel remounts on
 * every tab switch, and re-asking a question already answered is the other
 * half of what "not smooth" felt like.
 */

/** Bounded: this is a smoothness cache, not a store. */
function remember<V>(m: Map<string, V>, k: string, v: V) {
  if (m.size > 40) m.delete(m.keys().next().value as string)
  m.set(k, v)
}
const PICK_BY_URL = new Map<string, PageCandidate | null>()
const RICH_BY_MINT = new Map<string, MatchedAsset | null>()


export function PageAssetStrip({ currentUrl }: { currentUrl: string | null }) {
  /** undefined = still asking · null = this page has no tradeable asset. */
  const [pick, setPick] = useState<PageCandidate | null | undefined>(() =>
    currentUrl ? PICK_BY_URL.get(currentUrl) : null,
  )
  /** Which side's sheet is open, if any. The buttons TOGGLE the sheet in
   *  place — the sidebar is the app now, and it never redirects to the page
   *  card. (The card may point here occasionally; never the reverse.) */
  const [sheetMode, setSheetMode] = useState<"buy" | "sell" | null>(null)
  /** The dollars a launch arrives with (a deposit toast returning the reader to their Buy). */
  const [sheetUsd, setSheetUsd] = useState<number | null>(null)
  /**
   * The watchlist, read once and written straight through. Local storage
   * rather than the server for the same reason price alerts are: it is the
   * reader's own shortlist on this device, it has to answer instantly for a
   * star to feel like a star, and nothing else needs to know.
   */
  const [watch, setWatch] = useState<WatchedAsset[]>([])
  /** Bumped when an order is placed here, so the list below re-reads. */
  const [ordersKey, setOrdersKey] = useState(0)
  useEffect(() => {
    let alive = true
    void chrome.storage?.local
      ?.get(WATCHLIST_KEY)
      .then((s) => {
        if (alive) setWatch(s?.[WATCHLIST_KEY] ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  /**
   * Watched, not read once: a deep link arrives before this component
   * exists, but a copy-trade tap happens with the strip already on screen,
   * a row below. The counter changes on every hand-off, so the second one
   * lands as reliably as the first.
   */
  const launchSeq = useLaunchAssetStore((s) => s.launchSeq)

  useEffect(() => {
    let alive = true
    setSheetMode(null)

    /**
     * A MINT HANDED TO US OUTRANKS ASKING THE PAGE.
     *
     * The X chip resolves the asset on device and opens this panel with it.
     * Asking the page instead would throw that away and get nothing back:
     * measured, x.com/home matches no asset, because the home feed is not
     * about one. Consumed once (see the store) so the page reclaims the
     * answer as soon as it has one of its own.
     */
    const launched = useLaunchAssetStore.getState().takeLaunchMint()
    if (launched) {
      setPick(undefined)
      assetByMint(launched.mint)
        .then((r) => {
          if (!alive) return
          const a = r.asset
          // A tap that already said "buy" should not have to say it twice.
          if (a && launched.side) setSheetMode(launched.side)
          setSheetUsd(a && launched.usd ? launched.usd : null)
          setPick(
            a
              ? ({
                  mint: a.mint,
                  symbol: a.symbol,
                  displayName: a.displayName,
                  decimals: a.decimals,
                  priceUsd: a.indicativeUsd,
                  change24hPct: a.change24hPct,
                  isPagePick: true,
                } as PageCandidate)
              : null,
          )
        })
        .catch(() => alive && setPick(null))
      return () => {
        alive = false
      }
    }

    const cached = currentUrl ? PICK_BY_URL.get(currentUrl) : null
    // A known page keeps its answer on screen; an unknown one holds the
    // skeleton's space rather than collapsing and re-expanding.
    setPick(cached !== undefined ? cached : undefined)
    if (cached !== undefined) return

    /**
     * Bounded retry, and the skeleton holds the top slot the whole time.
     *
     * One shot was not enough: on a fresh page load the content script boots
     * BEHIND the panel, so the first ask answers "no_content_script", and
     * settling on null there collapsed the strip for good — the feed (one
     * direct API call, no content script involved) painted first, and the
     * money question showed up under it or not at all. Reported as "refresh
     * edince ilk feed'de postlar çıkıyor". The feed is not made to wait;
     * the skeleton simply owns the first slot until the page can answer.
     *
     * Only two reasons are definitive: "ok" (the backend really answered)
     * and "not_a_web_page" (there is nothing to ask). Everything else means
     * "cannot know yet" and earns another attempt.
     */
    const ASK_TRIES = 6
    const GAP_MS = 900
    const ask = (attempt: number) => {
      if (!alive) return
      try {
        chrome.runtime.sendMessage({ type: "GET_PAGE_CANDIDATES" }, (res) => {
          void chrome.runtime.lastError
          if (!alive) return
          if (res?.reason === "ok") {
            const rows: PageCandidate[] = res.candidates ?? []
            // The card's own pick when it made one; the top of the ranking
            // otherwise. One asset, singular, by design — the ranked
            // longlist was the Trades tab's idea of an answer.
            const next = rows.find((r) => r.isPagePick) ?? rows[0] ?? null
            setPick(next)
            if (currentUrl) remember(PICK_BY_URL, currentUrl, next)
            return
          }
          if (res?.reason === "not_a_web_page") {
            setPick(null)
            return
          }
          if (attempt < ASK_TRIES) {
            setTimeout(() => ask(attempt + 1), GAP_MS)
          } else {
            // The page never became askable. Collapse rather than hold a
            // skeleton forever over a PDF viewer or an error page.
            setPick(null)
          }
        })
      } catch {
        // No extension messaging at all on this surface.
        setPick(null)
      }
    }
    ask(1)
    return () => {
      alive = false
    }
  }, [currentUrl, launchSeq])

  /**
   * The rich half — logo, market cap, the 24h sparkline. Candidates carry
   * only the row basics; /embed/asset/by-mint answers with everything the
   * page card itself is drawn from, so this card and that card can never
   * disagree about the same asset. Failure leaves `rich` null and the card
   * renders its basic form — the enrichment is garnish, not structure.
   */
  const [rich, setRich] = useState<MatchedAsset | null | undefined>(undefined)
  /** Whether the logo image itself has decoded — see the head row. */
  const [iconOn, setIconOn] = useState(false)

  /**
   * A PRICE THAT MOVES WHILE THE SHEET IS OPEN.
   *
   * The chip and the card ride a live tick stream; the panel has no such
   * channel and its price came from one fetch at mount. That is fine for a
   * strip somebody glances at and wrong for a sheet somebody composes a
   * LIMIT ORDER in: they type a target, the sheet tells them it is 10% below
   * the market, and the market has since moved. The reading was true once.
   *
   * A poll, not a stream, because a stream into this context is a new message
   * channel and this is a stale number — and it runs ONLY while the sheet is
   * open, so a panel sitting in the background costs nothing.
   */
  useEffect(() => {
    const mint = pick?.mint
    if (!sheetMode || !mint) return
    let alive = true
    const tick = () => {
      assetByMint(mint)
        .then((r) => {
          if (!alive || !r.asset) return
          remember(RICH_BY_MINT, mint, r.asset)
          setRich(r.asset)
        })
        .catch(() => {})
    }
    const id = setInterval(tick, 15_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sheetMode, pick?.mint])
  useEffect(() => {
    let alive = true
    const mint = pick?.mint
    setIconOn(false)
    if (!mint) {
      setRich(null)
      return
    }
    const cached = RICH_BY_MINT.get(mint)
    setRich(cached !== undefined ? cached : undefined)
    if (cached !== undefined) return
    assetByMint(mint)
      .then((r) => {
        remember(RICH_BY_MINT, mint, r.asset ?? null)
        if (alive) setRich(r.asset ?? null)
      })
      .catch(() => alive && setRich(null))
    return () => {
      alive = false
    }
  }, [pick?.mint])

  if (pick === undefined) return <StripSkeleton />
  if (!pick) return null

  const change = rich?.change24hPct ?? pick.change24hPct
  const up = (change ?? 0) >= 0
  const price = rich?.indicativeUsd ?? pick.priceUsd
  const spark = rich?.spark24h ?? null

  /**
   * The sparkline, as one polyline. The page card draws the same 24 closes
   * with an area fill and a now-dot; here the line alone carries the shape —
   * this is the card's echo in the panel, not its rival.
   */
  const sparkPoints = (() => {
    if (!spark || spark.length < 2) return null
    const min = Math.min(...spark)
    const max = Math.max(...spark)
    const range = max - min || 1
    return spark
      .map((v, idx) => {
        const x = (idx / (spark.length - 1)) * 100
        const y = 26 - ((v - min) / range) * 22 - 2
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(" ")
  })()

  return (
    <Box
      sx={{
        mx: 2,
        mb: 1.5,
        // One step above the ground with the accent whispering in the
        // hairline — the panel's block treatment, shared, not a new one.
        ...PANEL_CARD,
      }}
    >
      {/* A fill on THIS asset greets the reader before anything else — the
          delivery behind the OS notification's doorbell, and it shows up
          however they got here. */}
      <FillCelebration mint={pick.mint} />

      {/* Identity left, market right — the page card's collapsed head, in
          the panel's hand. The price is the biggest number on purpose. */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25 }}>
        {/* The initial is there from the first frame; the logo arrives a
            request later and fades over it. A background-image swap has no
            load event, so a logo that 404s used to leave an empty circle —
            here it simply never fades in and the initial stays. */}
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            flexShrink: 0,
            position: "relative",
            overflow: "hidden",
            backgroundColor: "rgba(104,198,255,.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "#9FD9FF",
          }}
        >
          <Box
            component="span"
            sx={{ opacity: iconOn ? 0 : 1, transition: "opacity .2s ease-out" }}
          >
            {pick.displayName.charAt(0).toUpperCase()}
          </Box>
          {rich?.icon && (
            <Box
              component="img"
              src={rich.icon}
              alt=""
              onLoad={() => setIconOn(true)}
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: iconOn ? 1 : 0,
                transition: "opacity .22s ease-out",
              }}
            />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pick.displayName}
          </Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: JUICE.text3 }}>
            ${pick.symbol.replace(/^\$/, "")}
            {rich?.mcap != null && (
              <Box component="span" sx={{ ml: 0.75 }}>
                · MC ${formatCompactNumber(rich.mcap)}
              </Box>
            )}
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right", flexShrink: 0 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
            {price === null
              ? "—"
              : price.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: price < 1 ? 6 : 2,
                })}
          </Typography>
          {change !== null && (
            <Typography
              sx={{
                display: "inline-block",
                fontSize: 11,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                color: up ? GREEN : RED,
                backgroundColor: up ? "rgba(48,209,88,.12)" : "rgba(255,69,58,.12)",
                borderRadius: "999px",
                px: 0.75,
                py: "1px",
                mt: "2px",
              }}
            >
              {up ? "+" : ""}
              {change.toFixed(1)}%
            </Typography>
          )}
        </Box>
      </Box>

      {/* The day's shape. Green up, red down — the same one-glance verdict
          the page card gives, and absent when the data is. */}
      {(sparkPoints || rich === undefined) && (
        <Box sx={{ height: 30, mt: 1 }}>
        {sparkPoints && (
        <Box component="svg" viewBox="0 0 100 26" preserveAspectRatio="none" sx={{ display: "block", width: "100%", height: 30 }}>
          <polyline
            points={sparkPoints}
            fill="none"
            stroke={up ? GREEN : RED}
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </Box>
        )}
        </Box>
      )}

      {/* THE STAR. Sits with the actions rather than in the head row: it is
          something the reader DOES, and the head row is what the asset IS.
          Deliberately quiet — it competes with nothing, and it is the only
          control here that does not move money. */}
      <Box sx={{ display: "flex", gap: 1, mt: 1.25, alignItems: "stretch" }}>
        <Box
          component="button"
          aria-label={
            isWatched(watch, pick.mint) ? "Remove from watchlist" : "Add to watchlist"
          }
          aria-pressed={isWatched(watch, pick.mint)}
          onClick={() => {
            const next = toggleWatch(
              watch,
              { mint: pick.mint, symbol: pick.symbol ?? null },
              Date.now(),
            )
            setWatch(next)
            void chrome.storage?.local?.set({ [WATCHLIST_KEY]: next })
          }}
          className="click-animation"
          sx={{
            width: 40,
            display: "grid",
            placeItems: "center",
            border: "1px solid",
            borderColor: isWatched(watch, pick.mint)
              ? "rgba(104,198,255,.55)"
              : JUICE.border,
            backgroundColor: isWatched(watch, pick.mint)
              ? "rgba(104,198,255,.16)"
              : JUICE.well,
            color: isWatched(watch, pick.mint) ? ACCENT : JUICE.text2,
            borderRadius: "999px",
            cursor: "pointer",
            font: "inherit",
            p: 0,
            transition: "background-color .15s ease-out, color .15s ease-out",
          }}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path
              d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.87l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85L12 3.6z"
              fill={isWatched(watch, pick.mint) ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </Box>
        {(["buy", "sell"] as const).map((side) => (
          <Box
            key={side}
            component="button"
            onClick={() => setSheetMode(sheetMode === side ? null : side)}
            className="click-animation"
            sx={{
              flex: 1,
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: ".01em",
              py: "10px",
              borderRadius: "999px",
              color: side === "buy" ? JUICE.onAccent : "#FFFFFF",
              backgroundColor: side === "buy" ? JUICE.accent : RED,
              boxShadow:
                side === "buy" ? "0 8px 26px -8px rgba(104,198,255,.55)" : "none",
              opacity: sheetMode && sheetMode !== side ? 0.55 : 1,
              transition: "background-color .15s ease-out, opacity .15s ease-out",
              "&:hover": {
                backgroundColor: side === "buy" ? "#86D2FF" : "#FF6961",
              },
            }}
          >
            {side === "buy" ? `Buy ${pick.symbol.replace(/^\$/, "")}` : `Sell ${pick.symbol.replace(/^\$/, "")}`}
          </Box>
        ))}
      </Box>

      {/* The trade itself, in place. The sheet is the page card's TradePanel
          in the panel's hand — same endpoints, same honesty rules. */}
      {sheetMode && (
        <TradeSheet
          asset={{
            mint: pick.mint,
            symbol: pick.symbol,
            displayName: pick.displayName,
            decimals: rich?.decimals ?? pick.decimals,
            priceUsd: rich?.indicativeUsd ?? pick.priceUsd,
          }}
          mode={sheetMode}
          initialUsd={sheetUsd ?? undefined}
          onModeChange={(m) => setSheetMode(m)}
          onOrderPlaced={() => setOrdersKey((k) => k + 1)}
        />
      )}

      {/* THIS ASSET'S STANDING ORDERS, on the screen where they are placed.
          They were listed on the profile and in the positions view, which is
          two navigations away from the sheet somebody just used — an order
          that vanishes the moment it is placed reads as one that failed.
          Scoped to this mint: the whole book belongs on the profile, and
          repeating it here would bury the asset the reader is looking at. */}
      {CAP.orderWatch && <OpenOrders mint={pick.mint} reloadKey={ordersKey} />}
    </Box>
  )
}

/**
 * The card's shape while the answer is in flight.
 *
 * Built from the SAME elements as the card above — the same Typography line
 * boxes, the same 34px circle, the same buttons — rather than hand-measured
 * heights, because a skeleton that guesses wrong swaps one jump for another.
 * Deliberately quiet: this is space being held, not content pretending to
 * load.
 */
const BLOCK = { backgroundColor: "rgba(255,255,255,.07)", borderRadius: "6px" }

function StripSkeleton() {
  return (
    <Box
      aria-hidden
      sx={{
        mx: 2,
        mb: 1.5,
        ...PANEL_CARD,
        animation: "poppinStripBreathe 1.6s ease-in-out infinite",
        "@keyframes poppinStripBreathe": {
          "0%, 100%": { opacity: 0.5 },
          "50%": { opacity: 0.85 },
        },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25 }}>
        <Box sx={{ width: 34, height: 34, flexShrink: 0, ...BLOCK, borderRadius: "50%" }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, lineHeight: 1.2, width: "58%", color: "transparent", ...BLOCK }}>
            &nbsp;
          </Typography>
          <Typography sx={{ fontSize: 11, width: "34%", color: "transparent", ...BLOCK, mt: "3px" }}>
            &nbsp;
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right", flexShrink: 0 }}>
          <Typography sx={{ fontSize: 17, lineHeight: 1.2, width: 68, color: "transparent", ...BLOCK }}>
            &nbsp;
          </Typography>
          <Typography
            sx={{ display: "inline-block", fontSize: 11, px: 0.75, py: "1px", width: 34, mt: "2px", color: "transparent", ...BLOCK, borderRadius: "999px" }}
          >
            &nbsp;
          </Typography>
        </Box>
      </Box>
      <Box sx={{ height: 30, mt: 1, ...BLOCK }} />
      <Box sx={{ display: "flex", gap: 1, mt: 1.25 }}>
        {[0, 1].map((i) => (
          <Box
            key={i}
            component="button"
            disabled
            sx={{ flex: 1, border: "none", font: "inherit", fontSize: 14, fontWeight: 700, py: "10px", color: "transparent", ...BLOCK, borderRadius: "999px" }}
          >
            &nbsp;
          </Box>
        ))}
      </Box>
    </Box>
  )
}
