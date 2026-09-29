import { Box, Button, CircularProgress, Typography } from "@mui/material"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { USDC_MINT } from "~/arc/chain"
import { CNBC_ICON_URI, REDDIT_ICON_URI } from "~/assets/tryPlaceIcons"
import { ARC_TRY_PLACES, type TryPlace } from "~/config/onboarding"
import { depositCardView, pillAddress, useDepositAddresses } from "~/arc/depositAddresses"
import { QrCode } from "~/components/QrCode"
import { AmountPicker } from "~/arc/AmountPicker"
import { depositPlaces, NetworkSelect } from "~/arc/NetworkSelect"
import { useMyWallet, useWalletTokens } from "~/hooks/useWallet"
import { QuietAction, StepFrame } from "./StepFrame"
import { GhostMark } from "./GhostMark"
import appearGif from "~/assets/poppin-appear.gif"

/**
 * THE ARC EDITION'S LAST ONBOARDING SCREEN: money in, before the first post.
 *
 * The store build lets the chip ask for money at the moment of a Buy. The Arc
 * edition asks here instead, once, right after Poppin is turned on, because
 * its account is a Circle wallet that exists from sign-in and the one thing
 * standing between a reader and "See it. Tap it." is a balance. The screen
 * is skippable in one quiet tap, and a reader who already has money never
 * sees it.
 *
 * TWO STATES, ONE SCREEN. Waiting shows the address; the moment the USDC row
 * of /wallets/tokens rises above where it started, the same screen says so
 * with the amount that arrived. Money that lands on another network is swept
 * to Arc by arc-api and shows up here the same way, as USDC on Arc.
 *
 * WORDS. Only the line above the address names the token and the network:
 * money sent on the wrong network does not arrive, so that one line is
 * literal. Everything else is plain (Lev, 2026-09-28: no "dollar", no
 * "trade", short, classy, obvious).
 *
 * EVERY WAY OUT ENDS ON "Try Poppin": money that landed, a skip, or a reader
 * who already had money. It offers one real post on each kind of page the
 * chip runs on (ARC_TRY_PLACES), each drawn with its site's own icon, rather
 * than one fixed X page: Lev, 2026-09-29, "gerçekten çipin çalıştığı birkaç
 * alternatif".
 *
 * `onDone(url)` is ShowMeStep's handoff, which owns the telemetry and the
 * navigation; this screen never leaves the page on its own.
 */
const FONT = "PoppinSans, -apple-system, 'Segoe UI', Roboto, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
const ACCENT = "#68C6FF"

/** Re-read the balance this often while waiting. The server caches tokens for 1.5 s. */
const WATCH_MS = 5_000
/** How long the first balance read may take before the screen shows without it. */
const FIRST_READ_WAIT_MS = 4_000
/** A reader who already holds at least this much goes straight on. */
const ALREADY_FUNDED_USDC = 1
/** Rises smaller than this are rounding, not an arrival. */
const ARRIVAL_EPSILON = 0.005

const track = (action: string) => {
  try {
    void chrome.runtime.sendMessage({
      type: "SPOT_TELEMETRY",
      event: "onboarding_step",
      payload: { step: "/add-money", action },
    })
  } catch {
    // Counting is never worth failing the step over.
  }
}

