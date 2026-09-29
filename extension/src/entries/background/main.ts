import { TOP_UP_INTENT_KEY, TOP_UP_INTENT_WATCH_MS, minutesSince, readTopUpIntent } from "~/helpers/topUpIntent"
import { PAGE_WALLET_VERSION } from "~/helpers/pageWalletProtocol"
import { whenSessionReady } from "~/helpers/sessionReady"
import { onAuthStateChanged, signInWithCustomToken } from "firebase/auth/web-extension"
import { jwtDecode } from "jwt-decode"
import { io, Socket } from "socket.io-client"
import browser from "webextension-polyfill"
import { failureReason } from "~/helpers/failureReason"
import { checkPermissions } from "~/helpers/permissionHelper"
import { initializeUrlListener } from "~/helpers/urlHelper"
import { backendApi, nextApi, whenAuthSettled } from "~/lib/axios"
import {
  fillNotification,
  ORDER_WATCH_ALARM,
  ORDER_WATCH_PERIOD_MIN,
  PENDING_FILLS_KEY,
  rememberFills,
  watchStep,
  type WatchedOrder,
} from "~/helpers/orderFillWatch"
import {
  alertNotification,
  alertsDue,
  FIRED_ALERTS_KEY,
  recordFired,
  type FiredAlert,
  PRICE_ALERTS_KEY,
  type PriceAlert,
  LOGOUT_SURVIVORS,
  survivesLogout,
} from "~/helpers/priceAlerts"
import { readBookCache, writeBookCache } from "~/helpers/bookCache"
import {
  siteAnonId,
  SITE_PRESENCE_ALARM,
  SITE_PRESENCE_ALARM_PERIOD_MIN,
  SITE_PRESENCE_PING_ROUTE,
  hostIsDark,
  rememberDark,
} from "~/helpers/presence"
import { siteChatHostFromUrl } from "~/helpers/siteChatHost"
import { fetchIconAsDataUri, ICON_FETCH } from "~/helpers/iconBridge"
import { BRAND_FETCH, fetchBrandAsDataUri } from "~/helpers/brandAssets"
import { terminalStage } from "~/helpers/telemetryStage"
import {
  NOTIFY_PREFS_KEY,
  readNotifyPrefs,
  shouldNotify,
  type NotifyKind,
} from "~/helpers/notifyPrefs"
import {
  buildDigest,
  DIGEST_KEY,
  digestDue,
  digestMint,
  MAX_WATCHED,
  WATCHLIST_KEY,
  type DigestState,
  type WatchedAsset,
} from "~/helpers/watchlist"
import {
  FOLLOW_MARKS_KEY,
  FOLLOW_SEEN_KEY,
  followTradeNews,
  followTradeNotification,
  people,
  type FollowTradeRow,
  type SpokenMarks,
} from "~/helpers/followTrades"
import { COPY_FROM_KEY, type CopyFrom } from "~/helpers/copyFrom"
import { readSharePrefs, SHARE_PREFS_KEY } from "~/helpers/sharePrefs"
import { ORDER_ORIGINS_KEY, takeOrigin } from "~/helpers/orderFillWatch"
import {
  DEPOSIT_CURSOR_KEY,
  DEPOSIT_SPOKEN_KEY,
  depositNotification,
  depositStep,
  GENESIS,
  shouldSpeak,
  SPEAK_CAP,
  SPOKEN_CAP,
  USDC_MINT,
} from "~/helpers/depositWatch"
import {
  moveNotification,
  POSITION_MARKS_KEY,
  positionMoves,
  type HeldPosition,
  type PositionMark,
} from "~/helpers/positionMoves"
import { auth } from "~/lib/firebase"
import { ARC_EDITION, CAP } from "~/config/edition"
import { clearWalletSession, decodeWalletToken, saveWalletSession } from "~/arc/walletSession"
import { ARC_API_HOST } from "~/helpers/signinRelay"
import { ARC_OPEN_CONFIRM } from "~/arc/ownWalletTrade"
import { NATIVE_SYMBOL } from "~/arc/chain"

/** Icon bytes by URL, worker-lifetime. null is cached too: a dead icon URL
 *  must not be re-fetched by every chip that scrolls past. */
const iconCache = new Map<string, string | null>()
import { storage } from "~/lib/store"

import { nanoid } from "nanoid"
import { useAppConfigStore } from "~/store/useAppConfigStore"
import { qtyText } from "~/helpers/qtyText"
import { askTabAwake, isNoReceiver, type TabAnswer } from "~/helpers/askTabAwake"

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

// Swallow the benign MV3 messaging-race rejections that otherwise spam the
// service-worker console as "Uncaught (in promise)". These happen when a
// tab's content script has unloaded (chrome://, PDFs, a tab mid-navigation)
// between a broadcast and its reply, or when no context answers a
// sendMessage — none of which is an actual fault. We only preventDefault for
// these specific known-benign messages; any other rejection still surfaces.
// BUG-009: previous substring matching could swallow legitimate errors
// whose message happens to include "message channel closed" etc. Use a
// precise regex set instead and ONLY match the canonical Chrome MV3
// messaging-race phrasings. Anything else falls through and surfaces.
const MV3_BENIGN_REJECTIONS: RegExp[] = [
  /^The message port closed before a response was received\.?$/,
  /^A listener indicated an asynchronous response by returning true.*the message channel closed/i,
  /^Could not establish connection\. Receiving end does not exist\.?$/,
]

self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  const reason: any = event?.reason
  const msg = String(reason?.message ?? reason ?? "")
  if (MV3_BENIGN_REJECTIONS.some((re) => re.test(msg))) {
    event.preventDefault()
  }
})


/**
 * TABS THIS EXTENSION CAN NEVER SCRIPT, AND WHY THE LIST MATTERS.
 *
 * On startup and on install the worker walks EVERY open tab and injects.
 * Most of them are pages; some of them are doors Chrome keeps shut, and
 * asking anyway throws. The throw was caught but logged with console.error,
 * and a console.error from a service worker lands in the extension's own
 * Errors panel — so an ordinary browser with an ordinary set of tabs open
 * painted that button red on every single reload.
 *
 * The cost of that is not the noise. It is that a panel which is always red
 * is a panel nobody reads, and the next real error arrives into a list that
 * already has eleven entries in it. The button has to mean something.
 *
 * The old filter had three schemes. These are the rest, and each one is a
 * refusal Chrome makes by policy, not a permission the user could grant:
 *
 *   chromewebstore.google.com   "The extensions gallery cannot be scripted."
 *   chrome.google.com/webstore  the same gallery at its previous address
 *   about: / data: / blob:      no host to hold a permission
 *   view-source:                the source viewer, not the document
 *   devtools: / chrome-*:       browser-owned surfaces
 *   edge: / extension:          the same doors on Chromium forks
 *
 * `file://` is DELIBERATELY ABSENT. It is scriptable when the reader has
 * ticked "Allow access to file URLs" and refused when they have not, so a
 * static filter would either lie or take the feature away from people who
 * opted in. It is classified from the error instead, below.
 */
const UNSCRIPTABLE_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-untrusted://',
  'chrome-search://',
  'chrome-native://',
  'devtools://',
  'moz-extension://',
  'extension://',
  'edge://',
  'about:',
  'data:',
  'blob:',
  'view-source:',
  'filesystem:',
]

/** The gallery, at both addresses it has used. */
const UNSCRIPTABLE_HOSTS = [
  'chromewebstore.google.com',
  'chrome.google.com/webstore',
]

/** Null when the tab is worth trying; a reason when it never was. */
export const unscriptableReason = (url: string): string | null => {
  const u = url.toLowerCase()
  for (const prefix of UNSCRIPTABLE_PREFIXES) {
    if (u.startsWith(prefix)) return prefix
  }
  for (const host of UNSCRIPTABLE_HOSTS) {
    if (u.startsWith(`https://${host}`) || u.startsWith(`http://${host}`)) return host
  }
  return null
}

/**
 * Is this failure one of Chrome's standing refusals rather than a fault?
 *
 * Everything the prefix list cannot decide in advance ends up here: a
 * file:// URL without the opt-in, a tab that closed while the loop was
 * walking it, a host outside the granted set. None of them is a defect and
 * none of them is actionable, so they are logged at debug and the Errors
 * panel stays for things that are.
 */
const EXPECTED_INJECTION_FAILURES = [
  'cannot be scripted',
  'cannot access contents of the page',
  'cannot access contents of url',
  'cannot access a chrome:// url',
  'extension manifest must request permission',
  'no tab with id',
  'the tab was closed',
  'frame with id',
  'showing error page',
]

const isExpectedInjectionFailure = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return EXPECTED_INJECTION_FAILURES.some((known) => message.includes(known))
}

/**
 * IS THIS FAILURE THE PRODUCT WORKING?
 *
 * site-chat is switched by its own 404 and nothing else. Three client
 * branches read `status === 404` and stand down: the module is not deployed,
 * the flag is off, or this host is not on the allowlist. All three are the
 * feature being correctly absent, and all three arrive as an axios rejection.
 *
 * Logged with console.error they became entries in chrome://extensions'
 * Errors panel — on every presence heartbeat, which is every few seconds on
 * every tab. Reported on 2026-09-11 as a red Errors button that came back
 * seconds after being cleared, sitting on top of the two content-script
 * refusals fixed earlier the same day.
 *
 * A panel that is always red is a panel nobody opens. This is the second
 * source feeding it noise and, like the first, the answer is not to stop
 * logging but to log it at the level it deserves: a fact about
 * configuration, not a fault.
 */
const isExpectedApiFailure = (url: string, status: number | undefined): boolean =>
  status === 404 && url.includes("/site-chat/")

// Function to inject content scripts into a tab
const injectContentScripts = async (tabId: number, url: string) => {
  try {
    // Check if we have scripting permission
    const hasPermission = await chrome.permissions.contains({
      permissions: ["scripting"]
    })
    
    if (!hasPermission) {
      console.log("No scripting permission, skipping content script injection")
      return
    }

    /* ONCE PER TAB, WHICHEVER DOOR. Only the onUpdated path asked whether
       the script was already there; startup, install and the
       INJECT_CONTENT_SCRIPTS message did not, and each of them can arrive
       for a tab that is already running it. A second run in the same
       isolated world is a second live instance with its own card. The
       probe lives here so no door can skip it. */
    if (await contentScriptAlreadyRunning(tabId)) {
      // The content script survives a reload; the MAIN-world bridge may not
      // have been there when that script arrived. Measured 2026-09-18 on
      // x.com: chips on the page, Phantom on the page, and the probe
      // unanswered. The bridge is ensured on its own, every time.
      await ensurePageWallet(tabId).catch(() => undefined)
      return
    }

    // Doors Chrome keeps shut: never ask, so nothing is ever logged for them.
    const shut = unscriptableReason(url)
    if (shut) {
      console.debug(`Skipping content script injection for ${shut} tab ${tabId}`)
      return
    }

    // Inject the primary content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/entries/contentScript/primary/main.js']
    })

    // Inject the URL listener script in MAIN world
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/entries/contentScript/urlListener.js'],
      world: 'MAIN'
    })

    // The page-wallet bridge, also MAIN world: an injected wallet
    // (window.solana) is invisible from the isolated world, and this is the
    // only way a surface ON a page can move USDC in from the wallet the
    // reader already has. It answers three questions and holds no state —
    // see entries/contentScript/pageWallet.ts.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/entries/contentScript/pageWallet.js'],
      world: 'MAIN'
    })

  } catch (error) {
    /* A standing refusal is not a defect. See EXPECTED_INJECTION_FAILURES:
       these are the answers Chrome gives for a file:// URL without the
       opt-in, a tab that closed mid-loop, or a host outside the granted
       set, and putting any of them in the Errors panel trains people to
       stop opening it. */
    if (isExpectedInjectionFailure(error)) {
      console.debug(`Content scripts not injected into tab ${tabId}:`, error)
      return
    }
    console.error(`Failed to inject content scripts into tab ${tabId}:`, error)
  }
}

/**
 * Is our content script already alive in this tab's CURRENT document?
 *
 * A few bytes of injected function, not the 425 KB bundle — this is what
 * makes injecting on BOTH 'loading' and 'complete' cheap. It reads the same
 * `window` sentinel the content script sets for its own idempotency, so the
 * document itself is the source of truth rather than a Map in a service
 * worker that Chrome is free to kill between the two events.
 *
 * Self-healing in the case that matters: if a 'loading' injection landed in
 * a document that was then discarded, the sentinel went with it, this
 * returns false, and 'complete' injects for real.
 */
/**
 * THE MAIN-WORLD BRIDGE, PRESENT AND CURRENT, OR ADDED. Reads pageWallet.ts's
 * own mark in the page's world and injects the file when it is missing —
 * or when what is there is OLDER than the bridge this extension ships.
 *
 * THE VERSION IS THE WHOLE POINT. The bridge is a page script: an update
 * replaces the extension and leaves every open tab holding the previous one.
 * This used to ask "is the mark set" and answer "already there" to a bridge
 * from before `signMessage` existed, so the one thing re-injection is for —
 * rescuing a tab that never reloaded — could not happen. It asks for a
 * version now, and the number is passed in rather than written twice, so a
 * bump in helpers/pageWalletProtocol.ts reaches this gate on its own.
 * Idempotent, and quiet on tabs that cannot be scripted.
 */
async function ensurePageWallet(tabId: number): Promise<boolean> {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      /* Serialized into the page, so it can reference nothing but its own
         argument: the `true` of the first bridge is spelled out here as
         version 1 exactly as claimedPageWalletVersion spells it. */
      func: (want: number) => {
        const mark = (window as unknown as { __poppinPageWallet?: boolean | number })
          .__poppinPageWallet
        const have = typeof mark === "number" ? mark : mark === true ? 1 : 0
        return have >= want
      },
      args: [PAGE_WALLET_VERSION],
    })
    if (r?.result === true) return true
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/entries/contentScript/pageWallet.js'],
      world: 'MAIN',
    })
    return true
  } catch (error) {
    if (!isExpectedInjectionFailure(error)) {
      console.debug(`Page wallet bridge not ensured in tab ${tabId}:`, error)
    }
    return false
  }
}

async function contentScriptAlreadyRunning(tabId: number): Promise<boolean> {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        (window as unknown as { __poppinContentScriptLoaded?: boolean })
          .__poppinContentScriptLoaded === true,
    })
    return r?.result === true
  } catch {
    // No permission, no tab, a page Chrome refuses to script. Answering
    // "not running" just means the real injection gets its own attempt and
    // fails the same way, in the place that already handles it.
    return false
  }
}

