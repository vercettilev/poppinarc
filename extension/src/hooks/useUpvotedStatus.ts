import { useQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

export function useUpvotedStatus(postIds: string[], type?: string) {
  return useQuery({
    queryKey: ["upvoted-status", postIds, type],
    queryFn: () => UserService.getUpvotedStatus(postIds, type),
    enabled: postIds.length > 0,
    staleTime: 30000, // Consider the data stale after 30 seconds
  })
}
