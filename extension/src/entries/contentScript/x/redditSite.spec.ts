import { describe, expect, it } from "vitest"
import { REDDIT_SITE } from "./redditSite"
import { extractTweet } from "./xStrip"

/**
 * These run against a synthetic post built to Reddit's documented shape.
 * They prove the adapter is INTERNALLY right — that the engine gets a
 * title, an author and a permalink out of that shape, and that a cashtag
 * survives a site which linkifies nothing. They do NOT prove the four
 * selectors match live Reddit; only a console probe on a real page does
 * that, and until it has run this file is a specification rather than a
 * measurement.
 */
const feedItem = (attrs: Record<string, string>, body = ""): Element => {
  const cell = document.createElement("article")
  const post = document.createElement("shreddit-post")
  for (const [k, v] of Object.entries(attrs)) post.setAttribute(k, v)
  post.innerHTML =
    (body ? `<div slot="text-body">${body}</div>` : "") + '<div slot="credit-bar"></div>'
  cell.appendChild(post)
  return cell
}

const POST = {
  "post-title": "NVDA earnings tomorrow, loading up",
  permalink: "/r/stocks/comments/1abc/nvda_earnings_tomorrow/",
  id: "t3_1abc",
  author: "someinvestor",
}

describe("the Reddit adapter", () => {
  it("owns reddit.com and not a lookalike", () => {
    for (const h of ["reddit.com", "www.reddit.com", "old.reddit.com", "sh.reddit.com"]) {
      expect(REDDIT_SITE.matches(h), h).toBe(true)
    }
    for (const h of ["reddit.com.evil.net", "notreddit.com", "x.com"]) {
      expect(REDDIT_SITE.matches(h), h).toBe(false)
    }
  })

  it("reads the title, which is where the claim usually is", () => {
    const post = feedItem(POST).querySelector("shreddit-post")!
    const facts = extractTweet(post, REDDIT_SITE)!
    expect(facts.text).toContain("NVDA earnings tomorrow")
    expect(facts.author).toBe("someinvestor")
    expect(facts.id).toBe("1abc")
    expect(facts.url).toBe("https://www.reddit.com/r/stocks/comments/1abc/nvda_earnings_tomorrow/")
  })

  it("joins the title and the body, so a claim in either is read", () => {
    const post = feedItem(POST, "chips are cheap right now").querySelector("shreddit-post")!
    const text = extractTweet(post, REDDIT_SITE)!.text
    expect(text).toContain("NVDA earnings")
    expect(text).toContain("chips are cheap")
  })

  it("finds a cashtag Reddit never turned into a link", () => {
    const post = feedItem({ ...POST, "post-title": "$NVDA into earnings" }).querySelector("shreddit-post")!
    expect(extractTweet(post, REDDIT_SITE)!.cashtags).toEqual(["$NVDA"])
  })

  it("says ask-again-later on a post with no permalink yet", () => {
    const { permalink, ...half } = POST
    void permalink
    const post = feedItem(half).querySelector("shreddit-post")!
    expect(extractTweet(post, REDDIT_SITE)).toBeNull()
  })

  it("anchors the chip to the post's own control row", () => {
    const post = feedItem(POST).querySelector("shreddit-post")!
    expect((REDDIT_SITE.actionRow(post) as HTMLElement | null)?.getAttribute("slot")).toBe("credit-bar")
  })
})

// Measured on a live post page: [$$('article').length, $$('shreddit-post')
// .length] came back [0, 1]. The adapter had assumed a wrapper the way X
// has one, so the strip walked zero cells and reported exactly that.
describe("a post with no wrapper around it", () => {
  it("is its own cell", () => {
    expect(REDDIT_SITE.cell).toBe(REDDIT_SITE.post)
  })

  it("is found by a lookup that starts at the cell", () => {
    const cell = document.createElement("shreddit-post")
    for (const [k, v] of Object.entries(POST)) cell.setAttribute(k, v)
    const found = cell.matches(REDDIT_SITE.post) ? cell : cell.querySelector(REDDIT_SITE.post)
    expect(found, "the strip must not look only INSIDE the cell").toBe(cell)
    expect(extractTweet(found!, REDDIT_SITE)?.author).toBe("someinvestor")
  })
})
