/**
 * ASSETS THAT LIVE ON OTHER CHAINS, REACHED FROM ARC.
 *
 * Arc is the hub: a reader's money is USDC on Arc, and every trade starts and
 * ends there. An asset on Solana, Hyperliquid, Base, Ethereum or Arbitrum is
 * reached by moving that USDC over CCTP (Circle's own burn and mint, no
 * wrapped copy on the way), delivered on the far side by Circle's Forwarding
 * Service, and swapping it on the asset's home venue: Jupiter on Solana,
 * Hyperliquid's own book, KyberSwap on the EVM chains. Selling runs the same
 * road back into the Arc balance.
 *
 * TODAY THIS IS A PRICED PREVIEW, not a trade. Every number is live (the CCTP
 * and forwarding fees from Circle, the swap from the venue, the destination's
 * network fee), and the route is the one the trade will take. Until trades
 * there open, the panel shows the route and says so.
 *
 * TWO KINDS OF MINT, both starting `remote:` so nothing that reads a mint
 * mistakes one for an Arc contract:
 *   remote:<key>              the hand-kept list below (remote:sol)
 *   remote:<chain>:<address>  any other token, found by remote-tokens.ts
 */

export type RemoteChain = 'solana' | 'hyperliquid' | 'base' | 'ethereum' | 'arbitrum';
export type RemoteVenue = 'jupiter' | 'hyperliquid' | 'kyber';

export interface RemoteAsset {
  key: string;
  ticker: string;
  name: string;
  chain: RemoteChain;
  venue: RemoteVenue;
  /** The asset's own address or mint on its chain; on Hyperliquid, the key of its book in allMids. */
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
  arbitrum: { label: 'Arbitrum', cctpDomain: 3, usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
};

export const VENUE_OF: Record<RemoteChain, RemoteVenue> = {
  solana: 'jupiter',
  hyperliquid: 'hyperliquid',
  base: 'kyber',
  ethereum: 'kyber',
  arbitrum: 'kyber',
};

/** Measured live on 2026-09-29 through the venue each one names. */
export const REMOTE_ASSETS: RemoteAsset[] = [
  { key: 'sol', ticker: 'SOL', name: 'Solana', chain: 'solana', venue: 'jupiter', address: 'So11111111111111111111111111111111111111112', decimals: 9 },
  { key: 'jup', ticker: 'JUP', name: 'Jupiter', chain: 'solana', venue: 'jupiter', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
  { key: 'bonk', ticker: 'BONK', name: 'Bonk', chain: 'solana', venue: 'jupiter', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  { key: 'hype', ticker: 'HYPE', name: 'Hyperliquid', chain: 'hyperliquid', venue: 'hyperliquid', address: 'HYPE', decimals: 8 },
  // Wrapped ether, not the native coin: an ERC-20 leaves Transfer logs to count and can be approved when sold.
  { key: 'eth', ticker: 'ETH', name: 'Ether', chain: 'base', venue: 'kyber', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
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

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const SOLANA_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A Hyperliquid book as allMids names it: "PURR/USDC" for the first one, "@107" for the rest. */
const HL_BOOK = /^(@\d{1,6}|[A-Z0-9]{1,12}\/USDC)$/;

/** The key an any-token mint carries, once its address is written the one way it is always written. */
export function anyTokenKey(chain: RemoteChain, address: string): string | null {
  if (chain === 'solana') return SOLANA_MINT.test(address) ? `solana:${address}` : null;
  if (chain === 'hyperliquid') return HL_BOOK.test(address) ? `hyperliquid:${address}` : null;
  const a = address.toLowerCase();
  return EVM_ADDRESS.test(a) ? `${chain}:${a}` : null;
}

/** `remote:<chain>:<address>` read back, or null for anything else (the hand-kept keys included). */
export function parseAnyTokenMint(mint: unknown): { chain: RemoteChain; address: string } | null {
  if (typeof mint !== 'string' || !mint.startsWith(REMOTE_PREFIX)) return null;
  const rest = mint.slice(REMOTE_PREFIX.length);
  const at = rest.indexOf(':');
  if (at < 0) return null;
  const chain = rest.slice(0, at) as RemoteChain;
  if (!(chain in CHAINS)) return null;
  const key = anyTokenKey(chain, rest.slice(at + 1));
  return key ? { chain, address: key.slice(chain.length + 1) } : null;
}

/** CoinGecko's image CDN, where each share's logo is listed (read through Base's explorer, 2026-10-01). */
const CG_IMG = 'https://assets.coingecko.com/coins/images/';

/**
 * TOKENIZED STOCKS, KEPT BY HAND. A stock's ticker never goes to the market
 * snapshot: "$NVDA" is the company, and the coin CoinGecko files under that
 * symbol could be anyone's. These are Coinbase's tokenized shares on Base,
 * each read from CoinGecko's listing (nvidia-coinbase-tokenized-stock and
 * its siblings) and each routed by KyberSwap at under a quarter percent
 * for $10 on 2026-09-30. Base is where the reader can buy them from Arc.
 */
export const REMOTE_STOCKS: Readonly<Record<string, { name: string; address: string; icon: string }>> = {
  NVDA: { name: 'NVIDIA', address: '0xb20000000000000000000078ee7ce2fe4908108c', icon: CG_IMG + '102175596/small/nvda_200x200.png' },
  AAPL: { name: 'Apple', address: '0xb200000000000000000000c2e324d24d7eecd1fb', icon: CG_IMG + '102175597/small/aapl_200x200.png' },
  TSLA: { name: 'Tesla', address: '0xb2000000000000000000001e800a7f5189430cd0', icon: CG_IMG + '102178285/small/tsla-200.png' },
  MSFT: { name: 'Microsoft', address: '0xb200000000000000000000ab99cfa739e253872b', icon: CG_IMG + '102178281/small/msft-200.png' },
  AMZN: { name: 'Amazon', address: '0xb200000000000000000000d9192b6b456483c2e8', icon: CG_IMG + '102178280/small/amzn-200.png' },
  GOOGL: { name: 'Alphabet', address: '0xb2000000000000000000002d0ba3164cc74f58b7', icon: CG_IMG + '102175598/small/goog_200x200.png' },
  GOOG: { name: 'Alphabet', address: '0xb2000000000000000000002d0ba3164cc74f58b7', icon: CG_IMG + '102175598/small/goog_200x200.png' },
  META: { name: 'Meta', address: '0xb2000000000000000000008bc8786b856e61707c', icon: CG_IMG + '102175599/small/meta_200x200.png' },
  MSTR: { name: 'Strategy', address: '0xb2000000000000000000004884b426556b92883d', icon: CG_IMG + '102178282/small/mstr-200.png' },
  PLTR: { name: 'Palantir', address: '0xb2000000000000000000007d16372840df4dabbe', icon: CG_IMG + '102178880/small/PLTR.png' },
  MU: { name: 'Micron', address: '0xb200000000000000000000fd2f87532b90095211', icon: CG_IMG + '102178881/small/MU.png' },
  SNDK: { name: 'SanDisk', address: '0xb200000000000000000000397293cb8cda9a10c5', icon: CG_IMG + '102178283/small/sndk-200.png' },
};
