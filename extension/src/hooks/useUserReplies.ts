import { useInfiniteQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"
import { Reply } from "~/types/reply"

interface UserRepliesResponse {
  data: Reply[]
  meta: {
    hasNextPage: boolean
    cursor?: string
  }
}

interface UseUserRepliesProps {
  userId: string
  limit?: number
  enabled?: boolean
}

export function useUserReplies({
  userId,
  limit = 10,
  enabled = true,
}: UseUserRepliesProps) {
  return useInfiniteQuery({
    queryKey: ["userReplies", userId],
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      return UserService.getUserReplies(userId, limit, pageParam || undefined)
    },
    getNextPageParam: (lastPage) => lastPage.meta.cursor || undefined,
    enabled,
    initialPageParam: null,
  })
}
