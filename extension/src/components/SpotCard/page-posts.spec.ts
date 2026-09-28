import { describe, expect, it, vi } from "vitest"
import { sanitisePostText } from "./sanitisePostText"

const rows = vi.hoisted(() => ({ data: [] as unknown[], meta: {} }))
vi.mock("~/services/WebsitePostService", () => ({
  WebsitePostService: { get: async () => rows },
}))

/**
 * The card renders strangers' text inside a closed shadow root on someone
 * else's domain. Preact writes through textContent, so markup cannot execute —
 * these cases cover what textContent alone does NOT solve.
 */
describe("sanitisePostText", () => {
  it("strips URLs to a bare host", () => {
    // A live link inside a card sitting on a trusted page borrows that page's
    // credibility for whatever a stranger points at. Nothing here is clickable.
    expect(sanitisePostText("check https://evil.example.com/login?next=x now")).toBe(
      "check [evil.example.com] now",
    )
  })

  it("keeps markup inert as text rather than pretending to parse it", () => {
    const out = sanitisePostText('<img src=x onerror="alert(1)">')
    // Flattened, not stripped. Preact sets this via textContent, where a tag is
    // just characters; writing a tag stripper here would invite the usual
    // half-correct sanitiser bugs for no gain.
    expect(out).toContain("<img")
  })

  it("collapses control characters and whitespace runs", () => {
    // ESCAPES, never literal invisibles: an unreadable character pasted into a
    // source file is unreviewable, and the first version of this test asserted
    // against a character nobody could see (it was not the one intended).
    expect(sanitisePostText("a b\n\n\n   c\u200Bd")).toBe("a b c d")
  })

  it("neutralises bidi overrides", () => {
    // U+202E reverses the visual order of what follows, so a post can render
    // as something other than what it says — the one control character with a
    // deception story rather than a layout one.
    expect(sanitisePostText("pay \u202Egro.live")).toBe("pay gro.live")
  })

  it("survives empty and undefined input", () => {
    expect(sanitisePostText("")).toBe("")
    expect(sanitisePostText(undefined as unknown as string)).toBe("")
  })
})

/**
 * THE RECEIPT ON THE WIRE. The server has stored the traded mint on every
 * trade post since 2026-08-19 and this mapper dropped it on the floor for
 * months, so the card parsed its own sentence to recover a direction and
 * could offer nothing to act on. These cases pin the read.
 */
describe("what a trade row carries", () => {
  const base = {
    id: "p1",
    content: "Bought 7.32 $WIF ($1.00) on www.coingecko.com via Poppin",
    user_id: "u1",
    created_at: "2026-08-23T00:00:00Z",
    on_chain: true,
    user: { username: "ada" },
  }
  const first = async (row: unknown) => {
    rows.data = [row]
    const { fetchPagePosts } = await import("./pagePosts")
    return (await fetchPagePosts("https://x.com/a/status/1")).posts[0]
  }

  it("takes the mint and the side from the stored transaction", async () => {
    const p = await first({
      ...base,
      post_transaction: {
        token_mint: "MINT_WIF",
        token_symbol: "$WIF",
        token_amount: 7.32,
        trade_type: "buy",
      },
    })
    expect(p.trade).toEqual({ mint: "MINT_WIF", symbol: "$WIF", amount: 7.32 })
    expect(p.side).toBe("buy")
  })

  it("believes the transaction over the sentence when they disagree", async () => {
    // The words are ours and can be edited or mis-generated; trade_type is
    // what the swap actually did.
    const p = await first({
      ...base,
      content: "Bought 7.32 $WIF",
      post_transaction: {
        token_mint: "MINT_WIF",
        token_symbol: "$WIF",
        token_amount: 7.32,
        trade_type: "sell",
      },
    })
    expect(p.side).toBe("sell")
  })

  it("falls back to reading the sentence on rows written before receipts", async () => {
    const p = await first({ ...base, content: "Sold 7.32 $WIF ($1.00)" })
    expect(p.side).toBe("sell")
    expect(p.trade).toBeNull()
  })

  it("leaves an ordinary post with neither", async () => {
    const p = await first({ ...base, on_chain: false, content: "nice chart" })
    expect(p.side).toBeNull()
    expect(p.trade).toBeNull()
  })
})

describe("the chip's door into the panel", () => {
  /**
   * openAssetInPanel wrote "/" for as long as it existed — correct when
   * "/" WAS the feed, and quietly the positions screen ever since the
   * restructure. Its sibling openInPanel was caught and fixed earlier;
   * this one had no spec, so it kept landing readers on POSITIONS until
   * a field report said so in as many words. The route is load-bearing:
   * the feed is where PageAssetStrip consumes the launch mint, so any
   * other destination swallows the asset the reader pressed.
   */
  it("openPanelRoom admits only the rooms a news row can honestly mean", async () => {
    const stored: Record<string, unknown> = {}
    const g = globalThis as { chrome?: unknown }
    const old = g.chrome
    g.chrome = {
      storage: { local: { set: async (kv: Record<string, unknown>) => Object.assign(stored, kv) } },
      runtime: { sendMessage: () => {} },
    }
    try {
      const { openPanelRoom } = await import("./pagePosts")
      // A route is a string crossing a boundary: anything outside the
      // whitelist is dropped, not navigated.
      openPanelRoom("/settings")
      openPanelRoom("/token/../../evil")
      openPanelRoom("/token/short")
      await new Promise((r) => setTimeout(r, 0))
      expect(stored.initialRoute).toBeUndefined()
      openPanelRoom("/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm")
      await new Promise((r) => setTimeout(r, 0))
      expect(stored.initialRoute).toBe(
        "/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
      )
      openPanelRoom("/profile/u1")
      await new Promise((r) => setTimeout(r, 0))
      expect(stored.initialRoute).toBe("/profile/u1")
      openPanelRoom("/feed")
      await new Promise((r) => setTimeout(r, 0))
      expect(stored.initialRoute).toBe("/feed")
    } finally {
      g.chrome = old
    }
  })

  it("routes to the TOKEN'S OWN ROOM, with the tweet riding along", async () => {
    /**
     * This asserted "/feed" for a long time, and the reason it changed is
     * worth keeping: a door has to pay for the trip. Pressing the arrow
     * costs a reader their place in the timeline, and a feed gave them a
     * second social surface in exchange for a price they tapped. The token
     * room gives them the position they hold, what they paid, every fill
     * on this asset, their standing orders, and a chart that scrubs.
     *
     * The tweet URL still rides along so the conversation is one step
     * away rather than the destination.
     */
    const stored: Record<string, unknown> = {}
    const sent: unknown[] = []
    const g = globalThis as { chrome?: unknown }
    const old = g.chrome
    g.chrome = {
      storage: { local: { set: async (kv: Record<string, unknown>) => Object.assign(stored, kv) } },
      runtime: { sendMessage: (msg: unknown) => { sent.push(msg) } },
    }
    try {
      const { openAssetInPanel } = await import("./pagePosts")
      openAssetInPanel("MINT111", "https://x.com/a/status/1")
      await new Promise((r) => setTimeout(r, 0))
      expect(stored.initialRoute).toBe("/token/MINT111")
      expect(sent[0]).toEqual({
        action: "TOGGLE_SIDE_PANEL",
        payload: { url: "https://x.com/a/status/1", mint: "MINT111" },
      })
    } finally {
      g.chrome = old
    }
  })
})
