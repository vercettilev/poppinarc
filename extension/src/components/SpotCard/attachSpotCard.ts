import {
  balanceAsset,
  confirmAsset,
  assetByMint,
  matchAsset,
  cancelOrderAsset,
  createOrderAsset,
  listOrdersAsset,
  quoteAsset,
  sellAsset,
  swapAsset,
  type AssetPageSignals,
  type MatchedAsset,
} from "~/services/SpotAssetService"
import { startSpotCard } from "./spotCardFlow"
import { hostPrefersTab } from "./hostRest"

/**
 * TEST-BUILD DIAGNOSTICS. Inlined to a literal `false` in store builds, so
 * every branch below is dead code there; in POPPIN_TEST_BUILD builds it names
 * the exact point this function stopped, because "the card did not appear" has
 * at least six causes that are indistinguishable from silence.
 * console.info on purpose — the production esbuild pass strips log/debug/warn.
 */
const SPOT_DEBUG = process.env.POPPIN_TEST_BUILD === "true"
const dbg = (...a: unknown[]) => {
  if (SPOT_DEBUG) console.info("[poppin-spot]", ...a)
}
import type { SpotCardController } from "./mount"
import type { SpotAsset } from "./SpotCard"
import { messageOf } from "~/helpers/refusalCopy"
import { reasonOf } from "~/helpers/tradeMath"

/**
 * Live price ticks ride the background's chat socket — the same connection
 * every signed-in extension already holds, not a second one (see
 * PriceTickService on the backend). This is why the calls are fire-and-forget
 * with no return value to check: a signed-out visitor's message reaches a
 * background with no socket to act on it, and that is the whole degrade —
 * their price stays the match-time snapshot, same as it always has.
 */
export const watchPrice = (mint: string) => {
  // The hostname rides along for page presence: the same lifecycle that says
  // "a card is alive here" is what the "N online" count now counts. Sent from
  // the page rather than derived from sender.tab in the background, so the
  // count does not depend on which permissions a given build was granted.
  void chrome.runtime
    .sendMessage({ type: "POPPIN_WATCH_PRICE", mint, host: location.hostname })
    .catch(() => {})
}
const unwatchPrice = (mint: string) => {
  void chrome.runtime
    .sendMessage({ type: "POPPIN_UNWATCH_PRICE", mint, host: location.hostname })
    .catch(() => {})
}

/**
 * Decides whether THIS page gets a card, and mounts one if so.
 *
 * Runs once per page, from the content script. Everything about when a card
 * appears is here; the card itself has no opinion about it.
 *
 * ── WHEN NOTHING RENDERS, WHICH IS ALMOST ALWAYS ────────────────────────────
 * Silence is the default state and the most important behaviour in the
 * product. This returns without mounting when:
 *
 *   - the page is not http(s)      chrome://, file://, extension pages
 *   - the page has too little text to judge (a shell, an app frame)
 *   - the backend says `{ asset: null }` — no catalog asset matches
 *   - the backend is unwell, 503s, or the surface is switched off
 *
 * The last one is deliberate and worth stating: a failure and a genuine
 * no-match render identically. A reader cannot tell them apart and should not
 * have to — an error toast on a page that was never going to show a card is
 * pure noise.
 */

const MIN_TEXT = 400

/** Harvested here, not sent whole: only these fields cross to the backend. */
/** Exported for the panel's Trades tab, which needs the same page reading. */
export function harvest(): AssetPageSignals | null {
  if (!/^https?:$/.test(location.protocol)) {
    dbg("bail: protocol is", location.protocol, "— card only runs on http(s)")
    return null
  }

  const body = document.body?.innerText ?? ""
  if (body.trim().length < MIN_TEXT) {
    dbg("bail: page text", body.trim().length, "chars < ", MIN_TEXT)
    return null
  }

  const h1 = document.querySelector("h1")
  const meta = document.querySelector('meta[name="description"]')

  return {
    url: location.href,
    pathname: location.pathname,
    title: document.title,
    h1: (h1 as HTMLElement | null)?.innerText?.slice(0, 300) ?? "",
    metaDescription: meta?.getAttribute("content")?.slice(0, 500) ?? "",
    // Capped. §14: never ship the whole DOM — and the matcher scores keywords,
    // so more text past this point buys nothing but bandwidth.
    bodyExcerpt: body.slice(0, 20_000),
  }
}

