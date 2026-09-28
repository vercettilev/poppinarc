import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import { alpha, Box, Typography } from "@mui/material"
import { useState } from "react"
import { CAvatar } from "~/components/CAvatar"
import { FollowButton } from "~/components/FollowButton"
import { NotificationsIcon, NotificationsOffIcon } from "~/components/icons"
import OrganizationBadge from "~/components/OrganizationBadge"
import { TwitterBadge } from "~/components/TwitterBadge"
import { ACCENT, DIM, FAINT, PANEL_PILL } from "~/helpers/panelSurface"

/**
 * Who this is — identity with its one action, and four numbers.
 *
 * ── WHAT THIS REPLACED ──────────────────────────────────────────────────────
 * A banner-height header with a floating avatar, an absolutely-positioned
 * back button at z-index 9999999, and a bio whose measured height was written
 * into a global store so five sibling tabs could subtract it from 100vh. The
 * page below now scrolls as one document, so nothing needs to know how tall
 * anything else is.
 *
 * ── WHERE THE ACTIONS LIVE, AND WHY IT IS TWO PLACES ────────────────────────
 * "Edit profile" rides the username on the identity row. It is a property OF
 * the person on screen and it is the only control your own page has, so
 * giving it a line of its own bought nothing.
 *
 * Back and the follow controls share a row ABOVE the avatar, and that row is
 * rendered only when something is standing in it (`showActionRow`). On YOUR
 * OWN profile there is neither, whichever door you came through: your page is
 * a destination and gets no arrow (see profileEntry), and you do not follow
 * yourself. The row rendered anyway as an empty 32px band: the reserved
 * gutter the owner asked us to delete. So the row above the avatar is now
 * somebody else's row, entirely.
 *
 * The four counts are not tabs. Posts and Replies drive the feed's filter
 * right below; Followers and Following open a sheet. A number you can tap is
 * a better affordance than a tab bar that hides four fifths of itself.
 */

const COUNT_ORDER = ["posts", "replies", "followers", "following"] as const
export type CountKey = (typeof COUNT_ORDER)[number]

export interface ProfileHeadUser {
  id: string
  display_name?: string | null
  username?: string | null
  bio?: string | null
  profile_photo_url?: string | null
  twitter_id?: string | null
}

