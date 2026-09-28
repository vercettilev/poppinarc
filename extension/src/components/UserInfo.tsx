import { alpha, Box, Typography, useTheme } from "@mui/material"
import { memo } from "react"

const formatCompactNumber = (number: number) => {
  if (number < 1000) {
    return number
  }
  const suffixes = ["", "k", "M", "B", "T"]
  const suffixNum = Math.floor(("" + number).length / 3)
  let shortValue = parseFloat(
    (suffixNum != 0 ? number / Math.pow(1000, suffixNum) : number).toPrecision(
      2
    )
  )
  if (shortValue % 1 !== 0) {
    shortValue = parseFloat(shortValue.toFixed(1))
  }
  return shortValue + suffixes[suffixNum]
}

export const UserInfo = memo(function UserInfo({
  username,
  handle,
  onClick,
  dittoCount,
  badge,
}: {
  username: string
  handle: string
  onClick?: () => void
  dittoCount?: number
  badge?: React.ReactNode
}) {
  const theme = useTheme()
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <Typography
          variant="subtitle1"
          sx={{
            fontSize: "13px",
            fontWeight: 500,
            lineHeight: "16px",
            color: theme.palette.tetriary.contrastText,
            cursor: onClick ? "pointer" : "default",
            "&:hover": onClick
              ? {
                  textDecoration: "underline",
                }
              : undefined,
          }}
          onClick={onClick}
        >
          {handle.length > 8 ? `${handle.slice(0, 8)}...` : handle}
        </Typography>
        {badge}
        {dittoCount !== undefined && (
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              backgroundColor: theme.palette.secondary.main,
              border: `0.5px solid ${alpha(theme.palette.secondary.main, 0.2)}`,
              borderRadius: "8px",
              padding: "4px 8px",
              ml: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
            }}
            className="ditto"
          >
            <Typography
              variant="body2"
              sx={{
                color: theme.palette.tetriary.contrastText,
                fontSize: "10px",
                fontWeight: "regular",
              }}
            >
              {formatCompactNumber(dittoCount)}
            </Typography>
          </Box>
        )}
      </Box>
      <Typography
        variant="body2"
        color={theme.palette.tetriary.contrastText}
        sx={{
          fontSize: "10px",
          fontWeight: 400,
          lineHeight: "12px",
        }}
      >
        @{username}
      </Typography>
    </Box>
  )
})
