import { alpha, Box, Typography } from "@mui/material"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  candleGeometry,
  priceToY,
  scrubIndex,
  sparkGeometry,
  SPARK_RANGES,
  type SparkRange,
  timeLabel,
} from "~/helpers/chartMath"
import { ACCENT, DIM, GREEN, RED } from "~/helpers/panelSurface"
import { drawLineFromLeft } from "~/helpers/lineDraw"
import { priceText } from "~/helpers/priceText"
import { seriesAsset, type SeriesAnswer } from "~/services/SpotAssetService"
import { JUICE } from "~/theme/juice"

/**
 * THE CHART, FULL SIZE — the juicy zoom a hypercasual surface owes its one
 * live number. Every chart in the panel was a thumbnail with no way in: you
 * could see the shape move but never lean into it. Tap any of them and this
 * takes the whole panel, draws the line in, and lets a finger drag a
 * crosshair across every close with the price and the moment under it.
 *
 * Self-contained on purpose: it fetches its own series per range, so any
 * surface with a mint (the token room, a holdings row, a fill card) opens
 * the same view with one prop bag and no data threading. The geometry is
 * the shared chartMath the thumbnails already use, so the big chart and the
 * small one can never disagree about where a price sits.
 *
 * Panel-only (React/MUI). The chip and the page card live in a shadow root
 * and get their own Preact twin of this; the maths and the look are shared,
 * the shell cannot be.
 */

const VW = 340
const VH = 208
const PAD_Y = 10

