import { type CanActivate, type ExecutionContext, type INestApplication, Logger, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig } from '../config';
import { ArcChain } from '../arc/chain';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CircleWallets } from '../circle/wallets';
import { MARKET, type AssetView, type SeriesPoint } from '../market/market.types';
import { ActionsStore } from '../trade/actions';
import { SWAP_ROUTERS, TradeService } from '../trade/trade.service';
import { TRADE_ERRORS, type Address, type Quote } from '../trade/types';
import { RouteQuotes } from '../routes/route-quotes';
import { remoteAssetOf } from '../routes/remote';
import { RemoteTokens, RemoteTokensWarming, type RemoteListing } from '../routes/remote-tokens';
import { AssetController, toSeriesWire } from './asset.controller';

const USDC = '0x3600000000000000000000000000000000000000' as Address;
const MEME = '0xacebfc5e00000000000000000000000000000001' as Address;
const MEME_MIXED = '0xAcEbFc5E00000000000000000000000000000001';
const STOCK = '0x5700000000000000000000000000000000000005' as Address;
const WALLET = '0xabcdef0000000000000000000000000000000009';
const HASH = `0x${'c'.repeat(64)}`;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;
const PEPE_MINT = 'remote:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933';

function farListing(ticker: string, mcapUsd: number, mint = PEPE_MINT): RemoteListing {
  const key = mint.slice('remote:'.length);
  const [chain, address] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  return {
    asset: { key, ticker, name: ticker === 'PEPE' ? 'Pepe' : ticker, chain: chain as 'ethereum', venue: 'kyber', address, decimals: 18 },
    mint,
    icon: 'https://coin-images.coingecko.com/coins/images/29850/small/pepe.png',
    priceUsd: 0.0000042,
    mcapUsd,
  };
}

/** Stands in for Firebase: "Bearer <uid>" signs in as <uid>, no header is a 401. */
class FakeAuth implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const h: string | undefined = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    req.user = { uid: h.slice(7), email: null, name: null, picture: null };
    return true;
  }
}

function view(address: Address, over: Partial<AssetView['token']> = {}): AssetView {
  return {
    token: { address, symbol: '$MEME', name: 'Meme Coin', decimals: 9, kind: 'long-tail', icon: 'https://img.example/m.png', restrictions: [], ...over },
    priceUsd: 0.5,
    change24hPct: -3.5,
    mcapUsd: 2_000_000,
    holderCount: 321,
    liquidityUsd: 55_000,
    poolCreatedAtMs: 1_758_000_000_000,
    spark24h: [0.4, 0.5],
  };
}

