/** @jsxImportSource preact */
/*
 * THE PRAGMA ABOVE IS LOAD-BEARING. The rest of this app compiles JSX with the
 * REACT runtime (vite uses @vitejs/plugin-react; tsconfig says react-jsx), but
 * this tree is rendered by PREACT's `render` in mount.tsx. Without the pragma,
 * the JSX here produces React elements — and Preact silently DROPS any child
 * whose `constructor` is not undefined (its guard against JSON injection),
 * which React elements are. The result is not an error: render() succeeds, the
 * shadow root stays empty, and the card is invisible everywhere while every
 * log line says it mounted. That is exactly how this shipped broken; jsdom
 * tests did not catch it because the failure is in what PAINTS.
 */
import { render } from "preact"
import { fenceKeys } from "~/helpers/decimalInput"
import { ensureBrandFont } from "~/helpers/brandFont"
import { claimHost } from "~/helpers/orphanSweep"
import { SPOT_CARD_STYLE } from "./style"
import {
  SpotCard,
  SpotPill,
  type CardPost,
  type OutcomeState,
  type SpotAsset,
  type SpotCardHandlers,
} from "./SpotCard"

/** How long .wrap.leaving runs in style.ts. The tree stays mounted for
 *  exactly this long so the exit is seen rather than cut. */
const LEAVE_MS = 160

/**
 * How long the tab stays at full presence before settling into the edge.
 *
 * Long enough to be noticed and learned, short enough that it is out of the
 * way before anyone starts actually reading — or watching. See .pill-rest.
 */
const PILL_REST_MS = 4000

/**
 * Mounts the card into a CLOSED shadow root on the host page.
 *
 * Closed, not open, and not an iframe:
 *
 *   shadow root  the host page's CSS cannot reach in and ours cannot leak out.
 *                `:host { all: initial }` resets every inherited property at
 *                the boundary. Without it the card inherits whatever the page
 *                decided — see spot-card.isolation.spec.ts.
 *   CLOSED       page scripts cannot walk `.shadowRoot` to read or click our
 *                DOM. An open root would leave a trade button reachable by
 *                anything else running on the page.
 *   not iframe   an iframe would isolate just as well and cost a document, a
 *                second style pipeline, and message-passing for every state
 *                change. The card is small and same-origin-ish by nature.
 *
 * One instance at a time, keyed off a sentinel attribute: the content script
 * can be injected more than once per tab (see the idempotency note in
 * contentScript/primary/main.tsx), and two cards would mean two quote loops.
 */

const HOST_ATTR = "data-poppin-spot-card"

export interface SpotCardController {
  setQuote(
    text: string,
    opts?: { error?: boolean; canConfirm?: boolean; sub?: string },
  ): void
  setOutcome(
    text: string,
    state: OutcomeState,
    opts?: { share?: { onPoppin: () => Promise<boolean>; onX: () => Promise<boolean> } },
  ): void
  /** The page's conversation arrived (or changed). Empty hides the row.
   *  `hasMore` is the server's own `hasNextPage`: the card fetches a page,
   *  not the conversation, and without this it printed its fetch limit as
   *  the conversation's size. */
  setPosts(posts: readonly CardPost[], hasMore?: boolean): void
  /** How many Poppin users are on this page. null/absent renders nothing. */
  setPresence(n: number | null): void
  /** The reader's unread notifications. 0/null renders nothing. */
  setUnread(n: number | null): void
  /** Watchlist membership. null (the default) draws no star at all. */
  setWatched(v: boolean | null): void
  /** ONBOARDING_V2 ladder state; null = nothing in the way. */
  setGate(g: "signin" | "topup" | null): void
  /** Open the trade panel — the side panel's asset strip drives this.
   *  `mode` picks the side; omitted means buy, which every existing caller
   *  already meant. */
  expand(mode?: "buy" | "sell"): void
  /** The reader's own face + name, once known. */
  setMe(me: { name: string; photoUrl: string | null } | null): void
  /** The reader's USDC, once known. null = unknown = no chip. */
  setCash(usd: number | null): void
  /**
   * A live tick arrived (PriceTickService, over the socket every signed-in
   * extension already holds — see attachSpotCard's watchPrice). Mutates the
   * SAME asset object the card was mounted with and repaints; the panel's
   * amount math (spotCardFlow) reads asset.usdPrice on every quote, so a
   * tick landing mid-panel is priced correctly on the very next keystroke
   * with no separate wiring.
   */
  setPrice(usdPrice: number, change24hPct: number | null): void
  /**
   * The reader's holding of this mint changed — which, in practice, means
   * they just bought or sold it.
   *
   * Mutates the SAME asset object the card was mounted with, exactly as
   * setPrice does, so the panel's sell math (spotCardFlow's
   * usdToRawOfHolding) reads the new balance on the very next keystroke
   * with no separate wiring.
   */
  setBalance(balance: { uiAmount: number; raw: string } | null): void
  /** Retreat to the edge tab. What × means now — see collapse() below. */
  collapse(): void
  /** Come back out of the tab. What clicking the tab means. */
  open(): void
  /**
   * What this page matched, for surfaces that cannot see into the closed
   * shadow root. A summary, not the live SpotAsset: the panel renders a
   * strip from it and nothing more.
   */
  matchedAsset: {
    mint: string
    symbol: string
    displayName: string
    priceUsd: number | null
    change24hPct: number | null
  }
  destroy(): void
}

