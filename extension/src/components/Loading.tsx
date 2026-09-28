import { Box, CircularProgress, Theme } from "@mui/material"

export default function Loading() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        backgroundColor: "transparent",
      }}
    >
      <CircularProgress
        size={28}
        thickness={4}
        sx={(theme: Theme) => ({ color: theme.palette.primary.main })}
      />
    </Box>
  )
}
