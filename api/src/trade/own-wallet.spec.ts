import { BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { decodeFunctionData, erc20Abi } from 'viem';
import type { ArcChain } from '../arc/chain';
import { ownWalletOf, type CircleWallets } from '../circle/wallets';
import { meView } from '../compat/users.controller';
import { loadConfig } from '../config';
import type { MarketPort } from '../market/market.types';
import type { KyberRouter, WalletSwap } from '../routers/kyber.router';
import type { ActionsStore } from './actions';
import { confirmTradePage } from './confirm-page';
import { OWN_WALLET_COPY, OwnWalletTrades } from './own-wallet';
import type { Address } from './types';

const USDC = '0x3600000000000000000000000000000000000000' as Address;
const CIRBTC = '0x171a4217b86a807a64eb94757db6849fb4bdbaa0' as Address;
const ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5' as Address;
const ME = '0xabcdef0123456789abcdef0123456789abcdef01' as Address;
const UID = `evm:${ME}`;
const CALLDATA = '0xe21fd0e9aaaa' as Address;
const SWAP_HASH = `0x${'5'.repeat(64)}`;
const APPROVE_HASH = `0x${'a'.repeat(64)}`;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;

beforeAll(() => Logger.overrideLogger(false));

function setup(opts: { allowance?: bigint; usdc?: bigint; btc?: bigint; env?: Record<string, string> } = {}) {
  const config = loadConfig({ ARC_NETWORK: 'mainnet', ARC_WALLET_ACCOUNTS: 'own', ...(opts.env ?? {}) });
  const swap: WalletSwap = {
    router: ROUTER,
    callData: CALLDATA,
    minOut: 29_000n,
    amountOut: 30_000n,
    allowance: opts.allowance ?? 0n,
    priceImpactPct: 0.01,
    route: ['Uniswap v3'],
  };
  const kyber = { prepareForWallet: jest.fn(async () => swap) };
  const getTransaction = jest.fn(async () => ({ from: ME, to: ROUTER, input: CALLDATA }));
  const chain = {
    balancesOf: jest.fn(async () => new Map<string, bigint>([[USDC, opts.usdc ?? 100_000_000n], [CIRBTC, opts.btc ?? 0n]])),
    receipt: jest.fn(async () => ({
      status: 'success',
      gasUsed: 300_000n,
      effectiveGasPrice: 20_000_000_000n,
      logs: [{ address: CIRBTC, topics: [TRANSFER, pad(ROUTER), pad(ME)], data: `0x${(30_000n).toString(16).padStart(64, '0')}` }],
    })),
    client: { getTransaction, readContract: jest.fn(async () => 8) },
  };
  const rows = new Map<string, any>();
  const actions = {
    create: jest.fn(async (a: any) => {
      rows.set(a.id, { ...a, status: 'pending', legs: [], amountOutRaw: null, error: null });
      return { created: true, row: rows.get(a.id) };
    }),
    update: jest.fn(async (id: string, patch: any) => {
      rows.set(id, { ...rows.get(id), ...patch, amountOutRaw: patch.amountOutRaw?.toString() ?? rows.get(id)?.amountOutRaw });
    }),
    get: jest.fn(async (id: string) => rows.get(id) ?? null),
  };
  const market = { gate: jest.fn(async () => ({ ok: true })), describe: jest.fn(async () => null) };
  // The resolver's own rule for a wallet account; a connected wallet is the same kind of answer.
  const wallets = { ownWallet: jest.fn(async (uid: string) => ownWalletOf(config, uid)) };
  const trades = new OwnWalletTrades(
    config,
    kyber as unknown as KyberRouter,
    chain as unknown as ArcChain,
    actions as unknown as ActionsStore,
    wallets as unknown as CircleWallets,
    market as unknown as MarketPort,
  );
  trades.receiptWaitMs = 10;
  return { trades, kyber, chain, actions, rows, market, getTransaction };
}

const BASE = 'https://arc-api-mainnet.example';

function linkOf(confirmUrl: string) {
  const [, frag] = confirmUrl.split('#');
  const [id, t] = frag!.split('.');
  return { id: id!, t: t! };
}

describe('own wallets', () => {
  it('are the address a wallet account signed in with, only where the deploy says so', () => {
    const own = loadConfig({ ARC_NETWORK: 'mainnet', ARC_WALLET_ACCOUNTS: 'own' });
    const circle = loadConfig({ ARC_NETWORK: 'mainnet' });
    expect(ownWalletOf(own, UID)).toMatchObject({ address: ME, walletId: 'own', own: true, blockchain: 'ARC' });
    expect(ownWalletOf(own, 'firebase-uid-123')).toBeNull();
    expect(ownWalletOf(circle, UID)).toBeNull();
    expect(() => loadConfig({ ARC_WALLET_ACCOUNTS: 'mine' })).toThrow('ARC_WALLET_ACCOUNTS');
  });

  it("make /users/me say 'external' with the wallet's own address", () => {
    const row = { uid: UID, username: 'lev', createdAt: '2026-09-29T00:00:00.000Z' } as never;
    expect(meView(row, ME, ME)).toMatchObject({ wallet_mode: 'external', external_address: ME });
    expect(meView(row, ME)).toMatchObject({ wallet_mode: 'custodial', external_address: null });
  });
});

describe('OwnWalletTrades.prepare', () => {
  it('builds an exact approval and the swap for a buy, and links the confirm page with its key in the fragment', async () => {
    const { trades, kyber, actions } = setup();
    const r = await trades.prepare(UID, { side: 'buy', mint: CIRBTC, amountUsd: 25 }, BASE);

    expect(r.confirmUrl.startsWith(`${BASE}/api/v1/wallet/confirm#${r.preparedId}.`)).toBe(true);
    expect(r.summary.title).toBe('Buy $25.00 of Bitcoin');
    expect(r.summary.detail).toBe('You get about 0.0003 Bitcoin.');
    expect(kyber.prepareForWallet).toHaveBeenCalledWith(
      expect.objectContaining({ tokenIn: USDC, tokenOut: CIRBTC, amountInRaw: 25_000_000n, walletAddress: ME }),
    );
    expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({ id: r.preparedId, uid: UID, kind: 'buy' }));

    const page = trades.pageData(...(Object.values(linkOf(r.confirmUrl)) as [string, string]));
    expect(page.chain.chainId).toBe('0x13b2');
    expect(page.chain.nativeCurrency).toEqual({ name: 'USDC', symbol: 'USDC', decimals: 18 });
    expect(page.txs.map((t) => t.kind)).toEqual(['approve', 'swap']);
    const approve = decodeFunctionData({ abi: erc20Abi, data: page.txs[0]!.data });
    expect(approve.functionName).toBe('approve');
    expect([String(approve.args![0]).toLowerCase(), approve.args![1]]).toEqual([ROUTER, 25_000_000n]);
    expect(page.txs[0]!.to).toBe(USDC);
    expect(page.txs[1]).toEqual({ kind: 'swap', to: ROUTER, data: CALLDATA, value: '0x0' });
  });

  it('skips the approval when the wallet already allows the amount', async () => {
    const { trades } = setup({ allowance: 25_000_000n });
    const r = await trades.prepare(UID, { side: 'buy', mint: CIRBTC, amountUsd: 25 }, BASE);
    const { id, t } = linkOf(r.confirmUrl);
    expect(trades.pageData(id, t).txs.map((x) => x.kind)).toEqual(['swap']);
  });

  it('keeps USDC back for gas, and says how much there is', async () => {
    const { trades } = setup({ usdc: 25_010_000n });
    await expect(trades.prepare(UID, { side: 'buy', mint: CIRBTC, amountUsd: 25 }, BASE)).rejects.toThrow(BadRequestException);
  });

  it('asks a seller for a few cents of USDC for the network fee', async () => {
    const { trades } = setup({ usdc: 5_000n, btc: 50_000n });
    await expect(trades.prepare(UID, { side: 'sell', mint: CIRBTC, amountRaw: '30000' }, BASE)).rejects.toThrow(OWN_WALLET_COPY.gas);
  });

  it('is only for accounts that trade from their own wallet', async () => {
    const { trades } = setup();
    await expect(trades.prepare('firebase-uid-123', { side: 'buy', mint: CIRBTC, amountUsd: 5 }, BASE)).rejects.toThrow(ConflictException);
    const circle = setup({ env: { ARC_WALLET_ACCOUNTS: 'circle' } });
    await expect(circle.trades.prepare(UID, { side: 'buy', mint: CIRBTC, amountUsd: 5 }, BASE)).rejects.toThrow(ConflictException);
  });
});

