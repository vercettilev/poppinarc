import { alpha, Box, Typography } from "@mui/material"
import type { ReactNode } from "react"
import { DIM } from "~/helpers/panelSurface"

/**
 * ONE ROW OF THE DEPOSIT CARD'S "OR" LIST: a disc, a name, one line of
 * what it does, a chevron. The shape Blink's own sheet uses for its rail,
 * so the panel's card and the modal the tab opens read as the same thing.
 */
export function RailRow({
  glyph,
  title,
  sub,
  onClick,
  busy = false,
}: {
  glyph: ReactNode
  title: string
  sub: string
  onClick: () => void
  busy?: boolean
}) {
  return (
    <Box
      component="button"
      onClick={onClick}
      disabled={busy}
      className="click-animation"
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 1.25,
        py: 1.1,
        borderRadius: "14px",
        border: `1px solid ${alpha("#FFFFFF", 0.1)}`,
        backgroundColor: alpha("#FFFFFF", 0.05),
        color: "#FFFFFF",
        font: "inherit",
        textAlign: "left",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
        "&:hover": { backgroundColor: alpha("#FFFFFF", 0.08) },
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}
      >
        {glyph}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>{title}</Typography>
        <Typography sx={{ fontSize: 11.5, color: DIM, lineHeight: 1.35 }}>{sub}</Typography>
      </Box>
      <Typography sx={{ color: DIM, fontSize: 16, lineHeight: 1 }}>›</Typography>
    </Box>
  )
}
