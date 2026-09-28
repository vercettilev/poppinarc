import { auth } from "~/lib/firebase"
import { useUserStore } from "~/store/useUserStore"

/**
 * "NOT YOU?" — leave every session this product holds, so the next
 * sign-in is a real choice.
 *
 * Reinstalling the extension does not sign anybody out, and that is not a
 * bug in the extension: the sign-in bridge at app.poppin.so keeps its own
 * Firebase session on the WEB origin, which an extension uninstall cannot
 * touch. Press Continue with Google after a reinstall and the bridge hands
 * the old token straight back without ever showing Google's account
 * picker. Measured on a shared laptop the day this was written: "it
 * auto-detected I was Lev."
 *
 * So switching accounts has to sign out in three places, in this order:
 * the extension's Firebase session, the extension's own stores (the
 * background clears local/sync/session storage on CLEAR_STORE), and the
 * web origin, reached through a hidden iframe to /logout because that
 * session lives in another origin's storage. Then a flag tells the next
 * sign-in to ask Google for the picker rather than the last account.
 */
export const SWITCH_FLAG = "poppin_switch_account"

export async function switchAccount(): Promise<void> {
  try {
    await auth.signOut()
  } catch {
    // A session that will not sign out is still replaced by the next one.
  }
  const store = useUserStore.getState()
  store.setUser(null)
  store.setIsAuthenticated(false)
  store.setUserOrganizations([])
  await new Promise<void>((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: "CLEAR_STORE" }, () => resolve())
    } catch {
      resolve()
    }
  })
  try {
    const webUrl = process.env.NEXT_PUBLIC_WEB_URL
    if (webUrl) {
      const iframe = document.createElement("iframe")
      iframe.style.display = "none"
      iframe.src = `${webUrl.replace(/\/+$/, "")}/logout`
      document.body.appendChild(iframe)
      /* Give the logout page a moment to run before the person can press
         sign-in again; the iframe is removed either way. */
      await new Promise((r) => setTimeout(r, 900))
      iframe.remove()
    }
  } catch {
    // Without the web logout the picker flag below still forces a choice.
  }
  try {
    sessionStorage.setItem(SWITCH_FLAG, "1")
  } catch {
    // No flag means no forced picker; the web logout above usually suffices.
  }
}
