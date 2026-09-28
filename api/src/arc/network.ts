/**
 * The two Arc networks this service can run on, and every address it touches.
 *
 * Sources, both read 2026-09-27/28 and checked on chain (eth_chainId, and
 * decimals() on each token):
 *   https://docs.arc.io/arc/references/contract-addresses
 *   https://docs.arc.io/arc/references/connect-to-arc
 *
 * USDC IS THE GAS TOKEN ON ARC. The same balance answers to two interfaces:
 * the native balance in 18 decimals (what gas is paid from) and the ERC-20 at
 * 0x3600…0000 in 6 decimals (what every DEX, CCTP and App Kit speak). Nothing
 * in this service converts between them by hand; money is always the 6-decimal
 * ERC-20 figure, and gas is read from receipts in native units only to report
 * it, never to move it.
 */

export type ArcNetworkName = 'mainnet' | 'testnet';

export interface TokenInfo {
  symbol: 'USDC' | 'EURC' | 'cirBTC';
  address: `0x${string}`;
  decimals: number;
}

export interface ArcNetwork {
  name: ArcNetworkName;
  chainId: number;
  /** App Kit's chain identifier for this network. */
  appKitChain: 'Arc' | 'Arc_Testnet';
  /** Circle Wallets' blockchain code for this network. */
  walletsBlockchain: 'ARC' | 'ARC-TESTNET';
  rpcUrl: string;
  explorer: string;
  usdc: TokenInfo;
  eurc: TokenInfo;
  cirbtc: TokenInfo;
  permit2: `0x${string}`;
  multicall3: `0x${string}`;
}

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;

export const ARC_NETWORKS: Record<ArcNetworkName, ArcNetwork> = {
  mainnet: {
    name: 'mainnet',
    chainId: 5042,
    appKitChain: 'Arc',
    walletsBlockchain: 'ARC',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io',
    usdc: { symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 },
    eurc: { symbol: 'EURC', address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
    cirbtc: { symbol: 'cirBTC', address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  testnet: {
    name: 'testnet',
    chainId: 5042002,
    appKitChain: 'Arc_Testnet',
    walletsBlockchain: 'ARC-TESTNET',
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorer: 'https://explorer.testnet.arc.io',
    usdc: { symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 },
    eurc: { symbol: 'EURC', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
    cirbtc: { symbol: 'cirBTC', address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8 },
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
};

/** The three assets App Kit Swap trades on Arc; everything else routes elsewhere. */
export function circleAssets(net: ArcNetwork): TokenInfo[] {
  return [net.usdc, net.eurc, net.cirbtc];
}

export function circleAssetByAddress(net: ArcNetwork, address: string): TokenInfo | null {
  const a = address.toLowerCase();
  return circleAssets(net).find((t) => t.address.toLowerCase() === a) ?? null;
}
