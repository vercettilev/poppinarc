import { HttpException, Logger } from '@nestjs/common';
import { loadConfig, type AppConfig } from '../config';
import { stableUuid } from '../circle/ids';
import type { AssetView, MarketPort } from '../market/market.types';
import type { ActionRow, ActionsStore } from './actions';
import { buildBook, walkLedger } from './positions';
import {
  GAS_RESERVE_USDC_RAW,
  SOLANA_USDC_MINT,
  TradeService,
  canonicalSourceUrl,
  receivedIn,
  uiForSentence,
  usdToRaw,
} from './trade.service';
import { TRADE_ERRORS, type Address, type ExecuteRequest, type Quote, type SwapRouter } from './types';

// ─── fixtures ───────────────────────────────────────────────────────────────

beforeAll(() => Logger.overrideLogger(false));

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC = '0x3600000000000000000000000000000000000000' as Address;
const EURC = '0x89b50855aa3be2f677cd6303cec089b5f319d72a' as Address; // testnet
const MEME = '0xacebfc5e00000000000000000000000000000001' as Address;
const OTHER = '0xbc43ce8d00000000000000000000000000000002' as Address;
const WALLET = '0xabcdef0000000000000000000000000000000009' as Address;
const POOL = '0x9999999999999999999999999999999999999999' as Address;
const HASH = `0x${'a'.repeat(64)}` as Address;
const HASH2 = `0x${'b'.repeat(64)}` as Address;

const topic = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
const transferLog = (token: string, from: string, to: string, amount: bigint) => ({
  address: token,
  topics: [TRANSFER, topic(from), topic(to)],
  data: `0x${amount.toString(16).padStart(64, '0')}`,
});
const receipt = (status: 'success' | 'reverted', logs: unknown[] = []) => ({
  status,
  logs,
  gasUsed: 200_000n,
  effectiveGasPrice: 20_000_000_000n,
});

class FakeActions {
  rows = new Map<string, ActionRow>();
  private tick = 0;