export function mountSpotCard(
  asset: SpotAsset,
  handlers: SpotCardHandlers,
  opts: {
    /**
     * Arrive as the edge tab rather than the open card. The caller decides
     * (see shouldAutoOpen in attachSpotCard): a reader meeting this on a
     * site for the first time gets the card, because a tab nobody has
     * learned yet is a tab nobody opens — after that the page stays the
     * page and the card comes out when asked for.
     */
    startCollapsed?: boolean
  } = {},
): SpotCardController {
  // Replace any previous card rather than stacking a second one.
  document.querySelectorAll(`[${HOST_ATTR}]`).forEach((n) => n.remove())

  ensureBrandFont()

  const host = document.createElement("div")
  host.setAttribute(HOST_ATTR, "")
  // Ours, so the stranger-watcher (helpers/orphanSweep) leaves it alone.
  claimHost(host)
  // The card lives on somebody else's page, and pages bind hotkeys: on X,
  // "." in our price field also fired X's shortcut and the DOM churn closed
  // the sheet mid-typing. Keys born in this shadow die at the host.
  fenceKeys(host)
  const root = host.attachShadow({ mode: "closed" })

  const style = document.createElement("style")
  style.textContent = SPOT_CARD_STYLE
  const mountPoint = document.createElement("div")
  root.append(style, mountPoint)

  // documentElement, not body: a page that replaces <body> (SPA route changes
  // do this) would otherwise take the card with it.
  document.documentElement.appendChild(host)

  /**
   * FULLSCREEN REMOVES US ENTIRELY.
   *
   * Someone who has put a video fullscreen has said, as plainly as a person
   * can say it through an interface, that they want this content and nothing
   * else. A trade tab floating over their film is the single rudest thing
   * this surface could do, and no amount of dimming makes it acceptable —
   * the answer there is absence, not subtlety.
   *
   * An inline style on the HOST, not a class inside the shadow root: it
   * needs no re-render, and inline styles on the host outrank the
   * `:host { all: initial }` reset, so it cannot be argued with from inside.
   */
  const syncFullscreen = () => {
    host.style.display = document.fullscreenElement ? "none" : ""
  }
  document.addEventListener("fullscreenchange", syncFullscreen)
  // Some players go fullscreen through the webkit-prefixed path only.
  document.addEventListener("webkitfullscreenchange", syncFullscreen)
  syncFullscreen()

  /**
   * EVERYTHING THE CARD IS TOLD, as one object.
   *
   * This was fifteen loose `let`s, and every controller method below repeated
   * the same two lines: assign one of them, then call paint(). Fifteen chances
   * for a setter to mutate and forget to repaint — which is not hypothetical,
   * it is the same shape as the four "one surface kept its own copy" bugs this
   * refactor is undoing, one layer down.
   *
   * `set()` makes the repaint structural rather than remembered.
   */
  interface CardView {
    quote: string
    quoteSub?: string
    quoteError: boolean
    canConfirm: boolean
    outcome?: {
      text: string
      state: OutcomeState
      share?: { onPoppin: () => Promise<boolean>; onX: () => Promise<boolean> }
    }
    posts: readonly CardPost[]
    postsHasMore: boolean
    presence: number | null
    unread: number | null
    watched: boolean | null
    gate: "signin" | "topup" | null
    me: { name: string; photoUrl: string | null } | null
    cashUsd: number | null
    expandSignal: number
    expandMode: "buy" | "sell"
    /** 'up'/'down' for one flash after a tick lands, then back to null — see
     *  setPrice below. Direction is the TICK's own move, not the 24h chip's:
     *  an asset can be up on the day and still tick down this second, and the
     *  flash answering "did it just do that" would be lying if it borrowed
     *  the day's colour instead of the instant's. */
    priceFlash: "up" | "down" | null
  }

  const view: CardView = {
    quote: "Enter an amount",
    quoteError: false,
    canConfirm: false,
    posts: [],
    postsHasMore: false,
    presence: null,
    unread: null,
    watched: null,
    gate: null,
    me: null,
    cashUsd: null,
    expandSignal: 0,
    expandMode: "buy",
    priceFlash: null,
  }

  /** Change what the card is told, and show it. One call, never two. */
  const set = (patch: Partial<CardView>): void => {
    Object.assign(view, patch)
    paint()
  }

  let collapsed = opts.startCollapsed === true
  /** Mid-exit: the card is still rendered, wearing its leave animation. */
  let leaving = false
  /** The tab's ONE motion, and only when a voice actually arrived. */
  let pillNudge = false
  /** The price flash's own clock, so two fast ticks cannot share one. */
  let flashTimer: ReturnType<typeof setTimeout> | null = null
  let leaveTimer: ReturnType<typeof setTimeout> | null = null
  /** Settled into the edge. Set once per appearance, never toggled back on
   *  a timer — the only things that wake it are hover (CSS) and a new voice. */
  let pillResting = false
  let restTimer: ReturnType<typeof setTimeout> | null = null

  /** Full presence now, edge in PILL_REST_MS. Called whenever the tab has a
   *  reason to be seen: it appears, or somebody just spoke. */
  const wakePill = () => {
    if (restTimer) clearTimeout(restTimer)
    pillResting = false
    restTimer = setTimeout(() => {
      pillResting = true
      restTimer = null
      paint()
    }, PILL_REST_MS)
  }

  const paint = () => {
    /**
     * BOTH TREES STAY MOUNTED; visibility flips. Collapsing used to render
     * pill-XOR-card, which DESTROYED the SpotCard tree: a half-written
     * reply, a typed amount, the open thread and the current view all died
     * to one stray ×, one Escape, or the panel door (which collapses by
     * design). The card runs no timers at rest, so the dormant tree costs
     * memory only - and reopening returns the reader exactly where they
     * were, which is what "closing something you can reopen" promised.
     */
    render(
      <>
        <div style={{ display: collapsed ? "" : "none" }}>
          <SpotPill
            symbol={asset.symbol}
            unread={view.unread}
            nudging={pillNudge}
            // Unread news outranks the retreat. The badge rides on the pill,
            // so a retreated tab takes the count off screen with it — and a
            // tab that hides "somebody answered you" to avoid bothering the
            // PAGE is being polite at the reader's expense instead.
            resting={pillResting && !(typeof view.unread === "number" && view.unread > 0)}
            onOpen={open}
          />
        </div>
        <div style={{ display: collapsed ? "none" : "" }}>
          <SpotCard
            asset={asset}
            handlers={handlers}
            {...view}
            leaving={leaving}
          />
        </div>
      </>,
      mountPoint,
    )
  }

  /**
   * Card → tab, with the exit SHOWN.
   *
   * × used to call destroy(), which removed the host from the DOM and left
   * the page with nothing: one stray click and the feature was gone until a
   * reload, on a surface whose whole job is to be available. Dismissing is
   * now a place to go rather than an ending, so the gesture is cheap to get
   * wrong — which is the only thing that makes a close button honest.
   */
  /**
   * A PAINT THAT THROWS MUST NOT STRAND THE STATE. The card's render is a
   * React tree with a chart, a feed and a sheet in it; if any of that throws
   * in the middle of a close, the old code left `leaving` true forever and
   * every later × returned at the first line without a sound. Measured on
   * CoinGecko: a card stuck half-painted, × dead. The close is the one
   * gesture that has to work no matter what the rest of the card is doing,
   * so it paints defensively and, failing that, hides at the DOM level.
   */
  const safePaint = () => {
    try {
      paint()
    } catch (err) {
      console.debug("[spot] paint threw during close; hiding at the DOM level", err)
      for (const child of Array.from(mountPoint.children)) {
        ;(child as HTMLElement).style.display = collapsed ? "" : "none"
      }
    }
  }

  const settleCollapse = () => {
    if (leaveTimer) {
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
    leaving = false
    collapsed = true
    try {
      wakePill()
    } finally {
      safePaint()
    }
  }

  function collapse(): void {
    /* Already on the way out: finish now rather than ignore the tap. A
       second × during the 160ms exit used to be swallowed, and a stranded
       `leaving` (see safePaint) made that swallow permanent. */
    if (leaving) {
      settleCollapse()
      return
    }
    if (collapsed) {
      /* Idempotent, and it re-asserts the hidden state: a card that is
         "collapsed" but somehow still on screen gets hidden by this tap
         instead of ignored by it. */
      safePaint()
      return
    }
    leaving = true
    safePaint()
    leaveTimer = setTimeout(settleCollapse, LEAVE_MS)
  }

  function open(): void {
    if (leaveTimer) {
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
    if (restTimer) {
      clearTimeout(restTimer)
      restTimer = null
    }
    if (!collapsed && !leaving) return
    leaving = false
    collapsed = false
    pillNudge = false
    paint()
  }

  if (collapsed) wakePill()
  paint()

  return {
    matchedAsset: {
      mint: asset.mint,
      symbol: asset.symbol,
      displayName: asset.displayName,
      priceUsd: asset.usdPrice,
      change24hPct: asset.change24hPct,
    },
    setQuote(text, opts = {}) {
      // A NEW QUOTE ENDS THE OLD OUTCOME, whatever it was.
      //
      // This used to clear only errors, on the reasoning that done/pending are
      // real decisions and should stay terminal. That reasoning was right
      // about the outcome and wrong about the panel: buy $2 of TSLAx, then
      // press Sell, and Confirm sell is dead — the completed BUY is still
      // holding the button hostage, and the only way out was dismissing the
      // card. Reported from a live page, and the worst possible place for it:
      // the reader has just been given a position and cannot act on it.
      //
      // A quote only ever happens because somebody touched the amount or
      // changed side, and either one means a new decision is being made. The
      // outcome of the last one is history at that point. It is still shown
      // right up until they move — nothing is being hidden, it is being
      // finished.
      set({
        outcome: undefined,
        quote: text,
        quoteSub: opts.sub,
        quoteError: Boolean(opts.error),
        canConfirm: Boolean(opts.canConfirm),
      })
    },
    setOutcome(text, state, opts = {}) {
      set({ outcome: { text, state, ...(opts.share ? { share: opts.share } : {}) } })
    },
    setPosts(next, hasMore) {
      const hadMore = Boolean(hasMore)
      // A voice ARRIVING is the tab's one licence to move. Growth only:
      // re-reading the same conversation after a vote is not news, and the
      // card's own nudge rule (see SpotCard) draws the same line.
      const grew = next.length > view.posts.length
      // The nudge is decided BEFORE set(), because set() is what paints —
      // and `pillNudge` is shell state, not part of `view`, so assigning it
      // afterwards would land a frame too late. Two tests caught exactly
      // that when this method was converted.
      if (grew && collapsed) {
        pillNudge = true
        // Back to full presence too: a nudge performed twelve pixels off
        // screen at .42 opacity is a nudge nobody sees.
        wakePill()
        setTimeout(() => {
          pillNudge = false
          paint()
        }, 560)
      }
      set({ posts: next, postsHasMore: hadMore })
    },
    setPresence(n) {
      set({ presence: n })
    },
    setWatched(v) {
      set({ watched: v })
    },
    setUnread(n) {
      set({ unread: n })
    },
    setGate(g) {
      set({ gate: g })
    },
    expand(mode = "buy") {
      // The panel's asset strip asking for the trade panel implies asking
      // for the card: opening a keypad inside a collapsed tab is nothing.
      open()
      set({ expandSignal: view.expandSignal + 1, expandMode: mode })
    },
    collapse,
    open,
    setMe(next) {
      set({ me: next })
    },
    setCash(usd) {
      set({ cashUsd: usd })
    },
    setBalance(balance) {
      asset.balance = balance
      paint()
    },
    setPrice(usdPrice, change24hPct) {
      // Silent no-op on a genuinely unchanged price: PriceTickService emits
      // whatever Jupiter answered even when nothing moved, and flashing on
      // every tick regardless of change would turn "something happened"
      // back into wallpaper — the exact failure mode style.ts's motion
      // rules exist to prevent.
      if (usdPrice === asset.usdPrice) return
      const dir = usdPrice > (asset.usdPrice ?? usdPrice) ? "up" : "down"
      asset.usdPrice = usdPrice
      asset.change24hPct = change24hPct
      set({ priceFlash: dir })
      /**
       * ONE FLASH, ONE TIMER. A bare setTimeout per tick meant two ticks
       * inside 700ms shared the first one's clock: the second flash was
       * wiped partway through by the first timer, so a fast-moving asset -
       * the one whose movement matters most - flickered instead of
       * flashing. One movement, one timing.
       */
      if (flashTimer) clearTimeout(flashTimer)
      flashTimer = setTimeout(() => {
        flashTimer = null
        set({ priceFlash: null })
      }, 700)
    },
    destroy() {
      if (flashTimer) clearTimeout(flashTimer)
      if (leaveTimer) clearTimeout(leaveTimer)
      if (restTimer) clearTimeout(restTimer)
      document.removeEventListener("fullscreenchange", syncFullscreen)
      document.removeEventListener("webkitfullscreenchange", syncFullscreen)
      render(null, mountPoint)
      host.remove()
    },
  }
}
