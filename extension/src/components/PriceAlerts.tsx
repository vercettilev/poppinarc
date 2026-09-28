import { JUICE } from "~/theme/juice"
import { alpha, Box, Typography } from "@mui/material"
import { useCallback, useEffect, useState } from "react"
import { decimalsFor } from "~/helpers/tradeSheetModel"
import { PRICE_ALERTS_KEY, type PriceAlert } from "~/helpers/priceAlerts"

const AMBER = JUICE.amber

/**
 * The reader's parked alerts, as rows they can clear.
 *
 * Same placement logic as the orders list one block above: this is the
 * reader's own profile, the one place they go looking for what is theirs.
 * Silent when empty — the orders section already carries the "set one with
 * Limit order" invitation, and two invitations in a column is a brochure.
 *
 * Deleting is local and instant: an alert is a parked number in extension
 * storage, not an escrow on a chain. Nothing to confirm, nothing to wait
 * for, no way to lose money by fat-fingering it.
 */
export function PriceAlerts({ mint }: { mint?: string } = {}) {
  const [all, setAll] = useState<PriceAlert[]>([])
  /**
   * Narrowed for the token room: an alert parked on WIF belongs in WIF's
   * own room too, not only on the profile. Same rows, same removal, one
   * component - the two surfaces cannot drift.
   */
  const alerts = mint ? all.filter((a) => a.mint === mint) : all

  const load = useCallback(() => {
    if (!chrome?.storage?.local) return
    void chrome.storage.local.get(PRICE_ALERTS_KEY).then((stored) => {
      setAll(stored?.[PRICE_ALERTS_KEY] ?? [])
    })
  }, [])

  useEffect(() => {
    load()
    if (!chrome?.storage?.onChanged) return
    // The background clears fired alerts on its own clock; the list keeps up.
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[PRICE_ALERTS_KEY]) load()
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [load])

  const remove = useCallback((id: string) => {
    if (!chrome?.storage?.local) return
    void chrome.storage.local.get(PRICE_ALERTS_KEY).then((stored) => {
      const all: PriceAlert[] = stored?.[PRICE_ALERTS_KEY] ?? []
      const kept = all.filter((a) => a.id !== id)
      void chrome.storage.local.set({ [PRICE_ALERTS_KEY]: kept })
      setAll(kept)
    })
  }, [])

  if (alerts.length === 0) return null

  return (
    <Box sx={{ mx: 2, mt: 1.5 }}>
      <Typography
        sx={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: JUICE.text3,
          mb: 0.75,
        }}
      >
        Price alerts
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {alerts.map((a) => (
          <Box
            key={a.id}
            data-price-alert
            sx={{ display: "flex", alignItems: "center", gap: 1 }}
          >
            <Typography
              component="span"
              sx={{
                fontSize: 12.5,
                fontWeight: 700,
                color: AMBER,
                backgroundColor: alpha(AMBER, 0.1),
                borderRadius: "999px",
                px: 0.9,
                py: "1px",
              }}
            >
              🔔
            </Typography>
            <Typography
              sx={{
                fontSize: 12.5,
                fontWeight: 600,
                color: JUICE.text2,
                fontVariantNumeric: "tabular-nums",
                minWidth: 0,
                flex: 1,
              }}
            >
              {a.symbol ? `$${a.symbol.replace(/^\$/, "")}` : a.mint.slice(0, 4)}{" "}
              {a.direction === "above" ? "reaches" : "drops to"} $
              {a.targetUsd.toLocaleString("en-US", {
                maximumFractionDigits: decimalsFor(a.targetUsd),
              })}
            </Typography>
            <Box
              component="button"
              onClick={() => remove(a.id)}
              sx={{
                border: 0,
                background: "none",
                cursor: "pointer",
                font: "inherit",
                fontSize: 11.5,
                fontWeight: 600,
                color: JUICE.text3,
                "&:hover": { color: "#ff6b61" },
              }}
            >
              Remove
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
