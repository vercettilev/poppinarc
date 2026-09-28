import { JUICE } from "~/theme/juice"
import { Select, SelectProps, lighten, styled, useTheme } from "@mui/material"
import { forwardRef } from "react"
import { ChevronDownIcon } from "./icons"

/**
 * Styled dropdown select component matching the canonical HeaderPill
 * style — 1px transparent border filled with the
 * 90deg #FFFFFF33→#FFFFFF0D gradient over a rgba(255,255,255,.06) background — so
 * dropdowns lined up with the rest of the top-of-screen pills (wallet,
 * tasks, leaderboard, predictions). The native <Select> stays for
 * keyboard accessibility; only the chrome is restyled.
 */
const StyledDropdownSelect = styled(Select<string>)(({ theme }) => ({
  fontSize: 12,
  fontWeight: 500,
  border: `1px solid ${JUICE.border}`,
  background: JUICE.well,
  borderRadius: 40,
  backdropFilter: "blur(4px)",
  color: theme.palette.secondary.contrastText,
  "& .MuiSelect-select": {
    padding: "4px 10px",
    display: "flex",
    alignItems: "center",
  },
  "& .MuiOutlinedInput-notchedOutline": {
    border: "none",
  },
  "& .MuiSvgIcon-root": {
    color: theme.palette.secondary.contrastText,
    width: "5px",
    height: "10px",
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    transition: "transform 0.2s ease",
  },
  "&.Mui-expanded .MuiSvgIcon-root": {
    transform: "translateY(-50%) rotate(180deg)",
  },
  "&.Mui-disabled": {
    color: theme.palette.secondary.contrastText,
    "& .MuiSelect-select": {
      color: theme.palette.secondary.contrastText,
    },
  },
}))

const DropdownSelect = forwardRef<HTMLDivElement, SelectProps<string>>(
  (props, ref) => {
    const theme = useTheme()
    return (
      <StyledDropdownSelect
        IconComponent={ChevronDownIcon}
        MenuProps={{
          anchorOrigin: {
            vertical: "bottom",
            horizontal: "left",
          },
          transformOrigin: {
            vertical: "top",
            horizontal: "left",
          },
          sx: {
            "& .MuiPaper-root": {
              maxHeight: 200,
              backgroundColor: theme.palette.secondary?.main || "",
              backdropFilter: "blur(4px)",
              borderRadius: "8px",
              marginTop: "3px",
              "& .MuiMenuItem-root": {
                fontSize: "12px",
                fontWeight: 400,
                padding: "6px 10px",
                color: theme.palette.secondary.contrastText,
                minHeight: "24px",
              },
            },
            "& .MuiList-root": {
              padding: "3px 0",
            },
          },
        }}
        ref={ref}
        {...props}
      />
    )
  }
)

DropdownSelect.displayName = "DropdownSelect"

export default DropdownSelect