  async create(a: {
    id: string;
    uid: string;
    kind: ActionRow['kind'];
    tokenIn?: string | null;
    tokenOut?: string | null;
    amountInRaw?: bigint | null;
    usdValue?: number | null;
    sourceUrl?: string | null;
  }) {
    const existing = this.rows.get(a.id);
    if (existing) return { created: false, row: structuredClone(existing) };
    const at = new Date(Date.UTC(2026, 8, 28, 0, 0, this.tick++)).toISOString();
    const row: ActionRow = {
      id: a.id,
      uid: a.uid,
      kind: a.kind,
      status: 'pending',
      tokenIn: a.tokenIn ?? null,
      tokenOut: a.tokenOut ?? null,
      amountInRaw: a.amountInRaw?.toString() ?? null,
      amountOutRaw: null,
      usdValue: a.usdValue ?? null,
      sourceUrl: a.sourceUrl ?? null,
      legs: [],
      error: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.set(a.id, row);
    return { created: true, row: structuredClone(row) };
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async byTxHash(hash: string) {
    const h = hash.toLowerCase();
    return [...this.rows.values()].find((r) => r.legs.some((l) => l.txHash === h)) ?? null;
  }

  async update(id: string, patch: Partial<Pick<ActionRow, 'status' | 'legs' | 'error'>> & { amountOutRaw?: bigint | null }) {
    const r = this.rows.get(id);
    if (!r) return;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.legs !== undefined) r.legs = structuredClone(patch.legs);
    if (patch.error !== undefined) r.error = patch.error;
    if (patch.amountOutRaw !== undefined) r.amountOutRaw = patch.amountOutRaw?.toString() ?? null;
  }

  async listForUser(uid: string) {
    return [...this.rows.values()].filter((r) => r.uid === uid).reverse().map((r) => structuredClone(r));
  }

  /** Seed a finished trade straight into the ledger. */
  seed(r: Partial<ActionRow> & Pick<ActionRow, 'kind' | 'tokenIn' | 'tokenOut' | 'amountInRaw' | 'amountOutRaw'>) {
    const at = new Date(Date.UTC(2026, 8, 27, 0, 0, this.tick++)).toISOString();
    const id = r.id ?? `seed-${this.tick}`;
    this.rows.set(id, {
      id,
      uid: 'u1',
      status: 'confirmed',
      usdValue: null,
      sourceUrl: null,
      legs: [],
      error: null,
      createdAt: at,
      updatedAt: at,
      ...r,
    } as ActionRow);
  }
}

function router(venue: 'circle-swap' | 'kyber', supports: (a: Address, b: Address) => boolean) {
  return {
    venue,
    supports: jest.fn(supports),
    quote: jest.fn(
      async (req: { tokenIn: Address; tokenOut: Address; amountInRaw: bigint }): Promise<Quote> => ({
        venue,
        tokenIn: req.tokenIn,
        tokenOut: req.tokenOut,
        amountInRaw: req.amountInRaw,
        amountOutRaw: 2_500_000_000_000_000_000n,
        minAmountOutRaw: 2_400_000_000_000_000_000n,
        priceImpactPct: 0.84,
        route: venue === 'kyber' ? ['Uniswap v4'] : ['Circle'],
      }),
    ),
    execute: jest.fn(
      async (req: ExecuteRequest) =>
        ({ venue, txHash: HASH, amountOutRaw: 999n, legs: [] }) as Awaited<ReturnType<SwapRouter['execute']>>,
    ),
  };
}

function view(address: Address, over: Partial<AssetView['token']> = {}, priceUsd: number | null = 2): AssetView {
  return {
    token: {
      address,
      symbol: 'MEME',
      name: 'Meme Coin',
      decimals: 18,
      kind: 'long-tail',
      icon: null,
      restrictions: [],
      ...over,
    },
    priceUsd,
    change24hPct: 5.2,
    mcapUsd: 1_000_000,
    holderCount: 1200,
    liquidityUsd: 40_000,
    poolCreatedAtMs: 1_700_000_000_000,
    spark24h: [1, 2, 3],
  };
}

interface Setup {
  svc: TradeService;
  actions: FakeActions;
  chain: { balancesOf: jest.Mock; receipt: jest.Mock; client: { readContract: jest.Mock } };
  market: { [K in keyof MarketPort]: jest.Mock };
  wallets: { find: jest.Mock };
  circle: ReturnType<typeof router>;
  kyber: ReturnType<typeof router>;
  balances: Map<string, bigint>;
  config: AppConfig;
}

function setup(opts: { accountType?: 'EOA' | 'SCA'; wallet?: boolean } = {}): Setup {
  const config = loadConfig({ ARC_NETWORK: 'testnet', CIRCLE_ACCOUNT_TYPE: opts.accountType ?? 'SCA' });
  const circleSet = new Set<string>([USDC, EURC, lowerAddr(config.network.cirbtc.address)]);
  const circle = router('circle-swap', (a, b) => circleSet.has(a) && circleSet.has(b));
  const kyber = router('kyber', () => true);
  const balances = new Map<string, bigint>();
  const chain = {
    balancesOf: jest.fn(async (_owner: string, tokens: string[]) => new Map(tokens.map((t) => [t, balances.get(t) ?? 0n]))),
    receipt: jest.fn(async () =>
      receipt('success', [
        transferLog(MEME, POOL, WALLET, 123n),
        transferLog(USDC, POOL, WALLET, 4_560_000n),
        transferLog(EURC, POOL, WALLET, 4_500_000n),
      ]),
    ),
    client: { readContract: jest.fn(async () => 18) },
  };
  const market = {
    resolveTicker: jest.fn(async () => null),
    describe: jest.fn(async (a: Address) => view(a)),
    gate: jest.fn(async () => ({ ok: true as const })),
    prices: jest.fn(async (as: Address[]) => new Map(as.map((a) => [a, a === EURC ? 1.1 : 2]))),
    series: jest.fn(async () => []),
    icon: jest.fn(async () => null),
    pinned: jest.fn(() => []),
  };
  const wallets = {
    find: jest.fn(async () =>
      opts.wallet === false
        ? null
        : { uid: 'u1', blockchain: 'ARC-TESTNET', walletId: 'w-1', address: '0xABCDEF0000000000000000000000000000000009', accountType: 'SCA' },
    ),
  };
  const actions = new FakeActions();
  const svc = new TradeService(
    [circle, kyber] as unknown as SwapRouter[],
    market as unknown as MarketPort,
    chain as never,
    actions as unknown as ActionsStore,
    wallets as never,
    config,
  );
  svc.receiptWaitMs = 10;
  svc.confirmWaitMs = 10;
  svc.balanceRetryMs = 0;
  return { svc, actions, chain, market, wallets, circle, kyber, balances, config };
}

function lowerAddr(a: string): Address {
  return a.toLowerCase() as Address;
}

async function refusal(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) {
      const body = e.getResponse() as { message?: unknown } | string;
      return { status: e.getStatus(), message: typeof body === 'string' ? body : String(body.message) };
    }
    throw e;
  }
  throw new Error('expected a refusal');
}

// ─── amounts ────────────────────────────────────────────────────────────────

describe('usdToRaw', () => {
  it('rounds down through the decimal string, not float multiplication', () => {
    expect(usdToRaw(0.57)).toBe(570_000n); // 0.57 * 1e6 is 569999.99… in floating point
    expect(usdToRaw(10)).toBe(10_000_000n);
    expect(usdToRaw(1.2345678)).toBe(1_234_567n);
    expect(usdToRaw('25')).toBe(25_000_000n);
    expect(usdToRaw(0.0000004)).toBe(0n);
  });

  it('refuses what is not a positive finite amount', () => {
    for (const v of [0, -1, NaN, Infinity, '', 'abc', null, undefined, {}]) expect(usdToRaw(v)).toBeNull();
  });
});

describe('uiForSentence', () => {
  it('never lets the digits 401 into the sell sentence', () => {
    expect(uiForSentence(1_401_500_000n, 6)).toBe(1400);
    expect(uiForSentence(401_000n, 6)).toBe(0.4);
    expect(uiForSentence(4_010_000_000n, 6)).toBe(4000);
    expect(uiForSentence(12_500_000n, 6)).toBe(12.5);
    expect(TRADE_ERRORS.insufficientSell(uiForSentence(1_401_500_000n, 6))).not.toMatch(/401/);
  });
});

