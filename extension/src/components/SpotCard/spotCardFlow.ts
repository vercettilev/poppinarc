import { mountSpotCard, type SpotCardController } from "./mount"
// marketBuyPayWith left with the SOL pocket: a buy spends USDC, always.
import { ONBOARDING_V2 } from "~/config/onboarding"
import {
  createPagePost,
  createReply,
  createTradePost,
  fetchPagePosts,
  fetchPresence,
  fetchReplies,
  fetchActivity,
  fetchAssetByMint,
  fetchBook,
  fetchMe,
  fetchSpendingPower,
  openFeedForPage,
  openInPanel,
  openMyPanel,
  openProfile,
  openSignIn,
  openTopUp,
  shareOnX,
  togglePostVote,
} from "./pagePosts"
import { canonicalPageUrl } from "~/helpers/pageUrl"
import { readBookCache } from "~/helpers/bookCache"
import type { SpotPositionsResponse } from "~/services/SpotAssetService"
import { noteAutoOpenCollapsed, noteCardWanted } from "./hostRest"
import {
  addAlert,
  FIRED_ALERTS_KEY,
  makeAlert,
  PRICE_ALERTS_KEY,
  unreadFired,
  type FiredAlert,
  type PriceAlert,
} from "~/helpers/priceAlerts"
import { PENDING_FILLS_KEY, type PendingFill } from "~/helpers/orderFillWatch"
import { listOrdersAsset } from "~/services/SpotAssetService"
import { cancelOrderAsset } from "~/services/SpotAssetService"
import { myTradesAsset, seriesAsset } from "~/services/SpotAssetService"
import { isWatched, toggleWatch, WATCHLIST_KEY, type WatchedAsset } from "~/helpers/watchlist"
import { settledBalance, usdToRawOfHolding } from "~/helpers/tradeMath"
import type { SpotAsset } from "./SpotCard"
import { receiptSentence } from "~/helpers/tradeReceipt"
import { qtyText } from "~/helpers/qtyText"
import { pressKey } from "~/entries/contentScript/x/inlineBuy"

/**
 * The card's flow: quote on typing, confirm, then the optimistic outcome.
 *
 * Ported from poppin-v2's content script. This is the half that is NOT the DOM
 * — the sequencing, the race guard, and the honesty rules about what may be
 * claimed and when.
 *
 * The card itself stays dumb: it renders what it is told and reports what was
 * pressed. Everything below decides.
 */

export interface SpotFlowApi {
  /**
   * The reader's holding of this mint, re-read from chain.
   *
   * Exists because the card fetched the balance ONCE, at mount, and never
   * again: buy $1 of WIF and the Sell button still would not appear, because
   * the card was still holding the answer to "do you own any" from before
   * you owned any. A trading surface that cannot sell what it just sold you
   * is broken in the one place a reader is most likely to look next.
   */
  balance(mint: string): Promise<{ uiAmount: number; raw: string } | null>
  /** Sell exact-in RAW units of the asset. Returns once submitted. */
  sell(
    mint: string,
    amountRaw: string,
  ): Promise<
    | { ok: true; signature: string; outUsdcRaw: string; dryRun: boolean }
    | { ok: false; reason: string; raw?: string }
  >
  /** Indicative price for an amount. Never spends. */
  /** The reader's standing orders, and the exit from one. */
  listOrders?(): Promise<
    Array<{
      orderKey: string
      mint: string
      side: "buy" | "sell"
      amountUsd: number | null
      amountUi: number
      triggerPriceUsd: number
      gated: boolean
    }>
  >
  cancelOrder?(orderKey: string): Promise<unknown>
  /** Park a standing order — the same rail every other surface rides. */
  createOrder?(dto: {
    mint: string
    side: "buy" | "sell"
    amountUsd?: number
    amountRaw?: string
    triggerPriceUsd: number
    /** This press's identity. Placing escrows USDC on chain and the
     *  server's confirm can time out while the transaction still lands, so
     *  without a key a retry parks a SECOND order at the same price with a
     *  second escrow. inlineBuy's runner already mints one; this surface
     *  declared no field for it at all. */
    idempotencyKey?: string
  }): Promise<unknown>
  quote(mint: string, amountUsd: number): Promise<
    | { ok: true; outAmount: number; priceImpactPct: number; route: string[] }
    | { ok: false; reason: string; raw?: string }
  >
  /** Builds, verifies, signs and broadcasts. Returns once submitted. */
  swap(
    mint: string,
    amountUsd: number,
  ): Promise<
    | { ok: true; signature: string; outAmountRaw: string; dryRun: boolean }
    | { ok: false; reason: string; raw?: string }
  >
  /** Waits for the cluster. Three outcomes, never two. */
  confirm(signature: string): Promise<
    { ok: true; status: "confirmed" | "unknown" } | { ok: false; reason: string }
  >
  track(event: string, payload?: Record<string, unknown>): void
}

