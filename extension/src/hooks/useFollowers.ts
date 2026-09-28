import { useInfiniteQuery } from "@tanstack/react-query"
import type { User } from "~/services/UserService"
import { UserService } from "~/services/UserService"

interface FollowersResponse {
  data: User[]
  meta: {
    cursor: string | null
  }
}

interface UseFollowersParams {
  userId: string
  limit?: number
  enabled?: boolean
}

export function useFollowers({
  userId,
  limit = 20,
  enabled = true,
}: UseFollowersParams) {
  return useInfiniteQuery<FollowersResponse>({
    queryKey: ["followers", userId],
    queryFn: ({ pageParam = undefined }) =>
      UserService.getFollowers({
        userId,
        limit,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.cursor || undefined,
    getPreviousPageParam: () => null,
    enabled: enabled && !!userId,
  })
}