describe('canonicalSourceUrl', () => {
  it('keeps tweets and Reddit posts in one form and drops everything else', () => {
    expect(canonicalSourceUrl('https://twitter.com/alice/status/123/photo/1?s=20')).toBe('https://x.com/alice/status/123');
    expect(canonicalSourceUrl('https://www.reddit.com/r/arc/comments/Ab12cd/some_title/')).toBe(
      'https://www.reddit.com/r/arc/comments/ab12cd/',
    );
    expect(canonicalSourceUrl('https://example.com/alice/status/1')).toBeNull();
    expect(canonicalSourceUrl('http://x.com/alice/status/1')).toBeNull();
    expect(canonicalSourceUrl(42)).toBeNull();
  });
});

describe('receivedIn', () => {
  it('sums Transfer logs of one token into one wallet', () => {
    const logs = [
      transferLog(MEME, POOL, WALLET, 100n),
      transferLog(MEME, POOL, WALLET, 23n),
      transferLog(MEME, WALLET, POOL, 7n),
      transferLog(USDC, POOL, WALLET, 5n),
    ];
    expect(receivedIn(logs, MEME, WALLET)).toBe(123n);
    expect(receivedIn(logs, USDC, WALLET)).toBe(5n);
  });
});

// ─── buy ────────────────────────────────────────────────────────────────────

describe('TradeService.buy', () => {
  it('refuses a short wallet with the exact sentence the extension matches', async () => {
    const s = setup();
    s.balances.set(USDC, 3_456_789n);
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5 }));
    expect(r).toEqual({ status: 400, message: 'Insufficient USDC: wallet holds $3.45, needs $5.00' });
    expect(s.kyber.execute).not.toHaveBeenCalled();
    expect(s.actions.rows.size).toBe(0);
  });

  it('keeps a gas reserve back when the wallet pays its own gas', async () => {
    const s = setup({ accountType: 'EOA' });
    s.balances.set(USDC, 10_000_000n);
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 10 }));
    const spendable = Number(10_000_000n - GAS_RESERVE_USDC_RAW) / 1e6;
    expect(r.message).toBe(TRADE_ERRORS.insufficientUsdc(spendable, 10));
  });

  it('tells a reader with no wallet that the balance is short', async () => {
    const s = setup({ wallet: false });
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 2 }));
    expect(r).toEqual({ status: 400, message: 'Insufficient USDC: wallet holds $0.00, needs $2.00' });
  });

  it('refuses a missing amount, a dust amount and a bad mint as badBuy', async () => {
    const s = setup();
    for (const body of [
      { mint: MEME, amountUsd: 0 },
      { mint: MEME, amountUsd: 0.0000001 },
      { mint: MEME, amountUsd: 'ten' },
      { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amountUsd: 5 },
    ]) {
      expect(await refusal(s.svc.buy('u1', body))).toEqual({ status: 400, message: TRADE_ERRORS.badBuy });
    }
  });

  it('refuses what the gate refuses, with its reason', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.market.gate.mockResolvedValueOnce({ ok: false, reason: 'no sell route' });
    expect(await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5 }))).toEqual({
      status: 422,
      message: 'Mint failed the safety gate: no sell route',
    });
  });

  it('routes Circle pairs through circle-swap and everything else through the aggregator', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    await s.svc.buy('u1', { mint: EURC, amountUsd: 5 });
    expect(s.circle.execute).toHaveBeenCalledTimes(1);
    expect(s.kyber.execute).not.toHaveBeenCalled();

    await s.svc.buy('u1', { mint: MEME, amountUsd: 5 });
    expect(s.kyber.execute).toHaveBeenCalledTimes(1);
    expect(s.circle.supports).toHaveBeenCalledWith(USDC, MEME);
  });

  it('buys the rounded-down amount and answers with the filled amount from the receipt', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    const out = await s.svc.buy('u1', {
      mint: MEME.toUpperCase().replace('0X', '0x'),
      amountUsd: 0.57,
      sourceUrl: 'https://x.com/bob/status/77?s=1',
    });
    expect(out).toEqual({ signature: HASH, dryRun: false, category: 'memecoin', outAmountRaw: '123', shareUrl: null });

    const req = s.kyber.execute.mock.calls[0][0] as ExecuteRequest;
    expect(req).toMatchObject({ tokenIn: USDC, tokenOut: MEME, amountInRaw: 570_000n, walletId: 'w-1', walletAddress: WALLET });
    const row = [...s.actions.rows.values()][0];
    expect(row).toMatchObject({ status: 'confirmed', amountOutRaw: '123', sourceUrl: 'https://x.com/bob/status/77' });
    expect(row.legs).toEqual([
      expect.objectContaining({ kind: 'swap', status: 'confirmed', txHash: HASH, gasUsdcRaw: '4000' }),
    ]);
  });

  it('replays a finished trade for the same key and never sends it twice', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    const first = await s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'press-1' });
    s.balances.set(USDC, 0n); // spent: a replay must not re-check the balance
    const again = await s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: ' press-1 ' });
    expect(again).toEqual(first);
    expect(s.kyber.execute).toHaveBeenCalledTimes(1);
    expect(s.actions.rows.has(stableUuid('trade', 'u1', 'press-1'))).toBe(true);
    // Every Circle key the router derives hangs off this action id.
    expect((s.kyber.execute.mock.calls[0][0] as ExecuteRequest).actionId).toBe(stableUuid('trade', 'u1', 'press-1'));
  });

  it('answers 409 for a key that is in flight or reused for a different trade', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    await s.actions.create({ id: stableUuid('trade', 'u1', 'k'), uid: 'u1', kind: 'buy', tokenIn: USDC, tokenOut: MEME, amountInRaw: 5_000_000n });
    expect(await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' }))).toEqual({
      status: 409,
      message: TRADE_ERRORS.idempotencyConflict,
    });

    await s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k2' });
    expect((await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 6, idempotencyKey: 'k2' }))).status).toBe(409);
    expect((await refusal(s.svc.sell('u1', { mint: MEME, amountRaw: '1', idempotencyKey: 'k2' }))).status).toBe(409);
  });

  it('takes back a key that failed before anything reached the chain', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.kyber.execute.mockRejectedValueOnce(new Error('upstream 500'));
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' }));
    expect(r.status).toBe(422);
    const out = await s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' });
    expect(out.signature).toBe(HASH);
    const ids = s.kyber.execute.mock.calls.map((c) => (c[0] as ExecuteRequest).actionId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('turns a router minimum-output failure into a slippage sentence, never "insufficient"', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.kyber.execute.mockRejectedValueOnce(new Error('execution reverted: UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT'));
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5 }));
    expect(r.status).toBe(422);
    expect(r.message).toMatch(/slippage/);
    expect(r.message).not.toMatch(/insufficient/i);
  });

  it('reports a reverted swap as failed on chain and records it', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.chain.receipt.mockResolvedValueOnce(receipt('reverted'));
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5 }));
    expect(r).toEqual({ status: 400, message: 'Swap failed on chain: the transaction was reverted' });
    expect([...s.actions.rows.values()][0]).toMatchObject({ status: 'failed' });
  });

  it('answers with the signature when the receipt is slow, and leaves the row sent', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.chain.receipt.mockRejectedValueOnce(new Error('Timed out while waiting for transaction'));
    s.kyber.execute.mockResolvedValueOnce({ venue: 'kyber', txHash: HASH2.toUpperCase().replace('0X', '0x') as Address, amountOutRaw: 999n, legs: [] });
    const out = await s.svc.buy('u1', { mint: MEME, amountUsd: 5 });
    expect(out.signature).toBe(HASH2);
    expect(out.outAmountRaw).toBe('999');
    expect([...s.actions.rows.values()][0]).toMatchObject({ status: 'sent' });
  });

  it('still answers the signature when the ledger write fails after the trade landed', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    const update = jest.spyOn(s.actions, 'update');
    update.mockRejectedValue(new Error('db down'));
    const out = await s.svc.buy('u1', { mint: MEME, amountUsd: 5 });
    expect(out.signature).toBe(HASH);
  });
});

