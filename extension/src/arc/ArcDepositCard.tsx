import CheckIcon from "@mui/icons-material/Check"
import ContentCopyIcon from "@mui/icons-material/ContentCopy"
import { alpha, Box, CircularProgress, Typography } from "@mui/material"
import { useState } from "react"
import { QrCode } from "~/components/QrCode"
import { useToast } from "~/components/Toast/ToastProvider"
import { ACCENT, DIM, FAINT, PANEL_CARD } from "~/helpers/panelSurface"
import { JUICE } from "~/theme/juice"
import { ConnectWalletCard } from "./ConnectWalletCard"
import { depositCardView, pillAddress, useDepositAddresses } from "./depositAddresses"
import { depositPlaces, NetworkSelect, placeInstruction } from "./NetworkSelect"

/**
 * THE ARC EDITION'S DEPOSIT CARD: the network, its QR, its address as a pill
 * that copies, and one sentence saying how much and what happens next.
 *
 * ARC FIRST, AND CHOSEN BY DEFAULT. It is the wallet itself, so USDC sent
 * there is spendable the moment it lands. The other networks are Circle
 * wallets of the same person that arc-api moves to Arc with CCTP, which makes
 * them a real route for somebody whose USDC sits on an exchange that does not
 * send on Arc. They are one choice away in the network menu, each with its
 * own icon (Lev, 2026-09-29: "dropdown olsa ama logolarla, arc default").
 *
 * THE QR IS THE PLAIN ADDRESS, with nothing in the middle. The store's Solana
 * Pay URI told Phantom which token to preselect; an EVM wallet reading
 * "ethereum:" would also pick a chain id, and a wallet that does not know Arc
 * would refuse the whole code. A bare address scans everywhere and the card
 * says the token and the network.
 *
 * `fallbackAddress` is the wallet address the screen already holds (from
 * /wallets/me): the card never waits on the deposit route to show the one
 * address it already knows.
 */
export function ArcDepositCard({
  fallbackAddress,
  onCopy,
  amountUsd,
}: {
  fallbackAddress: string
  onCopy?: (network: string) => void
  /** The amount picked above the card (arc/AmountPicker), named in its instruction. */
  amountUsd?: number
}) {
  const { showToast } = useToast()
  const { data, isLoading } = useDepositAddresses(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [network, setNetwork] = useState("Arc")
  const view = depositCardView(data ?? null, fallbackAddress)
  const places = depositPlaces(view.arcAddress, view.others)
  const place = places.find((p) => p.network === network) ?? places[0]

  if (data?.connectWallet) {
    return (
      <Box sx={{ mx: 2, mt: 2 }}>
        <ConnectWalletCard />
      </Box>
    )
  }

  if (!place) {
    if (isLoading) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={22} sx={{ color: ACCENT }} />
        </Box>
      )
    }
    return (
      <Typography sx={{ fontSize: 13, color: DIM, px: 2, mt: 3, textAlign: "center" }}>
        Setting up your address. Try again in a moment.
      </Typography>
    )
  }

  const key = `${place.network}|${place.address}`
  const copy = () => {
    void navigator.clipboard.writeText(place.address)
    onCopy?.(place.network)
    setCopied(key)
    showToast(`${place.network} address copied`, "success")
    window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800)
  }
  const done = copied === key

  return (
    <Box sx={{ mx: 2, mt: 2, ...PANEL_CARD }}>
      {places.length > 1 && (
        <Box sx={{ mb: 1.5 }}>
          <NetworkSelect places={places} value={place.network} onChange={setNetwork} />
        </Box>
      )}
      <Box sx={{ display: "grid", placeItems: "center" }}>
        <QrCode value={place.address} size={168} />
      </Box>
      <Box
        component="button"
        onClick={copy}
        className="click-animation"
        aria-label={`Copy your ${place.network} address`}
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
          backgroundColor: done ? alpha("#30D158", 0.16) : JUICE.well,
          color: done ? "#30D158" : "rgba(255,255,255,.88)",
          cursor: "pointer",
          font: "inherit",
          transition: "background-color .16s ease-out",
          "&:hover": { backgroundColor: done ? alpha("#30D158", 0.16) : alpha("#FFFFFF", 0.1) },
        }}
      >
        {done ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
        <Typography sx={MONO_SX}>{done ? "Copied" : pillAddress(place.address)}</Typography>
      </Box>
      <Typography sx={{ fontSize: 12, color: FAINT, mt: 1.25, textAlign: "center", lineHeight: 1.5 }}>
        {placeInstruction(place, amountUsd)}
      </Typography>
    </Box>
  )
}

const MONO_SX = {
  flex: 1,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 12.5,
  letterSpacing: ".02em",
  textAlign: "center",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const
