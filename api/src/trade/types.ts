/**
 * The shared vocabulary of money in arc-api. Every router, the market layer and
 * the extension-compatible controllers speak these types, so the pieces can be
 * built separately and still fit.
 *
 * Conventions, all load-bearing:
 * - Addresses are LOWERCASE `0x…` strings everywhere they leave a module. The
 *   extension compares mints with === and Set.has, so one casing, always.
 * - Raw amounts are bigint inside the service and decimal-integer strings on
 *   the wire. USDC and EURC have 6 decimals on Arc (the ERC-20 interface).
 * - A transaction hash is the ON-CHAIN hash (0x + 64 hex), never a Circle
 *   transaction id and never a userOp hash.
 */

export type Address = `0x${string}`;

export type TokenKind = 'cash' | 'circle' | 'long-tail' | 'stock';

export interface ArcToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** cash = USDC/EURC; circle = cirBTC; long-tail = launchpad/meme; stock = tokenized equity. */
  kind: TokenKind;
  icon: string | null;
  /** Tokenized stocks carry holder restrictions from their issuer, e.g. 'us-persons'. */
  restrictions: string[];
}

export type Venue = 'circle-swap' | 'kyber';

export interface QuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  amountInRaw: bigint;
  /** Only needed to build an executable route (aggregators want the sender). */
  from?: Address;
}

export interface Quote {
  venue: Venue;
  tokenIn: Address;
  tokenOut: Address;
  amountInRaw: bigint;
  amountOutRaw: bigint;
  /** What the trade may deliver at worst after slippage, the floor the chain enforces. */
  minAmountOutRaw: bigint;
  /** Percent, 0.84 means 0.84%. Finite always. */
  priceImpactPct: number;
  /** Human venue labels, e.g. ['Circle'] or ['Uniswap v4']. Never empty. */
  route: string[];
}

export type LegKind = 'approve' | 'swap' | 'burn' | 'attest' | 'mint' | 'transfer';
export type LegStatus = 'pending' | 'sent' | 'confirmed' | 'failed';

export interface Leg {
  kind: LegKind;
  status: LegStatus;
  chain: string;
  circleTxId?: string;
  txHash?: string;
  /** Gas paid, 6-decimal USDC raw, from the receipt. Our ledger only; never shown to readers. */
  gasUsdcRaw?: string;
  /** Wall-clock timestamps (ISO) for our own latency record. */
  sentAt?: string;
  confirmedAt?: string;
  error?: string;
}

export interface ExecuteRequest {
  uid: string;
  walletId: string;
  walletAddress: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountInRaw: bigint;
  /** Stable per user action; every Circle call derives its own key from it. */
  actionId: string;
}

export interface Executed {
  venue: Venue;
  /** The swap leg's on-chain hash, the one the extension confirms. */
  txHash: Address;
  amountOutRaw: bigint;
  legs: Leg[];
}

/** A venue that can price and execute a swap from a Circle wallet on Arc. */
export interface SwapRouter {
  readonly venue: Venue;
  supports(tokenIn: Address, tokenOut: Address): boolean;
  quote(req: QuoteRequest): Promise<Quote>;
  execute(req: ExecuteRequest): Promise<Executed>;
}

/** Errors the extension recognises by their words. Keep these sentences. */
export const TRADE_ERRORS = {
  insufficientUsdc: (have: number, need: number) =>
    `Insufficient USDC: wallet holds $${have.toFixed(2)}, needs $${need.toFixed(2)}`,
  insufficientSell: (ui: number) => `Insufficient balance: wallet holds ${ui}, sell asked for more`,
  badBuy: 'mint and a positive amountUsd are required',
  badSell: 'mint and a raw integer amountRaw are required',
  noRoute: 'No route for this asset right now',
  quoteUnavailable: 'Quote unavailable',
  rateLimited: 'Too much traffic on the router right now. Nothing was charged, press again.',
  tooSmall: 'amountUsd too small to route',
  notAllowed: (why: string) => `Mint failed the safety gate: ${why}`,
  chainFailed: (e: string) => `Swap failed on chain: ${e}`,
  sellChainFailed: (e: string) => `Sell failed on chain: ${e}`,
  idempotencyConflict:
    'A trade with this idempotency key is already in progress, or it was already sent. Retry with a new key.',
  walletNotFound: 'User wallet not found',
} as const;

export function lower(a: string): Address {
  return a.toLowerCase() as Address;
}
