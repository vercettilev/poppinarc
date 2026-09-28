import "@mui/material/styles"

declare module "@mui/material/styles" {
  interface TypeBackground {
    createPost: string
    subtleGrey: string
  }

  interface Palette {
    border: {
      primary: string
    }
  }
}