/**
 * Wait until the page has something worth reading — then go, immediately.
 *
 * This replaces a flat 1500ms setTimeout in the content script. Together
 * with moving injection off the `load` event (see the onUpdated listener in
 * background/main.ts), it is the whole of the card's latency fix: measured
 * on CoinGecko, the old path did not START until 3915ms, then waited 1500ms
 * more, then spent 461ms on the network.
 *
 * The old delay existed for a real reason and that reason is kept: a heavy
 * or SPA page can look loaded while <main> is still being injected, and
 * scraping then yields almost no keywords and no match. But the thing it was
 * actually waiting for is exactly what harvest() already tests — enough text
 * to judge — so testing the condition directly is both faster and more
 * honest than guessing at a duration.
 *
 * TWO CONDITIONS, NOT ONE. Text alone is not enough now that injection
 * happens at navigation commit rather than after load: at 150ms an app shell
 * can already carry 400 characters of nav and footer while its real content
 * is empty, and matching a page's chrome is how you show a card for the
 * wrong asset. `readyState !== "loading"` means the parser is done with the
 * document it was given, so the two together mean "parsed AND has content"
 * rather than "caught mid-parse with a menu in view".
 *
 * ...WITH A FAST PATH, because waiting for the full parse is the single
 * biggest remaining cost on a server-rendered page. HTML streams: CoinGecko's
 * article text is in the document long before the parser reaches the end of
 * it, and holding the match until domInteractive spent about half a second
 * staring at text we already had.
 *
 * The fast path asks for two things a nav shell does not have together: a
 * lot of text, and a headline. A mega-menu can reach a few hundred
 * characters; it does not reach ABUNDANT_TEXT and also carry an <h1>. A page
 * with neither simply waits for the parse, which is the old behaviour.
 *
 * The ceiling is long and that is deliberate. It is not a deadline for the
 * card, it is the point where we stop asking — and on a page that never
 * renders text the answer was always going to be no card. Resolving early
 * costs a missed match; waiting costs nothing, because the moment text
 * appears this fires.
 *
 * Cost: one innerText read per tick, which forces layout. That is why this
 * polls rather than watching the DOM — a subtree MutationObserver is what
 * made this extension unusable on dynamic sites before (see the note in
 * contentScript/primary/main.tsx). A page that renders normally is a handful
 * of reads; one that never does is reading an almost-empty body.
 */
const READY_FIRST_CHECK_MS = 100
const READY_POLL_MS = 120
const READY_CEILING_MS = 8000
/** Enough streamed text that this cannot be a navigation menu. */
const ABUNDANT_TEXT = MIN_TEXT * 5

function whenPageIsReadable(): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const check = () => {
      const parsed = document.readyState !== "loading"
      const chars = document.body?.innerText?.trim().length ?? 0
      const waited = Date.now() - t0
      const streamedEnough =
        chars >= ABUNDANT_TEXT && document.querySelector("h1") !== null
      if (streamedEnough || (parsed && chars >= MIN_TEXT)) {
        dbg(
          `page readable after ${waited}ms (${chars} chars,`,
          streamedEnough && !parsed ? "fast path, still parsing)" : "parsed)",
        )
        resolve()
        return
      }
      if (waited >= READY_CEILING_MS) {
        // Out of patience, not out of hope: harvest() gets its own say
        // below, and a page still this empty simply has no card.
        dbg(`readable-wait hit the ${READY_CEILING_MS}ms ceiling at ${chars} chars`)
        resolve()
        return
      }
      setTimeout(check, READY_POLL_MS)
    }
    setTimeout(check, READY_FIRST_CHECK_MS)
  })
}