/**
 * Inject at the EARLIEST moment the tab can take the script.
 *
 * This used to fire only on status==='complete', and that was the single
 * biggest reason the trade card felt slow. 'complete' is the `load` event:
 * it waits for every ad, tracker, font and image on the page. Measured on
 * CoinGecko's dogwifhat page — 239 resources — the DOM was readable at
 * 1240 ms and 'complete' did not fire until 3915 ms. The content script sat
 * unstarted for that whole 2.7 s, and on a slower load the owner clocked the
 * card at about ten seconds. None of that time was ours; we were queued
 * behind somebody else's advertising.
 *
 * 'loading' fires when the navigation COMMITS, so the document exists and
 * the script can start reading it as it fills. Waiting for the page to
 * actually have content is the content script's own job now — see
 * whenPageIsReadable in attachSpotCard.ts, which polls for text rather than
 * guessing at a duration.
 *
 * WHY THIS DOES NOT REINSTATE THE DOUBLE-PARSE. The previously-paired
 * `tabs.onCreated` handler was removed because every fresh tab parsed the
 * 425 KB bundle TWICE, doubling React-root, listener and polling setup. The
 * probe above is why the pairing is safe this time: 'complete' asks the
 * document whether the script is already there and skips the bundle when it
 * is. Two events, still one parse.
 *
 * A manifest-declared content script with run_at document_idle would be the
 * textbook fix and is deliberately NOT used: <all_urls> is optional here on
 * purpose (see manifest.ts), and declaring content_scripts would force the
 * install-time "read and change all your data" warning this extension is
 * built to avoid.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = tab.url
  if (!url) return
  if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return
  if (await contentScriptAlreadyRunning(tabId)) {
    // The bridge is a whole web3.js now, so it goes in ahead of time only
    // where the chip trades; every other page gets it on demand
    // (ENSURE_PAGE_WALLET) the first time a door needs Phantom.
    if (changeInfo.status === 'complete' && /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|reddit\.com)\//.test(url)) {
      await ensurePageWallet(tabId).catch(() => undefined)
    }
    return
  }
  injectContentScripts(tabId, url)
})

// Inject content scripts into existing tabs when the extension starts
chrome.runtime.onStartup.addListener(async () => {
  /**
   * THE FIRST LOOK HAPPENS NOW, NOT TWO MINUTES FROM NOW. Alerts and
   * fills are only ever checked while Chrome runs, so a price crossed
   * overnight is discovered at the first tick after start; the alarm's
   * first tick was up to a period away. Ask at once, after Firebase has
   * rehydrated. Failures here are the next tick's problem.
   */
  void whenAuthSettled().then(async () => {
    try {
      await checkPriceAlerts()
    } catch {}
    try {
      await checkOrderFills()
    } catch {}
  })
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        await injectContentScripts(tab.id, tab.url)
      }
    }
  } catch (error) {
    console.error('Failed to inject content scripts on startup:', error)
  }
})

/**
 * THE UNINSTALL PAGE OPENS AFTER THE EXTENSION IS GONE, so anything it
 * should know has to ride the URL — and the URL can be refreshed any time
 * before that moment. Three coarse facts, no identity:
 *
 *   v — extension version (which build produced this departure)
 *   t — 1 when a buy ever LANDED (the clip is only ever written by a
 *       landed buy, which makes its existence a perfect on-device proxy;
 *       nothing is fetched to answer this)
 *   d — whole days since install
 *
 * Together they turn a pile of identical "reason" strings into cohorts:
 * "chips didn't show up" from someone who traded for three weeks is a
 * regression report; the same words from a 0-day never-funded install is
 * an onboarding report. Without this every submission reads the same.
 *
 * Deliberately NO user id and no token — the page is anonymous by design
 * (see apps/auth/app/uninstall/UninstallFlow.tsx), and the privacy stance
 * (SCOPE.md) is that identity is never attached to feedback.
 */
const INSTALL_TS_KEY = "poppin_installed_at"
const CLIP_STORAGE_KEY = "poppin_clip"
const uninstallBase = process.env.NEXT_PUBLIC_WEB_URL
  ? `${process.env.NEXT_PUBLIC_WEB_URL}/uninstall`
  : "https://app.poppin.so/uninstall"

async function refreshUninstallUrl() {
  try {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get([CLIP_STORAGE_KEY]),
      chrome.storage.sync.get([INSTALL_TS_KEY]),
    ])
    const traded = local?.[CLIP_STORAGE_KEY] !== undefined
    const ts = Number(sync?.[INSTALL_TS_KEY])
    const days = Number.isFinite(ts) && ts > 0
      ? Math.max(0, Math.floor((Date.now() - ts) / 86_400_000))
      : null
    const q = new URLSearchParams({ v: chrome.runtime.getManifest().version })
    if (traded) q.set("t", "1")
    if (days !== null) q.set("d", String(days))
    /* The install's own random id, so a departure can finally be joined to
       the funnel rows the same install wrote while it lived. Without it an
       uninstall is a version and a day-count floating free — you can count
       them, and could never once say "this leaver is the person who saw
       forty chips and never signed in". Still nothing about the person:
       the id is minted by us, random, and dies with this row. */
    const anon = await anonInstallId()
    if (anon) q.set("u", anon)
    await chrome.runtime.setUninstallURL(`${uninstallBase}?${q}`)
  } catch {
    // A plain URL is strictly better than none: the page still works, the
    // segmentation is what degrades.
    void chrome.runtime.setUninstallURL(uninstallBase)
  }
}
void refreshUninstallUrl()
// The one fact that changes mid-life is "have they traded", and it changes
// exactly when the clip is first written.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[CLIP_STORAGE_KEY]) void refreshUninstallUrl()
})

// Also inject when extension is installed/enabled
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    browser.storage.local.set({
      isFirstInstall: true
    })

    /* The first event this install will ever send, which also MINTS the
       anon id: nobody is signed in at install time, so this takes the 401
       road and creates the identity every later signed-out event reuses.
       The store's own install count refreshes daily and cannot be joined
       to anything; this one can. */
    deliverTelemetry("extension_installed", {
      version: chrome.runtime.getManifest().version,
    })

    // In SYNC storage like the welcome flag below, and for the same
    // reason: local is wiped on uninstall, and the whole point of this
    // timestamp is to be readable at the end of the story. A reinstall
    // keeps the ORIGINAL date on purpose ({ [k]: v } only when absent
    // would be ideal, but a second install overwriting it loses little:
    // the second departure's tenure is what we are measuring then).
    void chrome.storage.sync
      .get(["poppin_installed_at"])
      .then((got) =>
        got?.poppin_installed_at
          ? undefined
          : chrome.storage.sync.set({ poppin_installed_at: Date.now() }),
      )
      .then(() => refreshUninstallUrl())

    // Open the welcome flow only the first time this Chrome profile sees
    // the extension. We persist the flag in chrome.storage.sync so that
    // uninstall+reinstall on the same Google-synced Chrome doesn't pop the
    // tab again — the user already went through the flow once. (Local
    // storage is wiped on uninstall, sync is preserved if Chrome sync is
    // on for this profile, which is the common case.) When sync is off we
    // fall through and show it again — acceptable; can't reliably detect
    // a returning user without their account.
    try {
      const synced = await chrome.storage.sync.get("poppinHasSeenOnboarding")
      if (!synced?.poppinHasSeenOnboarding) {
        const url = browser.runtime.getURL("src/entries/welcome/index.html")
        browser.tabs.create({ url })
      }
    } catch (err) {
      // If sync read fails for any reason (offline, quota), default to
      // opening the welcome page — better one extra tab than zero
      // onboarding for a real first-time user.
      const url = browser.runtime.getURL("src/entries/welcome/index.html")
      browser.tabs.create({ url })
    }
  }


   const effectiveUserId = nanoid()
   useAppConfigStore.getState().setAnonymousId("nid-" + effectiveUserId)

  // (Community notes retired with V2-PLAN.md Faz A — 7 notes all-time. The
  // context menu, its injected selection-capture script and the editor UI all
  // left together; recoverable from git history if the feature returns.)

  // Inject content scripts into existing tabs
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        await injectContentScripts(tab.id, tab.url)
      }
    }
  } catch (error) {
    console.error('Failed to inject content scripts on install:', error)
  }
})



// Function to broadcast store updates to all tabs and extension views
export const broadcastStoreUpdate = async (storeName: string, state: any) => {
  const tabs = await chrome.tabs.query({ currentWindow: true })

  // Send to all tabs
  tabs.forEach((tab) => {
    if (tab.id) {
      chrome.tabs
        .sendMessage(tab.id, {
          action: "UPDATE_ZUSTAND",
          name: storeName,
          state,
        })
        .catch(() => {
          // Ignore errors for inactive tabs
        })
    }
  })

  // Send to extension views (popup, etc.)
  chrome.runtime
    .sendMessage({
      action: "UPDATE_ZUSTAND",
      name: storeName,
      state,
    })
    .catch(() => {
      // Ignore errors if no listeners
    })
}


// Mesaj isteklerini yönet
/**
 * The chip and card speak a richer vocabulary than the backend enum, which
 * has six funnel slots. This is the whole translation, in one place: an
 * event with no home here is dropped, never guessed at.
 */
const TELEMETRY_MAP: Record<string, string> = {
  // Something tradeable was recognised and drawn.
  /* The top of the funnel, which nothing emitted until the strip learned to
     count its own verdicts. One summary per document, carrying how many
     chances it had and how many it took — see helpers/scanTally for why it
     is not a row per tweet. */
  x_page_scanned: "page_scanned",

  card_shown: "card_shown",
  x_strip_shown: "card_shown",
  /* The same enum value on purpose. `x_strip_shown` says a chip was
     mounted and this says a reader actually held it on screen; they are
     two readings of one moment, told apart by metadata.event, and a new
     event_type would have cost an enum migration to say the same thing. */
  x_strip_seen: "card_shown",
  // A dwell, not a touch: shown-class so "touched" stays honest.
  x_strip_hover: "card_shown",
  x_invite_shown: "card_shown",
  // The founding seat, announced on the one receipt that claimed it.
  x_seat_claimed: "card_shown",
  x_invite_copy: "card_interacted",
  panel_door: "card_interacted",
  // Somebody touched it.
  card_interacted: "card_interacted",
  x_strip_click: "card_interacted",
  x_strip_chart: "card_interacted",
  x_strip_open_panel: "card_interacted",
  x_strip_open_home: "card_interacted",
  x_price_alert: "card_interacted",
  x_order_topup: "card_interacted",
  // The scoreboard and the funding box — the only route to funding now,
  // so an unmapped event here is a funnel stage measured as zero. All
  // three shipped unmapped and were dropped at the "no home here" line
  // below, which is this file's own rule working exactly as written
  // against exactly the wrong events.
  x_strip_you_open: "card_interacted",
  x_fund_press: "card_interacted",
  x_fund_copy_address: "card_interacted",
  x_trade_share: "card_interacted",
  // Money. The card already speaks the enum's own names for the outcome
  // pair, which the chip does not emit — its receipt is inline.
  swap_submitted: "swap_submitted",
  swap_confirmed: "swap_confirmed",
  swap_failed: "swap_failed",
  x_inline_buy: "swap_submitted",
  x_inline_sell: "swap_submitted",
  x_inline_order: "swap_submitted",
  // FIVE MORE THAT WERE BEING FIRED AND DROPPED. The rule below — an event
  // with no home here is dropped, never guessed at — is right, and it had
  // been quietly deleting real funnel steps for a second time. x_strip_hold_buy
  // is somebody committing to a buy; x_signin_from_sheet is the conversion
  // this whole funnel is pointed at. Measuring either as zero is worse than
  // not claiming to measure it.
  x_strip_hold_buy: "card_interacted",
  x_signin_from_sheet: "card_interacted",
  x_fund_route: "card_interacted",
  x_you_flex: "card_interacted",
  x_you_row_open: "card_interacted",
  // ── the activation corridor (1.0.290) ──────────────────────────────────
  // These keep their own names instead of folding into card_interacted,
  // because the question they answer is WHERE people stop between
  // installing and trading, and a bucket cannot answer a where. The
  // backend accepts all six as of the same day this map learned them.
  extension_installed: "extension_installed",
  onboarding_step: "onboarding_step",
  onboarding_handoff: "onboarding_handoff",
  signin_completed: "signin_completed",
  panel_opened: "panel_opened",
  panel_view: "panel_view",
  x_you_tab: "card_interacted",
  // The two-sentence coach over the first chip: an onboarding step that
  // happens on X rather than on the welcome page, filed with the others.
  x_coach: "onboarding_step",
  deposit_landed: "deposit_landed",
  // The deposit funnel's first two steps, from the panel's address screen.
  receive_opened: "panel_view",
  receive_copy_address: "card_interacted",
  receive_blink_open: "card_interacted",
  receive_phantom_topup: "card_interacted",
  /* THE PANEL'S OWN FUNDING DOOR (components/FundDoor.tsx), which shipped
     counting nothing at all — no impression, no press, nothing on the
     connect — while the question of the week was where between the panel and
     the money people stop. Five names, because the door has five distinct
     moments and a single "interacted" could not tell a reader who saw it from
     one who tried to connect and was refused. They keep the enum's own
     shown/interacted shape; WHICH moment it was rides in metadata.event,
     which deliverTelemetry writes on every row. */
  panel_fund_shown: "card_shown",
  panel_fund_press: "card_interacted",
  panel_fund_connect: "card_interacted",
  panel_fund_connected: "card_interacted",
  panel_fund_connect_refused: "card_interacted",
}

/**
 * THE INSTALL'S OWN NAME FOR ITSELF, AND NOTHING ELSE'S.
 *
 * A random UUID made once in this browser and kept in extension storage. It
 * is not derived from the reader, the machine, the account or any page; it
 * cannot be looked up anywhere; and it means nothing outside this install.
 * Its single job is to let two chips an hour apart be recognised as the same
 * install, which is the difference between a funnel and a pile of counts.
 *
 * Only ever sent to the anonymous ingest, and only when there is no signed-in
 * user to attribute the event to instead.
 */
/**
 * Money moved: every chip with a sheet up re-reads its balance now, not at
 * its next 10-second beat. The deposit watcher says it when a transfer
 * lands; the panel's address screen says it the moment its own 10-second
 * watch sees the balance rise, which is usually earlier.
 */
function broadcastBookChanged(): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined || !/^https?:/.test(tab.url ?? "")) continue
      chrome.tabs.sendMessage(tab.id, { type: "POPPIN_BOOK_CHANGED" }, () => {
        void chrome.runtime.lastError
      })
    }
  })
}
const ANON_ID_KEY = "poppin_anon_install_id"
const ANON_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let anonIdCache: string | null = null

async function anonInstallId(): Promise<string | null> {
  if (anonIdCache) return anonIdCache
  try {
    const got = await chrome.storage.local.get(ANON_ID_KEY)
    const existing = got?.[ANON_ID_KEY]
    if (typeof existing === "string" && ANON_ID_RE.test(existing)) {
      anonIdCache = existing
      return existing
    }
    const made = crypto.randomUUID()
    await chrome.storage.local.set({ [ANON_ID_KEY]: made })
    anonIdCache = made
    return made
  } catch {
    // Storage unavailable. A measurement must never be able to stop the
    // thing it measures, so this reports nothing rather than throwing.
    return null
  }
}


/**
 * THE ONE ROAD EVERY MEASUREMENT TAKES.
 *
 * This body used to live inline in the SPOT_TELEMETRY message handler,
 * which was fine while content scripts were the only callers. The
 * activation events changed that: install, sign-in and deposit are facts
 * the BACKGROUND witnesses, and a background cannot sendMessage to
 * itself. Extracted rather than copied, because the 401 fallback below is
 * exactly the kind of logic that drifts when it exists twice.
 *
 * Fire-and-forget on purpose: no await, no retry, no throw. A measurement
 * must never be able to stop the thing it measures.
 *
 * A TRADE THAT LANDED IS TWO FACTS, NOT ONE. The three trade events map
 * to swap_submitted; the outcome rides in the payload's `kind`, and
 * terminalStage turns it into the ADDITIONAL row (swap_confirmed /
 * swap_failed) so the funnel's stages nest — a landed trade was also
 * sent, and a "landed" count that excluded itself from "sent" would make
 * the conversion between them meaningless.
 *
 * A 401 IS NOT A FAILURE, IT IS THE ANSWER. The chip draws for signed-out
 * readers too, and so does the whole onboarding: those events belong to
 * somebody who has SEEN the product and not signed up, which is the
 * population a funnel most needs. They retry once through the anonymous
 * route with the install's own id. Offline, 500s and everything else go
 * nowhere on purpose — none of it is the reader's problem.
 */
