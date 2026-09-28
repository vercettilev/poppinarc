// @vitest-environment node
import http from "node:http"
import type { AddressInfo } from "node:net"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import axios from "axios"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * DOES THE 404 BRANCH ACTUALLY FIRE?
 *
 * Site chat ships DARK: SITE_CHAT_ENABLED is unset, so every /site-chat/*
 * route answers 404 (site-chat-enabled.guard.ts), and an off-allowlist host
 * answers the same 404 on purpose. Nothing on the client is gated by an env
 * flag — THE 404 IS THE SWITCH. Three branches read it:
 *
 *   1. helpers/presence.ts   `pingSitePresence` → { available: false }, which
 *      is what stops the document heartbeat (a beat per 15s per visible tab).
 *   2. helpers/siteChatApi.ts `failureOf`       → "no_chat".
 *   3. entries/background/main.ts `beatSitePresence` → siteChatDarkHosts, which
 *      is what stops the once-a-minute alarm backstop.
 *
 * If the status does not survive the hops, none of them fire and the shipped
 * default becomes a permanent request loop against a route that does not
 * exist — quiet in the UI, loud on the wire, invisible in review.
 *
 * AND THE STATUS TRAVELS TWO DIFFERENT SHAPES, which is the trap this file
 * exists to nail down:
 *
 *   - The documents call through sendApiRequest → a runtime message → the
 *     background's API_REQUEST handler, which REBUILDS the error as a plain
 *     { status, code, message } (main.ts:753-767). They must read `e.status`.
 *   - The alarm backstop cannot send itself a runtime message, so it calls
 *     backendApi (axios) DIRECTLY and must read `e.response.status`.
 *
 * Read the wrong one and the branch is dead code that greps as present — the
 * existing assertion in components/site-live-pill.spec.ts is a source match on
 * /status === 404/ and cannot tell the difference. So this spec produces a
 * REAL 404 from a REAL server through REAL axios, applies the background's own
 * mapping expression to the real error, and feeds the result into the real
 * consumer functions.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock("~/lib/fetchService", () => ({
  sendApiRequest: send,
  STALE_CONTEXT: "poppin/stale-context",
}))

import { pingSitePresence, SITE_PRESENCE_PING_ROUTE } from "~/helpers/presence"
import { clearSiteChatTicket, getSiteChatTicket } from "~/helpers/siteChatApi"

/** chrome.storage, because the beat will not go out without an install id. */
const stored: Record<string, unknown> = {
  poppin_site_presence_anon: "beefbeefbeefbeefbeefbeefbeefbeef",
}
;(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: stored[key] }),
      set: async (patch: Record<string, unknown>) => {
        Object.assign(stored, patch)
      },
    },
    onChanged: { addListener: () => {} },
  },
}

interface Stub {
  base: string
  close: () => Promise<void>
}

