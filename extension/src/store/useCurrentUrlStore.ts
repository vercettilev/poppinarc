import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { storage } from "~/lib/store"

interface CurrentUrlStore {
  previousCurrentUrl: string
  currentUrl: string
  setCurrentUrl: (url: string) => void
}

export const useCurrentUrlStore = create<CurrentUrlStore>()(
  persist(
    (set, get) => ({
      previousCurrentUrl: "",
      currentUrl: typeof window !== "undefined" ? window.location.href : "",
      setCurrentUrl: (url) =>
        /* `previousCurrentUrl` keeps the url being REPLACED, which is the
           only thing that name can mean. It used to be handed the new one,
           so the field was a duplicate of `currentUrl` and any caller
           comparing them saw no navigation ever happen. Nothing live reads
           it today; it is correct now so that the next thing to read it is
           not quietly wrong.

           The console.trace that sat here printed a full stack on every
           navigation. On a site that rewrites its url per track, that is a
           trace per song in the reader's console. */
        set((s) => ({ currentUrl: url, previousCurrentUrl: s.currentUrl })),
    }),
    {
      name: "current-url-store",
      storage: createJSONStorage(() => storage),
    }
  )
)
