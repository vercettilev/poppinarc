/**
 * End-to-end on ARC TESTNET with the real services and a synthetic user.
 *
 * Runs the same code the API runs (no HTTP, no auth: the services directly),
 * against Circle's testnet and Arc testnet, so wallet creation, the faucet,
 * App Kit Swap and the ledger are exercised for real with play money.
 *
 * Runs INSIDE the deployed container, where the database is reachable on
 * Railway's private network and the Circle keys are already in the env:
 *
 *   cd api && railway ssh --service arc-api -- DEPOSIT_SWEEP_SECONDS=0 node dist/e2e/testnet.js
 *
 * Refuses to run anywhere but testnet. Prints addresses and hashes only,
 * never a key.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { APP_CONFIG, type AppConfig } from '../config';
import { ArcChain } from '../arc/chain';
import { CircleWallets } from '../circle/wallets';
import { TradeService } from '../trade/trade.service';
import { UsersService } from '../users/users.service';

const UID = process.env.E2E_UID ?? 'e2e-testnet-1';

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const config = app.get<AppConfig>(APP_CONFIG);
  if (config.network.name !== 'testnet') throw new Error('e2e runs on testnet only');
  const net = config.network;
  const chain = app.get(ArcChain);
  const wallets = app.get(CircleWallets);
  const users = app.get(UsersService);
  const trade = app.get(TradeService);
  const t0 = Date.now();
  const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

  await users.ensure({ uid: UID, email: null, name: 'E2E Testnet', picture: null });
  const w = await wallets.ensureArcWallet(UID);
  say(`Arc wallet ${w.address} (${w.accountType}) ${chain.explorerAddress(w.address)}`);

  const tokens = [net.usdc.address, net.eurc.address, net.cirbtc.address];
  const bal = async () => chain.balancesOf(w.address as `0x${string}`, tokens as `0x${string}`[]);
  let b = await bal();
  say(`balances USDC=${b.get(net.usdc.address.toLowerCase())} EURC=${b.get(net.eurc.address.toLowerCase())} cirBTC=${b.get(net.cirbtc.address.toLowerCase())}`);

  if ((b.get(net.usdc.address.toLowerCase()) ?? 0n) < 3_000_000n) {
    say('asking Circle testnet faucet for USDC + EURC');
    try {
      await wallets.faucet(w.address);
    } catch (e: any) {
      say(`faucet refused: ${e?.message ?? e}`);
    }
    b = await waitFor('faucet USDC', async () => {
      const x = await bal();
      return (x.get(net.usdc.address.toLowerCase()) ?? 0n) >= 1_000_000n ? x : null;
    });
    say(`funded USDC=${b.get(net.usdc.address.toLowerCase())} EURC=${b.get(net.eurc.address.toLowerCase())}`);
  }

  const q = await trade.quote(net.cirbtc.address.toLowerCase(), 1);
  say(`quote $1 -> cirBTC ${JSON.stringify(q)}`);

  for (const [label, mint] of [
    ['EURC', net.eurc.address],
    ['cirBTC', net.cirbtc.address],
  ] as const) {
    const started = Date.now();
    const r = await trade.buy(UID, { mint: mint.toLowerCase(), amountUsd: 1, idempotencyKey: `e2e-buy-${label}-${t0}` });
    say(`BUY $1 ${label}: ${JSON.stringify(r)} in ${Date.now() - started} ms ${r.signature ? chain.explorerTx(r.signature) : ''}`);
    const c = await trade.confirm(r.signature);
    say(`confirm ${label}: ${JSON.stringify(c)}`);
  }

  const held = await bal();
  const cir = held.get(net.cirbtc.address.toLowerCase()) ?? 0n;
  if (cir > 0n) {
    const half = cir / 2n;
    const started = Date.now();
    const s = await trade.sell(UID, { mint: net.cirbtc.address.toLowerCase(), amountRaw: half.toString(), idempotencyKey: `e2e-sell-${t0}` });
    say(`SELL ${half} cirBTC raw: ${JSON.stringify(s)} in ${Date.now() - started} ms ${s.signature ? chain.explorerTx(s.signature) : ''}`);
  }

  const book = await trade.positions(UID);
  say(`positions ${JSON.stringify(book).slice(0, 1500)}`);
  await app.close();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('E2E FAILED:', e?.response ?? e?.message ?? e);
    process.exit(1);
  });
}
