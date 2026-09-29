import type { TopUpContext } from "~/helpers/topUpIntent"
import { topUpAmount } from "~/helpers/topUpAmount"
import { FIRST_TRADE_KEY } from "~/helpers/invite"
import { ensureBrandFont } from "~/helpers/brandFont"
import { sweepOrphanRoots, watchForStrangers } from "~/helpers/orphanSweep"
import { PAGE_CARD_ENABLED } from "~/config/features"
import { ARC_EDITION, CAP } from "~/config/edition"
import { compactUsd } from "~/helpers/tradeCard"
import { CLIP_KEY, DEFAULT_CLIP, readClip } from "~/helpers/clip"
import { CHART_VIEW_KEY } from "~/helpers/chartView"
import { useEnvironmentStore } from "~/store/useAppConfigStore"
import "../../enableDevHmr"

sweepOrphanRoots()
watchForStrangers()
import {
  attachSpotCard,
  harvest,
  onCardReplaced,
  startCardForMatch,
  watchPrice,
} from "~/components/SpotCard/attachSpotCard"
import {
  assetByMint,
  candidatesForPage,
  confirmAsset,
  quoteAsset,
  swapAsset,
  cancelOrderAsset,
  positionsAsset,
  listOrdersAsset,
  byTickerAsset,
  myTradesAsset,
  sellAsset,
  seriesAsset,
  xStripConfig,
  createOrderAsset,
  tweetProof,
  callersBoard,
  myRank as myRankAsset,
  midPrices,
  syncAlerts,
  removeAlertRemote,
  referralStats,
  poolStatus,
} from "~/services/SpotAssetService"
import {
  openAssetInPanel,
  openMyPanel,
  openFeedInPanel,
  openPanelRoom,
  openSignIn,
  openTopUp,
  topUpFromPage,
  convertFromPage,
} from "~/components/SpotCard/pagePosts"
import { notificationKind, notificationVerb } from "~/helpers/notificationText"
import { addAlert, FIRED_ALERTS_KEY, PRICE_ALERTS_KEY, type PriceAlert, unreadFired } from "~/helpers/priceAlerts"
import { extensionAlive } from "~/helpers/extensionContext"
import {
  markFillsRead,
  ORDER_ORIGINS_KEY,
  PENDING_FILLS_KEY,
  rememberOrigin,
  unreadFills,
  type PendingFill,
} from "~/helpers/orderFillWatch"
import { initXStrip, type XStripController } from "../x/xStrip"
import { readBookCache } from "~/helpers/bookCache"
import { fetchPagePosts } from "~/components/SpotCard/pagePosts"
import { canonicalPageUrl } from "~/helpers/pageUrl"
import { startSitePresenceHeartbeat } from "~/helpers/presence"
import { siteChatHostFromUrl } from "~/helpers/siteChatHost"
import { WebsitePostService } from "~/services/WebsitePostService"
import { receiptSentence } from "~/helpers/tradeReceipt"

/**
 * WHERE A TRADE MADE ON X IS FILED.
 *
 * The FEED's address, not the tweet's. A tweet scrolls away in an hour
 * and a conversation pinned to one is a conversation nobody returns to;
 * x.com/home is the room everybody is standing in. The tweet itself is
 * still remembered where it counts — spot_trades.source_url, which is
 * what caller credit is paid from and which no feed post can edit.
 */
const X_FEED_URL = "https://x.com/home"
import { installSigninRelay } from "~/helpers/signinRelay"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import {
  cancelOrderWithPageWallet,
  connectWalletOnPage,
  orderWithPageWallet,
  tradeWithPageWallet,
} from "~/helpers/externalTrade"

/**
 * WHOSE WALLET THIS ACCOUNT TRADES FROM, asked of /users/me and remembered
 * for a minute. The answer changes only at sign-in, and a fresh account
 * lands with the flag already set.
 */
let tradingWalletMemo: { at: number; value: { external: boolean; address: string | null } } | null = null
async function tradingWalletOf(): Promise<{ external: boolean; address: string | null }> {
  if (tradingWalletMemo && Date.now() - tradingWalletMemo.at < 60_000) return tradingWalletMemo.value
  let value = { external: false, address: null as string | null }
  try {
    const { UserService } = await import("~/services/UserService")
    const me = (await UserService.getCurrentUser()) as
      | { wallet_mode?: string | null; external_address?: string | null }
      | null
    if (me?.wallet_mode === "external" && me.external_address) {
      value = { external: true, address: me.external_address }
    }
  } catch {
    // Signed out or unreachable: the custodial door, which will say so.
  }
  tradingWalletMemo = { at: Date.now(), value }
  return value
}

// The theme says PoppinSans; this is what makes that true on THIS surface.
ensureBrandFont()

// On poppin.so origins only: forward the auth page's sign-in token to the
// background over the one channel every Chromium gives a content script.
// See helpers/signinRelay for the Brave incident this exists for.
installSigninRelay()

// ---- Idempotency guard --------------------------------------------------
// The background injects this script via chrome.scripting.executeScript().
// Two paths in background/main.ts inject it for the same tab:
//   • chrome.tabs.onCreated  (after 100ms)
//   • chrome.tabs.onUpdated  (status === 'complete')
// Plus chrome.runtime.onStartup re-injects into every existing tab when
// the SW spins back up. In normal page navigations TWO of these fire, so
// executeScript ran our 425 KB bundle TWICE per tab — mounting two React
// roots (each with its own QueryClient + ThemeProvider + Toast + … and
// its own polling intervals + runtime-message listeners). That alone
// doubled per-tab CPU and is the most plausible explanation for the
// "browser feels slow with Poppin installed" reports.
//
// A sentinel on `window` short-circuits the side-effecting setup on
// every re-run. Imports + the zustand environment marker stay idempotent;
// they're cheap, and the store call is a no-op on repeat values.
declare global {
  interface Window {
    __poppinContentScriptLoaded?: boolean
  }
}
const alreadyLoaded = window.__poppinContentScriptLoaded === true
window.__poppinContentScriptLoaded = true

useEnvironmentStore.getState().setEnvironment("contentScript")

// Function to check if poppin-widget-iframe exists
const checkWidgetIframeExists = (): boolean => {
  return !!document.getElementById("poppin-widget-iframe")
}

// ── ONE FLOATING OBJECT PER PAGE, AND ONLY WHERE WE HAVE SOMETHING ──────────
//
// There used to be a permanent 28px button pinned to the right edge of EVERY
// page — a Grammarly-style launcher whose actual job was opening the in-page
// widget popup. That popup is retired (the sidebar is the app), and what was
// left was a button on Instagram, on a bank statement, on a page about
// nothing, competing for the exact coordinates the SpotCard's own edge tab
// uses (both are `fixed; right:0; top:50%`). Two marks stacked on one another,
// and the one that painted first was LogoWithoutEye — the eyeless variant
// SpotCard.tsx explicitly names as WRONG ("reads as an anonymous blob").
//
// So it is gone, and the doors that remain are the ones that earned their
// place: the card's tab where the page HAS an asset, the chip under a tweet
// that mentions one, and the toolbar icon everywhere (the background sets
// openPanelOnActionClick, so one click opens the panel on any page). Nothing
// of the old button is lost — its unread badge already lives on that same
// toolbar icon, written by the background's notification alarm.
//
// The URL listener stays: the MAIN-world urlListener.ts posts
// POPPIN_URL_UPDATED on SPA navigations and the store feeds page-post
// fetching. It was the React App component's other job.
if (!alreadyLoaded && !checkWidgetIframeExists()) {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = event.data as { type?: string; url?: string } | null
    if (data?.type === "POPPIN_URL_UPDATED" && data.url) {
      useCurrentUrlStore.getState().setCurrentUrl(canonicalPageUrl(data.url))
    }
  })
}

