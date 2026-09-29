/**
 * A dry run of the own-wallet trade builder against Arc MAINNET: route, build
 * and allowance read for a wallet address, and nothing sent or signed. Run
 * by hand: npx ts-node --transpile-only src/e2e/own-wallet-dryrun.ts <address>
 */
import { Logger } from '@nestjs/common';
import { ArcChain } from '../arc/chain';
import type { CircleWallets } from '../circle/wallets';
import { loadConfig } from '../config';
import { KyberRouter, swapDescription } from '../routers/kyber.router';
import type { ActionsStore } from '../trade/actions';
import type { Address } from '../trade/types';

async function main() {
  Logger.overrideLogger(['error', 'warn']);
  const wallet = (process.argv[2] ?? '').toLowerCase() as Address;
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error('usage: own-wallet-dryrun.ts <0x address>');
  const config = loadConfig({ ARC_NETWORK: 'mainnet' });
  const chain = new ArcChain(config);
  const kyber = new KyberRouter(config, chain, {} as CircleWallets, {} as ActionsStore);
  const usdc = config.network.usdc.address.toLowerCase() as Address;
  for (const [name, token, amount] of [
    ['cirBTC', config.network.cirbtc.address, 1_000_000n],
    ['EURC', config.network.eurc.address, 1_000_000n],
  ] as const) {
    const s = await kyber.prepareForWallet({
      tokenIn: usdc,
      tokenOut: token.toLowerCase() as Address,
      amountInRaw: amount,
      walletAddress: wallet,
      actionId: `dryrun-${name}`,
    });
    const d = swapDescription(s.callData)!;
    console.log(
      `${name}: router ${s.router} amountOut ${s.amountOut} minOut ${s.minOut} allowance ${s.allowance} route ${s.route.join(' > ')} receiver-ok ${d.dstReceiver === wallet} calldata ${s.callData.length} chars`,
    );
  }
}
main().catch((e) => {
  console.error('dry run failed:', e?.response ?? e?.message ?? e);
  process.exit(1);
});
