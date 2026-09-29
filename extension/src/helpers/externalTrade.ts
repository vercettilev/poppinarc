import { ARC_EDITION } from "~/config/edition"
import {
  prepareExternalCancel,
  prepareExternalOrder,
  prepareExternalTrade,
  submitExternalOrder,
  submitExternalTrade,
} from "~/services/SpotAssetService"

/**
 * A TRADE SIGNED BY THE READER'S OWN WALLET, on the page the chip is on.
 *
 * The side panel can never sign (Phantom injects into web pages, not into
 * another extension's pages), but the page beside the chip can: the
 * MAIN-world bridge (entries/contentScript/pageWallet.ts) connects and
 * signs there. The server builds the transaction for the account's
 * wallet, the wallet signs and sends it in its own approval window, and
 * the signature goes back to be recorded and settled like any trade.
 *
 * Every refusal is said in the wallet's own words: not on this page,
 * connected to a different wallet than the account, closed before
 * signing. The chip prints the message as it prints any trade error.
 */
export class ExternalTradeError extends Error {
  constructor(
    message: string,
    readonly reason: "no-wallet" | "not-connected" | "wrong-wallet" | "cancelled" | "failed",
    /**
     * The wallet's or the parser's own words, when there were any. Never
     * shown to a reader — it rides the telemetry row so the next failure
     * of this kind is a fact rather than an investigation. The one it was
     * bought with cost a day: every wallet trade failed with the bare word
     * "failed" because a versioned swap was parsed as legacy.
     */
    readonly detail?: string,
  ) {
    super(message)
    this.name = "ExternalTradeError"
  }
}

export interface ExternalTradeArgs {
  side: "buy" | "sell"
  mint: string
  amountUsd?: number
  amountRaw?: string
  sourceUrl?: string
  /** The account's wallet; a Phantom on another address must not trade for it. */
  expectedAddress?: string | null
}

export async function tradeWithPageWallet(args: ExternalTradeArgs) {
  // The Arc edition's own-wallet trade is approved in arc-api's confirm
  // window, which reaches every EVM wallet; the Phantom bridge below is Solana's.
  if (ARC_EDITION) {
    const { tradeWithOwnWallet } = await import("~/arc/ownWalletTrade")
    return tradeWithOwnWallet(args)
  }
  const { hasPageWallet, connectPageWallet, signWithPageWalletDetailed } = await import(
    "~/helpers/pageWalletBridge"
  )
  if (!(await hasPageWallet())) {
    throw new ExternalTradeError("Phantom is not on this page. Unlock it and try again.", "no-wallet")
  }
  const address = await connectPageWallet()
  if (!address) {
    throw new ExternalTradeError("Phantom did not connect.", "not-connected")
  }
  if (args.expectedAddress && address !== args.expectedAddress) {
    throw new ExternalTradeError(
      `Phantom is on a different wallet (${address.slice(0, 4)}…${address.slice(-4)}) than your Poppin account.`,
      "wrong-wallet",
    )
  }
  const prepared = await prepareExternalTrade({
    side: args.side,
    mint: args.mint,
    ...(args.side === "buy" ? { amountUsd: args.amountUsd } : { amountRaw: args.amountRaw }),
    ...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {}),
  })
  const signed = await signWithPageWalletDetailed(prepared.transaction)
  if ("error" in signed) {
    throw new ExternalTradeError(
      signed.error === "cancelled"
        ? "Closed in Phantom before signing."
        : signed.error === "timeout"
          ? "Phantom did not answer. Try again."
          : "Phantom could not sign this trade.",
      signed.error === "cancelled" ? "cancelled" : "failed",
      signed.detail,
    )
  }
  return submitExternalTrade({
    preparedId: prepared.preparedId,
    signature: signed.signature,
    /* The bytes when the wallet let us keep them: the server broadcasts
       and resends with these, which is the half Phantom's own send never
       did. Absent for a provider without signTransaction, and the server
       falls back to the signature-only path. */
    ...(signed.signedTx ? { signedTx: signed.signedTx } : {}),
  })
}

