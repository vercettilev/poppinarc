import { JUICE } from "~/theme/juice"
import { Box, Typography } from "@mui/material"
import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import Loading from "~/components/Loading"
import { PeopleSheet } from "~/components/profile/PeopleSheet"
import {
  ProfileFeed,
  ProfileFeedFilter,
  type ProfileFeedKind,
} from "~/components/profile/ProfileFeed"
import { ProfileHead, type CountKey } from "~/components/profile/ProfileHead"
import { isOwnProfileView } from "~/components/profile/profileEntry"
import { BestTrades } from "~/components/profile/BestTrades"
import { CAP } from "~/config/edition"
import { ProfilePortfolio } from "~/components/profile/ProfilePortfolio"
import { YourBook } from "~/components/profile/YourBook"
import { ACCENT, DIM, PANEL_PILL } from "~/helpers/panelSurface"
import { useBulkUserOrganizations } from "~/hooks/useBulkUserOrganizations"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useFollowingStatus } from "~/hooks/useFollowingStatus"
import { useFollowNotify } from "~/hooks/useFollowNotify"
import { useProfileCounts } from "~/hooks/useProfileCounts"
import { useUser } from "~/hooks/useUser"
import { UserService } from "~/services/UserService"
import { useUIStore } from "~/store/useUIStore"
import { TipDialog } from "~/views/wallet/TipDialog"

/**
 * Somebody's profile: who they are, what they hold, what they said.
 *
 * ── THE TWO BUGS THIS REPLACES ──────────────────────────────────────────────
 * 1. The page never read `params.userId`. The route is `/profile/:userId` and
 *    the component took the id from props or from navigation state only, so
 *    every plain `navigate('/profile/' + id)` — from a post header, from the
 *    card's post list — quietly rendered YOUR profile with somebody else's
 *    address in the bar.
 *
 * 2. The render gate asked the wrong query whether it was ready. It consulted
 *    `useUser(userId)`, which is DISABLED on your own profile, and never
 *    looked at `useCurrentUser().isLoading`. So while the current user was
 *    still in flight the page fell straight through to the literal string
 *    "User not found" on an otherwise blank screen — which is what "profile
 *    doesn't open" looks like.
 *
 * The gate below waits on whichever query actually owns `user`, and being
 * signed out is answered as being signed out rather than as a missing person.
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 * Head (identity, one action, four counts) → your portfolio, if it is yours →
 * one filtered feed. Five tabs became one feed with a filter, and the two
 * tabs that listed PEOPLE became a sheet; see ProfileFeed's header for why.
 * The whole page scrolls as one document, so nothing measures anything else's
 * height into a store any more.
 */

