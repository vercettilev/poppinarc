import { create } from "zustand"

export type ViewType = "comment" | "chat" | "announcements" | null

interface ViewStore {
  view: ViewType
  setView: (view: ViewType) => void
}

export const useViewStore = create<ViewStore>((set) => ({
  view: "comment",
  setView: (view) => set({ view }),
}))
