import { Box, Typography } from "@mui/material"
import { useEffect, useRef, useState } from "react"
import { BLINK_DISC, BLINK_LOGO_URI } from "~/assets/blinkLogoDataUri"
import { RailRow } from "~/components/RailRow"
import { ACCENT, DIM } from "~/helpers/panelSurface"
import { sendApiRequest } from "~/lib/fetchService"
import { CAP } from "~/config/edition"

/**
 * DEPOSIT FROM ANOTHER CHAIN: BLINK'S SHEET, IN THE PANEL.
 *
 * The sheet is Blink's, on pay.blink.cash: USDC or USDT on Ethereum, Base,
 * Arbitrum One, Polygon or BNB (their documented source list, 2026-09-18),
 * delivered to this Poppin wallet as USDC on Solana. That is the one thing
 * Blink has that the address card above does not, so the row is named for
 * it (Lev: "blinkin tek ve en büyük avantajı o"). Their passkey deposit
 * lives inside the same sheet, so there is no second row for it.
 *
 * Whether the sheet may be framed by this extension is Blink's decision
 * per merchant (their allowlist carries our store id, which every build now
 * pins). The row asks for the embedded presentation and listens: Blink's
 * sheet talks to its parent by postMessage the moment it loads, and a frame
 * that stays silent for four seconds is a blocked one. Then the tab, and no
 * embedded attempt again for a day ON THIS VERSION: the flag used to
 * outlive the build that set it, so a fixed allowlist still went to the tab
 * for a day, and nobody could tell the two apart.
 *
 * MEASURED 2026-09-18 in the SDK (0.3.31): "embedded" is honoured only in
 * a viewport wider than 640px. The side panel is about 350px, so the SDK
 * presents Blink's sheet as an OVERLAY covering the panel: a modal in the
 * panel, dark to match it (appearance.theme). An inline card appears only
 * in a panel dragged wider than 640px; `resize` is the SDK's word that it
 * did, and the host slot opens to the reported height then. Nothing is
 * guessed from the SDK's promise, which cannot see a refused frame (it
 * never rejects), which is why the first version hung on a grey page.
 */
export const FUND_URL = "https://app.poppin.so/fund"
const BLINK_ORIGIN = "https://pay.blink.cash"
const BLINK_SOLANA_CHAIN_ID = 792703809
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const HANDSHAKE_MS = 4000
/**
 * The SDK's own threshold (MOBILE_SHEET_MAX_VIEWPORT_PX, measured in
 * 0.3.31). At or below it, "embedded" is downgraded to a full-viewport
 * overlay, so the inline card that is the only reason to embed cannot
 * happen — and the overlay's iframe is the one pay.blink.cash refuses,
 * which fills the panel with Chrome's broken-page glyph until our
 * handshake gives up four seconds later. Reported from the panel,
 * 2026-09-19. Below this width the row goes straight to the tab; above
 * it, a panel dragged wide enough for the card, the embed is attempted.
 */
const EMBED_MIN_VIEWPORT_PX = 640
const BLOCKED_KEY = "poppinBlinkEmbedBlockedAt"
const BLOCKED_TTL_MS = 24 * 60 * 60_000

export const BLINK_ROW_TITLE = "Deposit from another chain"
export const BLINK_ROW_SUB = "USDC or USDT on Ethereum, Base, Arbitrum, Polygon, BNB"

export function blinkUrl(amountUsd: number | null | undefined): string {
  const a = typeof amountUsd === "number" && amountUsd > 0 ? Math.ceil(amountUsd) : null
  return `${FUND_URL}?rail=blink${a ? `&amount=${a}` : ""}`
}

/** Whether the Blink rail is switched on in this deploy (/fund/options). */
export function useBlinkEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    // Blink funds Solana USDC; the Arc edition has its own deposit networks.
    if (!CAP.solanaRails) return
    let alive = true
    sendApiRequest<{ blink?: boolean }>({ url: "/fund/options", method: "GET" })
      .then((o) => {
        if (alive) setEnabled(!!o?.blink)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return enabled
}

function buildVersion(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return "?"
  }
}

async function embedBlockedRecently(): Promise<boolean> {
  try {
    const got = (await chrome.storage.local.get(BLOCKED_KEY)) as Record<string, unknown>
    const v = got?.[BLOCKED_KEY] as { at?: unknown; version?: unknown } | undefined
    // A bare number is the pre-1.0.321 flag: another build set it, so it does not count.
    if (!v || typeof v !== "object") return false
    return v.version === buildVersion() && typeof v.at === "number" && Date.now() - v.at < BLOCKED_TTL_MS
  } catch {
    return false
  }
}

function rememberEmbedBlocked(): void {
  try {
    void chrome.storage.local.set({ [BLOCKED_KEY]: { at: Date.now(), version: buildVersion() } })
  } catch {
    // no extension context
  }
}

/** Blink's blob on Blink's disc, the glyph their own rail uses. */
function BlinkGlyph() {
  return (
    <Box
      sx={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        backgroundColor: BLINK_DISC,
        display: "grid",
        placeItems: "center",
      }}
    >
      <Box component="img" src={BLINK_LOGO_URI} alt="" sx={{ width: 22, height: 16, display: "block" }} />
    </Box>
  )
}

type Phase = "idle" | "opening" | "open" | "done"