export function ProfileHead({
  user,
  organizations,
  counts,
  isOwnProfile,
  isFollowing,
  notifyOn,
  onBack,
  onEdit,
  onToggleNotify,
  onCount,
  activeCount,
}: {
  user: ProfileHeadUser
  organizations: any[]
  counts: Record<CountKey, number> | null
  isOwnProfile: boolean
  isFollowing: boolean
  notifyOn: boolean
  onBack?: () => void
  onEdit: () => void
  onToggleNotify: () => void
  onCount: (key: CountKey) => void
  /** Which count is currently driving the feed, so it can read as selected. */
  activeCount: CountKey | null
}) {
  const [bioOpen, setBioOpen] = useState(false)
  const name = user.display_name || user.username || "Someone"

  /**
   * The row above the avatar costs 32px, so it only exists when it has an
   * occupant, and both of its occupants belong to somebody else's page: the
   * back arrow (views/profile.tsx hands `onBack` down only when this is not
   * you) and the follow controls. `!isOwnProfile` is kept alongside `onBack`
   * rather than folded into it, so a caller that forgets to hand us a back
   * handler still gets a Follow button instead of silently losing it, and
   * `Boolean(onBack)` so a handler that IS handed down is never swallowed by
   * a row that decided not to render. Neither term is redundant to a caller
   * that gets the other one wrong.
   */
  const showActionRow = Boolean(onBack) || !isOwnProfile

  return (
    <Box sx={{ px: 2, pt: 1.5 }}>
      {/* SOMEBODY ELSE'S ROW: back, and the follow controls, on the same
          line as each other and nothing else. (The old header floated both
          over the avatar at z-index 9999999 — that part is still worth not
          repeating.) "Edit profile" used to sit here too, which is what
          left this row empty on your own profile; it is on the identity
          row below now, and this row renders only when `showActionRow`
          says somebody is standing in it — which on your own profile is
          nobody, whichever door you came through. minHeight stays 32 — it
          is the height of the back and notify pills. */}
      {showActionRow && (
        <Box sx={{ display: "flex", alignItems: "center", minHeight: 32 }}>
          {onBack && (
            <Box
              component="button"
              onClick={onBack}
              aria-label="Back"
              className="click-animation"
              sx={{
                ...PANEL_PILL,
                width: 32,
                height: 32,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                color: "#FFFFFF",
                p: 0,
                "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
              }}
            >
              <ArrowBackIcon sx={{ fontSize: 16 }} />
            </Box>
          )}
          {/* The spacer, not `justifyContent`: it has to push the follow
              controls right whether or not the arrow is on the left. */}
          <Box sx={{ flex: 1 }} />
          {!isOwnProfile && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {isFollowing && (
                <Box
                  component="button"
                  onClick={onToggleNotify}
                  aria-label={notifyOn ? "Turn off alerts" : "Turn on alerts"}
                  className="click-animation"
                  sx={{
                    ...PANEL_PILL,
                    width: 32,
                    height: 32,
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                    p: 0,
                    color: notifyOn ? ACCENT : "#FFFFFF",
                  }}
                >
                  {notifyOn ? <NotificationsIcon /> : <NotificationsOffIcon />}
                </Box>
              )}
              <FollowButton isFollowing={isFollowing} show userId={user.id} />
            </Box>
          )}
        </Box>
      )}

      {/* Identity, and — on your own page — the one thing you can do to it.
          The avatar carries the accent ring the card's own head uses, so a
          face reads as the same object on both surfaces. `mt` follows the
          row above: with that row gone there is nothing for 8px to separate
          this from, and the margin would just be the deleted gutter wearing
          a smaller hat. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mt: showActionRow ? 1 : 0,
        }}
      >
        <CAvatar
          src={user.profile_photo_url || undefined}
          sx={{
            width: 62,
            height: 62,
            flexShrink: 0,
            boxShadow: `0 0 0 2px ${alpha(ACCENT, 0.55)}, 0 8px 24px -10px ${alpha(ACCENT, 0.8)}`,
          }}
        />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <Typography
              sx={{
                fontSize: 19,
                fontWeight: 700,
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </Typography>
            {/* flexShrink:0 on both badges is fallout from Edit profile
                moving onto this row: the name block is ~100px narrower at
                320px now, and a badge sized only by width/height is happy
                to squash into an oval under that pressure. The NAME is what
                gives — it already truncates. */}
            {organizations.slice(0, 3).map((org) => (
              <OrganizationBadge
                key={org.id}
                organization={org}
                size={15}
                sx={{ flexShrink: 0 }}
              />
            ))}
            {user.twitter_id && (
              <TwitterBadge
                twitterId={user.twitter_id}
                sx={{
                  position: "relative",
                  right: "auto",
                  bottom: "auto",
                  ml: "0px !important",
                  width: "15px",
                  height: "15px",
                  flexShrink: 0,
                }}
              />
            )}
          </Box>
          {/* The handle had no truncation at all, which was survivable while
              this row was avatar + name and nothing else. With the button
              on it, a long unbroken @handle now runs under the button and
              gets sliced by profile.tsx's overflowX:"hidden" — so it
              ellipses like the display name above it. */}
          <Typography
            sx={{
              fontSize: 12.5,
              fontWeight: 600,
              color: DIM,
              mt: "2px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            @{user.username}
          </Typography>
        </Box>

        {/* EDIT PROFILE RIDES THE NAME. It used to share a dedicated line
            with the back arrow; with the arrow gone from your own profile
            that line was an empty 32px band above the avatar — the reserved
            gutter that was reported. Flush right because it is the only
            other thing on the row and the name block is flex:1.

            flexShrink:0 + whiteSpace:nowrap are load-bearing, not polish.
            The panel is 320px at its narrowest (288px inside px:2) and this
            row is avatar 62 + gap 12 + name + gap 12 + this pill. Without
            them the pill is the item that gives, "Edit profile" wraps to
            two lines and the whole identity row grows taller than the
            avatar. The name block is the flex:1 minWidth:0 child, so it is
            the half that truncates — which is the right half to lose. */}
        {isOwnProfile && (
          <Box
            component="button"
            onClick={onEdit}
            className="click-animation"
            sx={{
              ...PANEL_PILL,
              flexShrink: 0,
              whiteSpace: "nowrap",
              px: 1.75,
              py: "7px",
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              color: "#FFFFFF",
              "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
            }}
          >
            Edit profile
          </Box>
        )}
      </Box>

      {/* Bio. Three lines, then it opens — measured by the browser, not by a
          store. */}
      {user.bio && (
        <Typography
          onClick={() => setBioOpen((v) => !v)}
          sx={{
            mt: 1.25,
            fontSize: 13,
            lineHeight: 1.45,
            color: "rgba(255,255,255,.78)",
            cursor: "pointer",
            ...(bioOpen
              ? {}
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }),
          }}
        >
          {user.bio}
        </Typography>
      )}

      {/* Four numbers, four doors. */}
      <Box sx={{ display: "flex", gap: 0.5, mt: 1.5 }}>
        {COUNT_ORDER.map((key) => {
          const active = activeCount === key
          return (
            <Box
              key={key}
              component="button"
              onClick={() => onCount(key)}
              className="click-animation"
              sx={{
                flex: 1,
                minWidth: 0,
                border: "none",
                cursor: "pointer",
                font: "inherit",
                textAlign: "center",
                py: "7px",
                borderRadius: "12px",
                backgroundColor: active ? alpha(ACCENT, 0.14) : "transparent",
                transition: "background-color .14s ease-out",
                "&:hover": {
                  backgroundColor: active ? alpha(ACCENT, 0.18) : alpha("#FFFFFF", 0.05),
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  fontVariantNumeric: "tabular-nums",
                  color: active ? ACCENT : "#FFFFFF",
                }}
              >
                {counts === null ? "—" : (counts[key] ?? 0)}
              </Typography>
              <Typography
                sx={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: ".02em",
                  color: active ? alpha(ACCENT, 0.85) : FAINT,
                  textTransform: "capitalize",
                }}
              >
                {key}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
