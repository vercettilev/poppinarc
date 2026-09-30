import { remoteTradable } from "~/arc/remoteTrade"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import { alpha, Box, Typography } from "@mui/material"
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams, useLocation } from "react-router"
import { RoutePreview } from "~/arc/RoutePreview"
import { TradeSheet } from "~/components/TradeSheet"
import { OpenOrders } from "~/components/OpenOrders"
import { PriceAlerts } from "~/components/PriceAlerts"
import { FillCelebration } from "~/components/FillCelebration"
import { ChartFullscreen } from "~/components/ChartFullscreen"
import { when } from "~/components/TradeHistory"
import { drawLineFromLeft } from "~/helpers/lineDraw"
import {
  COPY_FROM_KEY,
  LAST_TRADE_USD_KEY,
  copyAmountUsd,
  copyFromLine,
  readCopyFrom,
  type CopyFrom,
} from "~/helpers/copyFrom"
import {
  SPARK_RANGES,
  sparkGeometry,
  priceToY,
  timeLabel,
  timeToX,
  type SparkRange,
} from "~/helpers/chartMath"
import { ACCENT, DIM, GREEN, PANEL_CARD, PANEL_PILL, RED, usd } from "~/helpers/panelSurface"
import { priceText } from "~/helpers/priceText"
import { compactMoney } from "~/helpers/safetyLine"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"
import { JUICE, JUICE_BUY_FILL } from "~/theme/juice"
import {
  assetByMint,
  myTradesAsset,
  positionsAsset,
  quoteAsset,
  seriesAsset,
  type MatchedAsset,
  type MyTradeRow,
  type SeriesAnswer,
  type SpotPosition,
} from "~/services/SpotAssetService"

/**
 * ONE TOKEN'S OWN ROOM — /token/:mint.
 *
 * Every asset the panel knew was met sideways: a row in Positions, a strip
 * above a feed, a receipt in history — each carrying two or three of the
 * facts and a door to none of the rest. This is the room where they all
 * are: the header (price, 24h, MC, the gate's safety line), the chart with
 * the reader's own fills ON it, the trade sheet, the position if held, and
 * the reader's trades on this mint.
 *
 * REFUSES what by-mint refuses. The endpoint answers null for any mint §7
 * will not admit, and that verdict is time-varying — so an address that
 * cannot be described says so and offers nothing, exactly like the chip.
 *
 * The chart is the CHIP'S chart re-said in React: same series endpoint,
 * same geometry helpers (sparkGeometry/priceToY/timeToX), same honesty
 * about the two kinds of nothing. Deliberately line-only — candles live on
 * the chip today; parity is its own roadmap item.
 */

const W = 320
const H = 96

/** The size the header's price impact is quoted for, and the size it says
 *  out loud. Near a real buy on this surface. */
const IMPACT_PROBE_USD = 100

