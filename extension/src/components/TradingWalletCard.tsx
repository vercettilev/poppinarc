import { Box, Paper, Typography } from "@mui/material"
import { alpha } from "@mui/material/styles"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { sendApiRequest } from "~/lib/fetchService"
import { JUICE } from "~/theme/juice"

/**
 * WHOSE WALLET TRADES, chosen in Settings.
 *
 * An account opened with Google trades from the embedded wallet; one
 * opened with Phantom from that wallet. This card lets either kind
 * change its mind: a Google account that linked a wallet (on
 * app.poppin.so/fund, with a signed sentence) can trade from it, and any
 * account can come back to the embedded wallet. The rule is the one
 * Privy and Dynamic apply: one account, several wallets, one of them
 * active; money never moves on its own when the choice changes.
 */
interface Linked {
  address: string
  label: string | null
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`
const PANEL_TEXT = "#FFFFFF"

export function TradingWalletCard() {
  const { data: me } = useCurrentUser()
  const queryClient = useQueryClient()
  const [linked, setLinked] = useState<Linked[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const external = me?.wallet_mode === "external" && !!me.external_address

  const load = useCallback(() => {
    sendApiRequest<{ wallets: Linked[] }>({ url: "/wallets/linked", method: "GET" })
      .then((r) => setLinked(r?.wallets ?? []))
      .catch(() => setLinked([]))
  }, [])
  useEffect(load, [load])

  const choose = async (address: string | null) => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const r = await sendApiRequest<{ wallet_mode: string; external_address: string | null }>({
        url: "/wallets/linked/trading",
        method: "POST",
        data: { address },
      })
      queryClient.setQueryData(["current-user"], (old: any) =>
        old ? { ...old, wallet_mode: r.wallet_mode, external_address: r.external_address } : old,
      )
      void queryClient.invalidateQueries({ queryKey: ["current-user"] })
      // Every chip on every page reads the account again on its next press.
      try {
        void chrome.runtime.sendMessage({ type: "BOOK_CHANGED_NOW" })
      } catch {
        // no extension context
      }
    } catch (e) {
      const m = (e as { message?: string })?.message
      setNote(typeof m === "string" && m.length < 140 ? m : "Could not change the trading wallet.")
    } finally {
      setBusy(false)
    }
  }

  const rowSx = {
    display: "flex",
    alignItems: "center",
    gap: 1,
    py: 0.75,
  } as const
  const btnSx = {
    flexShrink: 0,
    border: `1px solid ${alpha(PANEL_TEXT, 0.16)}`,
    background: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 700,
    px: 1.25,
    py: "5px",
    borderRadius: "999px",
    color: PANEL_TEXT,
    opacity: busy ? 0.5 : 1,
  } as const

  /**
   * The account's own wallet: the Phantom it signed in with, or the linked
   * one it switched to. It stays on the card in either mode (the backend
   * keeps a wallet account's address when it moves to the Poppin wallet),
   * so switching is never a one-way door.
   */
  const own = me?.external_address ?? null
  const others = (linked ?? []).filter((w) => w.address !== own)
  const current = (
    <Typography sx={{ fontSize: 12, color: alpha(PANEL_TEXT, 0.55), flexShrink: 0 }}>
      Trading from this
    </Typography>
  )

  return (
    <Paper
      sx={{
        background: JUICE.well,
        color: PANEL_TEXT,
        borderRadius: "12px",
        border: `1px solid ${JUICE.border}`,
        p: "10px",
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Trading wallet</Typography>
      <Typography sx={{ fontSize: 12, color: alpha(PANEL_TEXT, 0.7) }}>
        {external
          ? `Trades sign in Phantom on ${short(String(me?.external_address))}. Fees are yours.`
          : "Trades come from your Poppin wallet. Network fees are on us."}
      </Typography>
      <Box sx={{ mt: 1, display: "grid", gap: 0.25 }}>
        <Box sx={rowSx}>
          <Typography sx={{ fontSize: 12.5, flex: 1 }}>Poppin wallet</Typography>
          {external ? (
            <Box component="button" onClick={() => void choose(null)} disabled={busy} sx={btnSx}>
              Trade from this
            </Box>
          ) : (
            current
          )}
        </Box>
        {own && (
          <Box sx={rowSx}>
            <Typography sx={{ fontSize: 12.5, flex: 1, fontFamily: JUICE.mono }}>
              Phantom · {short(own)}
            </Typography>
            {external ? (
              current
            ) : (
              <Box component="button" onClick={() => void choose(own)} disabled={busy} sx={btnSx}>
                Trade from this
              </Box>
            )}
          </Box>
        )}
        {others.map((w) => (
          <Box key={w.address} sx={rowSx}>
            <Typography sx={{ fontSize: 12.5, flex: 1, fontFamily: JUICE.mono }}>
              {w.label || short(w.address)}
            </Typography>
            <Box component="button" onClick={() => void choose(w.address)} disabled={busy} sx={btnSx}>
              Trade from this
            </Box>
          </Box>
        ))}
        <Box sx={rowSx}>
          <Typography sx={{ fontSize: 12.5, flex: 1, color: alpha(PANEL_TEXT, 0.7) }}>
            {linked && linked.length === 0 && !own
              ? "No wallet linked yet."
              : "Another wallet"}
          </Typography>
          <Box
            component="button"
            onClick={() => chrome.tabs.create({ url: "https://app.poppin.so/fund" })}
            sx={btnSx}
          >
            Connect Phantom ›
          </Box>
        </Box>
      </Box>
      {note && (
        <Typography sx={{ fontSize: 12, color: JUICE.red, mt: 0.75 }}>{note}</Typography>
      )}
    </Paper>
  )
}
