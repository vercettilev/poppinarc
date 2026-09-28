import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * A BRIDGE THE UPDATE COULD NOT REACH.
 *
 * entries/contentScript/pageWallet.ts is injected into the page's MAIN world,
 * which makes it a PAGE script: an extension update replaces the extension
 * and leaves the old bridge running in every tab that is already open. Only a
 * navigation clears it.
 *
 * 1.0.344 added a fourth op, `signMessage`, and with it the connect door in
 * the panel. On a tab that was open when that version installed, the bridge
 * in the page was the one before it: probe, connect, sign. Its handler falls
 * off the end for an op it does not know — no reply, no error — so the door
 * probed (answered), connected (answered), opened Phantom, the reader
 * APPROVED, and sixty seconds later helpers/pageWalletBridge.ts timed out and
 * helpers/externalTrade.ts told them "Closed in Phantom before signing."
 *
 * The one-per-page mark was `true`, so ensurePageWallet in the background read
 * "already there" and re-injection could not rescue the tab either. Both ends
 * of that are what this file holds: the mark is a VERSION, and taking a page
 * over does not leave two listeners answering for one request.
 *
 * WHAT THE OLD BRIDGE IS HERE. It is not in the tree any more — it is the
 * file before this change — so the v1 listener below is written out: the
 * shape that matters is that it answers the UNVERSIONED type and knows three
 * ops. If it ever hears one of our requests again, it is that release's
 * behaviour that comes back.
 */

const V1_TYPE = "POPPIN_WALLET_REQ"
const V1_RES = "POPPIN_WALLET_RES"

