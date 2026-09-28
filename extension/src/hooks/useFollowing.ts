import { useInfiniteQuery } from "@tanstack/react-query"
import type { User } from "~/services/UserService"
import { UserService } from "~/services/UserService"

interface FollowingResponse {
  data: User[]
  meta: {
    cursor: string | null
  }
}

interface UseFollowingParams {
  userId: string
  limit?: number
  enabled?: boolean
}

export function useFollowing({
  userId,
  limit = 20,
  enabled = true,
}: UseFollowingParams) {
  return useInfiniteQuery<FollowingResponse>({
    queryKey: ["following", userId],
    queryFn: ({ pageParam = undefined }) =>
      {
        return UserService.getFollowing({
          userId,
          limit,
          cursor: pageParam as string | undefined,
        })
      },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      return lastPage.meta.cursor || undefined
    },
    getPreviousPageParam: () => null,
    enabled: enabled && !!userId,
  })
}
