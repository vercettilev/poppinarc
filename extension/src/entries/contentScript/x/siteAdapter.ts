/**
 * WHAT A SITE LOOKS LIKE, so the strip does not have to know.
 *
 * The strip is eight thousand lines and, measured, exactly seven of them
 * knew they were on X: three selectors, the permalink it reads an id from,
 * the author it derives from that permalink, the landmark it mounts under,
 * and the hostname test. Everything else — the recycling guard, the quote
 * lane, the repeat ceiling, the tick registry, the money — was already
 * about posts in a feed rather than about X.
 *
 * So the site is a parameter now. A second feed is a second object, not a
 * second copy of the strip, and a rule fixed for one reader is fixed for
 * every reader on every site at once. That last property is the reason to
 * do it this way rather than forking: the field notes in this directory are
 * mostly recycling and half-render bugs, and every feed that virtualizes
 * has them.
 */
export interface SiteAdapter {
  /** Short name, for diagnostics. */
  readonly id: string
  /** True when this adapter owns the page. */
  matches(hostname: string): boolean
  /**
   * The repeating wrapper the feed recycles. The strip marks these and
   * watches them, so it must be the node that survives a scroll, not the
   * post inside it.
   */
  readonly cell: string
  /** The post itself, inside the cell. */
  readonly post: string
  /**
   * The post's own text nodes, excluding any quoted post. A list rather
   * than a selector because these are also where linkified symbols are
   * read from, and because the first of them is the layout landmark the
   * chip aligns to.
   */
  textNodes(post: Element): Element[]
  /**
   * Text the post carries OUTSIDE those nodes. X has none: a tweet is its
   * text. Reddit's is the title, which lives in an attribute and is where
   * most of the signal is — "NVDA earnings tomorrow" is a headline far more
   * often than it is a sentence in a body.
   */
  title(post: Element): string
  /**
   * The post's permalink and stable id, read off the post. Null while the
   * feed is still rendering: a half-drawn post is "ask again later", never
   * "nothing here".
   */
  permalink(post: Element): { id: string; url: string } | null
  /**
   * The author's handle. Given both the permalink and the post, because
   * the two sites keep it in different places: X's permalink IS
   * /<handle>/status/<id>, while a Reddit permalink names the subreddit
   * and never the person, who is an attribute on the post instead.
   */
  authorOf(url: string, post: Element): string | null
  /**
   * Where the strip belongs: the post's own action row, so the chip lands
   * on the same column as the text. Null falls back to after the post.
   */
  actionRow(post: Element): Element | null
}
