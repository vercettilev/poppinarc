import axios from "axios"
import { onAuthStateChanged } from "firebase/auth/web-extension"
import { auth } from "~/lib/firebase"

/**
 * Wait for Firebase to finish restoring the session — ONCE, then never again.
 *
 * THE BUG THIS FIXES: `auth.currentUser` is read synchronously, and in an MV3
 * service worker that just woke up it is null for a moment while the SDK
 * rehydrates from storage. Requests issued in that window went out with no
 * Authorization header, the backend answered 401, and the surfaces that treat
 * 401 as "signed out" believed it: a signed-in reader was told "Sign in to
 * trade" on the card and "Sign in to post" in the panel. Nothing was wrong
 * with their session; we asked before Firebase had finished answering.
 *
 * The wait costs nothing once resolved (the promise is cached) and nothing for
 * a genuinely signed-out user either — onAuthStateChanged fires with null
 * almost immediately. The timeout exists so a Firebase that never calls back
 * degrades to today's behaviour instead of hanging every request forever.
 */
let authSettled: Promise<void> | null = null
const AUTH_SETTLE_TIMEOUT_MS = 3000
export function whenAuthSettled(): Promise<void> {
  if (!auth || auth.currentUser) return Promise.resolve()
  if (!authSettled) {
    authSettled = new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        try {
          unsub()
        } catch {}
        resolve()
      }
      const unsub = onAuthStateChanged(auth, finish, finish)
      setTimeout(finish, AUTH_SETTLE_TIMEOUT_MS)
    })
  }
  return authSettled
}

export const backendApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    extension: true,
  },
  withCredentials: true,
  timeout: 90000, // 90 seconds timeout for blockchain operations
})

// Attach Firebase ID token as Authorization header on every request.
//
// We send all requests through the extension's service worker (see
// background/main.ts API_REQUEST handler), which means cross-origin
// cookies are unreliable under MV3 — Chrome strips the api.poppin.so
// session cookie for some service-worker-originated fetches even with
// `withCredentials: true`. The result was that endpoints like
// /polymarket/deposit-wallet, /wallets/balance, /users/me randomly
// returned 401 "No token provided", even though others succeeded in
// the same session.
//
// Firebase auth state lives in `auth` from ~/lib/firebase. We pull a
// fresh ID token on every request (Firebase caches it for ~1h and
// auto-refreshes when stale, so this is cheap). The backend's
// FirebaseAuthGuard already accepts both Authorization: Bearer and
// the cookie path, so this just adds the more reliable channel.
/**
 * Routes that must go out WITHOUT the reader's identity.
 *
 * These three are public by the backend's own design — AssetMatchController
 * puts FirebaseAuthGuard on its trade/balance methods and deliberately not on
 * these, and its header says so: "it needs no auth and mints no trade token.
 * A reader viewing a page must not acquire a trading credential just because
 * the page happened to mention SpaceX."
 *
 * The interceptor below was attaching one anyway, because it attaches to
 * everything. That mattered more than it sounds: /embed/asset/match carries
 * the url, title and 20,000 characters of body text of EVERY page the reader
 * opens, so a bearer token on it turned an anonymous "some browser read this
 * page" into "this named account read this page" — for a server that never
 * asked and never checks. Nothing on that route reads req.user, and there is
 * no per-user throttling on it, so the token was pure gratuitous leakage.
 *
 * Skipping the token also skips whenAuthSettled(), which takes these calls
 * off the auth-initialisation critical path — they fire on every page load.
 */
const PUBLIC_ROUTES = [
  "/embed/asset/match",
  "/embed/asset/candidates",
  "/embed/asset/quote",
  "/embed/asset/prices",
  /* The anonymous funnel ingest, for the same reason and more sharply.
     It exists to record that SOME install saw a chip, which is the one
     thing the signed-in route cannot record. Attaching a bearer token to
     it would name the very reader it promises not to, and would do it on
     a route whose column is documented as holding nothing about anybody.
     The backend refuses a user_id here regardless; this makes sure one is
     never offered. */
  "/user-events/anon",
]

backendApi.interceptors.request.use(async (config) => {
  const SPOT_DEBUG = process.env.POPPIN_TEST_BUILD === "true"
  const isSpot = (config.url ?? "").includes("/embed/asset/")
  const url = config.url ?? ""
  if (PUBLIC_ROUTES.some((r) => url.startsWith(r))) {
    if (SPOT_DEBUG) console.info(`[poppin-spot] SW: ${url} — public route, sending WITHOUT identity`)
    return config
  }
  try {
    // Ask only after Firebase has had its say — see whenAuthSettled.
    await whenAuthSettled()
    const user = auth?.currentUser
    if (SPOT_DEBUG && isSpot)
      console.info(`[poppin-spot] SW: ${config.url} — auth.currentUser is ${user ? "SET (will fetch ID token)" : "null (no token, sending as public)"}`)
    if (user) {
      const t0 = Date.now()
      const idToken = await user.getIdToken()
      if (SPOT_DEBUG && isSpot)
        console.info(`[poppin-spot] SW: getIdToken took ${Date.now() - t0}ms`)
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${idToken}`
    }
  } catch (err) {
    // Don't block the request if token fetch fails — the cookie
    // fallback may still work for some endpoints, and unauthenticated
    // requests will surface their own 401 with a clearer error.
    console.warn("[axios] Failed to attach Firebase ID token", err)
  }
  return config
})

// One forced refresh on a 401, then the original request again.
//
// getIdToken() trusts its cache: if the SDK believes the token is still valid
// it returns it without a network trip, and a profile whose cached session has
// rotted (laptop asleep past expiry, clock skew, long-idle SW) hands the
// backend an expired JWT with full confidence. The guard answers 401
// "Token expired", and every feature behind it looks broken while Firebase
// insists everything is fine.
//
// getIdToken(true) bypasses that cache and mints a fresh token via the refresh
// token. `_authRetried` caps this at one retry per request: if the fresh token
// ALSO 401s, the session is genuinely dead and the error should reach the user
// as a sign-in problem, not loop.
backendApi.interceptors.response.use(undefined, async (error) => {
  const cfg = error?.config as (typeof error.config & { _authRetried?: boolean }) | undefined
  const status = error?.response?.status
  if (status === 401 && cfg && !cfg._authRetried && auth?.currentUser) {
    cfg._authRetried = true
    try {
      const fresh = await auth.currentUser.getIdToken(true)
      cfg.headers = { ...(cfg.headers ?? {}), Authorization: `Bearer ${fresh}` }
      return backendApi(cfg)
    } catch {
      // Refresh itself failed — the original 401 is the truthful error.
    }
  }
  return Promise.reject(error)
})

export const nextApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_BASE_URL + "/api",
  headers: {
    extension: true,
  },
  timeout: 30000, // 30 seconds timeout
})
