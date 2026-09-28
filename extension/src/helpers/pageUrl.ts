/**
 * Page-address normalisation. NOTHING ELSE BELONGS IN THIS FILE.
 *
 * Split out of urlHelper.ts because that module reaches the Firebase client
 * through its store imports, which made these pure string functions
 * impossible to unit-test — the first test run died on
 * `auth/invalid-api-key` before reaching a single assertion. Anything that
 * needs a browser API beyond `document`/`location`, or any app state, goes
 * back in urlHelper; this file stays importable from a bare test process.
 *
 * urlHelper re-exports both names, so existing call sites are unaffected.
 */
/**
 * The address a page says it lives at.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 * `coingecko.com/en/coins/dogwifhat` and `...dogwifhat?v=2` are the same page,
 * and we stored them as two different conversations: post from one address,
 * open the other, and your words were gone. Measured on production: 1,033 of
 * 3,724 distinct post URLs carry a query string, and 73 pages had their
 * conversation split in two this way.
 *
 * ── WHY NOT JUST DROP THE QUERY ─────────────────────────────────────────────
 * Because on some sites the query IS the page. `youtube.com/watch?v=FndUoZ32AfI`
 * has 59 posts on it; stripping `?v=` would pour every video ever discussed
 * into one `youtube.com/watch` conversation. Same site, even: `youtube.com/`
 * appears as `?app=desktop` (56 posts) and `?app=desktop&hl=ko&gl=KR` (55),
 * which SHOULD merge. No allowlist of "junk params" survives that, because
 * the same parameter name is junk on one host and identity on another.
 *
 * ── SO WE ASK THE PAGE ──────────────────────────────────────────────────────
 * `<link rel="canonical">` is the page's own statement of its address, and it
 * gets both cases right for free — verified in a real browser on 2026-08-19:
 *
 *   coingecko.com/en/coins/dogwifhat?v=2  → canonical drops the ?v=2
 *   youtube.com/watch?v=dQw4w9WgXcQ       → canonical KEEPS the ?v=
 *
 * Three tiers, degrading to exactly today's behaviour so this cannot make
 * anything worse: canonical, then og:url, then the old query stripper.
 *
 * ONLY MEANINGFUL IN A PAGE CONTEXT. The side panel has no DOM to read, which
 * is why it must not call this — it reads the already-canonicalised value out
 * of `useCurrentUrlStore`, written by the content script. One normalisation,
 * two surfaces; computing it twice is how the two drift apart.
 */
export const canonicalPageUrl = (fallbackUrl?: string): string => {
  const raw = fallbackUrl ?? (typeof location !== "undefined" ? location.href : "")
  if (typeof document === "undefined") return stripQueryParams(raw)
  try {
    // getAttribute, NOT .href — the property is already resolved, and it is
    // resolved against the DOCUMENT's base, which is not necessarily the URL
    // we were handed. Reading the raw attribute and resolving it ourselves
    // against `raw` keeps the two in step and makes a relative canonical
    // ("/a/b") behave the same everywhere.
    const stated =
      document
        .querySelector<HTMLLinkElement>('link[rel="canonical"]')
        ?.getAttribute("href") ||
      document
        .querySelector<HTMLMetaElement>('meta[property="og:url"]')
        ?.getAttribute("content") ||
      ""
    if (!stated) return stripQueryParams(raw)
    // Resolved against the page, so a relative canonical still works, and
    // sanity-checked: a canonical pointing at a different ORIGIN is either a
    // syndication marker or a mistake, and following it would file this
    // page's conversation under somebody else's domain.
    const resolved = new URL(stated, raw)
    const here = new URL(raw)
    if (resolved.origin !== here.origin) return stripQueryParams(raw)
    return resolved.href
  } catch {
    return stripQueryParams(raw)
  }
}

export const stripQueryParams = (url: string) => {
  if (!url) return url
  try {
    const urlObj = new URL(url)
    const paramsToRemove = [
      /^utm_/, // Matches any parameter starting with 'utm_'
      "ref",
      "referrer",
      "_ga",
      "fbclid",
      "gclid",
      "sessionid",
      "sid",
      "debug",
      "debugMode",
      "nocache",
      "cachebust",
      /^tid$/, // for polymarket.com
      // for google.com
      "sca_esv",
      "source",
      "ei",
      "iflsig",
      "ved",
      "uact",
      "oq",
      "gs_lp",
      "sclient",
    ]

    paramsToRemove.forEach((param) => {
      if (typeof param === "string") {
        urlObj.searchParams.delete(param)
      } else {
        // regex
        urlObj.searchParams.forEach((value, key) => {
          if (param.test(key)) {
            urlObj.searchParams.delete(key)
          }
        })
      }
    })

    return urlObj.toString()
  } catch (error) {
    return url
  }
}

