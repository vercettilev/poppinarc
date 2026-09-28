import { composeWithCard } from "./composer"
/**
 * THE TRADE, AS A PICTURE WORTH POSTING.
 *
 * Fomo's share card is the reference: asset up top, the movement in the
 * middle, the numbers below, the brand at the bottom carrying a hook. Ours
 * differs in one structural way that matters — the place this card lands
 * (X) is the place the product lives, so a viewer with the extension sees a
 * live chip under the very tweet the card rides in. The share IS the
 * funnel.
 *
 * Split in two so the interesting half is testable: `drawTradeCard` is
 * pure-ish canvas painting (specs run it against a recording context), and
 * `shareTradeCard` is the browser choreography — canvas → PNG → clipboard,
 * then the X composer with prefilled text. Copy-then-compose because X's
 * web intent accepts TEXT only; the image travels via paste, and the
 * receipt line tells the reader exactly that.
 */

// The mark as a data URI baked at authoring time, because a content
// script cannot count on chrome-extension:// asset URLs being
// web-accessible, a data URI never taints the canvas — and vite 5.4's
// `?inline` query silently does not inline (see the constant's header).
import { POPPIN_LOGO_URI } from "~/assets/poppinLogoDataUri"

export interface TradeCardData {
  ticker: string
  /** "Bought $25" — the action, already worded. */
  action: string
  /** Closes for the little chart; null draws a card without one. */
  series: readonly number[] | null
  /** Market cap now, in USD; the memecoin-native unit. */
  mcap: number | null
  priceUsd: number | null
  /**
   * The sharer's Poppin username, WITHOUT the @. When known, the brand line
   * becomes their personal address — poppin.so/@handle — which is the whole
   * referral: the address rides the PICTURE, where X's ranking cannot see a
   * link, and the tweet itself stays link-free. null keeps plain poppin.so.
   */
  handle?: string | null
  /**
   * The token's own face, PRE-DECODED by the caller (drawTradeCard stays
   * synchronous and testable). Drawn as a disc beside the ticker — the
   * card is about a coin, and a coin is recognised by its picture before
   * its letters. null draws the card exactly as before. Callers must hand
   * over a NON-TAINTING source (a data-URI decode or a blob's ImageBitmap);
   * a cross-origin <img> here would poison toBlob and kill the whole share.
   */
  icon?: CanvasImageSource | null
  /** The Poppin mark, pre-decoded; sits beside the address so the brand
   *  line reads as a signature, not a bare URL. */
  logo?: CanvasImageSource | null
  /**
   * THE ACTION'S COLOR. A buy is green (the default, so the receipt card is
   * unchanged); a FLEX card colors its headline by the result — green for a
   * gain, red for a loss, because the number IS the verdict and painting a
   * loss green would be the one dishonest pixel on a card built to be shared.
   */
  tone?: "up" | "down"
  /**
   * A quieter second line under the action — the flex card's "+142% · in at
   * $0.0021 · unrealized". null draws the card exactly as the buy receipt
   * does (no subline, sparkline in its original place).
   */
  subline?: string | null
  /**
   * CALLER CREDIT. When the position was entered from someone's tweet, the
   * card names them: "via @caller". The whole flywheel's back half — the
   * person whose call made the money gets their name on the flex of it. null
   * when the entry had no caller (a search, a paste, a page).
   */
  credit?: string | null
  /**
   * The composer's tweet text, when the caller wants to override the default
   * "{action} of ${ticker} on Poppin". A flex reads "Bought $25 of $WIF"
   * badly with a PnL action, so it supplies its own sentence — still
   * carrying the $ticker cashtag, which is what gives other extension users
   * a live chip under the shared tweet.
   */
  tweetText?: string
}

export const CARD_W = 800
export const CARD_H = 450

/** $3.4M / $841K / $12,340 — the way a trader says it. */
export function compactUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `$${Math.round(n / 1_000)}K`
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/**
 * The tweet the composer opens with. The cashtag is the point: it is what
 * gives the OTHER extension users a chip under this very tweet.
 *
 * LINK-FREE on purpose. A bare "poppin.so" in tweet text autolinks into a
 * t.co URL, and X's open-sourced ranking treats an at-mention plus a URL as
 * a spam signal while weighting outbound links poorly in general. The
 * address travels on the PNG instead (poppin.so/@handle in the brand line),
 * where ranking cannot see it and a reader still can.
 */