// The previous implementation here ran a MutationObserver on document.body
// with `subtree: true` for the first 10 seconds of every page load. On
// dynamic sites (Twitter, YouTube, Gmail, news feeds with infinite scroll)
// that callback fires hundreds of times per second AND, worse, ran
// `element.querySelector('#poppin-widget-iframe')` on every added node —
// so each invocation walked an arbitrary subtree. The user-visible
// symptom was a brutal main-thread block during the first 10s of every
// navigation: clicks took seconds to register, videos stuttered, CPU
// spiked. Removing the extension fixed it; the observer was the cause.
//
// What the observer was even trying to do: detect when the poppin.so
// page-embed iframe (#poppin-widget-iframe) appears after-the-fact so we
// can hand control to it. The handler only called `disconnect()` though,
// it never tore down our own already-rendered UI — so the observer had
// no actual user-visible effect by the time it fired.
//
// Replaced with three cheap polls over the first ~3 seconds: covers the
// rare embed-mid-load case without the per-mutation CPU cost. If the
// embed scenario needs more nuance later, prefer a single `setTimeout`
// after `DOMContentLoaded` over a subtree observer.
/**
 * THE CROWD, RESOLVED ONCE PER TAB — NOT ONCE FOREVER.
 *
 * Memoised on the PROMISE rather than the result: a timeline mounts a
 * dozen chips in one tick, and caching only the settled value would let
 * all twelve fire their own request before the first returned.
 *
 * X is a single-page app, so this module outlives every navigation inside
 * it. A memo with no expiry therefore answered from the first read for as
 * long as the tab stayed open — and somebody who follows a trader would
 * not see them appear on a row for hours, on a feature whose whole claim
 * is "who is in this NOW".
 *
 * Ten minutes: long enough that a scroll session costs one request, short
 * enough that leaving a tab open over lunch does not freeze the answer.
 *
 * A FAILURE IS CACHED SHORT, not for the window. An empty crowd from a
 * 401 is correct for a signed-out reader and should not be retried per
 * chip — that turns one refusal into a dozen — but a network blip should
 * not silence the faces for ten minutes either. Failure is not absence;
 * it is just a shorter answer.
 */
const CROWD_TTL_MS = 10 * 60_000

/**
 * The caller board as a lookup, resolved once per page. 50 rows is the
 * whole board, so one request answers every chip on the timeline.
 */
/** Same window as the crowd: an influence board moves on the order of
 *  days, so ten minutes is generous and still not "never". */
let callersOnce: { at: number; value: Promise<Map<string, { buyers: number }>> } | null =
  null
const callerIndex = (): Promise<Map<string, { buyers: number }>> => {
  if (callersOnce && Date.now() - callersOnce.at < CROWD_TTL_MS) {
    return callersOnce.value
  }
  const value =
    callersBoard("week", 50)
      .then(
        (r) =>
          new Map(
            (r?.callers ?? []).map((c) => [
              c.handle.toLowerCase(),
              { buyers: c.buyers },
            ]),
          ),
      )
      .catch(() => new Map<string, { buyers: number }>())
  callersOnce = { at: Date.now(), value }
  return value
}
/* NO followingCrowd HERE ANY MORE. It fed the chip's stack of faces of
   people you follow who are in this asset, and nothing else ever read it —
   so with that stack gone this was a request per page whose answer had no
   reader. The panel's "friends trading" line is its own path. */
/**
 * WHO THE READER IS, once per page.
 *
 * The chip had no answer to this. It asked for a username at SHARE time
 * (myHandle, below) and nothing else — so the one surface a reader spends
 * all day looking at could not say whose it was, and its own room opened
 * on a number with no name over it.
 *
 * Cached like the crowd beside it and for the same reason: a timeline
 * mounts dozens of strips, and identity does not change between two
 * tweets. A failure shortens its own window so the next chip after the
 * half-minute retries instead of inheriting five minutes of silence.
 *
 * NULL IS SIGNED OUT, and signed out is a real answer the surfaces use:
 * the wallet key keeps its glyph and the room grows no name row.
 */
type ReaderId = { id: string; username: string; photoUrl: string | null } | null
const ME_TTL_MS = 5 * 60_000
const ME_FAIL_TTL_MS = 30_000
let meOnce: { at: number; ttl: number; value: Promise<ReaderId> } | null = null
const readerIdentity = (): Promise<ReaderId> => {
  if (meOnce && Date.now() - meOnce.at < meOnce.ttl) return meOnce.value
  const entry = {
    at: Date.now(),
    ttl: ME_TTL_MS,
    value: (async (): Promise<ReaderId> => {
      const { UserService } = await import("~/services/UserService")
      const raw: any = await UserService.getCurrentUser()
      // Both shapes are in the wild; myHandle already reads them both.
      const u = raw?.id ? raw : raw?.data
      /**
       * users.id is a Firebase uid (TEXT, ~28 chars), never a uuid. The
       * same junk filter the backend's own routes use, because this id
       * goes into a panel route and a route is a place a bad string
       * should never reach.
       */
      const id = typeof u?.id === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(u.id)
        ? u.id
        : null
      if (!id) return null
      const username =
        typeof u?.username === "string" && /^[A-Za-z0-9_.]{1,30}$/.test(u.username)
          ? u.username
          : ""
      const photo = u?.profile_photo_url
      return {
        id,
        username,
        photoUrl: typeof photo === "string" && photo ? photo : null,
      }
    })().catch((): ReaderId => {
      if (meOnce) meOnce.ttl = ME_FAIL_TTL_MS
      return null
    }),
  }
  meOnce = entry
  return entry.value
}

/**
 * ONE LISTENER FOR THE PAGE, NOT ONE PER BELL.
 *
 * watchUnread registered a chrome.storage.onChanged listener every time a
 * chip mounted, and removed none of them. A timeline mounts and recycles
 * chips for as long as somebody scrolls, so the listener count grew
 * without bound and each one held its chip's closure alive — the chip's
 * own `host.isConnected` guard made the callback a no-op but could not
 * make it collectable.
 *
 * One listener now, a set of watchers, and a watcher is dropped the moment
 * its chip says it is gone. Swept on every news event AND on every fresh
 * registration, because news is rare and mounting is not.
 */
type UnreadWatcher = { cb: (n: number) => void; alive: () => boolean }
const unreadWatchers = new Set<UnreadWatcher>()
let unreadListening = false

const sweepUnreadWatchers = () => {
  for (const w of unreadWatchers) if (!w.alive()) unreadWatchers.delete(w)
}

const ensureUnreadListener = () => {
  sweepUnreadWatchers()
  if (unreadListening) return
  unreadListening = true
  let alerts = 0
  let fills = 0
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (!changes[FIRED_ALERTS_KEY] && !changes[PENDING_FILLS_KEY]) return
    if (changes[FIRED_ALERTS_KEY]) alerts = unreadFired(changes[FIRED_ALERTS_KEY].newValue)
    if (changes[PENDING_FILLS_KEY]) fills = unreadFills(changes[PENDING_FILLS_KEY].newValue)
    const n = alerts + fills
    sweepUnreadWatchers()
    for (const w of unreadWatchers) w.cb(n)
  })
}

const embedCheckHandles: ReturnType<typeof setTimeout>[] = []
const checkExternalEmbed = () => {
  if (document.getElementById('poppin-widget-iframe')) {
    cleanupExternalEmbedChecks()
  }
}
const cleanupExternalEmbedChecks = () => {
  for (const h of embedCheckHandles) clearTimeout(h)
  embedCheckHandles.length = 0
}
if (!alreadyLoaded) {
  for (const delay of [500, 1500, 3000]) {
    embedCheckHandles.push(setTimeout(checkExternalEmbed, delay))
  }
  window.addEventListener('beforeunload', cleanupExternalEmbedChecks)
}

