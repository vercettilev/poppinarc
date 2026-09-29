/**
 * ASSETS THAT LIVE ON OTHER CHAINS, REACHED FROM ARC.
 *
 * Arc is the hub: a reader's money is USDC on Arc, and every trade starts and
 * ends there. An asset on Solana, Hyperliquid, Base or Ethereum is reached by
 * moving that USDC over CCTP (Circle's own burn and mint, no wrapped copy on
 * the way) and swapping it on the asset's home venue: Jupiter on Solana,
 * Hyperliquid's own book, KyberSwap on Base and Ethereum. Selling runs the
 * same road back into the Arc balance.
 *
 * TODAY THIS IS A PRICED PREVIEW, not a trade. Every number is live (the CCTP
 * fee from Circle, the swap from the venue, the destination's network fee),
 * and the route is the one the trade will take; sending it needs a wallet on
 * each chain, which Circle Wallets gives every account. Until then the panel
 * shows the route and says so.
 *
 * A remote asset's "mint" in the extension is `remote:<key>`, so nothing that
 * reads a mint mistakes one for an Arc contract.
 */

export type RemoteChain = 'solana' | 'hyperliquid' | 'base' | 'ethereum';
export type RemoteVenue = 'jupiter' | 'hyperliquid' | 'kyber';

export interface RemoteAsset {
  key: string;
  ticker: string;
  name: string;
  chain: RemoteChain;
  venue: RemoteVenue;
  /** The asset's own address or mint on its chain; Hyperliquid's coin name there. */
  address: string;
  decimals: number;
}

export interface ChainInfo {
  label: string;
  /** Circle's CCTP domain id (developers.circle.com/cctp, read 2026-09-29). */
  cctpDomain: number;
  /** Native USDC on that chain, what CCTP mints and the venue spends. */
  usdc: string;
}

export const ARC_CCTP_DOMAIN = 26;

export const CHAINS: Record<RemoteChain, ChainInfo> = {
  solana: { label: 'Solana', cctpDomain: 5, usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  hyperliquid: { label: 'Hyperliquid', cctpDomain: 19, usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f' },
  base: { label: 'Base', cctpDomain: 6, usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  ethereum: { label: 'Ethereum', cctpDomain: 0, usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
};

/** Measured live on 2026-09-29 through the venue each one names. */
export const REMOTE_ASSETS: RemoteAsset[] = [
  { key: 'sol', ticker: 'SOL', name: 'Solana', chain: 'solana', venue: 'jupiter', address: 'So11111111111111111111111111111111111111112', decimals: 9 },
  { key: 'jup', ticker: 'JUP', name: 'Jupiter', chain: 'solana', venue: 'jupiter', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
  { key: 'bonk', ticker: 'BONK', name: 'Bonk', chain: 'solana', venue: 'jupiter', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  { key: 'hype', ticker: 'HYPE', name: 'Hyperliquid', chain: 'hyperliquid', venue: 'hyperliquid', address: 'HYPE', decimals: 8 },
  { key: 'eth', ticker: 'ETH', name: 'Ether', chain: 'base', venue: 'kyber', address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18 },
  { key: 'aero', ticker: 'AERO', name: 'Aerodrome', chain: 'base', venue: 'kyber', address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', decimals: 18 },
  { key: 'virtual', ticker: 'VIRTUAL', name: 'Virtuals', chain: 'base', venue: 'kyber', address: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', decimals: 18 },
  { key: 'uni', ticker: 'UNI', name: 'Uniswap', chain: 'ethereum', venue: 'kyber', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', decimals: 18 },
  { key: 'aave', ticker: 'AAVE', name: 'Aave', chain: 'ethereum', venue: 'kyber', address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', decimals: 18 },
  { key: 'link', ticker: 'LINK', name: 'Chainlink', chain: 'ethereum', venue: 'kyber', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
];

export const REMOTE_PREFIX = 'remote:';

export function remoteMint(key: string): string {
  return `${REMOTE_PREFIX}${key}`;
}

export function remoteAssetOf(mint: unknown): RemoteAsset | null {
  if (typeof mint !== 'string' || !mint.startsWith(REMOTE_PREFIX)) return null;
  const key = mint.slice(REMOTE_PREFIX.length);
  return REMOTE_ASSETS.find((a) => a.key === key) ?? null;
}

export function remoteAssetByTicker(ticker: unknown): RemoteAsset | null {
  if (typeof ticker !== 'string') return null;
  const t = ticker.replace(/^\$/, '').toUpperCase();
  return REMOTE_ASSETS.find((a) => a.ticker === t) ?? null;
}
