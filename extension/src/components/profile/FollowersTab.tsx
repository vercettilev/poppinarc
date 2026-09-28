import { Box, CircularProgress } from "@mui/material"
import { useRef } from "react"
import CustomInfiniteScroll from "~/components/CustomInfiniteScroll"
import EmptyState from "~/components/EmptyState"
import { FollowerItem } from "~/components/FollowerItem"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useFollowers } from "~/hooks/useFollowers"
import { useFollowingStatus } from "~/hooks/useFollowingStatus"
import { useBulkUserOrganizations } from "~/hooks/useBulkUserOrganizations"
import { useUserStreaksByIds } from "~/hooks/useStreaks"
import { ProfileTabProps } from "./types"

export function FollowersTab({ userId }: ProfileTabProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { data: currentUser } = useCurrentUser()
  
  const {
    data: followersData,
    fetchNextPage: fetchFollowers,
    hasNextPage: hasMoreFollowers,
    isLoading: isFollowersLoading,
    isFetchingNextPage,
  } = useFollowers({
    userId,
    limit: 20,
    enabled: true,
  })


  // Get all user IDs for following status
  const userIds =
    followersData?.pages.flatMap((page) => page.data.map((user) => user.id)) ||
    []


  /**
   * ONE BATCHED ANSWER FOR THE WHOLE PAGE, and it is the row's only source
   * of truth. "Do I follow this person" is asked here, for every id on the
   * page at once, and handed down as `isFollowing`. FollowerItem used to
   * ignore that prop and run its own query keyed on the READER's id, so
   * every row reported the reader's state instead of the listed user's —
   * see the note at the top of FollowerItem.tsx. Nothing below may re-derive
   * this.
   */
  const { data: followingStatus, isLoading: isFollowingStatusLoading } =
    useFollowingStatus(currentUser ? userIds : [])

  // Get user organizations
  const { getOrganizationsForUser } = useBulkUserOrganizations(userIds)

  // Get user streaks
  const { data: userStreaks } = useUserStreaksByIds(userIds)

  const customLoadingComponent = (
    <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
      <CircularProgress />
    </Box>
  )

  if (isFollowersLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!followersData?.pages[0]?.data.length) {
    return <EmptyState type="followers" />
  }

  return (
    <Box
      id="scrollableFollowersContainer"
      ref={scrollContainerRef}
      // Fills its container — PeopleSheet is 82vh, and a list that
      // subtracts 220px from the VIEWPORT inside a sheet is measuring
      // the wrong box. The sheet owns the height; this owns the scroll.
      style={{ height: "100%", overflow: "auto" }}
    >
      <CustomInfiniteScroll
        onLoadMore={fetchFollowers}
        hasMore={!!hasMoreFollowers}
        isLoading={isFetchingNextPage}
        containerRef={scrollContainerRef}
        loadingComponent={customLoadingComponent}
      >
        {followersData?.pages.map((page) =>
          page.data.map((follower) => {
            const userStreak = userStreaks?.find((s) => s.user_id === follower.id)
            return (
              <FollowerItem
                key={follower.id}
                follower={{
                  ...follower,
                  activeStreakCount: userStreak?.current_streak || 0
                }}
                isFollowing={
                  !!followingStatus?.find(
                    (status) => status.following_id === follower.id
                  )
                }
                showFollowButton={
                  !!currentUser &&
                  currentUser.id !== follower.id &&
                  !isFollowingStatusLoading
                }
                userOrganizations={getOrganizationsForUser(follower.id)}
              />
            )
          })
        )}
      </CustomInfiniteScroll>
    </Box>
  )
}