function deliverTelemetry(event: string, payload: unknown): void {
  // The Arc edition's backend keeps no funnel; every sender lands here, so
  // this one line is the whole switch.
  if (!CAP.telemetry) return
  const type = TELEMETRY_MAP[event]
  if (!type) return
  /* THE INSTALL ID RIDES ALONG EVEN WHEN SOMEBODY IS SIGNED IN.
     It used to be fetched only in the 401 handler, which meant every event
     from a signed-in reader was filed under the account and nothing else.
     Measured 2026-09-21 in production: not one row in user_events carried a
     user_id and an anon_id together, so the same person before and after
     their sign-in was two strangers, and the install-to-sign-in step could
     only ever be guessed at by matching timestamps. Sending it on both
     paths costs one storage read, cached after the first, and makes the
     join exact from the day it ships. */
  void (async () => {
    const anon_id = await anonInstallId()
    const data = {
      event_type: type,
      /* Omitted rather than sent as null when storage is unavailable: the
         backend's shape check refuses anything that is not a UUID, and an
         event recorded under the account alone is what happened before. */
      ...(anon_id ? { anon_id } : {}),
      metadata: { event, ...((payload as Record<string, unknown>) ?? {}) },
    }
    const outcome = terminalStage(type, payload)
    if (outcome) {
      void backendApi({
        url: "/user-events",
        method: "POST",
        data: { ...data, event_type: outcome },
      }).catch(() => undefined)
    }
    void backendApi({ url: "/user-events", method: "POST", data }).catch(
      async (err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response
          ?.status
        if (status !== 401) return
        if (!anon_id) return
        await backendApi({
          url: "/user-events/anon",
          method: "POST",
          data: { anon_id, ...data },
        }).catch(() => {})
      },
    )
  })()
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // The content-script relay's half of extension-signin — the channel that
  // exists in every Chromium, unlike onMessageExternal (absent in Brave).
  // Only our own content scripts can send here, and the relay only installs
  // on poppin.so origins; the tab-URL check mirrors that anyway, because a
  // token handler should not take anyone's word for where it came from.
  // THE ARC EDITION'S WALLET SIGN-IN: arc-api's own page (/auth/wallet)
  // announces an arcw_ session, relayed from that exact host only.
  if (request?.action === "arc-wallet-signin") {
    let host = ""
    try {
      host = new URL(sender.tab?.url ?? "").hostname
    } catch {
      // no tab URL: not the relay's shape
    }
    if (!ARC_EDITION || !ARC_API_HOST || host !== ARC_API_HOST) {
      sendResponse({ success: false, error: "wrong origin" })
      return true
    }
    void handleArcWalletSignin(request.token, sendResponse, sender.tab?.id)
    return true
  }

  // THE ARC EDITION'S CONFIRM WINDOW (arc/ownWalletTrade.ts): the page where
  // an account's own wallet approves a trade. Opened for the chip and the
  // panel alike, and only ever arc-api's own confirm page.
  if (request?.type === ARC_OPEN_CONFIRM) {
    void openArcConfirm(request.url, request.id).then(sendResponse)
    return true
  }
  // arc-api's wallet page in connect mode, relayed from its exact host: the
  // wallet is connected, and the account reads it on its next /users/me.
  if (request?.action === "arc-wallet-linked") {
    let host = ""
    try {
      host = new URL(sender.tab?.url ?? "").hostname
    } catch {
      // no tab URL: not the relay's shape
    }
    if (ARC_EDITION && ARC_API_HOST && host === ARC_API_HOST && sender.tab?.id !== undefined) {
      const tabId = sender.tab.id
      setTimeout(() => void chrome.tabs.remove(tabId).catch(() => {}), 1500)
    }
    sendResponse({ ok: true })
    return true
  }
  // That page, relayed from arc-api's exact host, saying the wallet is done.
  if (request?.action === "arc-trade-done") {
    let host = ""
    try {
      host = new URL(sender.tab?.url ?? "").hostname
    } catch {
      // no tab URL: not the relay's shape
    }
    if (!ARC_EDITION || !ARC_API_HOST || host !== ARC_API_HOST || typeof request.id !== "string") {
      sendResponse({ ok: false })
      return true
    }
    arcTradeDone(request.id)
    sendResponse({ ok: true })
    return true
  }

  if (request?.action === "extension-signin") {
    const from = sender.tab?.url ?? ""
    let host = ""
    try {
      host = new URL(from).hostname
    } catch {
      // no tab URL: not the relay's shape
    }
    if (!/(^|\.)poppin\.so$/.test(host)) {
      sendResponse({ success: false, error: "wrong origin" })
      return true
    }
    handleExtensionSignin(request.token, sendResponse, sender.tab?.id)
    return true // async response
  }

  // A card mounted/closed for this mint (attachSpotCard's watchPrice /
  // unwatchPrice). No sendResponse: the content script fires these
  // fire-and-forget. Ticks ride their OWN public socket now (see
  // ensureTicksSocket) — they used to ride chat's authenticated one, which
  // meant signed-out readers never got a live price and chat's removal
  // would have frozen every card.
  if (request.type === "POPPIN_WATCH_PRICE") {
    watchPriceMint(request.mint, request.host)
    return false
  }
  if (request.type === "POPPIN_UNWATCH_PRICE") {
    unwatchPriceMint(request.mint, request.host)
    return false
  }




  if(request.type === "openTab"){
    chrome.tabs.create({ url: request.payload.url })
    sendResponse({ success: true })
    return true
  }



  /**
   * The panel asking what the page it is docked next to makes tradeable.
   *
   * Relayed through the background ON PURPOSE. The panel calling
   * chrome.tabs itself worked in a test build and failed in the wild: the
   * tabs permission is OPTIONAL in the shipped manifest, the panel is not a
   * tab (so "active tab" resolution differs), and a page whose content
   * script has not finished booting answers nothing. The background always
   * holds the permissions and can tell the difference between "no readable
   * page" and "the page has not answered yet" — so it answers with a REASON,
   * and the panel renders that instead of guessing.
   */
  /**
   * "Open the card on the page, for THIS asset."
   *
   * Relayed for the same reason the candidate lookup is: the panel calling
   * chrome.tabs itself is the path that silently did nothing when tapped.
   * The asset travels with the request because the card only ever held the
   * page's winning match, which made every runner-up row in the Trades tab
   * a button that appeared broken.
   */
  /**
   * A post landed from the panel. Two page surfaces care: the in-page toast
   * (which until now only ever showed CHAT messages — the reader's own post
   * appearing there is the same "someone said something here" event) and the
   * trade card's conversation, which fetches once at mount and would
   * otherwise show a stale count until a full reload.
   */
  if (request.type === "PAGE_POST_CREATED") {
    ;(async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs?.[0]
        if (!tab?.id) return
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "NEW_MESSAGE",
            payload: {
              id: `post-${Date.now()}`,
              createdAt: Date.now(),
              ...request.payload,
            },
          },
          () => void chrome.runtime.lastError,
        )
        chrome.tabs.sendMessage(tab.id, { type: "POPPIN_POSTS_REFRESH" }, () => {
          void chrome.runtime.lastError
        })
      } catch {}
    })()
    return false
  }

  if (request.type === "OPEN_TRADE_CARD") {
    ;(async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs?.[0] ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))?.[0]
        if (!tab?.id) {
          sendResponse({ ok: false, reason: "no_tab" })
          return
        }
        chrome.tabs.sendMessage(
          tab.id,
          { type: "POPPIN_SPOT_EXPAND", asset: request.asset ?? null, side: request.side ?? "buy" },
          (res) => {
            void chrome.runtime.lastError
            sendResponse(res ?? { ok: false, reason: "no_content_script" })
          },
        )
      } catch {
        sendResponse({ ok: false, reason: "no_tab" })
      }
    })()
    return true
  }

  if (request.type === "ENSURE_PAGE_WALLET") {
    // The chip probed for the bridge and heard nothing: put it there now.
    const tabId = sender.tab?.id
    if (tabId === undefined) {
      sendResponse({ ok: false })
      return true
    }
    ensurePageWallet(tabId).then((ok) => sendResponse({ ok }))
    return true
  }
  if (request.type === "BOOK_CHANGED_NOW") {
    broadcastBookChanged()
    sendResponse({ ok: true })
    return true
  }
  if (request.type === "EXTERNAL_TRADE") {
    /**
     * THE PANEL CANNOT SIGN; THE PAGE BESIDE IT CAN. Phantom injects into
     * web pages, never into this extension's own pages, so a wallet
     * account's trade from the side panel is handed to the active tab's
     * content script, which owns the MAIN-world bridge (pageWallet.ts).
     * Same tab lookup as the page-candidates ask below.
     */
    ;(async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs?.[0] ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))?.[0]
        if (!tab?.id || (tab.url && !/^https?:/.test(tab.url))) {
          sendResponse({
            ok: false,
            error: "Open X, Reddit or any web page beside the panel, then try again.",
          })
          return
        }
        const tabId = tab.id
        // A tab opened before Poppin was installed has no content script
        // yet; it is woken and asked again (helpers/askTabAwake).
        const res = await askTabAwake({
          ask: () =>
            new Promise<TabAnswer>((resolve) => {
              chrome.tabs.sendMessage(tabId, { type: "POPPIN_EXTERNAL_TRADE", args: request.args }, (r) => {
                const err = chrome.runtime.lastError?.message
                resolve({ res: r, noReceiver: r === undefined && isNoReceiver(err) })
              })
            }),
          wake: () => injectContentScripts(tabId, tab.url ?? ""),
        })
        sendResponse(
          res ?? {
            ok: false,
            error: "The page beside the panel did not answer. Reload it and try again.",
          },
        )
      } catch (e) {
        sendResponse({ ok: false, error: (e as Error)?.message ?? "Could not reach the page." })
      }
    })()
    return true
  }
  if (request.type === "GET_PAGE_CANDIDATES") {
    ;(async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs?.[0] ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))?.[0]
        // An ABSENT url is not a non-web page: chrome only fills tab.url when
        // the host permission is granted, and shipping the strict check would
        // have told every production user their news article was not a web
        // page. Only a url we can see AND that is not http(s) disqualifies.
        if (!tab?.id || (tab.url && !/^https?:/.test(tab.url))) {
          sendResponse({ candidates: [], reason: "not_a_web_page" })
          return
        }
        const ask = () =>
          new Promise<any>((resolve) => {
            chrome.tabs.sendMessage(tab.id!, { type: "POPPIN_SPOT_CANDIDATES" }, (res) => {
              void chrome.runtime.lastError
              resolve(res)
            })
          })
        let res = await ask()
        if (!res) {
          // One retry: the content script boots after the page, and a panel
          // opened the instant a tab loads will beat it there.
          await new Promise((r) => setTimeout(r, 1200))
          res = await ask()
        }
        if (!res) {
          sendResponse({ candidates: [], reason: "no_content_script" })
          return
        }
        sendResponse({
          candidates: res.candidates ?? [],
          reason: res.error ? "lookup_failed" : "ok",
        })
      } catch (e) {
        sendResponse({ candidates: [], reason: "lookup_failed" })
      }
    })()
    return true
  }

  /**
   * Token icons for the page surfaces. The page cannot fetch them — the
   * host's CSP (measured on x.com: img-src is its own hosts + data:) blocks
   * every icon CDN — but this worker answers to no page's policy. Bytes go
   * back as a data URI, which that same policy allows. Cached here so a
   * feed of twenty identical chips costs one fetch.
   */
  if (request.type === ICON_FETCH) {
    const url = typeof request.url === "string" ? request.url : ""
    const hit = iconCache.get(url)
    if (hit !== undefined) {
      sendResponse({ dataUri: hit })
      return true
    }
    fetchIconAsDataUri(url)
      .then((dataUri) => {
        // Successes only: a null here is a FAILED fetch, and caching it
        // turned one slow gateway moment into a whole session of initial
        // discs. The next chip retries; a real success then sticks.
        if (dataUri !== null) {
          if (iconCache.size > 150) iconCache.clear()
          iconCache.set(url, dataUri)
        }
        sendResponse({ dataUri })
      })
      .catch(() => sendResponse({ dataUri: null }))
    return true
  }

  /**
   * THE BRAND FOR THE FLEX CARD: PoppinSans and the mark, read out of the
   * extension's own files and handed back as data URIs. Keyed by an
   * allowlist in brandAssets, never by a path from the page, so this cannot
   * be used to read anything else the extension can see. See brandAssets
   * for why this is fetched on demand rather than embedded.
   */
  if (request.type === BRAND_FETCH) {
    fetchBrandAsDataUri(request.key)
      .then((dataUri) => sendResponse({ dataUri }))
      .catch(() => sendResponse({ dataUri: null }))
    return true
  }

  /**
   * TELEMETRY, WHICH HAD NO HANDLER AND NEVER HAD ONE.
   *
   * Both content scripts have been firing
   * `sendMessage({ type: "SPOT_TELEMETRY", event, payload })` since the chip
   * shipped, at a service worker that has never listened for it. Every
   * track() call in the product went nowhere — so no rate, no funnel and no
   * claim about any of it has ever been measurable. (Until today it could
   * also THROW on an orphaned page and take the pressed control down with
   * it; that half is fixed, this is the other.)
   *
   * The six funnel event types have existed in the backend enum and in
   * UserEventsService.recordEvent since August, with zero callers. So this
   * connects two finished halves rather than inventing a third.
   *
   * Fire-and-forget on purpose: no sendResponse, no await, no retry. A
   * measurement must never be able to stop the thing it measures, and the
   * chip's own track() is already wrapped so it cannot throw either.
   *
   * Only funnel events cross. The chip emits richer names of its own
   * (x_strip_click, x_inline_buy…) which the enum has no room for; they are
   * mapped, not smuggled, and anything unmapped is dropped here rather than
   * sent for the server to refuse.
   */
  if (request.type === "SPOT_TELEMETRY") {
    deliverTelemetry(String(request.event ?? ""), request.payload)
    return false
  }

  if (request.type === "API_REQUEST") {
    const { url, method, data, params, apiType, headers } = request.payload
    if (process.env.POPPIN_TEST_BUILD === "true" && String(url).includes("/embed/asset/"))
      console.info(`[poppin-spot] SW: API_REQUEST received for ${url}`)

    // Special handling for file uploads
    if (url === "/upload" && data?.file) {
      // Convert base64 back to FormData
      fetch(`data:${data.contentType};base64,${data.file}`)
        .then((res) => res.blob())
        .then((blob) => {
          const formData = new FormData()
          formData.append("file", blob, data.filename)

          const config = {
            url,
            method,
            data: formData,
            params,
            headers: {
              ...headers,
              "Content-Type": "multipart/form-data",
            },
          }

          return apiType === "next" ? nextApi(config) : backendApi(config)
        })
        .then((res) => {
          sendResponse({ data: res.data })
        })
        .catch((err) => {
          console.error("Background Axios error:", err)
          sendResponse({
            error: {
              status: err?.response?.status ?? 500,
              message:
                err?.response?.data?.message ?? err?.message ?? "Unknown error",
            },
          })
        })

      return true
    } else {
      // Handle non-file requests as before
      const config = {
        url,
        method,
        data,
        params,
        headers,
      }
      if (apiType === "next") {
        nextApi(config)
          .then((res) => {
            sendResponse({ data: res.data })
          })
          .catch((err) => {
            const status = err?.response?.status as number | undefined
            // The reason goes IN the line: chrome://extensions flattens a
            // second console argument, so `console.error(line, detail)`
            // printed "[object Object]" for every refusal we ever logged.
            const line = `Background Axios error: ${method} ${url} -> ${status ?? "??"} ${failureReason(err)}`
            // See isExpectedApiFailure: a switched-off feature is not a fault.
            if (isExpectedApiFailure(String(url), status)) console.debug(line)
            else console.error(line)
            sendResponse({
              error: {
                status: err?.response?.status ?? 500,
                message:
                  err?.response?.data?.message ??
                  err?.message ??
                  "Unknown error",
              },
            })
          })
      } else {
        backendApi(config)
          .then((res) => {
            sendResponse({ data: res.data })
          })
          .catch((err) => {
            const status = err?.response?.status as number | undefined
            // The reason goes IN the line: chrome://extensions flattens a
            // second console argument, so `console.error(line, detail)`
            // printed "[object Object]" for every refusal we ever logged.
            const line = `Background Axios error: ${method} ${url} -> ${status ?? "??"} ${failureReason(err)}`
            // See isExpectedApiFailure: a switched-off feature is not a fault.
            if (isExpectedApiFailure(String(url), status)) console.debug(line)
            else console.error(line)
            sendResponse({
              error: {
                status: err?.response?.status ?? 500,
                code: err?.response?.data?.error,
                message:
                  err?.response?.data?.message ??
                  err?.message ??
                  "Unknown error",
              },
            })
          })
      }
    }

    // Return true to indicate we're responding asynchronously
    return true
  }

  if (request.action === "CLEAR_STORE") {
    chrome.storage.local.clear()
    chrome.storage.sync.clear()
    chrome.storage.session.clear()
    sendResponse({ success: true })
    return true
  }

  // OPEN_WIDGET's handler stood here. Its only sender was the retired
  // in-page widget button; nothing sends it now.
  if (request.action === "CLOSE_WIDGET") {
    // close sidepanel
    chrome.sidePanel.setOptions({
      enabled: true,
    })

    return true
  }

  if (request.action === "UPDATE_WIDGET_STATE") {
    const { isEnabled } = request.payload
    // Save to storage
    chrome.storage.local.set({ widgetEnabled: isEnabled }, () => {
      // Broadcast the update to all tabs
      broadcastStoreUpdate("preference-store", { isWidgetEnabled: isEnabled })
      sendResponse({ success: true })
    })
    return true
  }

  // THE SECOND NAVIGATION CHANNEL IS GONE, HANDLERS INCLUDED.
  //
  // `NAVIGATE` and `GO_BACK` stood here. Their only sender was
  // helpers/navigation.ts, whose module-scope navigate handle was never
  // registered — `setNavigateFunction` had no caller in the tree — so every
  // profile tap fell through to these messages instead of navigating. That
  // helper is deleted (components/profile-tap-navigates.spec.ts keeps it
  // deleted) and both call sites use react-router's useNavigate, so nothing
  // can send either verb any more.
  //
  // NAVIGATE was worse than dead: it answered by calling
  // broadcastStoreUpdate("route-store", …), and store/index.ts has no
  // "route-store" key, so the panel's syncStore listener (helpers/index.ts)
  // hit `undefined.setState` and threw on every tap. Registering the key
  // would not have helped either — the panel routes through MemoryRouter
  // (providers/RouterWrapper.tsx), which useRouteStore does not drive.
  //
  // The STORE survives (CreatePost, PostHeader, Reply, edit-profile and
  // PostDetailView read it for params/route bookkeeping); only the worker's
  // remote-control of it is gone, which is why the logout path below still
  // clears its persisted "route-store" key.

  if(request.type === "OPEN_WELCOME_PAGE"){
    const welcomeUrl = browser.runtime.getURL("src/entries/welcome/index.html")
    browser.tabs.create({ url: welcomeUrl })
    sendResponse({ success: true })
    return true
  }

  if (request.action === "TOGGLE_SIDE_PANEL") {
    /* No panel_opened emit here, and that is a correction: the toolbar
       icon opens the panel through openPanelOnActionClick without ever
       sending this message, so counting HERE missed the most common way
       in. The panel document counts itself on mount instead — every
       entrance passes through the mount, whatever pressed the button. */
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]

      if (request?.payload?.url) {
        // The mint rides through when the opener already knows which asset
        // the panel is for — see openAssetInPanel. Encoded because a tweet
        // permalink is itself a URL sitting in a query string.
        const mintQuery = request?.payload?.mint
          ? "&mint=" + encodeURIComponent(request.payload.mint)
          : ""
        chrome.sidePanel.setOptions({
          enabled: true,
          path: chrome.runtime.getURL(
            "src/entries/side_panel/index.html?url=" +
              encodeURIComponent(request.payload.url) +
              mintQuery
          ),
        })
      } else {
        chrome.sidePanel.setOptions({
          enabled: true,
          path: chrome.runtime.getURL("src/entries/side_panel/index.html"),
        })
      }
      chrome.sidePanel.open({
        windowId: tab?.windowId as number,
      })
      
      // Notify content script that side panel is opened
      if(tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "SIDEPANEL_OPENED"
        })
      }
      
      return sendResponse(true)
    })

    return true // Indicate async response
  }

  if (request.action === "BACK_HOME") {
    return chrome.storage.local.remove("route-store")
  }

  // A second OPEN_WELCOME_PAGE handler matched on `action`; every sender in
  // the product uses `type`, which the handler above already serves.









  if (request.type === "CHECK_PERMISSIONS") {
    checkPermissions().then((res) => {
      sendResponse(res)
    })
    return true
  }

  if (request.type === "INJECT_CONTENT_SCRIPTS") {
    // Inject content scripts into all existing tabs after permission is granted
    chrome.tabs.query({}).then((tabs) => {
      tabs.forEach((tab) => {
        if (tab.id && tab.url) {
          injectContentScripts(tab.id, tab.url)
        }
      })
    })
    sendResponse({ success: true })
    return true
  }




  if (request.type === "GET_CURRENT_URL") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      sendResponse({ url: tab?.url })
    })
    return true
  }

  /**
   * THE ONLY SIGN-OUT THAT IS TRUE, and the panel now calls it.
   *
   * The panel used to send CLEAR_STORE, which wipes storage and nothing
   * else. But THIS context holds the Firebase session — it is the one that
   * ran signInWithCustomToken, and lib/axios asks it for the token on every
   * request. So a reader pressed Logout, the panel signed out its OWN
   * Firebase instance, the toast said "Logged out successfully", and the
   * background answered the very next request with a live token. They were
   * still signed in, which is also why the panel never bounced them back to
   * onboarding: that gate reads isUserLoggedIn, and getCurrentUser kept
   * succeeding. Reported 2026-09-22 as "logout çalışmıyor".
   *
   * ORDER, AND WHY THE NETWORK IS LAST. Signing out and clearing storage are
   * the facts a reader can see; /logout clears a cookie on the web app and
   * is the only step that can fail from here. It used to be in the middle,
   * with the wipe inside its .then and the reply inside that — so a blocked
   * request left the storage full and the reply unsent. Now the local truth
   * lands first, unconditionally, and the cookie is swept afterwards with no
   * one waiting on it.
   *
   * ALERTS BELONG TO THE BROWSER, NOT THE SESSION: read before the wipe,
   * written back after it. See survivesLogout.
   */
  if (request.action === "LOGOUT") {
    void (async () => {
      try {
        await auth.signOut()
      } catch (e) {
        // A refused sign-out must not keep the storage full: the wipe below
        // is what makes the next boot signed-out either way.
        console.error("background signOut failed", e)
      }
      /**
       * AND THE COOKIE, WHICH IS WHAT KEPT BRINGING THE SESSION BACK.
       *
       * Reported twice: logout closed the panel and the next open was still
       * signed in. Firebase was out and the storage was empty, and it made
       * no difference, because FirebaseAuthGuard falls back to the
       * `poppin_access_token` cookie when there is no Bearer header and
       * lib/axios sends it (`withCredentials: true`) on every request. So
       * getCurrentUser kept answering, isUserLoggedIn stayed true, and the
       * panel never sent anybody back to onboarding.
       *
       * Both attempts to clear it pointed at a route that does not exist.
       * This called nextApi("/logout") — app.poppin.so — and helpers/signOut
       * opened an iframe at the same address; apps/auth has no /logout and
       * never had one, so both 404'd silently. The route that clears the
       * cookie is the BACKEND's POST /auth/logout, which rewrites it on
       * `.poppin.so` with an epoch expiry. It carries no guard, so a
       * signed-out caller is exactly who it is for.
       *
       * AWAITED, unlike the dead call it replaces: the cookie IS the
       * session here, so a logout that has not cleared it has not happened.
       * A failure is reported rather than swallowed, so the surface can stop
       * claiming success it did not achieve.
       */
      let cookieCleared = false
      try {
        await backendApi({ url: "/auth/logout", method: "POST", timeout: 8000 })
        cookieCleared = true
      } catch (e) {
        console.error("logout could not clear the session cookie", e)
      }
      const kept = await chrome.storage.local
        .get([...LOGOUT_SURVIVORS])
        .catch(() => ({}) as Record<string, unknown>)
      try {
        await chrome.storage.local.clear()
        await chrome.storage.sync.clear()
        await chrome.storage.session.clear()
        const back = survivesLogout(kept)
        if (Object.keys(back).length > 0) await chrome.storage.local.set(back)
      } catch (e) {
        console.error("logout storage wipe failed", e)
      }
      sendResponse({ success: true, cookieCleared })
    })()
    return true
  }

  /**
   * NO CLEAR_NOTIFICATION_BADGE HANDLER. There is no badge to clear: the
   * poll that painted one is gone. Its only would-be sender
   * (helpers/messaging.ts clearNotificationBadge) had no callers either.
   */

  if (request.type === "signInToFirebase") {
    signInToFirebase(request.payload.access_token).then(() => {
      sendResponse({ success: true })
    })
    return true
  }













  if (request.type === "SET_FIRST_INSTALL") {
    const { isFirstInstall } = request.payload
    chrome.storage.local.set({ isFirstInstall }, () => {
      sendResponse({ success: true })
    })
    return true
  }

  if (request.type === "OPEN_IMAGE_PREVIEW") {
    const { imageUrl } = request.payload

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tabId = tabs[0].id

      if (!tabId) {
        console.warn("No active tab")
        sendResponse({ error: "No active tab" })
        return true
      }
  
      // Check if we have scripting permission
      chrome.permissions.contains({
        permissions: ["scripting"]
      }).then((hasPermission) => {
        if (!hasPermission) {
          console.warn("No scripting permission")
          sendResponse({ error: "No scripting permission" })
          return
        }
  
        // First check if the function already exists
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            return typeof (window as any).openImagePreview === 'function'
          }
        }).then((results) => {
          const functionExists = results[0]?.result
          
          if (functionExists) {
            // Function already exists, just send the message
            chrome.tabs.sendMessage(tabId, {
              type: 'OPEN_IMAGE_PREVIEW',
              payload: { imageUrl }
            }).then(() => {
              sendResponse({ success: true })
            }).catch((error) => {
              console.error("Failed to send message to content script:", error)
              sendResponse({ error: "Failed to open image preview" })
            })
          } else {
            // Function doesn't exist, inject the script first
            chrome.scripting.executeScript({
              target: { tabId },
              files: ['src/entries/contentScript/previewImg.js']
            }).then(() => {
              // Send the image URL to the injected script
              chrome.tabs.sendMessage(tabId, {
                type: 'OPEN_IMAGE_PREVIEW',
                payload: { imageUrl }
              }).then(() => {
                sendResponse({ success: true })
              }).catch((error) => {
                console.error("Failed to send message to content script:", error)
                sendResponse({ error: "Failed to open image preview" })
              })
            }).catch((error) => {
              console.error("Failed to inject preview script:", error)
              sendResponse({ error: "Failed to inject preview script" })
            })
          }
        }).catch((error) => {
          console.error("Failed to check if function exists:", error)
          sendResponse({ error: "Failed to check function existence" })
        })
      })
    })


   

    return true
  }

  if (request.type === "IS_EXTENSION_PINNED") {
    browser.action.getUserSettings().then((settings) => {
      sendResponse({ isOnToolbar: settings.isOnToolbar })
    }).catch((error) => {
      console.error("Error getting user settings:", error)
      sendResponse({ isOnToolbar: false })
    })
    return true
  }


  return undefined
})

