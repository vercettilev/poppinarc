import { useQuery } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"
import { useUserStore } from "~/store/useUserStore"

export function useUserOrganizations(options?: { enabled?: boolean }) {
  const { organizations, setUserOrganizations } = useUserStore()

  return useQuery({
    queryKey: ["userOrganizations"],
    queryFn: async () => {
      const orgs = await UserService.getUserOrganizations()
      setUserOrganizations(orgs)
      return orgs
    },
    enabled: options?.enabled !== false,
    initialData: organizations,
  })
} 