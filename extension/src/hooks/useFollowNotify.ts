import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

/**
 * Hook for updating notification preferences for a followed user
 * @returns Mutation for updating notification preferences
 */
export const useFollowNotify = () => {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: ({ userId, notify }: { userId: string; notify: boolean }) => {
      return UserService.updateFollowNotify(userId, notify)
    },
    onMutate: async ({ userId, notify }) => {
      // Cancel any outgoing refetches for any followingStatus query
      await queryClient.cancelQueries({ queryKey: ["followingStatus"] })

      // Get all existing followingStatus query keys
      const queryCache = queryClient.getQueryCache()
      const followingStatusQueries = queryCache.findAll({
        queryKey: ["followingStatus"],
      })

      // Store previous data for all affected queries
      const previousDataMap = new Map()

      // Update all matching queries that contain this userId
      followingStatusQueries.forEach((query) => {
        const data = query.state.data as
          | Array<{ following_id: string; notify: boolean }>
          | undefined

        if (data) {
          // Check if this query's data contains the userId we're updating
          const containsUser = data.some(
            (status) => status.following_id === userId
          )

          if (containsUser) {
            previousDataMap.set(query.queryKey, data)

            // Optimistically update this query
            queryClient.setQueryData(
              query.queryKey,
              data.map((status) =>
                status.following_id === userId ? { ...status, notify } : status
              )
            )
          }
        }
      })

      return { previousDataMap }
    },
    onError: (err, { userId }, context) => {
      // If the mutation fails, roll back all optimistic updates
      if (context?.previousDataMap) {
        context.previousDataMap.forEach((data, queryKey) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: () => {
      // Invalidate all followingStatus queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["followingStatus"] })
    },
  })

  return {
    updateFollowNotify: mutation.mutate,
    isUpdating: mutation.isPending,
  }
}