// Initialize URL listener
initializeUrlListener()


/**
 * Kept, and no longer about notifications: the handler's remaining half is
 * the rank-movement check below. The unread poll it was created for is
 * gone with the inbox it counted.
 */
if (CAP.gamification) {
  chrome.alarms.create("checkNotifications", {
    periodInMinutes: 1,
  })
}

/**
 * What a background poll is allowed to wait. Comfortably inside the
 * one-minute alarm above, so a hung request is abandoned before the next
 * one starts rather than stacking on top of it.
 */
const NOTIFY_POLL_TIMEOUT_MS = 15_000

// The order-fill watch. Slower than the badge alarm on purpose: each poll
// fans out on the backend, and a fill announced ninety seconds late is
// still a surprise gift. Rationale and the pure half live in
// helpers/orderFillWatch.ts.
chrome.alarms.create(ORDER_WATCH_ALARM, {
  periodInMinutes: ORDER_WATCH_PERIOD_MIN,
})

// ── the presence backstop ───────────────────────────────────────────────────
//
// THE HEARTBEAT IS NOT HERE, AND MUST NOT MOVE HERE. Chrome evicts this worker
// on idle and every setInterval in it dies silently, so a presence beat living
// on a timer in this file would freeze the one number the header pill and the
// live chat's own admission both read — a frozen count looks like an answer.
// The beat lives in real documents: the side panel (components/Header.tsx) and
// the content script (entries/contentScript/primary/main.tsx). An ALARM is a
// different animal: Chrome wakes the worker to deliver it, so it survives the
// eviction a timer does not.
//
// One minute against a 45s server TTL cannot hold a reader in the pool by
// itself — see SITE_PRESENCE_ALARM_PERIOD_MIN in helpers/presence.ts. It is a
// floor, for the case where the panel is shut and the page's own beat stopped.
if (CAP.sitePresence) {
  chrome.alarms.create(SITE_PRESENCE_ALARM, {
    periodInMinutes: SITE_PRESENCE_ALARM_PERIOD_MIN,
  })
}

