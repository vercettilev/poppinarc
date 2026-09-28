/**
 * TOKEN ICONS ON SOMEBODY ELSE'S PAGE.
 *
 * The chip and the card render inside x.com, and x.com's CSP allows images
 * from its own hosts, data:, blob: and a short list of GIF vendors — not
 * from ipfs.io, not from any token-icon CDN. Setting `img.src` to the
 * asset's icon URL fails silently on exactly the surface the icon matters
 * most, which is why a feed full of chips wore initial discs while the
 * catalog held perfectly good logos.
 *
 * The measured loophole is in the policy itself: `data:` is allowed. The
 * BACKGROUND service worker is not subject to any page's CSP, so it fetches
 * the bytes and the page renders them as a data URI. One hop, no external
 * request from the page, and the same bridge works on every site we will
 * ever be injected into — this is not an x.com fix, it is the end of the
 * class.
 *
 * Bounded on both sides: the worker caps size and validates content-type
 * (an icon URL that answers with text/html is an error page, not an icon),
 * and both halves cache so a feed of twenty $WIF chips costs one fetch.
 */

export const ICON_FETCH = "POPPIN_ICON_FETCH"
/**
 * 1.5MB, raised from 400KB — and the old comment ("nobody ships a 400KB
 * icon on purpose") is exactly what killed $ANSEM's logo for four rounds:
 * its icon is a real, working, 863KB PNG on the project's own site, and
 * both ends of the pipe refused it silently while every probe of the
 * network came back healthy. Memecoin sites ship huge icons all the time.
 * The cap still exists because a data URI is held in page memory; it is a
 * guard against a page-crushing blob, not against a fat but honest logo.
 */
export const MAX_ICON_BYTES = 1_500_000

/** The data-URI assembly + the validation, pure so it is testable. */
export function imageDataUri(
  contentType: string | null,
  bytes: Uint8Array,
): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase()
  if (!type.startsWith("image/")) return null
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null
  // Chunked: String.fromCharCode(...400k args) overflows the stack.
  let bin = ""
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${type};base64,${btoa(bin)}`
}

/**
 * An IPFS URL names CONTENT; the gateway in it is just a door, and doors
 * die — or get blocked. The first version of this rewrote every gateway to
 * ipfs.io and stopped, which quietly made ipfs.io a single point of
 * failure: when the URL already NAMED ipfs.io there was no second attempt
 * at all, and Jupiter's metadata mostly does. Field report, 2026-08-28:
 * "tokenların çoğunun logosu gelmiyor" — CDN-hosted icons rendering while
 * every IPFS one wore the initial disc, which is exactly the shape of one
 * unreachable gateway (ipfs.io has a history of national DNS blocks) and
 * nothing else.
 *
 * So: a LADDER, not a canonical door. Both gateway shapes are parsed to
 * the content they name, and every gateway on the list except the one
 * that already failed gets a turn:
 *
 *   https://<gw>/ipfs/<cid>[/path]   (path form)
 *   https://<cid>.ipfs.<gw>[/path]   (subdomain form — nftstorage's)
 *
 * All three rungs verified live against the same CID before being listed
 * (ipfs.io 200 in 0.35s from here; dweb.link and w3s.link answer the path
 * form with a 301 to their subdomain form and land image/png — fetch
 * follows redirects, so the path form is enough). Empty for a URL that is
 * not IPFS-shaped: a plain CDN icon has exactly one address, and inventing
 * more would retry a host that already answered.
 */
const IPFS_GATEWAYS = ["ipfs.io", "dweb.link", "w3s.link"] as const

export function ipfsAlternatives(url: string): string[] {
  try {
    const u = new URL(url)
    if (u.protocol !== "https:") return []
    let cid: string | null = null
    let rest = ""
    const path = /^\/ipfs\/([A-Za-z0-9]+)(\/.*)?$/.exec(u.pathname)
    if (path) {
      cid = path[1]
      rest = path[2] ?? ""
    } else {
      const sub = /^([a-z0-9]+)\.ipfs\./.exec(u.hostname)
      if (sub) {
        cid = sub[1]
        rest = u.pathname === "/" ? "" : u.pathname
      }
    }
    if (!cid) return []
    return IPFS_GATEWAYS.filter((gw) => !u.hostname.includes(gw)).map(
      (gw) => `https://${gw}/ipfs/${cid}${rest}`,
    )
  } catch {
    return []
  }
}

async function fetchOnce(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const u = new URL(url)
    if (u.protocol !== "https:") return null
    const ctrl = new AbortController()
    // 8s: public IPFS gateways are slow on cold content, and this fetch is
    // garnish arriving after the chip is already usable.
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetchImpl(u.toString(), { signal: ctrl.signal })
      if (!res.ok) return null
      const bytes = new Uint8Array(await res.arrayBuffer())
      return imageDataUri(res.headers.get("content-type"), bytes)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/**
 * The worker-side fetch. Lives here rather than in background/main.ts so the
 * whole path — scheme check, timeout, type/size validation, encoding, the
 * one canonical-gateway retry — is one tested function, and the background
 * handler is a one-liner.
 */
export async function fetchIconAsDataUri(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const first = await fetchOnce(url, fetchImpl)
  if (first) return first
  // In order, stopping at the first gateway that answers: the ladder is
  // for one door being dead, not for racing them all.
  for (const alt of ipfsAlternatives(url)) {
    const got = await fetchOnce(alt, fetchImpl)
    if (got) return got
  }
  return null
}

/** Page-side: one in-flight promise per URL, for the whole content script. */
const cache = new Map<string, Promise<string | null>>()

export function iconViaBackground(url: string): Promise<string | null> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = new Promise<string | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: ICON_FETCH, url }, (res) => {
        void chrome.runtime.lastError
        const uri = (res as { dataUri?: string } | undefined)?.dataUri
        resolve(typeof uri === "string" && uri.startsWith("data:image/") ? uri : null)
      })
    } catch {
      resolve(null)
    }
  })
  cache.set(url, p)
  // A failure is remembered briefly; an absence properly — and a fetch that
  // answered nothing is a FAILURE. Dropping the entry means the NEXT mount
  // asks again, so one slow gateway moment stops poisoning the whole
  // session. (In-flight dedupe above still holds while the ask is out.)
  void p.then((uri) => {
    if (uri === null) cache.delete(url)
  })
  return p
}
