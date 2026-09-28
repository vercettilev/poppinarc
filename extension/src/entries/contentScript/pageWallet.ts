/**
 * THE PAGE'S WALLET, REACHED FROM OUR ISOLATED WORLD.
 *
 * Phantom injects `window.solana` into the page's MAIN world. Content scripts
 * live in an isolated world and cannot see it — which is why the panel can
 * never touch a wallet, and why this shim exists for the surfaces that can:
 * the chip and the card, on a real page.
 *
 * WHAT IT IS FOR, and what it is deliberately not. It exists so somebody
 * whose Poppin balance ran out mid-buy can move USDC in from the wallet they
 * already have, with ONE approval, without leaving the tweet. It is NOT a
 * second trading path: the transaction it signs is built by our backend and
 * is a plain USDC transfer into the reader's own custodial account, which is
 * the one thing a wallet popup can show clearly. Trading itself stays where
 * every surface agrees on it.
 *
 * ── THE PROTOCOL IS NARROW ON PURPOSE ───────────────────────────────────────
 * Anything in the MAIN world is reachable by the page, so this answers four
 * questions and nothing else: is there a wallet, connect it, sign this exact
 * base64 transaction, sign this exact sentence. It holds no state the page
 * could read, exposes no global, and every reply carries the id of the
 * request it answers so a page's own postMessage traffic cannot be mistaken
 * for ours.
 *
 * THE FOURTH ONE SPENDS NOTHING. `signMessage` produces an ed25519 signature
 * over text the wallet SHOWS the person before they approve it — that is the
 * whole of the consent, and the sentence the server composes says in words
 * that it proves ownership and grants no authority to move funds
 * (auth/wallet-signin.util.ts). It is what lets somebody who already holds
 * USDC attach that wallet to the account they are signed in to, instead of
 * funding a second one.
 */

import {
  claimedPageWalletVersion,
  PAGE_WALLET_REQ,
  PAGE_WALLET_RES,
  PAGE_WALLET_VERSION,
} from "~/helpers/pageWalletProtocol"
import { isVersionedTx, txBytesFromBase64 } from "~/helpers/txBytes"
import { base58Encode } from "~/helpers/base58"

interface WalletReq {
  type: string
  id: string
  op: "probe" | "connect" | "sign" | "signMessage"
  tx?: string
  message?: string
}

type Provider = {
  connect?: () => Promise<{ publicKey: { toString(): string } }>
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string }>
  /**
   * PREFERRED. Signing without sending is what lets US do the sending,
   * and doing the sending is what lets us put the same bytes back on the
   * wire while we wait. Phantom's signAndSendTransaction submits once,
   * and one submission is not a delivery: measured 2026-09-25, the first
   * reader to walk the whole product signed a buy that never reached the
   * chain at all. Kept optional, and the old path stays as the fallback
   * for a provider that does not offer this.
   */
  signTransaction?: (tx: unknown) => Promise<unknown>
  signMessage?: (
    message: Uint8Array,
    display?: string,
  ) => Promise<{ signature: Uint8Array } | Uint8Array>
  isPhantom?: boolean
}

function provider(): Provider | null {
  const w = window as unknown as Record<string, any>
  const p = w.phantom?.solana ?? w.solana ?? w.solflare
  return p?.connect && (p?.signTransaction || p?.signAndSendTransaction)
    ? (p as Provider)
    : null
}

function reply(id: string, body: Record<string, unknown>) {
  window.postMessage({ type: PAGE_WALLET_RES, id, ...body }, "*")
}

/**
 * ONE BRIDGE PER PAGE, PER PROTOCOL VERSION, and a mark the background can
 * read. The mark is how injectContentScripts knows to add this file to a tab
 * whose content script already runs (a reload, a tab older than the bridge):
 * without it the chip found Phantom on the page and nobody to ask.
 *
 * IT CARRIES THE VERSION because this file is a PAGE script and an extension
 * update cannot replace it — the old bridge keeps running until the page
 * navigates. The marker used to be `true`, so a page claimed by the bridge
 * that predates `signMessage` refused every newer one, and the op it had
 * never heard of got no reply at all (helpers/pageWalletProtocol.ts has the
 * measurement). A lower claim is taken over; our own is left alone, so a
 * second injection is still the no-op it always was.
 *
 * THE OLD LISTENER IS STILL THERE — we cannot remove a listener we have no
 * reference to, on a page that is not reloading. It is deaf instead: the wire
 * type carries the version, and its first line drops anything that is not the
 * exact type it was built for. That is what keeps one `sign` from opening two
 * Phantom popups while both bridges are alive on one window.
 */
