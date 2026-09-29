import { rememberTopUpIntent } from "~/helpers/topUpIntent"
import { LAST_TRADE_USD_KEY } from "~/helpers/copyFrom"
import { topUpAmount } from "~/helpers/topUpAmount"
import { orderViaPage, tradeViaPage } from "~/helpers/panelExternalTrade"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { JUICE, JUICE_BUY_FILL } from "~/theme/juice"
import { alpha, Box, CircularProgress, Typography } from "@mui/material"
import { normalizeDecimal } from "~/helpers/decimalInput"
import { popCopy } from "~/helpers/popLanguage"
import { useEffect, useRef, useState } from "react"
import {
  viewTradeSheet,
  type Reader,
  type SheetState,
} from "~/helpers/tradeSheetModel"
import { useLocation, useNavigate } from "react-router"
import {
  balanceAsset,
  positionsAsset,
  confirmAsset,
  createOrderAsset,
  quoteAsset,
  sellAsset,
  swapAsset,
} from "~/services/SpotAssetService"
import { useUIStore } from "~/store/useUIStore"
import { BlinkFund } from "~/components/BlinkFund"
import { ACCENT, GREEN, RED } from "~/helpers/panelSurface"
import {
  PRESET_USD,
  reasonOf,
  SELL_FRACTIONS,
  settledBalance,
  usdToRawOfHolding,
} from "~/helpers/tradeMath"
import {
  formatTriggerPrice,
  planBuyOrder,
  planSellOrder,
} from "~/helpers/orderMath"
import { qtyText } from "~/helpers/qtyText"
import { pressKey } from "~/entries/contentScript/x/inlineBuy"
import { ARC_EDITION, CAP } from "~/config/edition"

/**
 * The panel's OWN money UI.
 *
 * ── THE RULE THIS REVERSES, ON THE OWNER'S CALL ─────────────────────────────
 * For its whole life the panel deferred to the page card: "the panel never
 * grows a second Buy" was written into three files, and Buy here used to mean
 * "open the card over there". The owner reversed it in plain words — the
 * SIDEBAR is the app; the sidebar never redirects to the card; the card may
 * occasionally point at the sidebar. So this sheet owns the full flow.
 *
 * What did NOT change is where the rules come from. This is the page card's
 * TradePanel translated into the panel's hand — same endpoints, same
 * sequence, and the same honesty rules, each of which was earned the hard
 * way over there:
 *
 *   - a preset tap is a COMPLETE answer: Confirm arms immediately, the build
 *     path re-quotes and simulates before anything is signed
 *   - only the NEWEST quote may write to the screen (keystrokes outrun the
 *     network)
 *   - an outcome is retired the moment the reader touches the amount or the
 *     side — a finished trade must not hold the next one hostage
 *   - sell math never invents decimals: raw units, proportional over the
 *     known balance, clamped so Max cannot oversell
 *   - dry run says so out loud; "unknown" settlement is not "failed"
 */


export interface TradeSheetAsset {
  mint: string
  symbol: string
  displayName: string
  /** null = the backend could not read them; the sheet refuses to trade. */
  decimals: number | null
  priceUsd: number | null
}

type Outcome = { text: string; state: "pending" | "done" | "error" } | null