// ─── what routers hand back ─────────────────────────────────────────────────

/** Shaped like circle-swap's SwapNotCompleted: an HttpException carrying legs and a send state. */
class NotCompleted extends HttpException {
  constructor(
    status: number,
    message: string,
    readonly legs: unknown[],
    readonly sendState: string,
  ) {
    super(message, status);
  }
}

describe('TradeService with router outcomes', () => {
  it('answers the signature when the router says sent but not yet mined', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    const pending = Object.assign(new Error('Swap sent, confirmation still pending'), {
      txHash: HASH2,
      legs: [{ kind: 'swap', status: 'sent', chain: 'ARC-TESTNET', txHash: HASH2 }],
    });
    s.kyber.execute.mockRejectedValueOnce(pending);
    s.chain.receipt.mockRejectedValueOnce(new Error('timeout'));
    const out = await s.svc.buy('u1', { mint: MEME, amountUsd: 5 });
    expect(out.signature).toBe(HASH2);
    expect([...s.actions.rows.values()][0]).toMatchObject({ status: 'sent' });
  });

  it('persists the pending leg circle-swap reports before it sends, and its late outcome', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    let late: ((legs: unknown[], ex: unknown) => Promise<void>) | undefined;
    s.circle.execute.mockImplementationOnce((async (req: ExecuteRequest, hooks: any) => {
      await hooks.beforeSend([{ kind: 'swap', status: 'pending', chain: 'ARC-TESTNET' }]);
      const row = s.actions.rows.get(req.actionId)!;
      expect(row.legs).toEqual([{ kind: 'swap', status: 'pending', chain: 'ARC-TESTNET' }]);
      late = hooks.onLate;
      throw new NotCompleted(409, TRADE_ERRORS.idempotencyConflict, [{ kind: 'swap', status: 'pending', chain: 'ARC-TESTNET' }], 'maybe-sent');
    }) as never);
    const r = await refusal(s.svc.buy('u1', { mint: EURC, amountUsd: 5, idempotencyKey: 'k' }));
    // Not "did not go through": the swap may have left, and a new press would buy twice.
    expect(r.status).toBe(504);
    expect(r.message).toMatch(/Check your balance/);
    const id = stableUuid('trade', 'u1', 'k');
    expect(s.actions.rows.get(id)).toMatchObject({ status: 'pending' });
    expect((await refusal(s.svc.buy('u1', { mint: EURC, amountUsd: 5, idempotencyKey: 'k' }))).status).toBe(409);

    await late!([{ kind: 'swap', status: 'confirmed', chain: 'ARC-TESTNET', txHash: HASH }], {
      venue: 'circle-swap',
      txHash: HASH,
      amountOutRaw: 4_500_000n,
      legs: [],
    });
    expect(s.actions.rows.get(id)).toMatchObject({ status: 'confirmed', amountOutRaw: '4500000' });
  });

  it('passes a pre-send refusal through, records its legs, and lets the same key try again', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.circle.execute.mockRejectedValueOnce(
      new NotCompleted(422, TRADE_ERRORS.quoteUnavailable, [{ kind: 'swap', status: 'failed', chain: 'ARC-TESTNET', error: 'refused' }], 'not-sent'),
    );
    expect(await refusal(s.svc.buy('u1', { mint: EURC, amountUsd: 5, idempotencyKey: 'k' }))).toEqual({
      status: 422,
      message: TRADE_ERRORS.quoteUnavailable,
    });
    const id = stableUuid('trade', 'u1', 'k');
    expect(s.actions.rows.get(id)).toMatchObject({ status: 'failed', legs: [expect.objectContaining({ status: 'failed' })] });
    const out = await s.svc.buy('u1', { mint: EURC, amountUsd: 5, idempotencyKey: 'k' });
    expect(out.signature).toBe(HASH);
  });

  it('refuses the same key again once a swap leg without a hash was left in flight', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.kyber.execute.mockImplementationOnce(async (req: ExecuteRequest) => {
      // The aggregator writes its own legs, then Circle's call fails.
      await s.actions.update(req.actionId, { legs: [{ kind: 'swap', status: 'pending', chain: 'ARC-TESTNET' }] });
      throw new Error('socket hang up');
    });
    expect((await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' }))).status).toBe(504);
    expect((await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' }))).status).toBe(409);
    expect(s.kyber.execute).toHaveBeenCalledTimes(1);
  });
});

// ─── the trade budget ───────────────────────────────────────────────────────

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

describe('TradeService trade budget', () => {
  it('answers "check your balance" in time when the router never returns, and records its late fill', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.svc.tradeBudgetMs = 80;
    s.svc.minExecuteMs = 0;
    const late = deferred<Awaited<ReturnType<SwapRouter['execute']>>>();
    s.kyber.execute.mockImplementationOnce(() => late.promise);

    const t0 = Date.now();
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' }));
    expect(Date.now() - t0).toBeLessThan(1_000);
    // Never "did not go through": the swap may still land, and the next press has a new key.
    expect(r).toEqual({ status: 504, message: 'That trade is taking longer than usual. Check your balance before pressing again.' });
    const id = stableUuid('trade', 'u1', 'k');
    expect(s.actions.rows.get(id)).toMatchObject({ status: 'pending' });
    expect((await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' }))).status).toBe(409);
    expect(s.kyber.execute).toHaveBeenCalledTimes(1);

    late.resolve({ venue: 'kyber', txHash: HASH, amountOutRaw: 999n, legs: [] });
    await flush();
    expect(s.actions.rows.get(id)).toMatchObject({ status: 'confirmed', amountOutRaw: '123' });
    // Now the key replays the landed trade instead of refusing it.
    expect(await s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' })).toMatchObject({ signature: HASH, outAmountRaw: '123' });
  });

  it('records a late failure the same way a failure in time is recorded', async () => {
    const s = setup();
    s.balances.set(MEME, 10n);
    s.svc.tradeBudgetMs = 80;
    s.svc.minExecuteMs = 0;
    const late = deferred<Awaited<ReturnType<SwapRouter['execute']>>>();
    s.kyber.execute.mockImplementationOnce(() => late.promise);
    expect((await refusal(s.svc.sell('u1', { mint: MEME, amountRaw: '10', idempotencyKey: 'k' }))).status).toBe(504);

    late.reject(new Error('upstream 500'));
    await flush();
    const id = stableUuid('trade', 'u1', 'k');
    expect(s.actions.rows.get(id)).toMatchObject({ status: 'failed', error: 'upstream 500' });
  });

  it('refuses before sending, with nothing charged, when the budget is spent before the router is called', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.svc.tradeBudgetMs = 1;
    expect(await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' }))).toEqual({
      status: 503,
      message: 'Trading is unavailable for a moment. Nothing was charged.',
    });
    expect(s.kyber.execute).not.toHaveBeenCalled();
    s.svc.tradeBudgetMs = 70_000;
    expect((await s.svc.buy('u1', { mint: MEME, amountUsd: 5, idempotencyKey: 'k' })).signature).toBe(HASH);
  });
});

// ─── a successful receipt is not a fill ─────────────────────────────────────

describe('TradeService fill check', () => {
  it('fails a buy whose receipt succeeded but delivered nothing, and /confirm agrees', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    // A Gas Station bundle whose inner call failed: status success, no Transfer to the wallet.
    s.chain.receipt.mockResolvedValue(receipt('success', [transferLog(USDC, WALLET, POOL, 5_000_000n)]));
    s.kyber.execute.mockResolvedValueOnce({ venue: 'kyber', txHash: HASH, amountOutRaw: 999n, legs: [] });
    const r = await refusal(s.svc.buy('u1', { mint: MEME, amountUsd: 5 }));
    expect(r).toEqual({ status: 400, message: 'Swap failed on chain: the transaction was reverted' });
    const row = [...s.actions.rows.values()][0];
    expect(row).toMatchObject({ status: 'failed', error: 'nothing arrived' });
    expect(row.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'failed', error: 'nothing arrived', txHash: HASH })]);

    expect(await s.svc.confirm(HASH)).toEqual({ status: 'failed', chainError: 'the transaction was reverted' });
    expect(s.actions.rows.get(row.id)).toMatchObject({ status: 'failed' });
  });

  it('uses the sell wording for a sell that delivered no USDC', async () => {
    const s = setup();
    s.balances.set(MEME, 10n);
    s.chain.receipt.mockResolvedValueOnce(receipt('success', []));
    expect((await refusal(s.svc.sell('u1', { mint: MEME, amountRaw: '10' }))).message).toBe(
      'Sell failed on chain: the transaction was reverted',
    );
  });

  it('checks a late circle-swap success for its fill too', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    let late: ((legs: unknown[], ex: unknown) => Promise<void>) | undefined;
    s.circle.execute.mockImplementationOnce((async (_req: ExecuteRequest, hooks: any) => {
      late = hooks.onLate;
      throw new NotCompleted(409, TRADE_ERRORS.idempotencyConflict, [{ kind: 'swap', status: 'pending', chain: 'ARC-TESTNET' }], 'maybe-sent');
    }) as never);
    expect((await refusal(s.svc.buy('u1', { mint: EURC, amountUsd: 5, idempotencyKey: 'k' }))).status).toBe(504);

    s.chain.receipt.mockResolvedValueOnce(receipt('success', []));
    await late!([{ kind: 'swap', status: 'confirmed', chain: 'ARC-TESTNET', txHash: HASH }], {
      venue: 'circle-swap',
      txHash: HASH,
      amountOutRaw: 4_500_000n,
      legs: [],
    });
    expect(s.actions.rows.get(stableUuid('trade', 'u1', 'k'))).toMatchObject({ status: 'failed', error: 'nothing arrived' });
  });
});

