/** @jsxImportSource preact */
/*
 * THE PRAGMA ABOVE IS LOAD-BEARING — Preact renders this tree (the card's
 * shadow root); without it the JSX produces React elements and Preact
 * silently drops every child. Same reason as SpotCard/Me/TradePanel.
 */
import { BELL_GLYPH } from "~/helpers/notificationText"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import {
  priceToY,
  RANGE_STEP_MS,
  scrubIndex,
  SPARK_RANGES,
  sparkGeometry,
  sparkXY,
  timeLabel,
  timeToX,
  type SparkRange,
} from "~/helpers/chartMath"
import { priceText } from "~/helpers/priceText"
import type { SeriesAnswer } from "~/services/SpotAssetService"

/**
 * THE CARD'S CHART, AT PARITY WITH THE CHIP.
 *
 * The card carried a single label-only 24h sparkline — right for a resting
 * card that must not grow a control competing with Buy, wrong the moment a
 * reader wants to actually read the price. The chip solved this by putting
 * the ranged chart behind a tap; the card does the same, and this is what
 * that tap opens.
 *
 * PARITY, not a second implementation: the geometry is the shared
 * chartMath helpers the chip and TokenView already use (no third copy of
 * min/max/step), the marks sit at the EXECUTED price the ledger records
 * (the chip's own honesty), the standing orders draw as dashed levels, the
 * average entry as a neutral line, and the bell parks an alert through the
 * exact helper the chip's 🔔 uses.
 *
 * Card-native on purpose: raw SVG + the card's own dark tokens, no MUI —
 * this renders inside the card's closed shadow root on arbitrary pages,
 * where every kilobyte and every inherited style is a liability.
 */

/**
 * TWO SIZES, ONE CHART. The card's chart used to be 308x108 and nothing
 * else, so "make it bigger" would have meant a second implementation of
 * every mark, level and fill — the third copy of this drawing, after the
 * chip's and the panel's. The geometry already comes from chartMath; the
 * only thing that was hard-coded was the frame. Now the frame is a prop
 * and the enlarged chart IS this one, scrub included.
 */
const SIZE = {
  small: { W: 308, H: 108, dot: 3.4, tag: 8, stroke: 1.8 },
  big: { W: 720, H: 380, dot: 5, tag: 11, stroke: 2.4 },
} as const

const GREEN = "#30D158"
const RED = "#FF453A"
const INK2 = "#8CA3BD"
const INK3 = "#6b7a8d"

type Order = {
  side: "buy" | "sell"
  triggerPriceUsd: number
}
type Trade = { side: "buy" | "sell"; ts: number; priceUsd?: number | null }

