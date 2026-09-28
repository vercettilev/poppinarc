import { create } from "zustand"

interface UIState {
  isChatUpView: boolean
  hideHeader: boolean
  setIsChatUpView: (isOpen: boolean) => void
  setHideHeader: (hide: boolean) => void

  isDomainPost: boolean
  setIsDomainPost: (isDomainPost: boolean) => void

  // SignInModal state
  isSignInModalOpen: boolean
  setIsSignInModalOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  isChatUpView: false,
  hideHeader: false,
  setIsChatUpView: (isOpen) => set({ isChatUpView: isOpen }),
  setHideHeader: (hide) => set({ hideHeader: hide }),

  isDomainPost: false,
  setIsDomainPost: (isDomainPost) => set({ isDomainPost }),

  // SignInModal state
  isSignInModalOpen: false,
  setIsSignInModalOpen: (open) => {



    return chrome.runtime.sendMessage({
      type: "OPEN_WELCOME_PAGE",
      payload: open
    })




    return set({ isSignInModalOpen: open })
  },
}))