/**
 * THE TAIL, AND WHY THERE IS MORE THAN ONE.
 *
 * "on Poppin" described the tool. What is remarkable is the PLACE: the
 * trade happened under a post, which no other product can say. So the tail
 * says where.
 *
 * IT ALSO HAS TO CARRY SOME ENERGY. The first pass at this said "without
 * leaving the timeline", which is accurate and reads like a feature list.
 * These are shorter, and they make a claim rather than a description: the
 * timeline is the exchange now, and that is either true or it is not.
 * Lowercase for the same reason emoji are banned from the card — the
 * register is a trader's post, not an announcement.
 *
 * @poppin_so rather than the bare word, because a mention is a door and a
 * word is not.
 *
 * SEVERAL, ROTATED, and that is a safety property rather than variety for
 * its own sake. Thousands of accounts posting one identical sentence with
 * one identical mention is the shape of coordinated behaviour, which is
 * the last thing to hand a ranking system while asking it to spread you.
 * Picked by a stable hash of the trade's own text, so re-sharing the same
 * pop never changes its wording.
 *
 * LINK-FREE still. X's own ranking weights outbound links poorly and reads
 * an at-mention beside a URL as spam; the address travels on the PNG.
 */
const TAILS = [
  'mid-scroll. no app, no tab. @poppin_so',
  'straight out of the timeline. @poppin_so',
  'from a tweet. that is the whole product. @poppin_so',
  'without opening a single tab. @poppin_so',
  'the timeline is the exchange now. @poppin_so',
] as const

/** Deterministic and cheap. Same trade, same sentence, every time. */
function tailFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return TAILS[Math.abs(h) % TAILS.length]
}

export function composeShareText(ticker: string, action: string): string {
  /* THE CASHTAG IS ADDED ONCE. This appended " of $TICKER" unconditionally
     while the sell path already passed a sentence containing it, so every
     sell share opened the composer with "Sold 5.7 of $ANSEM of $ANSEM on
     Poppin". It shipped because sells are rarer than buys and nobody read
     the second half of the sentence. */
  const tag = `$${ticker}`
  const body = action.includes(tag) ? action : `${action} of ${tag}`
  return `${body} ${tailFor(body)}`
}

type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "fillText"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "save"
  | "restore"
  | "arc"
  | "clip"
  | "closePath"
  | "drawImage"
  | "measureText"
> & {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
}

