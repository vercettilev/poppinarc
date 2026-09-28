import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { storage } from "~/lib/store"

interface PinnedUrlState {
  pinnedUrl: string | null
  setPinnedUrl: (url: string | null) => void
  isGeneralChat: boolean
  setIsGeneralChat: (isGeneral: boolean) => void
  isDomainChat: boolean
  setIsDomainChat: (isDomain: boolean) => void
}

export const usePinnedUrlStore = create<PinnedUrlState>()(
  persist(
    (set) => ({
      pinnedUrl: null,
      setPinnedUrl: (url) => set({ pinnedUrl: url }),
      isGeneralChat: false,
      setIsGeneralChat: (isGeneral) => set({ isGeneralChat: isGeneral }),

      isDomainChat: true,
      setIsDomainChat: (isDomain) => set({ isDomainChat: isDomain }),
    }),
    {
      name: "pinned-url-store",
      storage: createJSONStorage(() => storage),
    }
  )
)