/**
 * One presence beat for whatever website the reader is actually looking at.
 *
 * IT NEEDS tab.url, AND "tabs" IS DELIBERATELY ABSENT FROM THE MANIFEST
 * (src/manifest.ts:24-50). The sensitive Tab fields unlock through EITHER
 * "tabs" or a host permission matching that tab, and this extension asks for
 * <all_urls> as an OPTIONAL grant. So a reader who never granted it hands us
 * `undefined` here, we beat for nobody, and they neither appear in a room nor
 * get a chat. That is the honest outcome and it already has a visible cure:
 * PermissionBanner (components/PermissionBanner.tsx) renders exactly while
 * that grant is missing. DO NOT add a permission to work around this.
 *
 * Uses backendApi directly rather than the helper the documents use: a runtime
 * message sent from this worker is never delivered back to this worker, so
 * sendApiRequest — which is a message to this very listener — cannot work from
 * inside it.
 *
 * Silent on every failure. Nobody is watching a backstop, the next alarm
 * retries, and a 404 is the ordinary answer while site chat is switched off.
 * Silent is not the same as tireless, though — see the dark memory below.
 */

/**
 * HOSTS THAT ANSWERED 404, so the backstop stops asking them.
 *
 * The document heartbeat already does this: one 404 and it clears its timer
 * (helpers/presence.ts, `if (!r.available) stopTimer()`). Without the same
 * memory here, an alarm firing every minute would POST the active tab's
 * hostname forever for a feature that does not exist — and NOT existing is
 * the shipped default, since SITE_CHAT_ENABLED is off until a human turns it
 * on. That is one request a minute, per install, indefinitely, for nothing.
 *
 * PER HOST, NOT A SINGLE FLAG, because the server answers the kill switch and
 * an off-allowlist host with the SAME 404 on purpose — they are
 * indistinguishable from out here. A global flag would let one disallowed
 * website silence the beat on every allowed one. When the feature is simply
 * off, every host lands in here after one beat each and the traffic stops
 * anyway.
 *
 * THE BACK-OFF IS COARSER THAN THE DOCUMENTS' ON PURPOSE. A document re-asks
 * the moment its tab becomes visible again; this set has no such event, so it
 * is cleared only by the worker restarting — which Chrome does constantly — and
 * that restart is what picks up a feature enabled mid-session.
 */
const siteChatDarkHosts = new Set<string>()
/** A browsing session can touch a lot of hostnames, and this worker holds them
 *  in memory. Past this, forget everything and let one beat per host re-learn
 *  it: the cost of being wrong is a single request. */
const SITE_CHAT_DARK_MAX = 200

async function beatSitePresence(): Promise<void> {
  if (!CAP.sitePresence) return
  // Held outside the try so the catch can name the host that was actually
  // asked. Re-reading the active tab down there would blame whichever website
  // the reader switched to while the request was in flight.
  let host: string | null = null
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    host = siteChatHostFromUrl(tab?.url)
    if (!host) return
    if (siteChatDarkHosts.has(host)) return
    // The shared six-hour memory, so a worker restart does not forget.
    if (await hostIsDark(host)) return
    const anonId = await siteAnonId()
    // No id means no beat. A fresh random id per call would add one member to
    // the room every minute and the count would climb on its own.
    if (!anonId) return
    await backendApi({
      method: "POST",
      url: SITE_PRESENCE_PING_ROUTE,
      data: { host, anonId },
    })
  } catch (e) {
    // Offline, rate limited, a 500 — all just a bad minute, and the next alarm
    // tries again. A 404 is the one answer that means "there is no chat here",
    // and it is remembered so this stops asking.
    const status = (e as { response?: { status?: number } } | undefined)?.response
      ?.status
    if (status === 404 && host) {
      if (siteChatDarkHosts.size >= SITE_CHAT_DARK_MAX) siteChatDarkHosts.clear()
      siteChatDarkHosts.add(host)
      void rememberDark(host)
    }
  }
}

const WATCHED_ORDERS_KEY = "poppin_watched_orders"

async function listOrdersFromBackground(
  status: "active" | "history",
): Promise<WatchedOrder[]> {
  const r = await backendApi({
    method: "POST",
    url: "/embed/asset/orders",
    data: { status },
  })
  // The body is { orders } for this endpoint; the defensive ?? covers the
  // Nest-wrapped shape some older routes still use.
  const body = r?.data
  return body?.orders ?? body?.data?.orders ?? []
}

/**
 * May the product post THIS on the reader's behalf? Read at the moment of
 * posting, never cached — the same rule mayNotify follows, and for a
 * sharper reason: a switch turned off two minutes ago must not publish.
 *
 * Unreadable storage answers NO here, the opposite of mayNotify. Silence
 * is the safe failure for something said TO you; it is the only safe
 * failure for something said AS you.
 */
async function mayShare(kind: "fills"): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(SHARE_PREFS_KEY)
    return readSharePrefs(stored?.[SHARE_PREFS_KEY])[kind] === true
  } catch {
    return false
  }
}

async function checkOrderFills(): Promise<void> {
  // No standing orders in the Arc edition: nothing to watch, nothing to ask.
  if (!CAP.orderWatch) return
  if (!auth.currentUser) return

  const active = await listOrdersFromBackground("active")
  const stored = await chrome.storage.local.get(WATCHED_ORDERS_KEY)
  const prevKeys: string[] | null = stored?.[WATCHED_ORDERS_KEY] ?? null

  // History is a second fan-out on the backend, so it is fetched only when
  // the diff has a question for it.
  const still = new Set(active.map((o) => o.orderKey))
  const vanished = (prevKeys ?? []).some((k) => !still.has(k))
  const history = vanished ? await listOrdersFromBackground("history") : []

  const { fills, nextKeys } = watchStep({ prevKeys, active, history })

  /**
   * THE ONE TRADE NOBODY CAN SHARE BY HAND, SHARING ITSELF.
   *
   * Every other trade reaches the feed through a Share button pressed by
   * somebody who just watched their money move. A standing order fills
   * while they are asleep: by the time anyone sees it the moment is hours
   * gone and the button with it.
   *
   * ON BY DEFAULT, and this runs BEFORE the notifications on purpose — so
   * the toast that announces the fill can also say the post went out. The
   * reader is told in the same breath, and the Undo is one tap from that
   * toast. Best-effort and silent on failure: a post that does not land
   * must never cost the fill its notification, its record, or its place
   * in the watched-key list.
   */
  const posts: Record<string, string | null> = {}
  if (fills.length > 0 && CAP.autoPost && (await mayShare("fills"))) {
    // Where each order was parked, written down at creation because this
    // moment has no page of its own. Consumed as it is used.
    const originStore = await chrome.storage.local.get(ORDER_ORIGINS_KEY)
    let origins = originStore?.[ORDER_ORIGINS_KEY]
    for (const fill of fills) {
      const name = fill.symbol
        ? fill.symbol.replace(/^\$/, "")
        : fill.mint.slice(0, 4)
      const price = fill.triggerPriceUsd
      /**
       * Same sentence shape the chip's own receipt uses: the asset, the
       * size, and what it cost — no verb (the card's tag carries it) and
       * no "via Poppin" (the card announces itself). A fill has no market
       * cap in hand, so it says the price it filled AT, which is the one
       * number an order is actually about.
       */
      const text = `${name} ${
        fill.amountUsd != null && fill.amountUsd > 0
          ? `$${Number(fill.amountUsd.toFixed(2)).toLocaleString("en-US")}`
          : qtyText(fill.amountUi ?? 0)
      } at $${price}`
      try {
        const taken = takeOrigin(origins, fill.orderKey, "https://poppin.so")
        origins = taken.rest
        const r = await backendApi({
          method: "POST",
          url: "/website-post/",
          data: {
            content: text,
            // THE ROOM THE ORDER WAS PARKED FROM. An order placed under a
            // tweet is a trade made on the X feed, and its fill belongs to
            // that conversation however many hours later it lands. Only an
            // order we have no record of falls back to the product's own
            // address.
            website_url: taken.url,
            only_followers: false,
            on_chain: true,
            transaction_data: {
              tokenSymbol: name,
              tokenMint: fill.mint,
              tokenAmount: fill.amountUi ?? 0,
              signature: fill.orderKey,
              // The coin's face by OUR OWN origin — the background has no
              // enrich in hand, and this endpoint answers for any mint,
              // cached a day. A receipt without a face is a sentence about
              // a token the reader cannot see.
              tokenImageUrl: `${process.env.NEXT_PUBLIC_API_URL}/embed/asset/icon?mint=${fill.mint}`,
              // Missing tradeType defaults to 'buy' in the DB; a filled
              // sell order must not file as a bought receipt.
              tradeType: fill.side,
            },
          },
        })
        const id = (r?.data as { id?: string } | undefined)?.id
        posts[fill.orderKey] = typeof id === "string" ? id : null
      } catch {
        // Silent by contract. The fill is already the important thing.
        posts[fill.orderKey] = null
      }
    }
    // Spent origins written back once, after the loop: a crash mid-way
    // leaves the unused ones for the next tick rather than losing them.
    try {
      await chrome.storage.local.set({ [ORDER_ORIGINS_KEY]: origins ?? {} })
    } catch {
      // A stale entry costs one fill the wrong room, never the fill.
    }
  }

  for (const fill of fills) {
    const { title, message: plain } = fillNotification(fill)
    // Said in the same breath, because acting on somebody's behalf and
    // not mentioning it is the part that would deserve the complaint.
    const message = posts[fill.orderKey]
      ? `${plain} · Shared to your feed`
      : plain
    // The mint rides in the id so a click needs no lookup. A notification
    // id is the ONLY state this feature keeps besides the key list.
    chrome.notifications.create(`fill:${fill.orderKey}:${fill.mint}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/logo.png"),
      title,
      message,
      priority: 1,
    })
  }

  // Said here, so the server's own sweep never mails a fill the reader
  // has just been shown. Signed-out cannot have placed one; a miss only
  // costs one email the toast already covered.
  if (fills.length > 0 && auth.currentUser) {
    void backendApi({
      method: "POST",
      url: "/embed/asset/fills/seen",
      data: { orderKeys: fills.map((f) => f.orderKey) },
    }).catch(() => {})
  }
  // The panel's celebration reads from here — the notification is only the
  // doorbell. Written before the key list for the same crash-retry reason.
  if (fills.length > 0) {
    const storedFills = await chrome.storage.local.get(PENDING_FILLS_KEY)
    const pending = rememberFills(
      storedFills?.[PENDING_FILLS_KEY] ?? [],
      fills,
      Date.now(),
      20,
      posts,
    )
    await chrome.storage.local.set({ [PENDING_FILLS_KEY]: pending })
  }

  // Written AFTER the notifications went out: if creation throws, the keys
  // stay unwritten and the next tick retries, which beats losing a fill.
  await chrome.storage.local.set({ [WATCHED_ORDERS_KEY]: nextKeys })
}

/**
 * PRICE ALERTS, on the same clock as the fill watch.
 *
 * An alert needs no auth and no wallet — it is a parked number. Each tick:
 * read the alerts, price their distinct mints (the same by-mint read every
 * surface uses; one call per mint, and only mints someone is watching),
 * fire what is due, keep the rest. A mint the read could not price neither
 * fires nor gets lost — alertsDue keeps it untouched for the next tick.
 */
/**
 * MAY WE SAY THIS KIND OF THING?
 *
 * Read at the MOMENT OF SENDING rather than cached at startup: a service
 * worker outlives a settings screen, and a preference read once would keep
 * announcing to somebody who just asked it to stop. One storage read per
 * tick is nothing next to the network call that produced it.
 */
async function mayNotify(kind: NotifyKind): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(NOTIFY_PREFS_KEY)
    return shouldNotify(readNotifyPrefs(stored?.[NOTIFY_PREFS_KEY]), kind)
  } catch {
    // Unreadable storage is not consent to go quiet: these were designed to
    // be rare, and the reader can still silence them from the settings
    // screen once storage answers again.
    return true
  }
}

/**
 * One asset, or null. Shared by the alert watch, the watchlist and the daily
 * digest so "what is this worth right now" has one answer and one failure
 * shape — three private copies of a fetch is three ways to disagree.
 */
async function assetOf(
  mint: string,
): Promise<{ symbol: string | null; usd: number | null; change24hPct: number | null } | null> {
  try {
    const r = await backendApi({
      method: "POST",
      url: "/embed/asset/by-mint",
      data: { mint },
    })
    const body = r?.data
    const asset = body?.asset ?? body?.data?.asset ?? null
    if (!asset) return null
    return {
      symbol: asset.symbol ?? null,
      usd: typeof asset.indicativeUsd === "number" ? asset.indicativeUsd : null,
      change24hPct:
        typeof asset.change24hPct === "number" ? asset.change24hPct : null,
    }
  } catch {
    return null
  }
}

/**
 * THE PRICE THE CHIP SHOWS, in one ask for every mint.
 *
 * Alerts used to be judged against by-mint's indicativeUsd, the per-unit
 * price of a $10 buy with our fee and the route's impact folded in, which
 * runs about 1% above the mid the chip paints from the /ticks feed. So
 * "drops to $90" fired at a mid of $89.1 and "reaches $100" at $99.1
 * (measured 2026-09-16), and the sheet's "% away" agreed with neither.
 * /embed/asset/prices hands out the ticks' own number, batched; a mint it
 * has nothing for is absent, and alertsDue keeps that alert untouched.
 */
/**
 * THE CHECK-IN. The server judges mirrored alerts once a minute and emails
 * a hit only when this extension has not been heard from for four minutes,
 * because while Chrome is open the chip's own toast says it. This is the
 * heartbeat that says "open". Once per worker life it also pushes the
 * local list up, so alerts set before the mirror existed, or while signed
 * out, get a server copy the first time a signed-in tick sees them.
 */
let alertsPushedThisLife = false
async function checkInAlerts(): Promise<void> {
  // The server copy of alerts is a store-backend feature; local alerts do
  // not need it to ring.
  if (!CAP.alertsMirror) return
  if (!auth.currentUser) return
  if (!alertsPushedThisLife) {
    alertsPushedThisLife = true
    try {
      const stored = await chrome.storage.local.get(PRICE_ALERTS_KEY)
      const alerts: PriceAlert[] = Array.isArray(stored?.[PRICE_ALERTS_KEY])
        ? stored[PRICE_ALERTS_KEY]
        : []
      if (alerts.length > 0) {
        await backendApi({ method: "POST", url: "/embed/asset/alerts/sync", data: { alerts } })
      }
    } catch {
      alertsPushedThisLife = false
    }
  }
  try {
    await backendApi({ method: "GET", url: "/embed/asset/alerts" })
  } catch {
    // Missed check-in: the server may email a hit the toast also shows.
  }
}

const PRICE_BATCH = 50
async function midPricesOf(mints: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < mints.length; i += PRICE_BATCH) {
    const batch = mints.slice(i, i + PRICE_BATCH)
    try {
      const r = await backendApi({
        method: "POST",
        url: "/embed/asset/prices",
        data: { mints: batch },
      })
      const prices = (r?.data?.prices ?? r?.data?.data?.prices ?? {}) as Record<
        string,
        { usd?: number }
      >
      for (const [mint, p] of Object.entries(prices)) {
        if (typeof p?.usd === "number" && p.usd > 0) out.set(mint, p.usd)
      }
    } catch {
      // Unpriced this tick. Nothing fires off a missing number.
    }
  }
  return out
}

const priceOf = (mint: string) => midPricesOf([mint]).then((m) => m.get(mint) ?? null)

async function checkPriceAlerts(): Promise<void> {
  const stored = await chrome.storage.local.get(PRICE_ALERTS_KEY)
  const alerts: PriceAlert[] = stored?.[PRICE_ALERTS_KEY] ?? []
  if (alerts.length === 0) return

  const mints = [...new Set(alerts.map((a) => a.mint))]
  const priced = await midPricesOf(mints)

  const { due, kept } = alertsDue(alerts, (mint) => priced.get(mint) ?? null)
  /**
   * WRITTEN BEFORE THE TOAST GATE, on purpose. The system notification is
   * one channel and the reader may have turned it off; the in-product
   * record is the SURFACE — the pill's unread count and the Activity
   * tab's list — and a preference about toasts must not erase the news
   * itself.
   */
  if (due.length > 0) {
    const firedStored = await chrome.storage.local.get(FIRED_ALERTS_KEY)
    let fired: FiredAlert[] = Array.isArray(firedStored?.[FIRED_ALERTS_KEY])
      ? firedStored[FIRED_ALERTS_KEY]
      : []
    for (const a of due) {
      fired = recordFired(fired, a, a.atUsd, Date.now())
    }
    await chrome.storage.local.set({ [FIRED_ALERTS_KEY]: fired })
  }
  // The chip caught it: tell the server, so its own sweep never emails
  // the same alert afterwards. Signed-out answers 401, which is nothing.
  if (CAP.alertsMirror && auth.currentUser) {
    for (const a of due) {
      void backendApi({
        method: "POST",
        url: "/embed/asset/alerts/fired",
        data: { id: a.id, atUsd: a.atUsd },
      }).catch(() => {})
    }
  }
  for (const a of due) {
    const { title, message } = alertNotification(a)
    // The MINT rides as the id's last segment — same contract the fill
    // notification uses, parsed by one shared click handler below.
    chrome.notifications.create(`alert:${a.createdAt}:${a.mint}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/logo.png"),
      title,
      message,
      priority: 1,
    })
  }
  if (due.length > 0) {
    await chrome.storage.local.set({ [PRICE_ALERTS_KEY]: kept })
  }
  // And whatever the SERVER fired while this browser was not looking.
  await syncFiredFromServer()
}

