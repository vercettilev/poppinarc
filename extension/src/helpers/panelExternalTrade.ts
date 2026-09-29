import { ARC_EDITION } from "~/config/edition"

/**
 * A WALLET ACCOUNT'S TRADE, ASKED FROM THE SIDE PANEL. The panel is an
 * extension page and Phantom is not in it; the page in the active tab is
 * where the wallet lives. So the panel asks the background to hand the
 * trade to that page's content script, which signs it there
 * (helpers/externalTrade.ts) and answers with the same receipt the
 * custodial calls return. A tab that is not a web page, or one whose
 * content script is not up, is said in a sentence the sheet prints.
 */
export interface PanelTradeArgs {
  side: "buy" | "sell"
  mint: string
  amountUsd?: number
  amountRaw?: string
  sourceUrl?: string
}

export interface PanelTradeResult {
  signature: string
  dryRun: boolean
  category: string
  outAmountRaw: string
  outUsdcRaw?: string
  shareUrl: string | null
}

export function tradeViaPage(args: PanelTradeArgs): Promise<PanelTradeResult> {
  // The Arc edition needs no page: its confirm window is opened by the background.
  if (ARC_EDITION) return import("~/arc/ownWalletTrade").then((m) => m.tradeWithOwnWallet(args))
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: "EXTERNAL_TRADE", args }, (res) => {
        void chrome.runtime.lastError
        const r = res as { ok?: boolean; result?: PanelTradeResult; error?: string } | undefined
        if (r?.ok && r.result) {
          resolve({ ...r.result, outUsdcRaw: r.result.outUsdcRaw ?? r.result.outAmountRaw })
          return
        }
        reject(new Error(r?.error ?? "The page beside the panel did not answer."))
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Could not reach the page."))
    }
  })
}

export interface PanelOrderResult {
  orderKey: string
  signature: string
  dryRun: boolean
}

function askPage<T>(args: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: "EXTERNAL_TRADE", args }, (res) => {
        void chrome.runtime.lastError
        const r = res as { ok?: boolean; result?: T; error?: string } | undefined
        if (r?.ok && r.result) {
          resolve(r.result)
          return
        }
        reject(new Error(r?.error ?? "The page beside the panel did not answer."))
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Could not reach the page."))
    }
  })
}

/** A wallet account's standing order, signed on the page beside the panel. */
export function orderViaPage(args: {
  mint: string
  side: "buy" | "sell"
  amountUsd?: number
  amountRaw?: string
  triggerPriceUsd: number
}): Promise<PanelOrderResult> {
  return askPage<PanelOrderResult>({ kind: "order", ...args })
}

/** Its cancel, the same way. */
export function cancelOrderViaPage(orderKey: string): Promise<PanelOrderResult> {
  return askPage<PanelOrderResult>({ kind: "cancel", orderKey })
}

/**
 * THE ADDRESS SCREEN'S TWO QUESTIONS FOR THE PAGE, through the same relay.
 * Neither needs an account kind: is Phantom on the page beside the panel,
 * and move this many dollars of USDC in from it (the chip's one-tap rail,
 * signed on the page).
 */
export function probePageWallet(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "EXTERNAL_TRADE", args: { kind: "probe" } }, (res) => {
        void chrome.runtime.lastError
        const r = res as { ok?: boolean; result?: { present?: boolean } } | undefined
        resolve(Boolean(r?.ok && r.result?.present))
      })
    } catch {
      resolve(false)
    }
  })
}

/**
 * CONNECT A WALLET THE READER ALREADY HAS, asked from the panel.
 *
 * The same relay the panel's trades use, for the same reason: Phantom is in
 * the page, never in this extension's own pages, so the connect happens on
 * the tab beside the panel and the answer comes back here.
 *
 * WHEN THERE IS NO PAGE TO ASK, the background answers "Open X, Reddit or
 * any web page beside the panel, then try again." — a sentence the caller
 * prints as it arrives. That is the fallback, and it is the honest one: no
 * tab we could open would help, because a wallet extension only injects
 * into a page the READER has, so the only move is theirs. The three refusals
 * the server writes arrive by the same channel and are printed the same way.
 */
export function connectWalletViaPage(): Promise<{
  address: string
  wallet_mode: string
  external_address: string | null
}> {
  return askPage({ kind: "connect" })
}

export function topUpViaPage(usd: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: "EXTERNAL_TRADE", args: { kind: "topup", usd } }, (res) => {
        void chrome.runtime.lastError
        const r = res as { ok?: boolean; result?: { funded?: boolean }; error?: string } | undefined
        if (r?.ok) {
          resolve(Boolean(r.result?.funded))
          return
        }
        reject(new Error(r?.error ?? "The page beside the panel did not answer."))
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Could not reach the page."))
    }
  })
}

/**
 * The wallet account's top-up, done on the page: $usd of SOL to USDC, one
 * Phantom signature.
 *
 * NOTHING CALLS THIS (2026-09-22). Its one caller was the address screen's
 * "Convert $25 of SOL to USDC" card, removed with the rest of the wallet
 * path's conversion: a wallet account's answer is "Add USDC to your wallet"
 * and the address, and the conversion is not offered as a remedy there
 * either. Kept rather than tidied away — see the note above convertFromPage
 * in components/SpotCard/pagePosts.ts, which this reaches through the
 * background relay.
 */
export function convertViaPage(usd: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: "EXTERNAL_TRADE", args: { kind: "convert", usd } }, (res) => {
        void chrome.runtime.lastError
        const r = res as { ok?: boolean; result?: { funded?: boolean }; error?: string } | undefined
        if (r?.ok) {
          resolve(Boolean(r.result?.funded))
          return
        }
        reject(new Error(r?.error ?? "The page beside the panel did not answer."))
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Could not reach the page."))
    }
  })
}

