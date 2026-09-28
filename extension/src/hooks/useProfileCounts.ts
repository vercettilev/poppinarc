import { useQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"
import type { ProfileCounts } from "~/types/user"

export function useProfileCounts(userId?: string) {
  return useQuery<ProfileCounts>({
    queryKey: ["profile-counts", userId],
    queryFn: () => UserService.getProfileCounts(userId!),
    enabled: !!userId,
  })
}
