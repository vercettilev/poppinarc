/**
 * Helper function to send messages to the background script and handle responses.
 * @param action - The action name corresponding to the backend API call.
 * @param data - The payload data to send.
 */

import { Action, ActionMap } from "~/types/actionTypes"

export function sendMessageToBackground<
  K extends Action,
  P = ActionMap[K]["payload"],
  R = ActionMap[K]["response"]
>(action: K, payload: P): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (response && response.error) {
          reject(new Error(response.error))
        } else {
          resolve(response as R)
        }
      }
    )
  })
}

export function openSidePanel(): Promise<void> {
  return sendMessageToBackground("TOGGLE_SIDE_PANEL", {})
}

/**
 * NO clearNotificationBadge. There is no badge to clear since the unread
 * poll went with the inbox it counted, and this function had no callers
 * for as long as it existed.
 */

