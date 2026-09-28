import { JUICE } from "~/theme/juice"
import {
  Alert,
  AlertProps,
  alpha,
  Snackbar,
  SnackbarOrigin,
  useTheme,
} from "@mui/material"
import { ReactNode } from "react"

export interface ToastProps {
  open: boolean
  message: string | ReactNode
  severity?: AlertProps["severity"]
  position: SnackbarOrigin
  onClose: () => void
}

// Severity → accent map. Sits on the canonical #000 toast surface as a
// 1px hairline + a tinted icon so each tone is recognizable without
// flooding the toast with color.
const SEVERITY_ACCENT: Record<
  NonNullable<AlertProps["severity"]>,
  string
> = {
  success: "#5ECF7B",
  error: JUICE.redSoft,
  warning: "#FFB454",
  info: JUICE.accent,
}

const Toast = ({ open, message, severity, position, onClose }: ToastProps) => {
  const theme = useTheme()
  const accent =
    (severity && SEVERITY_ACCENT[severity]) || theme.palette.primary.main

  return (
    <Snackbar
      sx={{ zIndex: 999999 }}
      open={open}
      autoHideDuration={2500}
      onClose={onClose}
      anchorOrigin={position}
    >
      <Alert
        onClose={onClose}
        severity={severity}
        sx={{
          minWidth: "240px",
          maxWidth: "320px",
          display: "flex",
          alignItems: "center",
          backgroundColor: "transparent",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderRadius: "14px",
          color: "#FFFFFF",
          fontSize: "13px",
          fontWeight: 500,
          border: `1px solid ${alpha(accent, 0.4)}`,
          boxShadow: `0 12px 32px ${alpha("#000", 0.5)}, 0 0 0 1px ${alpha(
            "#FFFFFF",
            0.04
          )} inset`,
          "& .MuiAlert-message": {
            display: "flex",
            alignItems: "center",
            padding: "10px 0",
            color: "#FFFFFF",
          },
          "& .MuiAlert-icon": {
            width: "20px",
            height: "20px",
            marginRight: "10px",
            color: accent,
          },
          "& .MuiAlert-action": {
            padding: "0 4px 0 0",
            marginRight: 0,
            alignItems: "center",
          },
          "& .MuiAlert-action .MuiButtonBase-root": {
            backgroundColor: alpha("#FFFFFF", 0.06),
            width: "22px",
            height: "22px",
            borderRadius: "999px",
            padding: 0,
            minWidth: "auto",
            color: alpha("#FFFFFF", 0.7),
            "&:hover": {
              backgroundColor: alpha("#FFFFFF", 0.12),
              color: "#FFFFFF",
            },
            "& .MuiSvgIcon-root": {
              width: "12px",
              height: "12px",
            },
          },
        }}
      >
        {message}
      </Alert>
    </Snackbar>
  )
}

export default Toast
