import { alpha, Box, Typography } from "@mui/material"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { connectWalletViaPage } from "~/helpers/panelExternalTrade"
import { rememberTopUpIntentIfNone } from "~/helpers/topUpIntent"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { ACCENT, DIM } from "~/helpers/panelSurface"
import { JUICE } from "~/theme/juice"
import { ARC_EDITION, CAP } from "~/config/edition"

/**
 * Counting is never worth failing the door over — the same three lines every
 * other surface uses (views/receive.tsx, components/PopDoors.tsx). The names
 * are the extension's own; entries/background/main.ts's TELEMETRY_MAP is what
 * turns each into one of the backend's accepted event_types, and an event
 * with no home there is DROPPED, so a new name is added in both places or it
 * is measured as zero.
 */
const count = (event: string, payload: Record<string, unknown> = {}) => {
  try {
    void chrome.runtime.sendMessage({ type: "SPOT_TELEMETRY", event, payload })
  } catch {
    // no extension context
  }
}

/**
 * THE FUNDING DOOR, ON THE SCREEN EVERY SESSION ALREADY OPENS.
 *
 * The funding ask used to stand in onboarding, was moved out on purpose, and
 * now waits at "the first trade" — a step nobody reaches. Measured
 * 2026-09-21: of the seven strangers who have ever signed in, six opened the
 * panel and none opened the funding screen, so the door that works has never
 * been shown to anyone. The panel owns the money UI (it is the standing rule
 * that put TradeSheet here rather than on the page card), so the ask belongs
 * on the panel's front door, above the fold, before a trade is attempted.
 *
 * WHO SEES IT is decided by helpers/readerCash.ts, not here: a balance the
 * server has STATED as nothing. The caller also waits for the live read, so a
 * reader whose deposit landed between two cache writes is never shown this
 * over yesterday's zero.
 *
 * ONE MECHANISM, NOT A SECOND ONE. This is the trade sheet's door with its
 * shortfall removed: remember the intent, then navigate to /receive. The
 * intent is what the deposit watcher times ("minutes since a Deposit door was
 * pressed", entries/background/main.ts) and it is written with no amount
 * because this door has no buy behind it — nobody typed a number, so the
 * address screen must not invent one to ask for.
 *
 * THE VERB IS "Deposit USDC", like the other six doors to the same room
 * (views/deposit-doors.spec.ts sweeps for it) — ON A CUSTODIAL ACCOUNT.
 *
 * ── AND THE OTHER WORDING, FOR AN ACCOUNT THAT TRADES FROM A WALLET ─────────
 *
 * "Deposit USDC" promises a balance held here, and a wallet account has no
 * such balance: its USDC sits in its own wallet and its trades spend it from
 * there. Lev's own wording for that is the headline — "Add USDC to your
 * wallet" — and it is already what the room this door opens says at the top
 * of itself (views/receive.tsx, the same `wallet_mode === "external" &&
 * external_address` read). Two names for one act was the whole complaint;
 * this is one name per account, said the same way on the door and in the
 * room.
 *
 * THE FEE FACT SWAPS WITH IT, because it is not true on both sides. Network
 * fees are on us on the custodial rail and the reader's own on the wallet
 * rail, so the second sentence says the thing that is true here: each trade
 * signs in Phantom — the fact the Settings card and the second door below
 * already state in exactly those words.
 *
 * AND THE SECOND DOOR IS NOT DRAWN AT ALL for a wallet account: "or connect a
 * wallet you already have" is an offer to become the thing they already are.
 *
 * ── AND, UNDER IT, THE DOOR FOR SOMEBODY WHO IS ALREADY CARRYING MONEY ──────
 *
 * Measured 2026-09-22, team and test accounts excluded: eight strangers have
 * ever signed in, none has opened the funding screen, none has traded, and
 * no deposit has landed in the product's lifetime. Every one of those zeroes
 * sits behind one step, a person moving money, and not one person has taken
 * it. Somebody who already holds USDC in a wallet does not need that step at
 * all: point the account at their wallet and the very next chip is a Buy
 * they can press (SpotSwapService.tradingWallet has routed money this way
 * since wallet sign-in shipped; what was missing was a way to say yes to it
 * from an account that already exists).
 *
 * QUIETER THAN THE CARD ABOVE, deliberately. Depositing keeps the fees on us
 * and the trade one press; connecting a wallet hands both back to the
 * reader. It is the better door for exactly one person, and the second-best
 * for everybody else, so it reads as a second sentence and not a second
 * offer.
 *
 * IT SIGNS ON THE PAGE, BECAUSE THERE IS NOWHERE ELSE. A wallet extension
 * injects into web pages and never into another extension's pages, so this
 * panel cannot reach Phantom at all. connectWalletViaPage hands the ask to
 * the tab beside the panel over the SAME relay every wallet trade already
 * uses (helpers/panelExternalTrade.ts → background → the page's MAIN-world
 * bridge). With no web page open the background answers "Open X, Reddit or
 * any web page beside the panel, then try again." and that sentence is what
 * prints: no tab we could open would help, because the wallet only appears
 * in a page the reader is on.
 */
