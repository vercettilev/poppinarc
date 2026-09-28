import { useInfiniteQuery } from "@tanstack/react-query"
import { WebsitePostService } from "~/services/WebsitePostService"
import type { WebsitePost } from "~/types/websitePost"

interface UserCommentsResponse {
  data: WebsitePost[]
  meta: {
    cursor: string | null
  }
}

interface UseUserCommentsParams {
  userId: string
  limit?: number
  enabled?: boolean
}

export function useUserComments({
  userId,
  limit = 20,
  enabled = true,
}: UseUserCommentsParams) {
  return useInfiniteQuery<UserCommentsResponse>({
    queryKey: ["userComments", userId],
    queryFn: ({ pageParam = undefined }) =>
      WebsitePostService.getUserComments({
        userId,
        limit,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.cursor ?? false,
    getPreviousPageParam: () => null,
    enabled: enabled && !!userId,
  })
}
