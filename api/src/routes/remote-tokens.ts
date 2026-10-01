import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem';
import { fetchIcon, type IconBytes } from '../market/sources';
import {
  REMOTE_PREFIX,
  REMOTE_STOCKS,
  VENUE_OF,
  anyTokenKey,
  parseAnyTokenMint,
  remoteAssetOf,
  remoteMint,
  type RemoteAsset,
  type RemoteChain,
} from './remote';

/**
 * ANY TOKEN, ON THE CHAINS ARC REACHES.
 *
 * A cashtag names a ticker, and a ticker is not a token. Measured 2026-09-30:
 * DexScreener's search for $TRUMP put a $2.5 billion "OFFICIAL TRUMP" on
 * Ethereum first, and its search for $WIF never showed dogwifhat at all. Pool
 * liquidity is the one number a faker controls; market cap as CoinGecko ranks
 * it is not. So "which token is $PEPE" is CoinGecko's answer: the coin with
 * that symbol and the largest market cap among the top 1,500. A ticker whose
 * largest coin lives nowhere Arc reaches ($XRP) gets no chip, never the next
 * coin down that happens to share the symbol.
 *
 * WHERE IT LIVES comes from the same source: CoinGecko lists each coin's
 * contract on every chain it is on. We keep Solana, Base, Ethereum, Arbitrum
 * and Hyperliquid's own spot book, the places CCTP delivers USDC. A coin on
 * several of them is bought where its pools are deepest (DexScreener, asked
 * about one known contract, not about a name); a coin native to Hyperliquid
 * is bought on Hyperliquid's book.
 *
 * FEW CALLS, ON PURPOSE. CoinGecko's free API refused the sixth quick call the
 * same day, so nothing here asks it per ticker: six pages of markets and one
 * coin list build a snapshot every few hours, and every lookup reads the
 * snapshot. Until the first one lands, lookups throw RemoteTokensWarming, and
 * the chip, which forgets failures and caches only answers, asks again later.
 *
 * Solana tokens past the top 1,500 still resolve when Jupiter marks them
 * verified and they are worth at least $10M.
 */

export { REMOTE_STOCKS };

export interface RemoteListing {
  asset: RemoteAsset;
  mint: string;
  icon: string | null;
  /** From the snapshot, so up to a few hours old: a fallback when no live route answers. */
  priceUsd: number | null;
  mcapUsd: number | null;
}

export class RemoteTokensWarming extends Error {}

interface Coin {
  id: string;
  /** Uppercase, as a cashtag is compared. */
  symbol: string;
  name: string;
  image: string | null;
  priceUsd: number | null;
  mcapUsd: number | null;
}

interface Place {
  chain: RemoteChain;
  /** An address as anyTokenKey writes it; for Hyperliquid, CoinGecko's token id until it is turned into a book. */
  address: string;
}

interface SpotToken {
  name: string;
  /** allMids' key for the token's USDC book: "PURR/USDC" or "@107". */
  book: string;
  szDecimals: number;
}

const CG = 'https://api.coingecko.com/api/v3';
const JUP = 'https://lite-api.jup.ag/tokens/v2/search';
const HL = 'https://api.hyperliquid.xyz/info';
const UA = { 'user-agent': 'poppin-arc/1.0 (+https://github.com/vercettilev/poppinarc)' };

const PAGES = 6;
const REFRESH_MS = 3 * 60 * 60_000;
const LIST_MAX_AGE_MS = 24 * 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const TICKER_TTL_MS = 6 * 60 * 60_000;
const MISS_TTL_MS = 30 * 60_000;
const SPOT_TTL_MS = 60 * 60_000;
const ICON_TTL_MS = 24 * 60 * 60_000;
const JUP_MIN_MCAP_USD = 10_000_000;

/** CoinGecko's platform ids for the chains Arc reaches. */
const PLATFORM_CHAIN: Readonly<Record<string, RemoteChain>> = {
  solana: 'solana',
  base: 'base',
  ethereum: 'ethereum',
  'arbitrum-one': 'arbitrum',
  hyperliquid: 'hyperliquid',
};

const DEX_CHAIN: Readonly<Partial<Record<RemoteChain, string>>> = {
  solana: 'solana',
  base: 'base',
  ethereum: 'ethereum',
  arbitrum: 'arbitrum',
};

const RPC: Readonly<Record<'base' | 'ethereum' | 'arbitrum', string>> = {
  base: 'https://mainnet.base.org',
  ethereum: 'https://ethereum-rpc.publicnode.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
};