export function FundDoor({ onConnected }: { onConnected?: () => void } = {}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /**
   * WHICH ACCOUNT THIS IS, from the one read that already answers it. The
   * same hook and the same two fields views/receive.tsx and
   * components/TradingWalletCard.tsx use — and the same react-query cache
   * this door writes to itself when a connect lands, so the wording flips
   * on the spot without a second source for one fact.
   */
  const { data: me } = useCurrentUser()
  const external = me?.wallet_mode === "external" && !!me.external_address

  /**
   * THE DOOR COUNTS ITSELF, because nothing above it can.
   *
   * This shipped with no telemetry at all — no impression, no press, nothing
   * on the connect — while the whole problem it was built for is that we
   * cannot see WHERE people stop. Eight signed-in strangers, no funding
   * screen opened, no trade: without these rows the next version of that
   * sentence is still "somewhere between the panel and the money".
   *
   * Once per mount, and only once the account is read: `external` decides
   * which of the two doors this is, and a count that claims the custodial one
   * because /users/me had not answered yet is a measurement of our own
   * loading state. (views/receive.tsx waits on the same fact for the same
   * reason.) The caller only draws this over a LIVE zero balance, so a mount
   * is an impression and not a guess.
   */
  const seen = useRef(false)
  useEffect(() => {
    if (seen.current || me === undefined) return
    seen.current = true
    count("panel_fund_shown", { external })
  }, [me === undefined])

  const connect = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    // The press itself, before anything can fail: the denominator for every
    // ending below, including the ones that never come back.
    count("panel_fund_connect", { external })
    try {
      const r = await connectWalletViaPage()
      // Which wallet trades has changed, so every surface that caches the
      // account has to hear it before it spends from the old one.
      queryClient.setQueryData(["current-user"], (old: unknown) =>
        old && typeof old === "object"
          ? { ...old, wallet_mode: r.wallet_mode, external_address: r.external_address }
          : old,
      )
      void queryClient.invalidateQueries({ queryKey: ["current-user"] })
      // The one activation this door exists for, and the only place in the
      // product where an existing account starts trading from a wallet it
      // already holds.
      count("panel_fund_connected", { mode: r.wallet_mode })
      // The book above this door is now the wrong wallet's. The screen that
      // owns it re-reads; this door disappears on its own when the read
      // comes back with money in it.
      onConnected?.()
    } catch (e) {
      /**
       * PRINTED AS IT ARRIVES. The server writes three different refusals
       * here and each one is a different next move: an address that belongs
       * to another account, a Poppin wallet that still holds money and must
       * be emptied first, an account already trading from a wallet.
       * Flattening them into one sentence would take the move away.
       */
      const m = (e as { message?: string })?.message
      /* WHICH refusal, not just that there was one. Three of these come from
         the server and each is a different next move; the fourth is a closed
         Phantom window. Counting them as one number would tell us people stop
         here and nothing about why, which is the position this door was built
         to get us out of. The sentence is ours, written by the server for a
         reader, and it rides clipped. */
      count("panel_fund_connect_refused", {
        reason: typeof m === "string" ? m.slice(0, 120) : "unknown",
      })
      setNote(typeof m === "string" && m.length > 0 && m.length < 220 ? m : "Phantom did not connect.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        component="button"
        onClick={() => {
          count("panel_fund_press", { external })
          /* ONLY IF THERE IS NOTHING TO LOSE. This door has no buy behind it,
             so it used to write an EMPTY intent over the `{usd, mint}` a
             chip's Deposit door had written minutes before — and the address
             screen then no longer knew which buy the money was for
             (helpers/topUpIntent.ts). */
          void rememberTopUpIntentIfNone()
          // `from` is the funnel's own question — which surface sent them —
          // and without it the panel's door would be counted as a page door.
          navigate("/receive", { state: { from: "panel" } })
        }}
        className="click-animation"
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 1.5,
          py: "11px",
          borderRadius: "14px",
          border: `1px solid ${alpha(ACCENT, 0.4)}`,
          background: `linear-gradient(180deg, ${alpha(ACCENT, 0.16)}, ${alpha(ACCENT, 0.06)})`,
          // Rule 3: a surface that can move money glows. Softly — this is the
          // resting tier, not the landed-trade one.
          boxShadow: JUICE.glowRest,
          color: "#FFFFFF",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          "&:hover": { borderColor: alpha(ACCENT, 0.6) },
        }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 15,
            fontWeight: 700,
            // Money speaks mono (rule 6); the sentences beside it do not.
            fontFamily: JUICE.mono,
            color: ACCENT,
            backgroundColor: alpha(ACCENT, 0.18),
          }}
        >
          $
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>
            {external ? "Add USDC to your wallet" : ARC_EDITION ? "Add money" : "Deposit USDC"}
          </Typography>
          {/* Literal, because this is the sentence money moves on. The payoff
              first in the product's own word, then the fact that removes the
              one question a new reader asks next (views/receive.tsx says it
              the same way: "Network fees are on us."). A wallet account gets
              the fact that is true for IT instead: the fees are theirs, and
              the trade signs in Phantom. */}
          <Typography sx={{ fontSize: 11.5, color: DIM, lineHeight: 1.4 }}>
            {external
              ? "Every chip becomes a Buy button. Each trade signs in Phantom."
              : !CAP.feeLines
                ? "Every chip becomes a Buy button."
                : "Every chip becomes a Buy button. Network fees are on us."}
          </Typography>
        </Box>
        <Typography sx={{ color: ACCENT, fontSize: 16, lineHeight: 1, flexShrink: 0 }}>›</Typography>
      </Box>

      {/* NOT OFFERED TO SOMEBODY WHO IS ALREADY THERE. This door's whole
          value is skipping the deposit step by pointing the account at a
          wallet the reader already holds USDC in; on an account whose trades
          already come from its own wallet it is an offer to become what they
          are, under a card whose headline has just told them where to send
          the USDC. */}
      {/* Connecting a Phantom wallet is a store rail; the Arc edition trades
          from its Circle wallet only. */}
      {CAP.solanaRails && (
      <>
      {!external && (
        <Box
          component="button"
          onClick={() => void connect()}
          disabled={busy}
          sx={{
            width: "100%",
            mt: 0.75,
            px: 1.5,
            py: "7px",
            border: "none",
            background: "none",
            font: "inherit",
            textAlign: "left",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            borderRadius: "10px",
            "&:hover": { background: alpha("#FFFFFF", 0.04) },
          }}
        >
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: alpha("#FFFFFF", 0.82), lineHeight: 1.3 }}>
            {busy ? "Waiting for Phantom…" : "or connect a wallet you already have"}
          </Typography>
          {/* Literal, because this one moves where the money lives. Both facts
              are the ones the Settings card already states in these words:
              trades sign in Phantom, and the fees are the reader's. */}
          <Typography sx={{ fontSize: 11.5, color: DIM, lineHeight: 1.4 }}>
            Trade the USDC you already hold. Each trade signs in Phantom.
          </Typography>
        </Box>
      )}
      </>
      )}

      {note && (
        <Typography sx={{ fontSize: 11.5, color: JUICE.red, mt: 0.5, px: 1.5, lineHeight: 1.4 }}>
          {note}
        </Typography>
      )}
    </Box>
  )
}
