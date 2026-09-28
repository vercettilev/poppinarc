/**
 * How a page is IDENTIFIED next to something posted on it: its icon, its
 * readable name, and the full address on hover.
 *
 * ── WHY THIS IS SHARED ──────────────────────────────────────────────────────
 * components/Post/WebsiteFavicon.tsx has done this in the side panel for a
 * long time, and the card now needs the same thing in its activity list. The
 * card cannot use that component — it is MUI, and the card lives in a closed
 * shadow root MUI does not reach — so what moves here is the part that is not
 * presentation: where the icon comes from, what the site is called, and the
 * poppin.so special case. The panel keeps its Tooltip and its Box; the card
 * renders a plain <img> and a native title.
 *
 * Same split as helpers/notificationText, for the same reason: the rule is
 * shared, the chrome is not. Copying it would have been the sixth time in one
 * session that a surface kept its own version of something two surfaces show.
 */

/** Strip the scheme and a leading www — what a person would read out loud. */
export const cleanSiteUrl = (url: string): string =>
  url.replace(/^(https?:\/\/)?(www\.)?/i, "")

/**
 * Google's favicon service, at the size actually being rendered.
 *
 * `poppinLogo` is passed in rather than imported: this file is reached from
 * the content script's card bundle, and an asset import there would pull an
 * image URL through a build path the card does not otherwise touch. The one
 * caller that has the logo to hand supplies it.
 */
export function siteFaviconUrl(
  url: string,
  sizePx = 64,
  poppinLogo?: string,
): string | null {
  try {
    const domain = new URL(url).hostname
    if (domain.includes("poppin.so") && poppinLogo) return poppinLogo
    const size = Math.max(16, Math.min(512, Math.round(sizePx)))
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
  } catch {
    return null
  }
}

/** The host alone — "coingecko.com" — for a label with no room for a path. */
export function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "")
  } catch {
    return null
  }
}

/** The hover text the panel already uses, so both surfaces say one thing. */
export const siteHoverText = (url: string): string =>
  `posted on ${cleanSiteUrl(url)}`