/**
 * THE ALERT THAT FIRED WHILE CHROME WAS ASLEEP.
 *
 * Two watchers share this job: this browser, every minute, and the server,
 * which sweeps every minute and emails when this browser has been silent
 * for four. Whichever sees the price first marks the alert fired, and the
 * other was never told.
 *
 * So an alert could fire, the mail could arrive, and the product itself
 * could show nothing: the bell's Activity band reads local storage only,
 * and nothing had written to it. Reported 2026-09-19 with the mail open in
 * one window and "Nothing yet. Fills and alerts land here." in the other.
 *
 * The server's list already carries its fired rows (GET alerts → fired[]).
 * This pulls them in, raises the same notification the local path raises,
 * and takes the alert out of the open list this browser keeps watching.
 * Deduplicated by the id both sides agree on, so an alert this browser
 * fired itself is never announced twice.
 */
async function syncFiredFromServer(): Promise<void> {
  if (!CAP.alertsMirror) return
  if (!auth.currentUser) return
  let rows: Array<{
    id: string
    mint: string
    symbol: string | null
    targetUsd: number
    direction: "above" | "below"
    createdAt: number
    firedAt: number | null
    firedUsd: number | null
  }> = []
  try {
    const r = await backendApi({ method: "GET", url: "/embed/asset/alerts" })
    const body = r?.data
    const fired = body?.fired ?? body?.data?.fired
    if (!Array.isArray(fired)) return
    rows = fired
  } catch {
    // A watcher that cannot reach the server says nothing; the local
    // check above still stands on its own.
    return
  }
  if (rows.length === 0) return

  const stored = await chrome.storage.local.get([FIRED_ALERTS_KEY, PRICE_ALERTS_KEY])
  let known: FiredAlert[] = Array.isArray(stored?.[FIRED_ALERTS_KEY])
    ? stored[FIRED_ALERTS_KEY]
    : []
  const open: PriceAlert[] = Array.isArray(stored?.[PRICE_ALERTS_KEY])
    ? stored[PRICE_ALERTS_KEY]
    : []
  const seen = new Set(known.map((f) => f.id))

  const fresh = rows.filter((r) => r.firedAt !== null && !seen.has(`${r.id}:fired`))
  if (fresh.length === 0) return

  for (const r of fresh) {
    const alert: PriceAlert = {
      id: r.id,
      mint: r.mint,
      symbol: r.symbol,
      targetUsd: r.targetUsd,
      direction: r.direction,
      createdAt: r.createdAt,
    }
    const atUsd = typeof r.firedUsd === "number" ? r.firedUsd : r.targetUsd
    known = recordFired(known, alert, atUsd, r.firedAt ?? Date.now())
    const { title, message } = alertNotification({ ...alert, atUsd })
    chrome.notifications.create(`alert:${alert.createdAt}:${alert.mint}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/logo.png"),
      title,
      message,
      priority: 1,
    })
  }

  const firedIds = new Set(fresh.map((r) => r.id))
  const writes: Record<string, unknown> = { [FIRED_ALERTS_KEY]: known }
  const stillOpen = open.filter((a) => !firedIds.has(a.id))
  if (stillOpen.length !== open.length) writes[PRICE_ALERTS_KEY] = stillOpen
  await chrome.storage.local.set(writes)
}

/**
 * "YOUR $WIF IS UP 12%" — the held book, watched on the same clock.
 *
 * Auth-gated (a book is private), one /positions read per tick, and the
 * anchor rule does the taste-keeping: seed silently, speak at ±10%, then
 * re-anchor so the next word costs another ten percent. The marks are
 * written EVERY tick — seeding and pruning matter even on a quiet day.
 */
async function checkPositionMoves(): Promise<void> {
  if (!auth.currentUser) return
  const r = await backendApi({
    method: "POST",
    url: "/embed/asset/positions",
    data: {},
  })
  const body = r?.data
  const rows = body?.positions ?? body?.data?.positions ?? []
  const positions: HeldPosition[] = rows.map(
    (p: {
      mint: string
      ticker?: string | null
      uiAmount: number
      priceUsd: number | null
      valueUsd: number | null
    }) => ({
      mint: p.mint,
      symbol: p.ticker ?? null,
      uiAmount: p.uiAmount,
      priceUsd: p.priceUsd,
      valueUsd: p.valueUsd,
    }),
  )

  // The same read, kept: the panel's cold open paints from this.
  if (body?.positions || body?.data?.positions) {
    await writeBookCache(body?.positions ? body : body.data)
  }

  /**
   * STARRED ASSETS EARN THE SAME RULE.
   *
   * A watched mint is an interest, and an interest that moves 10% is exactly
   * as worth saying as a holding that does. They ride the same anchors and
   * the same wording — the only difference is that a watched asset has no
   * value, so the dust filter (which asks what a position is worth) would
   * silence every one of them. uiAmount 0 with a real price is the shape
   * positionMoves reads as "no money here", so watched rows carry a nominal
   * $1 of value: enough to clear dust, and never shown to anybody.
   */
  const watchStored = await chrome.storage.local.get(WATCHLIST_KEY)
  const watched: WatchedAsset[] = watchStored?.[WATCHLIST_KEY] ?? []
  const heldMints = new Set(positions.map((p) => p.mint))
  const watchedOnly = watched.filter((w) => !heldMints.has(w.mint))
  for (const w of watchedOnly.slice(0, MAX_WATCHED)) {
    const priceUsd = await priceOf(w.mint)
    if (priceUsd === null) continue
    positions.push({
      mint: w.mint,
      symbol: w.symbol,
      uiAmount: 0,
      priceUsd,
      valueUsd: 1,
    })
  }

  const stored = await chrome.storage.local.get(POSITION_MARKS_KEY)
  const marks: Record<string, PositionMark> = stored?.[POSITION_MARKS_KEY] ?? {}
  const { moves, nextMarks } = positionMoves({ positions, marks, now: Date.now() })

  // Asked once per tick, not once per move — the answer cannot change
  // mid-loop. Asked HERE and not before the work, because the marks below
  // must be written either way: an early return would leave them stale and
  // replay the whole backlog the moment the switch came back on.
  if (await mayNotify("move")) {
    for (const m of moves) {
      const { title, message } = moveNotification(m)
      chrome.notifications.create(`move:${Date.now()}:${m.mint}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/logo.png"),
        title,
        message,
        priority: 1,
      })
    }
  }
  await chrome.storage.local.set({ [POSITION_MARKS_KEY]: nextMarks })
}

/**
 * WHAT THE PEOPLE YOU FOLLOW JUST DID.
 *
 * The strongest signal the product can send, which is exactly why it is the
 * easiest to ruin: a ping per trade would be filtered out within a day. The
 * rules that keep it rare live in helpers/followTrades.ts and are tested
 * without a browser; this function only does the plumbing — ask what changed
 * since we last looked, tell the rulebook what the reader holds, draw what
 * survives.
 *
 * The held set comes from the book cache the position watch above just
 * refreshed. A sell is only news to somebody holding the thing, and asking
 * the server a second time for a list we wrote seconds ago would be paying
 * twice for the same answer.
 */
async function checkFollowTrades(): Promise<void> {
  if (!CAP.social) return
  if (!auth.currentUser) return
  const stored = await chrome.storage.local.get([
    FOLLOW_SEEN_KEY,
    FOLLOW_MARKS_KEY,
  ])
  const since = Number(stored?.[FOLLOW_SEEN_KEY]) || 0
  const r = await backendApi({
    method: "GET",
    url: `/spot/social/following-trades?since=${since}`,
  })
  const rows: FollowTradeRow[] = r?.data?.trades ?? []
  // The watermark moves on a SUCCESSFUL read, whether or not anything was
  // worth saying — otherwise a quiet hour is re-fetched forever.
  const now = Date.now()
  await chrome.storage.local.set({ [FOLLOW_SEEN_KEY]: now })
  if (rows.length === 0) return

  const book = await readBookCache()
  const held = new Set<string>(
    (book?.positions ?? [])
      .filter((p) => (p.uiAmount ?? 0) > 0)
      .map((p) => p.mint),
  )
  const marks: SpokenMarks = stored?.[FOLLOW_MARKS_KEY] ?? {}
  const { news, nextMarks } = followTradeNews({ rows, held, marks, now })

  // One read per tick, not one per row. It sits after the rulebook ran and
  // before the marks are written below, because those marks must be written
  // whatever the answer is — returning early would re-tell every trade in
  // the backlog the next time the switch is on.
  if (await mayNotify("social")) {
    for (const n of news) {
      const { title, message } = followTradeNotification(n)
      /* The sentence must survive the door. The tap lands in the coin's
         room, which until now mentioned neither the person nor the size
         that brought the reader there (helpers/copyFrom.ts). Written
         before the notification exists, so a tap can never outrun it. */
      void chrome.storage.local.set({
        [COPY_FROM_KEY]: {
          mint: n.mint,
          side: n.side,
          who: people(n.names, n.peopleCount),
          usd: n.totalUsd,
          at: n.at,
        } satisfies CopyFrom,
      })
      // A buy is something the reader can join, so the tap lands on the BUY
      // sheet; a sell lands on the asset and lets them decide.
      chrome.notifications.create(
        `social:${n.side}:${now}:${n.mint}`,
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/logo.png"),
          title,
          message,
          priority: 1,
        },
      )
    }
  }
  await chrome.storage.local.set({ [FOLLOW_MARKS_KEY]: nextMarks })
}

/**
 * ONE MESSAGE A DAY ABOUT THE READER'S OWN MONEY.
 *
 * Everything else this product says is reactive — a fill, an alert, somebody
 * you follow buying something — so a reader with a quiet book hears nothing
 * for days, which is exactly the reader who forgets it exists. This is the
 * one line that arrives because a morning happened.
 *
 * The comparison is against OUR OWN snapshot from the last digest, not
 * against a market open, so "since yesterday" means exactly what it says and
 * the first one claims no change at all. The rules for when and whether live
 * in helpers/watchlist.ts; this reads the book cache the position watch just
 * refreshed, prices the watchlist, and draws whatever survives.
 */