/**
 * Raw base units to something a person reads.
 *
 * Deliberately imprecise: the exact base-unit count is true and unreadable, and
 * this line exists to be understood at a glance rather than reconciled against
 * a block explorer.
 */
function uiAmount(raw: string, decimals: number): string {
  const n = Number(raw) / 10 ** decimals
  if (!Number.isFinite(n)) return ""
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 6 })
}

// usdToRawOfHolding moved to helpers/tradeMath: the panel's trade sheet does
// the same arithmetic now, and two copies of money math is how "Max"
// oversells on one surface and not the other.

export function startSpotCard(
  asset: SpotAsset,
  api: SpotFlowApi,
  opts: {
    startCollapsed?: boolean
    /**
     * Move the card onto a DIFFERENT asset and open its trade panel.
     *
     * Supplied by attachSpotCard rather than imported, because attachSpotCard
     * already imports this file and reaching back would be a cycle. It is also
     * the right owner: whoever mounts the card is who can replace it.
     */
    switchTo?: (mint: string) => void
  } = {},
): SpotCardController {
  let card: SpotCardController
  /** A gate CTA was pressed; the next visibility return re-probes. */
  let gatePressed = false
  /** Whether THIS mount auto-opened, and whether the reader traded on it -
   *  together they decide if a collapse counts as fatigue (hostRest.ts). */
  const autoOpened = opts.startCollapsed === false
  let tradedHere = false
  /** Last list read from the server, kept because acting on a post needs
   *  fields the card does not carry (see onVote). */
  let known: Awaited<ReturnType<typeof fetchPagePosts>>["posts"] = []
  // Only the newest quote may write to the card: keystrokes outrun the network
  // and a late reply would overwrite a fresher one.
  let quoteSeq = 0

  /** Whose activity to ask for. Learned once, from fetchMe. */
  let myId: string | null = null


  const quote = async (amountUsd: number, mode: "buy" | "sell" = "buy") => {
    if (amountUsd <= 0) {
      card.setQuote("Enter an amount")
      return
    }
    const seq = ++quoteSeq

    if (mode === "sell") {
      // Sell quoting is indicative, priced off the last known unit price and
      // marked with ≈ — the REAL number is the build's own quote, which the
      // backend verifies and simulates before signing. An extra quote round
      // trip here would buy precision on a line the sell result immediately
      // replaces with the truth.
      if (!asset.balance || asset.usdPrice === null) {
        card.setQuote("Balance unknown — cannot sell", { error: true })
        return
      }
      const raw = usdToRawOfHolding(amountUsd, asset.balance, asset.usdPrice)
      if (raw === "0") {
        card.setQuote("Amount is below one base unit", { error: true })
        return
      }
      const tokens = (Number(raw) / 10 ** asset.decimals).toLocaleString("en-US", {
        maximumFractionDigits: 6,
      })
      card.setQuote(`Sell ${tokens} ${asset.symbol} ≈ $${amountUsd.toFixed(2)}`, {
        canConfirm: true,
      })
      return
    }

    // canConfirm goes true HERE, not when the quote lands. A preset tap is a
    // complete answer, and making the reader wait for a number most of them do
    // not read costs more than it protects — the build path re-quotes,
    // simulates and verifies before anything is signed.
    card.setQuote("Quoting…", { canConfirm: true })

    const r = await api.quote(asset.mint, amountUsd)
    if (seq !== quoteSeq) return

    if (!r.ok) {
      card.setQuote(r.reason, { error: true })
      return
    }
    // Amount is the answer; impact and route are context. Two lines, two
    // weights — the card renders `sub` small and muted under the bold amount.
    card.setQuote(
      `${qtyText(r.outAmount)} ${asset.symbol}`,
      {
        canConfirm: true,
        sub: `${r.priceImpactPct.toFixed(2)}% impact · ${r.route.join(" → ")}`,
      },
    )
  }

  const confirmSell = async (amountUsd: number) => {
    if (amountUsd <= 0) return
    if (!asset.balance || asset.usdPrice === null) return

    const raw = usdToRawOfHolding(amountUsd, asset.balance, asset.usdPrice)
    if (raw === "0") return
    const tokens = (Number(raw) / 10 ** asset.decimals).toLocaleString("en-US", {
      maximumFractionDigits: 6,
    })

    card.setQuote("Building…")
    api.track("swap_submitted", { amount_usd: amountUsd, mint: asset.mint, side: "sell" })

    const r = await api.sell(asset.mint, raw)
    if (!r.ok) {
      card.setOutcome(r.reason, "error")
      api.track("swap_failed", { reason: r.reason, ...rawOf(r), mint: asset.mint, side: "sell" })
      return
    }
    if (r.dryRun) {
      card.setOutcome("Dry run — built and verified, nothing sold", "pending")
      return
    }

    const usdcOut = (Number(r.outUsdcRaw) / 1e6).toFixed(2)
    const label = `Sold ${tokens} ${asset.symbol} for $${usdcOut}`
    card.setOutcome(label, "pending")

    const settled = await api.confirm(r.signature)
    if (!settled.ok) {
      card.setOutcome(settled.reason, "error")
      api.track("swap_failed", { reason: "chain_rejected", mint: asset.mint, side: "sell" })
      return
    }
    if (settled.status === "unknown") {
      card.setOutcome(`${label} · still confirming`, "pending")
      reconfirm(r.signature, () => {
        card.setOutcome(label, "done", {
          share: makeTradeShare("sold", tokens, r.signature, amountUsd),
        })
        refreshBalance()
      })
      return
    }
    card.setOutcome(label, "done", {
      share: makeTradeShare("sold", tokens, r.signature, amountUsd),
    })
    // Selling can empty the position, which is what takes Sell away again.
    refreshBalance()
    api.track("swap_confirmed", {
      amount_usd: amountUsd,
      signature: r.signature,
      mint: asset.mint,
      side: "sell",
    })
  }

  const confirm = async (amountUsd: number) => {
    if (amountUsd <= 0) return

    card.setQuote("Building…")
    api.track("swap_submitted", { amount_usd: amountUsd, mint: asset.mint })

    // Which pocket pays — the rulebook's one rule, fed with the freshest
    // book (warm /positions is ~200ms; the swap round-trip dwarfs it).
    await fetchBook().catch(() => null)

    const built = await api.swap(asset.mint, amountUsd)
    if (!built.ok) {
      card.setOutcome(built.reason, "error")
      api.track("swap_failed", { reason: built.reason, ...rawOf(built), mint: asset.mint })
      return
    }

    if (built.dryRun) {
      // Built and verified, deliberately not broadcast. Said plainly rather
      // than dressed as a purchase.
      card.setOutcome("Dry run · built and verified, nothing spent", "pending")
      return
    }

    // OPTIMISTIC. The transaction is submitted, so the outcome is shown now
    // rather than after the chain agrees — a second or two on "Broadcasting…"
    // is the difference between an action that felt done and one that felt
    // uncertain.
    //
    // NOT dressed as success. A signature means submitted, not settled, so the
    // pending state keeps the neutral surface until the chain says otherwise.
    const bought = uiAmount(built.outAmountRaw, asset.decimals)
    const label = `Bought ${bought} ${asset.symbol}`.trim()
    card.setOutcome(label, "pending")

    const settled = await api.confirm(built.signature)
    if (!settled.ok) {
      // The chain has a definite answer and it is no. Say so plainly: the
      // reader is looking at a line that a moment ago said they had bought
      // something.
      card.setOutcome(settled.reason, "error")
      api.track("swap_failed", { reason: "chain_rejected", mint: asset.mint })
      return
    }

    if (settled.status === "unknown") {
      // We stopped waiting; it may still land. Neither success nor failure,
      // and claiming either would be a guess about somebody else's money -
      // so the card keeps asking (see reconfirm) instead of going quiet.
      card.setOutcome(`${label} · still confirming`, "pending")
      reconfirm(built.signature, () => {
        card.setOutcome(label, "done", {
          share: makeTradeShare("bought", bought, built.signature, amountUsd),
        })
        refreshBalance()
      })
      return
    }

    card.setOutcome(label, "done", {
      share: makeTradeShare("bought", bought, built.signature, amountUsd),
    })
    // You own it now, so Sell has to exist now. Without this the card kept
    // the answer it fetched before the purchase and stayed buy-only.
    refreshBalance()
    api.track("swap_confirmed", {
      amount_usd: amountUsd,
      signature: built.signature,
      mint: asset.mint,
    })
  }

  /**
   * The flywheel door on a confirmed trade: one press creates the trade-post
   * (signature-carrying receipt) and opens X's composer with an attributed
   * link. Two behaviours, one gesture — because the moment right after a fill
   * is the only moment anyone shares anything.
   */
  /**
   * Re-read the holding after a fill, so the card catches up with what the
   * reader just did. Fire-and-forget and failure-silent: the trade already
   * happened, and a balance probe that could not answer is not a reason to
   * put an error on a successful purchase.
   */
  /**
   * "STILL CONFIRMING" RE-ASKS. The unknown branch used to be terminal on
   * both rails: no re-poll, no balance refresh, no share door if it
   * settled - the one reader guaranteed to be staring at the card was the
   * one it stopped working for. Three bounded asks; confirmed upgrades to
   * the full done outcome, failed to the honest error, and after the last
   * ask the balance refreshes anyway so the buttons stop lying about the
   * position.
   */
  const reconfirm = (
    signature: string,
    onDone: () => void,
  ) => {
    const askAt = [5000, 10000, 20000]
    const ask = (i: number) => {
      if (i >= askAt.length) {
        refreshBalance()
        return
      }
      setTimeout(() => {
        void api
          .confirm(signature)
          .then((settled) => {
            if (!settled.ok) {
              card.setOutcome(settled.reason, "error")
              return
            }
            if (settled.status === "unknown") {
              ask(i + 1)
              return
            }
            onDone()
          })
          .catch(() => ask(i + 1))
      }, askAt[i])
    }
    ask(0)
  }

  const refreshBalance = () => {
    const before = asset.balance?.raw ?? null
    void settledBalance(() => api.balance(asset.mint), before).then((b) => {
      if (b) card.setBalance(b)
    })
  }

  const makeTradeShare = (
    verb: "bought" | "sold",
    tokens: string,
    signature: string,
    usd: number,
  ) => {
    /**
     * THE SAME RECEIPT THE CHIP WRITES. This is the card's own writer, and
     * it kept the old sentence after the chip's was rewritten — so which
     * words a trade got depended on which surface it was made from, and a
     * reader saw two different products in one feed.
     *
     * What a reader of somebody else's trade wants is the SIZE OF THE BET
     * and the SIZE OF THE THING: "PANTS $953 at $60.9M market cap". The
     * quantity, the verb the tag above already carries, and the provenance
     * the card already announces all go. Market cap absent, the sentence
     * stops early rather than inventing one.
     */
    const text = receiptSentence({
      symbol: asset.symbol,
      side: verb === "bought" ? "buy" : "sell",
      usd,
      tokens: Number(tokens.replace(/,/g, "")) || 0,
      mcap: asset.mcap,
    })
    /** Set by onPoppin, read by onX. The X link points AT this post, which
     *  is the whole reason the two are ordered rather than parallel. */
    let postId: string | null = null

    return {
      onPoppin: async (): Promise<boolean> => {
        postId = await createTradePost(canonicalPageUrl(), text, {
          tokenSymbol: asset.symbol,
          tokenMint: asset.mint,
          tokenAmount: Number(tokens.replace(/,/g, "")) || 0,
          signature,
          tradeType: verb === "bought" ? "buy" : "sell",
        })
        api.track(postId ? "trade_post_created" : "trade_post_failed", {
          mint: asset.mint,
        })
        if (!postId) return false
        // Re-read before the card switches to the feed, so the view the
        // reader lands on already has their trade in it. Showing an empty
        // conversation one frame after "Shared ✓" is the exact "where did
        // it go" this button exists to answer.
        const { posts, hasMore } = await fetchPagePosts(canonicalPageUrl())
        known = posts
        // See the note on the composer's post: we just created a post, so an
        // empty read is a FAILED read, and forwarding it would land the
        // reader on "be the first to say something" one frame after sharing.
        if (posts.length > 0) card.setPosts(posts, hasMore)
        return true
      },
      onX: async (): Promise<boolean> => {
        if (!postId) return false
        const ok = await shareOnX(postId, text)
        api.track(ok ? "trade_shared_x" : "trade_share_x_failed", {
          mint: asset.mint,
        })
        return ok !== false
      },
    }
  }

  card = mountSpotCard(asset, {
    onExpand: () => {
      api.track("card_interacted", { action: "expand" })
      // Pulling the card open is the reader saying it is welcome here.
      void noteCardWanted(location.hostname)
    },
    onAmount: (usd, mode) => void quote(usd, mode),
    onConfirm: (usd, mode) => {
      api.track("card_interacted", { action: mode === "sell" ? "sell_click" : "buy_click" })
      tradedHere = true
      void noteCardWanted(location.hostname)
      if (mode === "sell") void confirmSell(usd)
      else void confirm(usd)
    },
    // × RETREATS, it does not end. This used to destroy() the card, which
    // took the host out of the DOM and left the page with no way back until
    // a reload — so one stray click cost the reader the feature entirely.
    // Closing something you can reopen is the only version of a close
    // button that is safe to press.
    onDismiss: () => {
      api.track("card_interacted", { action: "collapse" })
      // Collapsing a card that OPENED ITSELF, without trading, is fatigue:
      // enough of those and this host arrives as the tab (hostRest.ts).
      if (autoOpened && !tradedHere) void noteAutoOpenCollapsed(location.hostname)
      card.collapse()
    },
    onPosts: () => api.track("card_interacted", { action: "posts_open" }),
    /**
     * THREE DOORS, THREE DESTINATIONS. All of them used to land on
     * /profile — only one label matched its landing, and a door that says
     * conversation and delivers profile teaches the reader to distrust
     * every other door on the card. Each caller now names where its label
     * points; an unnamed press keeps the old landing.
     */
    onOpenPanel: (dest) => {
      api.track("card_interacted", { action: "open_panel", dest: dest ?? "profile" })
      if (dest === "feed") openFeedForPage(canonicalPageUrl())
      else if (dest === "home") openMyPanel()
      else openInPanel()
      // The panel is a full-height surface sliding in over the same page the
      // card is docked to; leaving the card behind puts two Poppin windows on
      // one screen, arguing for the same attention. Collapse, not dismiss —
      // the edge tab stays, so coming back is one press.
      card.collapse()
    },
    /**
     * The reader's book, mapped into the terms the card shows.
     *
     * ── THE PARTIAL-TOTAL RULE LIVES HERE ───────────────────────────────────
     * `/positions` returns a total profit summed over only the holdings whose
     * cost basis it knows, and per-holding that is exactly right: a position
     * bought before the ledger existed shows its VALUE and withholds the claim
     * about profit. But a TOTAL is read as a statement about everything on the
     * screen. If two of five holdings have no basis, "+$12.30" is a true
     * number forming a false sentence — and it is false in the flattering
     * direction, which is the one a money surface must never round toward.
     *
     * So the total survives only when every holding can answer. Otherwise it
     * is dropped and the per-row figures speak for themselves, which is the
     * same rule the backend already applies one level down.
     */
    /**
     * The same authenticated read onBook uses, asked a different question:
     * the raw u64 a sell is sized in and the basis a target is measured
     * from, neither of which survives onBook's display mapping.
     */
    onReader: async (mint: string) => {
      const book = await fetchBook()
      if (!book) return null
      const pos = book.positions.find((p) => p.mint === mint) ?? null
      return {
        cashUsd: book.cashUsd,
        uiAmount: pos?.uiAmount ?? 0,
        raw: pos?.raw ?? "0",
        // null = unknowable (predates the ledger). NEVER zero.
          entryMcapUsd: pos?.entryMcapUsd ?? null,
        avgEntryPriceUsd: pos?.avgEntryPriceUsd ?? null,
      }
    },

    /**
     * WHAT IS ALREADY STANDING. The card could place an order and then never
     * show it again — the one surface that could open a position it could
     * not see or close. The chip and the panel both list them; this is the
     * same list, on the same rails.
     */
    onListOrders: async () => {
      if (!api.listOrders) return []
      const all = await api.listOrders()
      return all.filter((o) => o.mint === asset.mint)
    },
    onCancelOrder: async (orderKey: string) => {
      await api.cancelOrder?.(orderKey)
    },

    onPlaceOrder: async (intent) => {
      if (!api.createOrder) return
      // One key per press, shared by both branches below.
      const press = pressKey()
      if (intent.kind === "limit-buy") {
        await api.createOrder({
          mint: asset.mint,
          side: "buy",
          amountUsd: intent.usd,
          triggerPriceUsd: intent.triggerPriceUsd,
          idempotencyKey: press,
        })
        return
      }
      if (intent.kind === "limit-sell") {
        await api.createOrder({
          mint: asset.mint,
          side: "sell",
          amountRaw: intent.amountRaw,
          triggerPriceUsd: intent.triggerPriceUsd,
          idempotencyKey: press,
        })
      }
      // Market intents never reach here: they are onConfirm's job, and the
      // card has one path for a trade that happens now.
    },

    onBook: async () => {
      const book = await fetchBook()
      return book ? mapBook(book) : null
    },
    /**
     * The persisted book, display-grade: /positions is 8.6s cold and the
     * background's watch keeps this cache under two minutes old, so the Me
     * view can paint instantly and let the live read correct it - the
     * exact pattern SpotPositions and ProfilePortfolio already ride. The
     * card was the one display surface still cold-fetching every open.
     */
    onBookCached: async () => {
      const cached = await readBookCache()
      return cached ? mapBook(cached) : null
    },
    /**
     * What this reader said, and what others did about it, in one list.
     *
     * Needs an id the card does not have and should not — see the note where
     * myId is set. Signed out means no id and no list, which is the same
     * silence as every other authenticated read on this surface.
     */
    onActivity: async () => (myId ? fetchActivity(myId) : null),
    /**
     * The alert bands and the read-mark — local storage, the flow's job
     * (the card is a view; views do not touch chrome.*). Same keys the
     * strip's Activity band and the background's alarm check share.
     */
    onListFired: async () => {
      try {
        const st = await chrome.storage.local.get(FIRED_ALERTS_KEY)
        const rows = st?.[FIRED_ALERTS_KEY]
        if (!Array.isArray(rows)) return []
        return [...(rows as FiredAlert[])]
          .reverse()
          .map((f) => ({
            id: f.id,
            symbol: f.symbol,
            targetUsd: f.targetUsd,
            direction: f.direction,
            atUsd: f.atUsd,
            firedAt: f.firedAt,
            read: f.read,
          }))
      } catch {
        return null
      }
    },
    onListFills: async () => {
      try {
        const st = await chrome.storage.local.get(PENDING_FILLS_KEY)
        const rows = st?.[PENDING_FILLS_KEY]
        if (!Array.isArray(rows)) return []
        return (rows as PendingFill[]).map((f) => ({
          orderKey: f.orderKey,
          mint: f.mint,
          symbol: f.symbol,
          side: f.side,
          triggerPriceUsd: f.triggerPriceUsd,
          at: f.at,
        }))
      } catch {
        return null
      }
    },
    onListAlerts: async () => {
      try {
        const st = await chrome.storage.local.get(PRICE_ALERTS_KEY)
        const rows = st?.[PRICE_ALERTS_KEY]
        if (!Array.isArray(rows)) return []
        return (rows as PriceAlert[]).map((a) => ({
          id: a.id,
          symbol: a.symbol,
          targetUsd: a.targetUsd,
          direction: a.direction,
        }))
      } catch {
        return null
      }
    },
    onSeries: (mint, range) => seriesAsset(mint, range),
    onMyTrades: (mint) => myTradesAsset(mint).then((r) => r.trades ?? []),
    /**
     * PARK AN ALERT FROM THE CHART'S BELL. The exact helper the strip's 🔔
     * uses — makeAlert builds it against the live market, addAlert dedupes
     * and caps, and the background watcher fires it. Best-effort: a bad
     * target or a duplicate resolves false and the bell says nothing landed.
     */
    onSaveAlert: async (targetUsd: number) => {
      try {
        const alert = makeAlert({
          mint: asset.mint,
          symbol: asset.symbol,
          targetUsd,
          marketUsd: asset.usdPrice,
          now: Date.now(),
        })
        if (!alert) return false
        const st = await chrome.storage.local.get(PRICE_ALERTS_KEY)
        const existing = Array.isArray(st?.[PRICE_ALERTS_KEY])
          ? (st[PRICE_ALERTS_KEY] as PriceAlert[])
          : []
        const { alerts, added } = addAlert(existing, alert)
        if (added) await chrome.storage.local.set({ [PRICE_ALERTS_KEY]: alerts })
        return added
      } catch {
        return false
      }
    },
    onRemoveAlert: async (id) => {
      try {
        const st = await chrome.storage.local.get(PRICE_ALERTS_KEY)
        const rows = st?.[PRICE_ALERTS_KEY]
        if (!Array.isArray(rows)) return true
        await chrome.storage.local.set({
          [PRICE_ALERTS_KEY]: rows.filter((a: { id?: string }) => a?.id !== id),
        })
        return true
      } catch {
        // A remove that failed leaves the alert standing — visible,
        // retryable — and the card only hides the row on true, so the
        // sentence stays true.
        return false
      }
    },
    onMarkFiredRead: async () => {
      try {
        const st = await chrome.storage.local.get(FIRED_ALERTS_KEY)
        const rows = st?.[FIRED_ALERTS_KEY]
        if (!Array.isArray(rows) || rows.every((f: { read?: boolean }) => f?.read))
          return
        await chrome.storage.local.set({
          [FIRED_ALERTS_KEY]: rows.map((f: FiredAlert) => ({ ...f, read: true })),
        })
      } catch {
        // Unread stays lit; the next open tries again.
      }
    },
    /**
     * Every standing order, every mint — the raw list the backend already
     * answers; the trade panel's own onListOrders keeps its per-asset
     * filter, this one is the whole book's.
     */
    onListAllOrders: async () => {
      try {
        const r = await listOrdersAsset("active")
        return (r?.orders ?? []).map((o) => ({
          orderKey: o.orderKey,
          side: o.side,
          symbol: o.symbol,
          amountUsd: o.amountUsd,
          amountUi: o.amountUi,
          triggerPriceUsd: o.triggerPriceUsd,
        }))
      } catch {
        return null
      }
    },
    onCancelAnyOrder: async (orderKey) => {
      api.track("card_interacted", { action: "order_cancel", orderKey })
      await cancelOrderAsset(orderKey)
    },
    /**
     * Tapped a row in the book. The card becomes that asset's card, panel open.
     *
     * Not inline Buy/Sell buttons in the row: the book is a screen for reading
     * what you have, and two money buttons per line turns it into a trading
     * terminal you have to be careful inside. One tap, one destination, and
     * the card you land on is the same card you would get on that asset's own
     * page — same head, same conversation, same panel.
     */
    onTradeHolding: (mint) => {
      api.track("card_interacted", { action: "holding_open", mint })
      opts.switchTo?.(mint)
    },
    onPost: async (text) => {
      const outcome = await createPagePost(canonicalPageUrl(), text)
      const ok = outcome.kind === "ok"
      api.track(ok ? "post_created" : "post_failed", {
        url: canonicalPageUrl(),
        ...(ok ? {} : { reason: outcome.kind }),
      })
      if (ok) {
        // Re-read rather than splice the new post in locally: the server
        // decides what the conversation is, and a card that shows a post the
        // backend rejected is lying in the most embarrassing way available.
        const { posts, hasMore } = await fetchPagePosts(canonicalPageUrl())
        known = posts
        // ONLY WHEN THE SERVER ACTUALLY ANSWERED. An empty list here is not
        // "the conversation is empty" — the post we just made was accepted,
        // so an empty read means the READ failed, and pushing it through
        // wiped the card's optimistic copy of the reader's own sentence.
        // The visible symptom was posting successfully and landing on "Be
        // the first to say something here", which is the single most
        // demoralising thing this surface could say to somebody who just
        // said something. Same guard the mount-time fetch already uses.
        if (posts.length > 0) card.setPosts(posts, hasMore)
        // Announce it, like the panel's composer does. Until now only PANEL
        // posts triggered the in-page toast, and own-posts were suppressed
        // while the panel was open — which between them meant a person
        // testing alone could NEVER see the toast at all. The freshest row
        // is the post that just landed, so it carries the real author name.
        const mine = posts[0]
        if (mine) {
          try {
            chrome.runtime.sendMessage({
              type: "PAGE_POST_CREATED",
              payload: { text: mine.text, name: mine.author, uid: mine.authorId, own: true },
            })
          } catch {}
        }
      }
      return outcome
    },
    onOpenThread: (postId) => fetchReplies(postId),
    onAuthor: (userId) => {
      api.track("card_interacted", { action: "author_open", user_id: userId })
      openProfile(userId)
    },
    /**
     * TAKE THE SAME TRADE. The receipt in the feed carries a real mint now,
     * so a reader who likes what somebody did is one tap from doing it.
     *
     * Two destinations, one rule: this page's own asset opens the trade
     * panel already here; anything else uses switchTo, the same move the
     * holdings row makes — the card becomes that asset and expands. Sending
     * them to the side panel instead would be right too, but it would ask
     * somebody who is reading a conversation to leave it.
     */
    /**
     * The star, on somebody else's page. Same storage the panel's star and
     * the background's move-watch read, so starring here and silencing
     * there are one list. The card cannot read storage itself (it is a
     * view); the flow owns the toggle and pushes the new truth back.
     */
    onToggleWatch: () => {
      void (async () => {
        try {
          const stored = await chrome.storage.local.get(WATCHLIST_KEY)
          const list: WatchedAsset[] = stored?.[WATCHLIST_KEY] ?? []
          const next = toggleWatch(
            list,
            { mint: asset.mint, symbol: asset.symbol ?? null },
            Date.now(),
          )
          await chrome.storage.local.set({ [WATCHLIST_KEY]: next })
          card.setWatched(isWatched(next, asset.mint))
          api.track("card_interacted", {
            action: isWatched(next, asset.mint) ? "watch_on" : "watch_off",
            mint: asset.mint,
          })
        } catch {
          // Storage said no; the star simply stays as it was.
        }
      })()
    },
    onCopyTrade: (mint, symbol) => {
      api.track("card_interacted", { action: "copy_trade", mint, symbol })
      if (mint === asset.mint) card.expand()
      else opts.switchTo?.(mint)
    },
    onGate: (gate) => {
      api.track("card_interacted", { action: `gate_${gate}` })
      gatePressed = true
      if (gate === "signin") openSignIn()
      else openTopUp()
    },
    onReply: async (postId, text) => {
      const outcome = await createReply(postId, text)
      api.track(outcome.kind === "ok" ? "reply_created" : "reply_failed", {
        post_id: postId,
        ...(outcome.kind === "ok" ? {} : { reason: outcome.kind }),
      })
      return outcome
    },
    onVote: async (postId, currentlyUpvoted) => {
      // The author id lives with the data, not with the view — the flow holds
      // the last fetched list and looks it up here.
      const target = known.find((p) => p.id === postId)
      if (!target) return false
      const ok = await togglePostVote({ ...target, upvoted: currentlyUpvoted })
      if (ok) {
        // Re-read rather than flip locally: the server owns the count, and a
        // card showing a vote the backend rejected is lying about a number.
        const { posts, hasMore } = await fetchPagePosts(canonicalPageUrl())
        known = posts
        card.setPosts(posts, hasMore)
      }
      return ok
    },
  }, { startCollapsed: opts.startCollapsed })

  // The conversation loads AFTER the card is up, and never blocks it. A page
  // with a tradeable asset and an unreachable feed is still a working trade
  // card; the posts row simply does not appear.
  void fetchPagePosts(canonicalPageUrl()).then(({ posts, hasMore }) => {
    known = posts
    if (posts.length > 0) card.setPosts(posts, hasMore)
  })

  // Presence rides the same after-mount, never-blocking rule as posts. The
  // count is the /ticks page-room size: browsers with a live card here,
  // fed by the same watch lifecycle that subscribes this card's price.
  void fetchPresence(location.hostname).then((n) => {
    if (n !== null) card.setPresence(n)
  })

  // Unread count. It used to add a BACKEND half — the social inbox's
  // follow/reply/mention rows — to the fired-alert half, on a badge whose
  // press opened that inbox. The inbox closed on 2026-09-20 (no money event
  // could ever land in it), so what is left is the half a reader can act
  // on: an alert that fired on a tab they had already closed. One source,
  // updated live, because the background writes fired news whenever its
  // alarm ticks.
  let unreadAlerts = 0
  const paintUnread = () => card.setUnread(unreadAlerts)
  void chrome.storage?.local
    ?.get(FIRED_ALERTS_KEY)
    .then((st) => {
      unreadAlerts = unreadFired(st?.[FIRED_ALERTS_KEY])
      if (unreadAlerts > 0) paintUnread()
    })
    .catch(() => {})
  // Spliced into destroy() like unwatchPrice is in attachSpotCard, and for
  // the same reason: startSpotCard runs again on every card switch, and a
  // listener on the GLOBAL storage event that nobody removes would keep
  // painting unread counts into destroyed controllers forever — one leaked
  // closure per holding the reader ever tapped through.
  const onFiredChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local" || !changes[FIRED_ALERTS_KEY]) return
    unreadAlerts = unreadFired(changes[FIRED_ALERTS_KEY].newValue)
    paintUnread()
  }
  try {
    chrome.storage.onChanged.addListener(onFiredChange)
    const bareDestroy = card.destroy.bind(card)
    card.destroy = () => {
      try {
        chrome.storage.onChanged.removeListener(onFiredChange)
      } catch {
        // Removing from a torn-down extension context cannot matter.
      }
      bareDestroy()
    }
  } catch {
    // No live updates — the mount-time read still counted what was there.
  }

  // ONBOARDING_V2's ladder: what stands between this reader and a trade.
  // Same after-mount, never-blocking rule; an unreadable answer (null) means
  // the ladder stands aside and the card behaves exactly as before — which is
  // also, byte for byte, the flag-off behaviour.
  if (ONBOARDING_V2) {
    const probeGate = () => {
      void fetchSpendingPower().then((p) => {
        if (!p) return
        if (!p.signedIn) card.setGate("signin")
        else if (p.usd <= 0) card.setGate("topup")
        // Funded: the wall comes DOWN. The first version only ever raised
        // gates, which was fine at mount and wrong on re-probe: a reader
        // who signed in or topped up came back to the same wall.
        else card.setGate(null)
        // The same probe already knows the balance; the identity row shows it.
        if (p.signedIn) card.setCash(p.usd)
      })
    }
    probeGate()
    /**
     * THE LADDER NOTICES WHEN THE READER OBEYS IT. The probe used to run
     * once at mount ("the card does not poll"), so a reader who pressed
     * "Sign in to trade", signed in on the welcome tab and came back
     * still faced the same gate until a full reload — the ladder
     * punishing exactly the reader who did what it asked. Still not
     * polling: one extra probe, only when the tab regains visibility AND
     * a gate CTA was actually pressed. The moment of return IS the
     * moment of intent.
     */
    const onReturn = () => {
      if (document.visibilityState !== "visible" || !gatePressed) return
      gatePressed = false
      probeGate()
    }
    document.addEventListener("visibilitychange", onReturn)
    const gateDestroy = card.destroy.bind(card)
    card.destroy = () => {
      document.removeEventListener("visibilitychange", onReturn)
      gateDestroy()
    }
  }

  // Who is reading. One light call; null (signed out, failed) renders nothing.
  void fetchMe().then((m) => {
    if (m) {
      // The CARD never learns this id. It asks for "my activity" and the
      // flow knows whose. A view type carrying a user id starts shaping
      // the card around the request instead of the reader — the same
      // argument that kept authorId off it until authorId became a
      // destination rather than plumbing.
      myId = m.id
      card.setMe(m)
    }
  })

  // Whether this asset is already starred. Read once at mount; the toggle
  // handler pushes every later change. Failure leaves null, and null draws
  // no star at all — a star that guesses is a star that lies.
  void chrome.storage?.local
    ?.get(WATCHLIST_KEY)
    .then((st) => {
      const list: WatchedAsset[] = st?.[WATCHLIST_KEY] ?? []
      card.setWatched(isWatched(list, asset.mint))
    })
    .catch(() => {})

  api.track("card_shown", {
    asset: asset.symbol,
    mint: asset.mint,
    category: asset.category,
    price_usd: asset.usdPrice,
    holds_balance: (asset.balance?.uiAmount ?? 0) > 0,
  })

  return card
}