export function CardChart({
  mint,
  marketUsd,
  avgEntryUsd,
  held,
  onSeries,
  onMyTrades,
  onListOrders,
  onSaveAlert,
  big = false,
}: {
  mint: string
  marketUsd: number | null
  avgEntryUsd: number | null
  held: boolean
  onSeries: (mint: string, range: SparkRange) => Promise<SeriesAnswer>
  onMyTrades?: (mint: string) => Promise<ReadonlyArray<Trade>>
  onListOrders?: () => Promise<ReadonlyArray<Order>>
  onSaveAlert?: (targetUsd: number) => Promise<boolean>
  /** Render at overlay size, with a draggable crosshair. */
  big?: boolean
}) {
  const { W, H, dot, tag, stroke } = SIZE[big ? "big" : "small"]
  const [range, setRange] = useState<SparkRange>("1d")
  const [series, setSeries] = useState<SeriesAnswer | null>(null)
  const [mine, setMine] = useState<ReadonlyArray<Trade>>([])
  const [orders, setOrders] = useState<ReadonlyArray<Order>>([])
  const [bellOpen, setBellOpen] = useState(false)
  const [target, setTarget] = useState("")
  const [alertMsg, setAlertMsg] = useState<string | null>(null)
  /**
   * WHERE THE FINGER IS, in point index. Only the enlarged chart carries
   * it: on 308x108 a crosshair covers the line it is reading, and the card
   * at rest must not grow a control that competes with Buy. null = not
   * scrubbing, which is NOT index 0 — the head reads "now" when nobody is
   * touching it.
   */
  const [scrub, setScrub] = useState<number | null>(null)
  const plotRef = useRef<HTMLDivElement | null>(null)
  const mintRef = useRef(mint)
  mintRef.current = mint

  // The reader's own story is fetched ONCE per mount, not per range flip —
  // the marks and levels are the same trades whatever window frames them.
  useEffect(() => {
    let alive = true
    onMyTrades?.(mint)
      .then((t) => alive && setMine(t))
      .catch(() => undefined)
    onListOrders?.()
      .then((o) => alive && setOrders(o.filter(Boolean)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mint, onMyTrades, onListOrders])

  const [loadingRange, setLoadingRange] = useState(false)
  useEffect(() => {
    let alive = true
    /**
     * STALE-WHILE-REVALIDATE. setSeries(null) here replaced the 108px
     * chart with a 60px "Loading…" note on EVERY range tap - the card
     * shrank, the foot vanished, everything regrew when the fetch landed.
     * The one exploratory control punished exploration. The old line
     * stays, dimmed, until the new range lands; only the very first load
     * has nothing to keep.
     */
    setLoadingRange(true)
    onSeries(mint, range)
      .then((r) => {
        if (!alive) return
        setSeries(r)
        setLoadingRange(false)
      })
      .catch(
        () =>
          alive &&
          setSeries({
            points: null,
            times: null,
            opens: null,
            highs: null,
            lows: null,
            failed: true,
          }),
      )
      .finally(() => alive && setLoadingRange(false))
    return () => {
      alive = false
    }
  }, [mint, range, onSeries])

  const g = useMemo(() => sparkGeometry(series?.points, W, H), [series, W, H])
  const pts = useMemo(
    () => (series?.points ?? []).filter((v) => Number.isFinite(v)),
    [series],
  )
  const times = useMemo(() => {
    if (series?.times && series.times.length === pts.length) return series.times
    if (pts.length === 0) return [] as number[]
    // No candle clock from the server: fall back to the range's fixed step,
    // exactly as the chip does — last point is "now", each step walks back.
    const step = RANGE_STEP_MS[range]
    const end = Date.now()
    return pts.map((_, i) => end - (pts.length - 1 - i) * step)
  }, [series, pts, range])

  const color = g.up ? GREEN : RED
  const winStart = times[0] ?? 0
  const winEnd = times[times.length - 1] ?? winStart

  const park = async () => {
    const n = Number(target)
    if (!Number.isFinite(n) || n <= 0) {
      setAlertMsg("Enter a price")
      return
    }
    const ok = await onSaveAlert?.(n)
    setAlertMsg(ok ? "Alert set" : "Already watching that")
    if (ok) {
      setTarget("")
      setBellOpen(false)
    }
  }

  /**
   * THE READOUT IS THE POINT OF ENLARGING. A bigger line you still cannot
   * interrogate is just a bigger line. The index comes from the shared
   * scrubIndex so the card, the chip and the panel all answer the same
   * pixel with the same candle.
   */
  const onScrub = (e: PointerEvent) => {
    const host = plotRef.current
    if (!host || pts.length < 2) return
    if (e.type === "pointerdown") {
      host.setPointerCapture?.(e.pointerId)
    } else if (e.buttons === 0 && e.pointerType === "mouse") {
      return
    }
    const rect = host.getBoundingClientRect()
    setScrub(scrubIndex(e.clientX - rect.left, rect.width, pts.length, W))
  }
  const endScrub = () => setScrub(null)

  const shownIdx = scrub === null ? pts.length - 1 : scrub
  const shownPrice = pts[shownIdx] ?? null
  const shownTime = times[shownIdx] ?? null

  return (
    <div class={`card-chart${big ? " cc-big" : ""}`}>
      <div class="cc-head">
        <div class="cc-ranges">
          {SPARK_RANGES.map((r) => (
            <button
              key={r}
              class={`cc-range${r === range ? " on" : ""}`}
              onClick={() => setRange(r)}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        {onSaveAlert && marketUsd !== null && (
          <button
            class={`cc-bell${bellOpen ? " on" : ""}`}
            aria-label="Set a price alert"
            onClick={() => {
              setAlertMsg(null)
              setTarget(bellOpen ? "" : String(marketUsd))
              setBellOpen((v) => !v)
            }}
            /* The shared bell, not an emoji: this was the one glyph on the
               card rendered as a system font's picture while every other
               bell in the product - the chip's, Me's fired and standing
               rows - speaks the same SVG. An emoji also changes shape per
               platform, so the card's bell did not match the card's own
               alert rows on the same screen. */
            dangerouslySetInnerHTML={{ __html: BELL_GLYPH }}
          />
        )}
      </div>

      {bellOpen && (
        <div class="cc-bellrow">
          <span class="cc-bell-k">Alert me at</span>
          <input
            class="cc-bell-in"
            inputMode="decimal"
            value={target}
            onInput={(e) => setTarget((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && park()}
            placeholder="price"
          />
          <button class="cc-bell-set" onClick={park}>
            Set
          </button>
        </div>
      )}
      {alertMsg && <div class="cc-alertmsg">{alertMsg}</div>}

      <div
        ref={plotRef}
        class={`cc-plot${loadingRange && series !== null ? " cc-stale" : ""}${big ? " cc-big-plot" : ""}`}
        /* Pointer events, not mouse+touch: one code path covers finger and
           trackpad, and setPointerCapture keeps the readout following a
           drag that leaves the plot instead of dropping it mid-gesture. */
        onPointerDown={big ? onScrub : undefined}
        onPointerMove={big ? onScrub : undefined}
        onPointerUp={big ? endScrub : undefined}
        onPointerCancel={big ? endScrub : undefined}
        onPointerLeave={big ? endScrub : undefined}
      >
        {series === null && <div class="cc-note">Loading…</div>}
        {loadingRange && series !== null && <div class="cc-loading">Loading…</div>}
        {series !== null && !g.points && (
          <div class="cc-note">
            {series.failed ? "Chart did not load." : "No chart for this range"}
          </div>
        )}
        {series !== null && g.points && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="none"
            focusable="false"
          >
            <polyline
              points={g.points}
              fill="none"
              stroke={color}
              stroke-width={stroke}
              stroke-linejoin="round"
              stroke-linecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${color}55)` }}
            />
            {/* Standing orders: dashed levels at the trigger price, each
                LABELLED with the real number. A level off the window's top
                or bottom clamps to the edge (priceToY), and two clamped
                triggers would otherwise draw at the identical y — the tag
                is what keeps a $14 order and a $50 order distinct on a
                money surface. */}
            {orders
              .filter((o) => Number.isFinite(o.triggerPriceUsd))
              .map((o, i) => {
                const c = o.side === "sell" ? RED : GREEN
                const y = priceToY(pts, o.triggerPriceUsd, H).y
                return (
                  <g key={`o${i}`}>
                    <line
                      x1={0}
                      x2={W}
                      y1={y}
                      y2={y}
                      stroke={c}
                      stroke-width="1"
                      stroke-dasharray="4 3"
                      opacity={0.6}
                    />
                    <text
                      x={W - 2}
                      y={Math.min(H - 2, Math.max(tag, y - 2))}
                      text-anchor="end"
                      font-size={tag}
                      font-weight="700"
                      fill={c}
                    >
                      {`${o.side === "sell" ? "S" : "B"} ${priceText(o.triggerPriceUsd)}`}
                    </text>
                  </g>
                )
              })}
            {/* The average entry: a neutral level with its own tag, only
                while held. */}
            {held && avgEntryUsd !== null && avgEntryUsd > 0 && (
              <g>
                <line
                  x1={0}
                  x2={W}
                  y1={priceToY(pts, avgEntryUsd, H).y}
                  y2={priceToY(pts, avgEntryUsd, H).y}
                  stroke="rgba(255,255,255,.45)"
                  stroke-width="1"
                  stroke-dasharray="4 3"
                />
                <text
                  x={2}
                  y={Math.min(H - 2, Math.max(tag, priceToY(pts, avgEntryUsd, H).y - 2))}
                  text-anchor="start"
                  font-size={tag}
                  font-weight="700"
                  fill="rgba(255,255,255,.7)"
                >
                  {`You ${priceText(avgEntryUsd)}`}
                </text>
              </g>
            )}
            {/* The reader's fills, at the price they executed at. */}
            {times.length > 0 &&
              mine.map((t, i) => {
                // WHERE IN TIME the trade sits, then SNAPPED to the nearest
                // candle's index. The line is drawn in INDEX space (uniform
                // step), so on gappy candle times a raw timeToX x would
                // float the disc off the line it is annotating; snapping to
                // the candle index keeps it ON the line. y is the executed
                // price when the ledger knows it.
                const tx = timeToX(t.ts, winStart, winEnd, W)
                if (tx === null) return null
                const idx = Math.min(
                  pts.length - 1,
                  Math.max(
                    0,
                    Math.round(((tx - 3) / (W - 6)) * (pts.length - 1)),
                  ),
                )
                const x = sparkXY(pts, idx, W, H).x
                const filled =
                  typeof t.priceUsd === "number" &&
                  Number.isFinite(t.priceUsd) &&
                  t.priceUsd > 0
                const y = filled
                  ? priceToY(pts, t.priceUsd as number, H).y
                  : sparkXY(pts, idx, W, H).y
                return (
                  <circle
                    key={`m${i}`}
                    cx={x}
                    cy={Math.min(H - dot - 2, Math.max(dot + 2, y))}
                    r={dot}
                    fill={t.side === "sell" ? RED : GREEN}
                    stroke="rgba(14,20,32,.92)"
                    stroke-width="1.4"
                  />
                )
              })}
            {/* THE CROSSHAIR, above every mark because it is the thing
                being read. Drawn inside the SVG so the dot sits at the
                PRICE, not at the vertical centre of the box — the mistake
                the panel's overlay made first. */}
            {big && scrub !== null && shownPrice !== null && (
              <g pointer-events="none">
                <line
                  x1={sparkXY(pts, shownIdx, W, H).x}
                  x2={sparkXY(pts, shownIdx, W, H).x}
                  y1={0}
                  y2={H}
                  stroke="rgba(255,255,255,.35)"
                  stroke-width="1"
                />
                <circle
                  cx={sparkXY(pts, shownIdx, W, H).x}
                  cy={priceToY(pts, shownPrice, H).y}
                  r={dot + 1.5}
                  fill={color}
                  stroke="rgba(14,20,32,.92)"
                  stroke-width="2"
                />
              </g>
            )}
          </svg>
        )}
      </div>

      {big && series !== null && g.points && shownPrice !== null && (
        <div class="cc-read">
          <span class="cc-read-p">{priceText(shownPrice)}</span>
          <span class="cc-read-t">
            {shownTime === null
              ? ""
              : scrub === null
                ? "now"
                : timeLabel(range, shownTime)}
          </span>
        </div>
      )}
      {series !== null && g.points && (
        <div class="cc-foot">
          <span>{times.length ? timeLabel(range, times[0]) : ""}</span>
          <span>
            {priceText(g.min)} – {priceText(g.max)}
          </span>
        </div>
      )}
    </div>
  )
}
