import { useQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

export function useFollowingStatus(userIds: string[]) {
  return useQuery({
    queryKey: ["followingStatus", userIds],
    queryFn: () => UserService.getFollowingStatus(userIds),
    enabled: userIds.length > 0,
    staleTime: 30000, // Consider the data stale after 30 seconds
    placeholderData: (previousData) => previousData, // Keep previous data while fetching
  })
}