// ── storage on a page that may have outlived its extension ──────────────────
//
// Everything the chip READS from chrome.storage comes through this pair. The
// page keeps running after an extension reload or auto-update; its storage
// calls do not, and the chip asks for this news without a catch —
// `void Promise.resolve(deps.listFired?.()).then(...)` — so an exception here
// arrived as an uncaught rejection in the extension's Errors panel, once per
// dead chip the reader touched.
//
// No storage means no news, which is the truthful answer: the bell shows
// nothing rather than a stale count, and the money surfaces keep their own,
// louder sentence for the same condition ("Poppin updated · Reload the page",
// lib/fetchService.ts) because spending is where the reader has to be told.
// A failed WRITE is reported as false rather than swallowed, so a caller that
// promised the reader something — a parked alert — can say it did not take.
const localGet = async (
  keys: string | string[],
): Promise<Record<string, unknown> | null> => {
  try {
    return (await chrome.storage.local.get(keys)) as Record<string, unknown>
  } catch {
    return null
  }
}

const localSet = async (items: Record<string, unknown>): Promise<boolean> => {
  try {
    await chrome.storage.local.set(items)
    return true
  } catch {
    return false
  }
}

// ── presence: this reader is on this website ────────────────────────────────
//
// THE ONE HEARTBEAT THAT RUNS ON AN ORDINARY PAGE. The extension's only other
// presence write is a side effect of a price card mounting: watchPriceMint
// returns early when the page matched no mint (entries/background/main.ts:1948)
// and the `watch-page` emit that puts a browser in a room is nested INSIDE
// that guard (:1956) — so on a page about nothing, nobody was ever in the
// room. A count that is structurally zero cannot gate anything.
//
// It lives HERE, in a real document, rather than on a setInterval in the MV3
// service worker, because Chrome evicts that worker on idle and takes every
// timer with it: the count would freeze on a stale number, which reads like an
// answer and is not one. The side panel beats too, and a coarse chrome.alarms
// backstop beats in the background. All three may beat for the SAME member at
// once and that is safe BY CONSTRUCTION, not by coordination — the server's
// write is a ZADD keyed by this install's id, so a second writer moves a score
// and never the count.
//
// A document's own hostname cannot change without a fresh document, so this is
// started once and never restarted: an SPA route change inside x.com is the
// same website and the same room. Non-http(s) documents get no beat at all.
if (!alreadyLoaded) {
  const presenceHost = siteChatHostFromUrl(window.location.href)
  if (presenceHost) {
    const stopPresence = startSitePresenceHeartbeat(presenceHost)
    window.addEventListener("beforeunload", stopPresence)
  }
}

