import { Box, CircularProgress } from "@mui/material"
import { useRef } from "react"
import CustomInfiniteScroll from "~/components/CustomInfiniteScroll"
import EmptyState from "~/components/EmptyState"
import { FollowerItem } from "~/components/FollowerItem"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useFollowing } from "~/hooks/useFollowing"
import { useFollowingStatus } from "~/hooks/useFollowingStatus"
import { useBulkUserOrganizations } from "~/hooks/useBulkUserOrganizations"
import { useUserStreaksByIds } from "~/hooks/useStreaks"
import { ProfileTabProps } from "./types"

export function FollowingTab({ userId }: ProfileTabProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { data: currentUser } = useCurrentUser()
  
  const {
    data: followingData,
    fetchNextPage: fetchFollowing,
    hasNextPage: hasMoreFollowing,
    isLoading: isFollowingLoading,
    isFetchingNextPage,
  } = useFollowing({
    userId,
    limit: 20,
    enabled: true,
  })

  // Get all user IDs for following status
  const userIds =
    followingData?.pages.flatMap((page) => page.data.map((user) => user.id)) ||
    []

  /**
   * ONE BATCHED ANSWER FOR THE WHOLE PAGE, and it is the row's only source
   * of truth — same contract as FollowersTab.
   *
   * Note that this list is who `userId` follows, which is NOT the same
   * question: on somebody else's profile you may follow none of them. So the
   * answer still has to be asked per listed id and matched on
   * `status.following_id === following.id`; it cannot be assumed true just
   * because the tab is called Following.
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


  if (isFollowingLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!followingData?.pages[0]?.data.length) {
    return <EmptyState type="following" />
  }

  return (
    <Box
      id="scrollableFollowingContainer"
      ref={scrollContainerRef}
      // Fills its container — PeopleSheet is 82vh, and a list that
      // subtracts 220px from the VIEWPORT inside a sheet is measuring
      // the wrong box. The sheet owns the height; this owns the scroll.
      style={{ height: "100%", overflow: "auto" }}
    >
      <CustomInfiniteScroll
        onLoadMore={fetchFollowing}
        hasMore={!!hasMoreFollowing}
        isLoading={isFetchingNextPage}
        containerRef={scrollContainerRef}
        loadingComponent={customLoadingComponent}
      >
        {followingData?.pages.map((page) =>
          page.data.map((following) => {
            const userStreak = userStreaks?.find((s) => s.user_id === following.id)
            return (
              <FollowerItem
                key={following.id}
                follower={{
                  ...following,
                  activeStreakCount: userStreak?.current_streak || 0
                }}
                isFollowing={
                  !!followingStatus?.find(
                    (status) => status.following_id === following.id
                  )
                }
                showFollowButton={
                  !!currentUser &&
                  currentUser.id !== following.id &&
                  !isFollowingStatusLoading
                }
                userOrganizations={getOrganizationsForUser(following.id)}
              />
            )
          })
        )}
      </CustomInfiniteScroll>
    </Box>
  )
}