/**
 * Tickers that markets use for an index, a rate or a commodity. On X, "$SPX"
 * is the S&P 500 far more often than it is SPX6900, the memecoin CoinGecko
 * files under the same symbol, and a chip under a market-close post that buys
 * a memecoin would be the worst kind of wrong.
 */
const MARKET_TICKERS: ReadonlySet<string> = new Set([
  'SPX', 'NDX', 'DJI', 'DJIA', 'RUT', 'VIX', 'DXY', 'IXIC', 'GSPC', 'ES', 'NQ', 'YM',
  'TNX', 'US10Y', 'US02Y', 'WTI', 'BRENT', 'OIL', 'GOLD', 'XAU', 'XAG', 'SILVER', 'NATGAS',
]);


/** A pool this deep on a chain the reader can buy on beats a deeper one they cannot (PEPE: Arbitrum over Ethereum). */
const TRADABLE_MIN_LIQUIDITY_USD = 25_000;

/** A dollar stablecoin: USDC into USDT across two chains is not a trade anyone reads about. */
function isDollar(c: Coin): boolean {
  return c.priceUsd !== null && Math.abs(c.priceUsd - 1) < 0.03 && /USD|DOLLAR/i.test(`${c.symbol} ${c.name}`);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function text(v: unknown, max = 80): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

function parseCoin(raw: unknown): Coin | null {
  const r = obj(raw);
  const id = text(r?.id, 120);
  const symbol = text(r?.symbol, 20).toUpperCase();
  if (!r || !id || !/^[A-Z0-9]{2,10}$/.test(symbol)) return null;
  return {
    id,
    symbol,
    name: text(r.name) || symbol,
    image: text(r.image, 500) || null,
    priceUsd: num(r.current_price),
    mcapUsd: num(r.market_cap),
  };
}

@Injectable()
export class RemoteTokens implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('remote-tokens');
  fetchFn: typeof fetch = (...a) => fetch(...a);
  sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  /** CoinGecko refuses quick calls, so the pages are spaced out, and a refusal waits a minute. */
  pageGapMs = 12_000;
  backoffMs = 65_000;
  /** Fewer coins than this is a broken answer, not a small market: keep the last snapshot. */
  minCoins = 250;
  /** An ERC-20's decimals, read from its chain once. */
  evmDecimals = (chain: 'base' | 'ethereum' | 'arbitrum', address: string): Promise<number> =>
    this.client(chain).readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: 'decimals' });

  private bySymbol = new Map<string, Coin>();
  private byId = new Map<string, Coin>();
  private places = new Map<string, Place[]>();
  /** anyTokenKey (and `hltoken:<id>` for Hyperliquid) to the coin that lives there. */
  private idByKey = new Map<string, string>();
  private listAt = 0;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly clients = new Map<string, PublicClient>();

  private readonly tickers = new Map<string, { at: number; value: RemoteListing | null }>();
  private readonly listings = new Map<string, RemoteListing>();
  private readonly decimals = new Map<string, number>();
  private readonly icons = new Map<string, { at: number; value: IconBytes | null }>();
  private spot: { at: number; byTokenId: Map<string, SpotToken>; tokenIdOfBook: Map<string, string> } | null = null;

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Load now, then again every few hours; a failed load keeps the last snapshot and tries again sooner. */
  start(): void {
    const run = async () => {
      let ok = false;
      try {
        await this.refresh();
        ok = true;
      } catch (e) {
        this.logger.warn(`snapshot: ${(e as Error)?.message ?? e}`);
      }
      this.timer = setTimeout(() => void run(), ok ? REFRESH_MS : RETRY_MS);
      this.timer.unref?.();
    };
    void run();
  }

  get ready(): boolean {
    return this.loadedAt > 0;
  }

  /** The top coins by market cap, then (at most daily) where each one lives. */
  refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<void> {
    const coins: Coin[] = [];
    for (let page = 1; page <= PAGES; page++) {
      if (page > 1) await this.sleep(this.pageGapMs);
      const rows = await this.coingecko(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
      for (const r of Array.isArray(rows) ? rows : []) {
        const c = parseCoin(r);
        if (c) coins.push(c);
      }
    }
    if (coins.length < this.minCoins) throw new Error(`only ${coins.length} coins`);
    if (Date.now() - this.listAt > LIST_MAX_AGE_MS || this.places.size === 0) {
      await this.sleep(this.pageGapMs);
      this.readPlaces(await this.coingecko(`${CG}/coins/list?include_platform=true`), new Set(coins.map((c) => c.id)));
      this.listAt = Date.now();
    }
    // Coins arrive largest first, so the first to claim a symbol keeps it.
    const bySymbol = new Map<string, Coin>();
    for (const c of coins) if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, c);
    this.bySymbol = bySymbol;
    this.byId = new Map(coins.map((c) => [c.id, c]));
    this.loadedAt = Date.now();
    // Every answer built from the last snapshot goes with it; decimals never change and stay.
    this.tickers.clear();
    this.listings.clear();
    this.logger.log(`snapshot: ${coins.length} coins, ${this.places.size} of them on chains Arc reaches`);
  }

  private readPlaces(list: unknown, wanted: Set<string>): void {
    const places = new Map<string, Place[]>();
    const idByKey = new Map<string, string>();
    for (const raw of Array.isArray(list) ? list : []) {
      const row = obj(raw);
      const id = text(row?.id, 120);
      if (!row || !wanted.has(id)) continue;
      const here: Place[] = [];
      for (const [platform, address] of Object.entries(obj(row.platforms) ?? {})) {
        const chain = PLATFORM_CHAIN[platform];
        if (!chain || typeof address !== 'string' || !address) continue;
        if (chain === 'hyperliquid') {
          const tokenId = address.toLowerCase();
          if (!/^0x[0-9a-f]{32}$/.test(tokenId)) continue;
          here.push({ chain, address: tokenId });
          idByKey.set(`hltoken:${tokenId}`, id);
          continue;
        }
        const key = anyTokenKey(chain, address);
        if (!key) continue;
        here.push({ chain, address: key.slice(chain.length + 1) });
        idByKey.set(key, id);
      }
      if (here.length > 0) places.set(id, here);
    }
    this.places = places;
    this.idByKey = idByKey;
  }

  /** The token a cashtag names on a chain Arc reaches, or null. Throws RemoteTokensWarming before the first snapshot. */
  async byTicker(ticker: string): Promise<RemoteListing | null> {
    const t = ticker.trim().replace(/^\$/, '').toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(t) || MARKET_TICKERS.has(t)) return null;
    const hit = this.tickers.get(t);
    if (hit && Date.now() - hit.at < (hit.value ? TICKER_TTL_MS : MISS_TTL_MS)) return hit.value;
    const stock = REMOTE_STOCKS[t];
    if (stock) return this.stockListing(t);
    if (!this.ready) throw new RemoteTokensWarming('The token list is still loading.');
    const coin = this.bySymbol.get(t);
    const value = coin ? await this.fromCoin(coin) : await this.fromJupiter(t);
    if (this.tickers.size > 5_000) this.tickers.clear();
    this.tickers.set(t, { at: Date.now(), value });
    return value;
  }

  /**
   * A remote mint of either kind as a listing, or null when it names nothing
   * we would trade. Undefined for a mint that is not remote at all.
   *
   * An any-token mint is only honoured for a contract the snapshot lists (or a
   * verified Jupiter token): a hand-typed remote:ethereum:0x... for some
   * unlisted contract is null, not a chip.
   */
  async assetOf(mint: unknown): Promise<RemoteListing | null | undefined> {
    if (typeof mint !== 'string' || !mint.startsWith(REMOTE_PREFIX)) return undefined;
    const curated = remoteAssetOf(mint);
    if (curated) {
      const face = this.bySymbol.get(curated.ticker);
      return { asset: curated, mint: remoteMint(curated.key), icon: face?.image ?? null, priceUsd: null, mcapUsd: face?.mcapUsd ?? null };
    }
    const at = parseAnyTokenMint(mint);
    if (!at) return null;
    const key = `${at.chain}:${at.address}`;
    const known = this.listings.get(key);
    if (known) return known;
    // A hand-kept share needs no snapshot, so it answers while the snapshot loads.
    if (at.chain === 'base') {
      const ticker = Object.keys(REMOTE_STOCKS).find((k) => REMOTE_STOCKS[k]!.address === at.address);
      if (ticker) return this.stockListing(ticker);
    }
    if (!this.ready) throw new RemoteTokensWarming('The token list is still loading.');
    if (at.chain === 'hyperliquid') {
      const spot = await this.spotMeta();
      const tokenId = spot.tokenIdOf(at.address);
      const coin = tokenId ? this.byId.get(this.idByKey.get(`hltoken:${tokenId}`) ?? '') : undefined;
      const token = tokenId ? spot.token(tokenId) : null;
      return coin && token ? this.listing(coin, 'hyperliquid', token.book, token.szDecimals) : null;
    }
    const coin = this.byId.get(this.idByKey.get(key) ?? '');
    if (coin) return this.listing(coin, at.chain, at.address, await this.decimalsOf(at.chain, at.address));
    return at.chain === 'solana' ? this.fromJupiter(at.address, at.address) : null;
  }

  /** The token's logo from CoinGecko's CDN, fetched through the same allow-list as every other icon. */
  async icon(mint: unknown): Promise<IconBytes | null> {
    const listing = await this.assetOf(mint).catch(() => null);
    if (!listing?.icon) return null;
    const hit = this.icons.get(listing.asset.key);
    if (hit && Date.now() - hit.at < ICON_TTL_MS) return hit.value;
    const value = await fetchIcon(this.fetchFn, listing.icon);
    if (this.icons.size > 500) this.icons.clear();
    this.icons.set(listing.asset.key, { at: Date.now(), value });
    return value;
  }

  private async fromCoin(coin: Coin): Promise<RemoteListing | null> {
    if (isDollar(coin)) return null;
    const places = this.places.get(coin.id) ?? [];
    const reachable = places.filter((p) => p.chain !== 'hyperliquid');
    // Hyperliquid's book only for a coin that lives nowhere else we reach
    // (PURR): PENGU is listed there too, but its market is on Solana.
    if (reachable.length === 0) {
      const hl = places.find((p) => p.chain === 'hyperliquid');
      const token = hl ? (await this.spotMeta()).token(hl.address) : null;
      return token ? this.listing(coin, 'hyperliquid', token.book, token.szDecimals) : null;
    }
    const pick = reachable.length === 1 ? reachable[0]! : await this.deepest(reachable);
    return this.listing(coin, pick.chain, pick.address, await this.decimalsOf(pick.chain, pick.address));
  }

  /** A hand-kept tokenized stock on Base (REMOTE_STOCKS); no snapshot needed. */
  private async stockListing(ticker: string): Promise<RemoteListing> {
    const s = REMOTE_STOCKS[ticker]!;
    const coin: Coin = { id: `stock:${ticker}`, symbol: ticker, name: s.name, image: s.icon, priceUsd: null, mcapUsd: null };
    return this.listing(coin, 'base', s.address, await this.decimalsOf('base', s.address));
  }

  /** Verified Solana tokens past the snapshot, by ticker, or by mint when `mint` is given. */
  private async fromJupiter(query: string, mint?: string): Promise<RemoteListing | null> {
    const rows = await this.json(`${JUP}?query=${encodeURIComponent(query)}`);
    const best = (Array.isArray(rows) ? rows : [])
      .map(obj)
      .filter((r): r is Record<string, unknown> => r !== null)
      .filter((r) => (mint ? r.id === mint : text(r.symbol, 20).toUpperCase() === query))
      .filter((r) => r.isVerified === true && (num(r.mcap) ?? 0) >= JUP_MIN_MCAP_USD && num(r.decimals) !== null)
      .sort((a, b) => (num(b.mcap) ?? 0) - (num(a.mcap) ?? 0))[0];
    if (!best) return null;
    const address = text(best.id, 60);
    const symbol = text(best.symbol, 20).toUpperCase();
    if (!anyTokenKey('solana', address) || !/^[A-Z0-9]{2,10}$/.test(symbol)) return null;
    this.decimals.set(`solana:${address}`, num(best.decimals)!);
    const coin: Coin = {
      id: `jupiter:${address}`,
      symbol,
      name: text(best.name) || symbol,
      image: text(best.icon, 500) || null,
      priceUsd: num(best.usdPrice),
      mcapUsd: num(best.mcap),
    };
    return this.listing(coin, 'solana', address, num(best.decimals)!);
  }

  private listing(coin: Coin, chain: RemoteChain, address: string, decimals: number): RemoteListing {
    const key = anyTokenKey(chain, address);
    if (!key) throw new Error(`not a ${chain} address: ${address}`);
    const asset: RemoteAsset = { key, ticker: coin.symbol, name: coin.name, chain, venue: VENUE_OF[chain], address, decimals };
    const listing: RemoteListing = { asset, mint: remoteMint(key), icon: coin.image, priceUsd: coin.priceUsd, mcapUsd: coin.mcapUsd };
    if (this.listings.size > 5_000) this.listings.clear();
    this.listings.set(key, listing);
    return listing;
  }

  /** Of a coin's contracts, the one with the deepest pools. DexScreener down: CoinGecko's first, its home chain. */
  private async deepest(places: Place[]): Promise<Place> {
    const depth = await Promise.all(
      places.map(async (p) => {
        const chain = DEX_CHAIN[p.chain];
        if (!chain) return 0;
        const pairs = await this.json(`https://api.dexscreener.com/tokens/v1/${chain}/${p.address}`).catch(() => null);
        let sum = 0;
        for (const raw of Array.isArray(pairs) ? pairs : []) {
          const pair = obj(raw);
          const base = text(obj(pair?.baseToken)?.address, 60);
          const same = p.chain === 'solana' ? base === p.address : base.toLowerCase() === p.address;
          if (same) sum += num(obj(pair?.liquidity)?.usd) ?? 0;
        }
        return sum;
      }),
    );
    const tradable = (i: number) => (places[i]!.chain === 'base' || places[i]!.chain === 'arbitrum') && depth[i]! >= TRADABLE_MIN_LIQUIDITY_USD;
    const pool = places.map((_, i) => i).filter(tradable);
    const among = pool.length > 0 ? pool : places.map((_, i) => i);
    let best = among[0]!;
    for (const i of among) if (depth[i]! > depth[best]!) best = i;
    return places[best]!;
  }

  private async decimalsOf(chain: RemoteChain, address: string): Promise<number> {
    const key = `${chain}:${address}`;
    const hit = this.decimals.get(key);
    if (hit !== undefined) return hit;
    let d: number;
    if (chain === 'solana') {
      const rows = await this.json(`${JUP}?query=${encodeURIComponent(address)}`);
      const row = (Array.isArray(rows) ? rows : []).map(obj).find((r) => r?.id === address);
      const n = num(row?.decimals);
      if (n === null) throw new Error(`no decimals for ${address}`);
      d = n;
    } else if (chain === 'hyperliquid') {
      throw new Error('Hyperliquid books carry their own decimals');
    } else {
      d = Number(await this.evmDecimals(chain, address));
    }
    if (!Number.isInteger(d) || d < 0 || d > 36) throw new Error(`odd decimals ${d} for ${key}`);
    this.decimals.set(key, d);
    return d;
  }

  /** Hyperliquid's spot tokens, each with the USDC book it trades in. */
  private async spotMeta(): Promise<{ token(tokenId: string): SpotToken | null; tokenIdOf(book: string): string | null }> {
    if (!this.spot || Date.now() - this.spot.at > SPOT_TTL_MS) {
      const meta = obj(await this.json(HL, { type: 'spotMeta' }));
      const tokens = Array.isArray(meta?.tokens) ? meta.tokens.map(obj) : [];
      const universe = Array.isArray(meta?.universe) ? meta.universe.map(obj) : [];
      const bookOf = new Map<number, string>();
      for (const u of universe) {
        const pair = Array.isArray(u?.tokens) ? u.tokens : [];
        // Token 0 is USDC: the book that sells this token for USDC.
        if (pair.length === 2 && pair[1] === 0 && typeof pair[0] === 'number' && typeof u?.name === 'string') bookOf.set(pair[0], u.name);
      }
      const byTokenId = new Map<string, SpotToken>();
      const tokenIdOfBook = new Map<string, string>();
      for (const t of tokens) {
        const tokenId = text(t?.tokenId, 40).toLowerCase();
        const book = typeof t?.index === 'number' ? bookOf.get(t.index) : undefined;
        if (!tokenId || !book) continue;
        byTokenId.set(tokenId, { name: text(t?.name, 20), book, szDecimals: num(t?.szDecimals) ?? 2 });
        tokenIdOfBook.set(book, tokenId);
      }
      this.spot = { at: Date.now(), byTokenId, tokenIdOfBook };
    }
    const spot = this.spot;
    return { token: (id) => spot.byTokenId.get(id) ?? null, tokenIdOf: (book) => spot.tokenIdOfBook.get(book) ?? null };
  }

  private client(chain: 'base' | 'ethereum' | 'arbitrum'): PublicClient {
    let c = this.clients.get(chain);
    if (!c) {
      c = createPublicClient({ transport: http(RPC[chain], { timeout: 8_000 }) });
      this.clients.set(chain, c);
    }
    return c;
  }

  private async coingecko(url: string): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchFn(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 && attempt < 4) {
        await this.sleep(this.backoffMs);
        continue;
      }
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      return res.json();
    }
  }

  private async json(url: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchFn(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...UA, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
    return res.json();
  }
}
