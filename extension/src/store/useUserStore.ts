import { create } from "zustand"
import { Organization, User } from "~/services/UserService"

interface UserState {
  user: User | null
  organizations: Organization[]
  setUser: (user: User | null) => void
  setUserOrganizations: (organizations: Organization[]) => void
  clearUser: () => void
  isAuthenticated: boolean
  setIsAuthenticated: (isAuthenticated: boolean) => void
  isUserFetching: boolean
  setIsUserFetching: (isUserFetching: boolean) => void
}

export const useUserStore = create<UserState>()((set) => ({
  user: null,
  isUserFetching: false,
  setIsUserFetching: (isUserFetching: boolean) => {
    return set({ isUserFetching })
  },
  organizations: [],
  setUser: (user: User | null) => {
    if (!user || ("success" in user && !user.success)) {
      return set({ user: null, isAuthenticated: false })
    }
    return set({ user, isAuthenticated: true })
  },
  clearUser: () => set({ user: null, isAuthenticated: false }),
  isAuthenticated: false,
  setIsAuthenticated: (isAuthenticated) => {
    return set({ isAuthenticated })
  },
  setUserOrganizations: (organizations: Organization[]) => {
    return set({ organizations })
  },
}))
