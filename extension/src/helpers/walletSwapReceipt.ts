import { receiptSentence } from "./tradeReceipt"
import { USDC_MINT as EDITION_USDC_MINT } from "~/arc/chain"

/** The edition's USDC: the boundary a receipt is drawn on. */
const USDC_MINT = EDITION_USDC_MINT
const SOL_MINT = "So11111111111111111111111111111111111111112"

/**
 * Where a wallet trade FILES itself. The chip files trades made on X under
 * x.com/home so they land in the reader's own feed rather than on a tweet
 * they scrolled past; a swap made in the wallet has no page at all, so it
 * files under the app the same way. Attribution is untouched: caller credit
 * is paid from spot_trades.source_url, which this never sets.
 */
export const WALLET_SOURCE_URL = "https://app.poppin.so/wallet"

export interface SwapSideToken {
  mint?: string | null
  symbol?: string | null
  logoURI?: string | null
}

/**
 * THE FEED POST A WALLET SWAP BECOMES, or null when it is not a trade this
 * vocabulary can tell.
 *
 * ONLY WHEN USDC IS A SIDE, which is the same boundary the ledger draws one
 * layer down (walletSwapLeg on the backend). A receipt has one asset and one
 * direction: USDC in is a buy, USDC out is a sell. A SOL to WIF swap is
 * neither, and dressing it as one would put a dollar figure on a leg that
 * was never quoted in dollars.
 */
export function walletSwapReceipt(args: {
  from: SwapSideToken
  to: SwapSideToken
  /** The amounts as the screen holds them: display strings. */
  fromAmount: string
  toAmount: string
  signature: string
}): {
  content: string
  website_url: string
  only_followers: boolean
  on_chain: boolean
  transaction_data: Record<string, unknown>
} | null {
  const buying = args.from.mint === USDC_MINT
  const selling = args.to.mint === USDC_MINT
  if (buying === selling) return null

  const asset = buying ? args.to : args.from
  if (!asset.mint) return null
  /**
   * SOL IS NOT A CALL, it is the gas tank. Swapping USDC into SOL is how a
   * reader keeps the lights on, and announcing it as "SOL $600" puts a
   * housekeeping chore in a feed of trades. The ledger refuses this pair
   * one layer down for a harder reason — this path leaves SOL native, so a
   * position for it can never exist — and the two agree here on purpose.
   */
  if (asset.mint === SOL_MINT) return null

  // Display strings, so a stray comma or an empty field must not become NaN
  // in a sentence about somebody's money.
  const num = (s: string) => {
    const n = Number(String(s).replace(/,/g, ""))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const usd = num(buying ? args.fromAmount : args.toAmount)
  const tokens = num(buying ? args.toAmount : args.fromAmount)
  // Nothing to say about a trade whose size we cannot read.
  if (usd <= 0 && tokens <= 0) return null

  const symbol = asset.symbol ?? ""
  return {
    content: receiptSentence({
      symbol,
      side: buying ? "buy" : "sell",
      usd,
      tokens,
      // The wallet's token rows carry no market cap, and re-reading one now
      // would price this trade at a size it never had. The sentence stops
      // early instead, exactly as it does on every other surface.
      mcap: null,
    }),
    website_url: WALLET_SOURCE_URL,
    only_followers: false,
    on_chain: true,
    transaction_data: {
      tokenSymbol: symbol.replace(/^\$+/, ""),
      tokenMint: asset.mint,
      tokenAmount: tokens,
      signature: args.signature,
      ...(asset.logoURI ? { tokenImageUrl: asset.logoURI } : {}),
      // The DB defaults a missing tradeType to 'buy', so a sell that omitted
      // it was recorded as a buy — the sentence said one thing and the
      // receipt row said the other.
      tradeType: buying ? "buy" : "sell",
    },
  }
}
