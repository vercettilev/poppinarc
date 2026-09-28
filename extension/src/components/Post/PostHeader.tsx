import { JUICE } from "~/theme/juice"
import { alpha, Box, Stack, Typography, useTheme } from "@mui/material"
import React from "react"
import { useNavigate } from "react-router"
import { CAvatar } from "~/components/CAvatar"
import { getContrastText } from "~/helpers/getContrastText"
import { Organization, User } from "~/services/UserService"
import { useRouteStore } from "~/store/useRouteStore"
import { formatCompactNumber } from "~/utils/numberUtils"
import { TwitterBadge } from "../TwitterBadge"
import { StreakBadge } from "../StreakBadge"
import { FEED_GAMIFICATION } from "~/config/gamification"
import OrganizationBadge from "../OrganizationBadge"
import ActionMenu from "./ActionMenu"
import WebsiteFavicon from "./WebsiteFavicon"
import { UserPopover } from "../UserPopover"

interface DittoBadgeProps {
  ditto: number
  children?: React.ReactNode
  sx?: any
}

import DiamondIcon from "~/assets/diamond.png"
export const DittoBadge = React.memo(React.forwardRef<HTMLDivElement, DittoBadgeProps>(({ ditto, children, sx }, ref) => {
  const theme = useTheme()
  const diamondUrl = new URL(DiamondIcon, import.meta.url).href
  return (
    <Box
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      sx={{
        ml: 1,
        color: "#FFFFFF",
        border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
        borderRadius: '999px',
        backgroundColor: alpha(theme.palette.primary.main, 0.18),
        display: 'flex',
        height: '18px',
        alignItems: "center",
        padding: '2px 6px',
        gap: '3px',
        ...sx
      }}
    >
      <img src={diamondUrl} alt="diamond" style={{ width: "10px", height: "10px" }} />
      <Typography
        variant="body2"
        sx={{
          color: "#FFFFFF",
          fontSize: "10px",
          fontWeight: 600,
          lineHeight: "15px",
        }}
      >
        {children || formatCompactNumber(ditto)}
      </Typography>
    </Box>
  )
}))

DittoBadge.displayName = "DittoBadge"

interface PostHeaderProps {
  user: User
  currentUserId?: string
  onDelete: () => void
  website_url?: string
  postId?: string
  contentType?: "post" | "comment" | "reply"
  announcement_id?: string
  showWebsiteInfo?: boolean
  userStreak?: number
  userOrganizations?: Organization[]
  isOwnProfile: boolean
}

const PostHeader = React.memo(
  ({
    user,
    currentUserId,
    onDelete,
    website_url,
    postId,
    contentType = "post",
    announcement_id,
    showWebsiteInfo = true,
    userStreak = 0,
    userOrganizations,
    isOwnProfile = false
  }: PostHeaderProps) => {
    const { setRoute } = useRouteStore()
    const theme = useTheme()
    const navigate = useNavigate()
    const handleProfileClick = (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      /**
       * `/feed`, NOT `/`. This route wrote `/` for as long as `/` WAS the
       * feed; the restructure made `/` the POSITIONS screen and left every
       * one of these calls pointing at it, so tapping somebody's name in
       * the feed landed the reader on their own portfolio with the profile
       * state attached and nobody reading it. Same bug the chip's own
       * panel door had, in four more places.
       */
      navigate(`/feed`, {
        state: {
          from: "post",
          userId: user.id,
          to: "ProfileDetailView"
        }
      })
    }

    return (
      <Stack direction="row" justifyContent="space-between" alignItems="start">

        <Stack direction="row" spacing={1} className="post-header-container">
          <UserPopover userId={user.id} currentUserId={currentUserId}>
            <Box
              sx={{
                position: "relative",
              }}
            >
              <CAvatar
                src={user.profile_photo_url || undefined}
                size={contentType === "reply" ? "small" : "medium"}
                clickable={true}
                onClick={handleProfileClick}
              />
            </Box>
          </UserPopover>
          <Box sx={{
            marginLeft: "10px !important"
          }}
          className="post-header-container-inner"
          >
            <Stack direction="column" data-testid="post-header-container-inner">
              <Stack direction="row" spacing={0.75} alignItems="center">
                <UserPopover userId={user.id} currentUserId={currentUserId}>
                  <Typography
                    variant="body2"
                    color="white"
                    sx={{
                      fontSize: "13px",
                      fontWeight: 700,
                      cursor: "pointer",
                      "&:hover": {
                        textDecoration: "underline",
                      },
                    }}
                    onClick={handleProfileClick}
                  >
                    {user.display_name}
                  </Typography>
                </UserPopover>
                {!isOwnProfile && userOrganizations && userOrganizations.length > 0 && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    {userOrganizations.slice(0, 3).map((org) => (
                      <OrganizationBadge
                        key={org.id}
                        organization={org}
                        size={15}
                      />
                    ))}
                    {userOrganizations.length > 3 && (
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: "10px",
                          color: JUICE.text2,
                          ml: "2px",
                        }}
                      >
                        +{userOrganizations.length - 3}
                      </Typography>
                    )}
                  </Box>
                )}
                {FEED_GAMIFICATION && !isOwnProfile && !announcement_id && (
                  <DittoBadge ditto={user.ditto || 0} />
                )}
                {FEED_GAMIFICATION && !isOwnProfile && !!userStreak && (
                  <Box sx={{ ml: 1 }}>
                    <StreakBadge streakCount={userStreak} />
                  </Box>
                )}
                {!isOwnProfile && user.twitter_id && (
                  <TwitterBadge
                    twitterId={user.twitter_id}
                    sx={{
                      position: "relative",
                      right: "auto",
                      bottom: "auto",
                      ml: "4px !important",
                      width: "15px",
                      height: "15px",
                    }}
                  />
                )}
              </Stack>
              <UserPopover userId={user.id} currentUserId={currentUserId}>
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: "11px",
                    fontWeight: 400,
                    color: alpha("#FFFFFF", 0.45),
                    cursor: "pointer",
                    "&:hover": {
                      textDecoration: "underline",
                    },
                  }}
                >
                  @{user.username}
                </Typography>
              </UserPopover>
            </Stack>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {!announcement_id && contentType === "post" && showWebsiteInfo && website_url && (
            <WebsiteFavicon url={website_url} />
          )}
          {!announcement_id && (
            <ActionMenu
              onDelete={onDelete}
              currentUserId={currentUserId}
              authorId={user.id}
              postId={postId || ""}
              contentType={contentType}
            />
          )}
        </Stack>
      </Stack>
    )
  }
)

PostHeader.displayName = "PostHeader"

export default PostHeader
