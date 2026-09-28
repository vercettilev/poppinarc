import AddIcon from "@mui/icons-material/Add"
import { alpha, Box, CircularProgress, styled, SxProps, Typography, useTheme } from "@mui/material"
import { motion } from "framer-motion"
import { memo } from "react"
import { useFollowUser } from "~/hooks/useFollowUser"
import { FollowIcon, UnfollowIcon } from "./icons"

/**
 * The wrapper, not the button, is the flex item every caller lays out, so
 * `flexShrink: 0` has to live here: on a 320px panel a row with a long name
 * beside it would otherwise squash the button rather than ellipsize the name.
 */
const ButtonWrapper = styled(Box)({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  flexShrink: 0,
})

const StyledButton = styled(motion.button)<{ sx?: any }>(({sx }) => ({
  borderRadius: 120,
  textTransform: "none",
  padding: "2px 8px",
  fontSize: 12,
  fontWeight: 600,
  border: "0.5px solid #21C4C4",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "0px",
  cursor: "pointer",
  "&:disabled": {
    cursor: "not-allowed",
    opacity: 0.7,
  },
  height: "24px",
  width: "24px",
  ...sx,
}))

const StyledCircularProgress = styled(CircularProgress)({
  width: "14px !important",
  height: "14px !important",
  color: "white !important",
})

export const FollowButton = memo(function FollowButton({
  isFollowing,
  show,
  userId,
  sx,
  isExtended = false,
  animated = true,
}: {
  isFollowing: boolean
  show: boolean
  userId: string
  sx?: SxProps
  isExtended?: boolean
  animated?: boolean
}) {
  const { mutate: followUser, isPending } = useFollowUser()

  const theme = useTheme()

  if (!show) return null

  const handleClick = () => {
    followUser({ userId, isFollowing })
  }

  return (
    <ButtonWrapper>
      <StyledButton
        animate={animated ? {
          background: isFollowing ? alpha(theme.palette.secondary.main, 0.8) : alpha(theme.palette.primary.main, 0.8),
          color:  isFollowing ? theme.palette.secondary.contrastText : theme.palette.primary.contrastText,
          borderColor: isFollowing ? theme.palette.secondary.main : theme.palette.primary.main,
          border: `0.5px solid ${isFollowing ? theme.palette.secondary.main : theme.palette.primary.main}`,
          width: isExtended ? "auto" : "24px",
          padding: isExtended ? "3px 8px" : "2px 8px",
        } : undefined}
        transition={animated ? { duration: 0.2 } : undefined}
        onClick={handleClick}
        disabled={isPending}
        sx={{
          background: !animated ? (isFollowing ? alpha(theme.palette.secondary.main, 0.8) : alpha(theme.palette.primary.main, 0.8)) : undefined,
          color: !animated ? (isFollowing ? theme.palette.secondary.contrastText : theme.palette.primary.contrastText) : undefined,
          borderColor: !animated ? (isFollowing ? theme.palette.secondary.main : theme.palette.primary.main) : undefined,
          border: !animated ? `0.5px solid ${isFollowing ? theme.palette.secondary.main : theme.palette.primary.main}` : undefined,
          width: !animated ? (isExtended ? "auto" : "24px") : undefined,
          padding: !animated ? (isExtended ? "3px 8px" : "2px 8px") : undefined,
          ...sx,
        }}
      >
        <motion.div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
          }}
        >
          {isExtended ? (
            /**
             * THE LABEL NEVER LEAVES WHILE THE MUTATION IS IN FLIGHT.
             *
             * An extended button is `width: auto`, so it is the label that
             * measures it. Swapping the whole content for a spinner therefore
             * collapsed the button to spinner-width mid-press and dragged the
             * right edge of whatever row it sits in with it — a press that
             * moves geometry, which this repo does not ship. Only the glyph
             * slot changes, and that slot is a fixed 12x12 box so the spinner
             * cannot resize it either.
             */
            <>
              {/**
               * THE WIDER WORD MEASURES THE BUTTON, IN BOTH STATES.
               *
               * An extended button is `width: "auto"`, so the label is what
               * measures it — and "Following" is wider than "Follow". Swapping
               * the text alone therefore grew the button on the press, and
               * FollowerItem's identity column beside it (`minWidth: 0,
               * flex: 1`, name ellipsised) is what paid for the extra pixels:
               * press Follow and the name you pressed next to gets shorter.
               *
               * A `minWidth` floor cannot fix this, because nobody here can
               * measure one — a floor under the natural width of "Following"
               * changes nothing and a floor over it pads every "Follow" row,
               * and jsdom has no layout engine to tell the two apart.
               *
               * So both words occupy ONE grid cell and the widest of them
               * sizes the track, exactly as components/FillCelebration.tsx
               * does for its Undo/Removed label. No pixel is written down, so
               * no pixel can be wrong.
               *
               * The hidden twin is always "Following" — the wider word, and
               * therefore the only one that has to be in the cell for the box
               * to be at its final size in both states. `visibility: hidden`
               * and not a conditional: a hidden box still occupies its cell,
               * which is the entire point. It is also `aria-hidden`, so the
               * button still announces one name, the live one below it.
               */}
              <Typography
                component="span"
                variant="body2"
                sx={{
                  fontSize: "11px",
                  fontWeight: 500,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  display: "inline-grid",
                  justifyItems: "center",
                  "& > *": { gridArea: "1 / 1" },
                }}
              >
                <span aria-hidden="true" style={{ visibility: "hidden" }}>
                  Following
                </span>
                <span>{isFollowing ? "Following" : "Follow"}</span>
              </Typography>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isPending ? (
                  // `color="inherit"` so it reads on both fills; the shared
                  // StyledCircularProgress is hard-coded white for the 24px
                  // variant below and would vanish on the light accent.
                  <CircularProgress size={12} thickness={4} color="inherit" />
                ) : (
                  // One glyph, two meanings: + to follow, the same + turned
                  // 45° into an × to unfollow. The word beside it carries the
                  // state; this only has to agree with it.
                  <AddIcon
                    sx={{
                      width: 12,
                      height: 12,
                      transform: isFollowing ? "rotate(45deg)" : "rotate(0deg)",
                      transition: animated ? "transform 0.2s ease" : undefined,
                    }}
                  />
                )}
              </Box>
            </>
          ) : isPending ? (
            // The icon-only button is pinned to 24px, so swapping its whole
            // content costs no layout.
            <StyledCircularProgress size={14} thickness={2} />
          ) : isFollowing ? (
            <UnfollowIcon sx={{ width: 14, height: 14 }} />
          ) : (
            <FollowIcon sx={{ width: 14, height: 14 }} />
          )}
        </motion.div>
      </StyledButton>
    </ButtonWrapper>
  )
})
