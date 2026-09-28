import { describe, expect, it, afterEach } from "vitest"
import { canonicalPageUrl } from "./pageUrl"

/**
 * The page decides its own address.
 *
 * Two real pages drive every case here, both verified in a live browser on
 * 2026-08-19 rather than assumed:
 *
 *   coingecko.com/en/coins/dogwifhat?v=2  canonical DROPS the ?v=2
 *   youtube.com/watch?v=dQw4w9WgXcQ       canonical KEEPS the ?v=
 *
 * That pair is the whole reason this function exists instead of a rule about
 * query strings: the same parameter name is noise on one host and identity on
 * another, and no allowlist can tell them apart. Production had 73 pages whose
 * conversation was split in two by getting this wrong, and 59 posts sitting on
 * a single `youtube.com/watch?v=...` that a naive fix would have merged into
 * every other video.
 */

const setPage = (href: string, head = "") => {
  // jsdom won't navigate, but it will let us rewrite the URL it reports.
  window.history.replaceState({}, "", new URL(href).pathname + new URL(href).search)
  Object.defineProperty(window, "location", {
    value: new URL(href),
    writable: true,
    configurable: true,
  })
  document.head.innerHTML = head
}

afterEach(() => {
  document.head.innerHTML = ""
})

describe("canonicalPageUrl", () => {
  it("drops a query parameter the page says is not part of its address", () => {
    setPage(
      "https://www.coingecko.com/en/coins/dogwifhat?v=2",
      '<link rel="canonical" href="https://www.coingecko.com/en/coins/dogwifhat">',
    )
    expect(canonicalPageUrl()).toBe("https://www.coingecko.com/en/coins/dogwifhat")
  })

  it("KEEPS a query parameter that IS the page", () => {
    // The failure mode a "just strip the query" fix would have caused: every
    // video on YouTube filed under one conversation.
    setPage(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      '<link rel="canonical" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">',
    )
    expect(canonicalPageUrl()).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  })

  it("gives both spellings of one page the SAME answer", () => {
    // This is the property the whole change exists for: post from one
    // address, read from the other, see the same conversation.
    const canonical = '<link rel="canonical" href="https://www.coingecko.com/en/coins/dogwifhat">'
    setPage("https://www.coingecko.com/en/coins/dogwifhat?v=2", canonical)
    const dirty = canonicalPageUrl()
    setPage("https://www.coingecko.com/en/coins/dogwifhat", canonical)
    expect(canonicalPageUrl()).toBe(dirty)
  })

  it("falls back to og:url when there is no canonical link", () => {
    setPage(
      "https://example.com/thing?utm_source=x",
      '<meta property="og:url" content="https://example.com/thing">',
    )
    expect(canonicalPageUrl()).toBe("https://example.com/thing")
  })

  it("falls back to the old stripper when the page states nothing", () => {
    // Degrading to exactly today's behaviour is what makes this safe to ship:
    // a page with no canonical is no worse off than before.
    setPage("https://example.com/thing?utm_source=x&keep=1")
    expect(canonicalPageUrl()).toBe("https://example.com/thing?keep=1")
  })

  it("refuses a canonical pointing at another origin", () => {
    // Syndicated articles do this, and following it would file this page's
    // conversation under somebody else's domain.
    setPage(
      "https://mirror.example.com/story?id=9",
      '<link rel="canonical" href="https://original.example.org/story">',
    )
    expect(canonicalPageUrl()).toBe("https://mirror.example.com/story?id=9")
  })

  it("resolves a relative canonical against the page", () => {
    setPage(
      "https://example.com/a/b?x=1",
      '<link rel="canonical" href="/a/b">',
    )
    expect(canonicalPageUrl()).toBe("https://example.com/a/b")
  })
})
