import { ARC_EDITION } from "~/config/edition"

/**
 * THE ARC EDITION'S WALLET SESSION: the other way to be signed in.
 *
 * Google sign-in leaves a Firebase session behind, and lib/axios turns it
 * into a bearer token on every request. A wallet sign-in has no Firebase
 * account: arc-api hands back its own session (prefix `arcw_`, checked by
 * arc-api's guard and nowhere else), which lives here, in
 * chrome.storage.local, and is sent the same way when there is no Firebase
 * user. One or the other, never both: the background signs Firebase out when
 * a wallet session lands, and clears this when a Google sign-in does.
 *
 * LOGOUT wipes chrome.storage.local, which takes this with it; the listener
 * at the bottom keeps each context's copy honest when that happens.
 */
export const WALLET_SESSION_KEY = "poppin_arc_wallet_session"
const PREFIX = "arcw_"

export interface WalletSession {
  token: string
  uid: string
  address: string
  /** Epoch ms the session stops being accepted. */
  exp: number
}

/** The session inside an `arcw_` token, or null for anything that is not one. */
export function decodeWalletToken(token: unknown): WalletSession | null {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null
  const [body, sig, extra] = token.slice(PREFIX.length).split(".")
  if (!body || !sig || extra !== undefined) return null
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"))
    const p = JSON.parse(json) as { uid?: unknown; address?: unknown; exp?: unknown }
    if (typeof p.uid !== "string" || typeof p.address !== "string" || typeof p.exp !== "number") return null
    if (!/^0x[0-9a-f]{40}$/.test(p.address) || p.uid !== `evm:${p.address}`) return null
    return { token, uid: p.uid, address: p.address, exp: p.exp }
  } catch {
    return null
  }
}

/** A stored value, if it is still a session worth sending. */
export function liveSession(v: unknown, now: number = Date.now()): WalletSession | null {
  const s = decodeWalletToken((v as { token?: unknown } | null)?.token)
  return s && s.exp > now ? s : null
}

let cache: WalletSession | null | undefined

export async function readWalletSession(): Promise<WalletSession | null> {
  if (!ARC_EDITION) return null
  if (cache === undefined) {
    try {
      const got = await chrome.storage.local.get(WALLET_SESSION_KEY)
      cache = liveSession(got?.[WALLET_SESSION_KEY])
    } catch {
      cache = null
    }
  }
  if (cache && cache.exp <= Date.now()) cache = null
  return cache
}

export async function saveWalletSession(token: string): Promise<WalletSession | null> {
  const s = liveSession({ token })
  if (!s) return null
  cache = s
  await chrome.storage.local.set({ [WALLET_SESSION_KEY]: { token: s.token } })
  return s
}

export async function clearWalletSession(): Promise<void> {
  cache = null
  try {
    await chrome.storage.local.remove(WALLET_SESSION_KEY)
  } catch {
    // Storage gone means the session is gone too.
  }
}

try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !(WALLET_SESSION_KEY in changes)) return
    cache = liveSession(changes[WALLET_SESSION_KEY]?.newValue)
  })
} catch {
  // No storage events in this context (tests): the cache simply re-reads.
}
