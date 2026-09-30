import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { erc20Abi } from 'viem';
import { ArcChain } from '../arc/chain';
import { ARC_NETWORKS, type ArcNetwork, type TokenInfo } from '../arc/network';
import { APP_CONFIG, type AppConfig, real } from '../config';
import { TRADE_ERRORS, type Address, type ArcToken, type TokenKind } from '../trade/types';
import type { AssetView, GateVerdict, MarketPort, SeriesPoint, SeriesRange } from './market.types';
import {
  allowedIconUrl,
  CoinGecko,
  DexScreener,
  errorText,
  fetchIcon,
  Flights,
  GeckoTerminal,
  JsonSource,
  NATIVE_USDC,
  RateGate,
  toAddress,
  TtlCache,
  type ArcPair,
  type CgListing,
  type Clock,
  type FetchLike,
  type GtTokenInfo,
  type IconBytes,
  type Priority,
  type Timeframe,
} from './sources';
import { ARC_STOCKS, namesAStock, stockShaped, stocksOn, type StockListing } from './stocks';

/**
 * The market layer: names, faces, prices and the live permission slip for
 * every token the extension shows on Arc.
 *
 * THE RULES, IN ORDER OF TRUST.
 * 1. Circle's own assets are pinned from arc/network.ts. $USDC is always the
 *    real USDC (two memecoins on Arc use the symbol USDC), $BTC and $BITCOIN
 *    mean cirBTC, $EUR means EURC. They always resolve and always pass.
 * 2. Tokenized stocks come only from the hand-kept list in stocks.ts.
 * 3. Everything else is the long tail. A cashtag resolves to the Arc token
 *    with that exact symbol whose USDC pool holds the most USDC
 *    (`liquidity.quote`), with at least ARC_MIN_USDC_DEPTH in it. Ranking by
 *    volume or by `liquidity.usd` picked the fake every time we tried it
 *    (ARGUS, TOLLY, FAZE, ASTOCK on 2026-09-28); ranking by USDC depth picked
 *    the CoinGecko-listed contract every time.
 * 4. A symbol that names a major asset or a famous stock never resolves to a
 *    lookalike. Arc has a "BTC" at number one by volume with 7 buyers, four
 *    "ETH" contracts claiming trillion-dollar pools and about twenty "USDT".
 *    A stock counts in any issuer's spelling (NVDAx, CRCLon), and a token
 *    named like one ("NVIDIA xStock") is refused whatever its symbol.
 *
 * Resolving is not permission. `gate()` is: a long-tail token must still show
 * a working sell for a $10 round trip that loses no more than
 * ARC_MAX_ROUND_TRIP_LOSS_PCT, through the same router the trade uses.
 *
 * FAILURE IS NOT ABSENCE. When a source is down and nothing cached can stand
 * in, methods throw MarketUnavailable instead of answering null or "refused".
 * The extension caches a null for the life of the page and removes the chip;
 * a thrown call is retried. Only real answers are cached as answers.
 */

export const MARKET_SELL_PROBE = Symbol('MARKET_SELL_PROBE');
export const MARKET_OPTIONS = Symbol('MARKET_OPTIONS');

/** What the gate needs from a sell probe. KyberRouter.sellProbe's result may carry more. */
export interface SellProbeResult {
  /** Percent lost buying `usdcRaw` of the token and selling it straight back; 3.1 means 3.1%. */
  roundTripLossPct: number;
}

/**
 * The signature of KyberRouter.sellProbe(token, usdcRaw). Resolve null, or
 * throw an Error whose message is TRADE_ERRORS.noRoute, when there is no way
 * to sell; throw anything else for a failure that says nothing about the token.
 */
export type SellProbeFn = (token: Address, usdcRaw: bigint) => Promise<SellProbeResult | null>;

/** Thrown when a source failed and nothing cached could answer. Not a verdict about the token. */
export class MarketUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MarketUnavailable';
  }
}

export interface MarketSettings {
  /** ARC_MIN_USDC_DEPTH: USDC that must sit in the token's deepest USDC pool. */
  minUsdcDepth: number;
  /** ARC_MAX_ROUND_TRIP_LOSS_PCT: the most a $10 buy-then-sell may lose. */
  maxRoundTripLossPct: number;
  /** Size of the sell probe, 6-decimal USDC raw. */
  probeUsdcRaw: bigint;
}

