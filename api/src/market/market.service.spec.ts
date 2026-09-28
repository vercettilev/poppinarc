import type { ArcChain } from '../arc/chain';
import { ARC_NETWORKS, type ArcNetworkName } from '../arc/network';
import type { AppConfig } from '../config';
import { TRADE_ERRORS, type Address } from '../trade/types';
import {
  MarketService,
  MarketUnavailable,
  marketSettings,
  symbolKey,
  tickerKey,
  type MarketSettings,
  type SellProbeFn,
} from './market.service';
import { allowedIconUrl, fetchIcon, JsonSource, RateGate, sniffImage, type FetchLike } from './sources';
import { stocksOn, type StockListing } from './stocks';

// ─── fixtures (shapes and figures from DexScreener and GeckoTerminal, Arc mainnet, 2026-09-28) ───

const USDC = '0x3600000000000000000000000000000000000000';
const EURC = ARC_NETWORKS.mainnet.eurc.address.toLowerCase();
const CIRBTC = ARC_NETWORKS.mainnet.cirbtc.address.toLowerCase();
const REAL_ARGUS = '0xece5ca8bf9220718e5727754026757512212cb3c';
const REAL_ARGUS_CHECKSUM = '0xeCe5cA8bf9220718E5727754026757512212cb3c';
const FAKE_ARGUS = '0x8adf1c44c6cb7c04cd12c63108e0037922fb603c';
const WETH = '0x128cc466b61f542da60c70e3aa11c10e19b84edb';
const FAKE_ETH = '0x7fcb934400000000000000000000000000000001';
const MEME_USDC = '0x8e98a62a995a50eca9979bfa016f91bf36a8f9d9';
const CAT_A = '0xaaaa00000000000000000000000000000000000a';
const CAT_B = '0xbbbb00000000000000000000000000000000000b';
const ARGUS_V4 = '0xb3f441e8871840ecfcb284e5cbb5b9c21a50e961e1c50109bdced25e429f00cc';
const ARGUS_V3 = '0x6A3bAcAa6493734c1Ac221EBF42CF530A96C1e02';
const CIRBTC_V3 = '0x82916bee18fcef517b26000000000000000000c3';
const ICON = 'https://coin-images.coingecko.com/coins/images/102178392/large/argus-token.png?1789463380';

interface PairSpec {
  pool: string;
  base: string;
  symbol: string;
  name?: string;
  quote?: string;
  quoteSymbol?: string;
  quoteDepth: number;
  liqUsd?: number;
  vol?: number;
  price?: string;
  change?: number;
  mcap?: number;
  created?: number;
  image?: string;
}

function pair(s: PairSpec) {
  return {
    chainId: 'arc',
    dexId: 'uniswap',
    pairAddress: s.pool,
    baseToken: { address: s.base, name: s.name ?? s.symbol, symbol: s.symbol },
    quoteToken: { address: s.quote ?? USDC, name: s.quoteSymbol ?? 'USDC', symbol: s.quoteSymbol ?? 'USDC' },
    priceNative: s.price ?? '1',
    priceUsd: s.price ?? '1',
    volume: { h24: s.vol ?? 0 },
    priceChange: { h24: s.change ?? 0 },
    liquidity: { usd: s.liqUsd ?? s.quoteDepth * 2, base: 1, quote: s.quoteDepth },
    marketCap: s.mcap,
    pairCreatedAt: s.created,
    ...(s.image ? { info: { imageUrl: s.image } } : {}),
  };
}

const ARGUS_PAIRS = [
  pair({ pool: ARGUS_V3, base: REAL_ARGUS_CHECKSUM, symbol: 'ARGUS', name: 'Argus', quoteDepth: 368_265, price: '0.01899', change: -16.29, mcap: 17_700_771, created: 1_788_373_928_000 }),
  pair({ pool: ARGUS_V4, base: REAL_ARGUS_CHECKSUM, symbol: 'ARGUS', name: 'Argus', quoteDepth: 443_105, price: '0.01900', change: -16.3, mcap: 17_700_000, created: 1_789_527_054_000 }),
  // ARGUS as the QUOTE of another token's pool: never ARGUS's own market.
  pair({ pool: '0x5b76eaf30ee538369c3283b58be91b4bf466b377560de1fcea21663e5b33c4f1', base: '0x1111000000000000000000000000000000000001', symbol: 'LAND', quote: REAL_ARGUS, quoteSymbol: 'ARGUS', quoteDepth: 58_372, liqUsd: 804_950 }),
];

const FAKE_ARGUS_PAIR = pair({
  pool: '0x946c3b6a9714b7338e0000000000000000000000000000000000000000000000',
  base: FAKE_ARGUS,
  symbol: 'ARGUS',
  quoteDepth: 0.2283,
  liqUsd: 5_996_402.51,
  vol: 15_742_106.39,
  price: '0.02',
});