// ─── sell ───────────────────────────────────────────────────────────────────

describe('TradeService.sell', () => {
  it('refuses anything but a positive decimal integer as badSell', async () => {
    const s = setup();
    for (const amountRaw of ['1.5', '0x10', '0', '-1', '', 1.5, '1e18']) {
      expect(await refusal(s.svc.sell('u1', { mint: MEME, amountRaw }))).toEqual({ status: 400, message: TRADE_ERRORS.badSell });
    }
  });

  it('refuses a sell larger than the holding, in UI units', async () => {
    const s = setup();
    s.balances.set(MEME, 1_500_000_000_000_000_000n);
    const r = await refusal(s.svc.sell('u1', { mint: MEME, amountRaw: '2000000000000000000' }));
    expect(r).toEqual({ status: 400, message: 'Insufficient balance: wallet holds 1.5, sell asked for more' });
  });

  it('sells to USDC without asking the gate and reports the USDC that arrived', async () => {
    const s = setup();
    s.balances.set(MEME, 2_000_000_000_000_000_000n);
    s.market.gate.mockResolvedValue({ ok: false, reason: 'thin' });
    const out = await s.svc.sell('u1', { mint: MEME, amountRaw: '2000000000000000000' });
    expect(out).toEqual({ signature: HASH, dryRun: false, outUsdcRaw: '4560000', shareUrl: null });
    expect(s.market.gate).not.toHaveBeenCalled();
    expect(s.kyber.execute.mock.calls[0][0]).toMatchObject({ tokenIn: MEME, tokenOut: USDC });
  });

  it('uses the sell wording when the chain reverts', async () => {
    const s = setup();
    s.balances.set(MEME, 10n);
    s.chain.receipt.mockResolvedValueOnce(receipt('reverted'));
    expect((await refusal(s.svc.sell('u1', { mint: MEME, amountRaw: '10' }))).message).toBe(
      'Sell failed on chain: the transaction was reverted',
    );
  });
});

