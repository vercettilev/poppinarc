import { Inject, Injectable } from '@nestjs/common';
import {
  createPublicClient,
  defineChain,
  erc20Abi,
  http,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { APP_CONFIG, AppConfig } from '../config';

/**
 * Reads from Arc. Writes never happen here: every transaction is signed and
 * sent by Circle Wallets, and this service only watches what they did.
 *
 * The chain is defined locally instead of imported from `viem/chains`: that
 * barrel re-exports chains whose typings do not resolve under node10 module
 * resolution (met in the July testnet work), and this is one object.
 */
@Injectable()
export class ArcChain {
  readonly client: PublicClient;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const net = config.network;
    const chain = defineChain({
      id: net.chainId,
      name: net.name === 'mainnet' ? 'Arc' : 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
      blockExplorers: { default: { name: 'Arc Explorer', url: net.explorer } },
      contracts: { multicall3: { address: net.multicall3 } },
      testnet: net.name !== 'mainnet',
    });
    this.client = createPublicClient({ chain, transport: http(config.rpcUrl, { batch: true }) }) as PublicClient;
  }

  /** ERC-20 balances of one owner, raw units, in one multicall round trip. */
  async balancesOf(owner: `0x${string}`, tokens: `0x${string}`[]): Promise<Map<string, bigint>> {
    const results = await this.client.multicall({
      contracts: tokens.map((address) => ({
        address,
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [owner] as const,
      })),
      allowFailure: true,
    });
    const out = new Map<string, bigint>();
    results.forEach((r, i) => {
      out.set(tokens[i].toLowerCase(), r.status === 'success' ? (r.result as bigint) : 0n);
    });
    return out;
  }

  async receipt(hash: Hash, timeoutMs = 30_000): Promise<TransactionReceipt> {
    return this.client.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 250 });
  }

  explorerTx(hash: string): string {
    return `${this.config.network.explorer}/tx/${hash}`;
  }

  explorerAddress(address: string): string {
    return `${this.config.network.explorer}/address/${address}`;
  }
}

/**
 * What a transaction cost, in USDC, from its receipt. Arc prices gas in USDC
 * with 18 decimals natively; the result is converted to the 6-decimal figure
 * every other money number in this service uses. Kept for our own ledger and
 * the grant's evidence, not shown to readers.
 */
export function gasUsdcRaw(receipt: Pick<TransactionReceipt, 'gasUsed' | 'effectiveGasPrice'>): bigint {
  const wei = receipt.gasUsed * receipt.effectiveGasPrice;
  // 18 → 6 decimals, rounded up so a cost is never reported as zero.
  const unit = 10n ** 12n;
  return (wei + unit - 1n) / unit;
}