export function TradeSheet({
  asset,
  mode,
  onModeChange,
  onOrderPlaced,
  onTraded,
  initialUsd,
}: {
  asset: TradeSheetAsset
  mode: "buy" | "sell"
  onModeChange: (m: "buy" | "sell") => void
  /**
   * A standing order just joined the book. The sheet says so in its own
   * outcome line, but the LIST of orders lives outside it, and a list that
   * does not include the thing somebody just did reads as a failure.
   */
  onOrderPlaced?: () => void
  /**
   * A trade just SETTLED. The rows above this sheet (positions, the token
   * room's holding card) are display surfaces that fetched on mount; a
   * sold position still showing as held reads as the product not knowing
   * your money. Called only on state "done", never on dry runs or errors.
   */
  onTraded?: () => void
  /** Dollars to arrive with, quoted at once: the Buy a deposit toast returns to. */
  initialUsd?: number
}) {
  /**
   * WHOSE KEY SIGNS. A wallet account's buy and sell are handed to the
   * page beside the panel, where Phantom is (helpers/panelExternalTrade.ts);
   * everything after the receipt is the same. Standing orders for a
   * wallet account wait for their own leg and say so.
   */
  const { data: me } = useCurrentUser()
  const external = me?.wallet_mode === "external"
  const navigate = useNavigate()
  const location = useLocation()
  const { setIsSignInModalOpen } = useUIStore()

  const [amount, setAmount] = useState("")
  /**
   * WHEN the trade happens. "now" is the market path unchanged; "trigger"
   * parks a standing order on chain that fills at the reader's price or
   * better. The rules live in orderMath — one rulebook for all three
   * surfaces — and the sentence it returns is shown verbatim.
   */
  const [when, setWhen] = useState<"now" | "trigger">("now")
  const [trigger, setTrigger] = useState("")
  const [quote, setQuote] = useState<{ text: string; sub?: string; error?: boolean } | null>(null)
  const [canConfirm, setCanConfirm] = useState(false)
  /**
   * THE SHARE CARD'S URL, handed over by the server because the secret is
   * theirs and the extension has no business holding it. Null is the
   * normal case: a dry run, a settlement still pending, or a deploy with
   * no POP_CARD_SECRET. The affordance is simply absent then, which is the
   * right answer for a button whose destination would 404.
   */
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const quoteSeq = useRef(0)

  /**
   * The holding, for Sell — and for the sign-in gate. A 401 here is the auth
   * answer: the sheet swaps Confirm for "Sign in to trade" instead of letting
   * a signed-out reader type an amount into a dead end.
   */
  const [balance, setBalance] = useState<{ uiAmount: number; raw: string } | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  /**
   * THE READER, including the one fact this sheet has never had: what the
   * position COST. Without it a sell target measured "+10%" comes off the
   * tape, which tells a holder nothing — if the price is already under what
   * they paid, ten percent above today is still a loss. /positions carries
   * the basis; /balance cannot answer it at all.
   */
  /**
   * THE READER, IN ONE READ.
   *
   * This was two effects and two round trips: /positions for the cost basis
   * and /balance for the holding, fetched together, answering questions that
   * arrive in the same payload. /positions carries uiAmount, raw AND
   * netInvestedUsd; /balance carries the first two and cannot answer the
   * third at all. The second call was mine, left behind when the basis was
   * added, and it cost every sheet open a second round trip for nothing.
   *
   * The 401 gate moves with it: a signed-out reader is the auth answer, and
   * the sheet swaps Confirm for "Sign in to trade" rather than letting them
   * type an amount into a dead end.
   */
  const [reader, setReader] = useState<Reader | null>(null)
  useEffect(() => {
    let alive = true
    positionsAsset()
      .then((r) => {
        if (!alive) return
        const pos = r.positions.find((p) => p.mint === asset.mint) ?? null
        setReader({
          cashUsd: r.cashUsd,
          uiAmount: pos?.uiAmount ?? 0,
          raw: pos?.raw ?? "0",
          entryMcapUsd: pos?.entryMcapUsd ?? null,
        })
        setBalance({ uiAmount: pos?.uiAmount ?? 0, raw: pos?.raw ?? "0" })
        setSignedOut(false)
      })
      .catch((e: { status?: number }) => {
        if (!alive) return
        if (e?.status === 401 || e?.status === 403) setSignedOut(true)
      })
    return () => {
      alive = false
    }
  }, [asset.mint])

  const symbol = asset.symbol.replace(/^\$/, "")
  const holdingUsd =
    balance && asset.priceUsd !== null ? balance.uiAmount * asset.priceUsd : null
  /**
   * "SELL ALL" SELLS ALL. The presets round to cents and the raw amount was
   * recomputed from those cents, so Max sold 99.9% and left dust behind a
   * button that said all of it. At the whole position (within half a cent)
   * the raw is the holding's own raw, exactly; the chip fixed this first.
   */
  const rawFor = (usd: number): string => {
    if (!balance || asset.priceUsd === null) return "0"
    if (holdingUsd !== null && holdingUsd > 0 && usd >= holdingUsd - 0.005) return balance.raw
    return usdToRawOfHolding(usd, balance, asset.priceUsd)
  }

  /** New decision → the last one is history. Shown right up until the reader
   *  moves; nothing is hidden, it is finished. */
  const retireOutcome = () => setOutcome(null)

  const runQuote = async (usd: number, m: "buy" | "sell") => {
    retireOutcome()
    if (when === "trigger") {
      // The market quote is the wrong sentence here — the plan note under the
      // price input speaks instead, derived in render with no request.
      setQuote(null)
      setCanConfirm(false)
      return
    }
    if (usd <= 0) {
      setQuote(null)
      setCanConfirm(false)
      return
    }
    const seq = ++quoteSeq.current
    if (m === "sell") {
      if (!balance || asset.priceUsd === null) {
        setQuote({ text: "Balance unknown · cannot sell", error: true })
        setCanConfirm(false)
        return
      }
      const raw = rawFor(usd)
      if (raw === "0") {
        setQuote({ text: "Amount is below one base unit", error: true })
        setCanConfirm(false)
        return
      }
      const tokens = (Number(raw) / 10 ** (asset.decimals ?? 0)).toLocaleString("en-US", {
        maximumFractionDigits: 6,
      })
      setQuote({ text: `Sell ${tokens} ${symbol} ≈ $${usd.toFixed(2)}` })
      setCanConfirm(true)
      return
    }
    // Buy: Confirm arms NOW — a preset tap is a complete answer, and the
    // build path re-quotes and simulates before anything is signed.
    setQuote({ text: "Quoting…" })
    setCanConfirm(true)
    try {
      const r = await quoteAsset(asset.mint, usd)
      if (seq !== quoteSeq.current) return
      setQuote({
        text: `${qtyText(r.outAmount)} ${symbol}`,
        sub: `${r.priceImpactPct.toFixed(2)}% impact`,
      })
    } catch (e) {
      if (seq !== quoteSeq.current) return
      setQuote({ text: reasonOf(e, "Quote unavailable"), error: true })
    }
  }

  /**
   * ONE QUOTE PER PAUSE, NOT ONE PER KEYSTROKE.
   *
   * Typing "125" fired three quotes; typing "12.50" fired five, each a
   * round trip to the router for an amount the reader was still in the
   * middle of writing. quoteSeq already guaranteed only the newest one
   * could paint, which means the rest were pure cost - ours in requests,
   * theirs in a line that changed under them while they typed.
   *
   * The sheet still answers instantly: "Quoting…" and an armed Confirm are
   * set on the keystroke, because a preset tap is a complete answer and the
   * build path re-quotes before anything is signed. Only the network waits
   * for the reader to stop. Presets and mode switches skip this entirely -
   * those ARE the pause.
   */
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (typeTimer.current) clearTimeout(typeTimer.current)
    },
    [],
  )
  const quoteWhileTyping = (usd: number, m: "buy" | "sell") => {
    if (typeTimer.current) clearTimeout(typeTimer.current)
    // Everything but a live buy quote is local arithmetic - no reason to wait.
    if (m !== "buy" || when === "trigger" || usd <= 0) {
      void runQuote(usd, m)
      return
    }
    retireOutcome()
    // Retire any answer still in flight: it is about an older amount.
    quoteSeq.current += 1
    setQuote({ text: "Quoting…" })
    setCanConfirm(true)
    typeTimer.current = setTimeout(() => {
      typeTimer.current = null
      void runQuote(usd, m)
    }, 220)
  }

  const setAmountAndQuote = (usd: number, m: "buy" | "sell") => {
    const clean = Math.round(usd * 100) / 100
    setAmount(String(clean))
    void runQuote(clean, m)
  }
  // The amount a launch arrived with: typed and quoted as if the reader
  // had just done it, so the button is "Buy · $10", armed.
  useEffect(() => {
    if (typeof initialUsd === "number" && initialUsd > 0) setAmountAndQuote(initialUsd, "buy")
  }, [])

  const switchMode = (m: "buy" | "sell") => {
    onModeChange(m)
    setAmount("")
    setTrigger("")
    setWhen("now")
    setQuote(null)
    setCanConfirm(false)
    retireOutcome()
  }

  /**
   * Catch the holding up with the fill. Polls until the chain reports a
   * DIFFERENT number than the one we went in with — a single read right after
   * a trade lands on either side of it at random, which is how Max came to
   * mean "most of it" and how the sell chips came to describe a position that
   * no longer existed.
   */
  const settleBalance = (before: string | null) => {
    void settledBalance(() => balanceAsset(asset.mint), before).then((b) => {
      if (b) setBalance({ uiAmount: b.uiAmount, raw: b.raw })
    })
  }

  /**
   * Place a standing order. Same tail as a market trade — build, dry-run
   * honesty, confirm the placement transaction on chain — because placing IS
   * an on-chain act; only the fill is deferred to the keepers.
   */
  const placeOrder = async (usd: number, triggerPriceUsd: number) => {
    setBusy(true)
    /**
     * ONE PRESS, ONE KEY. Placing an order escrows USDC on chain, and the
     * server's confirm can time out while the transaction still lands —
     * at which point the reader is told to try again. Without a key the
     * server has nothing to recognise the second press by, and parks a
     * SECOND order at the same price with a second escrow. Minted here,
     * outside the try, so both sides of the branch below carry the same
     * one and a retry of the same press is a replay rather than an order.
     */
    const press = pressKey()
    try {
      setOutcome({ text: "Placing order…", state: "pending" })
      let r
      if (mode === "sell") {
        // A bare return here would leave "Placing order…" on screen forever —
        // an outcome was already claimed, so every exit must resolve it.
        if (!balance || asset.priceUsd === null) {
          setOutcome({ text: "Balance unknown · cannot place", state: "error" })
          return
        }
        const raw = rawFor(usd)
        if (raw === "0") {
          setOutcome({ text: "Amount is below one base unit", state: "error" })
          return
        }
        r = external
          ? await orderViaPage({ mint: asset.mint, side: "sell", amountRaw: raw, triggerPriceUsd })
          : await createOrderAsset({
              mint: asset.mint,
              side: "sell",
              amountRaw: raw,
              triggerPriceUsd,
              idempotencyKey: press,
            })
      } else {
        r = external
          ? await orderViaPage({ mint: asset.mint, side: "buy", amountUsd: usd, triggerPriceUsd })
          : await createOrderAsset({
              mint: asset.mint,
              side: "buy",
              amountUsd: usd,
              triggerPriceUsd,
              idempotencyKey: press,
            })
      }
      if (r.dryRun) {
        setOutcome({
          text: "Dry run · order built and verified, nothing placed",
          state: "pending",
        })
        return
      }
      const settled = await confirmAsset(r.signature)
      if (settled.status === "failed") {
        setOutcome({ text: "Placing the order failed on chain", state: "error" })
        return
      }
      setOutcome({
        text: `Order placed — fills at ${formatTriggerPrice(triggerPriceUsd)} or better`,
        state: "done",
      })
      onOrderPlaced?.()
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status
      if (status === 401 || status === 403) {
        setSignedOut(true)
        setOutcome(null)
      } else {
        setOutcome({ text: reasonOf(e, "The order didn't go through. Try again."), state: "error" })
      }
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    const usd = Number(amount)
    if (!Number.isFinite(usd) || usd <= 0 || busy) return
    if (when === "trigger") {
      const t = Number(trigger)
      if (!Number.isFinite(t) || t <= 0) return
      return placeOrder(usd, t)
    }
    const heldBefore = balance?.raw ?? null
    /* Did anything reach the chain? The catch below is only allowed to say
       "nothing was charged" while this is false. */
    let sent = false
    setShareUrl(null)
    setBusy(true)
    try {
      if (mode === "sell") {
        if (!balance || asset.priceUsd === null) return
        const raw = rawFor(usd)
        if (raw === "0") return
        const tokens = (Number(raw) / 10 ** (asset.decimals ?? 0)).toLocaleString("en-US", {
          maximumFractionDigits: 6,
        })
        setOutcome({ text: popCopy.working, state: "pending" })
        const r = external
          ? await tradeViaPage({ side: "sell", mint: asset.mint, amountRaw: raw })
          : await sellAsset(asset.mint, raw)
        if (r.dryRun) {
          setOutcome({ text: popCopy.dryRun, state: "pending" })
          return
        }
        /* FROM HERE ON A SIGNATURE EXISTS, and that is what decides which
           ending we are allowed to claim. See popLanguage.ts. */
        sent = true
        const usdcOut = (Number(r.outUsdcRaw) / 1e6).toFixed(2)
        setOutcome({ text: popCopy.working, state: "pending" })
        const settled = await confirmAsset(r.signature)
        if (settled.status === "failed") {
          setOutcome({ text: popCopy.ending("chain-failed"), state: "error" })
          return
        }
        if (settled.status === "unknown") {
          setOutcome({ text: popCopy.ending("pending"), state: "pending" })
          settleBalance(heldBefore)
          onTraded?.()
          return
        }
        setOutcome({
          text: popCopy.done(`${tokens} ${symbol} for $${usdcOut}`),
          state: "done",
        })
        /* ONLY ON A CONFIRMED FILL. A card for a pop that is still settling
           would be a claim the chain has not made yet, and the endpoint
           would 404 on a row with no quantity anyway. */
        setShareUrl(r.shareUrl ?? null)
        settleBalance(heldBefore)
        onTraded?.()
      } else {
        setOutcome({ text: popCopy.working, state: "pending" })
        const r = external
          ? await tradeViaPage({ side: "buy", mint: asset.mint, amountUsd: usd })
          : await swapAsset(asset.mint, usd)
        if (r.dryRun) {
          setOutcome({ text: popCopy.dryRun, state: "pending" })
          return
        }
        sent = true
        const bought =
          asset.decimals !== null
            ? (Number(r.outAmountRaw) / 10 ** asset.decimals).toLocaleString("en-US", {
                maximumFractionDigits: 6,
              })
            : null
        const settled = await confirmAsset(r.signature)
        if (settled.status === "failed") {
          setOutcome({ text: popCopy.ending("chain-failed"), state: "error" })
          return
        }
        if (settled.status === "unknown") {
          setOutcome({ text: popCopy.ending("pending"), state: "pending" })
          settleBalance(heldBefore)
          onTraded?.()
          return
        }
        setOutcome({
          text: popCopy.done(bought ? `${bought} ${symbol}` : symbol),
          state: "done",
        })
        setShareUrl(r.shareUrl ?? null)
        /* And what this reader just spent, so the next copy opens on their
           own size rather than on somebody else's (helpers/copyFrom.ts). */
        if (usdNum > 0) {
          try {
            void chrome.storage?.local?.set({ [LAST_TRADE_USD_KEY]: usdNum })
          } catch {
            // No extension context: the trade still happened.
          }
        }
        settleBalance(heldBefore)
        onTraded?.()
      }
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status
      if (status === 401 || status === 403) {
        setSignedOut(true)
        setOutcome(null)
      } else {
        /* THE SENTENCE DEPENDS ON `sent`, and that is the whole point of
           tracking it. A throw before a signature existed means nothing was
           broadcast and we can say so. A throw AFTER one means the swap may
           already be landing, and telling somebody nothing was charged
           there is a lie about their money. */
        // A wallet account's refusal is the wallet's own sentence (closed
        // before signing, on another wallet, not on this page): printed as
        // said, when nothing was sent. Once something was, the ledger rule.
        const said = (e as { message?: string })?.message
        setOutcome({
          text:
            !sent &&
            typeof said === "string" &&
            said.length > 0 &&
            said.length < 120 &&
            (external || /insufficient|enough/i.test(said))
              ? said
              : popCopy.ending(sent ? "lost" : "not-sent"),
          state: "error",
        })
      }
    } finally {
      setBusy(false)
    }
  }

  // Decimals are how raw units become numbers a person reads. Without them
  // every amount would be wrong by orders of magnitude — the sheet refuses,
  // the same refusal the card makes.
  if (asset.decimals === null) {
    return (
      <Typography sx={{ fontSize: 12, color: JUICE.text2, mt: 1.25 }}>
        This asset can&apos;t be traded right now.
      </Typography>
    )
  }

  const outcomeColor =
    outcome?.state === "done" ? GREEN : outcome?.state === "error" ? RED : JUICE.text2

  const insufficient = Boolean(
    outcome?.state === "error" && /insufficient|enough/i.test(outcome.text),
  )

  const usdNum = Number(amount)
  const trigNum = Number(trigger)

  /**
   * THE SHEET'S READING, from the rulebook all three surfaces share.
   *
   * This used to call orderMath directly and stop there, which answered
   * "is this a valid order" and nothing else. The reader also needs to know
   * what their price MEANS — and for a sell that is measured against what
   * they paid, not against the tape. Both answers come from one place now,
   * so the panel cannot drift from the chip again.
   *
   * The sheet keeps its own free-typed amount; only the DECISIONS are
   * shared. `pct` is what that amount works out to as a share of the
   * holding, so a sell sized in dollars still cuts raw units correctly.
   */
  const sheetState: SheetState = {
    side: mode,
    kind: when === "trigger" ? "limit" : "market",
    priceText: trigger,
    usd: Number.isFinite(usdNum) && usdNum > 0 ? usdNum : 0,
    pct:
      holdingUsd !== null && holdingUsd > 0 && Number.isFinite(usdNum)
        ? Math.min(100, Math.max(0, (usdNum / holdingUsd) * 100))
        : 0,
  }
  const view = viewTradeSheet({
    ticker: symbol,
    marketUsd: asset.priceUsd,
    reader,
    state: sheetState,
  })
  const plan =
    when === "trigger" && trigger.trim() !== ""
      ? mode === "buy"
        ? planBuyOrder(usdNum, trigNum, asset.priceUsd)
        : planSellOrder(
            asset.priceUsd !== null && asset.priceUsd > 0 ? usdNum / asset.priceUsd : 0,
            trigNum,
            asset.priceUsd,
          )
      : null
  /**
   * SHORT BEFORE THE PRESS. The model already knows the cash cannot cover
   * the dollars typed (its action is the fund tone); the chip disarms on it,
   * and until now the panel let the press go to the server and then hid the
   * refusal behind "Didn't go through". Now the button waits and the Top up
   * door shows first, for a market buy and a standing buy alike.
   */
  const short = !external && mode === "buy" && !outcome && view.action?.tone === "fund"
  const orderReady = when === "trigger" && plan?.ok === true && usdNum > 0 && !short

  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: `1px solid ${JUICE.border}` }}>
      {/* Side switch — shown only when Sell is even possible. */}
      {(balance?.uiAmount ?? 0) > 0 && (
        <Box
          sx={{
            display: "flex",
            gap: "4px",
            p: "3px",
            mb: 1.25,
            borderRadius: "10px",
            backgroundColor: alpha("#FFFFFF", 0.05),
          }}
        >
          {(["buy", "sell"] as const).map((m) => (
            <Box
              key={m}
              component="button"
              onClick={() => switchMode(m)}
              sx={{
                flex: 1,
                border: "none",
                cursor: "pointer",
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                py: "6px",
                borderRadius: "8px",
                color: mode === m ? JUICE.text : JUICE.text2,
                backgroundColor: mode === m ? alpha("#FFFFFF", 0.1) : "transparent",
              }}
            >
              {m === "buy" ? "Buy" : "Sell"}
            </Box>
          ))}
        </Box>
      )}

      {/* The amount — the biggest thing on the sheet, Cash App's move. */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2px", my: 1 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 700, color: JUICE.text2 }}>$</Typography>
        <Box
          component="input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onInput={(e: React.FormEvent<HTMLInputElement>) => {
            // Same rule as the chip and the card: number inputs are
            // locale-aware, the product is not. See helpers/decimalInput.
            const v = normalizeDecimal((e.target as HTMLInputElement).value)
            setAmount(v)
            const n = Number(v)
            quoteWhileTyping(Number.isFinite(n) && n > 0 ? n : 0, mode)
          }}
          sx={{
            width: `${Math.max(amount.length, 1) + 0.5}ch`,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "#FFFFFF",
            font: "inherit",
            fontFamily: JUICE.mono,
            letterSpacing: "-.01em",
            fontSize: 34,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            textAlign: "center",
            p: 0,
            "&::-webkit-outer-spin-button, &::-webkit-inner-spin-button": {
              WebkitAppearance: "none",
            },
          }}
        />
      </Box>

      {mode === "sell" && balance && holdingUsd !== null && (
        <Typography sx={{ fontSize: 11, color: JUICE.text3, textAlign: "center", mb: 1 }}>
          you hold {balance.uiAmount.toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbol} ≈ $
          {holdingUsd.toFixed(2)}
        </Typography>
      )}

      {/* Preset chips — one tap is a complete answer. */}
      <Box sx={{ display: "flex", gap: 1, justifyContent: "center", mb: 1.25 }}>
        {mode === "buy"
          ? PRESET_USD.map((v) => (
              <Box
                key={v}
                component="button"
                onClick={() => setAmountAndQuote(v, "buy")}
                sx={chipSx(String(v) === amount.trim())}
              >
                ${v}
              </Box>
            ))
          : SELL_FRACTIONS.map((f, i) => (
              <Box
                key={f}
                component="button"
                disabled={holdingUsd === null}
                onClick={() => holdingUsd !== null && setAmountAndQuote(holdingUsd * f, "sell")}
                sx={chipSx(view.sizes[i]?.selected ?? false)}
              >
                {f === 1 ? "Max" : `${f * 100}%`}
              </Box>
            ))}
      </Box>

      {/* WHEN — now, or at a price the reader names. Quiet on purpose: the
          market path is the main road and the order path is a turn, not a
          second road of equal width. */}
      {/* Standing orders live on the store backend only. */}
      {CAP.orderWatch && (
      <Box sx={{ display: "flex", gap: 1, justifyContent: "center", mb: 1.25 }}>
        {(["now", "trigger"] as const).map((w) => (
          <Box
            key={w}
            component="button"
            onClick={() => {
              setWhen(w)
              setQuote(null)
              setCanConfirm(false)
              retireOutcome()
              if (w === "now" && amount.trim() !== "") {
                const n = Number(amount)
                if (Number.isFinite(n) && n > 0) void runQuote(n, mode)
              }
            }}
            sx={{
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 11,
              fontWeight: 700,
              px: 1.5,
              py: "4px",
              borderRadius: "999px",
              color: when === w ? JUICE.text : JUICE.text3,
              backgroundColor: when === w ? alpha("#FFFFFF", 0.1) : "transparent",
            }}
          >
            {w === "now" ? "Now" : "When it hits"}
          </Box>
        ))}
      </Box>
      )}

      {when === "trigger" && (
        <Box sx={{ mb: 1.25 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
            }}
          >
            <Typography sx={{ fontSize: 11, color: JUICE.text3 }}>
              {mode === "buy" ? "Buy when the price is" : "Sell when the price is"} $
            </Typography>
            <Box
              component="input"
              type="text"
              inputMode="decimal"
              placeholder={asset.priceUsd !== null ? String(asset.priceUsd) : "0.00"}
              value={trigger}
              onInput={(e: React.FormEvent<HTMLInputElement>) => {
                setTrigger(normalizeDecimal((e.target as HTMLInputElement).value))
                retireOutcome()
              }}
              sx={{
                width: `${Math.max(trigger.length, 4) + 1}ch`,
                border: "none",
                outline: "none",
                borderBottom: "1px solid rgba(255,255,255,.25)",
                background: "transparent",
                color: "#FFFFFF",
                font: "inherit",
                fontFamily: JUICE.mono,
                letterSpacing: "-.01em",
                fontSize: 14,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                textAlign: "center",
                p: 0,
                "&::-webkit-outer-spin-button, &::-webkit-inner-spin-button": {
                  WebkitAppearance: "none",
                },
              }}
            />
          </Box>

          {/* WHAT THE PRICE MEANS and WHETHER IT IS ALLOWED are different
              questions, and a sell is where they come apart: a price can be
              a real gain against the entry and still not be a valid trigger.
              The first line answers the first, the second the second. */}
          {!outcome && (
            <Box sx={{ textAlign: "center", mt: 0.75 }}>
              {view.reading && view.reading.text !== "" && (
                <Typography
                  component="span"
                  sx={{
                    fontSize: 11,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color:
                      view.reading.tone === "good"
                        ? GREEN
                        : view.reading.tone === "bad"
                          ? RED
                          : JUICE.text3,
                  }}
                >
                  {view.reading.text}
                </Typography>
              )}
              {view.note && (
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: RED, mt: 0.25 }}>
                  {view.note}
                </Typography>
              )}
              {plan?.ok && mode === "buy" && trigNum > 0 && (
                <Typography sx={{ fontSize: 11, color: JUICE.text3, mt: 0.25 }}>
                  {`\u2248 ${qtyText(usdNum / trigNum)} ${symbol}`}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* WHERE THE READER STANDS. Without it the take-profit targets are a
          riddle: someone already up 25% taps "+25%", gets a refused order,
          and has nothing on screen explaining why. */}
      {view.balance && !outcome && (
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 600,
            textAlign: "center",
            mb: 1,
            color: view.balance.low ? JUICE.amber : JUICE.text3,
          }}
        >
          {view.balance.text}
        </Typography>
      )}

      {/* The quote line — or the outcome, which replaces it. */}
      {(outcome || quote) && (
        <Box
          sx={{
            textAlign: "center",
            mb: 1.25,
            minHeight: 18,
            borderRadius: "12px",
            /**
             * MONEY LANDING IS A BEAT. The chip exhales glow-ok when a
             * trade settles; the panel rendered the product's biggest
             * dopamine moment at the same visual weight as a quote. One
             * pulse of the success glow, one time, on done - the global
             * reduced-motion gate in App.css covers the keyframes.
             */
            animation:
              outcome?.state === "done"
                ? `sheetGlowOk ${JUICE.motionMs * 2}ms ease-out 1`
                : "none",
            "@keyframes sheetGlowOk": {
              "0%": { boxShadow: `0 0 0 0 rgba(48,209,88,0)` },
              "35%": { boxShadow: JUICE.glowPop },
              "100%": { boxShadow: `0 0 0 0 rgba(48,209,88,0)` },
            },
          }}
        >
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 700,
              color: outcome ? outcomeColor : quote?.error ? RED : "#FFFFFF",
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            {outcome?.state === "pending" && <CircularProgress size={12} sx={{ color: "inherit" }} />}
            {outcome?.state === "done" && "✓ "}
            {outcome ? outcome.text : quote?.text}
          </Typography>
          {outcome?.state === "done" &&
            !location.pathname.startsWith(`/token/${asset.mint}`) && (
            <Typography
              onClick={() => navigate(`/token/${asset.mint}`)}
              sx={{
                fontSize: 11.5,
                fontWeight: 700,
                color: ACCENT,
                mt: 0.5,
                cursor: "pointer",
              }}
            >
              {/* The loop's next door, in place: the position the trade
                  just changed, one tap away instead of a dead checkmark. */}
              View position ›
            </Typography>
          )}
          {outcome?.state === "done" && shareUrl && (
            <Typography
              component="a"
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                display: "block",
                fontSize: 11.5,
                fontWeight: 700,
                color: ACCENT,
                mt: 0.5,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              {/* OPENS THE CARD, IT DOES NOT POST IT. The image is a thing
                  the reader may choose to share, and a product that posts
                  on somebody's behalf the moment they buy has taken a
                  decision that was never offered. It also does not appear
                  at all when the server could not sign a link, because a
                  share button that opens a 404 is worse than none. */}
              Share this pop ›
            </Typography>
          )}
          {!outcome && quote?.sub && (
            <Typography sx={{ fontSize: 10, color: JUICE.text3, mt: "2px" }}>
              {quote.sub}
            </Typography>
          )}
          {(insufficient || short) && (
            <>
              <Typography
                onClick={() => {
                  const need = topUpAmount(Math.max(0, usdNum - (reader?.cashUsd ?? 0)), "cover")
                  // Remembered for the watcher and the return: when the money
                  // lands, this coin and this amount are where it comes back to.
                  rememberTopUpIntent(need, {
                    mint: asset.mint,
                    buyUsd: usdNum,
                    ticker: asset.symbol,
                    sourceUrl: null,
                  })
                  navigate("/receive", { state: { need } })
                }}
                sx={{ fontSize: 11, fontWeight: 700, color: ACCENT, mt: 0.5, cursor: "pointer" }}
              >
                {/* "Deposit USDC", like every other door to this room. */}
                {ARC_EDITION ? "Add money" : "Deposit USDC"} →
              </Typography>
              {/* And the one-step version, right here: Blink's hosted flow
                  inline, so bringing money in does not cost a navigation
                  away from the trade somebody was already making. Renders
                  nothing until the rail is switched on in this deploy. */}
              <BlinkFund />
            </>
          )}
        </Box>
      )}

      {/* Confirm — or the sign-in gate, which is the ONE next step. */}
      {signedOut ? (
        <Box
          component="button"
          onClick={() => setIsSignInModalOpen(true)}
          className="click-animation"
          sx={confirmSx(false)}
        >
          Sign in to trade
        </Box>
      ) : (
        <Box
          component="button"
          disabled={
            (when === "trigger" ? !orderReady : !canConfirm) ||
            short ||
            busy ||
            Boolean(outcome && outcome.state !== "error")
          }
          onClick={confirm}
          className="click-animation"
          sx={confirmSx(mode === "sell")}
        >
          {/* The button names the money - the chip's pill already learned
              this ("'Buy $25' is strictly more disclosure than 'Buy'"),
              and the sheet knows the exact dollars typed. A bare verb is
              the one thing the last control before money moves must not
              be. Empty amount keeps the verb: the button is disabled and
              "Buy $NaN" is nobody's sentence. */}
          {(() => {
            if (busy) return "…"
            const n = Number(amount)
            const tail = Number.isFinite(n) && n > 0 ? ` · $${Number(n.toFixed(2))}` : ""
            if (when === "trigger")
              return mode === "buy" ? `Place order${tail}` : `Place sell order${tail}`
            if (!tail) return "Type an amount"
            /**
             * THE MODEL'S LABEL, BUT ONLY WHEN THE MODEL IS DESCRIBING THIS
             * BUTTON'S OWN ACTION.
             *
             * viewTradeSheet answers the one case this used to get wrong: a
             * sell typed for more than the position is worth executes as a
             * 100% sell, and the model says "Sell all ($3.00)" where this
             * printed the typed "$25" — the trade moved $3 and the button
             * had promised $25, on the side where trust decides whether the
             * return loop survives.
             *
             * The tone check is not decoration. `action` is armed for a
             * DOOR as well as a trade: on a short balance the model returns
             * { label: "Deposit USDC", tone: "fund", armed: true }, because
             * on the surface it was written for that button funds instead
             * of buying. This button's onClick is confirm() whatever it
             * says, so adopting that label put the word "Deposit" on a key
             * that sends a swap the backend then refuses — a worse lie than
             * the one being fixed. Only a label whose tone IS this button's
             * direction describes what pressing it does.
             */
            if (view.action?.armed && view.action.tone === mode) return view.action.label
            return mode === "buy" ? `Buy${tail}` : `Sell${tail}`
          })()}
        </Box>
      )}
    </Box>
  )
}