const CG_LIST = [
  { id: 'argus-2', symbol: 'argus', name: 'Argus', platforms: { arc: REAL_ARGUS } },
  { id: 'arc-bridged-weth-arc', symbol: 'weth', name: 'Arc Bridged WETH', platforms: { arc: WETH } },
  { id: 'usd-coin', symbol: 'usdc', name: 'USDC', platforms: { arc: USDC, ethereum: '0xa0b8' } },
  { id: 'upsidedowncat-3', symbol: 'usdc', name: 'UpSideDownCat', platforms: { arc: MEME_USDC } },
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', platforms: {} },
];

const GT_INFO = {
  data: {
    attributes: {
      address: REAL_ARGUS,
      name: 'Argus',
      symbol: 'ARGUS',
      decimals: 18,
      image_url: ICON,
      image: { large: ICON, small: ICON.replace('/large/', '/small/') },
      holders: { count: 20_515 },
    },
  },
};

/** GeckoTerminal order: newest first. */
function gtCandles(closes: number[], startT = 1_790_500_000, step = 3_600) {
  const rows = closes.map((c, i) => [startT + i * step, c, c * 1.01, c * 0.99, c, 100 + i]);
  return { data: { attributes: { ohlcv_list: rows.reverse() } } };
}

// ─── fake network ───

interface FakeRes {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: null;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? null));
  const fake: FakeRes = {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n) => h[n.toLowerCase()] ?? null },
    body: null,
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
  return fake as unknown as Response;
}
const ok = (body: unknown) => res(200, body);

type Route = [RegExp, (url: string) => Response | Promise<Response>];

const T0 = 1_790_000_000_000;

function make(
  opts: {
    routes?: Route[];
    probe?: SellProbeFn | null;
    stocks?: StockListing[];
    settings?: Partial<MarketSettings>;
    network?: ArcNetworkName;
  } = {},
) {
  let t = T0;
  const routes: Route[] = [...(opts.routes ?? [])];
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    for (const [pattern, handler] of routes) if (pattern.test(url)) return handler(url);
    throw new Error(`unexpected request ${url}`);
  };
  const readContract = jest.fn(async () => 18);
  const chain = { client: { readContract } } as unknown as ArcChain;
  const config = { network: ARC_NETWORKS[opts.network ?? 'mainnet'] } as AppConfig;
  const svc = new MarketService(config, chain, opts.probe ?? null, {
    fetch: fetchImpl,
    now: () => t,
    stocks: opts.stocks,
    settings: opts.settings,
  });
  return {
    svc,
    calls,
    routes,
    readContract,
    advance: (ms: number) => {
      t += ms;
    },
    count: (re: RegExp) => calls.filter((u) => re.test(u)).length,
  };
}

const SEARCH = (q: string) => new RegExp(`/latest/dex/search\\?q=${q}$`);
const TOKEN_PAIRS = (a: string) => new RegExp(`/token-pairs/v1/arc/${a}$`);
const CG = /api\.coingecko\.com\/api\/v3\/coins\/list/;
const GT_INFO_RE = /geckoterminal\.com\/api\/v2\/networks\/arc\/tokens\/0x[0-9a-f]+\/info$/;
const GT_OHLCV = /geckoterminal\.com\/api\/v2\/networks\/arc\/pools\/.*\/ohlcv\//;
const ANY_TOKEN_PAIRS = /\/token-pairs\/v1\/arc\/0x[0-9a-f]{40}$/;

const NVDAX: StockListing = {
  network: 'mainnet',
  address: '0x5800000000000000000000000000000000000058',
  symbol: 'NVDAx',
  name: 'NVIDIA xStock',
  decimals: 18,
  kind: 'stock',
  icon: null,
  restrictions: ['us-persons'],
  aliases: ['NVDA'],
  issuer: 'xstocks',
  source: 'test fixture',
};

/** Made-up addresses, none of them a fixture above. */
function addresses(n: number, from = 1): Address[] {
  return Array.from({ length: n }, (_, i) => ('0x' + (from + i).toString(16).padStart(40, 'e')) as Address);
}

// ─── tests ───

describe('ticker and symbol keys', () => {
  it('fold lookalike letters so a Cyrillic USDC reads as USDC', () => {
    expect(symbolKey('USDС')).toBe('USDC');
    expect(symbolKey('USDC.e')).toBe('USDCE');
    expect(tickerKey(' $eth ')).toBe('ETH');
    expect(tickerKey('Bitcoin')).toBe('BITCOIN');
  });
});

describe('marketSettings', () => {
  it('defaults to a $25k USDC floor and a 5% round trip, and refuses nonsense', () => {
    expect(marketSettings({})).toEqual({ minUsdcDepth: 25_000, maxRoundTripLossPct: 5, probeUsdcRaw: 10_000_000n });
    expect(marketSettings({ ARC_MIN_USDC_DEPTH: '50000', ARC_MAX_ROUND_TRIP_LOSS_PCT: '2.5' })).toMatchObject({
      minUsdcDepth: 50_000,
      maxRoundTripLossPct: 2.5,
    });
    expect(marketSettings({ ARC_MIN_USDC_DEPTH: '<depth>' }).minUsdcDepth).toBe(25_000);
    expect(() => marketSettings({ ARC_MAX_ROUND_TRIP_LOSS_PCT: 'lots' })).toThrow(/ARC_MAX_ROUND_TRIP_LOSS_PCT/);
  });
});

