import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { storage } from "~/lib/store"

export type RouteParams = Record<string, string>

interface RouteState {
  currentRoute: string
  params: RouteParams
  queryParams: Record<string, string>
  setRoute: (route: string) => void
  goBack: () => void
  routeHistory: Array<{ route: string; params: RouteParams }>
  setParams: (params: RouteParams) => void
}

export const useRouteStore = create<RouteState>()(
  persist(
    (set, get) => ({
      currentRoute: "/",
      params: {},
      queryParams: {},
      routeHistory: [{ route: "/", params: {} }],
      setRoute: (route: string) => {
        const current = get()
        set({
          currentRoute: route,
          routeHistory: [...current.routeHistory, { route, params: {} }],
        })
      },
      goBack: () => {
        const current = get()
        if (current.routeHistory.length > 1) {
          const newHistory = [...current.routeHistory]
          newHistory.pop() // Remove current route
          const previous = newHistory[newHistory.length - 1] // Get previous route
          set({
            currentRoute: previous.route,
            params: previous.params,
            routeHistory: newHistory,
          })
        }
      },
      setParams: (params: RouteParams) => {
        set({
          params,
        })
      },
    }),
    {
      name: "route-store",
      storage: createJSONStorage(() => storage),
    }
  )
)