const chipSx = (active: boolean) => ({
  border: "none",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 700,
  px: 1.75,
  py: "6px",
  borderRadius: "999px",
  color: active ? JUICE.onAccent : "rgba(255,255,255,.8)",
  backgroundColor: active ? ACCENT : alpha("#FFFFFF", 0.07),
  "&:hover": { backgroundColor: active ? "#86D2FF" : alpha("#FFFFFF", 0.12) },
  "&:disabled": { opacity: 0.4, cursor: "default" },
})

/**
 * A confirm never wears a colour that is not its direction. The buy side
 * used to be filled ACCENT blue, which is the brand's colour, not a trade's:
 * the chip and the card settled buy=green / sell=red (SpotCard/style.ts
 * writes the law out loud), and the panel IS the app, so its own money
 * rooms were the last surfaces still speaking the old palette.
 */
const confirmSx = (sell: boolean) => ({
  width: "100%",
  border: "none",
  cursor: "pointer",
  font: "inherit",
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: ".01em",
  py: "11px",
  borderRadius: "999px",
  color: sell ? "#FFFFFF" : JUICE.onBuyFill,
  background: sell ? RED : JUICE_BUY_FILL,
  boxShadow: sell ? "none" : `0 8px 26px -8px ${JUICE.buyGlow}`,
  transition: "background .15s ease-out, opacity .15s ease-out",
  "&:hover": { background: sell ? "#FF6961" : JUICE.buyFillHi },
  "&:disabled": { opacity: 0.35, cursor: "default", boxShadow: "none" },
})
