import { describe, expect, it } from "vitest"
import { X_SITE } from "./xSite"

/**
 * The adapter is a refactor, so these pin that it reads X exactly as the
 * strip's own constants did. If this file and xStrip ever disagree, the
 * strip is the one that has moved.
 */
describe("the X adapter", () => {
  it("owns x.com and twitter.com, and nothing that merely contains them", () => {
    for (const host of ["x.com", "www.x.com", "twitter.com", "mobile.twitter.com"]) {
      expect(X_SITE.matches(host), host).toBe(true)
    }
    for (const host of ["notx.com", "x.com.evil.net", "reddit.com", "xcom.io"]) {
      expect(X_SITE.matches(host), host).toBe(false)
    }
  })

  it("reads the permalink and absolutises it", () => {
    const post = document.createElement("article")
    post.innerHTML = '<a href="/jack/status/20">t</a>'
    expect(X_SITE.permalink(post)).toEqual({ id: "20", url: "https://x.com/jack/status/20" })
  })

  it("says ask-again-later on a post that has not rendered its link", () => {
    const post = document.createElement("article")
    post.innerHTML = "<span>loading</span>"
    expect(X_SITE.permalink(post)).toBeNull()
  })

  it("derives the author from the permalink it produced", () => {
    const post = document.createElement("article")
    expect(X_SITE.authorOf("https://x.com/jack/status/20", post)).toBe("jack")
    expect(X_SITE.authorOf("https://twitter.com/Jack/status/20", post)).toBe("Jack")
    expect(X_SITE.authorOf("https://x.com/home", post)).toBeNull()
  })

  it("takes the outer action row, not the quoted post's", () => {
    const post = document.createElement("article")
    post.innerHTML = '<div role="group" id="quoted"></div><div role="group" id="outer"></div>'
    expect((X_SITE.actionRow(post) as HTMLElement | null)?.id).toBe("outer")
  })
})

// The cashtag read used to be anchors only, which is X saying "this is a
// symbol". X does not say it for a token it has never heard of, and that is
// exactly the token a reader is looking at. A live sweep of seventy cells
// reported one cashtag on a feed that carried more.
describe("reading cashtags", () => {
  const post = (html: string): Element => {
    const el = document.createElement("article")
    el.innerHTML = `<a href="/someone/status/1">t</a><div data-testid="tweetText">${html}</div>`
    return el
  }

  it("still prefers the anchor, which carries the site's own casing", async () => {
    const { extractTweet } = await import("./xStrip")
    expect(extractTweet(post('<a>$NVDA</a> earnings'))?.cashtags).toEqual(["$NVDA"])
  })

  it("finds a symbol the site never linkified", async () => {
    const { extractTweet } = await import("./xStrip")
    expect(extractTweet(post("$BULLSHIT is my community"))?.cashtags).toEqual(["$BULLSHIT"])
  })

  it("does not report the same symbol twice when it is both", async () => {
    const { extractTweet } = await import("./xStrip")
    expect(extractTweet(post('<a>$SOL</a> and $sol again'))?.cashtags).toEqual(["$SOL"])
  })

  it("leaves a bare price alone", async () => {
    const { extractTweet } = await import("./xStrip")
    expect(extractTweet(post("up $20 today"))?.cashtags).toEqual([])
  })
})
