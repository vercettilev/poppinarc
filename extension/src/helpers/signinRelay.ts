/**
 * THE SIGN-IN RELAY THAT WORKS IN EVERY CHROMIUM.
 *
 * The auth page used to hand its token to the extension with
 * chrome.runtime.sendMessage(extensionId, …) — the externally_connectable
 * channel. Chrome injects `chrome.runtime` into pages an installed
 * extension declares itself connectable to; BRAVE does not (a deliberate
 * fingerprinting stance, and a long-standing gap in its extension
 * support). Measured live 2026-08-24: the page finished sign-in, printed
 * "You're in", and the extension never heard a word — the welcome tab sat
 * on its button forever.
 *
 * A CONTENT SCRIPT has chrome.runtime in every Chromium, always. So the
 * page now ALSO announces its token with window.postMessage to itself,
 * and this relay — running as part of the primary content script, which
 * already matches every page — forwards it to the background over the
 * channel that cannot be absent. The old direct path stays: in Chrome
 * both arrive and the background's same-user guard makes the second a
 * no-op.
 *
 * Scope: installs only on poppin.so origins, accepts only same-window
 * same-origin messages, forwards only the one message shape it knows.
 */

export const SIGNIN_POST_MESSAGE = "POPPIN_EXT_SIGNIN"

export function installSigninRelay(hostname: string = location.hostname): () => void {
  // Not our origin: nothing to relay, nothing to listen for.
  if (!/(^|\.)poppin\.so$/.test(hostname)) return () => {}
  // The background injects the content script into the same tab more than
  // once (see primary/main.tsx's idempotency guard); one relay is plenty.
  const w = window as Window & { __poppinSigninRelay?: boolean }
  if (w.__poppinSigninRelay) return () => {}
  w.__poppinSigninRelay = true

  const onMessage = (e: MessageEvent) => {
    // Same window, same origin: the page talking to itself, on purpose.
    if (e.source !== window || e.origin !== location.origin) return
    const d = e.data as { type?: unknown; token?: unknown } | null
    if (d?.type !== SIGNIN_POST_MESSAGE || typeof d.token !== "string" || !d.token) {
      return
    }
    try {
      void chrome.runtime
        .sendMessage({ action: "extension-signin", token: d.token })
        .catch(() => {
          // The background will retry nothing: the page also keeps its
          // direct channel, and sign-in state is re-read on next open.
        })
    } catch {
      // Extension context invalidated (update mid-session). Nothing to do.
    }
  }

  window.addEventListener("message", onMessage)
  return () => window.removeEventListener("message", onMessage)
}
