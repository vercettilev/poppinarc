import { useQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

export const useGetUsers = (search: string, options = {}) => {
  return useQuery({
    queryKey: ["users", search],
    queryFn: () => UserService.getUsers(search),
    ...options,
  })
}