/** The edition's USDC, as a number, from a /wallets/tokens answer; null when unreadable. */
export function usdcHeld(body: unknown): number | null {
  const rows = (body as { tokens?: unknown } | null)?.tokens
  if (!Array.isArray(rows)) return null
  const row = rows.find(
    (t: { mint?: unknown }) => typeof t?.mint === "string" && t.mint.toLowerCase() === USDC_MINT.toLowerCase(),
  ) as { uiAmount?: unknown } | undefined
  if (!row) return 0
  const n = Number(row.uiAmount)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** "0x7a3f 91c0 4b2e … e5d1 c91e": the head to recognise, the tail to check. */
export function groupedAddress(a: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return pillAddress(a)
  return `${a.slice(0, 6)} ${a.slice(6, 10)} ${a.slice(10, 14)} … ${a.slice(-8, -4)} ${a.slice(-4)}`
}

export const money = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function ArcAddMoney({ onDone }: { onDone: (to?: string) => void | Promise<void> }) {
  const queryClient = useQueryClient()
  const { data: walletInfo } = useMyWallet()
  const { data: deposit } = useDepositAddresses(true)
  const { data: tokens, isError: tokensUnreadable } = useWalletTokens()
  const held = usdcHeld(tokens)

  /* The baseline is the first balance that was actually READ. State, not a
     ref: learning it has to draw the screen again. An unreadable or slow
     first read never becomes a zero baseline (arc-api answers 503 rather
     than a zero for exactly this reason, see readTokens): it only lets the
     screen show without one, and the baseline waits for a real read. A zero
     there would announce money the reader already had as just arrived. */
  const [start, setStart] = useState<number | null>(null)
  const [showWithoutStart, setShowWithoutStart] = useState(false)
  /** Why the reader is on "Try Poppin" without money having landed here. */
  const [trying, setTrying] = useState<null | "already" | "skipped">(null)
  const [landed, setLanded] = useState<number | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  /**
   * The network the reader sends on. Arc is the balance itself; every other
   * network is a wallet of theirs that arc-api sweeps to Arc with CCTP, so
   * money sent on any of them ends in the one balance with no bridge to run.
   */
  const [network, setNetwork] = useState("Arc")
  /** How much the reader means to send; guidance for the sentence, not a limit on what counts. */
  const [amount, setAmount] = useState(25)
  /** The address can take a moment the first time (Circle makes the wallet); say so rather than spin in silence. */
  const [slowAddress, setSlowAddress] = useState(false)
  const [tabId, setTabId] = useState<number | null>(null)

  /* The side panel opens only from a gesture, and an await between the tap
     and the call can cost the gesture, so the tab is known before the tap.
     The tab, not the window: a tab dragged to another window keeps its id. */
  useEffect(() => {
    try {
      chrome.tabs.getCurrent((t) => {
        if (typeof t?.id === "number") setTabId(t.id)
      })
    } catch {
      // No tabs API here: the button then simply is not offered.
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setShowWithoutStart(true), FIRST_READ_WAIT_MS)
    return () => window.clearTimeout(t)
  }, [])

  const leave = async (to?: string) => {
    if (skipping) return
    setSkipping(true)
    try {
      await onDone(to)
    } catch {
      // Still here: the buttons work again.
      setSkipping(false)
    }
    // On success the page is being replaced; the buttons stay disabled.
  }

  /* Somebody who already has money has nothing to add and goes straight to
     "Try Poppin", from behind the spinner rather than past a screen that
     flashes. */
  useEffect(() => {
    if (landed !== null || trying !== null) return
    if (held === null) {
      if (tokensUnreadable) setShowWithoutStart(true)
      return
    }
    if (start === null) {
      setStart(held)
      if (held >= ALREADY_FUNDED_USDC) {
        track("already_funded")
        setTrying("already")
      } else {
        track("shown")
      }
      return
    }
    if (held - start > ARRIVAL_EPSILON) {
      setLanded(held - start)
      track("landed")
      // The chips on open tabs learn now rather than on the watcher's next beat.
      try {
        void chrome.runtime.sendMessage({ type: "BOOK_CHANGED_NOW" })
      } catch {
        // Nothing listening is fine; the chips catch up on their own.
      }
    }
  }, [held, tokensUnreadable, landed, start, trying])

  const waiting = landed === null && trying === null

  const fallback = String(
    (walletInfo as { depositAddress?: unknown } | undefined)?.depositAddress ??
      (walletInfo as { wallet?: { public_key?: unknown } } | undefined)?.wallet?.public_key ??
      "",
  )
  const view = depositCardView(deposit ?? null, fallback)
  const places = depositPlaces(view.arcAddress, view.others)
  const place = places.find((p) => p.network === network) ?? places[0] ?? null
  const addressMissing = !view.arcAddress
  useEffect(() => {
    if (!addressMissing) return
    const t = window.setTimeout(() => setSlowAddress(true), 8_000)
    return () => window.clearTimeout(t)
  }, [addressMissing])

  /* One beat for everything this screen waits on: the balance, and the
     address itself while neither route has produced it yet. */
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["wallet", "tokens"] })
      if (addressMissing) {
        void queryClient.invalidateQueries({ queryKey: ["arc", "deposit-addresses"] })
        void queryClient.invalidateQueries({ queryKey: ["wallet", "me"] })
      }
    }, WATCH_MS)
    return () => window.clearInterval(timer)
  }, [waiting, addressMissing])

  const copy = (key: string, address: string) => {
    void navigator.clipboard.writeText(address)
    track(`copied_${key.toLowerCase()}`)
    setCopied(key)
    window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800)
  }

  const openPanel = () => {
    if (tabId === null) return
    track("open_panel")
    try {
      chrome.sidePanel.open({ tabId }).catch(() => {
        // Refused outside a gesture: the toolbar icon opens it just the same.
      })
    } catch {
      // No side panel API: same answer.
    }
  }

  /* Until the first balance read there is nothing honest to show: an
     "Add money" screen that vanishes a moment later for a funded reader
     would be a flicker, not a step. A slow or failed read shows the
     screen after FIRST_READ_WAIT_MS all the same. */
  if (start === null && !showWithoutStart && landed === null && trying === null) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress size={26} sx={{ color: ACCENT }} />
      </Box>
    )
  }

  if (landed !== null || trying !== null) {
    return (
      <StepFrame
        // The ghost pops into view: the adventure starts here (Lev, 2026-09-29).
        mark={<GhostMark src={appearGif} />}
        title="Your first pop awaits."
        subtitle={
          landed !== null ? (
            <>
              <Box component="span" sx={{ color: "#4ADE80", fontWeight: 600 }}>
                {`\u2713 ${money(landed)} added.`}
              </Box>{" "}
              Pick where to start.
            </>
          ) : (
            "Pick where to start."
          )
        }
        actions={
          tabId !== null ? (
            <Button onClick={openPanel} sx={SECONDARY_SX}>
              Open Poppin
            </Button>
          ) : undefined
        }
      >
        <Box sx={{ display: "grid", gap: 1.25 }}>
          {ARC_TRY_PLACES.map((place) => (
            <Box
              key={place.id}
              component="button"
              type="button"
              disabled={skipping}
              onClick={() => {
                track(`try_${place.id}`)
                void leave(place.url)
              }}
              sx={ROW_SX}
            >
              <PlaceIcon id={place.id} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontFamily: FONT, fontSize: 14.5, fontWeight: 600, color: "#EAF2FB" }}>
                  {place.where}
                </Typography>
                <Typography
                  sx={{ fontFamily: FONT, fontSize: 12.5, color: "#8CA3BD", mt: 0.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {place.what}
                </Typography>
              </Box>
              <Box component="span" sx={{ color: "#74849A", fontSize: 20 }}>
                {"\u203A"}
              </Box>
            </Box>
          ))}
        </Box>
      </StepFrame>
    )
  }

  return (
    <StepFrame
      title="Add money"
      // Where the money comes from, before the address: measured 2026-09-29,
      // every reader who saw "Add money" expected a card, and called the USDC
      // address that followed a bait-and-switch. A card door arrives with
      // App Kit Onramp; until then this line says what works today.
      subtitle="From an exchange or another wallet. It lands in seconds."
      actions={
        <QuietAction
          label="Look around first"
          disabled={skipping}
          onClick={() => {
            track("skipped")
            setTrying("skipped")
          }}
        />
      }
    >
      {place ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <AmountPicker value={amount} onChange={setAmount} font={FONT} />
          {places.length > 1 && (
            <NetworkSelect
              places={places}
              value={place.network}
              onChange={(n) => {
                if (n !== place.network) track(`network_${n.toLowerCase()}`)
                setNetwork(n)
              }}
              font={FONT}
            />
          )}
          <Box sx={CARD_SX}>
            {/* A plain code: the mark in the middle did not look good (Lev, 2026-09-29). */}
            <QrCode value={place.address} size={132} />
            <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: "#EAF2FB", lineHeight: 1.4 }}>
                {`Send ${amount} USDC on ${place.network} to this address.`}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 14, color: "#EAF2FB", letterSpacing: ".01em", wordBreak: "break-all" }}>
                {groupedAddress(place.address)}
              </Typography>
              {place.network !== "Arc" && (
                <Typography sx={{ fontFamily: FONT, fontSize: 12.5, color: "#8CA3BD", lineHeight: 1.45 }}>
                  {place.minUsdc
                    ? `From ${place.minUsdc} USDC. It moves to your balance on its own.`
                    : "It moves to your balance on its own."}
                </Typography>
              )}
              <Button
                onClick={() => copy(place.network, place.address)}
                sx={{
                  mt: 0.5,
                  height: 36,
                  px: 2,
                  borderRadius: "10px",
                  fontFamily: FONT,
                  fontSize: 13.5,
                  fontWeight: 600,
                  textTransform: "none",
                  color: "#06202E",
                  backgroundColor: copied === place.network ? "#4ADE80" : ACCENT,
                  "&:hover": { backgroundColor: copied === place.network ? "#4ADE80" : "#8AD4FF" },
                }}
              >
                {copied === place.network ? "Copied" : "Copy address"}
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: ACCENT,
                boxShadow: "0 0 0 5px rgba(104,198,255,.14)",
                animation: "arc-watch 1.8s ease-in-out infinite",
                "@keyframes arc-watch": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.45 } },
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            />
            <Typography sx={{ fontFamily: FONT, fontSize: 14, color: "rgba(255,255,255,.7)" }}>
              We'll let you know when it arrives.
            </Typography>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, py: 4 }}>
          <CircularProgress size={22} sx={{ color: ACCENT }} />
          {slowAddress && (
            <Typography sx={{ fontFamily: FONT, fontSize: 13.5, color: "rgba(255,255,255,.6)" }}>
              Setting up your address. One moment.
            </Typography>
          )}
        </Box>
      )}
    </StepFrame>
  )
}

