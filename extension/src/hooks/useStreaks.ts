import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { StreakService } from "~/services/StreakService"
import { CAP } from "~/config/edition"

interface UseStreaksParams {
  limit?: number
  sort?: string
  enabled?: boolean
}

export function useStreaks(params?: UseStreaksParams) {
  return useInfiniteQuery({
    queryKey: ["streaks", params],
    queryFn: ({ pageParam = undefined }) =>
      StreakService.getStreaks({
        ...params,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.cursor ?? undefined,
    getPreviousPageParam: () => null,
    enabled: params?.enabled !== false,
  })
}

export function useActiveStreak() {
  return useQuery({
    queryKey: ["activeStreak"],
    queryFn: () => StreakService.getActiveStreak(),
  })
}

export function useUserStreaks() {
  return useQuery({
    queryKey: ["userStreaks"],
    queryFn: () => StreakService.getUserStreaks(),
  })
}

export function useStreak(id: string) {
  return useQuery({
    queryKey: ["streak", id],
    queryFn: () => StreakService.getStreak(id),
    enabled: CAP.gamification && !!id,
  })
}

export function useUserStreaksByIds(userIds: string[], enabled = true) {
  return useQuery({
    queryKey: ["userStreaksByIds", userIds],
    queryFn: () => StreakService.getUserStreaksByIds(userIds),
    // Streaks are a store-backend score; the Arc edition never asks.
    enabled: CAP.gamification && enabled && userIds.length > 0,
  })
}