async function checkDailyDigest(): Promise<void> {
  if (!auth.currentUser) return
  // Checked before the work, not after: a silenced digest should not cost a
  // price read per watched asset every morning.
  if (!(await mayNotify("digest"))) return
  const stored = await chrome.storage.local.get([DIGEST_KEY, WATCHLIST_KEY])
  const state: DigestState = stored?.[DIGEST_KEY] ?? {
    lastDayKey: null,
    lastTotalUsd: null,
  }
  const now = Date.now()
  if (!digestDue(state, now)) return

  const book = await readBookCache()
  const holdings = (book?.positions ?? []).map((p) => ({
    symbol: p.ticker ?? null,
    mint: p.mint,
    valueUsd: p.valueUsd ?? null,
    changePct: p.change24hPct ?? null,
  }))
  const held = new Set(holdings.map((h) => h.mint))
  const watchlist: WatchedAsset[] = stored?.[WATCHLIST_KEY] ?? []
  const watched: Array<{ symbol: string | null; mint: string; changePct: number | null }> =
    []
  for (const w of watchlist.filter((w) => !held.has(w.mint)).slice(0, MAX_WATCHED)) {
    const asset = await assetOf(w.mint)
    watched.push({
      symbol: w.symbol ?? asset?.symbol ?? null,
      mint: w.mint,
      changePct: asset?.change24hPct ?? null,
    })
  }

  const input = { holdings, watched, state }
  const digest = buildDigest(input, now)
  // Nothing to say is not a reason to burn the day: without a digest the
  // state is left alone, so the next morning with something in it speaks.
  if (!digest) return

  const mint = digestMint(input)
  chrome.notifications.create(`digest:${now}:${mint ?? ""}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/logo.png"),
    title: digest.title,
    message: digest.message,
    priority: 1,
  })
  await chrome.storage.local.set({ [DIGEST_KEY]: digest.nextState })
}

/**
 * MONEY ARRIVING, ANNOUNCED. "poppin hesabıma fund atınca you received 3
 * sol diye notification gelmesin mi?" — yes. The server answers only
 * traffic Poppin did not create (deposits in, external sends out; our own
 * swaps, sends and gas sponsorship are excluded by signature), and the
 * cursor contract keeps the steady-state cost at one signatures read.
 *
 * The cursor is written AFTER the toasts, orderFillWatch's retry posture:
 * if creation throws, the cursor stays put and the next tick says it
 * again — a repeated deposit toast beats a swallowed one. The seed run
 * (no cursor yet) records where history ends and says nothing, so a fresh
 * install never narrates last month.
 */
async function checkExternalTransfers(): Promise<void> {
  // Off until the backend serves the feed (NEXT_PUBLIC_ARC_DEPOSIT_WATCH in
  // the Arc edition); asking a route that is not there every two minutes
  // would only hold the cursor where it is.
  if (!CAP.depositWatch) return
  const uid = auth.currentUser?.uid
  if (!uid) return
  // Cursor and spoken-set are PER ACCOUNT: the query is per-user, and a
  // global cursor handed one user's signature to another user's wallet —
  // where the chain cannot find it and answers the newest window as if it
  // were all new. Fifteen stale toasts on an account switch, review-caught.
  const cursorKey = `${DEPOSIT_CURSOR_KEY}:${uid}`
  const spokenKey = `${DEPOSIT_SPOKEN_KEY}:${uid}`
  const stored = await chrome.storage.local.get([cursorKey, spokenKey])
  const prevCursor: string | null =
    typeof stored?.[cursorKey] === "string" ? stored[cursorKey] : null
  const spoken: string[] = Array.isArray(stored?.[spokenKey])
    ? stored[spokenKey]
    : []
  const r = await backendApi({
    method: "GET",
    url:
      "/wallets/external-transfers" +
      (prevCursor && prevCursor !== GENESIS
        ? `?until=${encodeURIComponent(prevCursor)}`
        : ""),
  })
  const body = r?.data
  const answer = {
    ok: body?.ok === true,
    cursor: typeof body?.cursor === "string" ? body.cursor : null,
    transfers: Array.isArray(body?.transfers) ? body.transfers : [],
  }
  const step = depositStep(prevCursor, answer)
  const spokenSet = new Set(spoken)
  let spokeThisTick = 0
  for (const t of step.notify) {
    // Never twice: a lagging RPC node that cannot find the cursor answers
    // the newest window as if it were new, and the only defence that
    // survives that is remembering what was already said.
    if (typeof t?.signature !== "string" || spokenSet.has(t.signature)) continue
    spokenSet.add(t.signature)
    spoken.push(t.signature)
    if (spokeThisTick >= SPEAK_CAP) continue
    // SOL and USDC speak from memory; any other mint must resolve through
    // the product's own asset lookup AND pass the speak rules (value
    // floor, no canon impersonation) — shouldSpeak carries the abuse
    // stories. The money itself still shows in the wallet either way.
    const asset = t.mint && t.mint !== USDC_MINT ? await assetOf(t.mint) : null
    const symbol =
      t.mint === null ? NATIVE_SYMBOL : t.mint === USDC_MINT ? "USDC" : (asset?.symbol ?? null)
    if (!shouldSpeak(t, symbol, asset?.usd ?? null)) continue
    /* MONEY ARRIVED — the funnel's missing middle. Everything between
       sign-in and the first trade hinges on this fact, and until now it
       lived only as a toast. Behind shouldSpeak on purpose: the speak
       rules are the product's own definition of "a real deposit", and a
       scam token's dust should not count as funding here either. */
    void readTopUpIntent(TOP_UP_INTENT_WATCH_MS).then((intent) => {
      deliverTelemetry("deposit_landed", {
        symbol,
        amountUi: t.amountUi,
        // Minutes since a Deposit door was pressed, when one was within a
        // day: the founder page's "how long does the money take".
        sinceDoorMin: minutesSince(intent),
      })
      // Only USDC answers a Deposit door; SOL or a token arriving keeps the
      // intent alive for the USDC that is still coming.
      if (intent && t.mint === USDC_MINT) void chrome.storage.local.remove(TOP_UP_INTENT_KEY)
      /* A tap on the toast opens the panel plain (the wallet), never a Buy
         sheet on whatever mint ARRIVED: a scam token's deposit toast must
         not be one tap from a Buy on the scammer's contract. The one
         exception is the reader's own intent: they pressed Deposit on a
         coin within the day, so the tap returns them to that Buy with the
         dollars they typed. The id carries it as deposit:<sig>:<usd>:<mint>;
         a plain toast ends with an empty mint. */
      /* "Your $WIF buy is ready" only when it is: USDC, a coin behind the
         door, enough of it to cover the buy, and a door pressed within the
         hour. The day-long read above is for timing only. */
      const ready =
        t.mint === USDC_MINT &&
        intent?.mint &&
        Date.now() - intent.at <= 60 * 60_000 &&
        t.amountUi >= (intent.usd ?? 0)
          ? intent
          : null
      const id = ready
        ? `deposit:${t.signature}:${Math.max(0, Math.ceil(ready.buyUsd ?? 0))}:${ready.mint}`
        : `deposit:${t.signature}:`
      const note = depositNotification(t, symbol as string, ready?.ticker ?? null)
      chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/logo.png"),
        title: note.title,
        message: note.message,
        priority: 1,
      })
    })
    spokeThisTick += 1
    broadcastBookChanged()
  }
  const writes: Record<string, unknown> = {}
  if (step.nextCursor !== prevCursor) writes[cursorKey] = step.nextCursor
  if (spoken.length > 0) writes[spokenKey] = spoken.slice(-SPOKEN_CAP)
  if (Object.keys(writes).length > 0) await chrome.storage.local.set(writes)
}

/**
 * A tap on a fill, an alert, a move or a followed trader's trade lands in the
 * PANEL, on that asset — the sidebar is the app. setOptions points the panel
 * at the mint first, so even where sidePanel.open refuses a non-gesture
 * context, the reader's next manual open still lands on the asset the tap was
 * about.
 */
chrome.notifications.onClicked.addListener((id) => {
  const kind = id.split(":")[0]
  if (
    kind !== "fill" &&
    kind !== "alert" &&
    kind !== "move" &&
    kind !== "social" &&
    kind !== "digest" &&
    kind !== "deposit"
  )
    return
  // "social:buy:<at>:<mint>" carries the side in the second segment, so a tap
  // on somebody else's buy opens the sheet already on Buy. The reader decided
  // when they read the notification, not when they arrived.
  const parts = id.split(":")
  // A deposit toast made for the reader's own Buy is deposit:<sig>:<usd>:<mint>
  // (four parts) and opens that Buy with the dollars; a plain one ends empty.
  const side = kind === "social" ? parts[1] : kind === "deposit" && parts.length === 4 ? "buy" : ""
  const usd = kind === "deposit" && parts.length === 4 ? Number(parts[2]) : 0
  // The mint is always the LAST segment — order keys and timestamps carry
  // no colons, and this parse is shared by both notification kinds.
  const mint = parts.pop() ?? ""
  // The token room is where a launch is consumed on every host; without a
  // route the panel opened wherever it last was, launch untaken.
  if (mint) void chrome.storage.local.set({ initialRoute: `/token/${mint}` })
  chrome.sidePanel.setOptions({
    enabled: true,
    path: chrome.runtime.getURL(
      "src/entries/side_panel/index.html" +
        (mint
          ? "?mint=" +
            encodeURIComponent(mint) +
            (side === "buy" ? "&side=buy" : "") +
            (usd > 0 ? "&usd=" + usd : "") +
            "&src=notification"
          : "?src=notification"),
    ),
  })
  chrome.windows.getLastFocused((w) => {
    if (w?.id === undefined) return
    try {
      chrome.sidePanel.open({ windowId: w.id })
    } catch {
      // No gesture context — the panel is now pointed at the asset anyway.
    }
  })
  chrome.notifications.clear(id)
})

// Handle alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  /**
   * AN ALARM IS A COLD WAKE. Chrome evicts this worker on idle and the
   * alarm is what brings it back, and for a moment after that
   * `auth.currentUser` is null while Firebase rehydrates (lib/axios.ts).
   * Every poll below starts with "signed out? then nothing to do", so on
   * an idle browser each tick read null and returned: a filled limit
   * order or a landed deposit went unnoticed until the reader opened a
   * page that kept the worker warm. The requests themselves already wait
   * for Firebase (backendApi's interceptor); the guards in front of them
   * did not. Capped at 3s by whenAuthSettled, free once settled.
   */
  await whenAuthSettled()
  if (alarm.name === ORDER_WATCH_ALARM) {
    try {
      await checkOrderFills()
    } catch {
      // A failed poll is retried by the next alarm; there is nobody to tell.
    }
    try {
      await checkInAlerts()
    } catch {}
    try {
      await checkPriceAlerts()
    } catch {
      // Same posture: the next tick retries, and alerts were kept untouched.
    }
    try {
      await checkPositionMoves()
    } catch {
      // Anchors were not rewritten on a failed read; the next tick retries.
    }
    try {
      // Same reason as the follow watch: it reads the freshly written book
      // cache. Its own gate means it does nothing at all on 719 of the 720
      // ticks in a day.
      await checkDailyDigest()
    } catch {
      // The day was not marked, so tomorrow morning asks again.
    }
    try {
      await checkExternalTransfers()
    } catch {
      // The cursor only moves on a successful pass, so a failed poll
      // re-asks the same window next tick. Nothing is lost, only late.
    }
    try {
      // Last in the chain ON PURPOSE: it reads the book cache the position
      // watch above just refreshed, so a sell is judged against a fresh
      // holding rather than one from two minutes ago.
      await checkFollowTrades()
    } catch {
      // The watermark only moves on a successful read, so a failed poll
      // loses nothing — the next tick asks for the same window again.
    }
    return
  }
  if (alarm.name === SITE_PRESENCE_ALARM) {
    await beatSitePresence()
    return
  }
  if (alarm.name === "checkNotifications") {
    // An alarm created by an earlier install outlives the create above.
    if (!CAP.gamification) return
    const user = auth.currentUser
    if (!user) {
      return
    }
    /**
     * THE UNREAD POLL AND ITS BADGE ARE GONE.
     *
     * Every minute, for every signed-in reader, this asked the server how
     * many unread notifications they had and painted a red toolbar badge
     * with the answer. Three things were wrong with it by the time it was
     * removed:
     *
     *   The count was of the SOCIAL inbox — follow, comment, reply,
     *   mention, share — and that inbox closed on 2026-09-20 because no
     *   money event could ever reach it.
     *
     *   It had no destination. Clicking the toolbar icon opens the side
     *   panel, which since that day has no notifications surface at all;
     *   the badge pointed at a room that does not exist.
     *
     *   It could never go down. The only path that clears the badge is a
     *   CLEAR_NOTIFICATION_BADGE message with zero senders in the repo,
     *   and the only path that marks rows read has zero callers too, so
     *   the number could rise and never fall.
     *
     * The news a reader actually acts on — a filled order, a ringing
     * alert — reaches them as an OS notification and as the chip's own
     * bell, neither of which goes through this count.
     */

    /**
     * MOVEMENT, NOT POSITION. A rank badge is wallpaper — true all day, so
     * it says nothing on any given day. What a person reacts to is having
     * PASSED somebody while they were not looking.
     *
     * Rides the badge alarm rather than adding a timer: it already runs
     * with an authenticated user and already talks to the backend, and a
     * climb announced a minute late is still a climb. The rules that keep
     * it quiet — up only, never on a first sighting, at most once a day,
     * never for a single place — live in helpers/rankMove where they can
     * be tested without a browser.
     */
    try {
      const { rankMove, RANK_MEMORY_KEY } = await import("~/helpers/rankMove")
      // A poll gives up before its own next run: this alarm fires every
      // minute and the shared client waits 90 seconds, so a slow answer
      // was still outstanding when the next request went out. 90s belongs
      // to a swap, which broadcasts and waits for the chain; it does not
      // belong to a read.
      const r = await backendApi.get("/flywheel/leaderboard?period=week&limit=1", {
        timeout: NOTIFY_POLL_TIMEOUT_MS,
      })
      const rank = r?.data?.viewerRank ?? null
      const stored = await chrome.storage.local.get(RANK_MEMORY_KEY)
      const verdict = rankMove(Date.now(), rank, stored?.[RANK_MEMORY_KEY] ?? null)
      if (verdict) {
        await chrome.storage.local.set({ [RANK_MEMORY_KEY]: verdict.memory })
        if (verdict.say) {
          chrome.notifications.create(`rank:${verdict.memory.rank}:${Date.now()}`, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/logo.png"),
            title: "You moved up",
            message: verdict.say,
            priority: 1,
          })
        }
      }
    } catch {
      // A rank we could not read is not news. Silence, and try again on
      // the next tick — this must never disturb the badge above it.
    }
  }
})

const signInToFirebase = async (access_token: string) => {
  const firebaseUser = auth.currentUser
  if (!firebaseUser) {
    console.debug("Signing in to firebase", access_token?.slice(0, 10))
    signInWithCustomToken(auth, access_token).then((userCredential) => {
      console.warn("User signed in", userCredential)
    })
  }
}

// === PRICE TICKS SOCKET (public /ticks namespace) ===
//
// This socket OUTLIVED chat, which is exactly why it exists. Ticks used to
// ride chat's authenticated connection; chat left the product, and /ticks is
// public because a mint's USD price already is (it's the same number
// /embed/asset/match hands every visitor) — which also means signed-out
// readers get live prices, something the old channel refused by construction.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL
//
// The background is ONE socket client fronting MANY tabs, so this keeps a
// ref-count per mint. The chat-era version emitted unwatch straight through:
// close one of two tabs watching WIF and the OTHER tab's price froze,
// because the single shared socket left the room for both. Counting fixes
// that, and re-emitting on "connect" fixes its sibling — after a reconnect,
// socket.io restores no rooms, so every card silently stopped ticking until
// remount.

let ticksSocket: Socket | null = null
/** mint → how many cards (across all tabs) currently want its ticks. */
const watchedPriceMints = new Map<string, number>()
/** hostname → how many cards are alive there. Feeds the "N online" count:
 *  presence used to be chat's join-room + Redis, and dies with chat. */
const watchedPageHosts = new Map<string, number>()

const ensureTicksSocket = (): Socket | null => {
  if (ticksSocket) return ticksSocket
  // With no /ticks server, socket.io would reconnect with backoff for as
  // long as the worker lives. The chip's price still moves on the order
  // watch's /prices read.
  if (!CAP.ticks) return null
  if (!BACKEND_URL) return null
  ticksSocket = io(`${BACKEND_URL}/ticks`, {
    transports: ["websocket", "polling"],
    autoConnect: true,
  })

  ticksSocket.on("connect", () => {
    // Rooms do not survive a reconnect; re-join everything still watched.
    for (const mint of watchedPriceMints.keys()) {
      ticksSocket?.emit("watch-price", { mint })
    }
    for (const host of watchedPageHosts.keys()) {
      ticksSocket?.emit("watch-page", { host })
    }
  })

  // A live price tick from PriceTickService's 3s loop. Broadcast to every
  // tab rather than tracking which tab asked for which mint: a person
  // realistically has a handful of tabs, the payload is three numbers, and
  // each content script already ignores any mint that is not its own
  // current match (see main.tsx's POPPIN_PRICE_TICK handler) — a second
  // bookkeeping map here would duplicate that filter, not replace it.
  ticksSocket.on("price-tick", (data: { mint: string; usdPrice: number; change24hPct: number | null }) => {
    chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id === undefined) continue
        chrome.tabs.sendMessage(tab.id, { type: "POPPIN_PRICE_TICK", ...data }, () => {
          void chrome.runtime.lastError // no card on this tab — expected, not an error
        })
      }
    })
  })

  return ticksSocket
}

const watchPriceMint = (mint: string | undefined, host?: string): void => {
  if (!mint) return
  watchedPriceMints.set(mint, (watchedPriceMints.get(mint) ?? 0) + 1)
  // Lazy: the socket exists only once a card actually wants a price. A
  // reader who never meets a card never opens a connection.
  const socket = ensureTicksSocket()
  socket?.emit("watch-price", { mint })
  if (host) {
    watchedPageHosts.set(host, (watchedPageHosts.get(host) ?? 0) + 1)
    socket?.emit("watch-page", { host })
  }
}

const unwatchPriceMint = (mint: string | undefined, host?: string): void => {
  if (!mint) return
  const n = watchedPriceMints.get(mint) ?? 0
  if (n <= 1) {
    watchedPriceMints.delete(mint)
    ticksSocket?.emit("unwatch-price", { mint })
  } else {
    watchedPriceMints.set(mint, n - 1)
  }
  if (host) {
    const h = watchedPageHosts.get(host) ?? 0
    if (h <= 1) {
      watchedPageHosts.delete(host)
      ticksSocket?.emit("unwatch-page", { host })
    } else {
      watchedPageHosts.set(host, h - 1)
    }
  }
}


let isSidePanelOpen = false;

// Listen for extension pin status changes
(chrome.action as any).onUserSettingsChanged.addListener((userSettings: { isOnToolbar?: boolean }) => {
  if (userSettings.isOnToolbar === true) {
    // Extension was pinned, broadcast to all extension views
    chrome.runtime.sendMessage({
      type: "EXTENSION_PIN_STATUS_CHANGED",
      payload: { isPinned: true }
    }).catch(() => {
      // Ignore errors if no listeners
    })
  }
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    isSidePanelOpen = true;
    // Notify content script that side panel is opened
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if(tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "SIDEPANEL_OPENED"
        })
      }
    })

    port.onDisconnect.addListener(() => {
      isSidePanelOpen = false;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0]
        if(tab.id) {
        chrome.tabs.sendMessage(tab.id, {
            type: "SIDEPANEL_CLOSED"
          })
        }
      })
    });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-side-panel") {

      if(!isSidePanelOpen) {
        chrome.sidePanel.open({ windowId: tab?.windowId as number });
      } else {
        chrome.runtime.sendMessage({
          type: "CLOSE_SIDEPANEL"
        })
      }

  }
});

// === EXTERNAL MESSAGE LISTENER (web → extension) ===
//
// A different event than the onMessage if-chain above — only reaches
// messages sent via chrome.runtime.sendMessage(EXTENSION_ID, ...) from
// origins listed in the manifest's externally_connectable
// (vite.config.ts already sets this to NEXT_PUBLIC_HOST_PERMISSIONS,
// "https://*.poppin.so/*" in production — no manifest change needed for
// this to reach us).
//
// "extension-signin": app.poppin.so's /auth page, opened via
// chrome.tabs.create from welcome's SignInStep.tsx, announces its token
// once POST /auth/login-or-create resolves. token is THAT response's
// custom token (not a raw Firebase ID token) — login-or-create already
// created the backend user row, so by the time this fires there is always
// a row to read back via GET /users/me.
//
// It arrives on TWO channels, and both land here:
//   • onMessageExternal — the page's own chrome.runtime.sendMessage.
//     Chrome injects that API for externally_connectable pages; BRAVE
//     does not, which is how a finished sign-in never reached the
//     extension there (measured live 2026-08-24).
//   • onMessage — the content-script relay (helpers/signinRelay), which
//     has chrome.runtime in every Chromium. In Chrome both fire; the
//     isSameUser guard makes the second a no-op.
//
// On success the auth TAB is closed from here: the page's own
// window.close() is at the mercy of each browser's opener rules (Brave
// left the tab open), and tabs.remove is not.
/**
 * ONE TOKEN, ONE SIGN-IN. The page relays the same token on two channels
 * (a content-script message and onMessageExternal) within milliseconds;
 * the second arrival used to sign in again, count signin_completed twice
 * and, on a returning sign-in, skip the "This is you" screen because the
 * first had already marked onboarding seen.
 */
let lastSigninToken: { token: string; at: number; announced: boolean } | null = null

function handleExtensionSignin(
  token: unknown,
  sendResponse: (r: unknown) => void,
  senderTabId: number | undefined,
) {
  if (!token || typeof token !== "string") {
    sendResponse({ success: false, error: "no token" })
    return
  }
  if (lastSigninToken && lastSigninToken.token === token && Date.now() - lastSigninToken.at < 15_000) {
    sendResponse({ success: true, duplicate: true })
    // The sign-in is real even though this arrival is the echo: whoever is
    // waiting to be told has still not been told by the first one if it was
    // itself a silent ending. WHEN there is a session, not when this message
    // landed — the first arrival is very probably still inside
    // signInWithCustomToken (see announceSigninForToken).
    announceSigninForToken(token)
    if (senderTabId !== undefined) chrome.tabs.remove(senderTabId).catch(() => {})
    return
  }
  lastSigninToken = { token, at: Date.now(), announced: false }

  const closeAuthTab = () => {
    if (senderTabId === undefined) return
    // IMMEDIATELY: the auth tab has no ending to read any more — the page
    // shows "One moment…" until one of its two closers lands, and focus
    // falls back to the welcome tab already sitting on You're in.
    chrome.tabs.remove(senderTabId).catch(() => {
      // Already closed itself — the good case.
    })
  }

  const decodedToken = jwtDecode<{ uid?: string }>(token)
  const isSameUser = decodedToken.uid === auth?.currentUser?.uid

  if (!isSameUser || !auth?.currentUser) {
    signInWithCustomToken(auth, token)
      .then((userCredential) => {
        deliverTelemetry("signin_completed", { source: "web_bridge" })
        // One identity at a time: a Google session replaces a wallet one.
        if (ARC_EDITION) void clearWalletSession()
        // A fresh session: push the local alerts up and check in now.
        alertsPushedThisLife = false
        void checkInAlerts()
        sendResponse({ success: true, user: userCredential.user })
        // Tell any open extension view (welcome tab today) AND the tabs the
        // reader came from that a sign-in just completed — same broadcast
        // shape as EXTENSION_PIN_STATUS_CHANGED above. The session is in hand
        // here (the promise resolved), so this says it immediately; going
        // through the same door as the other two is what makes it ONE
        // announcement per token rather than one per arriving message.
        announceSigninForToken(token)
        closeAuthTab()
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message })
      })
    return
  }

  sendResponse({ success: true, user: auth.currentUser })
  // The reader was ALREADY this person: nothing to sign in, and for that
  // exact reason nothing ever said so. This is the half-signed-in reader
  // who could press Sign in forever. The session is already there — this
  // branch is only reached with auth.currentUser set — so it goes out now.
  announceSigninForToken(token)
  // The duplicate channel's arrival: the sign-in already happened, but the
  // tab that announced it still deserves to be tidied away.
  closeAuthTab()
}

/**
 * A WALLET SESSION FROM arc-api's SIGN-IN PAGE.
 *
 * Checked before it is kept: the token is asked for /users/me against
 * arc-api itself, so only a session arc-api signed and still honours is
 * stored. Then Firebase is signed out, because lib/axios prefers a Firebase
 * user and two identities in one browser is how a reader ends up trading
 * from the account they did not mean. The same broadcast as a Google sign-in
 * tells the welcome tab, and the page's tab is closed from here.
 */
/** Confirm windows still open, by window id: which trade, and whether the wallet finished it. */
const arcConfirmWindows = new Map<number, { id: string; done: boolean }>()
const CONFIRM_DID_NOT_OPEN = "Your wallet's window did not open. Try again."

async function openArcConfirm(url: unknown, id: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!ARC_EDITION || !ARC_API_HOST || typeof url !== "string" || typeof id !== "string") {
    return { ok: false, error: CONFIRM_DID_NOT_OPEN }
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, error: CONFIRM_DID_NOT_OPEN }
  }
  if (u.protocol !== "https:" || u.hostname !== ARC_API_HOST || u.pathname !== "/api/v1/wallet/confirm") {
    return { ok: false, error: CONFIRM_DID_NOT_OPEN }
  }
  try {
    const w = await chrome.windows.create({ url, type: "popup", width: 440, height: 680, focused: true })
    if (w?.id !== undefined) arcConfirmWindows.set(w.id, { id, done: false })
    return { ok: true }
  } catch {
    // A browser without popup windows still has tabs.
    try {
      await chrome.tabs.create({ url })
      return { ok: true }
    } catch {
      return { ok: false, error: CONFIRM_DID_NOT_OPEN }
    }
  }
}

function arcTradeDone(id: string): void {
  for (const [windowId, entry] of arcConfirmWindows) {
    if (entry.id !== id) continue
    entry.done = true
    // A moment on "Done." before the window goes.
    setTimeout(() => void chrome.windows.remove(windowId).catch(() => {}), 1500)
  }
}

// Closed before the wallet sent anything: the trade is cancelled on arc-api,
// so the wait in arc/ownWalletTrade.ts ends at once instead of timing out.
// A trade the wallet did send is not affected; arc-api only cancels a waiting one.
chrome.windows.onRemoved.addListener((windowId) => {
  const entry = arcConfirmWindows.get(windowId)
  if (!entry) return
  arcConfirmWindows.delete(windowId)
  if (entry.done) return
  void backendApi({ url: "/embed/asset/external/cancel", method: "POST", data: { id: entry.id } }).catch(() => {})
})

async function handleArcWalletSignin(
  token: unknown,
  sendResponse: (r: unknown) => void,
  senderTabId: number | undefined,
): Promise<void> {
  const session = decodeWalletToken(token)
  if (!session) {
    sendResponse({ success: false, error: "not a wallet session" })
    return
  }
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${session.token}`, extension: "true" },
    })
    if (!res.ok) {
      sendResponse({ success: false, error: `arc-api answered ${res.status}` })
      return
    }
  } catch (e) {
    sendResponse({ success: false, error: (e as Error)?.message ?? "arc-api unreachable" })
    return
  }
  if (auth?.currentUser) {
    try {
      await auth.signOut()
    } catch {
      // The wallet session below is what lib/axios will send either way.
    }
  }
  await saveWalletSession(session.token)
  deliverTelemetry("signin_completed", { source: "wallet" })
  sendResponse({ success: true, uid: session.uid })
  announceSignin()
  if (senderTabId !== undefined) chrome.tabs.remove(senderTabId).catch(() => {})
}

