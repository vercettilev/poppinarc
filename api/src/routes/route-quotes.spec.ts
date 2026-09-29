import { Logger, UnprocessableEntityException } from '@nestjs/common';
import { remoteAssetByTicker, remoteAssetOf, remoteMint, REMOTE_ASSETS } from './remote';
import { RouteQuotes } from './route-quotes';

beforeAll(() => Logger.overrideLogger(false));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each venue the way it answered live on 2026-09-29. */
function venues(over: Partial<Record<'iris' | 'jup' | 'kyber' | 'hl', unknown>> = {}) {
  return jest.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('iris-api.circle.com')) return json(over.iris ?? [{ finalityThreshold: 1000, minimumFee: 0 }, { finalityThreshold: 2000, minimumFee: 0 }]);
    if (url.includes('lite-api.jup.ag'))
      return json(over.jup ?? { outAmount: '210536304', priceImpactPct: '0', swapUsdValue: '24.9977', routePlan: [{ swapInfo: { label: 'Kipseli' } }] });
    if (url.includes('aggregator-api.kyberswap.com'))
      return json(over.kyber ?? { code: 0, data: { routeSummary: { amountOut: '31000000000000000000', amountOutUsd: '24.95', gasUsd: '0.0089', route: [[{ exchange: 'aerodrome' }]] } } });
    if (url.includes('api.hyperliquid.xyz')) return json(over.hl ?? { HYPE: '86.0925', BTC: '83521.5' });
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
}

function setup(fetchFn: typeof fetch) {
  const r = new RouteQuotes();
  r.fetchFn = fetchFn;
  return r;
}

const asset = (key: string) => REMOTE_ASSETS.find((a) => a.key === key)!;

describe('remote assets', () => {
  it('are named remote:<key>, and found by ticker with or without the $', () => {
    expect(remoteMint('sol')).toBe('remote:sol');
    expect(remoteAssetOf('remote:hype')?.chain).toBe('hyperliquid');
    expect(remoteAssetOf('0x3600000000000000000000000000000000000000')).toBeNull();
    expect(remoteAssetByTicker('$link')?.key).toBe('link');
    expect(remoteAssetByTicker('BTC')).toBeNull();
  });
});

describe('RouteQuotes', () => {
  it("prices Arc to Solana over CCTP, then Jupiter, from each venue's own answer", async () => {
    const fetchFn = venues();
    const p = await setup(fetchFn).preview(asset('sol'), 25);
    expect(p.asset).toEqual({ key: 'sol', ticker: 'SOL', name: 'Solana', chain: 'Solana' });
    expect(p.legs.map((l) => l.label)).toEqual(['Arc to Solana, over CCTP', 'USDC to SOL on Jupiter']);
    expect(p.cctpFeeUsd).toBe(0);
    expect(p.outAmount).toBeCloseTo(0.210536304, 9);
    expect(p.priceUsd).toBeCloseTo(25 / 0.210536304, 6);
    expect(p.available).toBe(false);
    const urls = (fetchFn as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/v2/burn/USDC/fees/26/5'))).toBe(true);
    expect(urls.some((u) => u.includes('inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') && u.includes('amount=25000000'))).toBe(true);
  });

  it('takes the network fee KyberSwap estimates on Base, and the mid price on Hyperliquid', async () => {
    const r = setup(venues());
    const aero = await r.preview(asset('aero'), 25);
    expect(aero.networkFeeUsd).toBeCloseTo(0.0089, 6);
    expect(aero.legs[1]!.detail).toContain('aerodrome on Base');
    const hype = await r.preview(asset('hype'), 25);
    expect(hype.outAmount).toBeCloseTo(25 / 86.0925, 9);
    expect(hype.legs[0]!.label).toBe('Arc to Hyperliquid, over CCTP');
  });

  it("charges what Circle charges, and asks each venue once per fifteen seconds", async () => {
    const fetchFn = venues({ iris: [{ finalityThreshold: 1000, minimumFee: 1 }] });
    const r = setup(fetchFn);
    const p = await r.preview(asset('uni'), 100);
    expect(p.cctpFeeUsd).toBeCloseTo(0.01, 9);
    await r.preview(asset('uni'), 100);
    expect((fetchFn as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('kyberswap'))).toHaveLength(1);
  });

  it('says a route cannot be priced when a venue fails, and refuses silly amounts', async () => {
    const r = setup(venues({ kyber: { code: 4008, message: 'route not found' } }));
    await expect(r.preview(asset('link'), 25)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(setup(venues()).preview(asset('sol'), 0)).rejects.toThrow('between $1 and $10,000');
  });
});
