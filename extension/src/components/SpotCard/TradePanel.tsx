/** @jsxImportSource preact */
/*
 * THE PRAGMA ABOVE IS LOAD-BEARING — same reason as SpotCard.tsx and
 * mount.tsx. This tree is rendered by PREACT while the rest of the app
 * compiles JSX with React's runtime; without the pragma Preact silently
 * drops every child and render() succeeds into an empty shadow root.
 */
import type { ComponentChildren } from "preact"
import { normalizeDecimal } from "~/helpers/decimalInput"
import { decimalsFor, viewTradeSheet, type Reader } from "~/helpers/tradeSheetModel"
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks"
import {
  ISSUER_LABEL,
  PRESET_USD,
  RESTRICTION_NOTE,
  SELL_FRACTIONS,
  price,
  type OutcomeState,
  type SpotAsset,
  type SpotCardHandlers,
  type TradeMode,
} from "./SpotCard"

/**
 * The trade panel: pick an amount, read the quote, spend money.
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
 * SpotCard was 1,850 lines holding four views and sixteen pieces of state, and
 * that shape produced the same bug four times in one session: a surface kept a
 * private copy of something shared, and every later improvement missed it. The
 * panel is the cleanest seam to cut first — it is the one view whose state
 * belongs to nobody else.
 *
 * ── THE PROP COUNT IS THE POINT ─────────────────────────────────────────────
 * Measured before the move, this block referenced 36 outer names. Passing 36
 * props would not have been a split, just the same coupling spread over two
 * files. Ten arrive here; the other twenty-six resolve because:
 *
 *   the amount is OURS       mode, amount, and everything derived from them
 *                            (size, width, active chip, the usd number, the
 *                            input ref) live in here now. Nothing outside
 *                            asked about them.
 *   asset answers itself     canSell, holdingUsd and the restriction are read
 *                            off `asset`, not handed down beside it.
 *   the quote answers itself the line, its class, the dot and whether Confirm
 *                            is dead all follow from `quote`/`outcome`.
 *   sharing is a slot        `shareRow` arrives rendered. The share buttons
 *                            need state the FEED also reads, so the panel
 *                            holds none of it and simply gives it a place to
 *                            sit — same trick as `conversationStrip`.
 */
export interface TradePanelProps {
  asset: SpotAsset
  handlers: SpotCardHandlers
  /** Quote line text; the parent owns quoting. */
  quote: string
  /** Secondary quote line — route/impact detail, rendered small and muted. */
  quoteSub?: string
  quoteError?: boolean
  /** Enables Confirm. The parent sets it once an amount is valid. */
  canConfirm?: boolean
  outcome?:
    | {
        text: string
        state: OutcomeState
        share?: {
          onPoppin: () => Promise<boolean>
          onX: () => Promise<boolean>
        }
      }
    | undefined
  /** ONBOARDING_V2's ladder: what stands between this reader and a trade. */
  gate?: "signin" | "topup" | null
  /**
   * The conversation, rendered by the parent and placed under the quote.
   *
   * Under the quote and above Confirm on purpose: the last thing read before
   * money moves is what other people said. The panel used to be the one place
   * the conversation was deleted from, which put the card's best argument
   * everywhere except the moment it mattered.
   */
  conversationStrip?: ComponentChildren
  /** Share destinations for a confirmed fill, rendered by the parent. */
  shareRow?: ComponentChildren
  /** Focus the amount on arrival. Bumped by the parent when the panel opens. */
  focusSignal?: number
  /**
   * The reader's cash, holding and cost basis. `null` while it loads, which
   * is not "nothing" and never blocks a trade.
   */
  reader?: Reader | null
  /**
   * Which side the reader pressed to get here.
   *
   * The panel owns `mode` after that, but it has to START on the side that
   * was asked for: the card is unmounted while collapsed, so each open is a
   * fresh mount and this is simply the initial value. I dropped this on the
   * first pass of the extraction and pressing "Sell WIF" opened a Buy panel —
   * no test covered it, which is why one does now.
   */
  initialMode?: TradeMode
}

