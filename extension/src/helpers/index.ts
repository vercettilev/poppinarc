import { backendApi } from "~/lib/axios"
import store from "~/store"

export function syncStore() {
  const listener = (message: any, sender: any, sendResponse: any) => {
    if (message.action === "UPDATE_ZUSTAND") {
      ;(store as any)[message.name].setState(message.state)
      sendResponse(message.state)
    } else if (message.action === "UPDATE_HEADERS") {
      backendApi.defaults.headers.common = {
        ...backendApi.defaults.headers.common,
        ...message.payload,
      }
      sendResponse(message.payload)
    }
  }

  chrome.runtime.onMessage.addListener(listener)

  return () => {
    chrome.runtime.onMessage.removeListener(listener)
  }
}
