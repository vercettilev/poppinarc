import { JUICE } from "~/theme/juice"
import { Box, Typography } from "@mui/material"
import { useCallback, useEffect, useState } from "react"
import { assetByMint } from "~/services/SpotAssetService"
import { ACCENT, DIM, GREEN, RED } from "~/helpers/panelSurface"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"
import { toggleWatch, WATCHLIST_KEY, type WatchedAsset } from "~/helpers/watchlist"

/**
 * WHAT THE READER STARRED.
 *
 * The list exists so a star is reversible somewhere other than the page that
 * set it: somebody who watched an asset in October and cannot find it again
 * has no way to stop hearing about it, and a notification you cannot turn
 * off is the one that gets the whole product muted.
 *
 * Every row is a door. Watching something and then having to go find it is
 * the same failure the trade receipts had before they became doors.
 *
 * Renders nothing when the list is empty — no pitch, no empty state. The star
 * teaches itself on the asset strip, where somebody is already looking at an
 * asset.
 */

interface Row extends WatchedAsset {
  priceUsd?: number | null
  change24hPct?: number | null
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`

export function Watchlist() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let alive = true
    void chrome.storage?.local
      ?.get(WATCHLIST_KEY)
      .then(async (s) => {
        const list: WatchedAsset[] = s?.[WATCHLIST_KEY] ?? []
        if (!alive) return
        setRows(list)
        // Prices after the list, not before it: the names are already known
        // and a reader should see their shortlist immediately.
        const priced = await Promise.all(
          list.map(async (w) => {
            try {
              const a = (await assetByMint(w.mint)).asset
              return {
                ...w,
                symbol: w.symbol ?? a?.symbol ?? null,
                priceUsd: a?.indicativeUsd ?? null,
                change24hPct: a?.change24hPct ?? null,
              }
            } catch {
              return w
            }
          }),
        )
        if (alive) setRows(priced)
      })
      .catch(() => setRows([]))
    return () => {
      alive = false
    }
  }, [])

  const remove = useCallback((mint: string, symbol: string | null) => {
    setRows((cur) => {
      const next = toggleWatch(cur ?? [], { mint, symbol }, Date.now())
      void chrome.storage?.local?.set({
        [WATCHLIST_KEY]: next.map(({ mint, symbol, at }) => ({ mint, symbol, at })),
      })
      return next as Row[]
    })
  }, [])

  if (!rows || rows.length === 0) return null

  return (
    <Box sx={{ px: 2, mt: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 1 }}>
        <Typography
          sx={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: DIM }}
        >
          WATCHLIST
        </Typography>
        <Typography sx={{ fontSize: 11, color: DIM }}>
          moves reach you like a holding would
        </Typography>
      </Box>

      {rows.map((w) => (
        <Box
          key={w.mint}
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
          <Box
            component="button"
            onClick={() => {
              // Into this panel, on that asset — the same hand-off a
              // notification tap makes. No sheet: they came to look.
              useLaunchAssetStore.getState().setLaunchMint(w.mint)
            }}
            sx={{
              flex: 1,
              minWidth: 0,
              textAlign: "left",
              background: "none",
              border: "none",
              p: 0,
              cursor: "pointer",
              font: "inherit",
              color: "#FFFFFF",
            }}
          >
            {/* THE NAME COLUMN ELLIPSIZES; IT DOES NOT PUSH.
                `minWidth: 0` above lets this column shrink, but a symbol
                comes off the API with no length bound and neither line
                declared an overflow — so the text ran out of its own box
                and under the percentage beside it, and "Price unavailable"
                (94.5px) wrapped to a second line and made one row taller
                than its neighbours. The budget at the 320px floor: the
                panel less the theme's 2px hairline scrollbar — this list
                lives inside the profile's scroller (views/profile.tsx:205)
                and the house budgets the same 318px in
                components/profile/ProfileFeed.tsx:76-77 — less the 32px of
                outer gutter, the 24px of row inset and its 2px of border
                leaves 260px of row. Take two 10px gaps, the change chip at
                its widest and "Remove" (49.9px at 12px/600), and 128.1px is
                left here: enough for "Price unavailable" with 33px to
                spare, and still enough with a fat 17px bar or a fifth
                integer digit in the chip. THE WIDEST CHIP IS "+4444.4%"
                (61.98px at 12px/700), NOT "+9999.9%" — "4" is the widest
                digit in this face and "9" is not, which is the kind of
                thing a hand-picked number gets wrong; the spec enumerates
                pct()'s whole output set instead.
                components/panel-fit-320.spec.ts adds it up. */}
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {w.symbol
                ? w.symbol.startsWith("$")
                  ? w.symbol
                  : `$${w.symbol}`
                : `${w.mint.slice(0, 4)}…`}
            </Typography>
            <Typography
              sx={{
                fontSize: 11,
                color: DIM,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {typeof w.priceUsd === "number"
                ? `$${w.priceUsd < 1 ? w.priceUsd.toFixed(4) : w.priceUsd.toFixed(2)}`
                : "Price unavailable"}
            </Typography>
          </Box>

          {typeof w.change24hPct === "number" && (
            <Typography
              sx={{
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                color: w.change24hPct >= 0 ? GREEN : RED,
              }}
            >
              {pct(w.change24hPct)}
            </Typography>
          )}

          <Box
            component="button"
            aria-label={`Stop watching ${w.symbol ?? w.mint}`}
            onClick={() => remove(w.mint, w.symbol)}
            sx={{
              background: "none",
              border: "none",
              color: DIM,
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              p: 0,
              flexShrink: 0,
              whiteSpace: "nowrap",
              "&:hover": { color: ACCENT },
            }}
          >
            Remove
          </Box>
        </Box>
      ))}
    </Box>
  )
}
