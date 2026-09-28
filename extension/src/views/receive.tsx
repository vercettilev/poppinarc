import { USDC_MINT } from "~/helpers/depositWatch"
import { ArcDepositCard } from "~/arc/ArcDepositCard"
import { ARC_EDITION, CAP } from "~/config/edition"
import { JUICE } from "~/theme/juice"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import CheckIcon from "@mui/icons-material/Check"
import ContentCopyIcon from "@mui/icons-material/ContentCopy"
import { alpha, Box, CircularProgress, Typography } from "@mui/material"
import React, { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { readTopUpIntent, type TopUpIntent } from "~/helpers/topUpIntent"
import { useQueryClient } from "@tanstack/react-query"
import { BlinkFund, useBlinkEnabled } from "~/components/BlinkFund"
import { RailRow } from "~/components/RailRow"
import { PHANTOM_LOGO_URI } from "~/assets/phantomLogoDataUri"
import { probePageWallet, topUpViaPage } from "~/helpers/panelExternalTrade"
import { sendApiRequest } from "~/lib/fetchService"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"

/** Counting is never worth failing the screen over. */
const count = (event: string, payload: Record<string, unknown>) => {
  try {
    void chrome.runtime.sendMessage({ type: "SPOT_TELEMETRY", event, payload })
  } catch {
    // no extension context
  }
}
import logo from "~/assets/logo.png"
import { QrCode } from "~/components/QrCode"
import { useToast } from "~/components/Toast/ToastProvider"
import { ACCENT, DIM, FAINT, PANEL_CARD, PANEL_PILL } from "~/helpers/panelSurface"
import { useMyWallet, useWalletBalance, useWalletTokens } from "~/hooks/useWallet"

import { useCurrentUser } from "~/hooks/useCurrentUser"

interface ReceiveProps {
  walletAddress?: string
  /**
   * Present when this renders as a TAB inside the wallet: back returns to the
   * tab it came from rather than walking browser history out of the wallet.
   */
  setActiveTab?: (tab: any) => void
}

/**
 * Add funds — the screen a reader with an empty balance is sent to.
 *
 * ── WHAT WAS HERE ───────────────────────────────────────────────────────────
 * A 24px centred "Receive Address" title, a FAKE QR code (a CSS grid of three
 * corner squares with a letter in the middle, commented "Placeholder"), the
 * address printed on a full-bleed accent slab, and a giant accent "Close"
 * button given the same weight as the thing the screen exists for. Reached by
 * pressing "Deposit USDC" on the card, which is the exact moment somebody
 * has decided to spend money.
 *
 * ── WHAT IT IS NOW ──────────────────────────────────────────────────────────
 * One method, done properly, because one method is what actually works.
 * The reference for this screen was FOMO's deposit sheet — Crypto, Apple Pay,
 * Debit, Exchanges — and that list is only good because every row in it does
 * something. The list now exists and lives on app.poppin.so/fund (wallet
 * connect + address, card parked behind env); the panel keeps the address
 * primary and opens one door to the hub.
 *
 * The ORDER is the fix: the address is the answer, so it leads. The QR is
 * real now. Copy is the primary action and says so; leaving is a quiet
 * chevron in the corner, not a full-width accent button competing with the
 * one control that matters.
 */
const Receive: React.FC<ReceiveProps> = ({
  walletAddress: walletAddressProp,
  setActiveTab,
}) => {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)
  const { data: walletInfo, isLoading: isLoadingFallback } = useMyWallet()
  /**
   * WHAT YOU ALREADY HAVE, on the screen that asks for more. Reported live:
   * "Top up" landed here and nothing said what the balance WAS — a person
   * deciding how much to send needs the starting number in view.
   */
  const { data: tokensData } = useWalletTokens()
  // Native SOL is NOT a token account; it rides the balance endpoint. The
  // wrapped-SOL row in tokens is a different (usually empty) thing.
  const { data: balanceData } = useWalletBalance()
  const spendable = (() => {
    const rows = tokensData?.tokens
    if (!Array.isArray(rows)) return null
    const usdc =
      rows.find(
        // The edition's USDC (the Solana mint in the store build).
        (t: { mint?: string }) => t.mint === USDC_MINT,
      )?.usdValue ?? 0
    const solUnits = balanceData?.balance?.sol ?? 0
    return { usdc, solUnits }
  })()

  /* A WALLET ACCOUNT'S MONEY LIVES IN ITS OWN WALLET. This screen then
     shows that address, the reader's own, and says so; the embedded
     wallet is never offered to an account that does not trade from it. */
  const { data: me, isError: meUnreadable } = useCurrentUser()
  const external = me?.wallet_mode === "external" && !!me.external_address
  /**
   * THE AMOUNT THIS SCREEN IS FOR. The chip's Deposit door and the panel's
   * Top up link know the shortfall; until now this screen did not, and
   * could only say "send USDC". From the panel it arrives as router state;
   * from the page it was remembered the moment the door was pressed
   * (helpers/topUpIntent). Whole dollars, the cover amount, one buffer
   * dollar included, the same number the one-tap Phantom rail moves.
   */
  const location = useLocation()
  const stateNeed = (location.state as { need?: unknown } | null)?.need
  /**
   * WHICH SURFACE SENT THEM, when the amount cannot say. `from` used to be
   * inferred from the presence of a number, because every panel door had a
   * shortfall behind it; the front door's funding door (components/
   * FundDoor.tsx) has no buy behind it and would have counted itself as a
   * page door on the very funnel it was built to move.
   */
  const stateFrom = (location.state as { from?: unknown } | null)?.from
  const [need, setNeed] = useState<number | null>(
    typeof stateNeed === "number" && stateNeed > 0 ? Math.ceil(stateNeed) : null,
  )
  const [intent, setIntent] = useState<TopUpIntent | null>(null)
  useEffect(() => {
    let alive = true
    void readTopUpIntent().then((i) => {
      if (!alive || !i) return
      setIntent(i)
      if (need === null && i.usd) setNeed(i.usd)
    })
    return () => {
      alive = false
    }
  }, [])
  /**
   * THE WATCH AND THE RETURN. While this screen is up for a reason (a
   * number or a coin came with it), the balance is re-read every ten
   * seconds for ten minutes instead of every thirty. The moment it rises,
   * the page's chips are told (BOOK_CHANGED_NOW, ahead of the watcher's
   * two-minute alarm), and when a coin came with the intent the reader is
   * returned to that Buy with the dollars they typed, quoted and armed.
   */
  const queryClient = useQueryClient()
  const [landedUsd, setLandedUsd] = useState<number | null>(null)
  const startUsdc = useRef<number | null>(null)
  const watching = !external && (need !== null || intent !== null) && landedUsd === null
  /** Ten minutes of ten-second looks, then every thirty seconds, and the line says which. */
  const [slowWatch, setSlowWatch] = useState(false)
  useEffect(() => {
    if (!watching) return
    const t0 = Date.now()
    const timer = window.setInterval(() => {
      const late = Date.now() - t0 > 10 * 60_000
      if (late && !slowWatch) setSlowWatch(true)
      if (late && Math.round((Date.now() - t0) / 10_000) % 3 !== 0) return
      void queryClient.invalidateQueries({ queryKey: ["wallet"] })
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [watching])
  /** A number that came with a buy says so; the fund box's own picks have no buy behind them. */
  const forBuy = typeof stateNeed === "number" || !!intent?.mint
  /**
   * PHANTOM ON THE PAGE BESIDE THE PANEL: the chip's one-tap rail, offered
   * here too. Asked once, of the page, through the same relay a trade uses.
   */
  const [phantomHere, setPhantomHere] = useState(false)
  const blinkOn = useBlinkEnabled()
  const [phantomBusy, setPhantomBusy] = useState(false)
  useEffect(() => {
    if (me === undefined) return
    // The one-tap rail moves Solana USDC; the Arc edition never offers it.
    if (!CAP.solanaRails) return
    let alive = true
    void probePageWallet().then((present) => {
      if (alive) setPhantomHere(present)
    })
    return () => {
      alive = false
    }
  }, [me === undefined, external])
  const fundFromPhantom = async () => {
    if (phantomBusy) return
    const usd = need ?? 25
    setPhantomBusy(true)
    count("receive_phantom_topup", { usd })
    try {
      const funded = await topUpViaPage(usd)
      if (funded) {
        showToast("Sent from Phantom. Landing now.", "success")
        void queryClient.invalidateQueries({ queryKey: ["wallet"] })
      }
    } catch (e) {
      showToast((e as Error)?.message ?? "Phantom did not send.", "error")
    } finally {
      setPhantomBusy(false)
    }
  }
  /**
   * A WALLET ACCOUNT'S MONEY IS IN ITS OWN WALLET. The panel cannot see
   * Phantom, so that wallet's USDC is read from the chain through our
   * server, every ten seconds while the screen has a reason, and a landing
   * returns to the buy exactly as the embedded wallet's does.
   *
   * ── WHAT IS NO LONGER HERE ──────────────────────────────────────────────
   * A card above the address that read the wallet's SOL
   * (/embed/asset/convert/wallet) and offered "Convert $25 of SOL to USDC"
   * for one Phantom signature. Lev, 2026-09-22, after the chip's version of
   * the same rail opened Phantom on "+10.15 USDC, -0.088 SOL" under a
   * button that said Deposit: "Convert SOL to USDC" exists as a product
   * concept in no app on earth — Jupiter, Phantom and Uniswap all route
   * from whatever you hold — so shipping it as a button or an offer would
   * be inventing a concept nobody recognises. Simplicity wins.
   *
   * So there is no conversion anywhere on this path, and this screen is not
   * the place it survives as a remedy either. The answer for a wallet
   * account is the headline above and the address below it.
   *
   * WHY IT NEEDS USDC RATHER THAN WHATEVER IT HOLDS, so the next reader
   * does not put the rail back: the server proves an external trade's SIZE
   * from the USDC leg of the transaction (apps/backend/src/spot/
   * external-proof.util.ts, `executedUsd`), and a trade with no USDC leg is
   * refuted and never settles. Generalising that proof is queued; a
   * signature the reader did not ask for was not the way to stand in for it.
   */
  const [extUsdc, setExtUsdc] = useState<number | null>(null)
  const extWatching = external && (need !== null || intent !== null) && landedUsd === null
  useEffect(() => {
    if (!external) return
    let alive = true
    const read = () => {
      void sendApiRequest<{ usd?: number }>({
        url: "/fund/wallet-usdc",
        method: "GET",
        params: { address: String(me?.external_address ?? "") },
      })
        .then((r) => {
          if (alive && typeof r?.usd === "number") setExtUsdc(r.usd)
        })
        .catch(() => {})
    }
    read()
    if (!extWatching) {
      return () => {
        alive = false
      }
    }
    const timer = window.setInterval(read, 10_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [external, extWatching])
  const startExtUsdc = useRef<number | null>(null)
  useEffect(() => {
    if (!external || extUsdc === null) return
    if (startExtUsdc.current === null) {
      startExtUsdc.current = extUsdc
      return
    }
    const delta = extUsdc - startExtUsdc.current
    if (delta > 0.5 && landedUsd === null) {
      setLandedUsd(delta)
      showToast(`$${delta.toFixed(2)} USDC landed in Phantom`, "success")
      try {
        void chrome.runtime.sendMessage({ type: "BOOK_CHANGED_NOW" })
      } catch {
        // no extension context
      }
      if (intent?.mint) {
        useLaunchAssetStore.getState().setLaunchMint(intent.mint, "buy", intent.buyUsd ?? undefined)
        navigate(`/token/${intent.mint}`)
      }
    }
  }, [extUsdc])
  /**
   * THE DEPOSIT FUNNEL'S FIRST TWO STEPS, counted here: the screen opened
   * (once per visit, with what the visit was for) and the address copied.
   * deposit_landed, from the watcher, carries the minutes since the door;
   * the founder page lines the three up with the first trade after them.
   */
  const counted = useRef(false)
  useEffect(() => {
    if (counted.current || me === undefined) return
    counted.current = true
    count("receive_opened", {
      need,
      external,
      from: stateFrom === "panel" || typeof stateNeed === "number" ? "panel" : "page",
    })
  }, [me === undefined])
  /**
   * WHOSE ADDRESS THIS IS CANNOT BE GUESSED, AND THE GUESS WAS CUSTODIAL.
   *
   * `external` is a read of `me`, and `me` is undefined until GET /users/me
   * answers — so while the account is unread, `external` is false and this
   * line used to fall straight through to the EMBEDDED wallet. The loading
   * gate watched only useMyWallet, and /wallets/me answering first is the
   * ordinary case on a cold panel boot straight into /receive, which is
   * exactly what the chip's and the panel's funding doors do.
   *
   * The reader then gets a QR, a copy pill and a header for a wallet their
   * account does not trade from. USDC sent there is invisible to every
   * surface they have: no balance, no toast, no Buy. It is the one mistake on
   * this screen that money cannot come back from, and it is made by waiting a
   * few hundred milliseconds too little.
   *
   * So an unread account renders as LOADING, never as custodial — the same
   * fact the receive_opened counter above already waits on (`me === undefined`).
   * The spinner is the honest answer to "which wallet is this": we do not
   * know yet. It applies to the prop too: wallet-ui hands this screen the
   * CUSTODIAL address (views/wallet-ui.tsx reads it off useMyWallet), which
   * is the very address a wallet account must not be shown.
   *
   * A read that FAILED is unread as well, and it ends on the screen's own
   * "could not be read" rather than a spinner nothing will ever end —
   * useCurrentUser is retry:false and does not refetch on focus, so there is
   * no second answer coming until the panel is opened again.
   */
  const accountUnread = me === undefined
  const walletAddress = accountUnread
    ? ""
    : external
      ? String(me?.external_address)
      : walletAddressProp || walletInfo?.wallet?.public_key || ""
  const isLoading = accountUnread
    ? !meUnreadable
    : walletAddressProp
      ? false
      : isLoadingFallback

  /**
   * Say the NETWORK and the TOKEN, because those are the two ways money gets
   * lost here. "This address can only be used to receive compatible tokens"
   * named neither and warned about nothing.
   *
   * ONE NETWORK. An Arc branch stood beside this one, reachable from a chain
   * picker on the wallet screen; Arc's backend left in August and the picker
   * went with it (panel audit, 2026-09-20).
   */
  const copyForChain = {
    network: "Solana",
    /**
     * USDC, AND ONLY USDC. This screen is the destination of every
     * "Deposit USDC" button in the product, and it used to instruct
     * "USDC or SOL" — a sentence that stopped being true when the SOL
     * pocket was retired on 2026-08-28 (apps/backend/src/spot/
     * native-sol.util.ts:6, "USDC is the product's money"). A buy
     * spends USDC alone; SOL sent here lands in the wallet, buys
     * nothing, and the next Buy still says "Deposit USDC". The web
     * hub already says it correctly — one address must not carry two
     * opposite instructions.
     */
    token: "USDC",
    /**
     * ONE INSTRUCTION, NO ALARM. The warning used to read "anything
     * else is unrecoverable", which is both frightening and untrue:
     * another SPL token sent to this address is sitting in the same
     * wallet and can be swapped out. Saying "unrecoverable" over a
     * recoverable mistake buys nothing and costs trust. Say the one
     * thing to do; the arrival toast handles the wrong-token case
     * when it happens.
     */
    note: "Send USDC on Solana.",
  }

  useEffect(() => {
    if (external || spendable === null) return
    if (startUsdc.current === null) {
      startUsdc.current = spendable.usdc
      return
    }
    const delta = spendable.usdc - startUsdc.current
    if (delta > 0.5 && landedUsd === null) {
      setLandedUsd(delta)
      showToast(`$${delta.toFixed(2)} USDC landed`, "success")
      try {
        void chrome.runtime.sendMessage({ type: "BOOK_CHANGED_NOW" })
      } catch {
        // no extension context
      }
      if (intent?.mint) {
        // The token room consumes a launch on every host; the home strip
        // does not mount on X at all, so "/" returned the reader nowhere.
        useLaunchAssetStore.getState().setLaunchMint(intent.mint, "buy", intent.buyUsd ?? undefined)
        navigate(`/token/${intent.mint}`)
      }
    }
  }, [spendable?.usdc])

  const handleCopy = () => {
    navigator.clipboard.writeText(walletAddress)
    count("receive_copy_address", { need, external })
    setCopied(true)
    showToast("Address copied", "success")
    setTimeout(() => setCopied(false), 1800)
  }

  const goBack = () => {
    if (setActiveTab) return setActiveTab("tokens")
    return window.history.length > 1 ? navigate(-1) : navigate("/wallet-ui")
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pb: 3 }}>
      {/* Leaving is a corner chevron. It used to be a full-width accent
          button under the address, which gave "go away" the same visual
          weight as "copy the thing you came for". */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 2, pt: 1.5 }}>
        <Box
          component="button"
          onClick={goBack}
          aria-label="Back"
          className="click-animation"
          sx={{
            ...PANEL_PILL,
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            color: "#FFFFFF",
            p: 0,
            flexShrink: 0,
            "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
        </Box>
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>
          {external ? "Add USDC to your wallet" : "Deposit USDC"}
        </Typography>
      </Box>

      {/* ONE SENTENCE. With a number the number is the sentence; the
          balance shows only once there is one. Lev, seeing three lines and
          a zero: "biraz karışık geldi". */}
      {(external || need === null) && (
      <Typography sx={{ fontSize: 13, color: DIM, px: 2, mt: 0.5, lineHeight: 1.5 }}>
        {external
          ? need !== null
            ? `Your buy needs $${need} USDC in Phantom.${extUsdc !== null ? ` It holds $${extUsdc.toFixed(2)}.` : ""}`
            : "Your trades come from this wallet, your own. Send USDC to it from an exchange or another wallet."
          : `${copyForChain.token} you send here becomes your trading balance.`}
        {/* True on every money path now — the terminal swap tops up from
            the gas tank like the spot rail always did. It is also the one
            sentence that makes every remaining SOL sighting harmless: you
            never need any, so you never have to think about it. */}
        {/* No fee sentences in the Arc edition. */}
        {CAP.feeLines && (!external ? " Network fees are on us." : "")}
      </Typography>
      )}

      {!external && need !== null && (
        <Typography sx={{ fontSize: 13, px: 2, mt: 0.75, color: "#FFFFFF", fontWeight: 600 }}>
          {forBuy ? `Send at least $${need} USDC to cover your buy.` : `Send at least $${need} USDC.`}
        </Typography>
      )}
      {/* ONE SENTENCE, because there is one rail that can fail this way.
          It used to fork on `external` and say "Phantom could not convert
          it" — a sentence about a conversion that no longer happens on any
          path, and a note a wallet account can no longer be handed at all
          (its doors reach this screen directly now, with nothing signed on
          the way). */}
      {intent?.note && (
        <Typography sx={{ fontSize: 12.5, px: 2, mt: 0.5, color: JUICE.amber, lineHeight: 1.45 }}>
          {`Phantom could not send it: ${intent.note}`}
        </Typography>
      )}
      {!external && spendable !== null && spendable.usdc > 0 && (
        <Typography sx={{ fontSize: 13, px: 2, mt: 0.75, color: "#FFFFFF", fontWeight: 600 }}>
          Balance now: ${spendable.usdc.toFixed(2)} USDC
        </Typography>
      )}
      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={22} sx={{ color: ACCENT }} />
        </Box>
      ) : ARC_EDITION ? (
        /* THE ARC EDITION'S CARD: the Arc address first with its network
           named, the other networks one tap away. It reads the deposit
           route itself and falls back to the wallet address held here. */
        <ArcDepositCard
          fallbackAddress={walletAddress}
          onCopy={(network) => count("receive_copy_address", { need, external, network })}
        />
      ) : !walletAddress ? (
        <Typography sx={{ fontSize: 13, color: DIM, px: 2, mt: 3, textAlign: "center" }}>
          Your wallet address could not be read. Try again in a moment.
        </Typography>
      ) : (
        /* ONE CARD, in the order Blink's own sheet uses, because that sheet
           is what the tab opens and the two must read as the same thing:
           the QR, the address as a pill that copies, the token and the
           network, the minimum, then OR and the rails that do it for you.
           Lev, seeing our card and Blink's side by side: "ikisi de aynı
           yere çıkacaksa ilk ekteki yeterli". A wallet account gets the
           same card with its own address and no rails. */
        <Box sx={{ mx: 2, mt: 2, ...PANEL_CARD }}>
          <Box sx={{ display: "grid", placeItems: "center" }}>
            {/* THE QR NAMES THE TOKEN: a Solana Pay URI carries the mint, so
                Phantom and Solflare preselect USDC instead of native SOL. */}
            <QrCode
              value={`solana:${walletAddress}?spl-token=${USDC_MINT}`}
              size={168}
              mark={logo}
            />
          </Box>
          <Box
            component="button"
            onClick={handleCopy}
            className="click-animation"
            aria-label="Copy address"
            sx={{
              mt: 1.5,
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: "10px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,.10)",
              backgroundColor: copied ? alpha("#30D158", 0.16) : JUICE.well,
              color: copied ? "#30D158" : "rgba(255,255,255,.88)",
              cursor: "pointer",
              font: "inherit",
              transition: "background-color .16s ease-out",
              "&:hover": { backgroundColor: copied ? alpha("#30D158", 0.16) : alpha("#FFFFFF", 0.1) },
            }}
          >
            {copied ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
            <Typography
              sx={{
                flex: 1,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 12.5,
                letterSpacing: ".02em",
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "Copied" : `${walletAddress.slice(0, 18)}…${walletAddress.slice(-6)}`}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, mt: 1.25 }}>
            {[copyForChain.token, copyForChain.network].map((label) => (
              <Box
                key={label}
                sx={{
                  ...PANEL_PILL,
                  flex: 1,
                  textAlign: "center",
                  py: "9px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#FFFFFF",
                }}
              >
                {label}
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: 11.5, color: FAINT, mt: 1, textAlign: "center", lineHeight: 1.45 }}>
            {external
              ? "Send USDC on Solana."
              : "Send USDC on Solana, from Coinbase, Binance or any wallet."}
          </Typography>
          {(blinkOn || (!external && phantomHere)) && (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 1.5 }}>
                <Box sx={{ flex: 1, height: "1px", backgroundColor: alpha("#FFFFFF", 0.1) }} />
                <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: DIM }}>
                  OR
                </Typography>
                <Box sx={{ flex: 1, height: "1px", backgroundColor: alpha("#FFFFFF", 0.1) }} />
              </Box>
              {/* Three doors, three sources of money, stacked (Lev, 18 Eyl):
                  the card above for USDC on Solana, Blink for another
                  chain, Phantom for USDC already on this page. */}
              <Box sx={{ display: "grid", gap: 1 }}>
                <BlinkFund
                  variant="row"
                  amountUsd={need}
                  address={walletAddress}
                  onOpen={(mode) => count("receive_blink_open", { need, mode })}
                />
                {!external && phantomHere && (
                  <RailRow
                    glyph={<Box component="img" src={PHANTOM_LOGO_URI} alt="" sx={{ width: 34, height: 34 }} />}
                    title="Phantom"
                    sub={phantomBusy ? "Waiting for Phantom…" : `Deposit $${need ?? 25} in one tap, on this page`}
                    onClick={() => void fundFromPhantom()}
                    busy={phantomBusy}
                  />
                )}
              </Box>
            </>
          )}
        </Box>
      )}
      {(watching || extWatching) && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, mt: 1.5 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              backgroundColor: JUICE.amber,
              boxShadow: `0 0 0 4px ${alpha(JUICE.amber, 0.18)}`,
            }}
          />
          <Typography sx={{ fontSize: 12, color: DIM }}>
            {slowWatch
              ? "Still watching, every 30 seconds now. Exchanges sometimes take longer."
              : "Watching for your USDC. Usually 1-3 minutes from an exchange."}
          </Typography>
        </Box>
      )}
      {landedUsd !== null && (
        <Typography sx={{ fontSize: 13, px: 2, mt: 1.25, color: JUICE.green, fontWeight: 600 }}>
          {`$${landedUsd.toFixed(2)} USDC landed.`}
        </Typography>
      )}
    </Box>
  )
}

export { Receive }
export default Receive
