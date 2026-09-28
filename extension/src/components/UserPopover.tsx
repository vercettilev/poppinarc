import { Box, CircularProgress, Popper, Stack, Typography, alpha, useTheme } from "@mui/material"
import { useQuery } from "@tanstack/react-query"
import React, { useRef, useState } from "react"
import { useNavigate } from "react-router"
import { CAvatar } from "~/components/CAvatar"
import { useFollowingStatus } from "~/hooks/useFollowingStatus"
import { useProfileCounts } from "~/hooks/useProfileCounts"
import { UserService } from "~/services/UserService"
import { formatCompactNumber } from "~/utils/numberUtils"
import { FollowButton } from "./FollowButton"
import { DittoBadge } from "./Post/PostHeader"
import { StreakBadge } from "./StreakBadge"
import { TwitterBadge } from "./TwitterBadge"

interface UserPopoverProps {
  userId: string
  children: React.ReactElement
  currentUserId?: string
}

export const UserPopover: React.FC<UserPopoverProps> = ({ userId, children, currentUserId }) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [popperOpen, setPopperOpen] = useState(false)
  const [hoverTimer, setHoverTimer] = useState<NodeJS.Timeout | null>(null)
  const [closeTimer, setCloseTimer] = useState<NodeJS.Timeout | null>(null)
  const theme = useTheme()
  const navigate = useNavigate()

  const open = popperOpen

  const { data: user, isLoading } = useQuery({
    queryKey: ["user", userId],
    queryFn: () => UserService.getUser(userId),
    enabled: open, // Only fetch when popover is open
    staleTime: 60000, // Cache for 1 minute
  })

  const { data: followingStatus } = useFollowingStatus(open ? [userId] : [])
  const isFollowing = followingStatus?.some(status => status.following_id === userId) || false

  const { data: counts } = useProfileCounts(open ? userId : undefined)

  const handlePopoverOpen = () => {
    // Clear any existing timers
    if (hoverTimer) {
      clearTimeout(hoverTimer)
    }
    if (closeTimer) {
      clearTimeout(closeTimer)
      setCloseTimer(null)
    }

    // Set a new timer to open after 500ms
    const timer = setTimeout(() => {
      setPopperOpen(true)
    }, 500)

    setHoverTimer(timer)
  }

  const handlePopoverClose = () => {
    // Clear the hover timer if user moves away before 500ms
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      setHoverTimer(null)
    }

    // Set a delay before closing to prevent accidental closure
    const timer = setTimeout(() => {
      setPopperOpen(false)
    }, 500)

    setCloseTimer(timer)
  }

  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPopperOpen(false)
    // `/feed`, not `/` — see PostHeader's note.
    navigate(`/feed`, {
      state: {
        from: "popover",
        userId: userId,
        to: "ProfileDetailView"
      }
    })
  }

  return (
    <React.Fragment>
      <Box
        ref={anchorRef}
        component="span"
        sx={{ display: "inline-block" }}
        onMouseEnter={handlePopoverOpen}
        onMouseLeave={handlePopoverClose}
      >
        {children}
      </Box>
      {anchorRef.current && (
        <Popper
          open={popperOpen}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          disablePortal={false}
          /**
           * THE CARD IS PORTALLED TO document.body, SO IT HAS TO BE TOLD
           * ABOUT THE EDGE.
           *
           * popper.js's preventOverflow defaults to `mainAxis: true,
           * altAxis: false`, and for a `bottom-start` placement the ALT
           * axis is the horizontal one — so nothing pulled this card back
           * inside the panel when the anchor sat right of centre. It is a
           * hover card over a name in a feed row, so that is most of them.
           * The 8px padding matches the width budget the card declares
           * below; the two numbers have to agree or one of them is a lie.
           */
          modifiers={[
            { name: "preventOverflow", options: { altAxis: true, padding: 8 } },
          ]}
          sx={{ zIndex: 2147483647 }}
          onMouseEnter={() => {
            // Clear close timer if hovering back
            if (closeTimer) {
              clearTimeout(closeTimer)
              setCloseTimer(null)
            }
            setPopperOpen(true)
          }}
          onMouseLeave={() => handlePopoverClose()}
        >
          <Box
            sx={{
              p: 1.5,
              /**
               * 340px OF CARD IN A 320px PANEL WAS A WIDTH THAT COULD NEVER
               * BE MET. `minWidth: "340px"` beats the flex/viewport box it
               * sits in, and this card is portalled to document.body where
               * nothing clips it — so at the panel's supported floor the
               * card simply hung off the right edge.
               *
               * One definite width instead of a 340-360 range: the card is
               * the same size for every reader who has room for it, and it
               * tracks the panel for the reader who does not. 8px each side
               * is the popper padding declared above.
               * components/panel-fit-320.spec.ts adds up what fits inside.
               */
              width: "min(340px, calc(100vw - 16px))",
              bgcolor: theme.palette.tetriary.main,
              borderRadius: "12px",
              border: `0.5px solid ${theme.palette.secondary.main}`,
              mt: 0.5,
              boxShadow: `0px 0px 10px 1px ${theme.palette.secondary.main}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : user ? (
            <Stack spacing={2}>
              {/* User Header */}
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <CAvatar
                  src={user.profile_photo_url || undefined}
                  size="large"
                  clickable={true}
                  onClick={handleProfileClick}
                />
                {/* minWidth: 0 — without it this column's automatic
                    minimum is its longest unbreakable word, and a long
                    display name or handle pushes the avatar and the follow
                    control off the card instead of ellipsizing. */}
                <Stack flex={1} minWidth={0} spacing={0}>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                    <Typography
                      variant="body1"
                      fontWeight="600"
                      color="white"
                      sx={{
                        cursor: "pointer",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        "&:hover": { textDecoration: "underline" },
                      }}
                      onClick={handleProfileClick}
                    >
                      {user.display_name}
                    </Typography>
                    <Box component="span" onClick={(e) => e.stopPropagation()}>
                      <DittoBadge ditto={user.ditto || 0} />
                    </Box>
                    {!!user.activeStreakCount && (
                      <Box component="span" onClick={(e) => e.stopPropagation()}>
                        <StreakBadge streakCount={user.activeStreakCount} />
                      </Box>
                    )}
                    {user.twitter_id && (
                      <Box component="span" onClick={(e) => e.stopPropagation()}>
                        <TwitterBadge
                          twitterId={user.twitter_id}
                          sx={{
                            position: "relative",
                            right: "auto",
                            bottom: "auto",
                            width: "15px",
                            height: "15px",
                          }}
                        />
                      </Box>
                    )}
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{
                      mt: "0px !important",
                      fontSize: "13px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: alpha(theme.palette.secondary.contrastText, 0.6),
                    }}
                  >
                    @{user.username}
                  </Typography>
                </Stack>
                {currentUserId && currentUserId !== userId && (
                  <Stack direction="row" spacing={0.5} alignItems="center">
{/* The chat-bubble door went to /messages, a route that exists
                        nowhere: DMs were retired (ProfileDetailView records the
                        decision) and the tap stranded the reader on a blank
                        room. One control group, one lit thing: Follow stays. */}
                    <FollowButton
                      userId={userId}
                      isFollowing={isFollowing}
                      show={true}
                      isExtended={false}
                    />
                  </Stack>
                )}
              </Stack>

              {/* Bio */}
              {user.bio && (
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: "13px",
                    color: "white",
                    wordBreak: "break-word",
                  }}
                >
                  {user.bio}
                </Typography>
              )}

              {/* Stats — four counters that do not fit one line, and did
                  not fit the old 340px card either. "Posts" + "Replies" +
                  "Followers" + "Following" are 185.2px at 12px/400 and the
                  gaps are 40px, so 225.2px of the card's 279px is spent
                  before a single digit is drawn: one line survives only
                  while all four counts are one glyph. At the widest string
                  formatCompactNumber can print ("444m", 36.4px at 12px/600)
                  the row wants 370.7px. The old card had 315px of content
                  and failed the same way from "88.8k" (33.3px each, 358.3px)
                  up. flexWrap is the house valve (ProfileFeed.tsx:85-86),
                  and `useFlexGap` is what makes Stack space a WRAPPED row
                  with `gap` instead of with the left margins it otherwise
                  puts on every child but the first — those would indent
                  line two. */}
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                flexWrap="wrap"
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="body2" fontWeight="600" fontSize="12px" color="white">
                    {formatCompactNumber(counts?.website_post_count || 0)}
                  </Typography>
                  <Typography
                    variant="body2"
                    fontSize="12px"
                    sx={{ color: alpha(theme.palette.secondary.contrastText, 0.6) }}
                  >
                    Posts
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="body2" fontWeight="600" fontSize="12px" color="white">
                    {formatCompactNumber(counts?.reply_count || 0)}
                  </Typography>
                  <Typography
                    variant="body2"
                    fontSize="12px"
                    sx={{ color: alpha(theme.palette.secondary.contrastText, 0.6) }}
                  >
                    Replies
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="body2" fontWeight="600" fontSize="12px" color="white">
                    {formatCompactNumber(counts?.followers_count || 0)}
                  </Typography>
                  <Typography
                    variant="body2"
                    fontSize="12px"
                    sx={{ color: alpha(theme.palette.secondary.contrastText, 0.6) }}
                  >
                    Followers
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="body2" fontWeight="600" fontSize="12px" color="white">
                    {formatCompactNumber(counts?.followings_count || 0)}
                  </Typography>
                  <Typography
                    variant="body2"
                    fontSize="12px"
                    sx={{ color: alpha(theme.palette.secondary.contrastText, 0.6) }}
                  >
                    Following
                  </Typography>
                </Stack>
              </Stack>
            </Stack>
          ) : null}
        </Box>
        </Popper>
      )}
    </React.Fragment>
  )
}
