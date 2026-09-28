import { Box, Typography } from "@mui/material"
import { WebsitePost } from "~/types/websitePost"
import { formatCompactNumber } from "~/utils/numberUtils"
import { ChipGlyphIcon } from "./ChipGlyphIcon"
import { CHIP_ACT, chipActSx, chipNumSx } from "./chipActStyle"
import { GLYPH_LIKE_FILLED, GLYPH_LIKE_OUTLINE } from "./chipGlyphs"

interface UpvoteButtonProps {
  data: WebsitePost
  isUpvoted: boolean
  onUpvoteClick: () => void
}

export default function UpvoteButton({
  data,
  isUpvoted,
  onUpvoteClick,
}: UpvoteButtonProps) {
  return (
    <Box
      component="button"
      onClick={onUpvoteClick}
      aria-pressed={isUpvoted}
      sx={chipActSx(isUpvoted)}
      className="click-animation"
    >
      {/**
       * EMPTY AND FULL, which is the owner's instruction for this control:
       * "like ve liked bos dolu olarak yapalim kullaniciya gozuken taraf
       * olarak" — as the reader sees it, an empty heart and a full one.
       *
       * The chip already carries the liked colour, so the glyph inherits it
       * and only the FILL changes. Both states are the same contour out of
       * chipGlyphs.ts (see the note on HEART_OUTLINE there), so pressing this
       * fills a heart in place — it does not swap one drawing for another of
       * a slightly different shape, which is the version of this that makes a
       * row twitch on every like.
       */}
      <ChipGlyphIcon glyph={isUpvoted ? GLYPH_LIKE_FILLED : GLYPH_LIKE_OUTLINE} size={CHIP_ACT.icon} />
      {data.upvotes > 0 && (
        <Typography variant="body2" sx={chipNumSx(isUpvoted)}>
          {formatCompactNumber(data.upvotes)}
        </Typography>
      )}
    </Box>
  )
}
