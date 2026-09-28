import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

/**
 * What survived the widget era. sidebarIconTopPosition (the draggable
 * button's memory) and isPopupOpen (the in-page popup) left with the
 * surfaces that used them; persisted copies of either in a reader's
 * localStorage are simply ignored by zustand's merge.
 */
interface PreferenceStore {
  isWidgetEnabled: boolean
  setWidgetEnabled: (enabled: boolean) => void
  initialRoute: string | undefined
  setInitialRoute: (route: string | undefined) => void
}

export const usePreferenceStore = create<PreferenceStore>()(
  persist(
    (set) => ({
      isWidgetEnabled: true,
      setWidgetEnabled: (enabled) => set({ isWidgetEnabled: enabled }),
      initialRoute: undefined,
      setInitialRoute: (route) => set({ initialRoute: route }),
    }),
    {
      name: "preference-storage", // unique name
      storage: createJSONStorage(() => {
        // Test if storage is available and working
        const isStorageAvailable = () => {
          try {
            const testKey = "__storage_test__"
            localStorage.setItem(testKey, testKey)
            localStorage.removeItem(testKey)
            return true
          } catch (e) {
            return false
          }
        }

        const storage = isStorageAvailable() ? localStorage : sessionStorage

        return storage
      }),
    }
  )
)