export function BlinkFund({
  onOpen,
  amountUsd = null,
  address = null,
  variant = "link",
}: {
  onOpen?: (mode: "embedded" | "tab") => void
  /** Dollars to arrive with: the cover amount the address screen is for. */
  amountUsd?: number | null
  /** The Poppin wallet the sheet deposits into; without it only the tab is possible. */
  address?: string | null
  /** `link`: the one-line door under a short balance. `row`: the deposit card's "OR" row, in the panel first. */
  variant?: "link" | "row"
}) {
  const enabled = useBlinkEnabled()
  const host = useRef<HTMLDivElement>(null)
  const depositRef = useRef<{ close: () => void } | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  // The SDK's `resize` event: the sheet is a card in the slot, not a modal over the panel.
  const [inline, setInline] = useState(false)
  useEffect(
    () => () => {
      try {
        depositRef.current?.close()
      } catch {
        // already gone
      }
    },
    [],
  )

  const openTab = () => {
    onOpen?.("tab")
    window.open(blinkUrl(amountUsd), "_blank", "noopener")
  }

  const open = async () => {
    const slot = host.current
    const tooNarrow = (window.visualViewport?.width ?? window.innerWidth) <= EMBED_MIN_VIEWPORT_PX
    if (variant !== "row" || !address || !slot || tooNarrow || (await embedBlockedRecently())) {
      openTab()
      return
    }
    onOpen?.("embedded")
    setPhase("opening")
    let heard = false
    const hear = (e: MessageEvent) => {
      if (e.origin === BLINK_ORIGIN) heard = true
    }
    window.addEventListener("message", hear)
    let timer: number | null = null
    try {
      const { Deposit } = await import("@swype-org/deposit")
      const deposit = new Deposit({
        presentation: "embedded",
        containerElement: slot,
        embedMaxHeightPx: 560,
        appearance: { theme: "dark" },
        /* NO SECOND ENTRY SCREEN. Blink's full widget opens on its own
           deposit page: a QR and an address for the SAME wallet our card
           is already showing, a "Minimum deposit" label that is really the
           buy's cover amount, and the other-chain flow one more tap down.
           Lev, seeing the two screens side by side: "ikisi de aynı yere
           çıkacaksa ilk ekteki yeterli". The row is named for the one job
           Blink does that our card cannot, so it goes straight to that
           job. */
        enableFullWidget: false,
        signer: async (req: { amount?: number | null }) =>
          sendApiRequest({
            url: "/fund/blink-sign",
            method: "POST",
            data: { amount: req?.amount ?? null, callbackScheme: null },
          }),
      })
      deposit.on("resize", (info) => {
        // Only an inline card reports its height; the modal never does. The
        // SDK asks for no CSS transition on this height, so it is set directly.
        setInline(true)
        slot.style.height = `${info.heightPx}px`
      })
      depositRef.current = deposit
      setPhase("open")
      timer = window.setTimeout(() => {
        if (heard) return
        // Not a word from Blink's sheet: the frame was refused. The tab it
        // is, and no embedded attempt again for a day on this version.
        try {
          deposit.close()
        } catch {
          // already gone
        }
        depositRef.current = null
        slot.replaceChildren()
        slot.style.height = ""
        setInline(false)
        rememberEmbedBlocked()
        setPhase("idle")
        openTab()
      }, HANDSHAKE_MS)
      await deposit.requestDeposit({
        amount: amountUsd && amountUsd > 0 ? amountUsd : null,
        chainId: BLINK_SOLANA_CHAIN_ID,
        address,
        token: SOLANA_USDC_MINT,
      })
      setPhase("done")
    } catch {
      // Dismissed, by the reader or by the fallback above: back to the row.
      setPhase((p) => (p === "done" ? p : "idle"))
    } finally {
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener("message", hear)
      depositRef.current = null
      setInline(false)
      slot.style.height = ""
    }
  }

  if (!enabled) return null
  if (variant === "row") {
    const busy = phase === "opening" || phase === "open"
    return (
      <Box sx={{ display: "grid", gap: 1 }}>
        {!inline && (
          <RailRow
            glyph={<BlinkGlyph />}
            title={BLINK_ROW_TITLE}
            sub={busy ? "Opening…" : phase === "done" ? "USDC on its way. Watching for it below." : BLINK_ROW_SUB}
            onClick={() => void open()}
            busy={busy}
          />
        )}
        {/* The SDK's slot. Kept in layout (visibility, not display) so a
            warming inline frame can measure itself; it opens to the height
            the SDK reports, and stays collapsed under the modal. */}
        <Box
          ref={host}
          sx={{
            visibility: inline ? "visible" : "hidden",
            height: inline ? undefined : 0,
            overflow: "hidden",
            borderRadius: "16px",
          }}
        />
      </Box>
    )
  }
  return (
    <Box sx={{ mt: 1 }}>
      <Typography
        onClick={openTab}
        sx={{ fontSize: 11, fontWeight: 700, color: ACCENT, cursor: "pointer", textAlign: "center" }}
      >
        Add USDC with any crypto →
      </Typography>
      <Typography sx={{ fontSize: 10.5, color: DIM, textAlign: "center", mt: 0.25 }}>Opens in a tab.</Typography>
    </Box>
  )
}
