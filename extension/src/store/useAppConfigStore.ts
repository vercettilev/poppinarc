import { create } from "zustand"
import { persist } from "zustand/middleware"
import { storage } from "~/lib/store"
import { Organization } from "~/services/UserService"

export type Environment = "popup" | "sidepanel" | "contentScript"

interface Size {
  width: number
  height: number
}

interface AppConfig {
  noDevTools: boolean
  size: Size
  primaryColor: string
  onClose?: () => void
  setNoDevTools: (noDevTools: boolean) => void
  setSize: (size: Size) => void
  setPrimaryColor: (primaryColor: string) => void
  setOnClose: (onClose: () => void) => void
  secondaryColor: string
  setSecondaryColor: (secondaryColor: string) => void
  doodleUrl: string
  setDoodleUrl: (doodleUrl: string) => void
  organization: Organization | undefined
  setOrganization: (organization: Organization) => void
  // Settings switches
  showChatTabFirst: boolean
  setShowChatTabFirst: (value: boolean) => void
  openPoppinShortcut: boolean
  setOpenPoppinShortcut: (value: boolean) => void
  widgetSize: boolean
  setWidgetSize: (value: boolean) => void
  closeWidget: boolean
  setCloseWidget: (value: boolean) => void
  autoOpenWidget: boolean
  setAutoOpenWidget: (value: boolean) => void
  anonymousId: string
  setAnonymousId: (value: string) => void
  // Path management
  currentPath: string
  setCurrentPath: (path: string) => void
}

export const useAppConfigStore = create<AppConfig>()(
  persist(
    (set) => ({
      noDevTools: true,
      size: typeof window !== "undefined" && window.innerWidth < 768 ? { width: window.innerWidth, height: window.innerHeight } : { width: 400, height: 600 },
      onClose: undefined,
      setNoDevTools: (noDevTools) => set({ noDevTools }),
      setSize: (size) => set({ size }),
      secondaryColor: "",
      setSecondaryColor: (secondaryColor) => set({ secondaryColor }),
      doodleUrl: "",
      setDoodleUrl: (doodleUrl) => set({ doodleUrl }),
      primaryColor: "#00476A",
      setPrimaryColor: (primaryColor) => set({ primaryColor }),
      setOnClose: (onClose) => set({ onClose }),
      // @ts-ignore
      organization: {
        primaryColor: "#68C6FF",
        secondaryColor: "#242931",
        tertiaryColor: "#0E141D"
      },
      setOrganization: (organization) => set({ organization }),
      // Settings switches
      showChatTabFirst: false,
      setShowChatTabFirst: (value) => set({ showChatTabFirst: value }),
      openPoppinShortcut: false,
      setOpenPoppinShortcut: (value) => set({ openPoppinShortcut: value }),
      widgetSize: false,
      setWidgetSize: (value) => set({ widgetSize: value }),
      closeWidget: false,
      setCloseWidget: (value) => set((state) => {
        // If closeWidget is being set to true, automatically set autoOpenWidget to false
        if (value) {
          return { closeWidget: value, autoOpenWidget: false }
        }
        return { closeWidget: value }
      }),
      autoOpenWidget: false,
      setAutoOpenWidget: (value) => set((state) => {
        // If autoOpenWidget is being set to true but closeWidget is true, turn off closeWidget
        if (value && state.closeWidget) {
          return { autoOpenWidget: value, closeWidget: false }
        }
        return { autoOpenWidget: value }
      }),
      anonymousId: "",
      setAnonymousId: (value) => set({ anonymousId: value }),
      // Path management
      currentPath: "",
      setCurrentPath: (path) => set({ currentPath: path }),
    }),
    {
      name: "app-config-store",
      storage: storage,
    }
  )
)






interface EnvironmentStore {
  environment: Environment
  setEnvironment: (environment: Environment) => void
}

export const useEnvironmentStore = create<EnvironmentStore>()((set) => ({
  environment: "contentScript",
  setEnvironment: (environment: Environment) => set({ environment }),
}))
