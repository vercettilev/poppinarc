import { STALE_CONTEXT } from "~/lib/fetchService"
import { messageOf } from "~/helpers/refusalCopy"
import { reasonOf } from "~/helpers/tradeMath"
import { qtyText } from "~/helpers/qtyText"

/**
 * The inline buy — a whole trade inside one row of the feed.
 *
 * The strip's Buy used to open the docked card, which is a context switch at
 * the exact moment someone decided to act: eyes leave the tweet, the card
 * expands elsewhere, the moment cools. This module is the alternative — tap,
 * amount, confirm, done, without the feed ever moving.
 *
 * It is deliberately a MODULE and not markup so the money rules live where
 * tests can hold them. The mapping below is the card's and the panel's, word
 * for word; a third money surface earns its existence only by inheriting the
 * rules the first two paid for:
 *
 *   - dry run says so out loud, and is not dressed as a purchase
 *   - "unknown" settlement is not "failed" — claiming either is guessing
 *     about somebody's money
 *   - 401 is an auth answer, not an error string
 *   - "insufficient" names the fix (top up), not just the problem
 *
 * What it deliberately does NOT have: custom amounts and quoting. The three
 * presets ARE the product's answer to "how much" (see tradeMath's history);
 * a reader who wants precision taps into the card, which the strip still
 * offers for Sell. Buy stays two decisions wide.
 */

/**
 * ONE PRESS, ONE KEY.
 *
 * The server's dedup is only as good as this string. It must be the SAME
 * across every attempt at one press — that is what makes a retry safe —
 * and DIFFERENT for the next press, or a reader who genuinely wants to buy
 * twice is silently served the first trade's receipt.
 *
 * So it is minted here, at the moment a human decides, and never derived
 * from the arguments: mint+amount+minute would collapse two deliberate
 * $25 buys of the same token into one.
 */
export function pressKey(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  // No crypto in this context is not a reason to trade unprotected, but it
  // is also not a reason to refuse: two values from Math.random plus the
  // clock collide far less often than the alternative, which today is no
  // key at all.
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

export interface InlineBuyServices {
  swap(
    mint: string,
    amountUsd: number,
    /** The tweet that DROVE this trade — the attribution nothing
     *  downstream can reconstruct after the fact. */
    sourceUrl?: string,
    /** This press's identity, so a retry cannot buy twice. */
    idempotencyKey?: string,
  ): Promise<{
    signature: string
    dryRun: boolean
    outAmountRaw: string
  }>
  confirm(signature: string): Promise<{ status: "confirmed" | "unknown" | "failed" }>
}

export type InlineBuyOutcome =
  /**
   * The trade landed. `signature` and `tokens` ride along so a caller can
   * put it on the feed without re-deriving what it just watched happen —
   * the receipt already knows both.
   */
  | { kind: "done"; text: string; signature?: string; tokens?: number }
  /** Unsettled: `signature` rides along so the caller can RE-ASK the
   *  chain instead of leaving the reader's anxious moment terminal. */
  | { kind: "pending"; text: string; signature?: string }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string; action?: "signin" | "topup"; detail?: string }

/**
 * WHY IT DID NOT WORK, in one short field.
 *
 * Measured on production (2026-09-20): between 40 and 60 percent of trade
 * presses failed on three separate days, and every `swap_failed` row in
 * the database carried `kind: "error"` and nothing else. So the product
 * knew a trade had failed and could not say why — not once, not in
 * aggregate. The card's own path had always sent `reason`; the chip's,
 * which is where nearly every press happens, never did.
 *
 * The outcome's own sentence IS the reason: it is our copy, written for
 * this exact case, and it names sign-in, a short balance, a wallet
 * refusal or a chain rejection. `detail` is the wallet's own words when
 * there are any. Capped, because telemetry metadata is a JSON column and
 * a reason is a label, not a log line.
 */
export function outcomeReason(o: InlineBuyOutcome): string | undefined {
  if (o.kind !== "error") return undefined
  const detail = "detail" in o && o.detail ? ` · ${o.detail}` : ""
  return `${o.text}${detail}`.slice(0, 160)
}

/** Raw base units → a human amount, honest about unknown decimals. */
function amountText(raw: string, decimals: number | null, symbol: string): string {
  if (decimals === null) return symbol
  const n = Number(raw) / 10 ** decimals
  // helpers/qtyText: four fraction digits told a reader who had just bought
  // $1.00 of Bitcoin that they received 0 WBTC.
  return `${qtyText(n)} ${symbol}`
}

