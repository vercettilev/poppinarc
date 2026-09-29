import { Box, Menu, MenuItem, Typography } from "@mui/material"
import { useState } from "react"
import { NETWORK_ICONS } from "~/assets/networkIcons"
import type { DepositNetworkAddress } from "./depositAddresses"

/**
 * WHICH NETWORK THE READER SENDS ON, as a menu with each network's own icon,
 * Arc first and chosen by default (Lev, 2026-09-29).
 *
 * Arc is the balance itself. Every other network is a wallet of the reader's
 * that arc-api moves to Arc with CCTP, so money sent on any of them ends in
 * the one balance with no bridge for the reader to run.
 */
export interface DepositPlace {
  network: string
  address: string
  /** The smallest amount moved to Arc from this network, as a person reads it. */
  minUsdc?: string
}

/** Arc first, then the other networks in the server's order. */
export function depositPlaces(arcAddress: string, others: DepositNetworkAddress[]): DepositPlace[] {
  return arcAddress ? [{ network: "Arc", address: arcAddress }, ...others] : []
}

/** One short line under a network's name. */
export function placeHint(p: DepositPlace): string {
  if (p.network === "Arc") return "Straight to your balance"
  return p.minUsdc ? `From ${p.minUsdc} USDC, moved to your balance for you` : "Moved to your balance for you"
}

/** The sentence under the address: how much, on which network, and what happens next. */
export function placeInstruction(p: DepositPlace, amount: number | undefined): string {
  const send = amount ? `Send ${amount} USDC on ${p.network}` : `Send USDC on ${p.network}`
  if (p.network === "Arc") return `${send}. It's ready the moment it lands.`
  return p.minUsdc
    ? `${send}. From ${p.minUsdc} USDC, it moves to your balance on its own.`
    : `${send}. It moves to your balance on its own.`
}

function NetIcon({ network, size = 28 }: { network: string; size?: number }) {
  const src = NETWORK_ICONS[network]
  return src ? (
    <Box component="img" src={src} alt="" sx={{ width: size, height: size, borderRadius: "8px", display: "block", flexShrink: 0 }} />
  ) : (
    <Box
      aria-hidden="true"
      sx={{
        width: size,
        height: size,
        borderRadius: "8px",
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 700,
        color: "#CDEAFF",
        backgroundColor: "rgba(104,198,255,.14)",
      }}
    >
      {network.charAt(0)}
    </Box>
  )
}

export function NetworkSelect({
  places,
  value,
  onChange,
  font = "inherit",
}: {
  places: DepositPlace[]
  value: string
  onChange: (network: string) => void
  font?: string
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const selected = places.find((p) => p.network === value) ?? places[0]
  if (!selected) return null
  const line = (p: DepositPlace) => (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontFamily: font, fontSize: 14.5, fontWeight: 600, color: "#EAF2FB", lineHeight: 1.3 }}>{p.network}</Typography>
      <Typography sx={{ fontFamily: font, fontSize: 12, color: "#8CA3BD", lineHeight: 1.35 }}>{placeHint(p)}</Typography>
    </Box>
  )
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={Boolean(anchor)}
        aria-label={`Network: ${selected.network}`}
        onClick={(e) => setAnchor(e.currentTarget as HTMLElement)}
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 1.5,
          py: 1.1,
          border: 0,
          borderRadius: "14px",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
          backgroundColor: "rgba(255,255,255,.05)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.10)",
          "&:hover": { backgroundColor: "rgba(255,255,255,.08)" },
        }}
      >
        <NetIcon network={selected.network} />
        {line(selected)}
        <Box
          component="svg"
          viewBox="0 0 10 6"
          aria-hidden="true"
          sx={{ width: 12, height: 8, color: "#8CA3BD", transform: anchor ? "rotate(180deg)" : "none", transition: "transform .15s ease-out" }}
        >
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </Box>
      </Box>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        MenuListProps={{ role: "listbox", sx: { py: 0.5 } }}
        PaperProps={{
          sx: {
            mt: 0.75,
            width: anchor?.clientWidth,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: "14px",
            color: "#EAF2FB",
            backgroundColor: "#131B28",
            backgroundImage: "none",
            boxShadow: "0 18px 40px -12px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.10)",
          },
        }}
      >
        {places.map((p) => (
          <MenuItem
            key={p.network}
            role="option"
            aria-selected={p.network === selected.network}
            selected={p.network === selected.network}
            onClick={() => {
              onChange(p.network)
              setAnchor(null)
            }}
            sx={{
              gap: 1.25,
              py: 1,
              mx: 0.5,
              borderRadius: "10px",
              "&.Mui-selected": { backgroundColor: "rgba(104,198,255,.12)" },
              "&.Mui-selected:hover": { backgroundColor: "rgba(104,198,255,.18)" },
              "&:hover": { backgroundColor: "rgba(255,255,255,.06)" },
            }}
          >
            <NetIcon network={p.network} />
            {line(p)}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