const marked = window as unknown as { __poppinPageWallet?: boolean | number }
if (claimedPageWalletVersion(marked.__poppinPageWallet) < PAGE_WALLET_VERSION) {
marked.__poppinPageWallet = PAGE_WALLET_VERSION
window.addEventListener("message", (event) => {
  // Same-window only. A message from a frame we did not create is not ours.
  if (event.source !== window) return
  const msg = event.data as WalletReq | null
  if (msg?.type !== PAGE_WALLET_REQ || typeof msg.id !== "string") return

  const p = provider()
  if (msg.op === "probe") {
    reply(msg.id, { present: !!p })
    return
  }
  if (!p) {
    reply(msg.id, { error: "no-wallet" })
    return
  }

  if (msg.op === "connect") {
    p.connect!()
      .then((r) => reply(msg.id, { address: r.publicKey.toString() }))
      // A closed popup is a decision, and it reaches the caller as the same
      // "cancelled" every other refusal does.
      .catch(() => reply(msg.id, { error: "cancelled" }))
    return
  }

  if (msg.op === "signMessage" && typeof msg.message === "string") {
    void (async () => {
      try {
        /* The provider gate above asks for connect + signAndSendTransaction,
           which is what TRADING needs; a wallet without signMessage would
           pass it and then throw here. Named as its own refusal so the panel
           can say which capability was missing rather than "failed". */
        if (typeof p.signMessage !== "function") {
          reply(msg.id, { error: "no-wallet" })
          return
        }
        /* utf8, so the wallet renders the sentence as text a person can
           read. The server built that sentence and verifies ed25519 over
           exactly these bytes, so nothing here may normalise or re-wrap it. */
        const bytes = new TextEncoder().encode(msg.message!)
        const r = await p.signMessage(bytes, "utf8")
        // Phantom answers { signature, publicKey }; some wallets hand back
        // the bare bytes. Both are the same 64 bytes.
        const raw = r instanceof Uint8Array ? r : (r as { signature: Uint8Array }).signature
        let binary = ""
        for (const b of raw) binary += String.fromCharCode(b)
        reply(msg.id, { signature: btoa(binary) })
      } catch (e) {
        const code = (e as { code?: number } | null)?.code
        const detail = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
        reply(msg.id, { error: code === 4001 ? "cancelled" : "failed", detail })
      }
    })()
    return
  }

  if (msg.op === "sign" && typeof msg.tx === "string") {
    // Decoded HERE rather than passed as bytes: a structured clone of a
    // Transaction across the world boundary loses its prototype, and the
    // wallet is handed an object it cannot read.
    void (async () => {
      try {
        const bytes = txBytesFromBase64(msg.tx!)
        // web3.js is already in this bundle's graph on the page side; the
        // wallet needs a real transaction object, so build one from the
        // wire bytes. Jupiter's swaps are versioned; the deposit transfer
        // is legacy; the first byte says which (helpers/txBytes.ts).
        const { Transaction, VersionedTransaction } = await import("@solana/web3.js")
        /* BOTH SHAPES, WHICHEVER THE BYTES ARE. isVersionedTx reads the
           message's version byte (helpers/txBytes.ts) and a wrong answer
           there used to be fatal: the wallet never opened and nobody could
           see why. The fallback costs one failed parse and removes a whole
           class of dead end. */
        const parse = (versioned: boolean) =>
          versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes)
        const guess = isVersionedTx(bytes)
        let tx: unknown
        try {
          tx = parse(guess)
        } catch {
          tx = parse(!guess)
        }
        if (p.signTransaction) {
          /* SIGNED HERE, SENT BY US. The bytes travel with the signature
             so the server can verify they are the transaction it
             prepared, broadcast them itself, and keep resending while it
             waits for the chain. */
          const signed = (await p.signTransaction(tx)) as {
            serialize?: (opts?: unknown) => Uint8Array
            signatures?: Array<Uint8Array | { signature?: Uint8Array | null }>
            signature?: Uint8Array | null
          }
          const bytes = signed.serialize!()
          /* Versioned transactions keep a flat array of signature bytes;
             a legacy one keeps `signature` on the object and a list of
             {publicKey, signature} pairs. The fee payer signs first in
             both, which is the one we are reporting. */
          const first = signed.signatures?.[0]
          const raw =
            signed.signature ??
            (first instanceof Uint8Array ? first : (first?.signature ?? null))
          if (!raw) throw new Error("the wallet returned no signature")
          reply(msg.id, {
            signature: base58Encode(raw),
            signedTx: btoa(String.fromCharCode(...bytes)),
          })
          return
        }
        const { signature } = await p.signAndSendTransaction!(tx)
        reply(msg.id, { signature })
      } catch (e) {
        const code = (e as { code?: number } | null)?.code
        /* WHY IT FAILED TRAVELS BACK. Every refusal used to arrive as the
           bare word "failed", so a parse bug and a wallet refusal were the
           same event to every surface above. The detail is for us (logs
           and telemetry); the sentence a reader sees is still written by
           the caller. */
        const detail = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
        reply(msg.id, { error: code === 4001 ? "cancelled" : "failed", detail })
      }
    })()
  }
})
}
