import { create } from "zustand"

export type DialogMode = "delete" | "leave" | null

interface DialogModeStore {
  dialogMode: DialogMode
  setDialogMode: (mode: DialogMode) => void
  closeDialog: () => void
}

export const useDialogModeStore = create<DialogModeStore>((set) => ({
  dialogMode: null,
  setDialogMode: (mode) => set({ dialogMode: mode }),
  closeDialog: () => set({ dialogMode: null }),
})) 