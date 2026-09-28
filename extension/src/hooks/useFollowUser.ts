import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

/**
 * FOLLOW FLIPS AT TAP SPEED. Votes, posts and comments are all instant;
 * follow - the investment hook that feeds followed-trade notifications -
 * was the one core social action that made the reader wait two round
 * trips behind a spinner. The status caches are patched optimistically
 * (presence in the array IS the following state, same shape
 * useFollowNotify already patches), rolled back on error, and reconciled
 * with the server after settling.
 */
type StatusRow = { following_id: string; notify: boolean }

export function useFollowUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      isFollowing,
    }: {
      userId: string
      isFollowing: boolean
    }) => {
      if (isFollowing) {
        return UserService.unfollowUser(userId)
      }
      return UserService.followUser(userId)
    },
    onMutate: async ({ userId, isFollowing }) => {
      await queryClient.cancelQueries({ queryKey: ["followingStatus"] })
      const snapshots = queryClient.getQueriesData<StatusRow[]>({
        queryKey: ["followingStatus"],
      })
      queryClient.setQueriesData<StatusRow[]>(
        { queryKey: ["followingStatus"] },
        (data) => {
          if (!Array.isArray(data)) return data
          if (isFollowing) {
            return data.filter((s) => s.following_id !== userId)
          }
          if (data.some((s) => s.following_id === userId)) return data
          return [...data, { following_id: userId, notify: false }]
        },
      )
      return { snapshots }
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data)
      }
    },
    onSettled: () => {
      // One reconciliation after the dust settles - the server's word on
      // counts and edge cases, not the reader's wait.
      queryClient.invalidateQueries({ queryKey: ["followingStatus"] })
    },
  })
}
