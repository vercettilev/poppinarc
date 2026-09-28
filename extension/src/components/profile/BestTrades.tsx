import { Box, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { DIM, PANEL_ROW } from "~/helpers/panelSurface"
import { myWins, winsFor, type BestLot } from "~/services/SpotAssetService"
import { money, moneyExact, pctText, assetName, showVitrine } from "./bestTradesText"
import { JUICE } from "~/theme/juice"

/**
 * THE VITRINE. A profile used to show a person's every swap, forever, which
 * is a ledger; what a reader actually stops on is the five best, biggest
 * first, the way Fomo draws them. Realised only — a closed lot's banked
 * profit — never what is held and never what is down: the same rule the
 * home rail has lived by, under the same consent (public_wins), which now
 * reads "Show my best trades" in Settings because this is where they show.
 *
 * ONE CARD PER ASSET. The ledger walk folds a (user, mint) lot into one
 * figure, so a token bought and sold five times is one card with one total.
 * The heading says "trades" the way a person says it; the card is honest
 * about being an asset.
 *
 * Silent when empty, for both readers: your own empty vitrine is a fact
 * about you, and someone else's is either that or their choice not to
 * publish, and the two must look identical from the outside.
 */

export function BestTrades({ userId, own }: { userId: string; own: boolean }) {
  const [wins, setWins] = useState<BestLot[] | null>(null)

  useEffect(() => {
    let alive = true
    setWins(null)
    const ask = own ? myWins(5) : winsFor(userId, 5)
    ask
      .then((r) => {
        if (alive) setWins(Array.isArray(r?.wins) ? r.wins : [])
      })
      .catch(() => {
        if (alive) setWins([])
      })
    return () => {
      alive = false
    }
  }, [userId, own])

  if (!showVitrine(wins)) return null
  const [first, ...rest] = wins

  return (
    <Box sx={{ mx: 2, mt: 1.5 }}>
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: DIM,
          mb: 1,
        }}
      >
        {own ? "Your best trades" : "Best trades"}
      </Typography>

      {/* THE FIRST ONE IS THE HEADLINE and takes the whole row: the figure
          is the point, and the biggest figure earns the widest card. The
          rest sit two-up, which fits the panel's 320px floor the way the
          wins rail already proved. */}
      <Box sx={{ ...PANEL_ROW, px: 1.5, py: 1.25, display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", color: DIM }}>
            #1
          </Typography>
          <Typography
            sx={{ fontSize: 20, fontWeight: 800, color: JUICE.buyInk, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}
          >
            +{moneyExact(first.realizedUsd)}
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right" }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
            {assetName(first)}
          </Typography>
          {pctText(first.pct) && (
            <Typography sx={{ fontSize: 11, color: JUICE.buyInk, fontFamily: JUICE.mono, opacity: 0.85 }}>
              {pctText(first.pct)}
            </Typography>
          )}
        </Box>
      </Box>

      {rest.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {rest.map((w, i) => (
            <Box
              key={`${w.mint}-${i}`}
              sx={{ ...PANEL_ROW, flex: "1 1 135px", minWidth: 0, px: 1.25, py: 1 }}
            >
              <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", color: DIM }}>
                #{i + 2}
              </Typography>
              <Typography
                sx={{ fontSize: 15, fontWeight: 800, color: JUICE.buyInk, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}
              >
                +{money(w.realizedUsd)}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, minWidth: 0 }}>
                <Typography
                  sx={{ fontSize: 11, fontWeight: 700, color: DIM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {assetName(w)}
                </Typography>
                {pctText(w.pct) && (
                  <Typography sx={{ fontSize: 10.5, color: JUICE.buyInk, fontFamily: JUICE.mono, opacity: 0.85, flexShrink: 0 }}>
                    {pctText(w.pct)}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