export default function TokenView() {
  const { mint = "" } = useParams()
  /** On another chain, reached from Arc over CCTP (arc/RoutePreview.tsx). */
  const isRemote = mint.startsWith("remote:")
  /** On Base or Arbitrum it can be bought and sold from here (arc/remoteTrade.ts). */
  const remoteLive = isRemote && remoteTradable(mint)
  const navigate = useNavigate()
  const routed = useLocation()
  /**
   * THE DOOR ALREADY KNEW. Every way into this room - a position row, a
   * Discover row - held the name and the price and threw them away at the
   * threshold, so the room opened on "…" and an empty body while
   * assetByMint answered. The seed paints the header instantly; the live
   * read replaces it. Display only, same rule as the book cache, and a
   * seed never touches the gate's refusal path.
   */
  const seed = (routed.state as { seed?: { displayName?: string; symbol?: string; priceUsd?: number | null } } | null)?.seed
  const [asset, setAsset] = useState<MatchedAsset | null | undefined>(undefined)
  const [range, setRange] = useState<SparkRange>("1d")
  const [series, setSeries] = useState<SeriesAnswer | null>(null)
  const [mine, setMine] = useState<MyTradeRow[]>([])
  const [held, setHeld] = useState<SpotPosition | null>(null)
  const [sheetMode, setSheetMode] = useState<"buy" | "sell" | null>(null)
  /** The dollars a launch arrived with (a deposit returning the reader to their Buy). */
  const [sheetUsd, setSheetUsd] = useState<number | null>(null)
  /** Set when a followed trade's notification is what opened this room. */
  const [copyFrom, setCopyFrom] = useState<CopyFrom | null>(null)
  const [chartOpen, setChartOpen] = useState(false)
  /** Named by the gate's refusal — see assetByMint. Null when even the
   *  name was unreadable, which is the only honest "unknown". */
  const [refused, setRefused] = useState<{ symbol: string; name: string } | null>(null)
  const askedRef = useRef<string | null>(null)

  /** The reader's own artifacts on this mint, re-readable: the mount effect
   *  uses it once, and a settled trade in the inline sheet uses it again -
   *  the one moment the holding card and YOUR TRADES are guaranteed stale. */
  const refreshMine = useCallback(() => {
    if (!mint) return
    myTradesAsset(mint)
      .then((r) => setMine(Array.isArray(r?.trades) ? r.trades : []))
      .catch(() => undefined)
    positionsAsset()
      .then((r) => setHeld(r?.positions.find((p) => p.mint === mint) ?? null))
      .catch(() => undefined)
  }, [mint])

  useEffect(() => {
    if (!mint || askedRef.current === mint) return
    askedRef.current = mint
    // A door elsewhere (the copy-trade receipt) may have handed a side
    // along with the mint; honor it so the sheet is already open when the
    // reader arrives. take() is one-shot, so a plain visit stays quiet.
    /* WHY THE READER IS STANDING HERE. A followed trade's notification
       named a person and a size, and the tap used to land on a bare Buy
       sheet (helpers/copyFrom.ts). The line above the sheet says it again,
       and the sheet opens on what THIS reader last spent rather than on
       the other person's size. */
    void chrome.storage.local
      .get([COPY_FROM_KEY, LAST_TRADE_USD_KEY])
      .then((stored) => {
        const from = readCopyFrom(stored?.[COPY_FROM_KEY], mint)
        if (!from) return
        setCopyFrom(from)
        setSheetMode((m) => m ?? from.side)
        setSheetUsd((u) => u ?? (from.side === "buy" ? copyAmountUsd(stored?.[LAST_TRADE_USD_KEY]) : null))
      })
      .catch(() => {
        // No extension context, or nothing stored: the room is still a room.
      })
    const launched = useLaunchAssetStore.getState().takeLaunchMint()
    if (launched && launched.mint === mint && launched.side) {
      // ONLY when a side rode along. The store's contract (and the
      // copy-trade caller's comment) is that an absent side means "open
      // the asset and nothing else" — a copied SELL of a token the
      // reader probably does not hold must not arrive as an open BUY.
      setSheetMode(launched.side)
      setSheetUsd(launched.usd ?? null)
    }
    let alive = true
    assetByMint(mint)
      .then((r) => {
        if (!alive) return
        setAsset(r.asset ?? null)
        // Kept even when the asset is null: a refusal that can name what
        // it refused is a different sentence from "unknown".
        setRefused(r.refused ?? null)
      })
      .catch(() => alive && setAsset(null))
    myTradesAsset(mint)
      .then((r) => alive && setMine(Array.isArray(r?.trades) ? r.trades : []))
      .catch(() => undefined)
    positionsAsset()
      .then((r) => {
        if (!alive) return
        setHeld(r?.positions.find((p) => p.mint === mint) ?? null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mint])

  /**
   * THE LINE STAYS WHILE THE NEXT RANGE LOADS.
   *
   * Every range tap used to null the series, which replaced the chart with
   * a one-line "Loading…" - the card shrank by about sixty pixels, the
   * range pills jumped up under the finger that had just pressed one, and
   * the whole thing grew back a moment later. Comparing 1H against 1D is
   * the entire reason those pills exist, and the old line vanishing is
   * exactly what makes comparing impossible.
   *
   * So the old line is held and dimmed instead, and only a MINT change
   * clears it - a different asset's chart is not a slower version of this
   * one. Same rule the card's chart already follows.
   */
  const seriesMintRef = useRef<string | null>(null)
  const [loadingRange, setLoadingRange] = useState(false)
  useEffect(() => {
    if (!mint) return
    let alive = true
    if (seriesMintRef.current !== mint) {
      seriesMintRef.current = mint
      setSeries(null)
    }
    setLoadingRange(true)
    seriesAsset(mint, range)
      .then((r) => alive && setSeries(r))
      .catch(() =>
        alive &&
        setSeries({ points: null, times: null, opens: null, highs: null, lows: null, failed: true }),
      )
      .finally(() => alive && setLoadingRange(false))
    return () => {
      alive = false
    }
  }, [mint, range])

  const g = sparkGeometry(series?.points, W, H)

  /**
   * THE LINE DRAWS ITSELF, the same movement the chip and the full screen
   * make (helpers/lineDraw.ts). The ceremony is spent on the room OPENING —
   * the first series for this mint — and every later answer is a range the
   * reader asked to compare, which gets the everyday weight instead. A
   * comparison gesture cannot afford a ceremony per tap.
   */
  const lineRef = useRef<SVGPolylineElement | null>(null)
  const drawnMint = useRef<string | null>(null)
  useEffect(() => {
    if (!g.points) return
    const opening = drawnMint.current !== asset?.mint
    drawnMint.current = asset?.mint ?? null
    drawLineFromLeft(
      lineRef.current,
      opening ? JUICE.cinemaMs : JUICE.motionMs,
      JUICE.drawEase,
    )
  }, [g.points, asset?.mint])
  const pts = (series?.points ?? []).filter((v) => Number.isFinite(v))
  const times =
    series?.times && series.times.length === pts.length ? series.times : null
  const lineColor = g.up ? GREEN : RED
  /**
   * PRICE IMPACT, ON A SIZE THAT IS SAID OUT LOUD.
   *
   * The header carried "mint open · can freeze" here. Those two facts are
   * not gone (see the grid below), but they are not what a reader opening
   * a token's room is asking first. On a memecoin the question is how much
   * the pool moves when you push it, and liquidity alone does not answer
   * that: the same $1.1M behaves very differently on a tight pool and a
   * lopsided one.
   *
   * Impact needs a SIZE, so one is chosen and NAMED. An unlabelled
   * percentage is meaningless, and quietly quoting $10 to make a pool look
   * deep would be the kind of flattery this surface does not do. $100 is
   * near a real buy here and small enough that a healthy pool reads clean.
   */
  const [impactPct, setImpactPct] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    if (!mint || !asset) return
    let alive = true
    setImpactPct(undefined)
    void quoteAsset(mint, IMPACT_PROBE_USD)
      .then((q) => {
        if (!alive) return
        const pct = q?.priceImpactPct
        setImpactPct(typeof pct === "number" && Number.isFinite(pct) ? pct : null)
      })
      .catch(() => alive && setImpactPct(null))
    return () => {
      alive = false
    }
  }, [mint, asset])

  return (
    <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: "auto", boxSizing: "border-box" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2 }}>
        <Box
          component="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          aria-label="Back"
          className="click-animation"
          sx={{
            ...PANEL_PILL, width: 32, height: 32, display: "grid", placeItems: "center",
            cursor: "pointer", color: "#FFFFFF", p: 0, flexShrink: 0,
            "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
        </Box>
        <Typography sx={{ fontSize: 19, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {asset === undefined
            ? (seed?.displayName ?? seed?.symbol ?? "…")
            : asset === null
              ? (refused?.name ?? "Unknown token")
              : asset.displayName}
        </Typography>
      </Box>

      {asset === null && (
        <Typography sx={{ fontSize: 13, color: DIM }}>
          {refused
            ? `$${refused.symbol} isn't tradeable here right now.`
            : "This address isn't tradeable here right now."}{" "}
          The trade gate re-checks liquidity and safety live, so a token can
          pass later.
          {refused && (
            <>
              {" "}
              A row in the feed can offer it for up to five minutes after
              the gate changes its mind, which is how you got here.
            </>
          )}
        </Typography>
      )}

      {asset && (
        <>
          {/* ── the header: what it is, what it costs, what the gate saw ── */}
          <Box sx={{ ...PANEL_CARD, p: 2, mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
              {asset.icon && (
                <Box
                  component="img"
                  src={asset.icon}
                  alt=""
                  sx={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0 }}
                />
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
                  ${asset.symbol.replace(/^\$/, "")}
                  {asset.change24hPct !== null && (
                    <Box component="span" sx={{ ml: 1, fontSize: 12.5, fontWeight: 700, color: asset.change24hPct >= 0 ? GREEN : RED }}>
                      {asset.change24hPct >= 0 ? "+" : ""}
                      {asset.change24hPct.toFixed(1)}% 24h
                    </Box>
                  )}
                </Typography>
                <Typography sx={{ fontSize: 12, color: DIM, fontVariantNumeric: "tabular-nums" }}>
                  {asset.indicativeUsd !== null ? priceText(asset.indicativeUsd) : "—"}
                  {typeof asset.mcap === "number" && asset.mcap > 0 && ` · MC ${compactMoney(asset.mcap)}`}
                </Typography>
              </Box>
            </Box>
            {typeof impactPct === "number" && (
              <Typography
                sx={{
                  fontSize: 11,
                  // Orange only when it would actually cost the reader
                  // something. Below 1% this is a fact, not a warning, and
                  // colouring every fact is how a surface stops being read.
                  color: impactPct >= 1 ? "#FFB020" : JUICE.text3,
                  mt: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {`~${impactPct < 0.01 ? "<0.01" : impactPct.toFixed(2)}% price impact on $${IMPACT_PROBE_USD}`}
              </Typography>
            )}
          </Box>

          {/* ── the chart, with the reader's own story on it ── */}
          <Box sx={{ ...PANEL_CARD, p: 1.5, mb: 2 }}>
            <Box sx={{ display: "flex", gap: 0.5, mb: 1, flexWrap: "wrap" }}>
              {SPARK_RANGES.map((r) => (
                <Box
                  key={r}
                  component="button"
                  onClick={() => setRange(r)}
                  className="click-animation"
                  sx={{
                    ...PANEL_PILL, px: 1, py: "3px", cursor: "pointer", font: "inherit",
                    fontSize: 10.5, fontWeight: 700, color: r === range ? JUICE.onAccent : DIM,
                    backgroundColor: r === range ? ACCENT : "rgba(255,255,255,.06)",
                  }}
                >
                  {r.toUpperCase()}
                </Box>
              ))}
            </Box>
            {series === null && (
              /* Only on a cold open now, so the height it reserves matches
                 the chart it is standing in for. */
              <Box sx={{ height: H, display: "grid", placeItems: "center" }}>
                <Typography sx={{ fontSize: 12, color: DIM }}>Loading…</Typography>
              </Box>
            )}
            {series !== null && !g.points && (
              <Typography sx={{ fontSize: 12, color: DIM, py: 4, textAlign: "center" }}>
                {series.failed ? "Chart did not load." : "No chart for this range"}
              </Typography>
            )}
            {series !== null && g.points && (
              <>
                <Box
                  component="button"
                  onClick={() => setChartOpen(true)}
                  aria-label="Open full chart"
                  sx={{
                    position: "relative",
                    display: "block",
                    width: "100%",
                    p: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    // Dimmed, not gone: the shape you were reading is still
                    // the shape, it is simply not the answer yet.
                    opacity: loadingRange ? 0.45 : 1,
                    transition: "opacity 140ms ease-out",
                  }}
                >
                  {/* The way IN. The chart was a thumbnail you could watch
                      but never lean into; the corner glyph says it opens,
                      and the whole plot is the target. */}
                  <Box
                    aria-hidden="true"
                    sx={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      zIndex: 1,
                      width: 22,
                      height: 22,
                      borderRadius: "7px",
                      display: "grid",
                      placeItems: "center",
                      color: "rgba(255,255,255,.6)",
                      background: "rgba(0,0,0,.28)",
                      fontSize: 12,
                    }}
                  >
                    ⤢
                  </Box>
                  <Box component="svg" viewBox={`0 0 ${W} ${H}`} sx={{ width: "100%", display: "block" }}>
                    <polyline
                      ref={lineRef}
                      points={g.points}
                      fill="none"
                      stroke={lineColor}
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      style={{ filter: `drop-shadow(0 0 4px ${lineColor}55)` }}
                    />
                    {/* The reader's fills, at the price they actually
                        filled when the ledger knows it — the same truth
                        the chip's marks now tell. */}
                    {times &&
                      mine.map((t, i) => {
                        const x = timeToX(t.ts, times[0], times[times.length - 1], W)
                        if (x === null) return null
                        const filled =
                          typeof t.priceUsd === "number" && Number.isFinite(t.priceUsd) && t.priceUsd > 0
                        const idx = Math.min(pts.length - 1, Math.max(0, Math.round(((x - 3) / (W - 6)) * (pts.length - 1))))
                        const y = filled
                          ? priceToY(pts, t.priceUsd as number, H).y
                          : priceToY(pts, pts[idx], H).y
                        /*
                          AN ARROW AIMED AT THE PRICE, the same shape the
                          chip draws. A circle carries no direction, so
                          colour was doing all the work — and two fills at a
                          similar price minutes apart landed on top of each
                          other, which is how this was reported. The tip
                          sits ON the traded price and the body hangs off
                          it, below for a buy and above for a sell, so
                          nothing is drawn at a price nobody traded and the
                          two sides separate themselves.
                        */
                        const cy = Math.min(H - 8, Math.max(8, y))
                        const sell = t.side === "sell"
                        const half = 4
                        const tall = 6.5
                        const tri = sell
                          ? `${x - half},${cy - tall} ${x + half},${cy - tall} ${x},${cy}`
                          : `${x - half},${cy + tall} ${x + half},${cy + tall} ${x},${cy}`
                        return (
                          <polygon
                            key={i}
                            points={tri}
                            fill={sell ? RED : GREEN}
                            stroke="rgba(14,20,32,.92)"
                            strokeWidth={1.25}
                            strokeLinejoin="round"
                          />
                        )
                      })}
                    {/* Where you got in: the average entry as a neutral level. */}
                    {held &&
                      typeof held.avgEntryPriceUsd === "number" &&
                      held.avgEntryPriceUsd > 0 &&
                      held.uiAmount > 0 && (
                        <line
                          x1={0}
                          x2={W}
                          y1={priceToY(pts, held.avgEntryPriceUsd, H).y}
                          y2={priceToY(pts, held.avgEntryPriceUsd, H).y}
                          stroke="rgba(255,255,255,.4)"
                          strokeWidth={1}
                          strokeDasharray="4 3"
                        />
                      )}
                  </Box>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
                  <Typography sx={{ fontSize: 10, color: JUICE.text3, fontVariantNumeric: "tabular-nums" }}>
                    {times?.length ? timeLabel(range, times[0]) : ""}
                  </Typography>
                  <Typography sx={{ fontSize: 10, color: JUICE.text3, fontVariantNumeric: "tabular-nums" }}>
                    {priceText(g.min)} – {priceText(g.max)}
                  </Typography>
                </Box>
              </>
            )}
          </Box>

          {/* A FILL GREETS THE READER IN THE TOKEN'S OWN ROOM. The
              celebration mounted only in the page strip - the CURRENT
              page's asset - so a fill on any other mint greeted nobody in
              the panel. The component is greet-once and storage-driven, so
              this is one line and it cannot double-fire. */}
          <FillCelebration mint={asset.mint} />

          {/*
            THE DOORS SIT UNDER THE CHART, which is where the decision gets
            made. They used to open below the market table AND below the
            trade history, so a reader who had just read the line had to
            scroll past six market facts and their own past to act on it —
            and the sheet that carries Market and Limit opened down there
            with them.

            The room reads: what it is, what it did, what you can do, what
            you hold, what the market looks like, what you already did
            here. Reading order, then acting order.
          */}
          {/* An asset on another chain: the priced route from the Arc balance, above the doors where it can be bought. */}
          {isRemote && <RoutePreview mint={asset.mint} />}
          {/* ── the doors that move money ── */}
          {(!isRemote || remoteLive) && (
          <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
            {(["buy", "sell"] as const).map((side) => {
              const isOpen = sheetMode === side
              return (
                <Box
                  key={side}
                  component="button"
                  onClick={() => setSheetMode(isOpen ? null : side)}
                  className="click-animation"
                  sx={{
                    flex: 1, border: "none", cursor: "pointer", font: "inherit",
                    fontSize: 12.5, fontWeight: 700, py: "9px", borderRadius: "999px",
                    // Direction colours, the chip's own: buy=green, sell=red.
                    color: side === "buy" ? JUICE.onBuyFill : "#FFFFFF",
                    background: side === "buy" ? JUICE_BUY_FILL : RED,
                    opacity: sheetMode && !isOpen ? 0.5 : 1,
                    transition: "opacity .15s ease-out",
                  }}
                >
                  {side === "buy" ? "Buy" : "Sell"}
                </Box>
              )
            })}
          </Box>
          )}
          {sheetMode && copyFrom && (
            /* One line, four facts: who, which way, how much, how long ago.
               It is context and not an instruction — the amount below is
               the reader's own (helpers/copyFrom.ts). */
            <Typography
              sx={{
                fontSize: 12,
                color: JUICE.text2,
                mb: 1,
                px: 0.5,
                display: "flex",
                alignItems: "center",
                gap: 0.75,
              }}
            >
              <Box component="span" sx={{ fontSize: 13 }}>
                {copyFrom.side === "sell" ? "↓" : "↑"}
              </Box>
              {copyFromLine(copyFrom)}
            </Typography>
          )}
          {sheetMode && (
            <Box className="panel-sheet-in" sx={{ mb: 2 }}>
              <TradeSheet
                asset={{
                  mint: asset.mint,
                  symbol: asset.symbol,
                  displayName: asset.displayName,
                  decimals: asset.decimals,
                  priceUsd: asset.indicativeUsd,
                }}
                mode={sheetMode}
                initialUsd={sheetUsd ?? undefined}
                onModeChange={(m) => setSheetMode(m)}
                onTraded={() => {
                  // The position card and the trade history BELOW this
                  // sheet were fetched once per mint (askedRef); a settled
                  // trade is the one moment they are guaranteed wrong.
                  // (They sat above it until the doors moved under the
                  // chart; the staleness is the same either way.)
                  refreshMine()
                }}
              />
            </Box>
          )}

          {/*
            WHAT YOU ACTUALLY HOLD, AS THE HERO OF THE ROOM.

            The reason this room existed and the one thing it never said.
            `held` was already fetched here and spent entirely on ONE dashed
            line in the chart: the room knew the reader's position and drew
            it as a hairline. Meanwhile the chip in the feed, one surface
            out, said "You +8.2%" in plain sight. Opening the panel was a
            downgrade, which is the opposite of what a door is for.

            Unrealized first (what the OPEN position is doing), because
            that is the question somebody opens a token room to answer.
            Null is printed as a dash, never as zero: a position whose
            basis predates the ledger is unknowable, not flat.
          */}
          {held && held.uiAmount > 0 && (
            <Box sx={{ ...PANEL_CARD, p: 1.75, mb: 2 }}>
              <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: DIM }}>
                  Your position
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: DIM, fontVariantNumeric: "tabular-nums" }}>
                  {held.uiAmount.toLocaleString("en-US", {
                    maximumFractionDigits: held.uiAmount >= 1000 ? 0 : 4,
                  })}{" "}
                  {asset.symbol}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 1, mt: 0.75 }}>
                <Typography sx={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {typeof held.valueUsd === "number" ? usd(held.valueUsd) : "—"}
                </Typography>
                {(() => {
                  const pnl =
                    typeof held.unrealizedPnlUsd === "number"
                      ? held.unrealizedPnlUsd
                      : null
                  if (pnl === null) return null
                  const basis =
                    typeof held.avgEntryPriceUsd === "number" &&
                    held.avgEntryPriceUsd > 0 &&
                    typeof asset.indicativeUsd === "number"
                      ? (asset.indicativeUsd / held.avgEntryPriceUsd - 1) * 100
                      : null
                  const up = pnl >= 0
                  return (
                    <Typography
                      sx={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: up ? GREEN : RED,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {up ? "+" : "-"}
                      {usd(Math.abs(pnl))}
                      {basis !== null && (
                        <Box component="span" sx={{ fontSize: 12, opacity: 0.8, ml: 0.75 }}>
                          {up ? "+" : ""}
                          {basis.toFixed(1)}%
                        </Box>
                      )}
                    </Typography>
                  )
                })()}
              </Box>
              {typeof held.avgEntryPriceUsd === "number" && held.avgEntryPriceUsd > 0 && (
                <Typography sx={{ fontSize: 11.5, color: DIM, mt: 0.75, fontVariantNumeric: "tabular-nums" }}>
                  Average entry {priceText(held.avgEntryPriceUsd)}
                  {typeof held.realizedPnlUsd === "number" && Math.abs(held.realizedPnlUsd) >= 0.005 && (
                    <> &middot; banked {held.realizedPnlUsd >= 0 ? "+" : "-"}{usd(Math.abs(held.realizedPnlUsd))}</>
                  )}
                </Typography>
              )}
            </Box>
          )}

          {/*
            THE MARKET, IN MORE DETAIL THAN THE ROW CAN CARRY. The chip has
            one line and spends it on price; a room can afford the numbers
            that decide whether a price is worth anything. Every figure here
            was already on the wire — holderCount and safety.liquidityUsd
            arrive with the asset and the header only draws price, 24h and
            market cap, so the grid carries the rest.

            A missing figure is OMITTED, not zeroed: "0 holders" is a claim
            about a token, "—" is a claim about our knowledge.
          */}
          {(() => {
            const cells: Array<[string, string]> = []
            const liq = asset.safety?.liquidityUsd
            if (typeof liq === "number" && liq > 0)
              cells.push(["Liquidity", compactMoney(liq)])
            if (typeof asset.holderCount === "number" && asset.holderCount > 0)
              cells.push(["Holders", asset.holderCount.toLocaleString("en-US")])
            /* THE TWO FACTS THAT CHANGE WHAT A PRESS DOES. They used to sit
               in the header as an orange stripe. They are not deleted along
               with it, because the chip and the sheet already dropped them
               and pointed HERE as the place a reader who wants them can
               find them: dropping them here too would leave them nowhere.
               A mint authority means the issuer can print more, a freeze
               authority means the issuer can take yours. Silence when the
               field is absent, never a reassurance we cannot support. */
            /* POOL AGE, BACK. Of the four facts cut from the sheet's old
               orange dump, this is the only one the gate does not already
               enforce a floor on and the only one that says "this launched
               yesterday" — which is the single thing a reader looking at a
               memecoin actually needs. It comes back HERE, in the grid,
               where a number is a number, and not as a warning: the rule
               is facts rather than scolding, so no "risky", no "DYOR". */
            const bornMs = asset.safety?.poolCreatedAtMs
            if (typeof bornMs === "number" && bornMs > 0) {
              const days = Math.floor((Date.now() - bornMs) / 86_400_000)
              cells.push([
                "Pool age",
                days < 1
                  ? "Today"
                  : days === 1
                    ? "1 day"
                    : days < 30
                      ? `${days} days`
                      : `${Math.floor(days / 30)}mo`,
              ])
            }
            if (asset.safety?.mintAuthorityRetained === true)
              cells.push(["Mint authority", "Open"])
            if (asset.safety?.freezeAuthorityRetained === true)
              cells.push(["Freeze authority", "Retained"])
            if (cells.length === 0) return null
            return (
              <Box
                sx={{
                  ...PANEL_CARD,
                  p: 1.5,
                  mb: 2,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 1.5,
                }}
              >
                {cells.map(([k, v]) => (
                  <Box key={k}>
                    <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: DIM }}>
                      {k}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 15,
                        fontWeight: 700,
                        mt: 0.25,
                        fontVariantNumeric: "tabular-nums",
                        color:
                          k === "Mint authority" || k === "Freeze authority"
                            ? "#FFB020"
                            : "inherit",
                      }}
                    >
                      {v}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )
          })()}

          {/*
            THE READER'S PARKED INTENTIONS, IN THE ROOM THEY ARE ABOUT.
            This file's own header calls it "the room where they all are",
            and yet a standing order placed on this very mint - the
            strongest return hook the product has - was invisible here,
            listed only on the profile. Both components already exist and
            already narrow by mint; they just were never invited in.
          */}
          <Box sx={{ mx: -2, mb: 1 }}>
            <OpenOrders mint={asset.mint} />
            <PriceAlerts mint={asset.mint} />
          </Box>

          {/*
            EVERY TRADE YOU HAVE MADE IN THIS TOKEN.

            `mine` was already fetched and already spent — on discs plotted
            in the chart. The list itself is the detail a feed row cannot
            carry and the reason to open a room: not "what is the price"
            but "what did I do here, and at what". Same rows, read twice.

            The executed price is printed only when the ledger knows it.
            A fill whose price was never recorded says so with a dash
            rather than being back-computed from dollars over quantity,
            which is an average and would read as a price.
          */}
          {mine.length > 0 && (
            <Box sx={{ ...PANEL_CARD, p: 0, mb: 2, overflow: "hidden" }}>
              <Typography
                sx={{
                  fontSize: 10, fontWeight: 800, letterSpacing: ".07em",
                  textTransform: "uppercase", color: DIM, px: 1.5, pt: 1.5, pb: 1,
                }}
              >
                Your trades &middot; {mine.length}
              </Typography>
              {mine.slice(0, 8).map((t, i) => (
                <Box
                  key={`${t.ts}-${i}`}
                  sx={{
                    display: "flex", alignItems: "center", gap: 1,
                    px: 1.5, py: 1,
                    borderTop: `1px solid ${alpha("#FFFFFF", 0.05)}`,
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: 11, fontWeight: 800, letterSpacing: ".04em",
                      textTransform: "uppercase", flexShrink: 0, width: 34,
                      color: t.side === "sell" ? RED : GREEN,
                    }}
                  >
                    {t.side === "sell" ? "Sold" : "Bought"}
                  </Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {usd(t.amountUsd)}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: DIM, fontVariantNumeric: "tabular-nums", ml: "auto" }}>
                    {typeof t.priceUsd === "number" && t.priceUsd > 0
                      ? `at ${priceText(t.priceUsd)}`
                      : "—"}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: JUICE.text3, flexShrink: 0, minWidth: 42, textAlign: "right" }}>
                    {when(t.ts)}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

        </>
      )}

      {chartOpen && (
        <ChartFullscreen
          mint={mint}
          symbol={(asset?.symbol ?? seed?.symbol ?? mint.slice(0, 4)).replace(/^\$/, "")}
          displayName={asset?.displayName ?? seed?.displayName ?? seed?.symbol}
          entryPriceUsd={held?.avgEntryPriceUsd ?? null}
          initialRange={range}
          onClose={() => setChartOpen(false)}
        />
      )}
    </Box>
  )
}