export default function Profile(props: { userId?: string; username?: string }) {
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { setIsSignInModalOpen } = useUIStore()

  /** A username in props is the only identity that needs a lookup. */
  const [resolvedId, setResolvedId] = useState<string | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [lookingUp, setLookingUp] = useState(Boolean(props.username))

  useEffect(() => {
    if (!props.username) {
      setLookingUp(false)
      return
    }
    let alive = true
    setLookingUp(true)
    setLookupFailed(false)
    UserService.getUserByUsername(props.username)
      .then((u) => {
        if (!alive) return
        setResolvedId(u.id)
        setLookingUp(false)
      })
      .catch(() => {
        if (!alive) return
        setLookupFailed(true)
        setLookingUp(false)
      })
    return () => {
      alive = false
    }
  }, [props.username])

  /**
   * Every way this page can be told who to show, in priority order. The route
   * param is in here now; leaving it out was bug 1.
   */
  const targetId =
    props.userId || params.userId || resolvedId || (location.state?.userId as string) || null

  const { data: currentUser, isLoading: meLoading } = useCurrentUser()

  /**
   * WHOSE PAGE THIS IS — one answer, used by everything that depends on it:
   * which query owns `user`, which of the owner-only panels render, and
   * whether the head is allowed a back arrow. It lives in
   * components/profile/profileEntry so the arrow rule can be stated and
   * tested in one place; the expression it replaced was this same
   * `!targetId || targetId === currentUser?.id`, inline.
   */
  const isOwnProfile = isOwnProfileView({
    targetId,
    currentUserId: currentUser?.id,
  })

  const { data: otherUser, isLoading: otherLoading } = useUser(
    isOwnProfile ? undefined : (targetId ?? undefined),
  )

  const user = isOwnProfile ? currentUser : otherUser
  const pending = lookingUp || (isOwnProfile ? meLoading : otherLoading)

  const { data: counts } = useProfileCounts(user?.id)
  const { getOrganizationsForUser } = useBulkUserOrganizations(user?.id ? [user.id] : [])
  const organizations = useMemo(
    () => (user?.id ? getOrganizationsForUser(user.id) : []),
    [user?.id, getOrganizationsForUser],
  )

  const { data: followingStatus } = useFollowingStatus(
    currentUser?.id && user?.id && currentUser.id !== user.id ? [user.id] : [],
  )
  const status = followingStatus?.find((s) => s.following_id === user?.id)
  const { updateFollowNotify } = useFollowNotify()

  /** The one scrolling element; the feed's infinite scroll observes it. */
  const scrollRef = useRef<HTMLDivElement>(null)

  const [kind, setKind] = useState<ProfileFeedKind>("all")
  const [tipData, setTipData] = useState<{
    user: { id: string; username: string; display_name?: string; wallet_address?: string | null }
    postId: string
  } | null>(null)
  const [sheet, setSheet] = useState<"followers" | "following" | null>(null)

  // A different person means a fresh page, not the last one's filter.
  useEffect(() => {
    setKind("all")
    setSheet(null)
  }, [user?.id])

  const goBack = () =>
    window.history.length > 1 ? navigate(-1) : navigate("/", { state: { from: "profile" } })

  if (pending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <Loading />
      </Box>
    )
  }

  // Signed out is not "this person does not exist".
  if (isOwnProfile && !currentUser) {
    return (
      <Gate
        title="Sign in to see your profile"
        body="Your posts, your trades and your portfolio live here."
        action="Sign in"
        onAction={() => setIsSignInModalOpen(true)}
      />
    )
  }

  if (lookupFailed || !user) {
    return (
      <Gate
        title="Profile not found"
        body={
          props.username
            ? `@${props.username} does not exist.`
            : "That profile is not available."
        }
        action="Back to feed"
        onAction={goBack}
      />
    )
  }

  const onCount = (key: CountKey) => {
    if (key === "followers" || key === "following") {
      setSheet(key)
      return
    }
    // Tapping a count is a shortcut INTO the feed's filter, not a second
    // navigation model that has to agree with it.
    setKind((k) => (k === key ? "all" : key))
  }

  return (
    // flex:1 + minHeight:0, NOT height:100%. The page renders inside
    // Layout's flex column next to the Header; height:100% measures the
    // whole column, so the page overflowed a parent that clips and nothing
    // scrolled. Reported as "başka birinin feedine girdiğimde scroll
    // layamıyorum" — same on every profile, own included.
    <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
      <ProfileHead
        user={user as any}
        organizations={organizations}
        /**
         * NULL UNTIL THE ANSWER LANDS. The page's loading gate never waited
         * on this query, so the first frame painted "0 Posts · 0 Replies ·
         * 0 Followers · 0 Following" at somebody with hundreds of each, and
         * then flipped. Four zeros is a claim, not a loading state; the
         * head draws a placeholder for null instead. Same rule the money
         * block one screen down already follows.
         */
        counts={
          counts
            ? {
                posts: counts.website_post_count ?? 0,
                replies: counts.reply_count ?? 0,
                followers: counts.followers_count ?? 0,
                following: counts.followings_count ?? 0,
              }
            : null
        }
        isOwnProfile={isOwnProfile}
        isFollowing={Boolean(status)}
        notifyOn={Boolean(status?.notify)}
        // NO ARROW ON YOUR OWN PROFILE, WHICHEVER DOOR YOU CAME THROUGH.
        // Your page is a destination: the header's identity row and its
        // Feed pill are still on screen above it, so the arrow pointed
        // nowhere and reserved a 32px band to do it in. Gating this on
        // "was the screen pushed" instead put the band straight back the
        // moment you tapped your own face in the feed, because that door
        // names an id (PostHeader.tsx:105-111) — see profileEntry.
        // Somebody else's page keeps the arrow: that IS a pushed screen,
        // and for the ProfileDetailView overlay this control is the only
        // thing that clears the navigation state. Your own profile can no
        // longer be that overlay at all — ProfileDetailView redirects a
        // self-targeted overlay to the `/profile` tab.
        onBack={isOwnProfile ? undefined : goBack}
        onEdit={() => navigate("/edit-profile")}
        onToggleNotify={() =>
          user?.id && updateFollowNotify({ userId: user.id, notify: !status?.notify })
        }
        onCount={onCount}
        activeCount={kind === "posts" ? "posts" : kind === "replies" ? "replies" : null}
      />

      {isOwnProfile && <ProfilePortfolio />}

      {/* THE VITRINE, on every profile: the best closed lots, biggest
          first. Somebody else's arrive only if they publish them, and the
          server decides that, not this page. Silent when empty. */}
      {CAP.social && <BestTrades userId={user.id} own={isOwnProfile} />}

      {/* Orders, watchlist, alerts and linked wallets used to stand open
          here, four headings deep, most of them empty on most days. They
          fold into one block now — nothing removed, only the default view.
          A profile is a vitrine, and a vitrine does not open its drawers. */}
      {isOwnProfile && <YourBook />}

      <ProfileFeedFilter kind={kind} onChange={setKind} showUpvoted={isOwnProfile} />
      <ProfileFeed
        userId={user.id}
        kind={kind}
        isOwnProfile={isOwnProfile}
        scrollRef={scrollRef}
        onTip={(d) => setTipData(d)}
      />

      {/* The tip door's other home. The dialog moves real money and was
          reachable from the main feed only - not from the profile, which
          is where somebody is actually admiring another person's calls. */}
      <TipDialog
        open={tipData !== null}
        onClose={() => setTipData(null)}
        recipient={tipData?.user ?? null}
        postId={tipData?.postId}
      />

      <PeopleSheet
        open={sheet !== null}
        which={sheet ?? "followers"}
        userId={user.id}
        onClose={() => setSheet(null)}
      />
    </Box>
  )
}

/**
 * Every dead end on this page, in one shape: a sentence that says what
 * happened and a button that does the only useful thing next. The page used
 * to render the bare words "User not found" with nothing to press.
 */
function Gate({
  title,
  body,
  action,
  onAction,
}: {
  title: string
  body: string
  action: string
  onAction: () => void
}) {
  return (
    <Box sx={{ textAlign: "center", px: 4, py: 7 }}>
      <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{title}</Typography>
      <Typography sx={{ fontSize: 13, color: DIM, mt: 1, lineHeight: 1.5 }}>{body}</Typography>
      <Box
        component="button"
        onClick={onAction}
        className="click-animation"
        sx={{
          ...PANEL_PILL,
          mt: 2.5,
          px: 2.5,
          py: "9px",
          cursor: "pointer",
          font: "inherit",
          fontSize: 13,
          fontWeight: 700,
          color: JUICE.onAccent,
          backgroundColor: ACCENT,
          border: "none",
          boxShadow: "0 8px 26px -8px rgba(104,198,255,.55)",
        }}
      >
        {action}
      </Box>
    </Box>
  )
}