describe('resolveTicker', () => {
  it('pins Circle assets without asking anyone', async () => {
    const m = make();
    for (const t of ['$usdc', 'USDC', 'usdc']) expect(await m.svc.resolveTicker(t)).toBe(USDC);
    for (const t of ['BTC', '$bitcoin', 'cirBTC', 'Bitcoin']) expect(await m.svc.resolveTicker(t)).toBe(CIRBTC);
    for (const t of ['EUR', '$eurc']) expect(await m.svc.resolveTicker(t)).toBe(EURC);
    expect(m.calls).toEqual([]);
  });

  it('picks the deepest USDC pool, not the loudest volume or USD liquidity', async () => {
    const m = make({
      routes: [
        [SEARCH('ARGUS'), () => ok({ pairs: [FAKE_ARGUS_PAIR, ...ARGUS_PAIRS] })],
        [CG, () => ok(CG_LIST)],
      ],
    });
    expect(await m.svc.resolveTicker('$argus')).toBe(REAL_ARGUS);
    // Answered from cache for ten minutes.
    m.advance(9 * 60_000);
    expect(await m.svc.resolveTicker('ARGUS')).toBe(REAL_ARGUS);
    expect(m.count(SEARCH('ARGUS'))).toBe(1);
  });

  it('refuses a market under the USDC depth floor', async () => {
    const thin = pair({ pool: '0x' + '12'.repeat(20), base: CAT_A, symbol: 'CAT', quoteDepth: 20_000 });
    const routes: Route[] = [
      [SEARCH('CAT'), () => ok({ pairs: [thin] })],
      [CG, () => ok([])],
    ];
    expect(await make({ routes }).svc.resolveTicker('CAT')).toBeNull();
    expect(await make({ routes, settings: { minUsdcDepth: 10_000 } }).svc.resolveTicker('CAT')).toBe(CAT_A);
  });

  it('never lets a lookalike take a major ticker', async () => {
    const m = make({
      routes: [
        [TOKEN_PAIRS(WETH), () => ok([pair({ pool: '0x6f302dec' + '0'.repeat(32), base: WETH, symbol: 'WETH', quoteDepth: 477_597, price: '3120' })])],
        [CG, () => ok(CG_LIST)],
        [SEARCH('ETH'), () => ok({ pairs: [pair({ pool: '0x' + '34'.repeat(20), base: FAKE_ETH, symbol: 'ETH', quoteDepth: 9e9 })] })],
      ],
    });
    expect(await m.svc.resolveTicker('$ETH')).toBe(WETH);
    expect(await m.svc.resolveTicker('USDT')).toBeNull();
    // A famous stock we do not list resolves to nothing, without a single request.
    const before = m.calls.length;
    expect(await m.svc.resolveTicker('TSLA')).toBeNull();
    expect(m.calls.length).toBe(before);
    expect(m.count(/search/)).toBe(0);
  });

  it('answers nothing when two contracts share a ticker and neither dominates, unless one is vetted', async () => {
    const pairs = [
      pair({ pool: '0x' + 'a1'.repeat(20), base: CAT_A, symbol: 'CAT', quoteDepth: 100_000 }),
      pair({ pool: '0x' + 'b1'.repeat(20), base: CAT_B, symbol: 'CAT', quoteDepth: 60_000 }),
    ];
    const unlisted = make({ routes: [[SEARCH('CAT'), () => ok({ pairs })], [CG, () => ok([])]] });
    expect(await unlisted.svc.resolveTicker('CAT')).toBeNull();

    const listed = make({
      routes: [
        [SEARCH('CAT'), () => ok({ pairs })],
        [CG, () => ok([{ id: 'cat-b', symbol: 'cat', name: 'Cat', platforms: { arc: CAT_B } }])],
      ],
    });
    expect(await listed.svc.resolveTicker('CAT')).toBe(CAT_B);
  });

  it('throws while the source is down and caches nothing', async () => {
    let up = false;
    const m = make({
      routes: [
        [SEARCH('ARGUS'), () => (up ? ok({ pairs: ARGUS_PAIRS }) : res(503, {}))],
        [CG, () => ok(CG_LIST)],
      ],
    });
    await expect(m.svc.resolveTicker('ARGUS')).rejects.toBeInstanceOf(MarketUnavailable);
    up = true;
    expect(await m.svc.resolveTicker('ARGUS')).toBe(REAL_ARGUS);
  });

  it('a listed stock resolves before the long tail and passes the gate', async () => {
    const stock: StockListing = {
      network: 'mainnet',
      address: '0x5700000000000000000000000000000000000057',
      symbol: 'TSLAx',
      name: 'Tesla xStock',
      decimals: 18,
      kind: 'stock',
      icon: null,
      restrictions: ['us-persons'],
      aliases: ['TSLA'],
      issuer: 'xstocks',
      source: 'test fixture',
    };
    const m = make({ stocks: [stock] });
    expect(await m.svc.resolveTicker('$TSLA')).toBe(stock.address);
    expect(await m.svc.resolveTicker('tslax')).toBe(stock.address);
    expect(await m.svc.gate(stock.address)).toEqual({ ok: true });
    expect(m.svc.pinned().map((t) => [t.symbol, t.kind])).toEqual([
      ['USDC', 'cash'],
      ['EURC', 'cash'],
      ['cirBTC', 'circle'],
      ['TSLAx', 'stock'],
    ]);
    expect(m.svc.pinned()[3].restrictions).toEqual(['us-persons']);
    expect(m.calls).toEqual([]);
  });

  it('never resolves a stock ticker in an issuer spelling, and a listed one only to its listing', async () => {
    const m = make();
    for (const t of ['NVDAx', '$TSLAon', 'bNVDA', 'CRCLON', 'SPYx', 'TSLAd', 'COINb']) {
      expect(await m.svc.resolveTicker(t)).toBeNull();
    }
    expect(m.calls).toEqual([]);

    const listed = make({ stocks: [NVDAX] });
    for (const t of ['NVDAX', '$nvda']) expect(await listed.svc.resolveTicker(t)).toBe(NVDAX.address);
    expect(await listed.svc.resolveTicker('NVDAon')).toBeNull();
    expect(listed.calls).toEqual([]);
  });

  it('on testnet only the pinned assets resolve, with testnet addresses', async () => {
    const m = make({ network: 'testnet' });
    expect(await m.svc.resolveTicker('ARGUS')).toBeNull();
    expect(await m.svc.resolveTicker('EURC')).toBe(ARC_NETWORKS.testnet.eurc.address.toLowerCase());
    expect(m.calls).toEqual([]);
  });
});