describe('AssetController over HTTP', () => {
  let app: INestApplication;
  let base: string;
  const balances = new Map<string, bigint>();
  // Assets on other chains are priced by the route service; here it answers one fixed route.
  const routes = {
    priceUsd: jest.fn(async () => 118.7),
    preview: jest.fn(async () => ({
      outAmount: 0.21,
      priceUsd: 118.7,
      priceImpactPct: 0,
      legs: [{ label: 'Arc to Solana, over CCTP' }, { label: 'USDC to SOL on Jupiter' }],
    })),
  };
  const market = {
    resolveTicker: jest.fn(async (): Promise<Address | null> => MEME_MIXED as Address),
    describe: jest.fn(async (a: Address): Promise<AssetView | null> => view(a)),
    gate: jest.fn(async (): Promise<{ ok: true } | { ok: false; reason: string }> => ({ ok: true })),
    prices: jest.fn(async (as: Address[]) => new Map(as.filter((a) => a === MEME).map((a) => [a, 0.5]))),
    series: jest.fn(async (): Promise<SeriesPoint[]> => []),
    icon: jest.fn(async (): Promise<{ contentType: string; bytes: Buffer } | null> => null),
    pinned: jest.fn(() => []),
  };
  const kyber = {
    venue: 'kyber' as const,
    supports: () => true,
    quote: jest.fn(
      async (r: { tokenIn: Address; tokenOut: Address; amountInRaw: bigint }): Promise<Quote> => ({
        venue: 'kyber',
        tokenIn: r.tokenIn,
        tokenOut: r.tokenOut,
        amountInRaw: r.amountInRaw,
        amountOutRaw: 20_000_000_000n,
        minAmountOutRaw: 19_000_000_000n,
        priceImpactPct: 1.2,
        route: ['Uniswap v4'],
      }),
    ),
    execute: jest.fn(async () => ({ venue: 'kyber' as const, txHash: HASH as Address, amountOutRaw: 1n, legs: [] })),
  };
  const chain = {
    balancesOf: jest.fn(async (_o: string, ts: string[]) => new Map(ts.map((t) => [t, balances.get(t) ?? 0n]))),
    receipt: jest.fn(async () => ({
      status: 'success',
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      logs: [{ address: MEME, topics: [TRANSFER, pad(USDC), pad(WALLET)], data: pad('0x4a817c800') }],
    })),
    client: { readContract: jest.fn(async () => 9) },
  };
  const rows = new Map<string, any>();
  const actions = {
    create: jest.fn(async (a: any) => {
      const row = { ...a, amountInRaw: String(a.amountInRaw), status: 'pending', legs: [], amountOutRaw: null, createdAt: new Date().toISOString() };
      rows.set(a.id, row);
      return { created: true, row };
    }),
    get: jest.fn(async (id: string) => rows.get(id) ?? null),
    update: jest.fn(async () => undefined),
    byTxHash: jest.fn(async () => null),
    listForUser: jest.fn(async () => []),
  };
  // Tokens on other chains: the hand-kept list as the real lookup reads it, and PEPE on Ethereum.
  const tokens = {
    byTicker: jest.fn(async (t: string): Promise<RemoteListing | null> => (t === 'PEPE' ? farListing('PEPE', 1.8e9) : null)),
    assetOf: jest.fn(async (mint: unknown): Promise<RemoteListing | null | undefined> => {
      if (typeof mint !== 'string' || !mint.startsWith('remote:')) return undefined;
      if (mint === PEPE_MINT) return farListing('PEPE', 1.8e9);
      const kept = remoteAssetOf(mint);
      return kept ? { asset: kept, mint, icon: null, priceUsd: null, mcapUsd: null } : null;
    }),
    icon: jest.fn(async (): Promise<{ contentType: string; bytes: Buffer } | null> => null),
  };
  const wallets = {
    find: jest.fn(async (uid: string) =>
      uid === 'nobody' ? null : { uid, blockchain: 'ARC-TESTNET', walletId: 'w-1', address: WALLET, accountType: 'SCA' },
    ),
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    const mod = await Test.createTestingModule({
      controllers: [AssetController],
      providers: [
        TradeService,
        { provide: APP_CONFIG, useValue: loadConfig({ ARC_NETWORK: 'testnet', CIRCLE_ACCOUNT_TYPE: 'SCA' }) },
        { provide: SWAP_ROUTERS, useValue: [kyber] },
        { provide: MARKET, useValue: market },
        { provide: ArcChain, useValue: chain },
        { provide: ActionsStore, useValue: actions },
        { provide: CircleWallets, useValue: wallets },
        { provide: RouteQuotes, useValue: routes },
        { provide: RemoteTokens, useValue: tokens },
      ],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue(new FakeAuth())
      .compile();
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    const svc = app.get(TradeService);
    svc.receiptWaitMs = 10;
    svc.confirmWaitMs = 10;
    svc.balanceRetryMs = 0;
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1/embed/asset`;
  });

  afterAll(async () => {
    await app.close();
  });

  const post = async (path: string, body: unknown, uid?: string) => {
    const res = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${uid}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  // ─── discovery ────────────────────────────────────────────────────────────

  it('x-strip-config is on with an empty kill list', async () => {
    const res = await fetch(`${base}/x-strip-config`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, disabledMints: [] });
  });

  it('by-ticker answers one lowercase mint, and null for junk, USDC and gate refusals', async () => {
    expect(await post('by-ticker', { ticker: '$meme' })).toEqual({ status: 200, body: { mint: MEME } });
    expect(market.resolveTicker).toHaveBeenLastCalledWith('MEME');

    market.resolveTicker.mockClear();
    expect((await post('by-ticker', { ticker: '$a' })).body).toEqual({ mint: null });
    expect((await post('by-ticker', {})).body).toEqual({ mint: null });
    expect(market.resolveTicker).not.toHaveBeenCalled();

    market.resolveTicker.mockResolvedValueOnce(USDC);
    expect((await post('by-ticker', { ticker: 'USDC' })).body).toEqual({ mint: null });

    market.gate.mockResolvedValueOnce({ ok: false, reason: 'thin' });
    expect((await post('by-ticker', { ticker: 'MEME' })).body).toEqual({ mint: null });

    market.resolveTicker.mockRejectedValueOnce(new Error('upstream'));
    expect((await post('by-ticker', { ticker: 'MEME' })).status).toBe(503);
  });

  it('by-ticker reaches a token on another chain when Arc has none', async () => {
    market.resolveTicker.mockResolvedValueOnce(null);
    expect((await post('by-ticker', { ticker: '$pepe' })).body).toEqual({ mint: PEPE_MINT });
    expect(tokens.byTicker).toHaveBeenLastCalledWith('PEPE');
  });

  it('an Arc long-tail token keeps its ticker, unless a far larger coin elsewhere owns it', async () => {
    tokens.byTicker.mockResolvedValueOnce(farListing('MEME', 10_000_000));
    expect((await post('by-ticker', { ticker: 'MEME' })).body).toEqual({ mint: MEME });
    tokens.byTicker.mockResolvedValueOnce(farListing('MEME', 2_000_000_000));
    expect((await post('by-ticker', { ticker: 'MEME' })).body).toEqual({ mint: PEPE_MINT });
  });

  it("Circle's assets and a major's canonical Arc contract never leave Arc", async () => {
    tokens.byTicker.mockClear();
    market.pinned.mockReturnValueOnce([{ address: MEME }] as never);
    expect((await post('by-ticker', { ticker: 'MEME' })).body).toEqual({ mint: MEME });
    // WIF is a major: an Arc contract answering to it is the canonical one.
    expect((await post('by-ticker', { ticker: 'WIF' })).body).toEqual({ mint: MEME });
    expect(tokens.byTicker).not.toHaveBeenCalled();
  });

  it("a stock's ticker never goes looking on other chains", async () => {
    tokens.byTicker.mockClear();
    market.resolveTicker.mockResolvedValueOnce(null);
    expect((await post('by-ticker', { ticker: 'NVDA' })).body).toEqual({ mint: null });
    expect(tokens.byTicker).not.toHaveBeenCalled();
  });

  it('a lookup still loading is a 503 only when nothing else could answer', async () => {
    market.resolveTicker.mockResolvedValueOnce(null);
    tokens.byTicker.mockRejectedValueOnce(new RemoteTokensWarming('loading'));
    expect((await post('by-ticker', { ticker: 'PEPE' })).status).toBe(503);
    tokens.byTicker.mockRejectedValueOnce(new RemoteTokensWarming('loading'));
    expect((await post('by-ticker', { ticker: 'MEME' })).body).toEqual({ mint: MEME });
  });

  it('by-mint describes a token on another chain with its logo and market cap, and refuses an unknown one', async () => {
    const { body } = await post('by-mint', { mint: PEPE_MINT });
    expect(body.asset).toMatchObject({
      mint: PEPE_MINT,
      symbol: 'PEPE',
      name: 'Pepe',
      certainty: 'inferred',
      indicativeUsd: 118.7,
      icon: 'https://coin-images.coingecko.com/coins/images/29850/small/pepe.png',
      mcap: 1.8e9,
      decimals: 18,
    });
    expect((await post('by-mint', { mint: 'remote:ethereum:0x000000000000000000000000000000000000dead' })).body).toEqual({ asset: null });
    expect((await post('by-mint', { mint: 'remote:sol' })).body.asset).toMatchObject({ mint: 'remote:sol', symbol: 'SOL' });
    tokens.assetOf.mockRejectedValueOnce(new RemoteTokensWarming('loading'));
    expect((await post('by-mint', { mint: PEPE_MINT })).status).toBe(503);
  });

  it('quotes a token on another chain through its route, and refuses a route to nowhere', async () => {
    expect((await post('quote', { mint: PEPE_MINT, amountUsd: 25 })).body).toMatchObject({ pricePerUnit: 118.7 });
    expect((await post('quote', { mint: 'remote:base:0x000000000000000000000000000000000000dead', amountUsd: 25 })).status).toBe(422);
  });

  it("asks the remote lookup for a remote token's logo, and a miss is a 404", async () => {
    const res = await fetch(`${base}/icon?mint=${PEPE_MINT}`);
    expect(res.status).toBe(404);
    expect(tokens.icon).toHaveBeenLastCalledWith(PEPE_MINT);
    tokens.icon.mockResolvedValueOnce({ contentType: 'image/png', bytes: Buffer.from([0x89, 0x50]) });
    const ok = await fetch(`${base}/icon?mint=${PEPE_MINT}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
  });

  it('by-mint answers the full MatchedAsset shape', async () => {
    const { status, body } = await post('by-mint', { mint: MEME_MIXED });
    expect(status).toBe(200);
    expect(body).toEqual({
      asset: {
        mint: MEME,
        symbol: 'MEME',
        name: 'Meme Coin',
        displayName: 'Meme Coin',
        confidence: 'confident',
        certainty: 'exact',
        score: Number.MAX_SAFE_INTEGER,
        change24hPct: -3.5,
        indicativeUsd: 0.5,
        icon: 'https://img.example/m.png',
        mcap: 2_000_000,
        holderCount: 321,
        spark24h: [0.4, 0.5],
        safety: { liquidityUsd: 55_000, poolCreatedAtMs: 1_758_000_000_000, mintAuthorityRetained: null, freezeAuthorityRetained: null },
        decimals: 9,
        issuer: null,
        restrictions: [],
        matchedDirect: [],
        matchedThematic: [],
      },
    });
  });

  it("by-mint carries a stock's restrictions, refuses by name, and never describes USDC", async () => {
    market.describe.mockResolvedValueOnce(view(STOCK, { symbol: 'CRCL', name: 'Circle Internet', kind: 'stock', restrictions: ['us-persons'] }));
    expect((await post('by-mint', { mint: STOCK })).body.asset.restrictions).toEqual(['us-persons']);

    market.gate.mockResolvedValueOnce({ ok: false, reason: 'no sell route' });
    expect((await post('by-mint', { mint: MEME })).body).toEqual({ asset: null, refused: { symbol: 'MEME', name: 'Meme Coin' } });

    market.describe.mockResolvedValueOnce(null);
    expect((await post('by-mint', { mint: MEME })).body).toEqual({ asset: null });

    expect((await post('by-mint', { mint: USDC })).body).toEqual({ asset: null });
    expect((await post('by-mint', { mint: 'not-a-mint' })).body).toEqual({ asset: null });

    market.describe.mockRejectedValueOnce(new Error('upstream'));
    expect((await post('by-mint', { mint: MEME })).status).toBe(503);
  });

  it('icon serves image bytes with a day of cache, 404 on a miss, 400 on a bad mint', async () => {
    market.icon.mockResolvedValueOnce({ contentType: 'image/png', bytes: Buffer.from([137, 80, 78, 71]) });
    const hit = await fetch(`${base}/icon?mint=${MEME_MIXED}`);
    expect(hit.status).toBe(200);
    expect(hit.headers.get('content-type')).toBe('image/png');
    expect(hit.headers.get('cache-control')).toBe('public, max-age=86400, immutable');
    expect(Buffer.from(await hit.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(market.icon).toHaveBeenLastCalledWith(MEME);

    expect((await fetch(`${base}/icon?mint=${MEME}`)).status).toBe(404);
    market.icon.mockResolvedValueOnce({ contentType: 'text/html', bytes: Buffer.from('<html>') });
    expect((await fetch(`${base}/icon?mint=${MEME}`)).status).toBe(404);

    const bad = await fetch(`${base}/icon?mint=nope`);
    expect(bad.status).toBe(400);
    expect(typeof ((await bad.json()) as any).message).toBe('string');
  });

  // ─── trading ──────────────────────────────────────────────────────────────

  it('quote needs no sign-in and answers UI units with a route array', async () => {
    expect(await post('quote', { mint: MEME, amountUsd: 10 })).toEqual({
      status: 200,
      body: { outAmount: 20, pricePerUnit: 0.5, priceImpactPct: 1.2, route: ['Uniswap v4'] },
    });
    expect(await post('quote', { mint: MEME, amountUsd: 0 })).toMatchObject({ status: 400, body: { message: TRADE_ERRORS.badBuy } });

    const get = await fetch(`${base}/quote?mint=${MEME}&amountUsd=10`);
    expect(await get.json()).toEqual({ mint: MEME, amountUsd: 10, outAmount: 20, pricePerUnit: 0.5, priceImpactPct: 1.2, route: ['Uniswap v4'] });
  });

  it('swap needs sign-in, then answers the SwapResponse shape', async () => {
    expect((await post('swap', { mint: MEME, amountUsd: 5 })).status).toBe(401);

    balances.set(USDC, 20_000_000n);
    const { status, body } = await post('swap', { mint: MEME, amountUsd: 5, payWith: 'SOL', idempotencyKey: 'p1' }, 'u1');
    expect(status).toBe(200);
    expect(body).toEqual({ signature: HASH, dryRun: false, category: 'memecoin', outAmountRaw: '20000000000', shareUrl: null });

    balances.set(USDC, 1_000_000n);
    expect(await post('swap', { mint: MEME, amountUsd: 5 }, 'u1')).toMatchObject({
      status: 400,
      body: { message: 'Insufficient USDC: wallet holds $1.00, needs $5.00' },
    });
  });

  it('sell needs sign-in and a raw integer', async () => {
    expect((await post('sell', { mint: MEME, amountRaw: '1' })).status).toBe(401);
    expect(await post('sell', { mint: MEME, amountRaw: '1.5' }, 'u1')).toMatchObject({ status: 400, body: { message: TRADE_ERRORS.badSell } });

    balances.set(MEME, 5n);
    chain.receipt.mockResolvedValueOnce({
      status: 'success',
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      logs: [{ address: USDC, topics: [TRANSFER, pad(MEME), pad(WALLET)], data: pad('0x2710') }],
    });
    expect(await post('sell', { mint: MEME, amountRaw: '5' }, 'u1')).toEqual({
      status: 200,
      body: { signature: HASH, dryRun: false, outUsdcRaw: '10000', shareUrl: null },
    });
  });

  it('confirm is public and answers one of three statuses', async () => {
    expect(await post('confirm', { signature: HASH })).toEqual({ status: 200, body: { status: 'confirmed' } });
    chain.receipt.mockRejectedValueOnce(new Error('timeout'));
    expect(await post('confirm', { signature: HASH }, 'u1')).toEqual({ status: 200, body: { status: 'unknown' } });
    expect(await post('confirm', {})).toMatchObject({ status: 400, body: { message: 'signature is required' } });
  });

  it('balance needs sign-in, answers USDC too, and zeros for a reader without a wallet', async () => {
    expect((await post('balance', { mint: USDC })).status).toBe(401);
    balances.set(USDC, 2_500_000n);
    expect(await post('balance', { mint: USDC }, 'u1')).toEqual({ status: 200, body: { uiAmount: 2.5, raw: '2500000', decimals: 6 } });
    expect((await post('balance', { mint: MEME }, 'nobody')).body).toEqual({ uiAmount: 0, raw: '0', decimals: 9 });
    expect(await post('balance', {}, 'u1')).toMatchObject({ status: 400, body: { message: 'mint is required' } });
  });

  // ─── book and charts ──────────────────────────────────────────────────────

  it('positions needs sign-in and answers the SpotPositionsResponse shape', async () => {
    expect((await post('positions', {})).status).toBe(401);
    balances.set(USDC, 3_000_000n);
    balances.set(MEME, 4_000_000_000n);
    market.pinned.mockReturnValueOnce([
      { address: MEME, symbol: 'MEME', name: 'Meme Coin', decimals: 9, kind: 'long-tail', icon: null, restrictions: [] },
    ] as never);
    const { status, body } = await post('positions', {}, 'u1');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      totalUsd: 2,
      totalPnlUsd: null,
      cashUsd: 3,
      solUsd: 0,
      positions: [
        {
          mint: MEME,
          ticker: '$MEME',
          uiAmount: 4,
          raw: '4000000000',
          decimals: 9,
          priceUsd: 0.5,
          valueUsd: 2,
          netInvestedUsd: null,
          pnlUsd: null,
        },
      ],
    });
  });

  it('series maps ranges, sends epoch milliseconds, and says failed only when upstream failed', async () => {
    market.series.mockResolvedValueOnce([
      { t: 100, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: 200, o: 1.5, h: 3, l: 1, c: 2.5, v: 10 },
    ]);
    const ok = await post('series', { mint: MEME_MIXED, range: '1w' });
    expect(ok.body).toEqual({ points: [1.5, 2.5], times: [100_000, 200_000], opens: [1, 1.5], highs: [2, 3], lows: [0.5, 1], failed: false });
    expect(market.series).toHaveBeenLastCalledWith(MEME, '1W');

    await post('series', { mint: MEME, range: 'forever' });
    expect(market.series).toHaveBeenLastCalledWith(MEME, '1D');
    await post('series', { mint: MEME, range: 'toString' });
    expect(market.series).toHaveBeenLastCalledWith(MEME, '1D');
    await post('series', { mint: MEME, range: 'max' });
    expect(market.series).toHaveBeenLastCalledWith(MEME, '1M');

    market.series.mockRejectedValueOnce(new Error('upstream'));
    expect((await post('series', { mint: MEME, range: '1d' })).body).toMatchObject({ points: null, failed: true });
    expect((await post('series', { mint: '', range: '1d' })).body).toMatchObject({ points: null, failed: false });
  });

  it('prices keys each answer by the string sent and leaves unknown mints out', async () => {
    const { status, body } = await post('prices', { mints: [MEME_MIXED, ` ${MEME} `, STOCK, 'junk'] });
    expect(status).toBe(200);
    expect(body).toEqual({
      prices: { [MEME_MIXED]: { usd: 0.5, change24hPct: null }, [MEME]: { usd: 0.5, change24hPct: null } },
    });
    expect(market.prices).toHaveBeenLastCalledWith([MEME, STOCK]);
  });

  it('tweet-proof answers zero buyers', async () => {
    expect(await post('tweet-proof', { url: 'https://x.com/a/status/1' })).toEqual({ status: 200, body: { buyers: 0 } });
  });
});

describe('toSeriesWire', () => {
  const at = (t: number, c: number): SeriesPoint => ({ t, o: c, h: c, l: c, c, v: 1 });

  it('cuts the short ranges from the longer series by time', () => {
    const now = 10_000_000;
    const pts = [at(now / 1000 - 3600, 1), at(now / 1000 - 600, 2), at(now / 1000 - 300, 3)];
    expect(toSeriesWire(pts, '15m', now).points).toEqual([2, 3]);
    expect(toSeriesWire(pts, '1h', now).points).toEqual([1, 2, 3]);
  });

  it('stamps the bucket in progress at now, so a fresh trade lands on the chart', () => {
    const w = toSeriesWire([at(1000, 1), at(1060, 2)], '1h', 1_080_000);
    expect(w.times).toEqual([1_000_000, 1_080_000]);
    const old = toSeriesWire([at(1000, 1), at(1060, 2)], '1h', 9_999_999);
    expect(old.times).toEqual([1_000_000, 1_060_000]);
  });

  it('is no chart, not a failure, below two points', () => {
    expect(toSeriesWire([at(1, 1)], '1d', 5_000)).toEqual({ points: null, times: null, opens: null, highs: null, lows: null, failed: false });
  });
});