/**
 * Does this reader get the CARD, or just the tab?
 *
 * The push-versus-pull argument has a right answer on each side. Pull is
 * right about the product: a trade panel that opens itself on somebody
 * else's page is the shape a store reviewer reads as adware, and it is what
 * collided with CoinMarketCap's own sidebar. Push is right about the
 * business: Poppin's whole value is the moment you learn you can trade the
 * thing you were already reading about, and an edge tab nobody has learned
 * yet is an edge tab nobody opens.
 *
 * THE ANSWER IS "WHEN WE ARE ACTUALLY RIGHT", and the backend now says so
 * outright. `certainty: "exact"` means the page's identity was READ — a
 * venue's dedicated URL for the asset, or the page printing its own mint —
 * rather than inferred from its prose. Interrupting a reader on a page that
 * IS the asset is a service; interrupting them on a news story that mentions
 * it is the thing everybody hates.
 *
 * THIS REPLACED A COUNTER, and the counter deserved to go. It opened the
 * card on the first three visits to each hostname, which is to say it
 * treated a perfect match on a dedicated coin page exactly like a marginal
 * one on an article, and promised to interrupt three times whether or not we
 * had earned it. A threshold on `score` would have been no better: the score
 * is an unbounded weighted sum, so any cut-off would have been a number
 * nobody could defend.
 *
 * An older backend sends no `certainty` at all, which reads as inferred —
 * the quiet behaviour, which is the right way to fail.
 */
function shouldAutoOpen(matched: MatchedAsset): boolean {
  return matched.certainty === "exact"
}

export async function attachSpotCard(): Promise<SpotCardController | null> {
  dbg("attachSpotCard fired on", location.href)

  /**
   * WAKE THE SERVICE WORKER WHILE WE WAIT FOR THE PAGE.
   *
   * Measured on Yahoo's TSLA page: the backend answers /embed/asset/match in
   * about 380ms to a plain curl, and 1192ms through the bridge. The gap is not
   * the network and not the auth wait — that route is already on
   * PUBLIC_ROUTES and skips whenAuthSettled. It is MV3 killing the service
   * worker after 30s idle: the first message has to wake it and re-parse the
   * bundle before any fetch starts.
   *
   * That cost was paid AFTER the readable wait, in series with it. It does not
   * have to be. This costs nothing and overlaps the wake with the 866ms we
   * were already spending watching text arrive.
   *
   * The rejection is EXPECTED and is the whole mechanism: nothing listens for
   * this type, so the port closes unanswered — but the worker started anyway,
   * which is the only thing being asked for. A handler would make it look like
   * a protocol; it is a doorbell.
   */
  void chrome.runtime.sendMessage({ type: "POPPIN_WAKE" }).catch(() => {})

  await whenPageIsReadable()
  const signals = harvest()
  if (!signals) return null

  let matched
  const t0 = Date.now()
  dbg("calling /embed/asset/match…")
  try {
    matched = (await matchAsset(signals)).asset
  } catch (e) {
    dbg(`bail: matchAsset THREW after ${Date.now() - t0}ms —`, e)
    return null
  }
  dbg(`/match answered in ${Date.now() - t0}ms:`, matched ? `${matched.symbol} score=${matched.score}` : "no asset")
  if (!matched) return null

  // Decimals come from the backend, which reads them from Jupiter. If it could
  // not, there is no card: the only thing decimals are used for is rendering
  // the bought amount, and a guessed value misprints it by orders of magnitude
  // — silently, and in the one place a reader is checking what they got.
  // Showing nothing beats showing a confidently wrong number.
  if (matched.decimals === null) {
    dbg("bail: decimals is null — backend could not reach Jupiter")
    return null
  }

  return startCardForMatch(matched)
}


/**
 * Whoever is holding the card's controller wants to know when it is REPLACED.
 *
 * main.tsx keeps `spotController` to route price ticks and answer the panel's
 * asset query. When a Holdings row swaps the card onto a different asset, that
 * reference would otherwise point at a destroyed controller — ticks for the
 * new mint would land nowhere and the panel would be told the card is showing
 * something it is not. Silent, and invisible until someone wonders why the
 * price stopped moving.
 */
