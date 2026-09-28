import { Box, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { GREEN, PANEL_PILL } from "~/helpers/panelSurface"
import { sendApiRequest } from "~/lib/fetchService"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"

/**
 * WHAT THE ROOM AGREES ON. One pill above the feed: the token the most
 * DISTINCT people traded here in the last hour, from the server's receipt
 * join (never the client-supplied on_chain flag). Tapping it hands the
 * mint to PageAssetStrip through the launch store — the same door the
 * chip's copy-trade button uses — so the trade sheet opens right above
 * this very pill.
 *
 * Silent almost always, by design: the server answers { mint: null }
 * under its N≥3 privacy floor and for quiet rooms, and this component
 * renders NOTHING then — a consensus chip that usually says "no
 * consensus" would train readers to unsee it.
 *
 * The tap deliberately passes NO side: the strip above FOCUSES the token
 * and its own Buy is one further tap, which is as pushy as an aggregate
 * should ever be. "In the last hour" is kept true two ways — the answer
 * clears the moment the room changes, and a panel left open re-asks
 * every five minutes instead of wearing the same hour all afternoon.
 */
type Answer =
  | { mint: null }
  | { mint: string; symbol: string | null; traders: number; windowMs: number }

const REASK_MS = 5 * 60 * 1000

export function ConsensusChip({ url }: { url: string | null }) {
  const [answer, setAnswer] = useState<Answer | null>(null)

  useEffect(() => {
    // The old room's answer must not survive into the new room even for
    // a frame — a pill claiming 4 traders in a room they traded nowhere
    // near is the exact lie this component exists to not tell.
    setAnswer(null)
    if (!url) return
    let alive = true
    const ask = () => {
      sendApiRequest<Answer>({
        url: `/website-post/consensus?website_url=${encodeURIComponent(url)}`,
        method: "GET",
      })
        .then((r) => alive && setAnswer(r ?? { mint: null }))
        .catch(() => alive && setAnswer({ mint: null }))
    }
    ask()
    const t = setInterval(ask, REASK_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [url])

  if (!answer || answer.mint === null) return null
  const word = (answer.symbol ?? "").replace(/^\$/, "") || `${answer.mint.slice(0, 4)}…`
  return (
    <Box
      component="button"
      onClick={() =>
        useLaunchAssetStore.getState().setLaunchMint(answer.mint)
      }
      className="click-animation"
      sx={{
        ...PANEL_PILL,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        mx: 2,
        mt: 1,
        px: 1.5,
        py: "7px",
        cursor: "pointer",
        font: "inherit",
        border: `1px solid ${GREEN}44`,
        backgroundColor: `${GREEN}14`,
        width: "fit-content",
      }}
    >
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: GREEN }}>
        {answer.traders} traded ${word} here in the last hour
      </Typography>
      <Typography sx={{ fontSize: 11, color: GREEN, opacity: 0.8 }}>→</Typography>
    </Box>
  )
}
