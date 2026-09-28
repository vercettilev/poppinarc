import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * THE FOURTH QUESTION THE BRIDGE ANSWERS, END TO END.
 *
 * The panel cannot reach a wallet: Phantom injects into web pages and never
 * into another extension's pages. Everything a wallet account does therefore
 * travels one road — panel → background → the active tab's content script →
 * the MAIN-world bridge — and connecting a wallet somebody already has now
 * travels it too, as a fourth op beside probe, connect and sign.
 *
 * WHY THIS ONE IS DIFFERENT FROM THE OTHER THREE: it spends nothing. The
 * wallet is handed TEXT, shows that text to the person, and hands back an
 * ed25519 signature over exactly those bytes. The sentence is the consent,
 * and the server composed it (auth/wallet-signin.util.ts) precisely so the
 * two sides cannot drift into signatures that verify against nothing.
 *
 * BOTH HALVES ARE LOADED INTO THIS ONE WINDOW, so the request really crosses
 * the protocol: helpers/pageWalletBridge.ts posts and entries/contentScript/
 * pageWallet.ts answers. Only the wallet is a stub. (This cannot live in the
 * door's own spec, which mocks the bridge — a file-level vi.mock reaches
 * every describe in its file.)
 */
describe("signing a sentence through the page", () => {
  let signMessage: ReturnType<typeof vi.fn>
  const realPostMessage = window.postMessage.bind(window)

  beforeEach(async () => {
    vi.resetModules()
    /**
     * HARNESS PLUMBING, NOT A STAND-IN FOR THE CODE. Both halves refuse any
     * message whose `event.source` is not this window — that check is the
     * reason a page's own postMessage traffic cannot be mistaken for ours,
     * and it is deliberately NOT relaxed. jsdom simply does not implement
     * `source`: it delivers every same-window message with `source: null`,
     * so without this the two halves would be talking past each other and
     * every assertion below would fail on a timeout rather than on its own
     * subject. Dispatch is synchronous here where the browser's is queued,
     * which the protocol is indifferent to: the listener is registered
     * before the post, and the reply leaves on a later microtask.
     */
    window.postMessage = ((data: unknown) => {
      window.dispatchEvent(
        new MessageEvent("message", { data, source: window as unknown as Window }),
      )
    }) as typeof window.postMessage
    signMessage = vi.fn(async (bytes: Uint8Array) => ({
      // A wallet answers with 64 raw bytes; the first one carries the length
      // of what it was asked to sign so the assertions can see the text got
      // there unchanged.
      signature: Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? bytes.length : i)),
    }))
    ;(window as unknown as Record<string, unknown>).phantom = {
      solana: {
        isPhantom: true,
        connect: vi.fn(async () => ({ publicKey: { toString: () => "WALLET1111" } })),
        signAndSendTransaction: vi.fn(),
        signMessage,
      },
    }
    await import("~/entries/contentScript/pageWallet")
  })

  afterEach(() => {
    window.postMessage = realPostMessage
    delete (window as unknown as Record<string, unknown>).phantom
    delete (window as unknown as Record<string, unknown>).__poppinPageWallet
  })

  it("carries the exact bytes to the wallet and the signature back as base64", async () => {
    const { signMessageWithPageWallet } = await import("~/helpers/pageWalletBridge")
    const sentence = "Poppin: sign in with this wallet.\n\nWallet: ABC\nTime: 2026-09-22T12:00:00.000Z"

    const sig = await signMessageWithPageWallet(sentence)

    // utf8, so the wallet shows the person the text they are approving; the
    // server verifies ed25519 over exactly these bytes, so nothing may
    // normalise or re-wrap them on the way.
    expect(signMessage).toHaveBeenCalledTimes(1)
    const [bytes, display] = signMessage.mock.calls[0]
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(sentence)
    expect(display).toBe("utf8")
    expect(typeof sig).toBe("string")
    const raw = Uint8Array.from(atob(sig as string), (c) => c.charCodeAt(0))
    expect(raw).toHaveLength(64)
    expect(raw[0]).toBe(new TextEncoder().encode(sentence).length)
  })

  it("spends nothing: no transaction is ever built for this op", async () => {
    const { signMessageWithPageWallet } = await import("~/helpers/pageWalletBridge")
    const posted: unknown[] = []
    // The wire type carries the protocol version (helpers/pageWalletProtocol),
    // so this watches for the same string the caller half actually posts.
    const { PAGE_WALLET_REQ } = await import("~/helpers/pageWalletProtocol")
    window.addEventListener("message", (e) => {
      const d = e.data as { type?: string }
      if (d?.type === PAGE_WALLET_REQ) posted.push(e.data)
    })
    await signMessageWithPageWallet("hello")
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ op: "signMessage", message: "hello", tx: undefined })
    const provider = (window as any).phantom.solana
    expect(provider.signAndSendTransaction).not.toHaveBeenCalled()
  })

  it("a wallet with no signMessage is said as no wallet, not as a failure", async () => {
    // The provider gate asks for connect + signAndSendTransaction, which is
    // what TRADING needs; a wallet without signMessage passes it and would
    // otherwise throw an opaque "failed" from inside the wallet.
    delete (window as any).phantom.solana.signMessage
    const { signMessageWithPageWallet } = await import("~/helpers/pageWalletBridge")
    expect(await signMessageWithPageWallet("hello")).toBeNull()
  })
})
