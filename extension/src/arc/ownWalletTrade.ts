import { ExternalTradeError } from "~/helpers/externalTrade"
import type { PanelTradeArgs, PanelTradeResult } from "~/helpers/panelExternalTrade"
import { sendApiRequest } from "~/lib/fetchService"

/**
 * THE ARC EDITION'S TRADE FOR AN ACCOUNT THAT HOLDS ITS OWN WALLET.
 *
 * An account that signed in with a wallet trades from that wallet on Arc
 * mainnet (arc-api trade/own-wallet.ts). Nothing here signs: arc-api builds
 * the trade for the wallet's own address, the background opens arc-api's
 * confirm page in a small window (wallets only speak to web pages, and the
 * panel is not one), the wallet approves it there, and arc-api reads the
 * result from the chain. This side only asks, opens and waits.
 *
 * The same call serves the chip and the side panel, because the window is
 * opened by the background either way. Closing the window before the wallet
 * sent anything cancels the trade (background), and the wait ends with the
 * sentence for it.
 */

export interface PreparedOwnTrade {
  preparedId: string
  confirmUrl: string
  summary: { title: string; detail: string }
}

export interface OwnTradeStatus {
  state: "waiting" | "sending" | "done" | "failed" | "cancelled" | "expired"
  signature?: string
  outAmountRaw?: string
  error?: string
}

/** Message the background opens the confirm window on (entries/background/main.ts). */
export const ARC_OPEN_CONFIRM = "ARC_OPEN_CONFIRM"

/** How long the wait for the wallet lasts before it says so. A person is reading their wallet's window. */
const WAIT_MS = 4 * 60 * 1000
const POLL_MS = 1500

export const prepareOwnTrade = (body: PanelTradeArgs) =>
  sendApiRequest<PreparedOwnTrade>({
    url: "/embed/asset/external/prepare",
    method: "POST",
    data: body,
    apiType: "backend",
  })

export const ownTradeStatus = (id: string) =>
  sendApiRequest<OwnTradeStatus>({
    url: "/embed/asset/external/status",
    method: "GET",
    params: { id },
    apiType: "backend",
  })

export function openConfirmWindow(url: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: ARC_OPEN_CONFIRM, url, id }, (res) => {
        void chrome.runtime.lastError
        const r = res as { ok?: boolean; error?: string } | undefined
        if (r?.ok) resolve()
        else reject(new ExternalTradeError(r?.error ?? "Your wallet's window did not open. Try again.", "failed"))
      })
    } catch {
      reject(new ExternalTradeError("Your wallet's window did not open. Try again.", "failed"))
    }
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Prepare, open, wait. Resolves with the same receipt a custodial buy or sell
 * answers, so every surface that shows one needs nothing new.
 */
export async function tradeWithOwnWallet(
  args: PanelTradeArgs,
  deps: {
    prepare?: typeof prepareOwnTrade
    status?: typeof ownTradeStatus
    open?: typeof openConfirmWindow
    wait?: (ms: number) => Promise<void>
    now?: () => number
  } = {},
): Promise<PanelTradeResult> {
  const prepare = deps.prepare ?? prepareOwnTrade
  const status = deps.status ?? ownTradeStatus
  const open = deps.open ?? openConfirmWindow
  const wait = deps.wait ?? sleep
  const now = deps.now ?? Date.now

  const prepared = await prepare({
    side: args.side,
    mint: args.mint,
    ...(args.side === "buy" ? { amountUsd: args.amountUsd } : { amountRaw: args.amountRaw }),
    ...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {}),
  })
  await open(prepared.confirmUrl, prepared.preparedId)

  const until = now() + WAIT_MS
  let sent: string | undefined
  while (now() < until) {
    await wait(POLL_MS)
    let s: OwnTradeStatus
    try {
      s = await status(prepared.preparedId)
    } catch {
      continue // one failed poll is not an answer
    }
    if (s.state === "done") {
      const out = s.outAmountRaw ?? "0"
      return {
        signature: s.signature ?? "",
        dryRun: false,
        category: "spot",
        outAmountRaw: out,
        outUsdcRaw: out,
        shareUrl: null,
      }
    }
    if (s.state === "failed") throw new ExternalTradeError(s.error ?? "That trade did not go through.", "failed")
    if (s.state === "cancelled") throw new ExternalTradeError("Closed before your wallet confirmed.", "cancelled")
    if (s.state === "expired") throw new ExternalTradeError(s.error ?? "That trade expired. Try again.", "failed")
    if (s.state === "sending") sent = s.signature ?? sent
  }
  throw new ExternalTradeError(
    sent
      ? "The trade was sent and is still settling. Check your wallet in a moment."
      : "Your wallet has not confirmed yet. Open it, or start the trade again.",
    "failed",
  )
}