// ─── confirm ────────────────────────────────────────────────────────────────

describe('TradeService.confirm', () => {
  it('maps receipts to confirmed, failed and unknown', async () => {
    const s = setup();
    expect(await s.svc.confirm(HASH)).toEqual({ status: 'confirmed' });
    s.chain.receipt.mockResolvedValueOnce(receipt('reverted'));
    expect(await s.svc.confirm(HASH)).toMatchObject({ status: 'failed' });
    s.chain.receipt.mockRejectedValueOnce(new Error('timeout'));
    expect(await s.svc.confirm(HASH)).toEqual({ status: 'unknown' });
    expect((await refusal(s.svc.confirm(''))).status).toBe(400);
  });

  it('settles a sent ledger row with the filled amount', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.chain.receipt.mockRejectedValueOnce(new Error('timeout'));
    await s.svc.buy('u1', { mint: MEME, amountUsd: 5 });
    await s.svc.confirm(HASH.toUpperCase().replace('0X', '0x'));
    expect([...s.actions.rows.values()][0]).toMatchObject({ status: 'confirmed', amountOutRaw: '123' });
  });

  it('answers failed for a sent trade whose success receipt delivered nothing, and settles the row', async () => {
    const s = setup();
    s.balances.set(USDC, 50_000_000n);
    s.chain.receipt.mockRejectedValueOnce(new Error('timeout'));
    const out = await s.svc.buy('u1', { mint: MEME, amountUsd: 5 });
    s.chain.receipt.mockResolvedValueOnce(receipt('success', []));
    expect(await s.svc.confirm(out.signature)).toEqual({ status: 'failed', chainError: 'the transaction was reverted' });
    expect([...s.actions.rows.values()][0]).toMatchObject({ status: 'failed', error: 'nothing arrived' });
  });

  it('says unknown, not confirmed, when the ledger cannot be read to check the fill', async () => {
    const s = setup();
    jest.spyOn(s.actions, 'byTxHash').mockRejectedValueOnce(new Error('db down'));
    expect(await s.svc.confirm(HASH)).toEqual({ status: 'unknown' });
  });

  it('leaves other kinds of action alone', async () => {
    const s = setup();
    s.actions.seed({ id: 'dep', kind: 'deposit', status: 'sent', tokenIn: null, tokenOut: USDC, amountInRaw: '1', amountOutRaw: null, legs: [{ kind: 'mint', status: 'sent', chain: 'ARC-TESTNET', txHash: HASH }] });
    expect(await s.svc.confirm(HASH)).toEqual({ status: 'confirmed' });
    expect(s.actions.rows.get('dep')).toMatchObject({ status: 'sent' });
  });
});

