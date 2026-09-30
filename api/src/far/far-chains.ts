import type { Hex } from 'viem';
import type { ArcNetworkName } from '../arc/network';

/**
 * THE CHAINS A READER CAN BUY ON FROM THEIR ARC BALANCE, and every address a
 * trade there touches. Base and Arbitrum are the ones where Circle Paymaster
 * runs next to EntryPoint v0.7, the version Circle's smart account speaks
 * (developers.circle.com/paymaster/addresses-and-events, read 2026-09-30).
 * Ethereum's paymaster is v0.8 only, which asks for an EIP-7702 delegation a
 * browser wallet will not sign for a website, so Ethereum stays a preview.
 *
 * CCTP V2 sits at the same addresses on Arc, Base and Arbitrum
 * (developers.circle.com/cctp/references/contract-addresses). A testnet
 * deploy of arc-api uses the Sepolia twins, so a whole trade can be tried
 * with faucet money.
 */

export type FarChainKey = 'base' | 'arbitrum';

export interface FarChain {
  key: FarChainKey;
  label: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  usdc: Hex;
  cctpDomain: number;
  tokenMessenger: Hex;
  paymaster: Hex;
  bundlerUrl: string;
  /** KyberSwap's name for the chain; null on a testnet, where it does not route. */
  kyber: string | null;
  /** What the wallet shows when it adds the chain. */
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export interface FarNetwork {
  irisUrl: string;
  /** TokenMessengerV2 on Arc, where a buy burns and a sell's USDC is minted back. */
  arcTokenMessenger: Hex;
  chains: Record<FarChainKey, FarChain>;
}

const ETH = { name: 'Ether', symbol: 'ETH', decimals: 18 };
const MAINNET_CCTP = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
const TESTNET_CCTP = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';

export const FAR_NETWORKS: Record<ArcNetworkName, FarNetwork> = {
  mainnet: {
    irisUrl: 'https://iris-api.circle.com',
    arcTokenMessenger: MAINNET_CCTP,
    chains: {
      base: {
        key: 'base',
        label: 'Base',
        chainId: 8453,
        rpcUrl: 'https://mainnet.base.org',
        explorer: 'https://basescan.org',
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        cctpDomain: 6,
        tokenMessenger: MAINNET_CCTP,
        paymaster: '0x6C973eBe80dCD8660841D4356bf15c32460271C9',
        bundlerUrl: 'https://public.pimlico.io/v2/8453/rpc',
        kyber: 'base',
        nativeCurrency: ETH,
      },
      arbitrum: {
        key: 'arbitrum',
        label: 'Arbitrum',
        chainId: 42161,
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        explorer: 'https://arbiscan.io',
        usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        cctpDomain: 3,
        tokenMessenger: MAINNET_CCTP,
        paymaster: '0x6C973eBe80dCD8660841D4356bf15c32460271C9',
        bundlerUrl: 'https://public.pimlico.io/v2/42161/rpc',
        kyber: 'arbitrum',
        nativeCurrency: ETH,
      },
    },
  },
  testnet: {
    irisUrl: 'https://iris-api-sandbox.circle.com',
    arcTokenMessenger: TESTNET_CCTP,
    chains: {
      base: {
        key: 'base',
        label: 'Base Sepolia',
        chainId: 84532,
        rpcUrl: 'https://sepolia.base.org',
        explorer: 'https://sepolia.basescan.org',
        usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        cctpDomain: 6,
        tokenMessenger: TESTNET_CCTP,
        paymaster: '0x31BE08D380A21fc740883c0BC434FcFc88740b58',
        bundlerUrl: 'https://public.pimlico.io/v2/84532/rpc',
        kyber: null,
        nativeCurrency: ETH,
      },
      arbitrum: {
        key: 'arbitrum',
        label: 'Arbitrum Sepolia',
        chainId: 421614,
        rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
        explorer: 'https://sepolia.arbiscan.io',
        usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        cctpDomain: 3,
        tokenMessenger: TESTNET_CCTP,
        paymaster: '0x31BE08D380A21fc740883c0BC434FcFc88740b58',
        bundlerUrl: 'https://public.pimlico.io/v2/421614/rpc',
        kyber: null,
        nativeCurrency: ETH,
      },
    },
  },
};

export function isFarChain(chain: string): chain is FarChainKey {
  return chain === 'base' || chain === 'arbitrum';
}

/** The forwarding request CCTP's Forwarding Service reads from hook data: "cctp-forward", version 0, no payload. */
export const FORWARD_HOOK: Hex = '0x636374702d666f72776172640000000000000000000000000000000000000000';

export const tokenMessengerAbi = [
  {
    type: 'function',
    name: 'depositForBurnWithHook',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export const permitAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;