/** A server that answers exactly what Nest answers when the guard throws. */
function serverAnswering(status: number, body: unknown): Promise<Stub> {
  return new Promise<Stub>((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    })
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({
        base: "http://127.0.0.1:" + port + "/api/v1",
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

/** What an AxiosError looks like from a caller's side — the only two places a
 *  status can hide, which is the whole subject of this file. */
interface WireError {
  response?: { status?: number; data?: { error?: string; message?: string } }
  message?: string
}

/** The real POST the heartbeat makes, against a real socket. */
async function beat(base: string): Promise<WireError | null> {
  const api = axios.create({ baseURL: base, headers: { extension: true } })
  try {
    await api({
      method: "POST",
      url: SITE_PRESENCE_PING_ROUTE,
      data: { host: "example.com", anonId: "beef" },
    })
    return null
  } catch (e) {
    return e as WireError
  }
}

/**
 * entries/background/main.ts:753-767, verbatim. Copied rather than imported
 * because main.ts is a service worker that registers listeners on import; if
 * that mapping ever changes, this copy must change with it, and the source
 * assertion at the bottom of this file is what will say so.
 */
const asBackgroundError = (err: WireError | null) => ({
  status: err?.response?.status ?? 500,
  code: err?.response?.data?.error,
  message: err?.response?.data?.message ?? err?.message ?? "Unknown error",
})

const NEST_404 = {
  message: "Cannot POST this route",
  error: "Not Found",
  statusCode: 404,
}

describe("the 404 that switches site chat off reaches every branch that reads it", () => {
  let dark: Stub
  let broken: Stub
  /** A port with nothing on it: the offline / DNS / TLS case, where axios
   *  builds an error with NO response at all. */
  let deadBase: string

  beforeAll(async () => {
    dark = await serverAnswering(404, NEST_404)
    broken = await serverAnswering(500, { message: "boom", statusCode: 500 })
    const throwaway = await serverAnswering(404, NEST_404)
    deadBase = throwaway.base
    await throwaway.close()
  })
  afterAll(async () => {
    await dark.close()
    await broken.close()
  })
  beforeEach(() => {
    // The six-hour "no chat here" memory is real state in the stub store,
    // and a 404 in one test must not silence the next.
    delete stored["poppin_site_chat_dark"]
    send.mockReset()
    clearSiteChatTicket()
  })

  it("axios hands the service worker's beat a readable 404, not a bare network error", async () => {
    const err = await beat(dark.base)
    expect(err, "the guard's 404 never reached the client").not.toBeNull()
    // THE EXACT EXPRESSION in beatSitePresence's catch (main.ts:1185-1187).
    expect(err?.response?.status).toBe(404)
  })

  it("the background's API_REQUEST mapping carries that 404 across the message hop", async () => {
    const mapped = asBackgroundError(await beat(dark.base))
    expect(mapped.status).toBe(404)
    // The documents read the TOP level, and there is no `.response` out here.
    expect((mapped as { response?: unknown }).response).toBeUndefined()
  })

  it("pingSitePresence turns it into `available: false` — the heartbeat's stop signal", async () => {
    const mapped = asBackgroundError(await beat(dark.base))
    send.mockRejectedValueOnce(mapped)
    await expect(pingSitePresence("example.com")).resolves.toEqual({
      count: null,
      available: false,
    })
  })

  it("the ticket mint reads the same 404 as `no_chat`", async () => {
    const mapped = asBackgroundError(await beat(dark.base))
    send.mockRejectedValueOnce(mapped)
    await expect(getSiteChatTicket({ force: true })).resolves.toEqual({
      ok: false,
      reason: "no_chat",
    })
  })

  it("a host that answered 404 is not asked again within the window", async () => {
    // 257 pings in fifteen minutes, every one a 404, was the shape of this
    // before the answer was remembered across tabs and worker restarts.
    send.mockRejectedValueOnce({ status: 404, message: "Cannot POST this route" })
    await expect(pingSitePresence("dark.example")).resolves.toEqual({ count: null, available: false })
    const asked = send.mock.calls.length
    await expect(pingSitePresence("dark.example")).resolves.toEqual({ count: null, available: false })
    expect(send.mock.calls.length).toBe(asked)
  })

  it("a 500 is a bad moment, not a missing feature — the beat keeps its door", async () => {
    const err = await beat(broken.base)
    expect(err?.response?.status).toBe(500)
    const mapped = asBackgroundError(err)
    send.mockRejectedValueOnce(mapped)
    // available stays true: UNKNOWN renders as nothing, and the pill keeps its door.
    await expect(pingSitePresence("example.com")).resolves.toEqual({
      count: null,
      available: true,
    })
    send.mockRejectedValueOnce(mapped)
    await expect(getSiteChatTicket({ force: true })).resolves.toEqual({
      ok: false,
      reason: "error",
    })
  })

  it("offline is never mistaken for a 404 — a dropped connection must not go dark", async () => {
    const err = await beat(deadBase)
    expect(err).not.toBeNull()
    // No response object at all: this is the case that would silently poison
    // siteChatDarkHosts for a host whose chat is perfectly alive.
    expect(err?.response).toBeUndefined()
    const mapped = asBackgroundError(err)
    expect(mapped.status).toBe(500)
    send.mockRejectedValueOnce(mapped)
    await expect(pingSitePresence("example.com")).resolves.toEqual({
      count: null,
      available: true,
    })
  })
})

describe("each consumer reads the shape its own transport actually produces", () => {
  const BACKGROUND = join(__dirname, "..", "entries", "background", "main.ts")

  it("the alarm backstop reads the AXIOS shape, because it calls backendApi directly", () => {
    const bg = readFileSync(BACKGROUND, "utf8")
    const beatFn = /async function beatSitePresence\(\)[\s\S]*?\n}/.exec(bg)
    expect(beatFn, BACKGROUND + ": beatSitePresence is gone").not.toBeNull()
    const body = beatFn![0]
    // A runtime message sent from the worker is never delivered back to the
    // worker, so this call CANNOT go through sendApiRequest — and that is
    // exactly why its error is an AxiosError and not { status, message }.
    expect(body).toMatch(/backendApi\(/)
    expect(body).not.toMatch(/sendApiRequest\(/)
    expect(
      body,
      BACKGROUND +
        ": beatSitePresence reads a top-level .status, but it calls " +
        "backendApi directly — an AxiosError carries the code at " +
        ".response.status, so the dark-host memory would never learn a " +
        "thing and the alarm would POST a dead route once a minute forever",
    ).toMatch(/response\s*\)?\s*\n?\s*\??\.?\s*\??status/)
  })
})