export function drawTradeCard(ctx: Ctx2D, data: TradeCardData): void {
  // Ground
  ctx.fillStyle = "#0E1420"
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Header: the coin's face when we have it, then the asset said big, and
  // the action beside it in its color. The disc is clipped round the same
  // way the chip wears it — one face across every surface.
  if (data.icon) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(76, 72, 28, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(data.icon, 48, 44, 56, 56)
    ctx.restore()
  }
  const headX = data.icon ? 120 : 48
  ctx.textAlign = "left"
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "700 52px -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.fillText(`$${data.ticker}`, headX, 92)
  // A buy stays green; a flex colors by result — a loss must read red.
  ctx.fillStyle = data.tone === "down" ? "#FF453A" : "#30D158"
  ctx.font = "700 44px -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.fillText(data.action, 48, 150)
  // The quieter line under it: the percent, the entry, the realized/unrealized
  // label. Only the flex card sends one.
  if (data.subline) {
    ctx.fillStyle = "#8CA3BD"
    ctx.font = "600 22px -apple-system, 'Segoe UI', Roboto, sans-serif"
    ctx.fillText(data.subline, 48, 184)
  }

  // The movement. Same geometry rules as the chip's chart: min–max span,
  // flat series draws a line through the middle rather than NaN. Drops a
  // touch when a subline sits above it, so the two never collide.
  if (data.series && data.series.length >= 2) {
    const pts = data.series.filter((v) => Number.isFinite(v))
    if (pts.length >= 2) {
      const top = data.subline ? 208 : 190
      const height = data.subline ? 132 : 150
      const left = 48
      const width = CARD_W - 96
      const min = Math.min(...pts)
      const max = Math.max(...pts)
      const span = max - min || 1
      ctx.strokeStyle = pts[pts.length - 1] >= pts[0] ? "#30D158" : "#FF453A"
      ctx.lineWidth = 3
      ctx.beginPath()
      pts.forEach((v, i) => {
        const x = left + (i * width) / (pts.length - 1)
        const y = top + height - ((v - min) / span) * height
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
  }

  // The numbers, in the units a trader quotes.
  ctx.font = "600 24px -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.fillStyle = "#8CA3BD"
  const facts: string[] = []
  if (data.priceUsd !== null) {
    facts.push(
      `Price $${data.priceUsd.toLocaleString("en-US", {
        maximumFractionDigits: data.priceUsd < 1 ? 6 : 2,
      })}`,
    )
  }
  if (data.mcap !== null) facts.push(`MC ${compactUsd(data.mcap)}`)
  if (facts.length > 0) ctx.fillText(facts.join("   ·   "), 48, 392)

  // The brand band. The card's whole job off-platform — and when the
  // sharer is known, the address is THEIRS: poppin.so/@handle is the
  // referral, carried where a tweet's ranking cannot see a link. The mark
  // sits just left of the address so the line reads as a signature.
  // CALLER CREDIT, bottom-left: the person whose tweet got the reader in.
  if (data.credit) {
    ctx.textAlign = "left"
    ctx.fillStyle = "#68C6FF"
    ctx.font = "600 22px -apple-system, 'Segoe UI', Roboto, sans-serif"
    ctx.fillText(data.credit, 48, 424)
  }
  ctx.fillStyle = "#68C6FF"
  ctx.fillRect(0, CARD_H - 8, CARD_W, 8)
  ctx.textAlign = "right"
  ctx.fillStyle = "#68C6FF"
  ctx.font = "700 26px -apple-system, 'Segoe UI', Roboto, sans-serif"
  const address = data.handle ? `poppin.so/@${data.handle}` : "poppin.so"
  ctx.fillText(address, CARD_W - 48, 392)
  if (data.logo) {
    const w = ctx.measureText(address).width
    ctx.drawImage(data.logo, CARD_W - 48 - w - 40, 366, 30, 30)
  }
}

/**
 * Decode a data URI into something drawImage accepts, through a BLOB so
 * the canvas stays clean for toBlob. Anything that fails to decode simply
 * does not appear — the card without a picture is the card we shipped
 * yesterday, and a missing face must never cost the share itself.
 */
export async function decodeImage(
  uri: string | null | undefined,
): Promise<CanvasImageSource | null> {
  if (!uri || !uri.startsWith("data:image/")) return null
  try {
    const blob = await (await fetch(uri)).blob()
    return await createImageBitmap(blob)
  } catch {
    // Chromium's createImageBitmap cannot decode SVG blobs, and the icon
    // road admits any image/* — so an SVG-iconed token wore its face on
    // the chip while the card went blank beside it. An Image element
    // decodes what the chip decodes, and a data URI never taints.
    try {
      const img = new Image()
      img.src = uri
      await img.decode()
      return img
    } catch {
      return null
    }
  }
}

/**
 * PNG to the clipboard, composer to the front. Resolves with what actually
 * happened so the caller can word the receipt honestly: "copied — paste it"
 * against "composer opened" when the clipboard was refused.
 *
 * `extras.iconUri` is the token's picture as a data URI (the icon bridge's
 * native shape); the Poppin mark rides the bundle. Both decode here so
 * drawTradeCard stays synchronous.
 */
export async function shareTradeCard(
  data: TradeCardData,
  extras?: { iconUri?: string | null },
): Promise<"composed" | "copied" | "text-only"> {
  let card: Blob | null = null
  try {
    const canvas = document.createElement("canvas")
    canvas.width = CARD_W
    canvas.height = CARD_H
    const ctx = canvas.getContext("2d")
    if (ctx) {
      const [icon, logo] = await Promise.all([
        decodeImage(extras?.iconUri),
        decodeImage(POPPIN_LOGO_URI),
      ])
      drawTradeCard(ctx, { ...data, icon, logo })
      card = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"))
    }
  } catch {
    // A card that could not be drawn still leaves the sentence to share.
  }
  return deliverCard(card, data.tweetText ?? composeShareText(data.ticker, data.action))
}

/**
 * THE LAST MILE, SHARED BY EVERY CARD. Clipboard first, so the fallback
 * road is already loaded; then X's own composer with the card in it; then
 * the intent URL. Resolves with what actually happened so the button can
 * say it honestly.
 */
export async function deliverCard(
  card: Blob | null,
  text: string,
): Promise<"composed" | "copied" | "text-only"> {
  let copied = false
  try {
    if (card && navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": card })])
      copied = true
    }
  } catch {
    // A refused clipboard is a wording change, not a failure.
  }

  /* IN THIS PAGE FIRST. The intent URL cannot carry an image, so going
     there means the reader has to paste — and the instruction to paste
     lives on the chip, behind the tab they just opened. Driving X's own
     composer keeps them where they are and puts the card in for them.
     Anything at all goes wrong and we take the old road with the clipboard
     already loaded, which is exactly where we were before. */
  if (await composeWithCard(text, card)) return "composed"

  window.open(
    `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener",
  )
  return copied ? "copied" : "text-only"
}
