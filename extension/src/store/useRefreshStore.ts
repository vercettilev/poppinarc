import { create } from "zustand"

interface RefreshState {
  key: number
  refreshComponent: () => void
}

export const useRefreshStore = create<RefreshState>((set) => ({
  key: 0,
  refreshComponent: () => set((state) => ({ key: state.key + 1 })),
}))