export function ChartFullscreen(props: {
  mint: string
  symbol: string
  displayName?: string
  /** The reader's average entry, drawn as a reference line when held. */
  entryPriceUsd?: number | null
  initialRange?: SparkRange
  onClose: () => void
}) {
  const { mint, symbol, displayName, entryPriceUsd, onClose } = props
  const [range, setRange] = useState<SparkRange>(props.initialRange ?? "1d")
  const [series, setSeries] = useState<SeriesAnswer | null>(null)
  const [loadingRange, setLoadingRange] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const reduce =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches

  // Esc closes, and the body underneath must not scroll while this is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // The line holds while the next range loads (same rule as the thumbnail):
  // switching 1h→1d is a comparison, and a blank chart is what makes it
  // impossible. Only a fresh mint would clear it, and a mint never changes
  // inside one overlay.
  useEffect(() => {
    let alive = true
    setLoadingRange(true)
    setScrub(null)
    seriesAsset(mint, range)
      .then((r) => alive && setSeries(r))
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
  }, [mint, range])

  const pts = useMemo(
    () => (series?.points ?? []).filter((v) => Number.isFinite(v)),
    [series],
  )
  const hasCandles = Boolean(
    series?.opens && series?.highs && series?.lows && pts.length >= 2,
  )
  const g = sparkGeometry(pts, VW, VH)
  const candles = hasCandles
    ? candleGeometry(series!.opens, series!.highs, series!.lows, pts, VW, VH, PAD_Y)
    : null
  /**
   * THE LINE ARRIVES LEFT TO RIGHT, the same movement the chip and the token
   * room make. The ceremony is spent on the screen OPENING; a range change is
   * a comparison gesture and gets the everyday weight, because somebody
   * tapping 1H, 4H, 1D in a row to compare them must see finished lines.
   */
  const lineRef = useRef<SVGPolylineElement | null>(null)
  const opened = useRef(false)
  useEffect(() => {
    if (!g.points) return
    const first = !opened.current
    opened.current = true
    drawLineFromLeft(
      lineRef.current,
      first ? JUICE.cinemaMs : JUICE.motionMs,
      JUICE.drawEase,
    )
  }, [g.points])

  const up = candles ? candles.up : g.up
  const stroke = up ? GREEN : RED
  const first = pts[0]
  const last = pts[pts.length - 1]
  const changePct =
    first !== undefined && last !== undefined && first > 0
      ? ((last - first) / first) * 100
      : null

  // The value under the finger, or the latest close at rest.
  const shownIdx = scrub !== null ? scrub : pts.length - 1
  const shownPrice = pts[shownIdx]
  const shownTime = series?.times?.[shownIdx] ?? null

  // Entry line: only when it sits inside the DRAWN scale (the candle scale is
  // highs/lows, the line scale is the closes), or it reads as a chart running
  // off its own top edge. Computed against whichever scale is on screen.
  const min = candles ? candles.min : g.min
  const max = candles ? candles.max : g.max
  const entryY =
    typeof entryPriceUsd === "number" &&
    entryPriceUsd > 0 &&
    max > min &&
    entryPriceUsd >= min &&
    entryPriceUsd <= max
      ? PAD_Y + (1 - (entryPriceUsd - min) / (max - min)) * (VH - 2 * PAD_Y)
      : null

  // The area under the line, built from the polyline's own points so the
  // fill can never drift from the stroke.
  const areaPoints = useMemo(() => {
    if (!g.points) return null
    const coords = g.points.split(" ")
    const firstX = coords[0]?.split(",")[0]
    const lastX = coords[coords.length - 1]?.split(",")[0]
    if (firstX === undefined || lastX === undefined) return null
    return `${firstX},${VH} ${g.points} ${lastX},${VH}`
  }, [g.points])

  const onScrubMove = (clientX: number) => {
    const el = svgRef.current
    if (!el || pts.length === 0) return
    const rect = el.getBoundingClientRect()
    setScrub(scrubIndex(clientX - rect.left, rect.width, pts.length, VW, PAD_Y))
  }

  const scrubX = scrub !== null && pts.length > 1 ? (scrub / (pts.length - 1)) * VW : null

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label={`${symbol} chart`}
      className={reduce ? undefined : "cf-in"}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        display: "flex",
        flexDirection: "column",
        background: JUICE.groundDeep ?? "#090E17",
        // A composited layer of its own, so the draw-in never repaints the
        // panel behind it.
        willChange: "opacity, transform",
        /*
          OPENING A CHART IS A CEREMONY, and it was a 200ms fade.
       
          This screen is rare, deliberate and consequential — the reader
          asked to look closer — which is precisely the case cinemaMs exists
          for (theme/juice.ts). It now RISES rather than fading in place, so
          the movement says where it came from, and the line draws itself
          behind the entrance rather than after it: the two are one arrival
          on one clock, which is rule 7 rather than a flourish.
       
          The staggered header and ranges are the register Lev picked from
          four in a side-by-side mockup: a hero leads and the rest fall in
          behind it.
        */
        "@keyframes cf-pop": {
          from: { opacity: 0, transform: "translateY(14px) scale(.985)" },
          to: { opacity: 1, transform: "none" },
        },
        "@keyframes cf-rise": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "none" },
        },
        "&.cf-in": {
          animation: `cf-pop ${JUICE.cinemaMs}ms ${JUICE.cinemaEase}`,
        },
        "&.cf-in .cf-stagger": {
          animation: `cf-rise ${Math.round(JUICE.cinemaMs * 0.62)}ms ${JUICE.cinemaEase} both`,
        },
        "&.cf-in .cf-stagger:nth-of-type(2)": {
          animationDelay: `${Math.round(JUICE.cinemaMs * 0.12)}ms`,
        },
        "&.cf-in .cf-stagger:nth-of-type(3)": {
          animationDelay: `${Math.round(JUICE.cinemaMs * 0.2)}ms`,
        },
      }}
    >
      {/* Header: who, the price under the finger, and the move. */}
      <Box className="cf-stagger" sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, p: 2, pb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {displayName || symbol}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 0.25 }}>
            <Typography
              sx={{
                fontFamily: JUICE.mono,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-.02em",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.05,
              }}
            >
              {shownPrice !== undefined ? priceText(shownPrice) : "—"}
            </Typography>
            {changePct !== null && scrub === null && (
              <Typography
                sx={{ fontFamily: JUICE.mono, fontSize: 13, fontWeight: 700, color: up ? GREEN : RED }}
              >
                {changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%
              </Typography>
            )}
            {scrub !== null && shownTime !== null && (
              <Typography sx={{ fontSize: 12, color: DIM, fontVariantNumeric: "tabular-nums" }}>
                {timeLabel(range, shownTime)}
              </Typography>
            )}
          </Box>
        </Box>
        <Box
          component="button"
          onClick={onClose}
          aria-label="Close chart"
          className="click-animation"
          sx={{
            width: 34,
            height: 34,
            flexShrink: 0,
            borderRadius: "999px",
            border: "none",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            color: "#FFFFFF",
            fontSize: 18,
            background: alpha("#FFFFFF", 0.08),
            "&:hover": { background: alpha("#FFFFFF", 0.14) },
          }}
        >
          ✕
        </Box>
      </Box>

      {/* The chart takes the room the panel gives it. */}
      <Box
        sx={{ flex: 1, minHeight: 0, px: 2, display: "flex", flexDirection: "column", justifyContent: "center" }}
      >
        {series === null ? (
          <Typography sx={{ textAlign: "center", color: DIM, fontSize: 13 }}>
            Loading…
          </Typography>
        ) : !g.points && !candles ? (
          <Typography sx={{ textAlign: "center", color: DIM, fontSize: 13 }}>
            {series.failed ? "Chart didn't load." : "No chart for this range"}
          </Typography>
        ) : (
          <Box
            sx={{ position: "relative", opacity: loadingRange ? 0.5 : 1, transition: "opacity 140ms ease-out", touchAction: "none" }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              onScrubMove(e.clientX)
            }}
            onPointerMove={(e) => {
              if (e.buttons === 0 && e.pointerType === "mouse") return
              onScrubMove(e.clientX)
            }}
            onPointerUp={() => setScrub(null)}
            onPointerCancel={() => setScrub(null)}
          >
            <Box
              component="svg"
              ref={svgRef}
              viewBox={`0 0 ${VW} ${VH}`}
              preserveAspectRatio="none"
              sx={{ width: "100%", height: "clamp(200px, 42vh, 360px)", display: "block" }}
            >
              {/* Entry reference — the reader's own line, quiet dashes. */}
              {entryY !== null && (
                <line
                  x1={0}
                  x2={VW}
                  y1={entryY}
                  y2={entryY}
                  stroke={alpha("#FFFFFF", 0.32)}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {candles ? (
                candles.candles.map((c, i) => (
                  <g key={i}>
                    <line
                      x1={c.x}
                      x2={c.x}
                      y1={c.yHigh}
                      y2={c.yLow}
                      stroke={c.up ? GREEN : RED}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={c.x - candles.bodyW / 2}
                      y={c.yBody}
                      width={candles.bodyW}
                      height={c.hBody}
                      fill={c.up ? GREEN : RED}
                    />
                  </g>
                ))
              ) : (
                <>
                  {areaPoints && (
                    <polygon points={areaPoints} fill={alpha(stroke, 0.12)} stroke="none" />
                  )}
                  <polyline
                    points={g.points ?? ""}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    ref={lineRef}
                  />
                </>
              )}

              {/* The crosshair the finger drives, and — on the line — a dot
                  sitting exactly on the price it is reading. */}
              {scrubX !== null && (
                <line
                  x1={scrubX}
                  x2={scrubX}
                  y1={0}
                  y2={VH}
                  stroke={alpha("#FFFFFF", 0.4)}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {scrubX !== null && !candles && shownPrice !== undefined && (
                <circle
                  cx={scrubX}
                  cy={priceToY(pts, shownPrice, VH, PAD_Y).y}
                  r={4}
                  fill={stroke}
                  stroke={JUICE.groundDeep}
                  strokeWidth={1.5}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* Ranges — the whole reason a big chart earns its keep. */}
      <Box className="cf-stagger" sx={{ display: "flex", gap: 0.5, justifyContent: "center", flexWrap: "wrap", p: 2, pt: 1.5 }}>
        {SPARK_RANGES.map((r) => (
          <Box
            key={r}
            component="button"
            onClick={() => setRange(r)}
            className="click-animation"
            sx={{
              px: 1.25,
              py: "5px",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 11.5,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: r === range ? JUICE.onAccent : DIM,
              background: r === range ? ACCENT : alpha("#FFFFFF", 0.06),
            }}
          >
            {r.toUpperCase()}
          </Box>
        ))}
      </Box>

      <style>{`
        /* The draw moved to helpers/lineDraw.ts. The rule it broke here is
           worth keeping written down: a dasharray of 1600 is a GUESS at the
           line's length, and both ways of being wrong were reachable from
           this screen — on a short range the draw finished early and the last
           stretch snapped in, on a long one the line never completed. The
           length is measured now. (And this comment lives inside a template
           literal, so it may not carry a backtick of its own.) */
      `}</style>
    </Box>
  )
}