// ─── quote and balance ──────────────────────────────────────────────────────

describe('TradeService.quote', () => {
  it('answers UI units, a finite impact and a route that is never empty', async () => {
    const s = setup();
    const q = await s.svc.quote(MEME, 5);
    expect(q).toEqual({ outAmount: 2.5, pricePerUnit: 2, priceImpactPct: 0.84, route: ['Uniswap v4'] });

    s.kyber.quote.mockResolvedValueOnce({ ...(await s.kyber.quote({ tokenIn: USDC, tokenOut: MEME, amountInRaw: 1n })), route: [], priceImpactPct: NaN });
    const q2 = await s.svc.quote(MEME, 5);
    expect(q2.route).toEqual(['KyberSwap']);
    expect(q2.priceImpactPct).toBe(0);
  });

  it('turns an upstream rate limit into the extension sentence', async () => {
    const s = setup();
    s.kyber.quote.mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'));
    expect(await refusal(s.svc.quote(MEME, 5))).toEqual({ status: 422, message: TRADE_ERRORS.rateLimited });
  });
});

describe('TradeService.balance', () => {
  it('reports spendable USDC, also under the old Solana USDC mint', async () => {
    const s = setup({ accountType: 'EOA' });
    s.balances.set(USDC, 10_000_000n);
    const want = { uiAmount: 9.95, raw: String(10_000_000n - GAS_RESERVE_USDC_RAW), decimals: 6 };
    expect(await s.svc.balance('u1', USDC)).toEqual(want);
    expect(await s.svc.balance('u1', SOLANA_USDC_MINT)).toEqual(want);
  });

  it('answers zeros, not an error, when the chain cannot be read', async () => {
    const s = setup();
    s.chain.balancesOf.mockRejectedValue(new Error('rpc down'));
    expect(await s.svc.balance('u1', MEME)).toEqual({ uiAmount: 0, raw: '0', decimals: null });
  });
});

// ─── positions ──────────────────────────────────────────────────────────────

