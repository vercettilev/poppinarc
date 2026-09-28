import { useCurrentUrlStore } from "./useCurrentUrlStore"
import { usePinnedUrlStore } from "./usePinnedUrlStore"
import { usePreferenceStore } from "./usePreferenceStore"
import { useRefreshStore } from "./useRefreshStore"
import { useUIStore } from "./useUIStore"
import { useUserStore } from "./useUserStore"
import { useViewStore } from "./useViewStore"

export interface StoreMap {
  "preference-store": ReturnType<typeof usePreferenceStore>
  "user-store": ReturnType<typeof useUserStore>
  "ui-store": ReturnType<typeof useUIStore>
  "current-url-store": ReturnType<typeof useCurrentUrlStore>
  "pinned-url-store": ReturnType<typeof usePinnedUrlStore>
  "refresh-store": ReturnType<typeof useRefreshStore>
  "view-store": ReturnType<typeof useViewStore>
}

export default {
  "preference-store": usePreferenceStore,
  "user-store": useUserStore,
  "ui-store": useUIStore,
  "current-url-store": useCurrentUrlStore,
  "pinned-url-store": usePinnedUrlStore,
  "refresh-store": useRefreshStore,
  "view-store": useViewStore,
} as StoreMap
