// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import {
  ipfsAlternatives,
  fetchIconAsDataUri,
  iconViaBackground,
  imageDataUri,
  MAX_ICON_BYTES,
} from "./iconBridge"

/**
 * The bridge that gets token icons past a host page's CSP. The worker half
 * is the part with judgement — what counts as an icon, what gets refused —
 * so that is what gets pinned.
 */

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe("imageDataUri", () => {
  it("wraps image bytes and nothing else", () => {
    const uri = imageDataUri("image/png", PNG)!
    expect(uri.startsWith("data:image/png;base64,")).toBe(true)
    // Decodes back to the exact bytes — the encoding is a carrier, not a lossy step.
    const decoded = Uint8Array.from(atob(uri.split(",")[1]), (c) => c.charCodeAt(0))
    expect([...decoded]).toEqual([...PNG])
  })

  it("refuses an error page wearing an icon URL", () => {
    // A dead IPFS gateway answers 200 text/html. Rendering that as an image
    // is a broken glyph; refusing it keeps the initial disc, which is fine.
    expect(imageDataUri("text/html", PNG)).toBeNull()
    expect(imageDataUri(null, PNG)).toBeNull()
  })

  it("strips content-type parameters before judging", () => {
    expect(imageDataUri("image/svg+xml; charset=utf-8", PNG)).not.toBeNull()
  })

  it("refuses the empty and the enormous", () => {
    expect(imageDataUri("image/png", new Uint8Array(0))).toBeNull()
    expect(imageDataUri("image/png", new Uint8Array(MAX_ICON_BYTES + 1))).toBeNull()
  })

  it("survives bytes past the chunk boundary", () => {
    // 8192 is the chunk size; an off-by-one there truncates every big icon.
    const big = new Uint8Array(8192 * 2 + 7).fill(65)
    const uri = imageDataUri("image/png", big)!
    const decoded = atob(uri.split(",")[1])
    expect(decoded.length).toBe(big.length)
  })
})

