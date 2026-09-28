import { useQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

export function useUser(userId?: string) {
  return useQuery({
    queryKey: ["user", userId],
    queryFn: () => UserService.getUser(userId!),
    enabled: !!userId,
  })
}
