import { ARC_NETWORK } from "~/config/edition"

/**
 * CAN THE READER BUY THIS ONE FROM THEIR ARC BALANCE TODAY, or only see its
 * route? arc-api answers the same question server side (far/far-trades.ts,
 * opensFor); the chip and the token room ask here so they can say "Buy"
 * before any request.
 *
 * Base and Arbitrum trade on Arc mainnet: Circle moves the USDC over CCTP and
 * the reader's Circle account buys there, gas paid in USDC. Everywhere else
 * (Solana, Hyperliquid, Ethereum) is a priced route and nothing more yet.
 * Of the hand-kept remote assets (arc-api routes/remote.ts) AERO and VIRTUAL
 * live on Base; ETH there is the native coin, which stays a preview.
 */
const LIVE_CHAINS = new Set(["base", "arbitrum"])
const KEPT_ON_LIVE_CHAINS = new Set(["aero", "virtual"])
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

export function remoteTradable(mint: string, network: string = ARC_NETWORK): boolean {
  if (network !== "mainnet" || !mint.startsWith("remote:")) return false
  const rest = mint.slice("remote:".length)
  const at = rest.indexOf(":")
  if (at < 0) return KEPT_ON_LIVE_CHAINS.has(rest)
  return LIVE_CHAINS.has(rest.slice(0, at)) && rest.slice(at + 1).toLowerCase() !== NATIVE
}