describe("a newer bridge on a page an older one already claimed", () => {
  const realPostMessage = window.postMessage.bind(window)
  /** Every request the 1.0.344 bridge would have handled, if it heard one. */
  const heardByV1: Array<{ op?: string; id?: string }> = []
  let connect: Mock<() => Promise<{ publicKey: { toString(): string } }>>
  let signMessage: Mock<() => Promise<{ signature: Uint8Array }>>
  let v1: (e: MessageEvent) => void

  /**
   * THE PAGE IS SET UP ONCE, and the bridge imported once into it, because a
   * jsdom window is shared by every test in a file and a listener cannot be
   * removed by a module that registered it. Re-importing per test would stack
   * bridges on one window and "connect was called once" would be measuring
   * the harness. Set up once, counters cleared per test, order irrelevant.
   */
  beforeAll(async () => {
    vi.resetModules()
    /**
     * HARNESS PLUMBING, NOT A STAND-IN FOR THE CODE (the same note as
     * helpers/page-wallet-sign-message.spec.ts): jsdom delivers same-window
     * messages with `source: null`, and both halves refuse anything whose
     * source is not this window — a check that is deliberately not relaxed.
     */
    window.postMessage = ((data: unknown) => {
      window.dispatchEvent(
        new MessageEvent("message", { data, source: window as unknown as Window }),
      )
    }) as typeof window.postMessage

    connect = vi.fn(async () => ({ publicKey: { toString: () => "WALLET1111" } }))
    signMessage = vi.fn(async () => ({ signature: Uint8Array.from({ length: 64 }, (_, i) => i) }))
    ;(window as unknown as Record<string, unknown>).phantom = {
      solana: { isPhantom: true, connect, signAndSendTransaction: vi.fn(), signMessage },
    }

    /* THE PAGE AS THE UPDATE LEFT IT: the previous bridge, still listening,
       still holding the mark it wrote. */
    v1 = (event: MessageEvent) => {
      const msg = event.data as { type?: string; id?: string; op?: string } | null
      if (msg?.type !== V1_TYPE || typeof msg.id !== "string") return
      heardByV1.push({ op: msg.op, id: msg.id })
      if (msg.op === "probe") {
        window.postMessage({ type: V1_RES, id: msg.id, present: true }, "*")
        return
      }
      if (msg.op === "connect") {
        void connect().then((r) =>
          window.postMessage(
            { type: V1_RES, id: msg.id, address: r.publicKey.toString() },
            "*",
          ),
        )
        return
      }
      // …and nothing at all for signMessage. That silence is the bug.
    }
    window.addEventListener("message", v1)
    ;(window as unknown as Record<string, unknown>).__poppinPageWallet = true

    // The update lands: the current bridge is injected into that page.
    await import("~/entries/contentScript/pageWallet")
  })

  beforeEach(() => {
    heardByV1.length = 0
    connect.mockClear()
    signMessage.mockClear()
  })

  afterAll(() => {
    window.removeEventListener("message", v1)
    window.postMessage = realPostMessage
    delete (window as unknown as Record<string, unknown>).phantom
    delete (window as unknown as Record<string, unknown>).__poppinPageWallet
  })

  it("takes the page over instead of standing down at the old mark", async () => {
    const { PAGE_WALLET_VERSION } = await import("~/helpers/pageWalletProtocol")
    expect((window as unknown as Record<string, unknown>).__poppinPageWallet).toBe(
      PAGE_WALLET_VERSION,
    )
    expect(PAGE_WALLET_VERSION).toBeGreaterThan(1)
  })

  it("answers signMessage on a page that is never reloaded — the whole bug", async () => {
    const { signMessageWithPageWallet } = await import("~/helpers/pageWalletBridge")

    /* The unfixed ending is a SIXTY SECOND wait and then null. Racing it
       against half a second keeps the red proof honest and fast: a timeout
       means nobody answered, which is exactly what the reader met. */
    const answered = await Promise.race([
      signMessageWithPageWallet("Poppin: sign in with this wallet."),
      new Promise((r) => setTimeout(() => r("NOBODY ANSWERED"), 500)),
    ])

    expect(answered).not.toBe("NOBODY ANSWERED")
    expect(typeof answered).toBe("string")
    expect(signMessage).toHaveBeenCalledTimes(1)
  })

  it("leaves the old listener deaf, so one connect is never two wallet popups", async () => {
    const { hasPageWallet, connectPageWallet } = await import("~/helpers/pageWalletBridge")

    expect(await hasPageWallet()).toBe(true)
    expect(await connectPageWallet()).toBe("WALLET1111")

    /* Two listeners on one window is its own bug: we cannot remove a
       listener we hold no reference to, on a page that is not reloading, so
       the version is in the WIRE TYPE and the old one never matches. If it
       did, this single connect would have opened Phantom twice and raced two
       replies for one id. */
    expect(heardByV1).toEqual([])
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it("is claimed once: a second injection of the same bridge adds no listener", async () => {
    /* ensurePageWallet injects on every 'complete' on x.com, so this file
       lands in the same page repeatedly. A second listener at the SAME
       version would double every reply and every wallet popup, exactly like
       an old listener that still heard us. */
    vi.resetModules()
    await import("~/entries/contentScript/pageWallet")
    const { connectPageWallet } = await import("~/helpers/pageWalletBridge")
    expect(await connectPageWallet()).toBe("WALLET1111")
    expect(connect).toHaveBeenCalledTimes(1)
  })
})

describe("the version the two halves agree on", () => {
  it("reads the first bridge's `true` as version 1, and junk as nobody", async () => {
    const { claimedPageWalletVersion, PAGE_WALLET_VERSION } = await import(
      "~/helpers/pageWalletProtocol"
    )
    expect(claimedPageWalletVersion(true)).toBe(1)
    expect(claimedPageWalletVersion(undefined)).toBe(0)
    expect(claimedPageWalletVersion("yes")).toBe(0)
    expect(claimedPageWalletVersion(PAGE_WALLET_VERSION)).toBe(PAGE_WALLET_VERSION)
    // A page that already holds a NEWER bridge keeps it: the claim is a
    // comparison, never an overwrite.
    expect(claimedPageWalletVersion(99)).toBeGreaterThan(PAGE_WALLET_VERSION)
  })

  it("is in the wire type itself, so a bump cannot leave one side behind", async () => {
    const { PAGE_WALLET_REQ, PAGE_WALLET_RES, PAGE_WALLET_VERSION } = await import(
      "~/helpers/pageWalletProtocol"
    )
    expect(PAGE_WALLET_REQ).toBe(`POPPIN_WALLET_REQ_V${PAGE_WALLET_VERSION}`)
    expect(PAGE_WALLET_RES).toBe(`POPPIN_WALLET_RES_V${PAGE_WALLET_VERSION}`)
    // The unversioned names are what the old bridge listens for. Posting one
    // of those is how a released bridge starts answering for us again.
    expect(PAGE_WALLET_REQ).not.toBe(V1_TYPE)
    expect(PAGE_WALLET_RES).not.toBe(V1_RES)
  })

  it("is the same constant in all three places, never a number typed twice", () => {
    const bridge = stripComments(read("entries/contentScript/pageWallet.ts"))
    const caller = stripComments(read("helpers/pageWalletBridge.ts"))
    const bg = stripComments(read("entries/background/main.ts"))

    expect(bridge).toMatch(/from "~\/helpers\/pageWalletProtocol"/)
    expect(bridge).toMatch(/__poppinPageWallet = PAGE_WALLET_VERSION/)
    expect(bridge).toMatch(
      /claimedPageWalletVersion\(marked\.__poppinPageWallet\) < PAGE_WALLET_VERSION/,
    )
    // Neither half may hard-code a wire type: that is how one of them keeps
    // speaking a version the other has moved off.
    expect(caller).not.toMatch(/"POPPIN_WALLET_(REQ|RES)"/)
    expect(bridge).not.toMatch(/"POPPIN_WALLET_(REQ|RES)"/)

    /* The background's gate is SERIALIZED into the page, so it cannot import
       the helper — it takes the number as an argument instead, which is the
       only shape that stays in step with a bump. */
    expect(bg).toMatch(/import \{ PAGE_WALLET_VERSION \} from "~\/helpers\/pageWalletProtocol"/)
    expect(bg).toMatch(/args: \[PAGE_WALLET_VERSION\]/)
    expect(bg).toMatch(/return have >= want/)
    // The old gate, which answered "already there" to a bridge from before
    // signMessage and made re-injection useless on exactly the tabs that
    // needed it.
    expect(bg).not.toMatch(/__poppinPageWallet === true/)
  })
})
