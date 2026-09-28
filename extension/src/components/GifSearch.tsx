import {
  Box,
  Typography,
  useTheme,
} from "@mui/material"
import { useMemo, useRef } from "react"
import CustomInfiniteScroll from "~/components/CustomInfiniteScroll"
import { useGetGifCategories, useGetGifs } from "~/hooks/useGifs"

export interface GifTag {
  searchterm: string
  path: string
  image: string
  name: string
}

interface GifSearchProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (gif: GifTag) => void
  searchQuery: string
  onSearchQueryChange?: (query: string) => void
}

export default function GifSearch({
  isOpen,
  onClose,
  onSelect,
  searchQuery,
  onSearchQueryChange,
}: GifSearchProps) {
  const theme = useTheme()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { data: gifCategories, isPending: isGifCategoriesLoading } =
    useGetGifCategories()

  const {
    data: gifData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useGetGifs({
    query: searchQuery,
    limit: 10,
  })

  const isSearching = useMemo(
    () => searchQuery.trim().length > 0,
    [searchQuery]
  )

  const handleGifSelect = (gif: GifTag) => {
    onSelect(gif)
    onClose()
  }

  const handleCategoryClick = (searchterm: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(searchterm)
    }
  }

  const customLoadingComponent = (
    <Typography
      variant="body2"
      sx={{ textAlign: "center", color: theme.palette.secondary.contrastText, py: 1 }}
    >
      Loading more...
    </Typography>
  )

  const endMessage = (
    <Typography
      variant="body2"
      sx={{ textAlign: "center", color: theme.palette.secondary.contrastText, py: 1 }}
    >
      You've seen it all!
    </Typography>
  )

  if (!isOpen) return null

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: theme.palette.secondary.main,
      }}
    >
      {/* Content */}
      <Box
        id="gifScrollableDiv"
        ref={scrollContainerRef}
        sx={{
          flex: 1,
          overflow: "auto",
          p: 1,
        }}
      >
        {isSearching ? (
          <CustomInfiniteScroll
            onLoadMore={fetchNextPage}
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
            containerRef={scrollContainerRef}
            loadingComponent={customLoadingComponent}
          >
            <Box
              sx={{
                display: "grid",
                /**
                 * THE TILES FOLLOW THE BOX, NOT THE WINDOW.
                 *
                 * This was `{ xs: 2, sm: 3, md: 4 }` columns — MUI
                 * breakpoints, which are WINDOW media queries. The grid
                 * lives inside a Popover paper that is capped at 350px
                 * (EmojiGifWrapper.tsx), so the box does not grow when the
                 * window crosses 600px; only the column count did, and the
                 * same 334px of grid drew two tiles or three depending on
                 * how wide the browser happened to be. The `containerType:
                 * "inline-size"` that used to sit on this Box was the
                 * author reaching for the right answer, but nothing here
                 * ever wrote a container query, so it did nothing.
                 *
                 * auto-fill against a real floor is the answer that needs
                 * no query: 2 tiles of 132px at the panel's 320px minimum,
                 * 3 of 108px once the paper reaches its 350px of content.
                 * Both figures are net of the 2px hairline scrollbar the
                 * `overflow: "auto"` box above takes off this grid before a
                 * track is laid out, and the tile COUNTS hold even if that
                 * bar is a fat 17px one.
                 * components/panel-fit-320.spec.ts re-derives all of it.
                 */
                gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                gap: 0.5,
              }}
            >
              {gifData?.pages.map((page) =>
                page.results.map((gif) => (
                  <Box
                    key={gif.id}
                    component="button"
                    onClick={() =>
                      handleGifSelect({
                        searchterm: gif.title,
                        path: gif.media_formats.tinygif.url,
                        image: gif.media_formats.tinygif.url,
                        name: gif.title,
                      })
                    }
                    sx={{
                      p: 0,
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      position: "relative",
                      width: "100%",
                      aspectRatio: "1",
                      "&:hover": {
                        "& img": {
                          opacity: 0.8,
                        },
                      },
                    }}
                  >
                    <Box
                      component="img"
                      src={gif.media_formats.tinygif.url}
                      alt={gif.title}
                      sx={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: 0.5,
                        transition: "opacity 0.2s",
                      }}
                    />
                  </Box>
                ))
              )}
            </Box>
            {!hasNextPage && !isFetchingNextPage && endMessage}
          </CustomInfiniteScroll>
        ) : isGifCategoriesLoading ? (
          <Typography
            variant="body2"
            sx={{ textAlign: "center", color: theme.palette.secondary.contrastText }}
          >
            Loading...
          </Typography>
        ) : gifCategories?.tags && gifCategories.tags.length > 0 ? (
          <Box
            sx={{
              display: "grid",
              gap: 0.5,
              // The same grid as the search results above, for the same
              // reason. (`containerType: "grid"` used to sit here; there is
              // no such value — the keyword set is normal | size |
              // inline-size — so the declaration was dropped by the parser
              // and the columns were the window's all along.)
              gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
            }}
          >
            {gifCategories.tags.map((gif) => (
              <Box
                key={gif.searchterm}
                component="button"
                onClick={() => handleCategoryClick(gif.searchterm)}
                sx={{
                  p: 0,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1",
                  "&:hover": {
                    "& img": {
                      opacity: 0.8,
                    },
                  },
                }}
              >
                <Box
                  component="img"
                  src={gif.image}
                  alt={gif.searchterm}
                  sx={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: 0.5,
                    transition: "opacity 0.2s",
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    p: 0.5,
                    bgcolor: "rgba(0, 0, 0, 0.7)",
                    color: theme.palette.secondary.contrastText,
                    borderBottomLeftRadius: 0.5,
                    borderBottomRightRadius: 0.5,
                    fontSize: "0.625rem",
                    textAlign: "center",
                  }}
                >
                  {gif.searchterm}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography
            variant="body2"
            sx={{ textAlign: "center", color: theme.palette.secondary.contrastText }}
          >
            No categories found.
          </Typography>
        )}
      </Box>
    </Box>
  )
}
