import { JUICE } from "~/theme/juice"
import { Box, Typography } from "@mui/material"
import { useCallback, useEffect, useState } from "react"
import { sendApiRequest } from "~/lib/fetchService"
import { ACCENT, DIM, FAINT } from "~/helpers/panelSurface"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"
import { qtyText } from "~/helpers/qtyText"

/**
 * WALLETS THE READER OWNS BUT POPPIN DOES NOT.
 *
 * They connected one on app.poppin.so and signed a sentence proving it is
 * theirs; this shows it back to them. READ ONLY, and the copy says so —
 * nothing here can move anything, and there is no button that pretends
 * otherwise.
 *
 * Absent by default: a reader with no linked wallet gets no empty state, no
 * pitch and no row. Watch mode is for people who went looking for it, and a
 * section that exists only to advertise itself is what the funding rows are
 * for.
 */

interface LinkedWallet {
  address: string
  chain: string
  label: string | null
  linkedAt: number
  usd: number
  /** Catalog-recognised holdings, biggest first, capped server-side. */
  assets?: Array<{
    mint: string
    ticker: string
    uiAmount: number
    valueUsd: number | null
  }>
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

export function LinkedWallets() {
  const [wallets, setWallets] = useState<LinkedWallet[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    sendApiRequest<{ wallets: LinkedWallet[] }>({
      url: "/wallets/linked",
      method: "GET",
    })
      .then((r) => setWallets(r?.wallets ?? []))
      // A watch list that will not load is not worth a row of apology on a
      // screen whose job is the reader's own money.
      .catch(() => setWallets([]))
  }, [])

  useEffect(load, [load])

  const unlink = useCallback(
    async (address: string) => {
      setBusy(address)
      try {
        await sendApiRequest({
          url: `/wallets/linked/${encodeURIComponent(address)}`,
          method: "DELETE",
        })
        setWallets((w) => (w ?? []).filter((x) => x.address !== address))
      } catch {
        // Left in place; pressing again is the retry.
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  if (!wallets || wallets.length === 0) return null

  return (
    <Box sx={{ px: 2, mt: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 1 }}>
        <Typography
          sx={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: DIM }}
        >
          LINKED WALLETS
        </Typography>
        <Typography sx={{ fontSize: 11, color: FAINT }}>
          read only, not spendable here
        </Typography>
      </Box>

      {wallets.map((w) => (
        <Box
          key={w.address}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            py: 1.25,
            px: 1.5,
            mb: 1,
            borderRadius: "14px",
            backgroundColor: JUICE.well,
            border: `1px solid ${JUICE.border}`,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {w.label || short(w.address)}
            </Typography>
            <Typography sx={{ fontSize: 11, color: DIM }}>
              {w.usd >= 0.01 ? `$${w.usd.toFixed(2)} USDC` : "No USDC"}
            </Typography>
            {/* The rest of what it holds, named only when the catalog can
                name it. Every row is a door into that asset in THIS panel —
                the wallet stays where it is; the interest comes here. */}
            {(w.assets ?? []).map((a) => (
              <Typography
                key={a.mint}
                onClick={() =>
                  useLaunchAssetStore.getState().setLaunchMint(a.mint)
                }
                sx={{
                  fontSize: 11,
                  color: DIM,
                  cursor: "pointer",
                  "&:hover": { color: ACCENT },
                }}
              >
                {qtyText(a.uiAmount)}{" "}
                {a.ticker.replace(/^\$/, "")}
                {typeof a.valueUsd === "number" && ` · $${a.valueUsd.toFixed(2)}`}
              </Typography>
            ))}
          </Box>
          <Box
            component="button"
            onClick={() => void unlink(w.address)}
            disabled={busy === w.address}
            sx={{
              background: "none",
              border: "none",
              color: DIM,
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              p: 0,
              "&:hover": { color: ACCENT },
            }}
          >
            {busy === w.address ? "…" : "Remove"}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