describe('the confirm link', () => {
  it('opens nothing without its key', async () => {
    const { trades } = setup();
    const r = await trades.prepare(UID, { side: 'buy', mint: CIRBTC, amountUsd: 25 }, BASE);
    expect(() => trades.pageData(r.preparedId, 'wrong-key')).toThrow(ForbiddenException);
  });
});

describe('OwnWalletTrades.submit', () => {
  async function prepared(o: Parameters<typeof setup>[0] = {}) {
    const s = setup(o);
    const r = await s.trades.prepare(UID, { side: 'buy', mint: CIRBTC, amountUsd: 25 }, BASE);
    return { ...s, r, ...linkOf(r.confirmUrl) };
  }

  it('records the swap it built, with what the logs say arrived, and the poll reads it', async () => {
    const { trades, rows, r, id, t } = await prepared();
    const done = await trades.submit({ id, t, approveHash: APPROVE_HASH, swapHash: SWAP_HASH });

    expect(done).toEqual({ state: 'done', signature: SWAP_HASH, outAmountRaw: '30000' });
    const row = rows.get(r.preparedId);
    expect(row.status).toBe('confirmed');
    expect(row.legs.map((l: any) => [l.kind, l.status, l.txHash])).toEqual([
      ['approve', 'confirmed', APPROVE_HASH],
      ['swap', 'confirmed', SWAP_HASH],
    ]);
    expect(await trades.status(UID, r.preparedId)).toEqual(done);
    await expect(trades.status('evm:0x0000000000000000000000000000000000000001', r.preparedId)).rejects.toThrow(ForbiddenException);
  });

  it('refuses a transaction that is not the prepared swap', async () => {
    const { trades, getTransaction, id, t } = await prepared();
    getTransaction.mockResolvedValueOnce({ from: ME, to: ROUTER, input: '0xdeadbeef' as Address });
    await expect(trades.submit({ id, t, swapHash: SWAP_HASH })).rejects.toThrow(OWN_WALLET_COPY.notOurs);
  });

  it('marks a reverted swap failed', async () => {
    const { trades, chain, rows, r, id, t } = await prepared();
    chain.receipt.mockResolvedValueOnce({ status: 'reverted', gasUsed: 1n, effectiveGasPrice: 1n, logs: [] } as never);
    expect(await trades.submit({ id, t, swapHash: SWAP_HASH })).toEqual({ state: 'failed', error: OWN_WALLET_COPY.reverted });
    expect(rows.get(r.preparedId).status).toBe('failed');
  });

  it('says "still settling" when the receipt is late, without counting anything', async () => {
    const { trades, chain, rows, r, id, t } = await prepared();
    chain.receipt.mockRejectedValueOnce(new Error('timeout'));
    expect(await trades.submit({ id, t, swapHash: SWAP_HASH })).toMatchObject({ state: 'sending', signature: SWAP_HASH });
    expect(rows.get(r.preparedId).status).toBe('sent');
  });

  it('lets the extension cancel a trade nobody sent', async () => {
    const { trades, rows, r } = await prepared();
    expect(await trades.cancel({ uid: UID }, r.preparedId)).toEqual({ state: 'cancelled' });
    expect(rows.get(r.preparedId)).toMatchObject({ status: 'failed', error: 'cancelled' });
  });
});

describe('the confirm page', () => {
  it('is one script that parses, and posts the finish to the extension relay', () => {
    const html = confirmTradePage();
    const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('POPPIN_ARC_TRADE_DONE');
    expect(script).toContain('wallet_addEthereumChain');
    expect(script).not.toContain('\\\\');
  });
});
