import { useQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

export function useUserTasks(enabled = true) {
  return useQuery({
    queryKey: ["userTasks"],
    queryFn: () => UserService.getUserTasks(),
    enabled,
  })
}
