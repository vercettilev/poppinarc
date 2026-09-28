import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import { alpha, Box, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { callersBoard, type CallerRow } from "~/services/SpotAssetService"
import { ACCENT, DIM, PANEL_CARD, PANEL_PILL } from "~/helpers/panelSurface"
import { compactUsd } from "~/helpers/tradeCard"
import { JUICE } from "~/theme/juice"

/**
 * THE CALLERS — who drove the most trading, ranked from the ledger.
 *
 * The flywheel's thesis, made a screen: the chip wins the ENTRY, and the
 * entry is somebody's call. This ranks the people whose tweets moved the
 * most money through Poppin — distinct buyers and dollar volume, counted
 * from spot_trades.source_url, so it cannot be faked by a claim. A caller
 * who signed up wears their Poppin face; one who never did is still ranked
 * by their handle, because the board is about the CALL.
 *
 * Deliberately NOT PnL-weighted yet, and measured rather than assumed: on
 * 2026-09-03 the ledger held 21 trades from one trader, one of them
 * carrying a tweet. A profit ranking over that ranks a single row. This is
 * the honest influence board — who drives the action — and the link a
 * profit ranking will need (which call each sell closes) is now recorded
 * on the sell itself, because that one cannot be backfilled later.
 */
const MEDALS = ["🥇", "🥈", "🥉"]

export default function Callers() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<"week" | "all">("week")
  const [rows, setRows] = useState<CallerRow[] | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    let alive = true
    setState("loading")
    callersBoard(period, 20)
      .then((r) => {
        if (!alive) return
        setRows(Array.isArray(r?.callers) ? r.callers : [])
        setState("ready")
      })
      .catch(() => alive && setState("error"))
    return () => {
      alive = false
    }
  }, [period])

  return (
    <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: "auto", boxSizing: "border-box" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.5 }}>
        <Box
          component="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          aria-label="Back"
          className="click-animation"
          sx={{
            ...PANEL_PILL, width: 32, height: 32, display: "grid", placeItems: "center",
            cursor: "pointer", color: "#FFFFFF", p: 0, flexShrink: 0,
            "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
        </Box>
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>Top callers</Typography>
      </Box>

      <Typography sx={{ fontSize: 12, color: DIM, mb: 1.5 }}>
        Whose calls moved the most money through Poppin, counted from the trades
        themselves.
      </Typography>

      <Box sx={{ display: "flex", gap: 0.5, mb: 1.5 }}>
        {(["week", "all"] as const).map((p) => (
          <Box
            key={p}
            component="button"
            onClick={() => setPeriod(p)}
            className="click-animation"
            sx={{
              ...PANEL_PILL, px: 1.5, py: "5px", cursor: "pointer", font: "inherit",
              fontSize: 11.5, fontWeight: 700,
              color: period === p ? JUICE.onAccent : DIM,
              backgroundColor: period === p ? ACCENT : "rgba(255,255,255,.06)",
            }}
          >
            {p === "week" ? "This week" : "All time"}
          </Box>
        ))}
      </Box>

      {state === "loading" && (
        <Typography sx={{ fontSize: 13, color: DIM }}>Loading…</Typography>
      )}
      {state === "error" && (
        <Typography sx={{ fontSize: 13, color: DIM }}>
          Couldn&apos;t load the board. Try again in a moment.
        </Typography>
      )}
      {state === "ready" && rows && rows.length === 0 && (
        <Typography sx={{ fontSize: 13, color: DIM }}>
          No calls have driven three or more buyers yet. The board fills as
          people trade from tweets.
        </Typography>
      )}

      {state === "ready" &&
        rows &&
        rows.map((c, i) => (
          <Box
            key={c.handle}
            onClick={() =>
              window.open(`https://x.com/${c.handle}`, "_blank", "noopener")
            }
            className="click-animation"
            sx={{
              ...PANEL_CARD,
              p: 1.5,
              mb: 1,
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              cursor: "pointer",
            }}
          >
            <Box
              sx={{
                width: 28, flexShrink: 0, textAlign: "center", fontSize: i < 3 ? 18 : 13,
                fontWeight: 700, color: i < 3 ? "#FFFFFF" : DIM,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {i < 3 ? MEDALS[i] : i + 1}
            </Box>
            {c.avatarUrl ? (
              <Box component="img" src={c.avatarUrl} alt="" sx={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0 }} />
            ) : (
              <Box sx={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", backgroundColor: "rgba(255,255,255,.08)", fontSize: 13, fontWeight: 700 }}>
                {c.handle.charAt(0).toUpperCase()}
              </Box>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                @{c.handle}
                {c.onPoppin && (
                  <Box component="span" sx={{ ml: 0.75, fontSize: 10.5, fontWeight: 700, color: ACCENT }}>
                    on Poppin
                  </Box>
                )}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: DIM, fontVariantNumeric: "tabular-nums" }}>
                {c.buyers.toLocaleString("en-US")} {c.buyers === 1 ? "buyer" : "buyers"} · {compactUsd(c.volumeUsd)} driven
              </Typography>
            </Box>
          </Box>
        ))}
    </Box>
  )
}
