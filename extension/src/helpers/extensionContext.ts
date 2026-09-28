/**
 * IS ANYTHING STILL BEHIND THIS PAGE?
 *
 * A content script outlives the extension that injected it. Chrome tears the
 * context down on a reload or an auto-update, the page keeps running, and from
 * that moment every `chrome.*` call on it fails — the async ones reject and the
 * synchronous ones (getURL, addListener, sendMessage) THROW where they stand.
 * Nothing on that page can ever reach the extension again; the only repair is
 * a page reload, which is the reader's to make.
 *
 * Chrome clears `runtime.id` on exactly that transition, which makes it the one
 * synchronous, side-effect-free way to ask the question. This module exists so
 * the answer has a single definition: lib/fetchService.ts already turns the
 * network half of this fact into "Poppin updated · Reload the page", and the
 * callers here are its quiet counterpart — the ones that only read, and whose
 * honest answer on a dead page is nothing at all rather than an exception.
 *
 * The try/catch is not decoration. Reading `chrome` where no such global
 * exists is a ReferenceError, and this module also loads in contexts that have
 * no extension APIs at all.
 */
export const extensionAlive = (): boolean => {
  try {
    return Boolean(chrome?.runtime?.id)
  } catch {
    return false
  }
}
