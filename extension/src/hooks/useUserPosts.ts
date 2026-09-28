import { useInfiniteQuery } from "@tanstack/react-query"
import { WebsitePost } from "~/types/websitePost"
import { WebsitePostService } from "~/services/WebsitePostService"

interface UseUserPostsOptions {
  userId: string
  limit?: number
  enabled?: boolean
}

interface UserPostsResponse {
  data: WebsitePost[]
  meta: {
    cursor: string | null
  }
}

export function useUserPosts({
  userId,
  limit = 10,
  enabled = true,
}: UseUserPostsOptions) {
  return useInfiniteQuery<UserPostsResponse>({
    queryKey: ["userPosts", userId],
    queryFn: async ({ pageParam }) => {
      const result = await WebsitePostService.get({
        user_id: userId,
        limit,
        cursor: pageParam as string | undefined,
      })
      return result as unknown as UserPostsResponse
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.cursor ?? undefined,
    enabled: enabled && !!userId,
  })
}
