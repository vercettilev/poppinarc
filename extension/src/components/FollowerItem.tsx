import { alpha, Box, Stack, Typography, useTheme } from "@mui/material"
import { memo } from "react"
import { useNavigate } from "react-router"
import { CAvatar } from "./CAvatar"
import { StreakBadge } from "./StreakBadge"
import { Organization } from "~/services/UserService"
import { FollowButton } from "~/components/FollowButton"

/**
 * A ROW IN THE FOLLOWERS / FOLLOWING SHEET.
 *
 * THE ROW IS ABOUT THE PERSON IN IT. This component used to ask
 * `useFollowingStatus([currentUser.id])` — the reader's OWN follow status —
 * match on `following_id === currentUser.id`, and then hand
 * `userId={currentUser.id}` to the button. Three expressions, one mistake
 * repeated: every row in the sheet described the reader instead of the person
 * standing in it, so the button showed the same state on all of them and
 * pressing it asked the API to follow yourself. Meanwhile the correct answer
 * was already arriving as the `isFollowing` PROP and was never read.
 *
 * The prop is the source of truth, and deliberately so: FollowersTab and
 * FollowingTab run ONE batched `useFollowingStatus(userIds)` for the whole
 * page and match on the listed user's id. A per-row query would be one
 * request per visible row for an answer the parent already has, and it would
 * be keyed on a different array, so `useFollowUser`'s optimistic patch
 * (which rewrites every ["followingStatus"] cache) would land in two places
 * that could disagree.
 *
 * Consequence worth keeping in mind: this row does not know the reader at
 * all any more. There is no `currentUser!` to force-unwrap, so the sheet no
 * longer throws when it renders before the user query has settled — which it
 * can, because the parents render rows unconditionally and only gate
 * `showFollowButton` on `currentUser` being there.
 */
interface FollowerItemProps {
  follower: {
    id: string
    username: string
    display_name: string
    profile_photo_url: string | null
    activeStreakCount?: number
  }
  /**
   * Does the READER follow `follower.id`. Comes from the parent's batched
   * status query — see the note above; do not re-derive it here.
   */
  isFollowing: boolean
  showFollowButton: boolean
  userOrganizations?: Organization[]
}

export const FollowerItem = memo(function FollowerItem({
  follower,
  isFollowing,
  showFollowButton,
  userOrganizations,
}: FollowerItemProps) {
  const theme = useTheme()
  /**
   * TAPPING A PERSON IN THIS SHEET USED TO DO NOTHING AT ALL.
   *
   * Both the avatar and the name called `navigate()` from helpers/navigation,
   * a module that held its own `navigateFunction` and only ever used it if
   * something called `setNavigateFunction` first. Nothing did — that export
   * had exactly one occurrence in the whole tree, its own declaration — so
   * every call took the fallback branch and posted a `NAVIGATE` message to
   * the service worker, which broadcast a `"route-store"` state update that
   * the panel's store map (store/index.ts) has no key for. Two dead taps and
   * a TypeError in the panel's console, on the two commonest controls in the
   * followers/following sheet. The panel routes through MemoryRouter
   * (providers/RouterWrapper.tsx), so react-router's own hook is the only
   * thing that can move it; the helper is gone.
   */
  const navigate = useNavigate()

  /**
   * Coerced once, so the guard below can be a plain number comparison.
   * `{count && count > 0 && <Badge/>}` renders a literal 0 when count is 0,
   * and the parents pass `current_streak || 0` — so every streakless row was
   * drawing a bare "0" beside the name, a text node that still counts as a
   * flex item and still earns the row's gap. The retired leaderboard row
   * sidesteps this with a `? :`; this row did not.
   */
  const streakCount = follower.activeStreakCount ?? 0

  const handleProfileClick = () => {
    navigate(`/profile/${follower.id}`)
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        py: 1.5,
        px: 2,
        borderBottom: `0.5px solid ${alpha(theme.palette.tetriary.contrastText, 0.2)}`,
      }}
    >
      {/* THE ROW FITS; IT DOES NOT SLIDE. A flex item's default min-width is
          its content, so minWidth:0 has to be repeated down every level from
          here to the text — one missing link and the name cannot ellipsize,
          it just pushes the button off the row. The avatar is fixed and the
          button refuses to shrink (see ButtonWrapper), so this column is the
          only thing left that may give, and it gives by truncating. */}
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        sx={{ minWidth: 0, flex: 1 }}
      >
        <CAvatar
          src={follower.profile_photo_url || undefined}
          sx={{
            width: 40,
            height: 40,
            flexShrink: 0,
            cursor: "pointer",
            "&:hover": {
              opacity: 0.8,
            },
          }}
          onClick={handleProfileClick}
        />
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontSize: "14px",
                fontWeight: 500,
                color: theme.palette.tetriary.contrastText,
                cursor: "pointer",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                // Paint only. Underlining on hover costs no layout; anything
                // that changed weight or padding here would slide the badges
                // beside it every time the pointer crossed a row.
                "&:hover": {
                  textDecoration: "underline",
                },
              }}
              onClick={handleProfileClick}
            >
              {follower.display_name}
            </Typography>
            {streakCount > 0 && <StreakBadge streakCount={streakCount} />}
            {userOrganizations && userOrganizations.length > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                {userOrganizations.slice(0, 3).map((org) => (
                  <Box
                    key={org.id}
                    component="img"
                    src={org.badgeUrl || ""}
                    alt={org.name}
                    sx={{ width: 14, height: 14, flexShrink: 0, borderRadius: "2px" }}
                  />
                ))}
                {userOrganizations.length > 3 && (
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: "10px",
                      flexShrink: 0,
                      color: alpha(theme.palette.tetriary.contrastText, 0.6),
                    }}
                  >
                    +{userOrganizations.length - 3}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
          <Typography
            variant="body2"
            sx={{
              fontSize: "12px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: alpha(theme.palette.tetriary.contrastText, 0.6),
            }}
          >
            @{follower.username}
          </Typography>
        </Box>
      </Stack>

      {/*
        THE WORD, NOT THE GLYPH. This sheet exists to answer "do I follow this
        person", so the answer may not depend on telling two 14px icons apart
        — and those two icons are FollowIcon and UnfollowIcon, which draw the
        identical person and horizontal bar and differ by one extra vertical
        stroke 18.4 units wide in a 500-unit viewBox. `isExtended` spells it:
        "Follow +" / "Following ×".

        `animated={false}` because these mount by the pageful. The animated
        path starts from the stylesheet's 24px and tweens to the extended
        width, so every row would pop wider on arrival and flash the wrong
        fill before settling; static is correct on the first paint.
      */}
      <FollowButton
        isFollowing={isFollowing}
        show={showFollowButton}
        userId={follower.id}
        isExtended
        animated={false}
      />
    </Box>
  )
})