function envNumber(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const v = real(value);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max}, got "${v}"`);
  return n;
}

export function marketSettings(env: NodeJS.ProcessEnv = process.env): MarketSettings {
  return {
    minUsdcDepth: envNumber(env.ARC_MIN_USDC_DEPTH, 25_000, 0, 1e12, 'ARC_MIN_USDC_DEPTH'),
    maxRoundTripLossPct: envNumber(env.ARC_MAX_ROUND_TRIP_LOSS_PCT, 5, 0, 100, 'ARC_MAX_ROUND_TRIP_LOSS_PCT'),
    probeUsdcRaw: 10_000_000n,
  };
}

/** Everything a test (or a future deploy) may swap. Nest injects none of it by default. */
export interface MarketOptions {
  fetch?: FetchLike;
  now?: Clock;
  settings?: Partial<MarketSettings>;
  stocks?: readonly StockListing[];
}

const MINUTE = 60_000;

/**
 * How long answers live. Prices move, faces barely do, lists change daily.
 * GeckoTerminal answers live longer than the views built from them because
 * its keyless budget is about 10 calls a minute for the whole service.
 */
const TTL = {
  price: 15_000,
  describe: 30_000,
  list: 10 * MINUTE,
  search: MINUTE,
  /** A ticker answer built without CoinGecko's tie-break is kept only briefly. */
  softTicker: MINUTE,
  /** A token with no price yet: a new pool can take a minute to show up. */
  noPrice: MINUTE,
  gateOk: MINUTE,
  gateRefused: 10 * MINUTE,
  spark: 5 * MINUTE,
  iconHit: 24 * 60 * MINUTE,
  iconMiss: 10 * MINUTE,
  iconUnknown: MINUTE,
} as const;

/** The oldest answer that may stand in for a failed request. */
const STALE_MAX_MS = 10 * MINUTE;

/** The runner-up must be under a fifth of the winner's USDC depth, or the ticker is ambiguous. */
const DOMINANCE = 5;

/**
 * New addresses one prices() call may look up. The batch endpoint is public
 * and takes 50; without a cap one request could spend a third of the minute's
 * background share on addresses nobody will see. The rest stay absent, which
 * the port allows, and the next poll picks them up.
 */
const DISCOVER_PER_CALL = 8;

/** Same rule the extension applies before asking (xStrip.ts:1507). */
const TICKER_RE = /^[A-Z0-9]{2,10}$/;

const SERIES: Record<SeriesRange, { timeframe: Timeframe; aggregate: number; limit: number; ttlMs: number }> = {
  '1H': { timeframe: 'minute', aggregate: 1, limit: 60, ttlMs: 30_000 },
  '1D': { timeframe: 'minute', aggregate: 15, limit: 96, ttlMs: MINUTE },
  '1W': { timeframe: 'hour', aggregate: 1, limit: 168, ttlMs: 5 * MINUTE },
  '1M': { timeframe: 'hour', aggregate: 4, limit: 180, ttlMs: 15 * MINUTE },
};

/**
 * Symbols that name a major asset. A token using one is refused unless it is
 * the canonical contract: the pinned Circle asset, a static canonical address
 * below, or the Arc address CoinGecko lists under one of these coin ids.
 */
const MAJORS: Readonly<Record<string, readonly string[]>> = {
  BTC: ['circle-wrapped-btc'], XBT: [], WBTC: ['wrapped-bitcoin'], CBBTC: ['coinbase-wrapped-btc'], TBTC: ['tbtc'],
  ETH: ['arc-bridged-weth-arc', 'weth'], WETH: ['arc-bridged-weth-arc', 'weth'], STETH: ['staked-ether'],
  WSTETH: ['wrapped-steth'], CBETH: ['coinbase-wrapped-staked-eth'],
  SOL: ['solana', 'wrapped-solana'], WSOL: ['wrapped-solana'],
  USDC: ['usd-coin'], USDCE: [], USDT: ['tether'], USDT0: ['usdt0'], EURC: ['euro-coin'], EUR: ['euro-coin'],
  DAI: ['dai'], USDE: ['ethena-usde'], USDS: ['usds'], PYUSD: ['paypal-usd'], FDUSD: ['first-digital-usd'],
  TUSD: ['true-usd'], BUSD: ['binance-usd'], FRAX: ['frax'], GHO: ['gho'], USD1: ['usd1-wlfi'], RLUSD: ['ripple-usd'],
  BNB: ['binancecoin'], XRP: ['ripple'], ADA: ['cardano'], DOGE: ['dogecoin'], TRX: ['tron'],
  TON: ['the-open-network'], AVAX: ['avalanche-2'], DOT: ['polkadot'], LINK: ['chainlink'],
  MATIC: ['matic-network'], POL: ['polygon-ecosystem-token'], SUI: ['sui'], APT: ['aptos'], HYPE: ['hyperliquid'],
  LTC: ['litecoin'], BCH: ['bitcoin-cash'], XLM: ['stellar'], XMR: ['monero'], ZEC: ['zcash'], ATOM: ['cosmos'],
  NEAR: ['near'], ARB: ['arbitrum'], OP: ['optimism'], UNI: ['uniswap'], AAVE: ['aave'],
  SHIB: ['shiba-inu'], PEPE: ['pepe'], BONK: ['bonk'], WIF: ['dogwifcoin'], TRUMP: ['official-trump'],
  FLOKI: ['floki'], POPCAT: ['popcat'],
};

/**
 * Canonical Arc contracts known without asking CoinGecko, so a CoinGecko
 * outage cannot refuse them. Both read from CoinGecko's Arc listings on
 * 2026-09-28 (arc-bridged-weth-arc, chainlink).
 */
const STATIC_CANONICAL: Readonly<Record<ArcNetwork['name'], Readonly<Record<string, readonly Address[]>>>> = {
  mainnet: {
    ETH: ['0x128cc466b61f542da60c70e3aa11c10e19b84edb'],
    WETH: ['0x128cc466b61f542da60c70e3aa11c10e19b84edb'],
    LINK: ['0x76a443768a5e3b8d1aed0105fc250877841deb40'],
  },
  testnet: {},
};

/**
 * Letters from other scripts that read as Latin ones. A pool whose symbol is
 * "USDС" with a Cyrillic С would otherwise slip past the majors check and
 * show on the chip as USDC.
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'Ј': 'J', 'К': 'K', 'М': 'M', 'О': 'O',
  'Р': 'P', 'Ѕ': 'S', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'а': 'a', 'с': 'c', 'е': 'e', 'і': 'i', 'ј': 'j',
  'о': 'o', 'р': 'p', 'ѕ': 's', 'х': 'x', 'у': 'y', 'ԁ': 'd', 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z',
  'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'ο': 'o', 'ν': 'v', 'α': 'a', 'ι': 'i', 'κ': 'k', 'τ': 't', 'υ': 'u',
};

/** The comparable form of a symbol: lookalikes folded, uppercase, letters and digits only. */
export function symbolKey(raw: string): string {
  const folded = raw.normalize('NFKC').replace(/[^\u0000-\u007f]/g, (ch) => CONFUSABLES[ch] ?? '');
  return folded.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** "$eth", "ETH", " Bitcoin " to ETH, ETH, BITCOIN. */
export function tickerKey(raw: string): string {
  return symbolKey(raw.trim().replace(/^\$+/, ''));
}

/** Does this ticker name a major asset, which only its canonical contract may answer to? */
export function isMajorTicker(raw: string): boolean {
  return tickerKey(raw) in MAJORS;
}

/** A display name with invisible characters dropped and lookalike letters folded, spaces kept. */
function nameKey(raw: string | null | undefined): string {
  return clean(raw, 200)
    .normalize('NFKC')
    .replace(/[^\u0000-\u007f]/g, (ch) => CONFUSABLES[ch] ?? ' ');
}

/** Strips control and direction-override characters and caps the length of text shown to readers. */
function clean(text: string | null | undefined, max: number): string {
  return (text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .trim()
    .slice(0, max);
}

const OK: GateVerdict = { ok: true };
const refuse = (reason: string): GateVerdict => ({ ok: false, reason });
const COPIES_MAJOR = 'it uses the name of a major asset';
const COPIES_STOCK = 'it uses the name of a stock';

interface PinnedAsset {
  token: ArcToken;
  /**
   * The mainnet contract of the same asset. Market sources only index
   * mainnet, so on testnet EURC and cirBTC are priced by their mainnet twin.
   */
  twin: Address;
}

interface TokenMarket {
  /** The USDC pool we route and price through: the most USDC, not the most volume. */
  best: ArcPair | null;
  /** Every USDC pool of the token, deepest first. */
  usdcPools: ArcPair[];
  /** Best pool of any kind, used to name a token that has no USDC market. */
  any: ArcPair | null;
  imageUrl: string | null;
}

const NO_MARKET: TokenMarket = { best: null, usdcPools: [], any: null, imageUrl: null };

function unavailable(e: unknown): MarketUnavailable {
  return e instanceof MarketUnavailable ? e : new MarketUnavailable(errorText(e), { cause: e });
}

async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(lanes);
}

@Injectable()
export class MarketService implements MarketPort {
  private readonly log = new Logger('market');
  private readonly net: ArcNetwork;
  private readonly settings: MarketSettings;
  private readonly now: Clock;
  private readonly fetchImpl: FetchLike;
  private readonly dex: DexScreener;
  private readonly gt: GeckoTerminal;
  private readonly cg: CoinGecko;
  private readonly usdc: Address;
  private readonly circle = new Map<Address, PinnedAsset>();
  /** Cashtag keys that always mean one Circle asset. */
  private readonly aliases = new Map<string, Address>();
  private readonly stocks: StockListing[];
  private readonly stockByAddress = new Map<Address, StockListing>();
  private probe: SellProbeFn | null;

  private readonly tickers: TtlCache<Address | null>;
  private readonly views: TtlCache<AssetView | null>;
  private readonly verdicts: TtlCache<GateVerdict>;
  private readonly priceCache: TtlCache<number | null>;
  /** Which pool prices a token, so a batch of prices is one call instead of one per token. */
  private readonly knownPools: TtlCache<string>;
  private readonly icons: TtlCache<IconBytes | null>;
  /** decimals() never changes for a deployed token. */
  private readonly decimals = new Map<Address, number>();
  private readonly flights = new Flights();

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly chain: ArcChain,
    @Optional() @Inject(MARKET_SELL_PROBE) probe?: SellProbeFn | null,
    @Optional() @Inject(MARKET_OPTIONS) options?: MarketOptions | null,
  ) {
    this.net = config.network;
    this.settings = { ...marketSettings(), ...(options?.settings ?? {}) };
    this.now = options?.now ?? Date.now;
    this.fetchImpl = options?.fetch ?? ((url, init) => fetch(url, init));
    this.probe = probe ?? null;

    const source = (name: 'dexscreener' | 'geckoterminal' | 'coingecko', gate: RateGate, maxEntries?: number) =>
      new JsonSource({
        name,
        fetch: this.fetchImpl,
        now: this.now,
        gate,
        timeoutMs: name === 'coingecko' ? 15_000 : 6_000,
        staleMaxMs: name === 'coingecko' ? 6 * 60 * MINUTE : STALE_MAX_MS,
        maxEntries,
      });
    // DexScreener allows 300 a minute. Background work (batch prices, icons)
    // may use half of our 240, so a flood of addresses on the public batch
    // endpoints can never starve the chip, the gate or a trade.
    this.dex = new DexScreener(
      source(
        'dexscreener',
        new RateGate({ perMinute: 240, passivePerMinute: 120, backoffMs: 15_000, maxBackoffMs: 2 * MINUTE }, this.now),
        4_000,
      ),
    );
    // About 10 calls a minute without a key; keep two of eight for charts a reader is waiting on.
    this.gt = new GeckoTerminal(
      source(
        'geckoterminal',
        new RateGate({ perMinute: 8, passivePerMinute: 6, backoffMs: 30_000, maxBackoffMs: 5 * MINUTE }, this.now),
        4_000,
      ),
    );
    this.cg = new CoinGecko(
      source('coingecko', new RateGate({ perMinute: 4, backoffMs: MINUTE, maxBackoffMs: 10 * MINUTE }, this.now), 4),
    );

    this.usdc = this.net.usdc.address.toLowerCase() as Address;
    const main = ARC_NETWORKS.mainnet;
    const pin = (t: TokenInfo, twin: TokenInfo, name: string, kind: TokenKind, keys: string[]) => {
      const address = t.address.toLowerCase() as Address;
      this.circle.set(address, {
        token: { address, symbol: t.symbol, name, decimals: t.decimals, kind, icon: null, restrictions: [] },
        twin: twin.address.toLowerCase() as Address,
      });
      for (const k of keys) this.aliases.set(k, address);
    };
    pin(this.net.usdc, main.usdc, 'USD Coin', 'cash', ['USDC']);
    pin(this.net.eurc, main.eurc, 'Euro Coin', 'cash', ['EURC', 'EUR']);
    pin(this.net.cirbtc, main.cirbtc, 'Circle Wrapped Bitcoin', 'circle', ['CIRBTC', 'BTC', 'BITCOIN']);

    this.stocks = stocksOn(this.net.name, options?.stocks ?? ARC_STOCKS);
    for (const s of this.stocks) this.stockByAddress.set(s.address, s);

    this.tickers = new TtlCache(this.now, 5_000);
    this.views = new TtlCache(this.now, 5_000);
    this.verdicts = new TtlCache(this.now, 10_000);
    this.priceCache = new TtlCache(this.now, 10_000);
    this.knownPools = new TtlCache(this.now, 10_000);
    this.icons = new TtlCache(this.now, 400);
  }

  /**
   * Wire the sell probe after construction (KyberRouter may be built later
   * than this service). Verdicts made without it are dropped.
   */
  setSellProbe(probe: SellProbeFn | null): void {
    this.probe = probe;
    this.verdicts.clear();
  }

  // ─── MarketPort ──────────────────────────────────────────────────────────

  pinned(): ArcToken[] {
    const circle = [...this.circle.values()].map((p) => ({ ...p.token }));
    const stocks = this.stocks.map((s) => ({
      address: s.address,
      symbol: s.symbol,
      name: s.name,
      decimals: s.decimals,
      kind: s.kind,
      icon: s.icon,
      restrictions: [...s.restrictions],
    }));
    return [...circle, ...stocks];
  }

  async resolveTicker(ticker: string): Promise<Address | null> {
    if (typeof ticker !== 'string') return null;
    const key = tickerKey(ticker);
    if (!key) return null;
    const circle = this.aliases.get(key);
    if (circle) return circle;
    const stock = this.stockForTicker(key);
    if (stock) return stock.address;
    if (!TICKER_RE.test(key) || stockShaped(key)) return null;
    // Market sources only index mainnet; on testnet the long tail would name mainnet contracts.
    if (this.net.name !== 'mainnet') return null;

    const hit = this.tickers.fresh(key);
    if (hit) return hit.value;
    return this.flights.run(`ticker:${key}`, async () => {
      const { address, firm } = key in MAJORS ? await this.resolveMajor(key) : await this.resolveLongTail(key);
      this.tickers.set(key, address, firm ? TTL.list : TTL.softTicker);
      return address;
    });
  }

  async describe(address: Address): Promise<AssetView | null> {
    const a = toAddress(address);
    if (!a) return null;
    const hit = this.views.fresh(a);
    if (hit) return hit.value;
    return this.flights.run(`describe:${a}`, async () => {
      try {
        const view = await this.buildView(a);
        this.views.set(a, view, TTL.describe);
        return view;
      } catch (e) {
        const old = this.views.stale(a, STALE_MAX_MS);
        if (old) return old.value;
        throw unavailable(e);
      }
    });
  }

  async gate(address: Address): Promise<GateVerdict> {
    const a = toAddress(address);
    if (!a) return refuse('that is not a token address');
    if (this.circle.has(a) || this.stockByAddress.has(a)) return OK;
    if (this.net.name !== 'mainnet') return refuse('only USDC, EURC and cirBTC trade here for now');
    const hit = this.verdicts.fresh(a);
    if (hit) return hit.value;
    return this.flights.run(`gate:${a}`, async () => {
      const verdict = await this.judge(a);
      this.verdicts.set(a, verdict, verdict.ok ? TTL.gateOk : TTL.gateRefused);
      return verdict;
    });
  }

  async prices(addresses: Address[]): Promise<Map<Address, number>> {
    const out = new Map<Address, number>();
    const todo: Address[] = [];
    for (const raw of addresses ?? []) {
      const a = toAddress(raw);
      if (!a || out.has(a) || todo.includes(a)) continue;
      if (a === this.usdc) {
        out.set(a, 1);
        continue;
      }
      const hit = this.priceCache.fresh(a);
      if (hit) {
        if (hit.value !== null) out.set(a, hit.value);
      } else if (this.twinOf(a)) {
        todo.push(a);
      }
    }

    // Tokens whose pool we already know: re-price the pools, 30 per call.
    const byPool = new Map<string, Address[]>();
    const unknown: Address[] = [];
    for (const a of todo) {
      const pool = this.knownPools.fresh(a)?.value;
      if (pool) byPool.set(pool, [...(byPool.get(pool) ?? []), a]);
      else unknown.push(a);
    }
    const pools = [...byPool.keys()];
    for (let i = 0; i < pools.length; i += 30) {
      const chunk = pools.slice(i, i + 30);
      let answered: ArcPair[] = [];
      try {
        answered = await this.dex.pairs(chunk, TTL.price, 'passive');
      } catch {
        answered = [];
      }
      const seen = new Set<string>();
      for (const p of answered) {
        for (const a of byPool.get(p.pool) ?? []) {
          if (p.base.address !== this.twinOf(a)) continue;
          seen.add(p.pool);
          this.priceCache.set(a, p.priceUsd, TTL.price);
          if (p.priceUsd !== null) out.set(a, p.priceUsd);
        }
      }
      for (const pool of chunk) if (!seen.has(pool)) unknown.push(...(byPool.get(pool) ?? []));
    }

    // Tokens we have not seen yet: one token-pairs call each, a few at a time,
    // on the background share and only so many per call.
    await eachLimited(unknown.slice(0, DISCOVER_PER_CALL), 4, async (a) => {
      try {
        const m = await this.marketOf(a, 'passive');
        const price = (m.best ?? m.any)?.priceUsd ?? null;
        this.priceCache.set(a, price, price === null ? TTL.noPrice : TTL.price);
        if (price !== null) out.set(a, price);
      } catch {
        /* falls through to a stale price below */
      }
    });

    for (const a of todo) {
      if (out.has(a)) continue;
      const old = this.priceCache.stale(a, STALE_MAX_MS)?.value;
      if (typeof old === 'number' && old > 0) out.set(a, old);
    }
    return out;
  }

  async series(address: Address, range: SeriesRange): Promise<SeriesPoint[]> {
    const a = toAddress(address);
    if (!a || a === this.usdc) return [];
    const twin = this.twinOf(a);
    if (!twin) return [];
    const spec = SERIES[range] ?? SERIES['1D'];
    const market = await this.marketOf(a);
    // The chosen pool first; the next one only when GeckoTerminal has nothing for it.
    for (const p of market.usdcPools.slice(0, 2)) {
      let candles;
      try {
        candles = await this.gt.ohlcv(p.pool, spec.timeframe, spec.aggregate, spec.limit, twin, spec.ttlMs, 'active');
      } catch (e) {
        throw unavailable(e);
      }
      if (candles && candles.length > 0) return candles.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
    }
    return [];
  }

  async icon(address: Address): Promise<{ contentType: string; bytes: Buffer } | null> {
    const a = toAddress(address);
    if (!a) return null;
    const hit = this.icons.fresh(a);
    if (hit) return hit.value;
    return this.flights.run(`icon:${a}`, async () => {
      const { urls, complete } = await this.iconUrls(a);
      for (const url of urls) {
        const got = await fetchIcon(this.fetchImpl, url);
        if (got) {
          this.icons.set(a, got, TTL.iconHit);
          return got;
        }
      }
      // A miss after every source answered is a fact; a miss because a source was down is not.
      this.icons.set(a, null, complete ? TTL.iconMiss : TTL.iconUnknown);
      return null;
    });
  }

  // ─── resolution ──────────────────────────────────────────────────────────

  private stockForTicker(key: string): StockListing | null {
    return (
      this.stocks.find((s) => symbolKey(s.symbol) === key || s.aliases.some((x) => symbolKey(x) === key)) ?? null
    );
  }

  /** A major's ticker resolves only to its canonical contract, and only when that has a real USDC market. */
  private async resolveMajor(key: string): Promise<{ address: Address | null; firm: boolean }> {
    const { addresses, firm } = await this.canonicalFor(key);
    let pick: { address: Address; depth: number } | null = null;
    for (const a of addresses) {
      const depth = (await this.marketOf(a)).best?.quoteDepth ?? 0;
      if (depth >= this.settings.minUsdcDepth && (!pick || depth > pick.depth)) pick = { address: a, depth };
    }
    return { address: pick?.address ?? null, firm };
  }

  private async resolveLongTail(key: string): Promise<{ address: Address | null; firm: boolean }> {
    let found: ArcPair[];
    try {
      found = await this.dex.search(key, TTL.search);
    } catch (e) {
      throw unavailable(e);
    }
    const listings = await this.listingsSoft();
    let firm = listings !== null;
    const listed = new Set((listings ?? []).filter((l) => symbolKey(l.symbol) === key).map((l) => l.address));

    const depth = new Map<Address, number>();
    for (const p of found) {
      if (symbolKey(p.base.symbol) !== key || !this.isUsdc(p.quote) || p.quoteDepth === null) continue;
      depth.set(p.base.address, Math.max(depth.get(p.base.address) ?? 0, p.quoteDepth));
    }
    // Search stops at 30 pairs. A vetted contract crowded out by clones is measured directly.
    for (const a of [...listed].filter((x) => !depth.has(x)).slice(0, 3)) {
      try {
        const best = (await this.marketOf(a)).best;
        if (best?.quoteDepth != null) depth.set(a, best.quoteDepth);
      } catch {
        firm = false;
      }
    }

    const ranked = [...depth.entries()]
      .filter(([, d]) => d >= this.settings.minUsdcDepth)
      .sort((x, y) => y[1] - x[1]);
    if (ranked.length === 0) return { address: null, firm };
    // A contract CoinGecko lists under this symbol beats an unlisted one, however deep.
    const vetted = ranked.filter(([a]) => listed.has(a));
    const field = vetted.length > 0 ? vetted : ranked;
    if (field.length > 1 && field[1][1] * DOMINANCE >= field[0][1]) return { address: null, firm };
    return { address: field[0][0], firm };
  }

  /** Canonical contracts for a major's symbol; `firm` is false when CoinGecko could not be asked. */
  private async canonicalFor(key: string): Promise<{ addresses: Set<Address>; firm: boolean }> {
    const addresses = new Set<Address>();
    const circle = this.aliases.get(key);
    if (circle) addresses.add(circle);
    for (const a of STATIC_CANONICAL[this.net.name][key] ?? []) addresses.add(a);
    const ids = MAJORS[key] ?? [];
    if (ids.length === 0 || this.net.name !== 'mainnet') return { addresses, firm: true };
    const listings = await this.listingsSoft();
    for (const l of listings ?? []) if (ids.includes(l.id)) addresses.add(l.address);
    return { addresses, firm: listings !== null };
  }

  private async listingsSoft(): Promise<CgListing[] | null> {
    try {
      return await this.cg.arcListings(TTL.list);
    } catch (e) {
      this.log.warn(`CoinGecko listings unavailable: ${errorText(e)}`);
      return null;
    }
  }

  /**
   * Why a token's face copies an asset it is not, or null. The symbol is
   * checked against Circle's assets, listed stocks, famous stock tickers in
   * any issuer's spelling and the majors; the name catches a stock whose
   * symbol is new ("NVIDIA xStock" as ZZZ).
   */
  private async copies(face: ArcPair, a: Address): Promise<string | null> {
    if (this.circle.has(a) || this.stockByAddress.has(a)) return null;
    const key = symbolKey(face.base.symbol);
    if (key) {
      const circle = this.aliases.get(key);
      if (circle) return circle === a ? null : COPIES_MAJOR;
      if (this.stockForTicker(key) || stockShaped(key)) return COPIES_STOCK;
    }
    if (namesAStock(nameKey(face.base.name))) return COPIES_STOCK;
    if (!key || !(key in MAJORS)) return null;
    return (await this.canonicalFor(key)).addresses.has(a) ? null : COPIES_MAJOR;
  }

  // ─── gate ────────────────────────────────────────────────────────────────

  private async judge(a: Address): Promise<GateVerdict> {
    const market = await this.marketOf(a);
    const face = market.best ?? market.any;
    if (!face) return refuse('there is no market for it');
    const copied = await this.copies(face, a);
    if (copied) return refuse(copied);
    if (!market.best) return refuse('there is no USDC market for it');
    if ((market.best.quoteDepth ?? 0) < this.settings.minUsdcDepth) return refuse('its USDC market is too thin');
    return this.probeSell(a);
  }

  private async probeSell(a: Address): Promise<GateVerdict> {
    if (!this.probe) throw new MarketUnavailable('the sell check is not wired');
    let result: SellProbeResult | null;
    try {
      result = await this.probe(a, this.settings.probeUsdcRaw);
    } catch (e) {
      if (e instanceof Error && e.message === TRADE_ERRORS.noRoute) return refuse('it cannot be sold back right now');
      throw new MarketUnavailable(`sell check failed: ${errorText(e)}`, { cause: e });
    }
    if (result === null) return refuse('it cannot be sold back right now');
    const loss = result.roundTripLossPct;
    // NaN would pass a `loss > max` test; a probe that cannot say what it lost has not passed.
    if (typeof loss !== 'number' || !Number.isFinite(loss)) {
      throw new MarketUnavailable('sell check returned no loss figure');
    }
    if (loss > this.settings.maxRoundTripLossPct) {
      this.log.log(`gate ${a}: round trip loses ${loss.toFixed(2)}%`);
      return refuse('selling it back loses too much right now');
    }
    return OK;
  }

  // ─── market facts ────────────────────────────────────────────────────────

  private isUsdc(a: Address): boolean {
    return a === ARC_NETWORKS.mainnet.usdc.address.toLowerCase() || a === NATIVE_USDC;
  }

  /** The address market sources know this token by, or null when they cannot know it. */
  private twinOf(a: Address): Address | null {
    const circle = this.circle.get(a);
    if (circle) return circle.twin;
    return this.net.name === 'mainnet' ? a : null;
  }

  /**
   * The token's Arc pools. `priority` is 'passive' for work nobody is waiting
   * on by name (batch prices, icons); the chip, the gate and trades stay
   * 'active' and keep their share of the budget.
   */
  private async marketOf(a: Address, priority: Priority = 'active'): Promise<TokenMarket> {
    const twin = this.twinOf(a);
    if (!twin) return NO_MARKET;
    let pairs: ArcPair[];
    try {
      pairs = await this.dex.tokenPairs(twin, TTL.price, priority);
    } catch (e) {
      throw unavailable(e);
    }
    const own = pairs.filter((p) => p.base.address === twin);
    const usdcPools = own
      .filter((p) => this.isUsdc(p.quote) && p.quoteDepth !== null)
      .sort((x, y) => (y.quoteDepth ?? 0) - (x.quoteDepth ?? 0));
    const best = usdcPools[0] ?? null;
    const any = best ?? [...own].sort((x, y) => (y.liquidityUsd ?? 0) - (x.liquidityUsd ?? 0))[0] ?? null;
    if (best) this.knownPools.set(a, best.pool, TTL.list);
    const imageUrl = own.map((p) => p.imageUrl).find((u): u is string => !!u && !!allowedIconUrl(u)) ?? null;
    return { best, usdcPools, any, imageUrl };
  }

  private async infoSoft(twin: Address): Promise<GtTokenInfo | null> {
    try {
      return await this.gt.tokenInfo(twin, TTL.list, 'passive');
    } catch {
      return null;
    }
  }

  /** Hourly closes over the last day, oldest first, or null. A missing sparkline never fails a view. */
  private async sparkSoft(pool: string, twin: Address): Promise<number[] | null> {
    try {
      const candles = await this.gt.ohlcv(pool, 'hour', 1, 24, twin, TTL.spark, 'passive');
      const closes = (candles ?? []).map((c) => c.c).filter((c) => Number.isFinite(c) && c > 0);
      return closes.length >= 2 ? closes : null;
    } catch {
      return null;
    }
  }

  private async decimalsOf(a: Address, info: GtTokenInfo | null): Promise<number> {
    const known = this.decimals.get(a);
    if (known !== undefined) return known;
    try {
      const d = Number(
        await this.chain.client.readContract({ address: a, abi: erc20Abi, functionName: 'decimals' }),
      );
      if (Number.isInteger(d) && d >= 0 && d <= 36) {
        this.decimals.set(a, d);
        return d;
      }
    } catch (e) {
      this.log.warn(`decimals() of ${a} unreadable: ${errorText(e)}`);
    }
    if (info?.decimals != null) return info.decimals;
    throw new MarketUnavailable(`decimals of ${a} unknown`);
  }

  private async buildView(a: Address): Promise<AssetView | null> {
    const circle = this.circle.get(a)?.token ?? null;
    const stock = this.stockByAddress.get(a) ?? null;
    const fixed: ArcToken | null = circle ?? stock;
    const twin = this.twinOf(a);

    if (a === this.usdc && circle) {
      const info = twin ? await this.infoSoft(twin) : null;
      return {
        token: { ...circle, icon: this.iconFor(circle, info, null) },
        priceUsd: 1,
        change24hPct: 0,
        mcapUsd: null,
        holderCount: info?.holderCount ?? null,
        liquidityUsd: null,
        poolCreatedAtMs: null,
        spark24h: null,
      };
    }

    const [market, info] = await Promise.all([
      this.marketOf(a),
      twin ? this.infoSoft(twin) : Promise.resolve(null),
    ]);
    const face = market.best ?? market.any;
    if (!fixed && !face) return null;

    const symbol = fixed?.symbol ?? (clean(face?.base.symbol, 24) || clean(info?.symbol, 24));
    if (!symbol) return null;
    const name = fixed?.name ?? (clean(face?.base.name, 64) || clean(info?.name, 64) || symbol);
    const [decimals, spark24h] = await Promise.all([
      fixed ? Promise.resolve(fixed.decimals) : this.decimalsOf(a, info),
      market.best && twin ? this.sparkSoft(market.best.pool, twin) : Promise.resolve(null),
    ]);
    const kind: TokenKind = fixed?.kind ?? 'long-tail';

    return {
      token: {
        address: a,
        symbol,
        name,
        decimals,
        kind,
        icon: this.iconFor(fixed, info, market.imageUrl),
        restrictions: fixed ? [...fixed.restrictions] : [],
      },
      priceUsd: face?.priceUsd ?? null,
      change24hPct: face?.change24hPct ?? null,
      // Supply times price means something for a launch token; for Circle's
      // assets and issuer-backed stocks it would be the Arc slice of a bigger
      // asset, which reads as a wrong number.
      mcapUsd: kind === 'long-tail' ? (face?.mcapUsd ?? null) : null,
      holderCount: info?.holderCount ?? null,
      liquidityUsd: market.best?.quoteDepth ?? null,
      poolCreatedAtMs: market.best?.createdAtMs ?? null,
      spark24h,
    };
  }

  private iconFor(fixed: ArcToken | null, info: GtTokenInfo | null, dexImage: string | null): string | null {
    const candidates = [fixed?.icon ?? null, ...(info?.imageUrls ?? []), dexImage];
    return candidates.find((u): u is string => !!u && !!allowedIconUrl(u)) ?? null;
  }

  /**
   * Where a token's face may be fetched from. DexScreener is asked first and
   * GeckoTerminal only for a token that trades on Arc (or one we pin): the
   * icon route is public, and a stream of made-up addresses must not spend
   * GeckoTerminal's few calls a minute that sparklines and holder counts need.
   */
  private async iconUrls(a: Address): Promise<{ urls: string[]; complete: boolean }> {
    const twin = this.twinOf(a);
    const fixed = this.circle.get(a)?.token ?? this.stockByAddress.get(a) ?? null;
    if (!twin) return { urls: fixed?.icon ? [fixed.icon] : [], complete: true };
    let complete = true;
    const market = await this.marketOf(a, 'passive').catch(() => {
      complete = false;
      return null;
    });
    let info: GtTokenInfo | null = null;
    if (fixed || market?.any) {
      info = await this.gt.tokenInfo(twin, TTL.list, 'passive').catch(() => {
        complete = false;
        return null;
      });
    }
    const urls = [fixed?.icon ?? null, ...(info?.imageUrls ?? []), market?.imageUrl ?? null].filter(
      (u): u is string => !!u && !!allowedIconUrl(u),
    );
    return { urls: [...new Set(urls)], complete };
  }
}