/** Long enough for a custom-token sign-in on a bad connection, and no longer. */
const SIGNIN_SESSION_WAIT_MS = 15_000

/**
 * "THERE IS A SESSION", NOT "A MESSAGE ARRIVED".
 *
 * Every ending above says the same thing through here, and the difference is
 * WHEN it is allowed to be said.
 *
 * THE RACE, MEASURED. The page relays one token on two channels within
 * milliseconds. In Chrome with the origin granted both land: the first takes
 * the fresh branch and spends a network round trip inside
 * signInWithCustomToken; the second falls into the duplicate branch
 * immediately. So the echo announced FIRST, with `auth.currentUser` still
 * null — the welcome tab's listener ran afterAuthed(), which asks
 * getCurrentUser through this worker's axios, which attaches no Authorization
 * header because there is no user to take a token from. A 401 there routes
 * the reader to /create-profile with SignInStep unmounted, so the real
 * announcement a moment later reaches nobody at all.
 *
 * THE SMALLEST HONEST SIGNAL is the one thing the reply depends on:
 * `auth.currentUser`. It is set by the SDK, and onAuthStateChanged is how it
 * says so — the waiting itself lives in helpers/sessionReady.ts, where it can
 * be tested, together with the note on why whenAuthSettled() is not that
 * signal and why a timeout says nothing at all.
 *
 * ONCE PER TOKEN. Two announcements mean two afterAuthed() runs, and that
 * function reads-then-writes poppinHasSeenOnboarding: the second run sees the
 * flag the first one just set, decides this browser has been here before, and
 * a newborn account loses its /claim screen. Keyed on the TOKEN and never on
 * the uid, because a reader who presses Sign in again gets a new token and
 * must be answered again — that press is the bug this announcement exists for.
 */
function announceSigninForToken(token: string): void {
  whenSessionReady({
    currentUser: () => auth?.currentUser ?? null,
    subscribe: (onUser, onError) => onAuthStateChanged(auth, onUser, onError),
    timeoutMs: SIGNIN_SESSION_WAIT_MS,
    then: () => {
      if (lastSigninToken?.token === token) {
        if (lastSigninToken.announced) return
        lastSigninToken.announced = true
      }
      announceSignin()
    },
  })
}

/**
 * THE SESSION IS NOT THE NEWS — SAYING SO IS.
 *
 * Sign-in has three endings above and only one of them used to speak: the
 * fresh signInWithCustomToken. The other two — the same token arriving on
 * the second channel within 15s, and the reader who is ALREADY signed in as
 * that uid — quietly took the session, closed the auth tab, and left the
 * welcome tab still showing its "Sign in" button. Pressing it ran the whole
 * trip again and landed on the same silent ending. Forever, for a person
 * who was signed in the entire time.
 *
 * So the announcement is one function, called from every ending. It goes
 * out on BOTH channels, and both are load-bearing:
 *   • runtime.sendMessage reaches extension PAGES (the welcome tab, whose
 *     SignInStep listens for exactly this and calls afterAuthed()).
 *   • tabs.sendMessage reaches CONTENT SCRIPTS, which runtime.sendMessage
 *     cannot. Without it the chip that sent somebody to sign in stayed
 *     "signed out" for up to 20s of book TTL after they came back — right
 *     at the peak of intent.
 *
 * DECLARED AFTER ITS CALLERS, which is not a style whim. The tab patterns
 * below contain the characters that open a block comment, and this repo's
 * specs read main.ts as TEXT with a regex comment-stripper. Hoisting put
 * that sequence ABOVE handleExtensionSignin, where it swallowed the
 * duplicate-token guard that fund-doors.spec.ts asserts on. A function
 * declaration hoists; the fake comment it opens does not move with it.
 */
function announceSignin() {
  chrome.runtime.sendMessage({ type: "EXTENSION_SIGNIN_COMPLETE" }).catch(() => {
    // Ignore errors if no listeners
  })
  chrome.tabs.query({ url: ["*://x.com/*", "*://twitter.com/*"] }, (tabs) => {
    for (const t of tabs) {
      if (t.id !== undefined) {
        chrome.tabs
          .sendMessage(t.id, { type: "EXTENSION_SIGNIN_COMPLETE" })
          .catch(() => {})
      }
    }
  })
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  /**
   * app.poppin.so asking the panel to take over.
   *
   * The funding page had its own copy of the deposit addresses, which is a
   * second place to keep the same truth. It now sends people to the one that
   * already existed — the panel's Add funds screen — and only draws its own
   * copy when there is no extension to hand off to. Same allowlist as
   * sign-in (externally_connectable, *.poppin.so), and route-then-open is
   * the mechanism the card already uses.
   */
  if (message.action === "open-panel-route") {
    const route = typeof message.route === "string" ? message.route : "/"
    // Only routes this product owns. A string from a page decides where the
    // panel lands, so it picks from a list rather than being trusted.
    const allowed = ["/receive", "/wallet-ui", "/"]
    const safe = allowed.includes(route) ? route : "/"
    void chrome.storage.local.set({ initialRoute: safe }).then(() => {
      chrome.windows.getLastFocused((w) => {
        if (w?.id === undefined) return
        try {
          chrome.sidePanel.open({ windowId: w.id })
        } catch {
          // No gesture context: the route is stored, so the reader's next
          // open lands where they asked.
        }
      })
    })
    sendResponse({ success: true })
    return true
  }
  if (message.action === "extension-signin") {
    handleExtensionSignin(message.token, sendResponse, sender.tab?.id)
    return true // async response
  }

  // "extension-x-connected": apps/web's /twitter/success page, reached at the
  // end of the X OAuth callback. Carries no payload — the link is already
  // written server-side by then, including the Poppin username derived from
  // the X handle. This only exists so onboarding can move on immediately
  // instead of waiting for the next user refetch.
  if (message.action === "extension-x-connected") {
    chrome.runtime.sendMessage({ type: "EXTENSION_X_CONNECTED" }).catch(() => {
      // Ignore errors if no listeners
    })
    sendResponse({ success: true })
    return true
  }

  return true
});

