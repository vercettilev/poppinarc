/**
 * OPEN THE AUTH TAB, BUT ASK FOR THE RELAY'S ORIGIN FIRST.
 *
 * WHAT THE RELAY IS. Brave does not inject `chrome.runtime` into
 * externally_connectable pages, so app.poppin.so/auth cannot hand its token
 * to the extension directly there. helpers/signinRelay is the fallback: the
 * page posts the token to itself, the primary content script hears it and
 * forwards it over the channel a content script always has. Measured live
 * 2026-08-24: without the relay a Brave reader finished sign-in on the web,
 * saw "You're in", and the extension never heard a word.
 *
 * WHY THE PERMISSION IS ASKED FOR HERE, OF ALL PLACES. A content script
 * only reaches a page the extension has access to, and this extension keeps
 * every origin OPTIONAL: that is the product's whole shape, and it is also
 * what lets an update ship without Chrome disabling the extension for
 * everybody who has not granted anything yet (see manifest.ts). So the
 * origin has to be asked for, and `chrome.permissions.request` may only
 * prompt inside a user gesture. Pressing "Sign in" is that gesture. There
 * is no other moment in the flow that is both a gesture and before the
 * token exists.
 *
 * WHY THE ORDER IS THE WHOLE POINT. The content script is injected by the
 * background when the tab reports `loading` (background/main.ts's
 * `injectContentScripts`), and that call checks what is granted AT THAT
 * MOMENT. Grant first and create second, and the relay is listening before
 * the page can produce a token. Create first and grant second, and the
 * request loses its gesture, the answer arrives after the navigation it was
 * meant to cover, and Brave is broken exactly as it was.
 *
 * WHY `scripting` RIDES ALONG. There is no manifest-declared content script
 * in the store build (vite.config.ts declares one only in development), so
 * the relay reaches app.poppin.so one way and one way only: programmatic
 * injection, which `injectContentScripts` refuses outright without the
 * optional `scripting` permission. Granting the origin alone would hand the
 * extension access to a page it still could not put a script on, which is a
 * fix that reads correct and does nothing. Both, in one prompt, or neither.
 *
 * WHY A REFUSAL IS NOT A DEAD END. In Chrome the page's own
 * `chrome.runtime.sendMessage` works with no host permission at all, and
 * the background treats the two arrivals as one sign-in. The relay is the
 * Brave fallback, never the only road, so sign-in opens whatever the reader
 * answers, whatever the browser supports, and whatever the API does.
 */

/** The one origin the sign-in relay ever runs on. */
export const SIGNIN_RELAY_ORIGIN = "https://*.poppin.so/*"

/**
 * Ask for what the relay needs. Best effort by construction: the return
 * value says what happened, and every caller is free to ignore it.
 */
export async function requestSigninRelayAccess(): Promise<boolean> {
  try {
    const granted = await chrome.permissions?.request?.({
      permissions: ["scripting"],
      origins: [SIGNIN_RELAY_ORIGIN],
    })
    return granted === true
  } catch {
    // Declined, unavailable, or a browser that answers differently. None of
    // those is a reason to leave the reader without a sign-in page.
    return false
  }
}

/**
 * The sign-in flow's only door to the auth page. Both providers go through
 * it so the grant cannot be ordered correctly on one leg and not the other.
 *
 * Nothing here is caught on purpose: a `chrome.tabs.create` that fails is a
 * sign-in that did not start, and the caller says so on screen.
 */
export async function openAuthTab(url: string): Promise<chrome.tabs.Tab> {
  await requestSigninRelayAccess()
  return chrome.tabs.create({ url })
}
