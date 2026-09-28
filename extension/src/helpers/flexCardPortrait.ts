import type { FlexParts } from "~/helpers/flexCard"
import { usd } from "~/helpers/panelSurface"

/**
 * THE FLEX CARD, PORTRAIT. Approved by Lev on 2026-09-26 from three
 * canvas-rendered mockups (variant B, the blue glow).
 *
 * WHY IT CHANGED. The old flex was an 800x450 receipt: the coin's ticker
 * big, "Up $7.99" as the headline, a price chart filling the middle, and the
 * bare ghost mark in a corner. Set beside the cards crypto X actually
 * passes around (pump.fun's, fomo's), it read as a log line: nothing on it
 * was about the person, and its headline was the least impressive number
 * available.
 *
 * WHAT IT DOES NOW, AND THE REASON FOR EACH:
 *  - The PERSON leads: their face on a lit disc, their handle on a tilted
 *    pill. A flex is a claim somebody makes, and a claim needs a claimant.
 *  - The PERCENT is the hero, not the dollars. Poppin trades are $10-25, so
 *    a dollar headline makes every win look like lunch money; +32% reads as
 *    a trade at any size. The dollars stay, as evidence, in the row below.
 *  - "POPPED" and "BANKED" are the product's own words for a win (see the
 *    product-language rule), used as the badge a reader screenshots for.
 *  - 4:5 portrait, because on a phone it takes nearly twice the height of
 *    a landscape card in the feed, and the feed is where this is seen.
 *  - The mark on its BLUE DISC, which is the logo; the bare ghost was not.
 *  - A blue glow rather than pump.fun's green: the feed is full of green
 *    cards, and the one that is not green is the one that reads as ours.
 *    The number itself stays green, because it is the gain.
 *
 * Only gains get this card. A loss keeps the landscape card, whose red
 * headline is the honest one, and nothing here decides what is honest:
 * that is flexParts' job, and this only lays out what it already allowed.
 */
export const FLEX_W = 1080
export const FLEX_H = 1350

const FONT = "PoppinSans, -apple-system, 'Segoe UI', Roboto, sans-serif"
/** The brand blue, which also paints the glow and the handle's @. */
const GLOW = "104,198,255"
const GAIN_TOP = "#C9FAD6"
const GAIN = "#30D158"
const INK = "#F4F7FB"
const MUTED = "#98A2B3"
const LABEL = "#7B8494"

export interface FlexPortraitModel {
  hero: string
  badge: "POPPED" | "BANKED"
  subline: string
  stats: Array<{ label: string; value: string; tone: "plain" | "up" }>
}

/** "+32%", "+4.2%", "+1,240%": whole numbers once there is room to spare. */
export function heroPercent(pct: number): string {
  const a = Math.abs(pct)
  const body =
    a >= 1000
      ? Math.round(a).toLocaleString("en-US")
      : a >= 10
        ? a.toFixed(0)
        : a.toFixed(1)
  return `${pct < 0 ? "-" : "+"}${body}%`
}

/** Cents only where they carry weight: "$25.00", but "$2,040". */
function money(v: number, dp = Math.abs(v) >= 1000 ? 0 : 2): string {
  return usd(v, dp)
}

/**
 * THE ROW HAS TO ADD UP. Rounding cost and value separately made the row
 * read IN $24.99 + PROFIT $7.99 against NOW $32.99, a cent short, on a card
 * built to be screenshotted and checked. So one precision is chosen for the
 * whole row, cost and value are rounded to it, and the profit is their
 * difference at that precision: whatever a reader adds up, it matches.
 */
export function evidenceRow(inUsd: number, nowUsd: number) {
  const dp = Math.max(Math.abs(inUsd), Math.abs(nowUsd)) >= 1000 ? 0 : 2
  const f = 10 ** dp
  const cost = Math.round(inUsd * f) / f
  const value = Math.round(nowUsd * f) / f
  const profit = Math.round((value - cost) * f) / f
  return { dp, cost, value, profit }
}