// ── the spot trade card ─────────────────────────────────────────────────────
// Page-anchored, its own closed shadow root, mounted ONCE per page load and
// only when the backend matches an asset. It is not part of the feed and does
// not enter the post row.
//
// Everything about WHEN a card appears lives in attachSpotCard — including
// the wait for the page to have text worth scraping, which used to be a flat
// 1500ms setTimeout right here. That number was three quarters of the card's
// entire time to appear, and it also put a "when" decision in the one file
// this comment says holds none. attachSpotCard now waits on the condition
// itself; see whenPageIsReadable there.
//
// This is only the trigger.
if (!alreadyLoaded) {
  // The page's card, once it exists. Held rather than discarded: a closed
  // shadow root is invisible to every other surface BY DESIGN, so this
  // reference is the only door the panel has to it.
  let spotController: Awaited<ReturnType<typeof attachSpotCard>> = null
  /**
   * A CHIP HAS LANDED, SO THE CARD IS NOT WANTED.
   *
   * A flag rather than a destroy call, because the two surfaces do not
   * race fairly: the strip reads the page on its own and mounts in
   * milliseconds, while the card waits on /embed/asset/match. Destroying
   * `spotController` from the chip's callback did nothing at all — there
   * was no controller yet — and the card then mounted into a page that
   * already had a chip on it. Measured on CNBC: both surfaces, at once,
   * for the same asset.
   *
   * The flag outlives the race in both directions. A card that exists is
   * destroyed; a card that arrives later is destroyed on arrival.
   */
  let chipOwnsThePage = false
  let xStripCtl: XStripController | null = null

  // A Holdings row can swap the card onto a different asset from INSIDE the
  // card, which this file would otherwise never hear about — leaving the
  // reference above pointing at a destroyed controller, so price ticks for the
  // new mint land nowhere and POPPIN_SPOT_ASSET_QUERY answers with an asset
  // that is no longer on screen. Both failures are silent.
  onCardReplaced((c) => {
    if (chipOwnsThePage) {
      c?.destroy()
      return
    }
    spotController = c
  })

  // Registered UNCONDITIONALLY, not inside the card's success path. The
  // Trades tab's most useful answers are on pages where no card mounted —
  // the ones the dominance rule silenced — and a listener that only exists
  // when a card exists could never give them.
  //   POPPIN_SPOT_ASSET_QUERY  → what (if anything) the card is showing
  //   POPPIN_SPOT_CANDIDATES   → the page's ranked tradeable shortlist
  //   POPPIN_SPOT_EXPAND       → open the card's trade panel
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Broadcast to every tab (see main.ts's price-tick relay) — filtered to
    // this tab's own current match, the same way POPPIN_SPOT_ASSET_QUERY's
    // answer already is. A tick for a mint this tab dismissed or never
    // matched is exactly as silent as one for a tab that never had a card.
    if (msg?.type === "POPPIN_PRICE_TICK") {
      if (spotController && msg.mint === spotController.matchedAsset.mint) {
        spotController.setPrice(msg.usdPrice, msg.change24hPct)
      }
      // The X strips watch their own mints; a tick lights every chip
      // showing that asset — the market moving IS the strip's motion.
      xStripCtl?.updatePrice(msg.mint, msg.usdPrice, msg.change24hPct ?? null)
      return false
    }
    if (msg?.type === "EXTENSION_SIGNIN_COMPLETE") {
      // A new account may trade from a different wallet than the last one.
      tradingWalletMemo = null
      /**
       * AND IT IS A DIFFERENT PERSON, WITH A DIFFERENT FACE.
       *
       * readerIdentity caches for five minutes, and nothing used to clear
       * it when the session changed. Every surface resolves me() at its own
       * mount: the chip's wallet key paints once when the chip lands, the
       * You room builds when it is opened. Switch accounts between those
       * two moments and the strip shows one person's photo in the header
       * and another's on the profile row, at the same time, on the same
       * screen. Seen on 2026-09-22.
       *
       * The memo beside this one was already cleared here for exactly the
       * same reason, one field further down the same object.
       */
      meOnce = null
      // The chip that sent somebody to sign in must flip the moment they
      // return - not 20s of book TTL later. See xStrip.onSignedIn.
      xStripCtl?.onSignedIn()
      return false
    }
    if (msg?.type === "POPPIN_SPOT_ASSET_QUERY") {
      sendResponse({ asset: spotController?.matchedAsset ?? null })
      return true
    }
    if (msg?.type === "POPPIN_SPOT_EXPAND") {
      const wanted = msg.asset as
        | { mint: string; decimals: number | null }
        | null
      const side = msg.side === "sell" ? ("sell" as const) : ("buy" as const)
      // Same asset (or none named): just open what is already there.
      if (!wanted?.mint || wanted.mint === spotController?.matchedAsset.mint) {
        spotController?.expand(side)
        sendResponse({ ok: Boolean(spotController), reason: spotController ? "ok" : "no_card" })
        return true
      }
      if (wanted.decimals === null) {
        // No decimals means no honest amount rendering — the card refuses
        // rather than printing a number that is wrong by orders of magnitude.
        sendResponse({ ok: false, reason: "not_tradeable" })
        return true
      }
      // The card is switched off (see PAGE_CARD_ENABLED): the panel gets a
      // plain no rather than a surface that is not supposed to exist.
      if (!PAGE_CARD_ENABLED) {
        sendResponse({ ok: false, reason: "card_disabled" })
        return true
      }
      // A runner-up from the panel's list: mount the card on IT, replacing
      // whatever the page's own match had put there, then open it.
      startCardForMatch(msg.asset)
        .then((c) => {
          if (c) {
            spotController = c
            c.expand(side)
          }
          sendResponse({ ok: Boolean(c), reason: c ? "ok" : "not_tradeable" })
        })
        .catch(() => sendResponse({ ok: false, reason: "not_tradeable" }))
      return true
    }
    if (msg?.type === "POPPIN_POSTS_REFRESH") {
      // The panel posted; re-read the conversation so the card's count and
      // rows agree with what the reader just did. Fire-and-forget.
      if (spotController) {
        void fetchPagePosts(location.href).then(({ posts }) => {
          spotController?.setPosts(posts)
        })
      }
      sendResponse({ ok: true })
      return true
    }
    if (msg?.type === "POPPIN_BOOK_CHANGED") {
      // Money moved or the trading wallet switched: read the account again next time.
      tradingWalletMemo = null
      // The background saw money land: every open sheet re-reads its balance.
      xStripCtl?.onBookChanged()
      sendResponse({ ok: true })
      return true
    }
    if (msg?.type === "POPPIN_EXTERNAL_TRADE") {
      // The side panel's trade, signed on this page (helpers/externalTrade.ts).
      void (async () => {
        try {
          const ask = ((msg as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>
          // The panel's address screen asks two things of the page that
          // need no account at all: is Phantom here, and move USDC in from
          // it, the chip's own one-tap rail.
          if (ask.kind === "probe") {
            // No Solana page wallet is ever reported in the Arc edition, so
            // no panel screen offers a Phantom rail it cannot finish.
            if (!CAP.solanaRails) {
              sendResponse({ ok: true, result: { present: false } })
              return
            }
            const { hasPageWallet } = await import("~/helpers/pageWalletBridge")
            sendResponse({ ok: true, result: { present: await hasPageWallet() } })
            return
          }
          /**
           * CONNECT A WALLET THE READER ALREADY HAS. Like probe, it needs no
           * account kind: the whole point is that the account does NOT trade
           * from a wallet yet. The refusal the server writes is passed up
           * untouched by the catch below, because each of its three is a
           * different next move.
           */
          if (ask.kind === "connect") {
            const r = await connectWalletOnPage()
            // Every chip and sheet on every page reads the account again:
            // which wallet trades has just changed, and a cached answer
            // would keep spending the old one.
            try {
              void chrome.runtime.sendMessage({ type: "BOOK_CHANGED_NOW" })
            } catch {
              // no extension context; the panel re-reads on its own too
            }
            sendResponse({ ok: true, result: r })
            return
          }
          /**
           * NOTHING ASKS FOR THIS ANY MORE, and it is left standing rather
           * than tidied away. The panel's address screen was its only
           * caller (views/receive.tsx's "Convert $25 of SOL to USDC" card,
           * through helpers/panelExternalTrade.convertViaPage) and that
           * card is gone: a wallet account's answer is "Add USDC to your
           * wallet" and the address, with no conversion anywhere on the
           * path. This is the last live reference to
           * pagePosts.convertFromPage; deleting either is a decision for
           * whoever generalises the server's USDC-leg proof
           * (apps/backend/src/spot/external-proof.util.ts), not a cleanup.
           */
          if (ask.kind === "convert") {
            const usd = typeof ask.usd === "number" && ask.usd > 0 ? ask.usd : undefined
            const funded = await convertFromPage(
              usd,
              (route) => sendTelemetry("x_fund_route", { route: `convert-${route}`, usd, from: "panel" }),
              "exact",
            )
            sendResponse({ ok: true, result: { funded } })
            return
          }
          if (ask.kind === "topup") {
            const usd = typeof ask.usd === "number" && ask.usd > 0 ? ask.usd : undefined
            const funded = await topUpFromPage(
              usd,
              (route) => sendTelemetry("x_fund_route", { route, usd, from: "panel" }),
              "exact",
            )
            sendResponse({ ok: true, result: { funded } })
            return
          }
          const tw = await tradingWalletOf()
          const a = ((msg as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>
          const kind = a.kind === "order" ? "order" : a.kind === "cancel" ? "cancel" : "trade"
          const result =
            kind === "order"
              ? await orderWithPageWallet({
                  mint: String(a.mint ?? ""),
                  side: a.side === "sell" ? "sell" : "buy",
                  amountUsd: typeof a.amountUsd === "number" ? a.amountUsd : undefined,
                  amountRaw: typeof a.amountRaw === "string" ? a.amountRaw : undefined,
                  triggerPriceUsd: Number(a.triggerPriceUsd),
                  expectedAddress: tw.address,
                })
              : kind === "cancel"
                ? await cancelOrderWithPageWallet(String(a.orderKey ?? ""), tw.address)
                : await tradeWithPageWallet({
                    side: a.side === "sell" ? "sell" : "buy",
                    mint: String(a.mint ?? ""),
                    amountUsd: typeof a.amountUsd === "number" ? a.amountUsd : undefined,
                    amountRaw: typeof a.amountRaw === "string" ? a.amountRaw : undefined,
                    sourceUrl: typeof a.sourceUrl === "string" ? a.sourceUrl : undefined,
                    expectedAddress: tw.address,
                  })
          sendResponse({ ok: true, result })
        } catch (e) {
          sendResponse({ ok: false, error: (e as Error)?.message ?? "The trade could not be made." })
        }
      })()
      return true
    }
    if (msg?.type === "POPPIN_SPOT_CANDIDATES") {
      const signals = harvest()
      if (!signals) {
        sendResponse({ candidates: [] })
        return true
      }
      candidatesForPage(signals)
        .then((r) => sendResponse({ candidates: r?.candidates ?? [] }))
        .catch(() => sendResponse({ candidates: [], error: true }))
      // Async responder: the channel must stay open until the fetch lands.
      return true
    }
    return undefined
  })

  if (PAGE_CARD_ENABLED) attachSpotCard()
    .then((controller) => {
      // The strip usually wins this race — it reads the page itself while
      // the card waits on /match — so the card is far more likely to
      // arrive INTO a page that already has a chip than the other way
      // round. Either way the chip owns it.
      if (chipOwnsThePage) {
        controller?.destroy()
        return
      }
      spotController = controller
    })
    .catch(() => {
      // A page that shows nothing because the backend was unwell and a page
      // that shows nothing because there was nothing to show are the same
      // outcome to a reader, and neither deserves a console error on somebody
      // else's site.
    })

  /**
   * RE-MATCH WHEN A SINGLE-PAGE APP NAVIGATES.
   *
   * attachSpotCard runs once, on the initial page. But the sites this
   * product lives on — pump.fun, dexscreener, birdeye, a subreddit, a
   * Discord — are SPAs: they swap the whole page's content and rewrite the
   * URL through history.pushState without ever reloading, so a reader who
   * clicks from one token to another kept the FIRST token's card (or no
   * card at all) forever. The old fix was a body MutationObserver, removed
   * for the CPU fire it started (see the note above); a URL-change hook is
   * the cheap version — it fires only on an actual navigation, not per DOM
   * mutation.
   *
   * The MAIN-world urlListener already posts POPPIN_URL_UPDATED on every
   * pushState/replaceState/popstate. Here we tear down the old card and
   * re-run the whole match (which re-harvests the new page's text, so a
   * contract address on the destination page is now readable too).
   *
   * Debounced, and gated on a REAL canonical change: SPAs fire several
   * history writes per navigation, and a query-param tweak is the same
   * page. attachSpotCard's own readable-wait handles content that lands a
   * beat after the URL.
   */
  // The canonical URL the CURRENT card was matched for. Compared against the
  // LIVE location at fire time (not the last message seen), so an A→B→A
  // round-trip inside the debounce ends where it began and correctly does
  // nothing — the earlier version advanced on every message and would
  // destroy the still-correct A card to re-match A.
  let matchedUrl = canonicalPageUrl(location.href)
  let rematchTimer: ReturnType<typeof setTimeout> | undefined
  // A generation token: each re-match invalidates the ones before it, so an
  // older attachSpotCard that resolves LATE (a slow page behind a fast
  // A→B→C click-through) cannot install its stale card over the current one.
  let matchGen = 0
  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = event.data as { type?: string; url?: string } | null
    if (data?.type !== "POPPIN_URL_UPDATED" || !data.url) return
    // Every pushState reschedules; the fire reads the settled location.
    clearTimeout(rematchTimer)
    rematchTimer = setTimeout(() => {
      const live = canonicalPageUrl(location.href)
      // Back on the page the card already matches (A→B→A, or a query-only
      // change): keep the card, spend nothing.
      if (live === matchedUrl) return
      const gen = ++matchGen
      // The old card belongs to the old URL. Destroy BEFORE re-matching so
      // the page never briefly carries two (the ordering switchCardTo relies
      // on). attachSpotCard re-harvests the page; the debounce above is also
      // the content-settle wait, because an SPA swaps its DOM a beat after it
      // rewrites the URL and document.readyState never returns to 'loading'
      // for whenPageIsReadable to gate on. A too-fast SPA that has not
      // painted yet is matched on the next navigation, never left stale
      // forever.
      spotController?.destroy()
      spotController = null
      if (!PAGE_CARD_ENABLED) return
      attachSpotCard()
        .then((c) => {
          // A newer navigation already superseded this one: drop the card it
          // just built rather than let it overwrite the current match.
          if (gen !== matchGen) {
            c?.destroy()
            return
          }
          if (chipOwnsThePage) {
            c?.destroy()
            return
          }
          spotController = c
          matchedUrl = live
        })
        .catch(() => {})
    }, 700)
  })

  // ── The X trade strip ─────────────────────────────────────────────────────
  // Buy/Sell under tradeable tweets. Gated inside initXStrip to X hosts and
  // to the remote kill switch, so on every other site this line costs one
  // hostname test. The strip's Buy opens the SAME docked card the page match
  // uses — one money surface on the page, whatever pointed at it.
  /**
   * One telemetry road for the strip. It used to live only inside the
   * `track` dep, which meant a sibling dep that wanted to report something
   * had no way to reach it without naming the object it is being defined
   * inside.
   */
  const sendTelemetry = (event: string, payload?: Record<string, unknown>) => {
    try {
      void chrome.runtime
        .sendMessage({ type: "SPOT_TELEMETRY", event, payload })
        .catch(() => {})
    } catch {
      // Orphaned page: nothing it sends can arrive. Not worth a word here —
      // the money paths say "Poppin updated — reload the page".
    }
  }

  initXStrip({
    /**
     * ONE POPPIN SURFACE PER PAGE, and the chip is the specific one.
     *
     * On a news article both were visible at once: a row under the
     * headline and the page card's tab on the right rail, at the same
     * moment, for the same asset. The chip is attached to the thing the
     * reader just read; the card is the page's general answer. So the card
     * retires the moment a chip lands.
     *
     * The card is not suppressed in advance, because the strip may find
     * nothing at all — a headline that names no company — and a page with
     * neither surface would be worse than a page with the general one.
     */
    onFirstChip: () => {
      chipOwnsThePage = true
      spotController?.destroy()
      spotController = null
    },
    fetchConfig: xStripConfig,
    enrich: (mint) => assetByMint(mint).then((r) => r.asset),
    // Buy completes INSIDE the strip; these are its rails and its two gates.
    /**
     * WHOSE KEY SIGNS. A Google account trades from the embedded wallet
     * through the server; a wallet account (users.wallet_mode =
     * 'external') signs on this very page in Phantom's window. The chip
     * does not know the difference: both answer the same receipt.
     */
    trade: {
      swap: async (mint, amountUsd, sourceUrl, idempotencyKey) => {
        const tw = await tradingWalletOf()
        if (tw.external) {
          return tradeWithPageWallet({
            side: "buy",
            mint,
            amountUsd,
            sourceUrl,
            expectedAddress: tw.address,
          })
        }
        return swapAsset(mint, amountUsd, sourceUrl, idempotencyKey)
      },
      confirm: confirmAsset,
    },
    // Standing orders ride the same rails; the backend gates, verifies,
    // signs and executes exactly as it does for a swap.
    order: {
      /**
       * The order is placed, and WHERE it was placed is written down in
       * the same breath — the only moment that answer exists. Hours later
       * the background posts the fill and has no page of its own; this is
       * what lets that post land in the room the order was parked from.
       */
      createOrder: async (dto) => {
        // A wallet account's order signs in Phantom on this page; the
        // receipt and the bookkeeping below are the same either way.
        const tw = await tradingWalletOf()
        const r = tw.external
          ? await orderWithPageWallet({ ...dto, expectedAddress: tw.address })
          : await createOrderAsset(dto)
        if (r?.orderKey) {
          try {
            const st = await chrome.storage.local.get(ORDER_ORIGINS_KEY)
            await chrome.storage.local.set({
              [ORDER_ORIGINS_KEY]: rememberOrigin(
                st?.[ORDER_ORIGINS_KEY],
                r.orderKey,
                X_FEED_URL,
              ),
            })
          } catch {
            // The order stands; the fill will just file under the default.
          }
        }
        return r
      },
      confirm: confirmAsset,
    },
    watchPrice,
    // The other half of watchPrice, which the strip never had: the worker
    // polls Jupiter per watched mint, and a timeline hands it a new one
    // every few seconds.
    unwatchPrice: (mint: string) => {
      if (!extensionAlive()) return
      try {
        void chrome.runtime.sendMessage({
          type: "POPPIN_UNWATCH_PRICE",
          mint,
          host: location.hostname,
        })
      } catch {
        // A stale context cannot unwatch; the worker drops the tab's
        // watches when the port closes anyway.
      }
    },
    // What a buy costs, shown on the chip before it is confirmed.
    quote: (mint, usd) => quoteAsset(mint, usd).catch(() => null),
    // The tap-the-price chart. Fetched per (mint, range) on demand and
    // cached by the chip; a feed being scrolled never asks.
    series: (mint, range) =>
      // A thrown request IS a failure; the chip words that differently
      // from a range that genuinely holds no candles.
      seriesAsset(mint, range).catch(() => ({
        points: null,
        times: null,
        opens: null,
        highs: null,
        lows: null,
        failed: true,
      })),
    // The reader's own history for the chart's marks; signed-out reads null.
    myTrades: (mint) => myTradesAsset(mint).then((r) => r.trades ?? []),
    // The slow lane for unknown cashtags — server-resolved, gate-approved.
    resolveTicker: (ticker) => byTickerAsset(ticker).then((r) => r.mint),
    // The Arc edition's AI reader, for posts no rule placed (arc/readerClient.ts).
    readText: ARC_EDITION ? (id, text) => import("~/arc/readerClient").then((m) => m.readText(id, text)) : undefined,
    // Spendable USD for the order sheet — the one number a reader composing
    // a standing order needs and the chip never had. Read once per page, and
    // only after a sheet opens: /positions is 8.6s cold.
    // ONE read answers cash, the raw holding and the basis a sale is judged
    // against. Raw units come from the server; nothing here divides by ten
    // to the anything.
    // HANDED OVER WHOLE. This used to map nine fields down to five — the
    // ticker, the price, the value and the P&L of every position were
    // fetched on this very request and then thrown away in the adapter,
    // which is why the chip "had no prices". Same read, same cost, and now
    // the panel can say what a holding is worth.
    book: () => positionsAsset(),
    /**
     * ONE ANSWER PER PAGE, SHARED BY EVERY CHIP. Memoised on the promise,
     * not the result, so the dozen chips a timeline mounts in the same tick
     * all await the SAME request instead of racing a dozen of their own.
     *
     * Failure resolves to an empty crowd rather than rejecting: faces are
     * the one part of the row allowed to be missing, and a signed-out
     * reader hits this path on every page.
     */
    /**
     * The caller board, fetched once and looked up by handle. Public and
     * aggregate-only with an N>=3 floor applied server-side, so nothing
     * here has to decide whether a number is small enough to name a
     * person's trade.
     */
    // Deps the Arc edition's backend does not serve are left OUT, not stubbed:
    // the chip treats an absent dep as "no line", while a failing one still
    // draws its fallback (points would print "+N pts" on every buy).
    myRank: !CAP.gamification ? undefined : () =>
      myRankAsset()
        .then((r) => ({ rank: r?.viewerRank ?? null }))
        // A signed-out reader 401s here, and that is not an error worth a
        // console line on somebody else's page.
        .catch(() => null),
    callerFor: !CAP.social ? undefined : (handle: string) =>
      callerIndex().then((m) => m.get(handle.toLowerCase()) ?? null),
    // The persisted book for the scoreboard's first paint; the live read
    // above corrects it. Same cache SpotPositions and the profile ride.
    cachedBook: () => readBookCache(),
    /**
     * The homecoming's cross-page memory: last shown P&L per mint, capped
     * so it cannot grow without bound. Best-effort both ways - a broken
     * storage keeps today's in-page behaviour.
     */
    mineSeen: {
      read: async () => {
        try {
          const got = await chrome.storage.local.get("poppin_mine_seen")
          const v = got?.poppin_mine_seen
          return v && typeof v === "object" ? (v as Record<string, number>) : {}
        } catch {
          return {}
        }
      },
      write: (mint, v) => {
        try {
          void chrome.storage.local.get("poppin_mine_seen").then((got) => {
            const cur =
              got?.poppin_mine_seen && typeof got.poppin_mine_seen === "object"
                ? (got.poppin_mine_seen as Record<string, number>)
                : {}
            cur[mint] = v
            const keys = Object.keys(cur)
            if (keys.length > 80) delete cur[keys[0]]
            void chrome.storage.local.set({ poppin_mine_seen: cur })
          })
        } catch {
          // Silent: the greeting still works within the page.
        }
      },
    },
    sell: async (mint, amountRaw, sourceUrl, idempotencyKey) => {
      const tw = await tradingWalletOf()
      if (tw.external) {
        const r = await tradeWithPageWallet({
          side: "sell",
          mint,
          amountRaw,
          sourceUrl,
          expectedAddress: tw.address,
        })
        return { ...r, outUsdcRaw: r.outUsdcRaw ?? r.outAmountRaw }
      }
      return sellAsset(mint, amountRaw, sourceUrl, idempotencyKey)
    },
    listOrders: !CAP.orderWatch ? undefined : () => listOrdersAsset("active").then((r) => r.orders),
    cancelOrder: !CAP.orderWatch ? undefined : async (orderKey) => {
      const tw = await tradingWalletOf()
      return tw.external
        ? cancelOrderWithPageWallet(orderKey, tw.address)
        : cancelOrderAsset(orderKey)
    },
    // Social proof behind the sheet tap, now counted from the trade
    // LEDGER's source_url receipts — every buy the chip drove from this
    // tweet, shared or not. The shared-post proxy (countTradeProof over
    // page posts) could only see buyers who also chose to post about it.
    // Still never per-tweet on the timeline: the tap is the consent.
    pageProof: (url) => tweetProof(url),
    // A parked price alert: read, dedupe, cap, write. The background's
    // alarm does the watching; this is only the parking.
    saveAlert: async (alert) => {
      const stored = await localGet(PRICE_ALERTS_KEY)
      if (!stored) return false
      // Array.isArray, not a bare ?? []: localGet's return is honestly typed
      // unknown, and storage is a place other code writes to.
      const rows = stored?.[PRICE_ALERTS_KEY]
      const { alerts, added } = addAlert(Array.isArray(rows) ? (rows as PriceAlert[]) : [], alert)
      if (added) await localSet({ [PRICE_ALERTS_KEY]: alerts })
      // The server's copy, so the alert is judged while Chrome is closed
      // and said by email. Signed-out answers 401 and that is fine.
      if (added && CAP.alertsMirror) void syncAlerts([alert]).catch(() => {})
      return added
    },
    // The scoreboard's Alerts tab: the same storage the bell writes and
    // the background checks, finally readable and cancellable.
    listAlerts: async () => {
      const stored = await localGet(PRICE_ALERTS_KEY)
      const rows = stored?.[PRICE_ALERTS_KEY]
      return Array.isArray(rows) ? rows : []
    },
    /**
     * The Activity band's notifications, whitelisted and sentenced by the
     * SHARED vocabulary (helpers/notificationText) — the same words the
     * side panel and the card speak, so three surfaces cannot drift.
     *
     * The first wiring passed raw rows through and the field showed why
     * that can never be the contract: eight identical "An Arc market needs
     * a resolve decision" admin rows from the RETIRED prediction product,
     * and a bare "follow" — a type name where a sentence belongs. A type
     * notificationKind does not know is DROPPED, never rendered raw. Fetch
     * deep (20) then filter then cap, so dead rows cannot crowd out live
     * ones.
     *
     * The private map this replaced had two field-invisible bugs the shared
     * module does not: it whitelisted `upvote_cast` (a flywheel EVENT type
     * the notifications writer never inserts — every real like was dropped)
     * and it named the actor from `n.user`, which the endpoint fills with
     * the RECIPIENT — every deed credited to yourself.
     */
    listNotifications: !CAP.social ? undefined : async () => {
      const who = (n: any) =>
        n?.action_taken_by?.display_name ||
        n?.action_taken_by?.username ||
        "Someone"
      const snip = (n: any) => {
        const c = typeof n?.content === "string" ? n.content.trim() : ""
        return c ? `: "${c.length > 60 ? `${c.slice(0, 57)}…` : c}"` : ""
      }
      /** Kinds whose row carries the words that were said, worth quoting. */
      const QUOTABLE = new Set(["reply", "comment", "mention"])
      try {
        const { UserService } = await import("~/services/UserService")
        const r: any = await UserService.getNotifications(20)
        const rows = r?.data ?? r?.notifications ?? []
        if (!Array.isArray(rows)) return []
        return rows
          .map((n: any) => {
            const type = String(n?.type ?? "")
            const kind = notificationKind(type)
            if (!kind) return null
            const verb = notificationVerb(type, n?.post_type)
            return {
              id: String(n?.id ?? ""),
              kind,
              text: `${who(n)} ${verb}${QUOTABLE.has(kind) ? snip(n) : ""}`,
              created_at: String(n?.created_at ?? ""),
              // THE FACE OF WHOEVER DID IT. A row that says "nic liked your
              // post" beside a generic glyph makes every actor look like
              // the same anonymous system event; the person's own photo is
              // what turns a log line into somebody you know.
              avatarUrl:
                typeof n?.action_taken_by?.profile_photo_url === "string"
                  ? n.action_taken_by.profile_photo_url
                  : null,
              /**
               * WHERE THE NEWS CAN BE VISITED. A follow's destination is
               * the person; everything else happened on a post, and until
               * the panel's post room reads its route param the honest
               * landing is the feed the post lives in. No destination, no
               * door — the chip renders those rows plain.
               */
              route:
                kind === "follow" && n?.action_taken_by?.id
                  ? `/profile/${n.action_taken_by.id}`
                  : "/feed",
            }
          })
          .filter((n): n is NonNullable<typeof n> => n !== null)
          .slice(0, 8)
      } catch {
        return []
      }
    },
    listFired: async () => {
      const stored = await localGet(FIRED_ALERTS_KEY)
      const rows = stored?.[FIRED_ALERTS_KEY]
      return Array.isArray(rows) ? rows : []
    },
    /**
     * FILLED ORDERS, the same shape as fired alerts and for the same
     * reason: the news is already on this machine. The background writes
     * a fill the moment its watch notices the order left the active list;
     * this hands it to the chip's Activity band.
     */
    listFills: async () => {
      const stored = await localGet(PENDING_FILLS_KEY)
      const rows = stored?.[PENDING_FILLS_KEY]
      return Array.isArray(rows) ? rows : []
    },
    markFiredRead: async () => {
      // BOTH kinds of news, because Activity shows both and the bell counts
      // both. Marking one and not the other left a badge lit over a tab
      // the reader had just finished reading.
      const stored = await localGet([FIRED_ALERTS_KEY, PENDING_FILLS_KEY])
      const alerts = stored?.[FIRED_ALERTS_KEY]
      if (Array.isArray(alerts) && alerts.some((f: { read?: boolean }) => !f?.read)) {
        await localSet({
          [FIRED_ALERTS_KEY]: alerts.map((f: object) => ({ ...f, read: true })),
        })
      }
      const fills = stored?.[PENDING_FILLS_KEY]
      if (Array.isArray(fills) && fills.some((f: { read?: boolean }) => f?.read === false)) {
        await localSet({
          [PENDING_FILLS_KEY]: markFillsRead(fills as PendingFill[]),
        })
      }
    },
    // storage.onChanged, not polling: the background writes the fired list
    // when an alert crosses its line, and every pill on the page lights up
    // in the same tick — zero network, the news is already on this machine.
    watchUnread: (cb, alive) => {
      // TWO SOURCES, ONE NUMBER. A filled order is news exactly as much as
      // a crossed alert is; counting only alerts left the bell dark for
      // the event a reader most wants to hear about — their money moving.
      void localGet([FIRED_ALERTS_KEY, PENDING_FILLS_KEY])
        .then((st) => {
          const n =
            unreadFired(st?.[FIRED_ALERTS_KEY]) + unreadFills(st?.[PENDING_FILLS_KEY])
          if (n > 0) cb(n)
        })
        .catch(() => undefined)
      // Registering a listener throws on a dead page exactly like a read
      // does, and this one runs on every bell that mounts.
      if (!extensionAlive()) return
      unreadWatchers.add({ cb, alive })
      ensureUnreadListener()
    },
    removeAlert: async (id) => {
      const stored = await localGet(PRICE_ALERTS_KEY)
      const rows = stored?.[PRICE_ALERTS_KEY]
      if (!Array.isArray(rows)) return
      await localSet({
        [PRICE_ALERTS_KEY]: rows.filter((a: { id?: string }) => a?.id !== id),
      })
      if (CAP.alertsMirror) void removeAlertRemote(id).catch(() => {})
    },
    /**
     * A TRADE MADE UNDER A TWEET, ON THE FEED.
     *
     * The X strip was the one money surface with no path to the Poppin
     * feed at all: it recorded the tweet in the ledger (source_url, which
     * is what caller credit is paid from) and posted nowhere. The owner's
     * call is that the post belongs to the FEED's address, not the
     * tweet's — "direk twitter feed'ine kaydedilsin, ilgili tweet'e
     * gitmesin" — so a reader who taps it lands where they were reading
     * rather than on one scrolled-past post.
     *
     * The tweet is not lost by this: it stays in spot_trades.source_url,
     * where attribution lives and where nothing in the feed can edit it.
     * Best-effort — a post that does not land must never look like a
     * trade that did not.
     */
    postTrade: !CAP.autoPost ? undefined : async (t) => {
      /**
       * THE RECEIPT SAYS THE TWO THINGS A TRADER READS.
       *
       * It used to read "Bought 1,074,603.6105 $PANTS ($953.00) on x.com
       * via Poppin" — a nine-digit quantity nobody can hold in their head,
       * a verb the tag above the sentence already carries, and a provenance
       * line the whole card already announces. What a reader of somebody
       * else's trade actually wants is the SIZE OF THE BET and the SIZE OF
       * THE THING: "PANTS $953 at $60.9M market cap".
       *
       * The market cap is the memecoin-native unit — a price per token
       * says nothing on its own — and it is the trade's OWN, caught at the
       * moment it happened rather than re-read later. Absent, the sentence
       * simply stops early rather than inventing one.
       *
       * A SELL has no dollar figure until it settles (the chip sends 0),
       * so it says the quantity it actually chose instead.
       */
      try {
        await WebsitePostService.create({
          content: receiptSentence(t),
          website_url: X_FEED_URL,
          only_followers: false,
          on_chain: true,
          transaction_data: {
            tokenSymbol: t.symbol.replace(/^\$/, ""),
            tokenMint: t.mint,
            tokenAmount: t.tokens,
            signature: t.signature,
            // The coin's face, so the receipt in the feed is not a blank
            // disc beside a sentence about a token nobody can see.
            ...(t.iconUrl ? { tokenImageUrl: t.iconUrl } : {}),
            // The DB defaults a missing tradeType to 'buy', so every sell
            // that omitted it was recorded as a buy in post_transactions —
            // the sentence said "Sold" while the receipt row said bought.
            tradeType: t.side,
          },
        })
      } catch {
        // Silent by contract; the trade is the thing that mattered.
      }
    },
    // The chip's left cluster hands the reader to the app, on this asset.
    openPanel: openAssetInPanel,
    // Where the balance chip leads. Its other half — an identity read for
    // the avatar — went out with the avatar itself: at 16px a profile photo
    // was clutter, and a request whose answer nothing draws is a dead call.
    openHome: openMyPanel,
    // "Feed" means the room, not this tweet's corner of it.
    openFeed: openFeedInPanel,
    // The news rows' door: a panel room by route, prefix-guarded.
    openRoom: openPanelRoom,
    me: () => readerIdentity(),
    /**
     * Line or candles, remembered across pages. A reader who thinks in
     * candles thinks in candles on every asset, so re-picking on each
     * tweet would be the amnesia the chip fixed everywhere else.
     */
    chartView: {
      read: async () => {
        try {
          const got = await chrome.storage.local.get(CHART_VIEW_KEY)
          return got?.[CHART_VIEW_KEY] === "candle" ? "candle" : "line"
        } catch {
          return "line"
        }
      },
      write: (v) => {
        try {
          void chrome.storage.local.set({ [CHART_VIEW_KEY]: v })
        } catch {
          // Storage unavailable: the choice lasts this page and no longer.
        }
      },
    },
    /**
     * The clip lives in extension storage, read once per page and written
     * after a buy lands. Clamped on the way IN as well as out, so a value
     * an older build wrote with no ceiling cannot survive by sitting on
     * disk (see helpers/clip).
     */
    clip: {
      read: async () => {
        try {
          const got = await chrome.storage.local.get(CLIP_KEY)
          return readClip(got?.[CLIP_KEY])
        } catch {
          return DEFAULT_CLIP
        }
      },
      write: (c) => {
        try {
          void chrome.storage.local.set({ [CLIP_KEY]: readClip(c) })
        } catch {
          // Storage unavailable. The label simply stays at the default.
        }
      },
    },
    signIn: openSignIn,
    /**
     * The fast path's own verdict, recorded. `x_fund_press` already says
     * somebody asked for money; this says which road that ask could take,
     * and the share that comes back `no-wallet` is exactly the share the
     * panel's address screen is a dead end for.
     */
    topUp: async (usd: number, mode?: "cover" | "exact", ctx?: TopUpContext) => {
      /**
       * A WALLET ACCOUNT NEVER SIGNS ANYTHING TO BE FUNDED. THIS BRANCH IS
       * THE STRUCTURAL GUARD, and it is here rather than at each door
       * because there were three doors and the fourth would have been
       * written the same way.
       *
       * What it used to do: convert $usd of the reader's SOL to USDC with
       * one Phantom signature. Reproduced on 2026-09-22 from the chip's
       * "You" room, where the door passes no amount at all: Phantom opened
       * on "+10.15 USDC, -0.088 SOL" — a trade the reader never asked for,
       * at a figure nobody chose (topUpAmount's $10 fallback), under a
       * button that said "Deposit".
       *
       * Lev, deciding it: "Convert SOL to USDC" exists as a product concept
       * in no app on earth — Jupiter, Phantom and Uniswap all route from
       * whatever you hold — so shipping it as a button or an offer would be
       * inventing a concept nobody recognises. Simplicity wins. So the
       * conversion is gone from the wallet path entirely: not relabelled,
       * and not offered as a remedy on the screen this lands on.
       *
       * The answer for a wallet account is "Add USDC to your wallet" and
       * the address. views/receive.tsx already IS that screen — it reads
       * wallet_mode === "external" && external_address and prints the
       * reader's OWN wallet address — so the destination existed all along
       * and only the routing was wrong. This restores the intent still
       * written in xStrip's fundRoute doc: a wallet account's door is the
       * panel's address screen, through topUp.
       *
       * WHY A WALLET TRADE NEEDS USDC AT ALL, so the next reader does not
       * "simplify" this into routing from SOL: the server proves an
       * external trade's SIZE by reading the USDC leg of the transaction
       * (apps/backend/src/spot/external-proof.util.ts, `executedUsd`), and
       * a trade with no USDC leg is `refuted` and never settles.
       * Generalising that proof is queued separately.
       *
       * NO AMOUNT IS INVENTED. A shortfall the reader's own buy implies is
       * carried through and rounded the way every other door rounds it; a
       * door pressed with no buy behind it (the "You" room's) carries
       * nothing, and the address screen then asks for nothing. `false`,
       * because no money has landed: the caller's contract is that
       * anything but `true` means the reader has been sent somewhere.
       */
      /*
       * THE ARC EDITION HAS NO PAGE-WALLET RAIL. The wallet a page injects
       * is a Solana one and the transfer it would sign comes from a route
       * arc-api does not serve, so every reader's door is the address
       * screen, which names the network and takes USDC from anywhere.
       * topUpFromPage refuses too; this branch only saves the account read.
       */
      if (!CAP.solanaRails) {
        openTopUp(
          typeof usd === "number" && usd > 0 ? topUpAmount(usd, mode ?? "cover") : undefined,
          ctx,
        )
        return false
      }
      const tw = await tradingWalletOf()
      if (tw.external) {
        sendTelemetry("x_fund_route", { route: "external", usd })
        openTopUp(
          typeof usd === "number" && usd > 0 ? topUpAmount(usd, mode ?? "cover") : undefined,
          ctx,
        )
        return false
      }
      return topUpFromPage(usd, (route) => sendTelemetry("x_fund_route", { route, usd }), mode, ctx)
    },
    fundRoute: async () => ((await tradingWalletOf()).external ? "external" : "custodial"),
    /**
     * THE INVITE DOOR. `landed` remembers that this browser saw a trade
     * land (once: the receipt line shows on the first only); `info` is the
     * reader's code and counts, null when signed out or unreachable. The
     * flag lives in local storage and dies with the session on purpose: a
     * new account gets its own first trade.
     */
    invite: !CAP.gamification ? undefined : {
      landed: async () => {
        const stored = await localGet(FIRST_TRADE_KEY)
        const had = Boolean(stored?.[FIRST_TRADE_KEY])
        if (!had) await localSet({ [FIRST_TRADE_KEY]: true })
        return { first: !had }
      },
      info: async () => {
        try {
          const s = await referralStats()
          if (!s?.code) return null
          const stored = await localGet(FIRST_TRADE_KEY)
          return {
            code: s.code,
            joined: Number(s.referrals_count ?? 0),
            earnedUsd: Number(s.total_earned_usd ?? 0),
            hasTraded: Boolean(stored?.[FIRST_TRADE_KEY]),
          }
        } catch {
          return null
        }
      },
    },
    /**
     * THE SEAT'S MULTIPLIER, for the receipt's "+N pts" line. 1 when signed
     * out or unreachable: a receipt that cannot say the points says none.
     */
    points: !CAP.gamification ? undefined : {
      status: async () => {
        try {
          const r = await poolStatus()
          const m = Number(r?.pool?.viewerCohortMult ?? 1)
          const s = Number(r?.pool?.viewerCohortRank ?? 0)
          return {
            mult: Number.isFinite(m) && m > 0 ? m : 1,
            seat: Number.isFinite(s) && s > 0 ? s : null,
          }
        } catch {
          return { mult: 1, seat: null }
        }
      },
    },
    // The ticks' own number for assets this chip does not watch.
    midPrices: async (mints) => {
      const out = new Map<string, number>()
      const r = await midPrices(mints).catch(() => null)
      for (const [mint, p] of Object.entries(r?.prices ?? {})) {
        if (p && typeof p.usd === "number" && p.usd > 0) out.set(mint, p.usd)
      }
      return out
    },
    // Same module the top-up itself uses, so the chip's promise and the
    // chip's behaviour cannot disagree about whether a page wallet exists.
    // The reader's own custodial address, for the route that needs no
    // wallet on the page and no hosted UI: they send USDC to it themselves.
    myAddress: async () => {
      try {
        const { WalletService } = await import("~/services/WalletService")
        const r: any = await WalletService.getMyWallet()
        return r?.wallet?.public_key ?? null
      } catch {
        return null
      }
    },
    // The reader's own username, for the share card's poppin.so/@handle
    // line. Asked at share time (a rare tap), answered null on any doubt —
    // the card falls back to the plain address rather than a broken one.
    myHandle: async () => {
      try {
        const { UserService } = await import("~/services/UserService")
        const me: any = await UserService.getCurrentUser()
        const h = me?.username ?? me?.data?.username
        return typeof h === "string" && /^[A-Za-z0-9_.]{1,30}$/.test(h)
          ? h
          : null
      } catch {
        return null
      }
    },
    // "No" in the Arc edition, whatever the page holds: the press opens the
    // address screen there, and the note says so instead of "You stay here."
    canFundHere: async () => {
      if (!CAP.solanaRails) return false
      const { hasPageWallet } = await import("~/helpers/pageWalletBridge")
      return hasPageWallet()
    },
    // Only the wording depends on this: the button says "Deposit from
    // wallet" where a wallet popup will actually appear, and "Deposit $X
    // USDC" where the door is the panel's address screen. (It said "Add
    // funds" here long after the label became "Deposit USDC" — see
    // tradeSheetModel, which is where the words actually live.) Loaded
    // lazily so a feed nobody trades on never pays for it.
    //
    // A WALLET ACCOUNT ANSWERS "NO" EVEN WITH PHANTOM RIGHT THERE, because
    // the question this really asks is "will a wallet popup open if I press
    // that button" — and since topUp stopped converting, it will not: the
    // press opens the address screen. Phantom being injected is exactly why
    // this used to answer yes, so the shortest path to a button promising a
    // popup that never comes is to leave this reading the page alone.
    //
    // The Arc edition answers "no" for the same reason: its topUp never
    // opens a popup either.
    hasWallet: async () => {
      if ((await tradingWalletOf()).external) return false
      if (!CAP.solanaRails) return false
      return (await import("~/helpers/pageWalletBridge")).hasPageWallet()
    },
    openTrade: (matched, side) => {
      // With the card off, the thin-tail "Trade" key (the one chip button
      // that used to raise the card) hands the reader to the sidebar on
      // this asset instead. The sidebar owns the money UI anyway.
      if (!PAGE_CARD_ENABLED) {
        openAssetInPanel(matched.mint, location.href)
        return
      }
      if (spotController && matched.mint === spotController.matchedAsset.mint) {
        spotController.expand(side)
        return
      }
      void startCardForMatch(matched).then((c) => {
        if (c) {
          spotController = c
          c.expand(side)
        }
      })
    },
    /**
     * Chrome clears runtime.id on an orphaned page — the one synchronous,
     * side-effect-free way to ask "is anything still behind me".
     */
    alive: () => Boolean(chrome.runtime?.id),
    /**
     * TELEMETRY IS NOT ALLOWED TO THROW. sendMessage rejects when the
     * service worker is asleep — the .catch handles that — but it THROWS
     * synchronously once this page's extension context is gone (reload,
     * auto-update), and a caught promise never sees a synchronous throw.
     * Every chip control reports before it acts, so that throw took the
     * whole feed's controls down with it, silently.
     */
    track: (event, payload) => {
      sendTelemetry(event, payload)
    },
  })
    .then((c) => {
      xStripCtl = c
    })
    .catch(() => {})
}

   // Render online count notification
   /**
         
     
    */