export function TradePanel({
  asset,
  handlers,
  reader,
  quote,
  quoteSub,
  quoteError,
  canConfirm,
  outcome,
  gate,
  conversationStrip,
  shareRow,
  focusSignal,
  initialMode = "buy",
}: TradePanelProps) {
  const [mode, setMode] = useState<TradeMode>(initialMode)
  const [amount, setAmount] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // The keypad greets you ready to type. Expansion is always a deliberate
  // press (Buy, Sell, or the panel's strip), so stealing focus is answering
  // the question the press just asked.
  useEffect(() => {
    inputRef.current?.focus()
  }, [focusSignal])

  const canSell = (asset.balance?.uiAmount ?? 0) > 0
  const holdingUsd =
    canSell && asset.usdPrice !== null
      ? (asset.balance?.uiAmount ?? 0) * asset.usdPrice
      : null

  /**
   * MARKET OR LIMIT, and everything that follows from it.
   *
   * The card composes the state; every decision made from it comes from the
   * shared rulebook, so this surface cannot answer "is that a profit" or
   * "is that a valid trigger" differently from the panel or the chip. It
   * only lays the answers out.
   */
  const [kind, setKind] = useState<"market" | "limit">("market")
  const [trigger, setTrigger] = useState("")
  /** A limit order in flight: the press was completely silent before -
   *  no label change, no reload, the parked order invisible until a
   *  remount. One flag drives the label, the disable and the reload. */
  const [placing, setPlacing] = useState(false)
  /**
   * Read once, when the panel opens — never on mount. The card is attached
   * to every page anybody visits and a portfolio is an authenticated read;
   * the same rule onBook follows.
   */
  const [ownReader, setOwnReader] = useState<Reader | null>(null)
  /**
   * WHAT IS ALREADY STANDING on this asset.
   *
   * The card could place an order and then never show it again — the one
   * surface that opened a position it could not see or close. Read when the
   * panel opens, re-read after a cancel, and silent when there is nothing:
   * a reader with no orders is not owed a header.
   */
  const [orders, setOrders] = useState<
    Array<{
      orderKey: string
      side: "buy" | "sell"
      amountUsd: number | null
      amountUi: number
      triggerPriceUsd: number
      gated: boolean
    }>
  >([])
  const [cancelling, setCancelling] = useState<string | null>(null)
  const loadOrders = useCallback(() => {
    handlers.onListOrders?.().then(setOrders).catch(() => {})
  }, [handlers])
  useEffect(() => {
    loadOrders()
  }, [loadOrders, asset.mint])
  useEffect(() => {
    if (reader !== undefined || !handlers.onReader) return
    let alive = true
    handlers
      .onReader(asset.mint)
      .then((r) => alive && setOwnReader(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [asset.mint, handlers, reader])
  const me = reader ?? ownReader
  const usdNum = Number(amount)
  const view = viewTradeSheet({
    ticker: asset.symbol.replace(/^\$/, ""),
    marketUsd: asset.usdPrice,
    reader: me,
    state: {
      side: mode,
      kind,
      priceText: trigger,
      usd: Number.isFinite(usdNum) && usdNum > 0 ? usdNum : 0,
      // A sell typed in dollars still has to cut RAW units, so the amount is
      // carried through as the share of the holding it works out to.
      pct:
        holdingUsd !== null && holdingUsd > 0 && Number.isFinite(usdNum)
          ? Math.min(100, Math.max(0, (usdNum / holdingUsd) * 100))
          : 0,
    },
  })

  const amountUsd = useMemo(() => {
    const n = Number(amount)
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [amount])

  /**
   * A chip fills the field AND opens Confirm immediately, without waiting for
   * the quote — one tap is a complete answer. The build path re-quotes,
   * simulates and verifies before anything is signed.
   */
  const setAmountAndQuote = useCallback(
    (value: number, m: TradeMode) => {
      // Trim float dust from fraction chips (2.9000000000000004).
      const clean = Math.round(value * 100) / 100
      setAmount(String(clean))
      handlers.onAmount(clean, m)
      // Focus returns to the number a chip just wrote: typing after a tap
      // edits the amount rather than going nowhere.
      inputRef.current?.focus()
    },
    [handlers],
  )

  // Typed loosely: the JSX types here are Preact's, but the event still
  // arrives as a plain DOM Event; the cast is at the boundary, once.
  const onInput = useCallback(
    (e: { target: EventTarget | null }) => {
      // One shape on every keyboard: comma becomes dot, junk drops.
      const v = normalizeDecimal((e.target as HTMLInputElement).value)
      setAmount(v)
      const n = Number(v)
      handlers.onAmount(Number.isFinite(n) && n > 0 ? n : 0, mode)
    },
    [handlers, mode],
  )

  // Typing overrides a chip. A lit chip beside a field showing something else
  // would be the card asserting a number the reader can see is not the number.
  const activePreset = PRESET_USD.find((p) => String(p) === amount.trim())

  // The amount scales down as digits grow (40 → 33 → 26) and the input is
  // widthed to its content, so "$" + number stay one optically centered
  // unit. ch tracks the input's own font-size, so one rule serves all three
  // sizes; the half-ch is caret room.
  const amtLen = Math.max(amount.length, 1)
  // A bordered field does not need to be 40px tall to be the focus; the
  // border already says "this is the input". The chip settled on 21.
  const amtPx = amtLen <= 6 ? 24 : amtLen <= 9 ? 21 : 18

  const restriction = asset.restrictions[0]

  // The outcome replaces the quote line and takes Confirm away for good — the
  // decision has been made and there is nothing left to press. Outcomes are a
  // DOT plus text, not a banner: the state is a fact to note, not a wall.
  const line = outcome?.text ?? quote
  const lineClass = outcome
    ? `quote ${outcome.state === "error" ? "err" : outcome.state}`
    : `quote${quoteError ? " err" : ""}`
  const showDot = Boolean(outcome) || quoteError
  // A market trade is armed by the parent's quote; a limit is armed by the
  // rulebook, which is the only thing that knows whether the price is legal.
  /**
   * AN ERROR IS A BEAT, NOT THE END. Any outcome used to disable Confirm
   * for good: after "failed on chain" the reader faced a red line over a
   * dead button that still said "Buy $25", amount still typed, retry one
   * press away and unreachable. A failed outcome keeps the button alive
   * as "Try again"; the parent's setQuote retires the outcome on the next
   * quote, so no new states.
   */
  const failedOutcome = outcome?.state === "error"
  const confirmDisabled =
    placing ||
    (Boolean(outcome) && !failedOutcome) ||
    (kind === "limit" ? !view.intent : !canConfirm)

  return (
    <div data-panel className="panel">
      {canSell && (
        <div className="modes" role="tablist">
          {(["buy", "sell"] as const).map((m) => (
            <button
              key={m}
              data-mode={m}
              role="tab"
              aria-selected={mode === m ? "true" : "false"}
              onClick={() => {
                setMode(m)
                setAmount("")
                handlers.onAmount(0, m)
              }}
            >
              {m === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      )}

      {/* ── MARKET OR LIMIT ─────────────────────────────────────────────
          This used to be a door: "or set an order at a price →", which sent
          the reader to the panel because a third copy of the order state
          machine was the drift this codebase keeps paying for. The drift
          was real and the door was the wrong fix — measured, the panel had
          fallen a whole correctness bug behind the chip while pointing at
          it as the place to go.

          The answer was never fewer surfaces, it was one rulebook. Every
          decision below comes from tradeSheetModel; this file only lays it
          out. The switch is quiet on purpose: Buy and Sell are the
          decision, market-or-limit is how it is priced. */}
      {!outcome && (
        <div className="kind-row" data-kind-row>
          {(["market", "limit"] as const).map((k) => (
            <button
              key={k}
              className="kind-btn"
              data-kind={k}
              aria-pressed={kind === k ? "true" : "false"}
              onClick={() => {
                setKind(k)
                setTrigger("")
              }}
            >
              {k === "market" ? "Now" : "When it hits"}
            </button>
          ))}
        </div>
      )}

      <div className="amount">
        <span style={{ fontSize: `${Math.round(amtPx * 0.55)}px` }}>$</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          placeholder="0"
          data-amount
          value={amount}
          onInput={onInput}
          style={{ fontSize: `${amtPx}px` }}
        />
      </div>

      {/* On a sell the model already prints units, worth, entry AND where the
          position stands; this older line would say half of it again. */}
      {mode === "sell" && asset.balance && !view.balance && (
        <div className="holding">
          you hold{" "}
          {asset.balance.uiAmount.toLocaleString("en-US", {
            maximumFractionDigits: 6,
          })}{" "}
          {asset.symbol}
          {holdingUsd !== null ? ` ≈ ${price(holdingUsd)}` : ""}
        </div>
      )}

      <div className="chips">
        {mode === "buy"
          ? PRESET_USD.map((v) => (
              <button
                key={v}
                data-preset={v}
                aria-pressed={activePreset === v ? "true" : "false"}
                onClick={() => setAmountAndQuote(v, "buy")}
              >
                ${v}
              </button>
            ))
          : SELL_FRACTIONS.map((f) => (
              <button
                key={f}
                data-fraction={f}
                disabled={holdingUsd === null}
                onClick={() =>
                  holdingUsd !== null && setAmountAndQuote(holdingUsd * f, "sell")
                }
              >
                {f === 1 ? "Max" : `${f * 100}%`}
              </button>
            ))}
      </div>

      {kind === "limit" && !outcome && (
        <div className="order-leg" data-order-leg>
          <div className="order-lbl">{view.priceLabel}</div>
          <div className="order-field">
            <span className="order-cur">$</span>
            <input
              className="order-price"
              data-order-price
              type="text"
              inputMode="decimal"
              placeholder={
                asset.usdPrice === null
                  ? "0.00"
                  : asset.usdPrice.toFixed(decimalsFor(asset.usdPrice))
              }
              value={trigger}
              onInput={(e) => setTrigger(normalizeDecimal((e.target as HTMLInputElement).value))}
            />
            {view.reading && view.reading.text !== "" && (
              <span className={`order-read ${view.reading.tone}`}>{view.reading.text}</span>
            )}
          </div>


          {view.note && <div className="order-note">{view.note}</div>}
        </div>
      )}


      {/* Where the reader stands — the line that explains why a target on a
          position already past it is refused. */}
      {view.balance && !outcome && (
        <div className={`order-bal${view.balance.low ? " low" : ""}`} data-order-bal>
          {view.balance.text}
        </div>
      )}

      {outcome?.state === "done" ? (
        /* The one earned moment: ring draws closed, tick lands, line in
           full white. Same data-quote/.done contract as the plain line —
           the state machine does not know it got dressed up. */
        <div className={`quote done success`} data-quote>
          {/* The burst sits BEHIND the check and is purely decorative — two
              rings leaving and one warm bloom, all gone inside 700ms. It is
              aria-hidden along with everything else here because the sentence
              beside it already says what happened. */}
          <span className="success-burst" aria-hidden="true">
            <span className="sb-ring" />
            <span className="sb-ring sb-ring-2" />
            <span className="sb-glow" />
          </span>
          <span className="success-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
              <circle
                className="ck-ring"
                cx="12" cy="12" r="10.5"
                fill="none" stroke="#30D158" stroke-width="1.6"
              />
              <path
                className="ck-tick"
                d="M7.2 12.6l3.1 3.1 6.4-6.9"
                fill="none" stroke="#30D158" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
              />
            </svg>
          </span>
          <span className="q-main">{line}</span>
        </div>
      ) : (
        <div className={lineClass} data-quote>
          {showDot && <span className="dot" aria-hidden="true" />}
          <span className="q-main">{line}</span>
          {!outcome && quoteSub && <span className="q-sub">{quoteSub}</span>}
        </div>
      )}

      {/* Not shown once an outcome has landed — that view belongs to what
          just happened. See the prop's own note for why it sits here. */}
      {!outcome && conversationStrip}

      {outcome?.state === "done" && outcome.share && shareRow}

      {gate === "signin" && mode === "buy" ? (
        <>
          <div className="gate-note">
            We create your wallet at sign-in. No seed phrase, nothing to
            connect.
          </div>
          <button data-act="gate-signin" onClick={() => handlers.onGate?.("signin")}>
            Sign in to trade
          </button>
        </>
      ) : gate === "topup" && mode === "buy" ? (
        <>
          <div className="gate-note">Your wallet is ready · $0.00 USDC</div>
          {/*
            THE SAME WORDS EVERY OTHER DOOR USES. This said "Top up to
            trade" while the funding door twenty lines down, the chip, the
            scoreboard, the wallet and the deposit screen all say "Deposit
            USDC" — two names for one action inside one component, and this
            component's own spec asserts the other one.

            "Deposit USDC" also does the work the old label was reaching
            for: naming the currency IS the instruction, on a product whose
            thesis is that the currency is never a question.
          */}
          <button data-act="gate-topup" onClick={() => handlers.onGate?.("topup")}>
            Deposit USDC
          </button>
        </>
      ) : view.action.tone === "fund" ? (
        /**
         * THE RULEBOOK SAID "FUND", SO THE BUTTON IS THE FUNDING DOOR.
         *
         * This was the silent press: cannotPay leaves intent null, the old
         * button stayed labelled like an action and merely went disabled —
         * pressable to the eye, dead to the finger, reasonless. The chip has
         * always drawn this state as its top-up door; the card now says the
         * same words and opens the same place.
         *
         * BOTH LEGS, not only the limit one: a market buy over the balance
         * used to arm a live Confirm destined to fail after the press with
         * a backend sentence. The rulebook's fund verdict now owns the
         * market side too.
         */
        <button data-act="gate-topup" onClick={() => handlers.onGate?.("topup")}>
          {view.action.label}
        </button>
      ) : (
        <button
          data-act="confirm"
          /* The last control touched before money moves is the last place an
             ambiguous direction is acceptable. The side switch above already
             turns red; the button that actually sells was still wearing the
             buy accent, which is the one place it must not. */
          data-side={mode}
          disabled={confirmDisabled}
          onClick={() => {
            // One button, and it reads the state it is wearing. A limit is
            // not a slower market trade: it goes down a different rail, and
            // the shared rulebook has already decided whether it may.
            if (kind === "limit") {
              if (!view.intent || !handlers.onPlaceOrder || placing) return
              setPlacing(true)
              void handlers
                .onPlaceOrder(view.intent)
                .then(() => {
                  // The parked order joins the list the reader can see,
                  // and the form resets for the next one.
                  loadOrders()
                  setTrigger("")
                })
                .finally(() => setPlacing(false))
              return
            }
            handlers.onConfirm(amountUsd, mode)
          }}
        >
          {/* The shared rulebook composes the market label too - "Buy $25",
              "Sell $12.50" - and its own comment defends it: the button
              names the money. The card was the one surface overriding it
              with a bare verb; the chip already shows these words. The one
              state the rulebook cannot name is an empty amount - "Buy $0"
              is not a sentence anybody meant - so the disarmed key asks
              for the missing thing, the same voice as "Type a price". */}
          {placing
            ? "Placing…"
            : failedOutcome
              ? "Try again"
              : kind === "limit" || amountUsd > 0
                ? view.action.label
                : "Type an amount"}
        </button>
      )}

      {/*
        The disclosures the curated regime owes a reader, on the panel
        where the decision is made — as fine print under the button, read
        before money moves but leading nothing. The earlier pass opened
        the panel with them, which put the paperwork above the question.

        NOT FOR NATIVE TOKENS. This line names the counterparty who holds the
        underlying asset — Backpack Securities holds the SpaceX shares behind
        SPCX, and a reader about to spend money is owed that name. A native SPL
        token has no underlying and no counterparty, so "issued by Solana" says
        nothing true: Solana did not issue WIF, it is merely where WIF lives. A
        disclosure that states the obvious teaches readers to skip disclosures,
        which is the opposite of what it is for.
      */}
      {asset.issuer && asset.issuer !== "native-spl" && (
        <div className="issuer">issued by {ISSUER_LABEL[asset.issuer]}</div>
      )}
      {/*
        STANDING ORDERS SIT BELOW THE BUTTON, not above it.

        This list is fetched when the panel mounts, and it used to render
        ABOVE the quote line and the CTA - so it landed a moment after the
        panel drew, pushed everything under it down, and moved the Confirm
        button out from under a finger already travelling towards it. A
        surface about money must never move the target between the aim and
        the press.

        Below the act it can arrive whenever it likes: the panel grows
        downward and nothing the reader was pointing at shifts. It also
        reads better - what is already parked is context for the next
        decision, not a preamble to it.
      */}
      {orders.length > 0 && !outcome && (
        <div className="oo-list" data-oo-list>
          {orders.map((o) => (
            <div key={o.orderKey} className="oo-row">
              <span className={`oo-side${o.side === "sell" ? " s" : ""}`}>
                {o.side === "sell" ? "Sell" : "Buy"}
              </span>
              <span className="oo-what">
                {o.side === "buy" && o.amountUsd !== null
                  ? `$${o.amountUsd} at $${o.triggerPriceUsd.toFixed(decimalsFor(o.triggerPriceUsd))}`
                  : `${o.amountUi.toLocaleString("en-US", {
                      maximumFractionDigits: 6,
                    })} at $${o.triggerPriceUsd.toFixed(decimalsFor(o.triggerPriceUsd))}`}
              </span>
              {/* §7 can stop admitting a mint, and the row says so — but the
                  EXIT is never gated. A reader must always be able to get out
                  of something they are already in. */}
              {o.gated && <span className="oo-gated">paused</span>}
              <button
                className="oo-x"
                data-oo-cancel
                disabled={cancelling === o.orderKey}
                onClick={() => {
                  setCancelling(o.orderKey)
                  handlers
                    .onCancelOrder?.(o.orderKey)
                    .then(() => loadOrders())
                    .catch(() => {})
                    .finally(() => setCancelling(null))
                }}
              >
                {cancelling === o.orderKey ? "Cancelling…" : "Cancel"}
              </button>
            </div>
          ))}
        </div>
      )}

      {restriction && <div className="warn">{RESTRICTION_NOTE[restriction]}</div>}
    </div>
  )
}
