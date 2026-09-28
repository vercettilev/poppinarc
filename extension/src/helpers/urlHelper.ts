/**
 * WHAT THIS FILE IS NOW: the current-page tracker, and two string helpers.
 *
 * It used to be the chat layer's URL plumbing — subscriptions, message
 * fetches, room-id prefixes, a Firebase message path. Chat left the product
 * and an earlier pass gutted the BODIES (subscribeToMessages became an empty
 * function, getInitialMessages returned [], getMessagesForUrl returned null)
 * while leaving every signature exported. That is the worst of both: dead
 * code that still answers when called, so a future caller gets an empty
 * result instead of a compile error.
 *
 * The service worker's FIREBASE chat handlers are gone now, and with them the
 * last consumers. (The website live chat that exists today is a different
 * thing entirely — a backend room per hostname, reached over the socket, not
 * through this file. Nothing in it imports these names.)
 * Verified before deleting: getDomainFromUrl, parseStreamUrl,
 * addRoomPrefix, stripRoomPrefix, subscribeToRoomMessages, getMessagePath,
 * GENERAL_CHAT_PATH, broadcastMessages, getInitialMessages(WithCommunication),
 * getMessagesForUrl, getMessagesForRoom, unsubscribeFromMessages,
 * unsubscribeFromAll, currentMessageSubscription and the Message interface
 * had ZERO importers outside this file.
 *
 * initializeUrlListener stays and is the reason the file stays: it is called
 * unconditionally at service-worker boot and drives the current-url store the
 * panel reads. Deleting this file rather than pruning it would have broken
 * page tracking quietly, which is exactly the failure class this codebase
 * keeps finding.
 */
export { canonicalPageUrl, stripQueryParams } from "./pageUrl"

import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"

const getCurrentUrl = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs.length > 0 ? tabs[0].url : null
}

/**
 * BEHAVIOUR PRESERVED EXACTLY, including the broadcast's shape: listeners
 * match on `action` + `name` + `state` (helpers/index:48),
 * so a tidier-looking envelope here would have broken page tracking in
 * silence. Only genuinely dead reads were dropped — a `pinnedUrl` and an
 * `isGeneralChat` fetched from storage and then never used, and the
 * commented-out alternates beside them.
 */
export const updateCurrentUrl = async () => {
  // The side panel and the service worker have no page of their own, so
  // they ask the browser which tab is in front. Any other context IS the
  // page.
  const isBackground = typeof window === "undefined"
  const isSidePanel =
    !isBackground && window.location.href.includes("side_panel")

  const currentUrl =
    isSidePanel || isBackground
      ? await getCurrentUrl()
      : typeof window !== "undefined"
        ? window.location.href
        : null

  if (!currentUrl) return

  const previousCurrentUrl = "" + useCurrentUrlStore.getState().currentUrl
  useCurrentUrlStore.getState().setCurrentUrl(currentUrl)
  chrome.runtime
    .sendMessage({
      action: "UPDATE_ZUSTAND",
      name: "current-url-store",
      state: { currentUrl, previousCurrentUrl },
    })
    .catch(() => {
      // No view open to hear it. The store is written either way.
    })
}

export const initializeUrlListener = async () => {
  chrome.tabs.onActivated.addListener(updateCurrentUrl)
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url) updateCurrentUrl()
  })
  // Switching windows changes the active page as surely as switching tabs.
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) updateCurrentUrl()
  })
  await updateCurrentUrl()
}

export const removeUrlPrefixes = (url: string) =>
  url.replace("https://", "").replace("http://", "").replace("www.", "")
