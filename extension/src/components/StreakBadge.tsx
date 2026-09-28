import { Box, Tooltip, Typography, useTheme } from "@mui/material"
import { memo } from "react"
import FlameIcon from "~/assets/flame-red.png"
import { getContrastText } from "~/helpers/getContrastText"
import { formatCompactNumber } from "~/utils/numberUtils"

interface StreakBadgeProps {
  streakCount: number
}

export const StreakBadge = memo(function StreakBadge({
  streakCount
}: StreakBadgeProps) {
  const theme = useTheme()
  const flameUrl = new URL(FlameIcon, import.meta.url).href

  if (!streakCount || streakCount <= 0) return null

  return (
    <Tooltip
      title={`${formatCompactNumber(streakCount)} days`}
      placement="bottom"
      arrow
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          color: getContrastText(theme.palette.tetriary.main),
          border: '0.5px solid transparent',
          borderRadius: '6px',
          backgroundClip: 'padding-box, border-box',
          background: '#3A1D1D',
          display: 'flex',
          height: '16px',
          alignItems: "center",
          padding: '2px 4px 2px 4px',
          gap: '2.5px'
        }}
      >
        <img src={flameUrl} alt="fire" style={{ width: "10px", height: "10px" }} />
        <Typography
          variant="body2"
          sx={{
            color: theme.palette.secondary.contrastText,
            fontSize: "10px",
            fontWeight: "regular",
            lineHeight: "15px",
          }}
        >
          {formatCompactNumber(streakCount)}
        </Typography>
      </Box>
    </Tooltip>
  )
})
