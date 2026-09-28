import { create } from "zustand"

export type SortBy = "currentUrl" | "timeline" | "daily" | "weekly" | "monthly"

interface SortStore {
  sort: SortBy
  setSort: (sort: SortBy) => void
}

export const useSortStore = create<SortStore>((set) => ({
  sort: "currentUrl",
  setSort: (sort) => set({ sort }),
}))
