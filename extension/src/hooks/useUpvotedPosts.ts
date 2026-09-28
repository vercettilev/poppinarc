import { useInfiniteQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"
import { Post } from "~/types/post"

interface UpvotedPostsResponse {
  data: Post[]
  meta: {
    cursor: string | null
  }
}

interface UseUpvotedPostsProps {
  userId: string
  limit?: number
  enabled?: boolean
}

export function useUpvotedPosts({
  userId,
  limit = 10,
  enabled = true,
}: UseUpvotedPostsProps) {
  return useInfiniteQuery({
    queryKey: ["upvotedPosts", userId],
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      return UserService.getUpvotedPosts(userId, limit, pageParam || undefined)
    },
    getNextPageParam: (lastPage) => lastPage.meta.cursor,
    enabled,
    initialPageParam: null,
  })
}
