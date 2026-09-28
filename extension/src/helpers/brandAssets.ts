/**
 * THE BRAND, FETCHED BY THE WORKER AND HANDED TO THE PAGE.
 *
 * The flex card is drawn on a canvas inside the content script on x.com,
 * and it needs two things x.com does not have: PoppinSans and the Poppin
 * mark on its blue disc. Both already ship inside the extension
 * (public/fonts, public/icons), so the question is only how to reach them
 * from a page whose fetches run under x.com's rules.
 *
 * Embedding them as data URIs in the content script was the obvious road
 * and the expensive one: the two font weights alone are ~47KB of base64
 * added to a bundle that was cut from 2.2MB to 284K per page, and every
 * reader would pay it on every page for a card most never draw. The worker
 * can read its own files, so it reads them on demand and answers with a
 * data URI, which is also the one form a canvas can draw without being
 * tainted (a tainted canvas refuses toBlob and the share dies).
 *
 * AN ALLOWLIST, NOT A URL. The message names a key, and the worker maps it
 * to a fixed path. Taking a path or a URL from the page would turn this
 * into an open fetch proxy for anything the extension can read.
 */
export const BRAND_FETCH = "POPPIN_BRAND_FETCH"

export type BrandKey = "font-700" | "font-400" | "mark"

const BRAND_FILES: Record<BrandKey, { path: string; mime: string }> = {
  "font-700": { path: "fonts/PoppinSans-NormalBold.ttf", mime: "font/ttf" },
  "font-400": { path: "fonts/PoppinSans-NormalRegular.ttf", mime: "font/ttf" },
  /* The extension's own icon is the mark on its blue disc, the same art the
     landing page and the app icon use. The card used to draw the bare
     ghost, which on a dark ground reads as a generic ghost and not as us. */
  mark: { path: "icons/logo.png", mime: "image/png" },
}

export function brandFile(key: unknown): { path: string; mime: string } | null {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(BRAND_FILES, key)
    ? BRAND_FILES[key as BrandKey]
    : null
}

/** Chunked, because String.fromCharCode(...bytes) overflows the stack on a font. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/**
 * Worker side. Reads one allowlisted file out of the extension and returns
 * it as a data URI, or null for an unknown key or a missing file.
 */
export async function fetchBrandAsDataUri(
  key: unknown,
  deps: {
    getURL?: (path: string) => string
    fetchImpl?: typeof fetch
  } = {},
): Promise<string | null> {
  const file = brandFile(key)
  if (!file) return null
  try {
    const getURL = deps.getURL ?? ((p: string) => chrome.runtime.getURL(p))
    const res = await (deps.fetchImpl ?? fetch)(getURL(file.path))
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length === 0) return null
    return `data:${file.mime};base64,${bytesToBase64(bytes)}`
  } catch {
    return null
  }
}

/** Page side: one in-flight ask per key for the whole content script. */
const cache = new Map<BrandKey, Promise<string | null>>()

export function brandViaBackground(key: BrandKey): Promise<string | null> {
  const hit = cache.get(key)
  if (hit) return hit
  const want = brandFile(key)?.mime ?? ""
  const p = new Promise<string | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: BRAND_FETCH, key }, (res) => {
        void chrome.runtime.lastError
        const uri = (res as { dataUri?: string } | undefined)?.dataUri
        resolve(typeof uri === "string" && uri.startsWith(`data:${want};`) ? uri : null)
      })
    } catch {
      resolve(null)
    }
  })
  cache.set(key, p)
  // A failed ask is forgotten so the next press tries again; a stale
  // extension context after an update is the usual reason, and it heals.
  void p.then((uri) => {
    if (uri === null) cache.delete(key)
  })
  return p
}

/**
 * Registers PoppinSans on the page's font set for canvas drawing. Resolves
 * true once both weights are usable, false when they could not be had; the
 * card is drawn either way, falling back to the system stack, because a
 * share in the wrong typeface still beats a share that never happens.
 */
let fontReady: Promise<boolean> | null = null
export function loadBrandFont(): Promise<boolean> {
  if (fontReady) return fontReady
  fontReady = (async () => {
    try {
      if (typeof FontFace === "undefined" || !document.fonts) return false
      const [bold, regular] = await Promise.all([
        brandViaBackground("font-700"),
        brandViaBackground("font-400"),
      ])
      if (!bold || !regular) return false
      const faces = [
        new FontFace("PoppinSans", `url(${bold})`, { weight: "700" }),
        new FontFace("PoppinSans", `url(${regular})`, { weight: "400" }),
      ]
      await Promise.all(faces.map((f) => f.load()))
      for (const f of faces) document.fonts.add(f)
      return true
    } catch {
      return false
    }
  })()
  // Not cached on failure, for the same reason as the asset asks above.
  void fontReady.then((ok) => {
    if (!ok) fontReady = null
  })
  return fontReady
}