let onReplaced: ((c: SpotCardController) => void) | null = null
export function onCardReplaced(cb: (c: SpotCardController) => void): void {
  onReplaced = cb
}

/**
 * Move the card onto another asset and open its panel.
 *
 * Order matters: the old card is destroyed BEFORE the new one mounts, or the
 * page briefly carries two. Destroy also unwatches the old mint's price — see
 * the note on controller.destroy below, which is why that cannot be forgotten
 * here.
 */
async function switchCardTo(mint: string, current: SpotCardController): Promise<void> {
  let matched: MatchedAsset | null = null
  try {
    matched = (await assetByMint(mint)).asset
  } catch {
    matched = null
  }
  // Nothing to switch to and nothing to say about it: the row stays where it
  // is and the reader keeps the card they had, which is a better outcome than
  // a destroyed card and an error.
  if (!matched || matched.decimals === null) {
    dbg("switch refused for", mint, matched ? "no decimals" : "not in catalog")
    return
  }
  /**
   * NO GAP BETWEEN THE TWO CARDS.
   *
   * startCardForMatch awaits the reader's balance and the host's rest
   * memory before it mounts anything, and this used to destroy the old card
   * first - so tapping a holding cleared the screen, left a blank hole for
   * as long as those two took, and then played a full arrival animation as
   * if the card had come from nowhere. The reader asked to CHANGE assets,
   * not to lose the card and be handed a new one.
   *
   * Both answers are warmed while the old card is still on screen; the
   * destroy then sits directly against the mount.
   */
  const [balance, prefersTab] = await Promise.all([
    balanceAsset(matched.mint)
      .then((b) => ({ uiAmount: b.uiAmount, raw: b.raw }))
      .catch(() => null),
    hostPrefersTab(location.hostname).catch(() => false),
  ])
  current.destroy()
  const next = await startCardForMatch(matched, { balance, prefersTab })
  if (!next) return
  onReplaced?.(next)
  next.expand()
}

/**
 * Mount the card for an asset we have already matched.
 *
 * Split out of attachSpotCard so the panel's Trades tab can ask for a card on
 * a RUNNER-UP — the page's shortlist has several assets and the card only
 * ever held the winner, which made every non-winning row in that list a
 * button that appeared to do nothing. The panel sends the row it was tapped
 * on; this mounts that one.
 */