/**
 * CONNECT A WALLET THE READER ALREADY HAS — the page half.
 *
 * Nothing here spends anything: connect, ask the server for the sentence it
 * will verify, have the wallet sign that text, post the signature. The
 * account it joins is decided by the token the background attaches, never by
 * anything this page says.
 *
 * It rides the SAME road as every wallet trade — the MAIN-world bridge on
 * the page beside the panel — because there is only one road: Phantom
 * injects into web pages and not into an extension's own pages, so the panel
 * hands this to the active tab exactly as it hands over a trade
 * (helpers/panelExternalTrade.ts → background → this file).
 *
 * The server's three refusals arrive as sentences and are rethrown verbatim:
 * "already belongs to another account", "your Poppin wallet still holds
 * $X", "this account already trades from a wallet" are each a different
 * next move for the reader, and flattening them to "could not connect"
 * takes that away.
 */
export async function connectWalletOnPage(): Promise<{
  address: string
  wallet_mode: string
  external_address: string | null
}> {
  const { hasPageWallet, connectPageWallet, signMessageWithPageWallet } = await import(
    "~/helpers/pageWalletBridge"
  )
  const { WalletService } = await import("~/services/WalletService")
  if (!(await hasPageWallet())) {
    throw new ExternalTradeError("Phantom is not on this page. Unlock it and try again.", "no-wallet")
  }
  const address = await connectPageWallet()
  if (!address) {
    throw new ExternalTradeError("Phantom did not connect.", "not-connected")
  }
  const sentence = await WalletService.walletSignInSentence(address)
  const signature = await signMessageWithPageWallet(sentence.message)
  if (!signature) {
    throw new ExternalTradeError("Closed in Phantom before signing.", "cancelled")
  }
  const r = await WalletService.connectTradingWallet({
    address,
    signature,
    isoTime: sentence.isoTime,
  })
  return { address, wallet_mode: r.wallet_mode, external_address: r.external_address }
}

/** The page side of a wallet account's order: connect, check the address, sign what the server built. */
async function signPreparedOnPage(
  expectedAddress: string | null | undefined,
  prepare: () => Promise<{ preparedId: string; transaction: string; orderKey: string }>,
) {
  const { hasPageWallet, connectPageWallet, signWithPageWalletDetailed } = await import(
    "~/helpers/pageWalletBridge"
  )
  if (!(await hasPageWallet())) {
    throw new ExternalTradeError("Phantom is not on this page. Unlock it and try again.", "no-wallet")
  }
  const address = await connectPageWallet()
  if (!address) throw new ExternalTradeError("Phantom did not connect.", "not-connected")
  if (expectedAddress && address !== expectedAddress) {
    throw new ExternalTradeError(
      `Phantom is on a different wallet (${address.slice(0, 4)}…${address.slice(-4)}) than your Poppin account.`,
      "wrong-wallet",
    )
  }
  const prepared = await prepare()
  const signed = await signWithPageWalletDetailed(prepared.transaction)
  if ("error" in signed) {
    throw new ExternalTradeError(
      signed.error === "cancelled"
        ? "Closed in Phantom before signing."
        : signed.error === "timeout"
          ? "Phantom did not answer. Try again."
          : "Phantom could not sign this order.",
      signed.error === "cancelled" ? "cancelled" : "failed",
      signed.detail,
    )
  }
  return submitExternalOrder({ preparedId: prepared.preparedId, signature: signed.signature })
}

export interface ExternalOrderArgs {
  mint: string
  side: "buy" | "sell"
  amountUsd?: number
  amountRaw?: string
  triggerPriceUsd: number
  expectedAddress?: string | null
}

/** A standing order placed by the reader's own wallet. Same receipt shape as createOrderAsset. */
export async function orderWithPageWallet(args: ExternalOrderArgs) {
  const r = await signPreparedOnPage(args.expectedAddress, () =>
    prepareExternalOrder({
      mint: args.mint,
      side: args.side,
      ...(args.side === "buy" ? { amountUsd: args.amountUsd } : { amountRaw: args.amountRaw }),
      triggerPriceUsd: args.triggerPriceUsd,
    }),
  )
  return { orderKey: r.orderKey, signature: r.signature, dryRun: false }
}

/** The order taken back by the wallet that placed it. Same receipt shape as cancelOrderAsset. */
export async function cancelOrderWithPageWallet(orderKey: string, expectedAddress?: string | null) {
  const r = await signPreparedOnPage(expectedAddress, () => prepareExternalCancel(orderKey))
  return { orderKey: r.orderKey, signature: r.signature, dryRun: false }
}
