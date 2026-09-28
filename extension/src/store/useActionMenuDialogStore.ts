import { create } from "zustand"
import { ReportType } from "~/services/WebsitePostService"

export type ActionDialogMode = "delete" | "report" | "externalLink" | null

interface ActionMenuDialogStore {
  dialogMode: ActionDialogMode
  selectedReportType: ReportType
  currentPostId: string
  currentUserId?: string
  authorId: string
  contentType: "post" | "comment" | "reply"
  onDeleteCallback: ((reason?: string) => void) | null
  externalLinkUrl: string
  setDialogMode: (mode: ActionDialogMode) => void
  setSelectedReportType: (type: ReportType) => void
  setDialogData: (data: {
    postId: string
    currentUserId?: string
    authorId: string
    contentType: "post" | "comment" | "reply"
    onDeleteCallback: (reason?: string) => void
  }) => void
  setExternalLinkUrl: (url: string) => void
  closeDialog: () => void
}

export const useActionMenuDialogStore = create<ActionMenuDialogStore>((set) => ({
  dialogMode: null,
  selectedReportType: "spam",
  currentPostId: "",
  currentUserId: undefined,
  authorId: "",
  contentType: "post",
  onDeleteCallback: null,
  externalLinkUrl: "",
  setDialogMode: (mode) => set({ dialogMode: mode }),
  setSelectedReportType: (type) => set({ selectedReportType: type }),
  setDialogData: (data) => set({
    currentPostId: data.postId,
    currentUserId: data.currentUserId,
    authorId: data.authorId,
    contentType: data.contentType,
    onDeleteCallback: data.onDeleteCallback,
  }),
  setExternalLinkUrl: (url) => set({ externalLinkUrl: url }),
  closeDialog: () => set({ 
    dialogMode: null,
    selectedReportType: "spam",
    currentPostId: "",
    currentUserId: undefined,
    authorId: "",
    contentType: "post",
    onDeleteCallback: null,
    externalLinkUrl: "",
  }),
})) 