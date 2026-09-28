import type { QueryClient } from "@tanstack/react-query"
import { auth } from "~/lib/firebase"
import { useUserStore } from "~/store/useUserStore"

/**
 * ONE SIGN-OUT, TWO DOORS. The avatar menu had the only Logout, and it
 * carried the whole procedure inline; Settings now offers the same exit
 * next to the account it signs out of, so the procedure lives here and
 * both call it. Every client-side surface that holds auth state is
 * cleared, then the web app's /logout is fired to clear its cookies:
 * the old version relied on that iframe's postMessage to drive the
 * cleanup, and when it never came back the reader stayed signed in.
 *
 * The caller says what happens next (toast, route, closing the panel);
 * this only makes the sign-out true.
 */
export async function signOutEverywhere(queryClient: QueryClient): Promise<void> {
  // 1) Firebase, so the next refresh does not auto-restore.
  try {
    await auth.signOut()
  } catch (e) {
    console.error("Firebase signOut failed", e)
  }
  // 2) The user store.
  const userStore = useUserStore.getState()
  userStore.setUser(null)
  userStore.setIsAuthenticated(false)
  userStore.setUserOrganizations([])
  // 3) React Query: remove, not invalidate, or the stale payload lingers.
  queryClient.removeQueries({ queryKey: ["current-user"] })
  queryClient.removeQueries({ queryKey: ["notifications"] })
  queryClient.removeQueries({ queryKey: ["notifications-count"] })
  /**
   * 4) THE BACKGROUND, which is where the session actually lives.
   *
   * This used to send CLEAR_STORE, which wipes storage and nothing else —
   * and the session is not in storage. The background ran
   * signInWithCustomToken and lib/axios asks IT for a token on every
   * request, so step 1 above signed out this document's Firebase while the
   * background kept answering with a live one. The reader saw "Logged out
   * successfully" and was still signed in; the panel did not send them back
   * to onboarding either, because that gate reads isUserLoggedIn and
   * getCurrentUser kept succeeding. Reported 2026-09-22 as "logout
   * çalışmıyor".
   *
   * LOGOUT signs the background out AND wipes the same storage, so this is
   * strictly more than the call it replaces. It also keeps the price alerts,
   * which belong to the browser rather than the session and which
   * CLEAR_STORE was quietly destroying on every sign-out.
   *
   * Awaited: closing the panel before it lands races the wipe, and the next
   * session keeps stale tokens.
   */
  await new Promise<void>((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: "LOGOUT" }, () => resolve())
    } catch {
      resolve()
    }
  })
  /**
   * 5) THE COOKIE IS ALREADY GONE, AND AN IFRAME NEVER TOOK IT.
   *
   * This opened a hidden iframe at `${NEXT_PUBLIC_WEB_URL}/logout` to clear
   * the web session. apps/auth has no /logout route and never had one, so
   * every sign-out since this was written loaded a 404 into an invisible
   * frame and removed it two seconds later. Meanwhile the cookie it was
   * aiming at — `poppin_access_token` on `.poppin.so` — is the exact thing
   * FirebaseAuthGuard falls back to when there is no Bearer header, and
   * lib/axios sends it on every request. That is why a reader could sign
   * out, watch the panel close, reopen it and still be signed in.
   *
   * The background's LOGOUT above now calls the route that actually clears
   * it (the backend's POST /auth/logout, which rewrites the cookie with an
   * epoch expiry) and waits for it, so there is nothing left for a frame to
   * do here.
   */
}
