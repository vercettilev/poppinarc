import { describe, expect, it } from "vitest"
import { NEWS_SITE } from "./newsSite"
import { extractTweet } from "./xStrip"
import { matchTweet, resetXMatchIndex } from "./xMatch"

/**
 * The headline is the anchor, and the local matcher already reads it. This
 * was measured before the adapter was written, because the alternative
 * design — asking the server what the page is about, the way the page card
 * does — would have been a second pipeline for the same answer.
 */
const article = (headline: string, body = ""): Element => {
  // Deliberately NOT wrapped in article or main: measured on a live CNBC
  // page, that wrapper does not exist. The h1 is the unit.
  document.body.innerHTML = `<div><h1>${headline}</h1>${body ? `<p>${body}</p>` : ""}</div>`
  return document.querySelector("h1")!
}

describe("an article is a feed of one", () => {
  it("runs only where somebody decided it should", () => {
    for (const h of ["cnbc.com", "www.cnbc.com", "finance.yahoo.com", "theverge.com"]) {
      expect(NEWS_SITE.matches(h), h).toBe(true)
    }
    for (const h of ["cnbc.com.evil.net", "notcnbc.com", "x.com", "reddit.com"]) {
      expect(NEWS_SITE.matches(h), h).toBe(false)
    }
  })

  it("reads the headline, which is where the company is named", () => {
    const post = article("Anthropic IPO launch shifts toward mid-October: Reuters")
    expect(NEWS_SITE.title(post)).toContain("Anthropic")
    expect(extractTweet(post, NEWS_SITE)?.text).toContain("Anthropic IPO")
  })

  // The page's prose carries the trending rail, the promos and every other
  // story it links to, and that noise is what made a CNBC piece about
  // Anthropic match OPENAI. The headline is the claim; nothing else is read.
  it("reads the headline and nothing else on the page", () => {
    const post = article("Nvidia earnings beat", "Also read: OpenAI unveils GPT-5.")
    const text = extractTweet(post, NEWS_SITE)!.text
    expect(text).toContain("Nvidia earnings beat")
    expect(text).not.toContain("OpenAI")
  })

  it("hands the engine something it already knows how to answer", () => {
    resetXMatchIndex()
    const post = article("Anthropic IPO launch shifts toward mid-October: Reuters")
    const facts = extractTweet(post, NEWS_SITE)!
    expect(matchTweet(facts.text, facts.cashtags, undefined, facts.author)?.row.ticker).toBe(
      "ANTHROPIC",
    )
  })

  it("anchors on the headline itself, so the chip is its next sibling", () => {
    const post = article("Tesla deliveries climb")
    expect((NEWS_SITE.actionRow(post) as HTMLElement | null)?.tagName).toBe("H1")
    expect(NEWS_SITE.cell).toBe("h1")
  })

  it("finds nothing on a page with no headline at all", () => {
    document.body.innerHTML = "<div><p>just prose</p></div>"
    expect(document.querySelector(NEWS_SITE.cell)).toBeNull()
  })
})
