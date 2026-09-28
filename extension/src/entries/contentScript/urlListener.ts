// Runs in the page's MAIN world (injected via chrome.scripting.executeScript
// with world: 'MAIN'). Content scripts live in an isolated JS world and
// cannot monkey-patch pushState/replaceState in a way that catches the host
// page's navigation. This shim runs in the host page's world, patches
// history.pushState / history.replaceState, and posts a window message that
// the isolated content script listens for (see entries/contentScript/primary/main.tsx, the POPPIN_URL_UPDATED listener).

(function (history) {
  const pushState = history.pushState
  const replaceState = history.replaceState

  function triggerUrlChangeEvent() {
    window.dispatchEvent(new Event("urlchange"))
  }

  history.pushState = function (...args) {
    const ret = pushState.apply(this, args as any)
    triggerUrlChangeEvent()
    return ret
  }

  history.replaceState = function (...args) {
    const ret = replaceState.apply(this, args as any)
    triggerUrlChangeEvent()
    return ret
  }

  window.addEventListener("popstate", triggerUrlChangeEvent)
})(window.history)

window.addEventListener("urlchange", () => {
  window.postMessage(
    {
      type: "POPPIN_URL_UPDATED",
      url: window.location.href,
    },
    "*"
  )
})