/** One book shape for the card, whatever road the rows arrived by. */
function mapBook(book: SpotPositionsResponse) {
  const holdings = book.positions.map((p) => ({
    mint: p.mint,
    ticker: p.ticker,
    displayName: p.displayName,
    uiAmount: p.uiAmount,
    valueUsd: p.valueUsd,
    change24hPct: p.change24hPct,
    pnlUsd: p.pnlUsd,
  }))
  const whole = holdings.every((h) => h.pnlUsd !== null)
  const invested = book.positions.reduce((s, p) => s + (p.netInvestedUsd ?? 0), 0)
  return {
    holdings,
    totalUsd: book.totalUsd,
    totalPnlUsd: whole ? book.totalPnlUsd : null,
    // Only meaningful alongside a whole-book profit, and only as a
    // divisor: a percentage off a zero basis is not a small number, it
    // is not a number.
    totalInvestedUsd: whole && invested > 0 ? invested : null,
    cashUsd: book.cashUsd,
  }
}

/** The server's own words, for the telemetry row only, when the sentence on
 *  screen replaced them (helpers/refusalCopy). */
function rawOf(r: { reason: string; raw?: string }): { raw?: string } {
  return r.raw && r.raw !== r.reason ? { raw: r.raw.slice(0, 200) } : {}
}
