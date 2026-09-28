import { JUICE } from "~/theme/juice"
import { Button, ButtonProps } from "@mui/material"

interface DialogButtonProps extends Omit<ButtonProps, "variant"> {
  variant?: "primary" | "secondary" | "danger"
}

export function DialogButton({
  variant = "secondary",
  children,
  sx,
  ...props
}: DialogButtonProps) {
  const getButtonStyles = () => {
    switch (variant) {
      case "primary":
        return {
          background: `#68C6FF`,
          color: "#000000",
          "&:hover": {
            background: `#5ab8f5`,
          },
          "&:disabled": {
            background: `#68C6FF50`,
            color: "#00000080",
          },
        }
      case "danger":
        return {
          background: `#ff6b6b`,
          color: "#FFFFFF",
          "&:hover": {
            background: `#ff5252`,
          },
          "&:disabled": {
            background: `#ff6b6b50`,
            color: "#FFFFFF80",
          },
        }
      case "secondary":
      default:
        return {
          background: JUICE.well,
          color: "#FFFFFF",
          "&:hover": {
            background: `#1a2029`,
          },
        }
    }
  }

  return (
    <Button
      sx={{
        flex: 1,
        py: 1.5,
        fontSize: "14px",
        fontWeight: 600,
        border: `1px solid ${JUICE.border}`,
        borderRadius: "15px",
        ...getButtonStyles(),
        ...sx,
      }}
      {...props}
    >
      {children}
    </Button>
  )
}
