import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The Arc edition's wallet session: what the extension keeps after a wallet
 * sign-in, how it is read back, and the two places that must honour it (the
 * background that stores it, lib/axios that sends it).
 */
const ADDR = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
const token = (p: Record<string, unknown>) =>
  `arcw_${Buffer.from(JSON.stringify(p)).toString("base64url")}.c2ln`
const good = (exp: number) => token({ uid: `evm:${ADDR}`, address: ADDR, iat: 1, exp })

type M = typeof import("./walletSession")
async function load(arc: boolean, stored?: unknown): Promise<M> {
  vi.unstubAllEnvs()
  if (arc) vi.stubEnv("NEXT_PUBLIC_ARC_EDITION", "true")
  vi.resetModules()
  const store: Record<string, unknown> = stored === undefined ? {} : { poppin_arc_wallet_session: stored }
  ;(globalThis as any).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (kv: Record<string, unknown>) => Object.assign(store, kv),
        remove: async (k: string) => void delete store[k],
      },
      onChanged: { addListener: () => {} },
    },
  }
  return import("./walletSession")
}

afterEach(() => {
  vi.unstubAllEnvs()
  delete (globalThis as any).chrome
})

describe("decoding a wallet session", () => {
  it("reads the account out of an arcw_ token", async () => {
    const m = await load(true)
    expect(m.decodeWalletToken(good(9e15))).toMatchObject({ uid: `evm:${ADDR}`, address: ADDR, exp: 9e15 })
  })

  it("is null for anything else", async () => {
    const m = await load(true)
    expect(m.decodeWalletToken("eyJhbGciOiJSUzI1NiJ9.e30.sig")).toBeNull() // a Firebase ID token
    expect(m.decodeWalletToken(token({ uid: "evm:0xdead", address: ADDR, exp: 9e15 }))).toBeNull()
    expect(m.decodeWalletToken(`${good(9e15)}.extra`)).toBeNull()
    expect(m.decodeWalletToken(42)).toBeNull()
  })

  it("stops being live at its expiry", async () => {
    const m = await load(true)
    expect(m.liveSession({ token: good(2_000) }, 1_000)).not.toBeNull()
    expect(m.liveSession({ token: good(2_000) }, 2_000)).toBeNull()
  })
})

describe("reading it back", () => {
  it("gives the stored session in the Arc edition", async () => {
    const m = await load(true, { token: good(Date.now() + 60_000) })
    expect((await m.readWalletSession())?.uid).toBe(`evm:${ADDR}`)
  })

  it("never gives one in the store build, whatever is stored", async () => {
    const m = await load(false, { token: good(Date.now() + 60_000) })
    expect(await m.readWalletSession()).toBeNull()
  })

  it("forgets it on clear", async () => {
    const m = await load(true, { token: good(Date.now() + 60_000) })
    await m.clearWalletSession()
    expect(await m.readWalletSession()).toBeNull()
  })
})

describe("the two places that honour it", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

  it("the background keeps a session only after arc-api says it is good, and only from arc-api's page", () => {
    const bg = read("entries/background/main.ts")
    const at = bg.indexOf("async function handleArcWalletSignin(")
    expect(at).toBeGreaterThan(-1)
    const body = bg.slice(at, bg.indexOf("\n}\n", at))
    expect(body.indexOf("/users/me")).toBeGreaterThan(-1)
    expect(body.indexOf("/users/me")).toBeLessThan(body.indexOf("saveWalletSession("))
    expect(body).toContain("auth.signOut()")
    expect(bg).toMatch(/if \(!ARC_EDITION \|\| !ARC_API_HOST \|\| host !== ARC_API_HOST\)/)
  })

  it("lib/axios sends it only when there is no Firebase user, and forgets it on a 401", () => {
    const ax = read("lib/axios.ts")
    const firebase = ax.indexOf("config.headers.Authorization = `Bearer ${idToken}`")
    const wallet = ax.indexOf("config.headers.Authorization = `Bearer ${wallet.token}`")
    expect(firebase).toBeGreaterThan(-1)
    expect(wallet).toBeGreaterThan(firebase)
    expect(ax).toContain("} else if (ARC_EDITION) {")
    expect(ax).toContain("if (status === 401 && cfg?._walletAuth) void clearWalletSession()")
  })
})
