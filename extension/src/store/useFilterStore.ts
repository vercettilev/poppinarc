import { create } from "zustand"
import { FilterValue } from "~/components/ActionBar"

/** What the one feed shows. "all" is the default and the product decision:
 *  posts and trade receipts are one conversation, split on demand only. */
export type FeedKind = "all" | "posts" | "trades"

interface FilterStore {
  orderBy: FilterValue
  setOrderBy: (value: FilterValue) => void
  feedKind: FeedKind
  setFeedKind: (kind: FeedKind) => void
}

export const useFilterStore = create<FilterStore>((set) => ({
  orderBy: "newest",
  setOrderBy: (orderBy) => set({ orderBy }),
  feedKind: "all",
  setFeedKind: (feedKind) => set({ feedKind }),
}))