export async function startCardForMatch(
  matched: MatchedAsset,
  /**
   * Answers a caller ALREADY HAS, so the mount does not go to the network
   * for them again. switchCardTo fetches both while the old card is still
   * on screen: without this the destroy sat in front of two round trips and
   * the page carried a blank hole between the two cards. Omitted, both are
   * fetched here as before.
   */
  prefetched?: {
    balance: { uiAmount: number; raw: string } | null
    prefersTab: boolean
  },
): Promise<SpotCardController | null> {
  if (matched.decimals === null) return null

  // The reader's balance decides whether Sell exists at all. Authenticated;
  // a signed-out reader's request 401s and the catch answers null.
  let balance: { uiAmount: number; raw: string } | null = null
  if (prefetched) {
    balance = prefetched.balance
  } else {
    try {
      const b = await balanceAsset(matched.mint)
      balance = { uiAmount: b.uiAmount, raw: b.raw }
    } catch {
      balance = null
    }
  }

  const asset: SpotAsset = {
    mint: matched.mint,
    symbol: matched.symbol,
    name: matched.name,
    displayName: matched.displayName || matched.name,
    decimals: matched.decimals,
    usdPrice: matched.indicativeUsd,
    change24hPct: matched.change24hPct ?? null,
    icon: matched.icon ?? null,
    mcap: matched.mcap ?? null,
    holderCount: matched.holderCount ?? null,
    spark24h: matched.spark24h ?? null,
    // Curated rows are the catalog's tokenized equities; anything the thematic
    // matcher found without a catalog row went through the open-mint gate.
    category: matched.issuer ? "equity" : "token",
    issuer: matched.issuer,
    restrictions: matched.restrictions,
    balance,
  }

  /**
   * Certainty says we are right about the PAGE; the per-host memory says
   * whether this reader still wants the interruption (see hostRest.ts).
   * Both must agree for the card to open itself.
   */
  const collapsed =
    !shouldAutoOpen(matched) ||
    (prefetched ? prefetched.prefersTab : await hostPrefersTab(location.hostname))
  dbg(
    "mounting card for",
    asset.symbol,
    `certainty=${matched.certainty ?? "inferred"}`,
    collapsed ? "→ tab" : "→ open",
  )
  const controller = startSpotCard(asset, {
    /**
     * The order rail. Without this the card's Limit tab composes a perfectly
     * valid order and then does nothing at all, because the flow's
     * `onPlaceOrder` has nothing to call — the exact silent dead end an
     * optional dependency invites.
     */
    createOrder: (dto) => createOrderAsset(dto),
    listOrders: () => listOrdersAsset("active").then((r) => r.orders),
    cancelOrder: (orderKey) => cancelOrderAsset(orderKey),
    quote: async (mint, amountUsd) => {
      try {
        const q = await quoteAsset(mint, amountUsd)
        return {
          ok: true as const,
          outAmount: q.outAmount,
          priceImpactPct: q.priceImpactPct,
          route: q.route,
        }
      } catch (e) {
        return { ok: false as const, reason: reasonOf(e, "Quote unavailable") }
      }
    },
    sell: async (mint, amountRaw) => {
      try {
        const r = await sellAsset(mint, amountRaw)
        return {
          ok: true as const,
          signature: r.signature,
          outUsdcRaw: r.outUsdcRaw,
          dryRun: r.dryRun,
        }
      } catch (e) {
        return { ok: false as const, reason: reasonOf(e, "That sell didn't go through. Try again."), raw: messageOf(e) }
      }
    },
    swap: async (mint, amountUsd) => {
      try {
        const r = await swapAsset(mint, amountUsd)
        return {
          ok: true as const,
          signature: r.signature,
          outAmountRaw: r.outAmountRaw,
          dryRun: r.dryRun,
        }
      } catch (e) {
        return { ok: false as const, reason: reasonOf(e, "That buy didn't go through. Try again."), raw: messageOf(e) }
      }
    },
    confirm: async (signature) => {
      try {
        const r = await confirmAsset(signature)
        if (r.status === "failed") {
          return {
            ok: false as const,
            reason: "The transaction failed on chain",
          }
        }
        return { ok: true as const, status: r.status }
      } catch {
        // We could not ask. That is not the same as a failure — the
        // transaction may well have landed — so it reports as still
        // confirming rather than claiming an outcome we do not have.
        return { ok: true as const, status: "unknown" as const }
      }
    },
    balance: async (mint) => {
      try {
        const b = await balanceAsset(mint)
        return { uiAmount: b.uiAmount, raw: b.raw }
      } catch {
        return null
      }
    },
    track: (event, payload) => {
      void chrome.runtime
        .sendMessage({ type: "SPOT_TELEMETRY", event, payload })
        .catch(() => {})
    },
  }, {
    startCollapsed: collapsed,
    switchTo: (mint) => void switchCardTo(mint, controller),
  })

  watchPrice(asset.mint)
  // Unwatch is spliced into destroy() rather than left to whoever calls it —
  // spotCardFlow's onDismiss already calls destroy(), and a runner-up
  // replacing this card (startCardForMatch again) does too. Either way, the
  // one guaranteed moment a mint stops mattering to THIS controller is when
  // this fires, so it is the one place unwatch cannot be forgotten from.
  const destroy = controller.destroy.bind(controller)
  controller.destroy = () => {
    unwatchPrice(asset.mint)
    destroy()
  }

  return controller
}
