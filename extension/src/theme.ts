import { Theme as MuiTheme } from "@mui/material/styles"

declare module "@mui/material/styles" {
  interface TypeBackground {
    paper: string
    default: string
  }

  interface Palette {
    divider: string
  }

  interface Theme {
    customPalette: {
      secondary: {
        hover: string
        focusVisible: string
      }
      background: {
        createPost: string
        subtleGrey: string
      }
    }
  }
}
