import { useQuery } from "@tanstack/react-query"
import { StreakService, UserStreakStatus } from "~/services/StreakService"

/**
 * Hook to fetch streak information for multiple users
 * @param userIds Array of user IDs to fetch streaks for
 * @param enabled Whether the query should be enabled (default: true)
 * @returns Query result with user streaks mapped by user ID
 */
export const useUserStreaks = (userIds: string[], enabled: boolean = true) => {
  return useQuery<UserStreakStatus[], Error, Map<string, number>>({
    queryKey: ["user-streaks", ...userIds.sort()],
    queryFn: async () => {
      if (!userIds || userIds.length === 0) {
        return []
      }
      const response = await StreakService.getUserStreaksByIds(userIds)
      return response as UserStreakStatus[]
    },
    select: (data) => {
      // Convert array to Map for easy lookup
      const streakMap = new Map<string, number>()
      data.forEach((streak) => {
        streakMap.set(streak.user_id, streak.current_streak)
      })
      return streakMap
    },
    enabled: enabled && userIds.length > 0,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
