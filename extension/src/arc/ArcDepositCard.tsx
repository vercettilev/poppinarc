import CheckIcon from "@mui/icons-material/Check"
import ContentCopyIcon from "@mui/icons-material/ContentCopy"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { alpha, Box, CircularProgress, Typography } from "@mui/material"
import { useState } from "react"
import logo from "~/assets/logo.png"
import { QrCode } from "~/components/QrCode"
import { useToast } from "~/components/Toast/ToastProvider"
import { ACCENT, DIM, FAINT, PANEL_CARD, PANEL_PILL, PANEL_ROW } from "~/helpers/panelSurface"
import { JUICE } from "~/theme/juice"
import {
  depositCardView,
  pillAddress,
  useDepositAddresses,
  type DepositNetworkAddress,
} from "./depositAddresses"

/**
 * THE ARC EDITION'S DEPOSIT CARD, in the store card's order: the QR, the
 * address as a pill that copies, the token and the network, then the other
 * networks one tap away.
 *
 * ARC FIRST. It is the wallet itself, so USDC sent there is spendable the
 * moment it lands. The other networks are Circle wallets of the same person
 * that arc-api sweeps to Arc, which makes them a real route for somebody whose
 * USDC is on an exchange that does not send on Arc, and a second choice for
 * everybody else. Folded until asked for, so the card reads as one address.
 * Each row names its floor when the server states one, and the line under the
 * rows promises the sweep only when every row has (depositCardView).
 *
 * THE QR IS THE PLAIN ADDRESS. The store's Solana Pay URI told Phantom which
 * token to preselect; an EVM wallet reading "ethereum:" would also pick a chain
 * id, and a wallet that does not know Arc would refuse the whole code. A bare
 * address scans everywhere and the card says the token and the network.
 *
 * `fallbackAddress` is the wallet address the screen already holds (from
 * /wallets/me): the card never waits on the deposit route to show the one
 * address it already knows.
 */
export function ArcDepositCard({
  fallbackAddress,
  onCopy,
}: {
  fallbackAddress: string
  onCopy?: (network: string) => void
}) {
  const { showToast } = useToast()
  const { data, isLoading } = useDepositAddresses(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const view = depositCardView(data ?? null, fallbackAddress)

  if (!view.arcAddress) {
    if (isLoading) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={22} sx={{ color: ACCENT }} />
        </Box>
      )
    }
    return (
      <Typography sx={{ fontSize: 13, color: DIM, px: 2, mt: 3, textAlign: "center" }}>
        Your wallet address could not be read. Try again in a moment.
      </Typography>
    )
  }

  const copy = (network: string, address: string) => {
    void navigator.clipboard.writeText(address)
    onCopy?.(network)
    const key = `${network}|${address}`
    setCopied(key)
    showToast(`${network} address copied`, "success")
    window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800)
  }
  const arcKey = `Arc|${view.arcAddress}`

  return (
    <Box sx={{ mx: 2, mt: 2, ...PANEL_CARD }}>
      <Box sx={{ display: "grid", placeItems: "center" }}>
        <QrCode value={view.arcAddress} size={168} mark={logo} />
      </Box>
      <Box
        component="button"
        onClick={() => copy("Arc", view.arcAddress)}
        className="click-animation"
        aria-label="Copy your Arc address"
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
          backgroundColor: copied === arcKey ? alpha("#30D158", 0.16) : JUICE.well,
          color: copied === arcKey ? "#30D158" : "rgba(255,255,255,.88)",
          cursor: "pointer",
          font: "inherit",
          transition: "background-color .16s ease-out",
          "&:hover": { backgroundColor: copied === arcKey ? alpha("#30D158", 0.16) : alpha("#FFFFFF", 0.1) },
        }}
      >
        {copied === arcKey ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
        <Typography sx={MONO_SX}>{copied === arcKey ? "Copied" : pillAddress(view.arcAddress)}</Typography>
      </Box>
      <Box sx={{ display: "flex", gap: 1, mt: 1.25 }}>
        {["USDC", "Network: Arc"].map((label) => (
          <Box
            key={label}
            sx={{ ...PANEL_PILL, flex: 1, textAlign: "center", py: "9px", fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}
          >
            {label}
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: 11.5, color: FAINT, mt: 1, textAlign: "center", lineHeight: 1.45 }}>
        Send USDC on Arc. It's ready the moment it lands.
      </Typography>

      {view.others.length > 0 && (
        <>
          <Box
            component="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="click-animation"
            sx={{
              ...PANEL_ROW,
              mt: 1.5,
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 1.1,
              color: "#FFFFFF",
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
              "&:hover": { backgroundColor: alpha("#FFFFFF", 0.06) },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>From another network</Typography>
              <Typography sx={{ fontSize: 12, color: DIM, mt: 0.25 }}>{view.othersSummary}</Typography>
            </Box>
            <ExpandMoreIcon
              sx={{ fontSize: 20, color: DIM, transform: open ? "rotate(180deg)" : "none", transition: "transform .16s ease-out" }}
            />
          </Box>
          {open && (
            <Box sx={{ display: "grid", gap: 0.75, mt: 0.75 }}>
              {view.others.map((o) => (
                <OtherNetworkRow
                  key={`${o.network}|${o.address}`}
                  row={o}
                  copied={copied === `${o.network}|${o.address}`}
                  onCopy={() => copy(o.network, o.address)}
                />
              ))}
              <Typography sx={{ fontSize: 11.5, color: FAINT, mt: 0.25, textAlign: "center", lineHeight: 1.45 }}>
                {view.othersNote}
              </Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

function OtherNetworkRow({
  row,
  copied,
  onCopy,
}: {
  row: DepositNetworkAddress
  copied: boolean
  onCopy: () => void
}) {
  return (
    <Box
      component="button"
      onClick={onCopy}
      className="click-animation"
      aria-label={`Copy your ${row.network} address`}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: "9px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,.08)",
        backgroundColor: copied ? alpha("#30D158", 0.16) : JUICE.well,
        color: copied ? "#30D158" : "#FFFFFF",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        "&:hover": { backgroundColor: copied ? alpha("#30D158", 0.16) : alpha("#FFFFFF", 0.08) },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
          {row.network}
          {row.minUsdc && (
            <Box component="span" sx={{ fontWeight: 500, color: copied ? "#30D158" : DIM }}>
              {` · from ${row.minUsdc} USDC`}
            </Box>
          )}
        </Typography>
        <Typography sx={{ ...MONO_SX, textAlign: "left", fontSize: 11.5, color: copied ? "#30D158" : DIM }}>
          {pillAddress(row.address)}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{copied ? "Copied" : "Copy"}</Typography>
      {copied ? <CheckIcon sx={{ fontSize: 15 }} /> : <ContentCopyIcon sx={{ fontSize: 15 }} />}
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