describe('TradeService.positions', () => {
  it('is an empty book for a reader without a wallet', async () => {
    const s = setup({ wallet: false });
    expect(await s.svc.positions('u1')).toEqual({
      positions: [],
      totalUsd: 0,
      totalPnlUsd: null,
      totalUnrealizedPnlUsd: null,
      totalRealizedPnlUsd: null,
      cashUsd: 0,
      solUsd: 0,
    });
  });

  it('builds rows from the chain, cost from the ledger, and cash from USDC alone', async () => {
    const s = setup();
    const E18 = 10n ** 18n;
    // Two buys of MEME: 10 tokens for $10, then 10 more for $30, avg $2.
    s.actions.seed({ kind: 'buy', tokenIn: USDC, tokenOut: MEME, amountInRaw: '10000000', amountOutRaw: String(10n * E18), sourceUrl: 'https://x.com/a/status/1' });
    s.actions.seed({ kind: 'buy', tokenIn: USDC, tokenOut: MEME, amountInRaw: '30000000', amountOutRaw: String(10n * E18) });
    // Sell 5 for $15: realized 15 - 5*2 = 5.
    s.actions.seed({ kind: 'sell', tokenIn: MEME, tokenOut: USDC, amountInRaw: String(5n * E18), amountOutRaw: '15000000' });
    // A failed buy moved nothing.
    s.actions.seed({ kind: 'buy', status: 'failed', tokenIn: USDC, tokenOut: MEME, amountInRaw: '99000000', amountOutRaw: String(99n * E18) });
    // OTHER: bought for $4, sold for $6, fully exited.
    s.actions.seed({ kind: 'buy', tokenIn: USDC, tokenOut: OTHER, amountInRaw: '4000000', amountOutRaw: '1000' });
    s.actions.seed({ kind: 'sell', tokenIn: OTHER, tokenOut: USDC, amountInRaw: '1000', amountOutRaw: '6000000' });
    // EURC bought through the chip: 4.5 for $5. It is a position, not cash.
    s.actions.seed({ kind: 'buy', tokenIn: USDC, tokenOut: EURC, amountInRaw: '5000000', amountOutRaw: '4500000' });

    s.balances.set(USDC, 7_250_000n);
    s.balances.set(EURC, 10_000_000n);
    s.balances.set(MEME, 15n * E18);
    s.market.prices.mockImplementation(async (as: Address[]) => new Map(as.map((a) => [a, a === EURC ? 1.1 : 3])));
    s.market.describe.mockImplementation(async (a: Address) =>
      a === EURC ? view(EURC, { symbol: 'EURC', name: 'Euro Coin', decimals: 6, kind: 'cash' }, 1.1) : view(a),
    );

    const book = await s.svc.positions('u1');
    // The Max buy is sized from cashUsd, and /swap spends only USDC.
    expect(book.cashUsd).toBe(7.25);
    expect(book.positions.map((x) => x.mint)).toEqual([MEME, EURC]);
    const p = book.positions[0];
    expect(p).toMatchObject({
      mint: MEME,
      ticker: 'MEME',
      displayName: 'Meme Coin',
      category: 'crypto',
      uiAmount: 15,
      raw: String(15n * E18),
      decimals: 18,
      priceUsd: 3,
      valueUsd: 45,
      change24hPct: 5.2,
      netInvestedUsd: 25,
      pnlUsd: 20,
      avgEntryPriceUsd: 2,
      realizedPnlUsd: 5,
      unrealizedPnlUsd: 15,
      callerSourceUrl: 'https://x.com/a/status/1',
      entryMcapUsd: null,
    });
    const e = book.positions[1];
    expect(e).toMatchObject({ mint: EURC, ticker: 'EURC', displayName: 'Euro Coin', category: 'crypto', uiAmount: 10, decimals: 6, netInvestedUsd: 5 });
    expect(e.valueUsd).toBeCloseTo(11, 9);
    expect(e.pnlUsd).toBeCloseTo(6, 9);
    expect(e.unrealizedPnlUsd).toBeCloseTo((1.1 - 5 / 4.5) * 4.5, 9);

    expect(book.totalUsd).toBeCloseTo(45 + 11, 9);
    expect(book.totalPnlUsd).toBeCloseTo(20 + 6 + 2, 9); // MEME, EURC, and 2 from exited OTHER
    expect(book.totalRealizedPnlUsd).toBe(7);
    expect(book.totalUnrealizedPnlUsd).toBeCloseTo(15 + (1.1 - 5 / 4.5) * 4.5, 9);
    expect(book.positions.some((x) => x.mint === USDC)).toBe(false);
  });

  it('says zero cash for a reader who holds only EURC, and shows the EURC as a row', async () => {
    const s = setup();
    s.balances.set(EURC, 10_000_000n);
    const book = await s.svc.positions('u1');
    expect(book.cashUsd).toBe(0);
    expect(book.positions).toEqual([expect.objectContaining({ mint: EURC, uiAmount: 10, priceUsd: 1.1 })]);
  });

  it('is a 503, not an empty book, when the chain cannot be read', async () => {
    const s = setup();
    s.chain.balancesOf.mockRejectedValue(new Error('rpc down'));
    expect((await refusal(s.svc.positions('u1'))).status).toBe(503);
  });
});

describe('buildBook', () => {
  it('sorts by value with unpriced rows last and names the unnamed with a trailing ellipsis', () => {
    const book = buildBook(
      [
        { address: MEME, raw: 10n, decimals: 0, symbol: null, name: null, kind: null, priceUsd: null, change24hPct: null },
        { address: OTHER, raw: 10n, decimals: 0, symbol: 'OTH', name: 'Other', kind: 'stock', priceUsd: 1, change24hPct: null },
      ],
      walkLedger([], USDC),
      0,
      new Set([USDC]),
    );
    expect(book.positions.map((p) => p.mint)).toEqual([OTHER, MEME]);
    expect(book.positions[1]).toMatchObject({ ticker: '0xaceb…', valueUsd: null, netInvestedUsd: null, pnlUsd: null });
    expect(book.positions[0].category).toBe('equity');
  });

  it('gives up on average cost after an oversell instead of guessing', () => {
    const rows = [
      { kind: 'buy', tokenIn: USDC, tokenOut: MEME, amountInRaw: '1000000', amountOutRaw: '10' },
      { kind: 'sell', tokenIn: MEME, tokenOut: USDC, amountInRaw: '20', amountOutRaw: '3000000' },
    ].map((r, i) => ({
      ...r,
      id: String(i),
      uid: 'u1',
      status: 'confirmed',
      usdValue: null,
      sourceUrl: null,
      legs: [],
      error: null,
      createdAt: new Date(1_000 + i).toISOString(),
      updatedAt: new Date(1_000 + i).toISOString(),
    })) as ActionRow[];
    const b = walkLedger(rows, USDC).get(MEME)!;
    expect(b.broken).toBe(true);
    expect(b.netInvestedUsd).toBe(-2);
  });
});
