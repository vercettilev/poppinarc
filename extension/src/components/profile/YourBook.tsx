import { Box, Typography } from "@mui/material"
import { useState } from "react"
import { useNavigate } from "react-router"
import { LinkedWallets } from "~/components/LinkedWallets"
import { OpenOrders } from "~/components/OpenOrders"
import { PriceAlerts } from "~/components/PriceAlerts"
import { Watchlist } from "~/components/Watchlist"
import { ACCENT, DIM, PANEL_ROW } from "~/helpers/panelSurface"

/**
 * FOUR LISTS BECOME ONE DOOR.
 *
 * Your own profile carried the portfolio and then, open, every standing
 * thing you own: orders, watchlist, price alerts, linked wallets. Four
 * headings, most of them empty on most days, standing between you and the
 * feed. Orders already have a page (/positions); the other three had no
 * home but this one, so they cannot simply go — they fold.
 *
 * Each row opens its list in place. Nothing was removed, only the default
 * view: a profile is a vitrine, and a vitrine does not open its drawers.
 */
type Drawer = "orders" | "watchlist" | "alerts" | "wallets"

const ROWS: Array<[Drawer, string]> = [
  ["orders", "Standing orders"],
  ["watchlist", "Watchlist"],
  ["alerts", "Price alerts"],
  ["wallets", "Linked wallets"],
]

export function YourBook() {
  const navigate = useNavigate()
  const [open, setOpen] = useState<Drawer | null>(null)

  return (
    <Box sx={{ mx: 2, mt: 1.5 }}>
      <Typography
        sx={{ fontSize: 11, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: DIM, mb: 1 }}
      >
        Your book
      </Typography>
      <Box sx={{ ...PANEL_ROW, px: 0, py: 0, overflow: "hidden" }}>
        <Box
          component="button"
          onClick={() => navigate("/")}
          className="click-animation"
          sx={{ ...rowSx, borderTop: "none" }}
        >
          <span>All positions</span>
          <span style={{ color: ACCENT }}>→</span>
        </Box>
        {ROWS.map(([key, label]) => (
          <Box key={key}>
            <Box
              component="button"
              onClick={() => setOpen((o) => (o === key ? null : key))}
              aria-expanded={open === key}
              className="click-animation"
              sx={rowSx}
            >
              <span>{label}</span>
              <span style={{ color: DIM }}>{open === key ? "▾" : "▸"}</span>
            </Box>
            {open === key && (
              <Box sx={{ pb: 1 }}>
                {key === "orders" && <OpenOrders showEmpty />}
                {key === "watchlist" && <Watchlist />}
                {key === "alerts" && <PriceAlerts />}
                {key === "wallets" && <LinkedWallets />}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

const rowSx = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "none",
  border: "none",
  borderTop: "1px solid rgba(122,183,255,.12)",
  color: "inherit",
  font: "inherit",
  fontSize: 13,
  fontWeight: 600,
  px: 1.5,
  py: 1.1,
  cursor: "pointer",
  textAlign: "left" as const,
  /**
   * NO :first-of-type HERE. Each drawer row is wrapped in its own Box, so
   * every button is the first of its type inside its own parent and the
   * rule matched ALL of them — the five-row group drew with no separators
   * at all. The one row that really is first says so itself, below.
   */
}
