import { Box, Typography } from "@mui/material"
import { useEffect, useRef, useState } from "react"
import { topWins, type WinRow } from "~/services/SpotAssetService"
import { DIM, PANEL_ROW } from "~/helpers/panelSurface"
import { JUICE } from "~/theme/juice"

/**
 * WHO IS WINNING, AND ON WHAT.
 *
 * A HIGHLIGHT REEL, NOT A LADDER, and the distinction is the whole
 * design. Fomo's home screen — whose grammar the rest of this pass
 * follows — does not rank users by lifetime profit. It shows individual
 * TRADES with a person on them ("threadguy +$134.12K"), which is why it
 * reads as aspiration rather than as a scoreboard.
 *
 * A reel has no bottom. A ladder does, and the bottom is where most of a
 * product's users live: putting somebody last for losing money, on a
 * surface built to make trading feel good, is the opposite of the job.
 * The points board keeps that role, because points reward behaviour we
 * can actually ask for and profit rewards being right about a market.
 *
 * OPT-IN. The server returns only people who set public_wins, which
 * defaults false — this publishes a named person's profit, and nobody had
 * ever been asked. An empty rail is nobody having said yes yet.
 *
 * SILENT WHEN THIN. Fewer than two names is not a reel, it is one person
 * shown repeatedly, and a reader learns from that exactly how little is
 * happening. The ledger held 21 trades the day this was written; the rail
 * is built for the volume, not for today.
 */
const MIN_NAMES = 2

/**
 * How many wins the reel holds. It is also the fetch size, so the
 * MIN_NAMES gate reads exactly the set that will paint rather than a
 * larger one it then throws away.
 *
 * It was six, drawn in a row that scrolled sideways with the scrollbar
 * styled invisible — the pattern the house overturned in
 * components/profile/ProfileFeed.tsx:70-87 ("THE ROW FITS; IT DOES NOT
 * SLIDE"). The row wraps now, and six wrapped cards are three rows of
 * decoration standing between the reader and the composer. Four is two
 * rows at the panel's 320px floor: a block that is scanned, not a screen
 * that has to be scrolled past. components/panel-fit-320.spec.ts
 * re-derives the two-up arithmetic from the numbers below.
 *
 * IT COSTS SOMETHING, AND THE COST IS THE GATE. MIN_NAMES now wants two
 * distinct names among four wins rather than among six, so the rail hides
 * on days six would have carried it. That is the trade the row count buys:
 * a reel that is never taller than the composer it sits above, at the price
 * of showing up less often. Raise both together or neither.
 */
const REEL = 4

const money = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`
    : `$${n.toFixed(n >= 100 ? 0 : 2)}`

export function WinsRail() {
  const [wins, setWins] = useState<WinRow[] | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    // Once per mount, and never again on a re-render: this is decoration
    // and it must not add a request to anybody's scroll.
    if (asked.current) return
    asked.current = true
    topWins(REEL)
      .then((r) => setWins(Array.isArray(r?.wins) ? r.wins : []))
      .catch(() => setWins([]))
  }, [])

  if (!wins) return null
  const names = new Set(wins.map((w) => w.name))
  if (wins.length === 0 || names.size < MIN_NAMES) return null

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
        Biggest wins
      </Typography>
      {/* TWO UP AT 320px, AND A SECOND LINE INSTEAD OF A SCROLLER.
          This row was `overflowX: "auto"` with the scrollbar styled
          invisible and `flex: "0 0 auto", minWidth: 148` cards, so at the
          panel's floor four of the six lived off-screen with nothing on
          screen to say they existed. ProfileFeed.tsx:70-87 already ruled
          on that shape: "a second line is honest, a hidden scrollbar is
          not".

          THE RAIL IS 278px AT THE FLOOR, NOT 288. The column this paints
          into carries an inset of its own: views/comment.tsx:277 declares
          `pl: havePaddingLeft ? "10px" : "0px"`, and `havePaddingLeft`
          (:154) is the same three location-state keys the mount at
          :288-289 gates on — so there is no state in which this rail sees
          the bare panel. 320px less that 10px is 310px of column, less the
          16px gutters above is 278px of rail. Two cards and one 8px gap
          therefore put the basis at 135px, which is what the card
          declares; the 140px this first shipped with needed 288px and
          broke the line at exactly the width it was written for, stacking
          the reel one card per row. A third card wants 3x135 + 2x8 = 421px
          of rail — a 463px panel — so below that a wider panel spends its
          slack growing the same two cards.
          components/panel-fit-320.spec.ts re-derives every number here
          from the source, that 10px included. */}
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
          pb: 0.5,
        }}
      >
        {wins.map((w, i) => (
          <Box
            key={`${w.name}-${w.mint}-${i}`}
            sx={{
              ...PANEL_ROW,
              flex: "1 1 135px",
              minWidth: 0,
              px: 1.25,
              py: 1,
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
              <Box
                component={w.avatarUrl ? "img" : "div"}
                src={w.avatarUrl ?? undefined}
                alt=""
                sx={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  flexShrink: 0,
                  objectFit: "cover",
                  background: "rgba(122,183,255,.2)",
                }}
              />
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {w.name}
              </Typography>
            </Box>
            <Box
              sx={{ display: "flex", alignItems: "baseline", gap: 0.75, minWidth: 0 }}
            >
              {/* The token comes second and quiet. The figure is the point;
                  the ticker is what it happened on — so when the card is at
                  its 135px basis and the ticker is long, the TICKER is what
                  gives way (rule 5: numbers are the heroes). A symbol comes
                  off the API with no length bound, and without the ellipsis
                  it would push the card past its basis and drop the row to
                  one card wide. */}
              <Typography
                sx={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: JUICE.buyInk,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                +{money(w.realizedUsd)}
              </Typography>
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: DIM,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {w.symbol ?? `${w.mint.slice(0, 4)}…`}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
