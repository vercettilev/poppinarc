/**
 * The isolated-world half of the page-wallet bridge (see
 * entries/contentScript/pageWallet.ts for the MAIN-world half and for why
 * this exists at all).
 *
 * Promise-shaped over a postMessage protocol, with a timeout on every call:
 * the other side is a script we injected into somebody else's page, and a
 * page that never answers must not leave a button spinning forever.
 *
 * THE WIRE TYPE IS VERSIONED (helpers/pageWalletProtocol.ts). This half ships
 * inside the extension and is always current; the half in the page may be a
 * release behind, because an update cannot replace a script the page already
 * holds. Speaking a versioned type means an older bridge simply does not hear
 * us — no half-answers from a listener that knows three of the four ops, and
 * no second wallet popup while both are alive on one window. When nobody
 * answers the probe, hasPageWallet below asks the background to put the
 * current bridge there, which is what takes the page over.
 */

import { PAGE_WALLET_REQ, PAGE_WALLET_RES } from "~/helpers/pageWalletProtocol"

type Res = Record<string, unknown>

let seq = 0

function ask(
  op: "probe" | "connect" | "sign" | "signMessage",
  tx?: string,
  timeoutMs = op === "probe" ? 800 : 60_000,
  message?: string,
) {
  return new Promise<Res>((resolve) => {
    const id = `pw-${Date.now()}-${++seq}`
    let done = false
    const finish = (body: Res) => {
      if (done) return
      done = true
      window.removeEventListener("message", onMsg)
      clearTimeout(timer)
      resolve(body)
    }
    const onMsg = (event: MessageEvent) => {
      if (event.source !== window) return
      const d = event.data as { type?: string; id?: string } | null
      if (d?.type !== PAGE_WALLET_RES || d.id !== id) return
      finish(d as Res)
    }
    // Connect and sign both wait on a HUMAN in a wallet popup, so the
    // timeout is generous; probe answers in a tick or not at all.
    const timer = setTimeout(
      () => finish({ error: "timeout" }),
      op === "probe" ? Math.min(timeoutMs, 1500) : timeoutMs,
    )
    window.addEventListener("message", onMsg)
    window.postMessage({ type: PAGE_WALLET_REQ, id, op, tx, message }, "*")
  })
}

/** Is there an injected Solana wallet on this page? */
export async function hasPageWallet(): Promise<boolean> {
  if ((await ask("probe")).present === true) return true
  /* No answer is not "no wallet": the bridge may simply not be in this
     tab (a reload, a tab older than the bridge). Ask the background to put
     it there, then ask the page again. */
  await new Promise<void>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "ENSURE_PAGE_WALLET" }, () => {
        void chrome.runtime.lastError
        resolve()
      })
    } catch {
      resolve()
    }
  })
  return (await ask("probe", undefined, 1500)).present === true
}

/** Connect, returning the address or null if they closed the popup. */
export async function connectPageWallet(): Promise<string | null> {
  const r = await ask("connect")
  return typeof r.address === "string" ? r.address : null
}

/**
 * Sign a SENTENCE — no transaction, nothing spent. The text is the server's
 * own (GET auth/wallet/message), the wallet shows it to the person before
 * they approve, and the base64 signature that comes back is what proves the
 * wallet is theirs. Null when they closed the window or the wallet has no
 * signMessage at all.
 */
export async function signMessageWithPageWallet(message: string): Promise<string | null> {
  const r = await ask("signMessage", undefined, 60_000, message)
  return typeof r.signature === "string" ? r.signature : null
}

/** Sign and send a backend-built transaction; null means it did not happen. */
export async function signWithPageWallet(txBase64: string): Promise<string | null> {
  const r = await ask("sign", txBase64)
  return typeof r.signature === "string" ? r.signature : null
}

/** The same, saying why when it did not: "cancelled" (the reader closed the window) or "failed". */
export async function signWithPageWalletDetailed(
  txBase64: string,
): Promise<
  /* signedTx is present only when the wallet offered signTransaction, so
     the server can tell an updated extension (bytes it can broadcast and
     resend) from an older one (a signature the wallet already sent). */
  | { signature: string; signedTx?: string }
  | { error: "cancelled" | "failed" | "timeout" | "no-wallet"; detail?: string }
> {
  const r = await ask("sign", txBase64)
  if (typeof r.signature === "string") {
    return {
      signature: r.signature,
      ...(typeof r.signedTx === "string" && r.signedTx ? { signedTx: r.signedTx } : {}),
    }
  }
  const e = String(r.error ?? "failed")
  // `detail` is the wallet's or the parser's own words, for the log line
  // and the telemetry row. The reader's sentence is written by the caller.
  const detail = typeof r.detail === "string" ? r.detail.slice(0, 200) : undefined
  return {
    error: e === "cancelled" || e === "timeout" || e === "no-wallet" ? e : "failed",
    ...(detail ? { detail } : {}),
  }
}