describe("fetchIconAsDataUri", () => {
  const ok = (type: string, bytes: Uint8Array) =>
    vi.fn(async () => ({
      ok: true,
      headers: { get: () => type },
      arrayBuffer: async () => bytes.buffer,
    })) as unknown as typeof fetch

  it("carries a real icon end to end", async () => {
    const uri = await fetchIconAsDataUri("https://cdn.example/icon.png", ok("image/png", PNG))
    expect(uri).toMatch(/^data:image\/png;base64,/)
  })

  it("refuses http — an icon is not worth a mixed-content hole", async () => {
    const f = ok("image/png", PNG)
    expect(await fetchIconAsDataUri("http://cdn.example/icon.png", f)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it("answers null for a 404, junk URL, or a throwing fetch", async () => {
    const notFound = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch
    expect(await fetchIconAsDataUri("https://x/i.png", notFound)).toBeNull()
    expect(await fetchIconAsDataUri("not a url")).toBeNull()
    const boom = vi.fn(async () => {
      throw new Error("net")
    }) as unknown as typeof fetch
    expect(await fetchIconAsDataUri("https://x/i.png", boom)).toBeNull()
  })
})

describe("ipfsAlternatives", () => {
  /**
   * A ladder, not a canonical door. The first version rewrote every
   * gateway to ipfs.io and stopped — which made ipfs.io a single point of
   * failure with NO retry at all for the URLs that already named it, and
   * Jupiter's metadata mostly does. Field report: CDN icons rendering,
   * every IPFS icon an initial disc — the shape of one blocked gateway.
   */
  it("gives the other gateways a turn, skipping the one that failed", () => {
    expect(ipfsAlternatives("https://ipfs.io/ipfs/bafkabc")).toEqual([
      "https://dweb.link/ipfs/bafkabc",
      "https://w3s.link/ipfs/bafkabc",
    ])
    // A dead third-party gateway gets the whole list.
    expect(ipfsAlternatives("https://dead.gw/ipfs/bafkabc")).toEqual([
      "https://ipfs.io/ipfs/bafkabc",
      "https://dweb.link/ipfs/bafkabc",
      "https://w3s.link/ipfs/bafkabc",
    ])
  })

  it("parses the subdomain form too, and keeps subpaths", () => {
    expect(ipfsAlternatives("https://bafkabc.ipfs.nftstorage.link")).toEqual([
      "https://ipfs.io/ipfs/bafkabc",
      "https://dweb.link/ipfs/bafkabc",
      "https://w3s.link/ipfs/bafkabc",
    ])
    expect(ipfsAlternatives("https://gw.x/ipfs/bafkabc/logo.png")[0]).toBe(
      "https://ipfs.io/ipfs/bafkabc/logo.png",
    )
  })

  it("invents nothing for a URL that is not IPFS-shaped", () => {
    // A CDN icon has exactly one address; retrying invented ones would
    // hammer a host that already answered.
    expect(ipfsAlternatives("https://cdn.example/icon.png")).toEqual([])
    expect(ipfsAlternatives("http://gw.x/ipfs/bafkabc")).toEqual([])
  })
})

describe("the failure/absence split, client edition", () => {
  it("climbs the ladder until a gateway answers", async () => {
    // First URL answers like nftstorage.link today (HTML landing page);
    // ipfs.io times out (the blocked-gateway case); dweb.link carries it.
    const calls: string[] = []
    const f = vi.fn(async (u: string) => {
      calls.push(u)
      if (u.startsWith("https://dweb.link/"))
        return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => PNG.buffer }
      if (u.startsWith("https://ipfs.io/")) return { ok: false }
      return { ok: true, headers: { get: () => "text/html" }, arrayBuffer: async () => PNG.buffer }
    }) as unknown as typeof fetch
    const uri = await fetchIconAsDataUri("https://bafkabc.ipfs.nftstorage.link", f)
    expect(uri).toMatch(/^data:image\/png/)
    expect(calls).toEqual([
      "https://bafkabc.ipfs.nftstorage.link/",
      "https://ipfs.io/ipfs/bafkabc",
      "https://dweb.link/ipfs/bafkabc",
    ])
  })

  it("retries the OTHER gateways when ipfs.io itself is the dead one", async () => {
    /**
     * The exact hole the field report exposed: the old code's only move
     * was "rewrite to ipfs.io", so a URL already there got no second
     * attempt — and one blocked gateway wore every memecoin's logo.
     */
    const calls: string[] = []
    const f = vi.fn(async (u: string) => {
      calls.push(u)
      return u.startsWith("https://w3s.link/")
        ? { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => PNG.buffer }
        : { ok: false }
    }) as unknown as typeof fetch
    const uri = await fetchIconAsDataUri("https://ipfs.io/ipfs/bafkabc", f)
    expect(uri).toMatch(/^data:image\/png/)
    expect(calls).toEqual([
      "https://ipfs.io/ipfs/bafkabc",
      "https://dweb.link/ipfs/bafkabc",
      "https://w3s.link/ipfs/bafkabc",
    ])
  })

  it("gives a non-IPFS icon exactly one attempt", async () => {
    const f = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch
    expect(await fetchIconAsDataUri("https://cdn.example/icon.png", f)).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("a failed fetch is never remembered by the page cache", async () => {
    // One slow gateway moment used to poison the icon for the whole
    // session: both caches stored null and no later mount ever retried.
    // A failure is remembered briefly; an absence properly — and a fetch
    // that answered nothing is a FAILURE.
    const sent: unknown[] = []
    const g = globalThis as { chrome?: unknown }
    const old = g.chrome
    let answer: string | null = null
    g.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage: (msg: unknown, cb: (r: unknown) => void) => {
          sent.push(msg)
          cb({ dataUri: answer })
        },
      },
    }
    try {
      expect(await iconViaBackground("https://gw.x/ipfs/bafkfail")).toBeNull()
      answer = "data:image/png;base64,AAAA"
      // The second mount must ASK AGAIN, and now it gets the icon.
      expect(await iconViaBackground("https://gw.x/ipfs/bafkfail")).toBe(answer)
      expect(sent.length).toBe(2)
      // A success IS cached: third call costs nothing.
      expect(await iconViaBackground("https://gw.x/ipfs/bafkfail")).toBe(answer)
      expect(sent.length).toBe(2)
    } finally {
      g.chrome = old
    }
  })
})
