import { Search as SearchIcon } from "@mui/icons-material"
import { InputAdornment, TextField, useTheme } from "@mui/material"
import { useDebounceCallback } from "usehooks-ts"

interface SearchInputProps {
  onSearchChange: (query: string) => void
  placeholder?: string
  searchType?: "gif" | "emoji"
}

export default function SearchInput({
  onSearchChange,
  placeholder,
  searchType = "gif",
}: SearchInputProps) {
  const defaultPlaceholder = searchType === "gif" ? "Search for GIFs" : "Search for Emojis"
  const theme = useTheme()
  const debouncedSetSearchQuery = useDebounceCallback(
    (query: string) => onSearchChange(query),
    500
  )

  return (
    <TextField
      placeholder={placeholder || defaultPlaceholder}
      onChange={(e) => debouncedSetSearchQuery(e.target.value)}
      size="small"
      data-ignore-click
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon
              sx={{ color: "white", fontSize: "1rem", opacity: 0.6 }}
            />
          </InputAdornment>
        ),
      }}
      sx={{
        "& .MuiOutlinedInput-root": {
          color: "white",
          bgcolor: "transparent",
          "-webkit-autofill": {
            backgroundColor: "transparent !important",
          },
          "-webkit-autofill-background-color": "transparent",
          "-webkit-text-fill-color": "white",
          "-webkit-box-shadow": "0 0 0 1000px transparent inset",
          "box-shadow": "0 0 0 1000px transparent inset",
          "transition": "background-color 5000s ease-in-out 0s",
          "caret-color": "white",
          "& fieldset": {
            border: "none",
          },
          "&:hover fieldset": {
            border: "none",
          },
          "& input": {
            p: 1,
            fontSize: "12px",
            fontWeight: 400,
            "-webkit-autofill": {
              backgroundColor: "transparent !important",
            },
            "-webkit-autofill-background-color": "transparent",
            "-webkit-text-fill-color": "white",
            "-webkit-box-shadow": "0 0 0 1000px transparent inset",
            "box-shadow": "0 0 0 1000px transparent inset",
            "transition": "background-color 5000s ease-in-out 0s",
            "caret-color": "white",
          },
        },
      }}
    />
  )
}
