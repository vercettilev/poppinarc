import { InfiniteData } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import { useUserStreaksByIds } from "~/hooks/useStreaks"
import { PaginatedData } from "~/types/fetchTypes"
import { WebsitePost } from "~/types/websitePost"

export const useUserStreaks = (
  data: InfiniteData<PaginatedData<WebsitePost>>
) => {
  const flatUserIds = useMemo(() => {
    return data?.pages.flatMap((p) => p.data.map((post) => post.user?.id).filter(Boolean)) || []
  }, [data])

  const { data: userStreaks } = useUserStreaksByIds(flatUserIds)

  const getUserStreak = useCallback(
    (userId: string) => {
      if (!userStreaks || !Array.isArray(userStreaks)) return 0

      const streak = userStreaks.find((s) => s.user_id === userId)
      return streak?.current_streak || 0
    },
    [userStreaks]
  )

  return { getUserStreak }
}