export async function runInlineBuy(
  services: InlineBuyServices,
  args: {
    mint: string
    usd: number
    symbol: string
    decimals: number | null
    sourceUrl?: string
    /**
     * This press's identity. Optional so a caller that has not adopted it
     * still works — but the server can then only warn that dedup is off,
     * which is what it did for every buy before this existed.
     */
    idempotencyKey?: string
  },
): Promise<InlineBuyOutcome> {
  let built: Awaited<ReturnType<InlineBuyServices["swap"]>>
  try {
    built = await services.swap(
      args.mint,
      args.usd,
      args.sourceUrl,
      args.idempotencyKey,
    )
  } catch (e) {
    const status = (e as { status?: number })?.status
    if (status === 401 || status === 403) {
      return { kind: "error", text: "Sign in to trade", action: "signin" }
    }
    // The page outlived the extension (an update, or a reload with this tab
    // open). Nothing left this page; "could not build the trade" would blame
    // the market for a browser fact.
    if ((e as { code?: string })?.code === STALE_CONTEXT) {
      return { kind: "error", text: "Poppin updated. Reload the page." }
    }
    const raw = messageOf(e) ?? ""
    const reason = reasonOf(e, "That buy didn't go through. Try again.")
    // What the wallet actually said, when it said anything: for the
    // telemetry row, never for the sentence (helpers/externalTrade.ts). The
    // server's own words ride there too whenever the sentence replaced them
    // (helpers/refusalCopy.ts), so a plainer screen costs no evidence.
    const detail = (e as { detail?: unknown })?.detail
    const carried =
      typeof detail === "string" && detail
        ? { detail: detail.slice(0, 200) }
        : raw && raw !== reason
          ? { detail: raw.slice(0, 200) }
          : {}
    // Routed on the raw message: the sentence may have replaced the word.
    return /insufficient/i.test(raw)
      ? { kind: "error", text: "Balance is short", action: "topup", ...carried }
      : { kind: "error", text: reason, ...carried }
  }

  if (built.dryRun) {
    return { kind: "info", text: "Dry run — built and verified, nothing bought" }
  }

  const bought = amountText(built.outAmountRaw, args.decimals, args.symbol)

  let settled: { status: "confirmed" | "unknown" | "failed" }
  try {
    settled = await services.confirm(built.signature)
  } catch {
    // The chain was not reached for an answer; the trade may well have
    // landed. Neither success nor failure may be claimed.
    return { kind: "pending", text: `Bought ${bought} · confirming`, signature: built.signature }
  }

  if (settled.status === "failed") {
    return { kind: "error", text: "The transaction failed on chain" }
  }
  if (settled.status === "unknown") {
    return { kind: "pending", text: `Bought ${bought} · confirming`, signature: built.signature }
  }
  return {
    kind: "done",
    text: `Bought ${bought}`,
    signature: built.signature,
    tokens:
      args.decimals === null
        ? 0
        : Number(built.outAmountRaw) / 10 ** args.decimals,
  }
}

/**
 * The standing-order leg of the same table.
 *
 * Placing an order is an ON-CHAIN act (the escrow transaction), so it gets
 * the full tail a buy gets: dry run says so, 401 is an auth answer,
 * "unknown" settlement is not "failed". The AMOUNT stays a preset — the
 * chip's two-decisions rule holds — and the one typed thing is the price,
 * which is the whole point of an order.
 */
export interface InlineOrderServices {
  createOrder(dto: {
    mint: string
    side: "buy" | "sell"
    /** Buys are sized in dollars. */
    amountUsd?: number
    /** Sells are sized in the asset's RAW units, echoed from /balance. */
    amountRaw?: string
    triggerPriceUsd: number
    /** This press's identity — a double-submitted Place must not park two
     *  orders at the same price. */
    idempotencyKey?: string
  }): Promise<{ orderKey: string; signature: string; dryRun: boolean }>
  confirm(signature: string): Promise<{ status: "confirmed" | "unknown" | "failed" }>
}

export async function runInlineOrder(
  services: InlineOrderServices,
  args: {
    mint: string
    triggerPriceUsd: number
    priceText: string
    /** A buy sized in dollars, or a sell sized in raw units. Never both. */
    side?: "buy" | "sell"
    usd?: number
    amountRaw?: string
  },
): Promise<InlineBuyOutcome> {
  const side = args.side ?? "buy"
  let placed: Awaited<ReturnType<InlineOrderServices["createOrder"]>>
  try {
    placed = await services.createOrder({
      mint: args.mint,
      side,
      amountUsd: side === "buy" ? args.usd : undefined,
      amountRaw: side === "sell" ? args.amountRaw : undefined,
      triggerPriceUsd: args.triggerPriceUsd,
      // Minted here rather than taken from args: every caller of this
      // runner is a press, and a runner that mints its own key cannot be
      // called twice for one press by accident.
      idempotencyKey: pressKey(),
    })
  } catch (e) {
    const status = (e as { status?: number })?.status
    if (status === 401 || status === 403) {
      return { kind: "error", text: "Sign in to trade", action: "signin" }
    }
    const raw = messageOf(e) ?? ""
    const reason = reasonOf(e, "The order didn't go through. Try again.")
    const carried = raw && raw !== reason ? { detail: raw.slice(0, 200) } : {}
    return /insufficient/i.test(raw)
      ? { kind: "error", text: "Balance is short", action: "topup", ...carried }
      : { kind: "error", text: reason, ...carried }
  }

  if (placed.dryRun) {
    return { kind: "info", text: "Dry run — order built and verified, nothing placed" }
  }

  let settled: { status: "confirmed" | "unknown" | "failed" }
  try {
    settled = await services.confirm(placed.signature)
  } catch {
    return { kind: "pending", text: "Order sent · confirming" }
  }

  if (settled.status === "failed") {
    return { kind: "error", text: "Placing the order failed on chain" }
  }
  if (settled.status === "unknown") {
    return { kind: "pending", text: "Order sent · confirming" }
  }
  // A standing order has no expiry (createOrder sends none), so the one
  // moment the reader is listening says so.
  return {
    kind: "done",
    text: `Order in · fills at ${args.priceText} or better · open until you cancel it`,
  }
}