describe('gate', () => {
  it('passes Circle assets without a probe or a request', async () => {
    const probe = jest.fn<ReturnType<SellProbeFn>, Parameters<SellProbeFn>>();
    const m = make({ probe });
    expect(await m.svc.gate(USDC as Address)).toEqual({ ok: true });
    expect(await m.svc.gate(ARC_NETWORKS.mainnet.eurc.address)).toEqual({ ok: true });
    expect(await m.svc.gate(CIRBTC as Address)).toEqual({ ok: true });
    expect(probe).not.toHaveBeenCalled();
    expect(m.calls).toEqual([]);
  });

  it('lets a long-tail token through on a $10 round trip within the loss limit, for a minute', async () => {
    const probe = jest.fn<ReturnType<SellProbeFn>, Parameters<SellProbeFn>>(async () => ({ roundTripLossPct: 3.2 }));
    const m = make({ probe, routes: [[TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)]] });
    expect(await m.svc.gate(REAL_ARGUS_CHECKSUM as Address)).toEqual({ ok: true });
    expect(probe).toHaveBeenCalledWith(REAL_ARGUS, 10_000_000n);
    m.advance(59_000);
    await m.svc.gate(REAL_ARGUS as Address);
    expect(probe).toHaveBeenCalledTimes(1);
    m.advance(2_000);
    await m.svc.gate(REAL_ARGUS as Address);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('refuses a lossy round trip and keeps the refusal for ten minutes', async () => {
    const probe = jest.fn<ReturnType<SellProbeFn>, Parameters<SellProbeFn>>(async () => ({ roundTripLossPct: 7.5 }));
    const m = make({ probe, routes: [[TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)]] });
    const refused = { ok: false, reason: 'selling it back loses too much right now' };
    expect(await m.svc.gate(REAL_ARGUS as Address)).toEqual(refused);
    m.advance(9 * 60_000);
    expect(await m.svc.gate(REAL_ARGUS as Address)).toEqual(refused);
    expect(probe).toHaveBeenCalledTimes(1);
    m.advance(2 * 60_000);
    await m.svc.gate(REAL_ARGUS as Address);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('refuses a spoofed pool on depth before spending a probe', async () => {
    const probe = jest.fn<ReturnType<SellProbeFn>, Parameters<SellProbeFn>>();
    const m = make({ probe, routes: [[TOKEN_PAIRS(FAKE_ARGUS), () => ok([FAKE_ARGUS_PAIR])]] });
    expect(await m.svc.gate(FAKE_ARGUS as Address)).toEqual({ ok: false, reason: 'its USDC market is too thin' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses a memecoin named USDC, even spelled with a Cyrillic letter', async () => {
    const probe = jest.fn<ReturnType<SellProbeFn>, Parameters<SellProbeFn>>();
    const spoof = '0x5555000000000000000000000000000000000055';
    const m = make({
      probe,
      routes: [
        [TOKEN_PAIRS(MEME_USDC), () => ok([pair({ pool: '0x' + '54'.repeat(32), base: MEME_USDC, symbol: 'USDC', name: 'UpSideDownCat', quoteDepth: 66_079 })])],
        [TOKEN_PAIRS(spoof), () => ok([pair({ pool: '0x' + '56'.repeat(20), base: spoof, symbol: 'USDС', quoteDepth: 90_000 })])],
      ],
    });
    const refused = { ok: false, reason: 'it uses the name of a major asset' };
    expect(await m.svc.gate(MEME_USDC as Address)).toEqual(refused);
    expect(await m.svc.gate(spoof as Address)).toEqual(refused);
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses a stock in any issuer spelling or name before spending a probe, and lets ArcStocks through', async () => {
    const probe = jest.fn<ReturnType<SellProbeFn>, Parameters<SellProbeFn>>(async () => ({ roundTripLossPct: 1 }));
    // Shapes from DexScreener's Arc search, 2026-09-28, with the USDC raised over the floor.
    const [xstock, ondo, backed, named, astock] = addresses(5, 0x5700);
    const face: Array<[Address, string, string]> = [
      [xstock, 'NVDAx', 'NVIDIA xStock'],
      [ondo, 'CRCLon', 'Circle Internet Group (Ondo Tokenized)'],
      [backed, 'bNVDA', 'Backed NVIDIA'],
      // A new symbol, and a Cyrillic o in the name.
      [named, 'ZZZ', 'Apple xSt\u043eck'],
      [astock, 'ASTOCK', 'ArcStocks'],
    ];
    const routes = face.map(([a, symbol, name], i): Route => [
      TOKEN_PAIRS(a),
      () => ok([pair({ pool: '0x' + String(40 + i).repeat(20), base: a, symbol, name, quoteDepth: 90_000 })]),
    ]);
    const m = make({ probe, routes });
    const refused = { ok: false, reason: 'it uses the name of a stock' };
    for (const a of [xstock, ondo, backed, named]) expect(await m.svc.gate(a)).toEqual(refused);
    expect(probe).not.toHaveBeenCalled();
    expect(await m.svc.gate(astock)).toEqual({ ok: true });
    expect(probe).toHaveBeenCalledTimes(1);

    // A listed stock outside the famous list: its alias from another address is a copy too.
    const crwd: StockListing = { ...NVDAX, address: '0x5900000000000000000000000000000000000059', symbol: 'CRWDx', name: 'CrowdStrike xStock', aliases: ['CRWD'] };
    const [copy] = addresses(1, 0x5800);
    const listed = make({
      probe,
      stocks: [crwd],
      routes: [[TOKEN_PAIRS(copy), () => ok([pair({ pool: '0x' + '49'.repeat(20), base: copy, symbol: 'CRWD', name: 'CrowdStrike', quoteDepth: 90_000 })])]],
    });
    expect(await listed.svc.gate(copy)).toEqual(refused);
    expect(await listed.svc.gate(crwd.address)).toEqual({ ok: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('treats "no route" as a refusal and a flaky probe as no verdict at all', async () => {
    const other = '0x7777000000000000000000000000000000000077';
    let flaky = true;
    const probe = jest.fn<ReturnType<SellProbeFn>, Parameters<SellProbeFn>>(async (token) => {
      if (token === REAL_ARGUS) throw new Error(TRADE_ERRORS.noRoute);
      if (flaky) throw new Error(TRADE_ERRORS.rateLimited);
      return { roundTripLossPct: 1 };
    });
    const m = make({
      probe,
      routes: [
        [TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)],
        [TOKEN_PAIRS(other), () => ok([pair({ pool: '0x' + '77'.repeat(20), base: other, symbol: 'OTHER', quoteDepth: 80_000 })])],
      ],
    });
    expect(await m.svc.gate(REAL_ARGUS as Address)).toEqual({ ok: false, reason: 'it cannot be sold back right now' });
    await expect(m.svc.gate(other as Address)).rejects.toBeInstanceOf(MarketUnavailable);
    flaky = false;
    expect(await m.svc.gate(other as Address)).toEqual({ ok: true });
  });

  it('does not pass a probe that reports no loss figure, or a gate with no probe', async () => {
    const nan = make({
      probe: async () => ({ roundTripLossPct: Number.NaN }),
      routes: [[TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)]],
    });
    await expect(nan.svc.gate(REAL_ARGUS as Address)).rejects.toBeInstanceOf(MarketUnavailable);

    const none = make({ routes: [[TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)]] });
    await expect(none.svc.gate(REAL_ARGUS as Address)).rejects.toThrow(/not wired/);
    none.svc.setSellProbe(async () => ({ roundTripLossPct: 0.4 }));
    expect(await none.svc.gate(REAL_ARGUS as Address)).toEqual({ ok: true });
  });
});

describe('describe', () => {
  it('describes a long-tail token from its deepest USDC pool', async () => {
    const m = make({
      routes: [
        [TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)],
        [GT_INFO_RE, () => ok(GT_INFO)],
        [GT_OHLCV, () => ok(gtCandles([0.021, 0.02, 0.019]))],
      ],
    });
    const view = await m.svc.describe(REAL_ARGUS_CHECKSUM as Address);
    expect(view).toEqual({
      token: {
        address: REAL_ARGUS,
        symbol: 'ARGUS',
        name: 'Argus',
        decimals: 18,
        kind: 'long-tail',
        icon: ICON,
        restrictions: [],
      },
      priceUsd: 0.019,
      change24hPct: -16.3,
      mcapUsd: 17_700_000,
      holderCount: 20_515,
      liquidityUsd: 443_105,
      poolCreatedAtMs: 1_789_527_054_000,
      spark24h: [0.021, 0.02, 0.019],
    });
    const ohlcv = m.calls.find((u) => GT_OHLCV.test(u))!;
    expect(ohlcv).toContain(`/pools/${ARGUS_V4}/ohlcv/hour?aggregate=1&limit=24`);
    expect(ohlcv).toContain(`token=${REAL_ARGUS}`);
    expect(m.readContract).toHaveBeenCalledTimes(1);
  });

  it('prices USDC at one dollar without asking DexScreener', async () => {
    const m = make({ routes: [[GT_INFO_RE, () => ok({ data: { attributes: { image_url: 'missing.png' } } })]] });
    const view = await m.svc.describe(USDC as Address);
    expect(view).toMatchObject({ priceUsd: 1, change24hPct: 0, mcapUsd: null, spark24h: null });
    expect(view?.token).toMatchObject({ symbol: 'USDC', decimals: 6, kind: 'cash', icon: null });
    expect(m.count(/dexscreener/)).toBe(0);
  });

  it('prices cirBTC through its USDC pool', async () => {
    const m = make({
      routes: [
        [
          TOKEN_PAIRS(CIRBTC),
          () =>
            ok([
              pair({ pool: '0x' + 'ff'.repeat(32), base: CIRBTC, symbol: 'cirBTC', quote: REAL_ARGUS, quoteSymbol: 'ARGUS', quoteDepth: 2_137_810, liqUsd: 90_000_000, price: '82652.35' }),
              pair({ pool: CIRBTC_V3, base: CIRBTC, symbol: 'cirBTC', quoteDepth: 5_969_356, price: '82788.86', change: 0.4, mcap: 5_000_000 }),
            ]),
        ],
        [GT_INFO_RE, () => res(429, {})],
        [GT_OHLCV, () => res(429, {})],
      ],
    });
    const view = await m.svc.describe(CIRBTC as Address);
    expect(view).toMatchObject({ priceUsd: 82788.86, liquidityUsd: 5_969_356, mcapUsd: null, spark24h: null, holderCount: null });
    expect(view?.token).toMatchObject({ symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin', decimals: 8, kind: 'circle' });
    expect(m.readContract).not.toHaveBeenCalled();
  });

  it('answers null for a token no market knows', async () => {
    const nobody = '0x9999000000000000000000000000000000000099';
    const m = make({ routes: [[TOKEN_PAIRS(nobody), () => ok([])], [GT_INFO_RE, () => res(404, {})]] });
    expect(await m.svc.describe(nobody as Address)).toBeNull();
    expect(await m.svc.describe('not an address' as Address)).toBeNull();
  });

  it('throws while DexScreener is down rather than answering null', async () => {
    const m = make({ routes: [[TOKEN_PAIRS(REAL_ARGUS), () => res(503, {})], [GT_INFO_RE, () => ok(GT_INFO)]] });
    await expect(m.svc.describe(REAL_ARGUS as Address)).rejects.toBeInstanceOf(MarketUnavailable);
  });

  it('serves the old sparkline when GeckoTerminal says 429, then leaves it alone while backing off', async () => {
    let limited = false;
    const m = make({
      routes: [
        [TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)],
        [GT_INFO_RE, () => ok(GT_INFO)],
        [GT_OHLCV, () => (limited ? res(429, {}, { 'retry-after': '0' }) : ok(gtCandles([1, 2, 3])))],
      ],
    });
    expect((await m.svc.describe(REAL_ARGUS as Address))?.spark24h).toEqual([1, 2, 3]);
    limited = true;
    m.advance(6 * 60_000);
    expect((await m.svc.describe(REAL_ARGUS as Address))?.spark24h).toEqual([1, 2, 3]);
    const asked = m.count(GT_OHLCV);
    // Inside the pause, a chart with nothing cached fails without another request.
    await expect(m.svc.series(REAL_ARGUS as Address, '1D')).rejects.toBeInstanceOf(MarketUnavailable);
    expect(m.count(GT_OHLCV)).toBe(asked);
  });
});

describe('prices', () => {
  it('learns each pool once, then re-prices known pools in one batch', async () => {
    const m = make({
      routes: [
        [TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)],
        [TOKEN_PAIRS(CIRBTC), () => ok([pair({ pool: CIRBTC_V3, base: CIRBTC, symbol: 'cirBTC', quoteDepth: 5_969_356, price: '82788.86' })])],
        [TOKEN_PAIRS(CAT_A), () => ok([])],
        [
          /\/latest\/dex\/pairs\/arc\//,
          () =>
            ok({
              pairs: [
                pair({ pool: ARGUS_V4, base: REAL_ARGUS, symbol: 'ARGUS', quoteDepth: 443_105, price: '0.0205' }),
                pair({ pool: CIRBTC_V3, base: CIRBTC, symbol: 'cirBTC', quoteDepth: 5_969_356, price: '83000' }),
              ],
            }),
        ],
      ],
    });
    const first = await m.svc.prices([REAL_ARGUS_CHECKSUM, CIRBTC, USDC, CAT_A] as Address[]);
    expect(first).toEqual(new Map([[USDC, 1], [REAL_ARGUS, 0.019], [CIRBTC, 82788.86]]));

    m.advance(16_000);
    const second = await m.svc.prices([REAL_ARGUS, CIRBTC] as Address[]);
    expect(second).toEqual(new Map([[REAL_ARGUS, 0.0205], [CIRBTC, 83000]]));
    const batch = m.calls.filter((u) => /\/latest\/dex\/pairs\/arc\//.test(u));
    expect(batch).toHaveLength(1);
    expect(batch[0]).toContain(`${ARGUS_V4},${CIRBTC_V3}`);
    expect(m.count(TOKEN_PAIRS(REAL_ARGUS))).toBe(1);
  });
});

describe('the public batch endpoints and the DexScreener budget', () => {
  it('looks up at most eight new addresses per prices call, and the next eight on the next call', async () => {
    const m = make({ routes: [[ANY_TOKEN_PAIRS, () => ok([])]] });
    const twenty = addresses(20);
    expect(await m.svc.prices(twenty)).toEqual(new Map());
    expect(m.count(ANY_TOKEN_PAIRS)).toBe(8);
    await m.svc.prices(twenty);
    expect(m.count(ANY_TOKEN_PAIRS)).toBe(16);
  });

  it('keeps half the minute for the chip when prices and icons are flooded with made-up addresses', async () => {
    const m = make({
      routes: [
        [TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)],
        [ANY_TOKEN_PAIRS, () => ok([])],
        [GT_INFO_RE, () => ok(GT_INFO)],
        [GT_OHLCV, () => ok(gtCandles([1, 2]))],
      ],
    });
    for (let i = 0; i < 20; i++) await m.svc.prices(addresses(8, 0x100 + i * 8));
    expect(m.count(ANY_TOKEN_PAIRS)).toBe(120);
    // Icons ride the same background share, and a made-up address never reaches GeckoTerminal.
    expect(await m.svc.icon(addresses(1, 0x900)[0])).toBeNull();
    expect(m.count(ANY_TOKEN_PAIRS)).toBe(120);
    expect(m.count(GT_INFO_RE)).toBe(0);
    // The reader's own lookup still goes out.
    expect((await m.svc.describe(REAL_ARGUS as Address))?.token.symbol).toBe('ARGUS');
    expect(m.count(TOKEN_PAIRS(REAL_ARGUS))).toBe(1);
  });

  it('a reader who joins background work the budget turned away asks again on the reader share', async () => {
    let status = 200;
    let fetched = 0;
    const source = (passivePerMinute: number) =>
      new JsonSource({
        name: 'dexscreener',
        fetch: async () => {
          fetched++;
          return res(status, { n: 1 });
        },
        now: () => T0,
        gate: new RateGate({ perMinute: 5, passivePerMinute, backoffMs: 1_000, maxBackoffMs: 1_000 }, () => T0),
        timeoutMs: 1_000,
        staleMaxMs: 1_000,
      });
    const url = 'https://api.dexscreener.com/token-pairs/v1/arc/x';
    const idle = (raw: unknown) => raw;

    const full = source(0);
    const background = full.get(url, 1_000, idle, 'passive');
    const reader = full.get(url, 1_000, idle, 'active');
    await expect(background).rejects.toMatchObject({ status: 429 });
    await expect(reader).resolves.toEqual({ n: 1 });
    expect(fetched).toBe(1);

    // A real upstream failure is not asked twice.
    status = 503;
    const down = source(5);
    const bg2 = down.get(url, 1_000, idle, 'passive');
    const reader2 = down.get(url, 1_000, idle, 'active');
    await expect(bg2).rejects.toMatchObject({ status: 503 });
    await expect(reader2).rejects.toMatchObject({ status: 503 });
    expect(fetched).toBe(2);
  });
});

describe('series', () => {
  it('maps 1D to 15-minute candles of the chosen pool, oldest first', async () => {
    const m = make({
      routes: [
        [TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)],
        [GT_OHLCV, () => ok(gtCandles([5, 6, 7], 1_790_500_000, 900))],
      ],
    });
    const points = await m.svc.series(REAL_ARGUS as Address, '1D');
    expect(points.map((p) => [p.t, p.c])).toEqual([
      [1_790_500_000, 5],
      [1_790_500_900, 6],
      [1_790_501_800, 7],
    ]);
    expect(points[0]).toMatchObject({ o: 5, h: 5.05, l: 4.95, v: 100 });
    const url = m.calls.find((u) => GT_OHLCV.test(u))!;
    expect(url).toContain(`/pools/${ARGUS_V4}/ohlcv/minute?aggregate=15&limit=96`);
  });

  it('answers no chart when GeckoTerminal does not know the pools, and nothing for USDC', async () => {
    const m = make({ routes: [[TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)], [GT_OHLCV, () => res(404, {})]] });
    expect(await m.svc.series(REAL_ARGUS as Address, '1W')).toEqual([]);
    // The chosen pool, then one fallback.
    expect(m.count(GT_OHLCV)).toBe(2);
    expect(await m.svc.series(USDC as Address, '1D')).toEqual([]);
  });
});

describe('icons', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

  it('fetches the token face from an allowed CDN, once', async () => {
    const m = make({
      routes: [
        [GT_INFO_RE, () => ok(GT_INFO)],
        [TOKEN_PAIRS(REAL_ARGUS), () => ok(ARGUS_PAIRS)],
        [/coin-images\.coingecko\.com/, () => res(200, PNG, { 'content-type': 'image/png' })],
      ],
    });
    const got = await m.svc.icon(REAL_ARGUS as Address);
    expect(got?.contentType).toBe('image/png');
    expect(got?.bytes.equals(PNG)).toBe(true);
    await m.svc.icon(REAL_ARGUS as Address);
    expect(m.count(/coin-images/)).toBe(1);
  });

  it('does not ask GeckoTerminal about an address with no Arc pool', async () => {
    const nobody = '0x9999000000000000000000000000000000000099';
    const m = make({ routes: [[TOKEN_PAIRS(nobody), () => ok([])]] });
    expect(await m.svc.icon(nobody as Address)).toBeNull();
    expect(m.count(GT_INFO_RE)).toBe(0);
  });

  it('only speaks https to the listed hosts', () => {
    expect(allowedIconUrl('https://coin-images.coingecko.com/a.png')).not.toBeNull();
    expect(allowedIconUrl('http://coin-images.coingecko.com/a.png')).toBeNull();
    expect(allowedIconUrl('https://evil.example/a.png')).toBeNull();
    expect(allowedIconUrl('https://169.254.169.254/latest/meta-data')).toBeNull();
    expect(allowedIconUrl('https://user@cdn.dexscreener.com/a.png')).toBeNull();
    expect(allowedIconUrl('https://cdn.dexscreener.com:8443/a.png')).toBeNull();
  });

  it('refuses redirects off the list, SVG, lies about the type, and anything over 256 KB', async () => {
    const seen: string[] = [];
    const serve =
      (r: Response): FetchLike =>
      async (url) => {
        seen.push(url);
        return r;
      };
    const url = 'https://coin-images.coingecko.com/x.png';

    expect(await fetchIcon(serve(res(302, Buffer.alloc(0), { location: 'http://169.254.169.254/' })), url)).toBeNull();
    expect(await fetchIcon(serve(res(200, Buffer.from('<svg/>'), { 'content-type': 'image/svg+xml' })), url)).toBeNull();
    expect(await fetchIcon(serve(res(200, Buffer.from('<html>'), { 'content-type': 'image/png' })), url)).toBeNull();
    expect(
      await fetchIcon(serve(res(200, PNG, { 'content-type': 'image/png', 'content-length': String(300 * 1024) })), url),
    ).toBeNull();
    const big = Buffer.concat([PNG, Buffer.alloc(300 * 1024)]);
    expect(await fetchIcon(serve(res(200, big, { 'content-type': 'image/png' })), url)).toBeNull();
    expect(await fetchIcon(serve(res(200, PNG, { 'content-type': 'image/png' })), 'https://evil.example/x.png')).toBeNull();
    expect(seen.every((u) => u === url)).toBe(true);
  });

  it('follows a redirect that stays on the list and asks DexScreener for a small image', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (u) => {
      seen.push(u);
      return seen.length === 1
        ? res(301, Buffer.alloc(0), { location: 'https://dd.dexscreener.com/ds-data/tokens/arc/x.png' })
        : res(200, PNG, { 'content-type': 'image/png' });
    };
    const got = await fetchIcon(fetchImpl, 'https://cdn.dexscreener.com/cms/images/abc?width=800&height=800&quality=95&format=auto');
    expect(got?.contentType).toBe('image/png');
    expect(seen[0]).toContain('width=256');
    expect(seen[1]).toBe('https://dd.dexscreener.com/ds-data/tokens/arc/x.png');
  });

  it('sniffs the common formats', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('stocksOn', () => {
  it('refuses a malformed listing at boot', () => {
    const bad = {
      network: 'mainnet',
      address: '0xABC',
      symbol: 'X',
      name: 'X',
      decimals: 18,
      kind: 'stock',
      icon: null,
      restrictions: [],
      aliases: [],
      issuer: 'x',
      source: 'x',
    } as StockListing;
    expect(() => stocksOn('mainnet', [bad])).toThrow(/lowercase/);
    expect(stocksOn('testnet', [bad])).toEqual([]);
  });
});
