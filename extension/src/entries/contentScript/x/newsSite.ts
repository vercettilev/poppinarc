import type { SiteAdapter } from "./siteAdapter"

/**
 * AN ARTICLE, WHICH IS A FEED OF ONE.
 *
 * The strip was built for feeds and a news page has no repeating unit, so
 * the first instinct was that a row cannot belong here and the page-level
 * card was the only right shape. That was too strong. A feed's row belongs
 * under the post because the post is the thing the reader just finished;
 * on an article that thing is the HEADLINE, and it is just as real an
 * anchor. The document is simply a feed with one item in it.
 *
 * Measured before this was written, because the alternative was a second
 * pipeline: the local matcher already reads these headlines. "Anthropic
 * IPO launch shifts toward mid-October" returns ANTHROPIC, "Nvidia
 * earnings beat as data center revenue jumps" returns NVDAx. So the news
 * surface is the same engine and the same five tiers, not a new path that
 * asks the server what the page is about.
 *
 * NOTHING HERE IS SITE-SPECIFIC. Every selector below is a shape the web
 * agrees on — article or main, an h1, paragraphs — so a site nobody has
 * opened yet works or fails quietly, and neither outcome needs a patch.
 * The hostname list is the deliberate limit: it is the one place a person
 * decides where this runs, and it starts with what has been looked at.
 */
const NEWS_HOSTS = [
  "cnbc.com",
  "reuters.com",
  "bloomberg.com",
  "theverge.com",
  "techcrunch.com",
  "marketwatch.com",
  "barrons.com",
  "businessinsider.com",
  "ft.com",
  "wsj.com",
  "finance.yahoo.com",
  "theinformation.com",
]

export const NEWS_SITE: SiteAdapter = {
  id: "news",

  matches: (hostname) =>
    NEWS_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)),

  /**
   * THE HEADLINE IS THE UNIT, not the article around it.
   *
   * This was article-or-main first, and measured on a live CNBC page it
   * found neither: the page reported zero of each and exactly one h1. The
   * strip booted, chose this adapter and said "scanned 0 cells" — the line
   * that exists because a diagnostic unable to report zero cannot do its
   * job.
   *
   * Rather than learn one publisher's class names, the h1 becomes the
   * cell. Every article has one and it is already the anchor, so the unit
   * and the anchor are the same element and there is nothing left to
   * guess.
   */
  cell: "h1",
  post: "h1",

  /**
   * THE HEADLINE IS ALSO THE WHOLE INPUT, and that is a feature.
   *
   * Reading the page's prose was the obvious next move and it is the wrong
   * one: a news page's paragraphs carry the trending rail, the promos and
   * every other story it links to. Measured, that noise is what made a
   * CNBC piece about Anthropic match OPENAI — an article discussing rivals
   * hands them signals it never meant to.
   *
   * A headline does not have that problem. It is the claim, written by
   * someone whose job was to name the subject in ten words, and it was
   * measured to be enough alone: "Anthropic IPO launch shifts toward
   * mid-October" answers ANTHROPIC, "Nvidia earnings beat as data center
   * revenue jumps" answers NVDAx.
   *
   * The cost is a headline that names nobody — "Chipmaker beats
   * expectations" — and that one stays quiet, which is the answer this
   * engine gives everywhere else when it cannot be sure.
   */
  textNodes: () => [],

  title: (post) => post.textContent?.trim() ?? "",

  /**
   * The page's own address. There is no per-item permalink to find because
   * there is only one item, and the canonical link is what the article
   * says its own address is when the URL carries tracking.
   */
  permalink() {
    const canonical = document
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.href?.trim()
    const url = canonical && canonical.startsWith("http") ? canonical : location.href
    return { id: url, url }
  },

  /**
   * The publication, not a person. A byline is written a dozen ways and
   * means nothing to the matcher's author tier, which wants a handle that
   * IS an asset; the host at least never lies.
   */
  authorOf: () => location.hostname.replace(/^www\./, ""),

  /**
   * UNDER THE HEADLINE, which is the whole argument for a row here. After
   * the article would put it below the reader's exit, and before the
   * headline would interrupt the thing they came to read. The cell IS the
   * headline, so the chip becomes its next sibling.
   */
  actionRow: (post) => post,
}
