import { ARC_EDITION, ARC_NETWORK, type ArcNetworkName } from "~/config/edition"

/**
 * THE CHAIN FACTS BOTH EDITIONS READ, in one place.
 *
 * The store extension grew up on Solana and wrote its facts down where it
 * needed them: the USDC mint as a literal in five files, Solscan in two, a
 * base58 regex in the panel's deep links. The Arc edition needs the same
 * facts with different values, so they live here and every call site imports
 * them. With the flag off each value is the literal it replaces, byte for
 * byte, which is what keeps the store build where it was.
 *
 * Arc's USDC is both the gas token and the ERC-20 at 0x3600…0000. Money in
 * this product is always the 6-decimal ERC-20 figure; the 18-decimal native
 * view of the same balance never reaches the extension (arc-api's
 * arc/network.ts). Addresses on the wire are lowercase, because the
 * extension compares mints with === and Set.has.
 */

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
export const ARC_USDC = "0x3600000000000000000000000000000000000000"

export const ARC_EXPLORERS: Record<ArcNetworkName, string> = {
  mainnet: "https://explorer.arc.io",
  testnet: "https://explorer.testnet.arc.io",
}

/** Circle's own assets on Arc, lowercase: the edition's reviewed list. */
export const ARC_CIRCLE_ASSETS: Record<ArcNetworkName, { eurc: string; cirbtc: string }> = {
  mainnet: {
    eurc: "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1",
    cirbtc: "0x171a4217b86a807a64eb94757db6849fb4bdbaa0",
  },
  testnet: {
    eurc: "0x89b50855aa3be2f677cd6303cec089b5f319d72a",
    cirbtc: "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf",
  },
}

export interface ChainFacts {
  arc: boolean
  /** The mint the product calls money. */
  usdcMint: string
  /** What a transfer with no mint is. On Arc that is USDC itself. */
  nativeSymbol: "SOL" | "USDC"
  /** The network a deposit must be sent on, named only on the deposit screen. */
  networkName: "Solana" | "Arc"
  /** Where a transaction can be looked at. */
  explorer: string
}

export function chainFacts(arc: boolean, network: ArcNetworkName = "testnet"): ChainFacts {
  return arc
    ? {
        arc: true,
        usdcMint: ARC_USDC,
        nativeSymbol: "USDC",
        networkName: "Arc",
        explorer: ARC_EXPLORERS[network],
      }
    : {
        arc: false,
        usdcMint: SOLANA_USDC_MINT,
        nativeSymbol: "SOL",
        networkName: "Solana",
        explorer: "https://solscan.io",
      }
}

export const CHAIN: Readonly<ChainFacts> = Object.freeze(chainFacts(ARC_EDITION, ARC_NETWORK))
export const USDC_MINT: string = CHAIN.usdcMint
export const NATIVE_SYMBOL: ChainFacts["nativeSymbol"] = CHAIN.nativeSymbol

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/

export function isEvmAddress(s: unknown): s is string {
  return typeof s === "string" && EVM_ADDRESS.test(s)
}

export function isEvmTxHash(s: unknown): s is string {
  return typeof s === "string" && EVM_TX_HASH.test(s)
}

/**
 * The page for one transaction, or null when there is nothing to link.
 *
 * On Solana every recorded signature is a real one, so it always links, as it
 * always did. On Arc a trade row can be written before its hash exists (a
 * Circle transaction id stands in), and a link to that id is a "not found"
 * page on the explorer: only a real 0x hash earns a link.
 */
export function explorerTxUrl(sig: string, facts: ChainFacts = CHAIN): string | null {
  if (!facts.arc) return `${facts.explorer}/tx/${sig}`
  return isEvmTxHash(sig) ? `${facts.explorer}/tx/${sig.toLowerCase()}` : null
}

/**
 * An address or mint shortened for a label. A 0x value keeps its head and its
 * tail, because "0x12…" is the same four characters for every token on the
 * chain; base58 keeps the store's four-and-an-ellipsis.
 */
export function shortAddress(a: string): string {
  if (a.startsWith("0x") && a.length > 12) return `${a.slice(0, 6)}…${a.slice(-4)}`
  return `${a.slice(0, 4)}…${a.slice(-4)}`
}

/**
 * THE PANEL ROUTES A PAGE MAY OPEN, per edition. The store's list takes a
 * base58 mint only; the Arc edition also takes a 0x address, or the chip's
 * Holdings and Activity rows would open nothing at all.
 */
const SOLANA_ROOM = /^\/(?:token\/[1-9A-HJ-NP-Za-km-z]{32,44}|profile\/[\w-]+|feed)$/
const ARC_ROOM = /^\/(?:token\/(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})|profile\/[\w-]+|feed)$/
export function panelRoomPattern(arc: boolean = ARC_EDITION): RegExp {
  return arc ? ARC_ROOM : SOLANA_ROOM
}
