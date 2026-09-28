import { Box, IconButton, Popover, SxProps, Tab, Tabs, useTheme } from "@mui/material"
import { alpha } from "@mui/material/styles"
import { lazy, Suspense, useEffect, useState } from "react"
import { getContrastText } from "~/helpers/getContrastText"
import { GifTag } from "./GifSearch"
import SearchInput from "./SearchInput"
import { SmileIcon } from "./icons"

const EmojiPicker = lazy(() => import("~/components/EmojiPicker"))
const GifSearch = lazy(() => import("~/components/GifSearch"))

interface EmojiGifWrapperProps {
  handleEmojiButtonClick: (event: React.MouseEvent<HTMLElement>) => void
  handleEmojiPickerClose: () => void
  handleEmojiSelect: (emoji: { emoji: string }) => void
  handleGifSelect: (gif: GifTag) => void
  emojiAnchorEl: HTMLElement | null
  isEmojiPickerOpen: boolean
  activeTab: "emoji" | "gif"
  setActiveTab: (tab: "emoji" | "gif") => void
  sx?: SxProps
}

export default function EmojiGifWrapper({
  handleEmojiButtonClick,
  handleEmojiPickerClose,
  handleEmojiSelect,
  handleGifSelect,
  emojiAnchorEl,
  isEmojiPickerOpen,
  activeTab,
  setActiveTab,
  sx,
}: EmojiGifWrapperProps) {
  const theme = useTheme()
  const [gifSearchQuery, setGifSearchQuery] = useState("")
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("")

  // Ensure GIF is default selected when opening
  useEffect(() => {
    if (isEmojiPickerOpen) {
      setActiveTab("gif")
    }
  }, [isEmojiPickerOpen, setActiveTab])

  // Reset search queries when picker is closed
  useEffect(() => {
    if (!isEmojiPickerOpen) {
      setGifSearchQuery("")
      setEmojiSearchQuery("")
    }
  }, [isEmojiPickerOpen])
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      <IconButton
        color="primary"
        size="small"
        onClick={handleEmojiButtonClick}
        sx={{
          ...sx,
          "& svg": {
            width: "14px",
            height: "14px",
            color: getContrastText(theme.palette.tetriary.main),
          },
        }}
      >
        <SmileIcon />
      </IconButton>
      <Popover
        id="emoji-picker-popover"
        anchorEl={emojiAnchorEl}
        open={isEmojiPickerOpen}
        onClose={handleEmojiPickerClose}
        anchorOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
        sx={{
          "& .MuiPopover-paper": {
            boxShadow: "0px 4px 20px rgba(0, 0, 0, 0.25)",
            bgcolor: theme.palette.secondary.main,
            border: `1px solid ${theme.palette.secondary.light}`,
            borderRadius: "10px",
            /**
             * ONE DEFINITE PAPER WIDTH, AND EVERYTHING INSIDE MEASURES OFF
             * IT.
             *
             * The two panes below used to declare `minWidth/maxWidth:
             * "80vw"`, so the paper shrank to 80% of the panel while the
             * emoji picker itself is a hard 350px (its library default,
             * node_modules/emoji-picker-react/dist/
             * emoji-picker-react.cjs.development.js:464). MUI's Popover
             * paper is `overflowX: hidden` (Popover.js:72-79), so the
             * difference was not scrolled to, it was cut off: 94px of
             * picker gone at the 320px floor, and still 30px gone at
             * Chrome's 400px default. 80vw only caught up with 350px at a
             * 437.5px panel.
             *
             * 352px = the picker's own 350px plus this border, and MUI's
             * own `calc(100% - 32px)` cap (the 16px marginThreshold the
             * Popover keeps either side) is what the paper falls back to
             * when the panel is narrower. components/panel-fit-320.spec.ts
             * re-derives the chain.
             */
            width: "min(352px, calc(100% - 32px))",
          },
        }}
      >
        <Box
          sx={{ p: 0, m: 0, backgroundColor: theme.palette.secondary.main }}
          id="emoji-picker-tabs"
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 1,
              bgcolor: "transparent",
              position: "sticky",
              top: 0,
              zIndex: 1,
            }}
          >
            {(activeTab === "gif" || activeTab === "emoji") && (
              // minWidth: 0 so the field gives way to the two tabs beside
              // it instead of holding its content width and pushing them
              // out of the paper.
              <Box sx={{ flex: 1, minWidth: 0, mr: 2 }}>
                <SearchInput
                  onSearchChange={activeTab === "gif" ? setGifSearchQuery : setEmojiSearchQuery}
                  searchType={activeTab}
                />
              </Box>
            )}
            <Box
              sx={{
                display: "flex",
                borderRadius: "8px",
                overflow: "hidden",
                backgroundColor: "transparent",
              }}
            >
              <Tabs
                value={activeTab}
                onChange={(_, newValue) => setActiveTab(newValue)}
                sx={{
                  minHeight: "32px",
                  m: 0,
                  p: 0,
                  "& .MuiTab-root": {
                    padding: "6px 12px",
                    margin: 0,
                    minHeight: "32px",
                    fontSize: "10px",
                    textTransform: "uppercase",
                    fontWeight: 500,
                    backgroundColor: theme.palette.tetriary.main,
                    color: alpha(theme.palette.tetriary.contrastText, 0.5),
                    transition: "background-color 150ms ease, color 150ms ease",
                    border: "none",
                    borderRadius: 0,
                    minWidth: "auto",
                    width: "auto",
                    "&.Mui-selected": {
                      color: theme.palette.primary.contrastText,
                      backgroundColor: theme.palette.primary.main,
                    },
                  },
                  "& .MuiTabs-indicator": {
                    display: "none",
                  },
                }}
              >
                <Tab label="GIF" value="gif" />
                <Tab label="Emoji" value="emoji" />
              </Tabs>
            </Box>
          </Box>

          {activeTab === "emoji" && (
            <Box
              sx={{
                p: 0,
                width: "100%",
                height: 350,
                /**
                 * THE ONLY THING THAT ACTUALLY RESIZES THE PICKER.
                 *
                 * emoji-picker-react writes its width as an INLINE style on
                 * its own `<aside class="EmojiPickerReact">` (…development
                 * .js:23589-23591, from the `width: 350` default at :464),
                 * and components/EmojiPicker.tsx renders it with no width
                 * prop. Widening the box around it therefore changes
                 * nothing — the aside stays 350px and overflows. An author
                 * `!important` declaration outranks a non-important inline
                 * style, so this is the one lever available from outside
                 * that component.
                 *
                 * The box is a plain block, not a flex row: a flex item's
                 * automatic minimum size is its content's min-content, and
                 * over a fixed-width child that floors the wrapper at 350px
                 * whatever the parent says.
                 */
                "& .EmojiPickerReact": {
                  width: "100% !important",
                  maxWidth: "100% !important",
                },
              }}
            >
              <Suspense fallback={<div>Loading...</div>}>
                <EmojiPicker onEmojiClick={handleEmojiSelect} />
              </Suspense>
            </Box>
          )}

          {activeTab === "gif" && (
            <Box
              sx={{
                width: "100%",
                height: "350px",
                // The GIF pane clipped one level EARLIER than the emoji one
                // — this `overflow: hidden` cut the grid before the paper
                // was even involved, so there was no scrollbar at any level
                // to recover it. It stays, because it is what rounds the
                // grid into the paper's corners; what changed is that the
                // pane is now the paper's own width, so there is nothing
                // outside it to cut.
                overflow: "hidden",
                position: "relative",
              }}
            >
              <Suspense fallback={<div>Loading...</div>}>
                 <GifSearch
                   isOpen={activeTab === "gif"}
                   onClose={handleEmojiPickerClose}
                   onSelect={handleGifSelect}
                   searchQuery={gifSearchQuery}
                   onSearchQueryChange={setGifSearchQuery}
                 />
              </Suspense>
            </Box>
          )}
        </Box>
      </Popover>
    </div>
  )
}