/**
 * What the portrait card says, as data. Null for anything that is not a
 * gain, and for an open position missing any of its numbers, so the caller
 * falls back to the landscape card instead of drawing a half-empty one.
 */
export function flexPortraitModel(
  ticker: string,
  parts: FlexParts,
): FlexPortraitModel | null {
  if (parts.tone !== "up") return null
  const bare = ticker.replace(/^\$/, "")
  const credit = parts.credit ? ` · ${parts.credit}` : ""
  const n = parts.numbers
  if (n.kind === "open") {
    if (n.pct === null || n.inUsd === null || n.nowUsd === null) return null
    return {
      hero: heroPercent(n.pct),
      badge: "POPPED",
      subline: `on $${bare} · still holding${credit}`,
      stats: (() => {
        const r = evidenceRow(n.inUsd, n.nowUsd)
        return [
          { label: "IN", value: money(r.cost, r.dp), tone: "plain" as const },
          { label: "NOW", value: money(r.value, r.dp), tone: "up" as const },
          { label: "PROFIT", value: `+${money(r.profit, r.dp)}`, tone: "up" as const },
        ]
      })(),
    }
  }
  // A closed position has no "now" to mark against, so no percent and no
  // row: the banked dollars are the whole claim.
  return {
    hero: `+${money(n.pnlUsd)}`,
    badge: "BANKED",
    subline: `on $${bare} · closed${credit}`,
    stats: [],
  }
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "fillText"
  | "measureText"
  | "beginPath"
  | "moveTo"
  | "arcTo"
  | "arc"
  | "closePath"
  | "fill"
  | "stroke"
  | "clip"
  | "save"
  | "restore"
  | "translate"
  | "rotate"
  | "drawImage"
  | "createLinearGradient"
  | "createRadialGradient"
> & {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
}

export interface FlexPortraitAssets {
  /** The sharer's photo, pre-decoded from a data URI (non-tainting). */
  avatar?: CanvasImageSource | null
  /** The mark on its blue disc, pre-decoded from a data URI. */
  mark?: CanvasImageSource | null
  /** Username without the @; null draws no pill and signs as poppin.so. */
  handle?: string | null
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawFlexCard(
  ctx: Ctx,
  model: FlexPortraitModel,
  assets: FlexPortraitAssets = {},
): void {
  const W = FLEX_W
  const H = FLEX_H
  const cx = W / 2

  ctx.fillStyle = "#0A0C10"
  ctx.fillRect(0, 0, W, H)

  // The glow behind the face, the way a spotlight sits behind a subject.
  const glow = ctx.createRadialGradient(cx, 250, 20, cx, 250, 620)
  glow.addColorStop(0, `rgba(${GLOW},0.42)`)
  glow.addColorStop(0.45, `rgba(${GLOW},0.12)`)
  glow.addColorStop(1, `rgba(${GLOW},0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const edge = ctx.createLinearGradient(cx - 300, 0, cx + 300, 0)
  edge.addColorStop(0, `rgba(${GLOW},0)`)
  edge.addColorStop(0.5, `rgba(${GLOW},0.9)`)
  edge.addColorStop(1, `rgba(${GLOW},0)`)
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, W, 4)

  // The face. A missing photo falls back to the mark, never an empty ring.
  const ay = 250
  const ar = 150
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, ay, ar, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = "#1A1F2B"
  ctx.fillRect(cx - ar, ay - ar, ar * 2, ar * 2)
  const face = assets.avatar ?? assets.mark ?? null
  if (face) ctx.drawImage(face, cx - ar, ay - ar, ar * 2, ar * 2)
  ctx.restore()
  ctx.lineWidth = 6
  ctx.strokeStyle = "rgba(255,255,255,0.10)"
  ctx.beginPath()
  ctx.arc(cx, ay, ar + 3, 0, Math.PI * 2)
  ctx.stroke()

  // The handle on a tilted pill: the one playful beat on the card.
  const handle = assets.handle?.trim() || null
  if (handle) {
    ctx.save()
    ctx.translate(cx, ay + ar + 28)
    ctx.rotate(-0.06)
    ctx.font = `700 50px ${FONT}`
    const at = ctx.measureText("@").width
    const hw = at + 8 + ctx.measureText(handle).width + 80
    roundRect(ctx, -hw / 2, -46, hw, 92, 46)
    ctx.fillStyle = "#15181F"
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = "rgba(255,255,255,0.14)"
    ctx.stroke()
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.fillStyle = `rgb(${GLOW})`
    ctx.fillText("@", -hw / 2 + 40, 2)
    ctx.fillStyle = INK
    ctx.fillText(handle, -hw / 2 + 40 + at + 8, 2)
    ctx.restore()
  }

  // The badge, in the product's own word for a win.
  const by = 600
  ctx.font = `700 44px ${FONT}`
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  const bw = ctx.measureText(model.badge).width + (assets.mark ? 130 : 80)
  roundRect(ctx, cx - bw / 2, by - 40, bw, 80, 40)
  ctx.fillStyle = `rgba(${GLOW},0.10)`
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = `rgb(${GLOW})`
  ctx.stroke()
  let bx = cx - bw / 2 + 40
  if (assets.mark) {
    ctx.drawImage(assets.mark, cx - bw / 2 + 30, by - 24, 48, 48)
    bx = cx - bw / 2 + 92
  }
  ctx.fillStyle = `rgb(${GLOW})`
  ctx.fillText(model.badge, bx, by + 2)

  // The number IS the card: as large as the width allows, lit from above.
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  let size = 300
  ctx.font = `700 ${size}px ${FONT}`
  while (ctx.measureText(model.hero).width > W - 120 && size > 120) {
    size -= 8
    ctx.font = `700 ${size}px ${FONT}`
  }
  const hy = model.stats.length > 0 ? 900 : 960
  const hero = ctx.createLinearGradient(0, hy - size * 0.8, 0, hy)
  hero.addColorStop(0, GAIN_TOP)
  hero.addColorStop(1, GAIN)
  ctx.fillStyle = hero
  ctx.fillText(model.hero, cx, hy)

  ctx.font = `400 46px ${FONT}`
  ctx.fillStyle = MUTED
  ctx.fillText(model.subline, cx, hy + 80, W - 120)

  // The evidence row: what went in, what it is worth, what that made.
  if (model.stats.length === 3) {
    const sy = 1130
    const cols = [cx - 330, cx, cx + 330]
    model.stats.forEach((s, i) => {
      ctx.font = `700 58px ${FONT}`
      ctx.fillStyle = s.tone === "up" ? GAIN : INK
      ctx.fillText(s.value, cols[i], sy, 300)
      ctx.font = `400 32px ${FONT}`
      ctx.fillStyle = LABEL
      ctx.fillText(s.label, cols[i], sy + 52)
    })
    ctx.fillStyle = "rgba(255,255,255,0.12)"
    ctx.fillRect(cx - 165, sy - 50, 3, 90)
    ctx.fillRect(cx + 165, sy - 50, 3, 90)
  }

  // The signature: the mark and the sharer's own address. The address
  // rides the picture so the tweet itself stays link-free.
  const ly = 1268
  const addr = handle ? `poppin.so/@${handle}` : "poppin.so"
  ctx.font = `700 44px ${FONT}`
  const aw = ctx.measureText(addr).width
  const markW = assets.mark ? 64 + 18 : 0
  const left = cx - (markW + aw) / 2
  if (assets.mark) ctx.drawImage(assets.mark, left, ly - 44, 64, 64)
  ctx.textAlign = "left"
  ctx.fillStyle = "#E8EDF3"
  ctx.fillText(addr, left + markW, ly + 4)
}
