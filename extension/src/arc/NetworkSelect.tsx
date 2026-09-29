import CheckIcon from "@mui/icons-material/Check"
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
 *
 * THE MENU IS NAMES ONLY. A line under every network ("From 1 USDC, moved to
 * your balance for you", five times over) ran past the menu's edge and read
 * as a wall of text (Lev, 2026-09-29: "yazılar düzgün değil"). What a network
 * means for the money is said once, under the address, for the one chosen.
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

/** "Send 25 USDC on Solana", or "Send at least 5 USDC on Solana" while the amount is under what gets moved. */
export function sendLine(p: DepositPlace, amount: number | undefined): string {
  const min = Number(p.minUsdc ?? 0)
  if (min > 0 && (!amount || amount < min)) return `Send at least ${p.minUsdc} USDC on ${p.network}`
  return amount ? `Send ${amount} USDC on ${p.network}` : `Send USDC on ${p.network}`
}

/** What happens once it lands: Arc is the balance, and any other network is moved there. */
export function landingLine(p: DepositPlace): string {
  return p.network === "Arc" ? "It's ready the moment it lands." : "We'll move it to your balance."
}

/** The sentence under the panel's address. */
export function placeInstruction(p: DepositPlace, amount: number | undefined): string {
  return `${sendLine(p, amount)}. ${landingLine(p)}`
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
  const name = { fontFamily: font, fontSize: 14.5, fontWeight: 600, color: "#EAF2FB", lineHeight: 1.35 } as const
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
          py: 1,
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
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontFamily: font, fontSize: 11.5, color: "#8CA3BD", lineHeight: 1.3 }}>Network</Typography>
          <Typography noWrap sx={name}>
            {selected.network}
          </Typography>
        </Box>
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
        {places.map((p) => {
          const on = p.network === selected.network
          return (
            <MenuItem
              key={p.network}
              role="option"
              aria-selected={on}
              selected={on}
              onClick={() => {
                onChange(p.network)
                setAnchor(null)
              }}
              sx={{
                gap: 1.25,
                minHeight: 44,
                py: 0.75,
                mx: 0.5,
                borderRadius: "10px",
                "&.Mui-selected": { backgroundColor: "rgba(104,198,255,.10)" },
                "&.Mui-selected:hover": { backgroundColor: "rgba(104,198,255,.16)" },
                "&:hover": { backgroundColor: "rgba(255,255,255,.06)" },
              }}
            >
              <NetIcon network={p.network} size={26} />
              <Typography noWrap sx={{ ...name, flex: 1, minWidth: 0, fontWeight: on ? 600 : 500 }}>
                {p.network}
              </Typography>
              {on && <CheckIcon aria-hidden="true" sx={{ fontSize: 18, color: "#68C6FF" }} />}
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
