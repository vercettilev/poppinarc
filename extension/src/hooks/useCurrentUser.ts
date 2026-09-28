import { useQuery } from "@tanstack/react-query"
import { signInWithCustomToken } from "firebase/auth/web-extension"
import { jwtDecode } from "jwt-decode"
import { useCallback, useEffect, useRef, useState } from "react"
import { auth } from "~/lib/firebase"
import { UserService } from "~/services/UserService"
import { useUserStore } from "~/store/useUserStore"

const REFRESH_INTERVAL = 60000 * 5 // 5 minutes

export function useCurrentUser(options?: { enabled?: boolean }) {
  const { setUser, isAuthenticated, setIsAuthenticated, setIsUserFetching, isUserFetching } = useUserStore()
  const { setUserOrganizations } = useUserStore()
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const lastAuthenticatedUserId = useRef<string | null>(null)

  const handleFirebaseAuth = useCallback(async (user: any) => {
    if (!user) return
    if (isUserFetching) return
  

    setIsUserFetching(true)


    if (user.id === lastAuthenticatedUserId.current) {
      return
    }

    const { access_token } = user

    if (!access_token) {
      setIsAuthenticated(false)
      return
    }

    try {
      const decodedToken = jwtDecode(access_token)
      const isSameUser = decodedToken.sub === auth?.currentUser?.uid

      const isContentScript = typeof window !== "undefined" && typeof chrome.tabs === "undefined"


      if(isContentScript) {
        await chrome.runtime.sendMessage({
          type: "signInToFirebase",
          payload: {
            access_token
          }
        })
      } else {
        // Only authenticate if there's no current user or different user
        if (!isSameUser || !auth?.currentUser) {
          const userCredential = await signInWithCustomToken(auth, access_token)
          setIsAuthenticated(true)
          lastAuthenticatedUserId.current = userCredential.user.uid
        } else {
          setIsAuthenticated(true)
          lastAuthenticatedUserId.current = auth.currentUser.uid
        }
      }

      
    } catch (error: any) {
      setIsAuthenticated(false)
    }
  }, [setIsAuthenticated])

  const query = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      try {
        const user = await UserService.getCurrentUser()


        if ("success" in user && !user.success) {
          setUser(null)
          setIsAuthenticated(false)
          return null
        }

        // No navigation side-effects here. The previous version
        // navigated to /create-profile inside this queryFn whenever the
        // user lacked a username — which made useCurrentUser route the
        // welcome tab into the onboarding flow the moment a cached
        // Firebase session resolved, bypassing the email entry. Routing
        // now lives entirely in App.tsx + the OTP success handler.
        if (user) {
          setUser(user)
        }
        return user
      } catch (error: any) {
        if (error?.response?.status === 401) {
          setUser(null)
          setIsAuthenticated(false)
        }
        throw error
      }
    },
    retry: false,
    staleTime: REFRESH_INTERVAL,
    refetchOnWindowFocus: false,
    enabled: options?.enabled !== false,
  })


  useEffect(() => {
    if (
      query.data && 
      query.data.access_token && 
      !isAuthenticated && 
      lastAuthenticatedUserId.current !== query.data.id &&
      !isUserFetching
    ) {
      handleFirebaseAuth(query.data)
    }
  }, [query.data])

  /**
   * ONLY THE SERVER CAN SIGN SOMEBODY OUT.
   *
   * This fired on `query.error` — ANY error — and the query is `retry:
   * false`, so one timeout, one 500, or one second offline called
   * auth.signOut(). A reader lost their session for a network blip, and
   * because the welcome flow polls this same hook, it could happen in the
   * middle of a brand-new account's first minute: the person was signed
   * out of the account they were in the act of creating.
   *
   * 401 is the one answer that means "this identity is not good any
   * more", and the fetch path above already handles it. Everything else is
   * "we could not ask" — the honest response to which is to keep the
   * session and let the next refetch answer. The local view still clears,
   * because showing stale user data over a failed read is its own lie;
   * what does not happen is the irreversible half.
   */
  useEffect(() => {
    if (!query.error) return
    const status = (query.error as { response?: { status?: number } } | null)
      ?.response?.status
    setUser(null)
    setUserOrganizations([])
    lastAuthenticatedUserId.current = null
    if (status !== 401) return
    auth.signOut().catch((error) => {
      console.error("Error signing out from Firebase", error)
    })
  }, [query.error, setUser, setUserOrganizations])

  useEffect(() => {
    if (!query.isLoading) {
      setIsInitialLoading(false)
    }
  }, [query.isLoading])


  return {
    ...query,
    isLoading: isInitialLoading || query.isLoading,
    handleFirebaseAuth
  }
}
