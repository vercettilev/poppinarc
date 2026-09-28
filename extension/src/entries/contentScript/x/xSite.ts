import type { SiteAdapter } from "./siteAdapter"

/**
 * X, as the strip has always read it. Every line here was previously a
 * constant or an inline regex inside xStrip; nothing about the behaviour
 * changes by moving it, which is the point — the second site is the one
 * that has to prove itself, not this one.
 */
export const X_SITE: SiteAdapter = {
  id: "x",

  matches: (hostname) => /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(hostname),

  /**
   * The timeline is hard-virtualized: about five posts exist at any moment,
   * inside these wrappers, and the wrapper is what gets recycled. Marking
   * the post instead loses the mark on every scroll.
   */
  cell: 'div[data-testid="cellInnerDiv"]',
  post: 'article[data-testid="tweet"]',

  textNodes: (post) => [...post.querySelectorAll('[data-testid="tweetText"]')],

  /** A tweet is its text. There is no headline above it. */
  title: () => "",

  permalink(post) {
    for (const a of post.querySelectorAll('a[href*="/status/"]')) {
      const raw = a.getAttribute("href") ?? ""
      const m = /\/status\/(\d+)/.exec(raw)
      if (m?.[1]) {
        return { id: m[1], url: raw.startsWith("http") ? raw : `https://x.com${raw}` }
      }
    }
    return null
  },

  /**
   * Derived from the permalink rather than threaded as a separate field, so
   * this end and the backend's caller regex agree on what "the author" is
   * by construction rather than by two people remembering the same thing.
   */
  authorOf: (url) => /^https:\/\/(?:x|twitter)\.com\/([^/?#]+)\/status/i.exec(url)?.[1] ?? null,

  /**
   * role="group" is what X gives the reply/retweet/like cluster, and the
   * chip belongs immediately under it. The last one wins: a quoted post
   * carries its own, and the outer post's row is the later of the two.
   */
  actionRow: (post) => [...post.querySelectorAll('[role="group"]')].pop() ?? null,
}
