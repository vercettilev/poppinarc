import { create } from "zustand"

export type TimeRange = "all" | "year" | "month" | "week" | "today"

interface TimeRangeStore {
  range: TimeRange
  setRange: (range: TimeRange) => void
}

export const useTimeRangeStore = create<TimeRangeStore>((set) => ({
  range: "all",
  setRange: (range) => set({ range }),
}))
