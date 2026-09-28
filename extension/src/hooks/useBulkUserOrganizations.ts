import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { Organization, UserService } from "~/services/UserService"

interface UseBulkUserOrganizationsOptions {
  enabled?: boolean
}

export function useBulkUserOrganizations(
  userIds: string[],
  options?: UseBulkUserOrganizationsOptions
) {
  const queryClient = useQueryClient()

  // Filter out duplicate and empty user IDs
  const filteredUserIds = useMemo(() => {
    return Array.from(new Set(userIds.filter(Boolean)))
  }, [userIds])

  // Check which users we already have cached
  const { uncachedUserIds, cachedData } = useMemo(() => {
    const uncached: string[] = []
    const cached: Record<string, Organization[]> = {}

    filteredUserIds.forEach((userId) => {
      // Check if we have cached organization data for this user
      const cachedUserOrgs = queryClient.getQueryData<Organization[]>([
        "userOrganizations",
        userId,
      ])

      if (cachedUserOrgs) {
        cached[userId] = cachedUserOrgs
      } else {
        uncached.push(userId)
      }
    })

    return { uncachedUserIds: uncached, cachedData: cached }
  }, [filteredUserIds, queryClient])

  // Fetch data only for uncached users
  const bulkQuery = useQuery({
    queryKey: ["bulkUserOrganizations", uncachedUserIds.sort()],
    queryFn: async () => {
      if (uncachedUserIds.length === 0) return {}
      return UserService.getBulkUserOrganizations(uncachedUserIds)
    },
    enabled: options?.enabled !== false && uncachedUserIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Update individual user organization caches when bulk data arrives
  useMemo(() => {
    if (bulkQuery.data) {
      Object.entries(bulkQuery.data).forEach(([userId, organizations]) => {
        queryClient.setQueryData(["userOrganizations", userId], organizations)
      })
    }
  }, [bulkQuery.data, queryClient])

  // Combine cached and newly fetched data
  const combinedData = useMemo(() => {
    const result: Record<string, Organization[]> = { ...cachedData }

    if (bulkQuery.data) {
      Object.assign(result, bulkQuery.data)
    }

    return result
  }, [cachedData, bulkQuery.data])

  // Return data for all requested users, even if some are still loading
  const data = useMemo(() => {
    const result: Record<string, Organization[]> = {}

    filteredUserIds.forEach((userId) => {
      result[userId] = combinedData[userId] || []
    })

    return result
  }, [filteredUserIds, combinedData])

  return {
    data,
    isLoading: bulkQuery.isLoading && uncachedUserIds.length > 0,
    isError: bulkQuery.isError,
    error: bulkQuery.error,
    isSuccess: bulkQuery.isSuccess || uncachedUserIds.length === 0,
    // Additional utility methods
    getOrganizationsForUser: (userId: string) => data[userId] || [],
    hasDataForUser: (userId: string) => userId in combinedData,
    getCachedUserCount: () => Object.keys(cachedData).length,
    getUncachedUserCount: () => uncachedUserIds.length,
  }
} 