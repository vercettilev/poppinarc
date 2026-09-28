import { createContext, ReactNode, useContext } from "react"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { Organization, User } from "~/services/UserService"
import { useUserStore } from "~/store/useUserStore"

interface AuthContextType {
  user: User | null
  organizations: Organization[]
  isLoading: boolean
  isAuthenticated: boolean
  isLoadingOrganizations: boolean
  error: Error | null
  organizationsError: Error | null
  refetch: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { isAuthenticated } = useUserStore()
  
  const currentUserResult = useCurrentUser() as any
  const {
    data: currentUser,
    organizations,
    isLoading,
    isLoadingOrganizations,
    error,
    organizationsError,
    refetch,
  } = currentUserResult

  const contextValue: AuthContextType = {
    user: currentUser ?? null,
    organizations: organizations || [],
    isLoading,
    isAuthenticated,
    isLoadingOrganizations,
    error: error as Error | null,
    organizationsError: organizationsError as Error | null,
    refetch,
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
} 