/** X's mark from its official path; CNBC's and Reddit's own favicons (assets/tryPlaceIcons). */
function PlaceIcon({ id }: { id: TryPlace["id"] }) {
  if (id === "x") {
    return (
      <Box
        aria-hidden="true"
        sx={{
          width: 36,
          height: 36,
          borderRadius: "10px",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          backgroundColor: "#000",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.14)",
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="#FFFFFF">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </Box>
    )
  }
  return (
    <Box
      component="img"
      src={id === "news" ? CNBC_ICON_URI : REDDIT_ICON_URI}
      alt=""
      sx={{ width: 36, height: 36, borderRadius: id === "news" ? "10px" : 0, flexShrink: 0, display: "block" }}
    />
  )
}

const CARD_SX = {
  width: "100%",
  boxSizing: "border-box",
  p: 2,
  borderRadius: "18px",
  display: "flex",
  alignItems: "center",
  gap: 2.25,
  textAlign: "left",
  backgroundColor: "rgba(255,255,255,.04)",
  boxShadow: "inset 0 0 0 1px rgba(122,201,255,.16)",
} as const

const ROW_SX = {
  width: "100%",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 1.75,
  px: 2,
  py: 1.75,
  borderRadius: "16px",
  border: 0,
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  color: "#EAF2FB",
  backgroundColor: "rgba(255,255,255,.03)",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,.07)",
  "&:hover": { backgroundColor: "rgba(255,255,255,.06)" },
  "&:disabled": { opacity: 0.6, cursor: "default" },
} as const

const PRIMARY_SX = {
  width: "100%",
  py: 1.75,
  borderRadius: "16px",
  fontFamily: FONT,
  fontSize: 17,
  fontWeight: 700,
  textTransform: "none",
  color: "#06202E",
  backgroundColor: ACCENT,
  boxShadow: "0 6px 30px rgba(104,198,255,.25)",
  "&:hover": { backgroundColor: "#8AD4FF" },
  "&.Mui-disabled": { backgroundColor: "rgba(104,198,255,.35)", color: "#06202E" },
} as const

const SECONDARY_SX = {
  width: "100%",
  py: 1.5,
  borderRadius: "16px",
  fontFamily: FONT,
  fontSize: 15,
  fontWeight: 600,
  textTransform: "none",
  color: "rgba(255,255,255,.85)",
  backgroundColor: "rgba(255,255,255,.05)",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,.10)",
  "&:hover": { backgroundColor: "rgba(255,255,255,.09)" },
} as const
