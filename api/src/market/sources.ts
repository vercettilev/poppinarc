import type { Address } from '../trade/types';

/**
 * Where market facts come from, and how we keep being allowed to ask.
 *
 * Three public, keyless sources, each with a different job, measured against
 * Arc mainnet on 2026-09-28:
 *   - DexScreener (chainId "arc", documented at 300 requests/min): every pair
 *     of a token with `liquidity.quote`, the USDC actually sitting in the pool.
 *     That one number tells a real market from a spoofed one; volume and
 *     `liquidity.usd` do not (16 of the top 20 Arc pools by volume held under
 *     $1.10 of USDC). Search answers are cached 60 s upstream, the rest 30 s.
 *   - GeckoTerminal (network "arc", about 10 calls/min per IP without a key,
 *     and we saw 429 after 6 calls in 20 s): candles and token faces (image,
 *     holders). The budget here is the tightest thing in the service, so every
 *     answer is cached and served stale while we back off.
 *   - CoinGecko (/coins/list, 57 Arc coins): the short list of contracts a
 *     human has vetted, used to break ties between tokens sharing a ticker and
 *     to name the canonical contract of a major asset.
 *
 * Nothing here decides what may be traded. Sources report; MarketService
 * judges.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Clock = () => number;
export type SourceName = 'dexscreener' | 'geckoterminal' | 'coingecko';

/**
 * Who is waiting. A chart the reader just opened is `active`; a sparkline or
 * a holder count filled in on the side is `passive` and may only use part of
 * a budget, so passive work can never starve the chart.
 */
export type Priority = 'active' | 'passive';

export class UpstreamError extends Error {
  constructor(
    readonly source: SourceName,
    message: string,
    readonly status: number | null = null,
  ) {
    super(`${source}: ${message}`);
    this.name = 'UpstreamError';
  }
}

/** Arc's native currency is USDC; a v4 pool paired with it holds real USDC. */
export const NATIVE_USDC = '0x0000000000000000000000000000000000000000' as Address;

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
/** v2/v3 pools are contracts (20 bytes); v4 pools are ids (32 bytes). */
const POOL_RE = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The one address form this service speaks: lowercase 0x + 40 hex, or null. */
export function toAddress(value: unknown): Address | null {
  if (typeof value !== 'string') return null;
  const a = value.trim().toLowerCase();
  return ADDRESS_RE.test(a) ? (a as Address) : null;
}

// ─── caching, coalescing, budgets ──────────────────────────────────────────

interface Slot<V> {
  value: V;
  at: number;
  ttlMs: number;
}

/**
 * A map whose entries go stale instead of vanishing. `fresh` answers inside
 * the TTL; `stale` keeps answering for longer, which is what lets a 429 turn
 * into a slightly old number instead of a missing one. Oldest entries are
 * dropped past `maxEntries` so a crawl over every token on Arc cannot grow
 * memory without bound.
 */
export class TtlCache<V> {
  private readonly slots = new Map<string, Slot<V>>();

  constructor(
    private readonly now: Clock,
    private readonly maxEntries = 5_000,
  ) {}

  fresh(key: string): { value: V } | undefined {
    const s = this.slots.get(key);
    return s && this.now() - s.at < s.ttlMs ? { value: s.value } : undefined;
  }

  stale(key: string, maxAgeMs: number): { value: V } | undefined {
    const s = this.slots.get(key);
    return s && this.now() - s.at <= maxAgeMs ? { value: s.value } : undefined;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.slots.delete(key);
    this.slots.set(key, { value, at: this.now(), ttlMs });
    if (this.slots.size > this.maxEntries) {
      const oldest = this.slots.keys().next().value;
      if (oldest !== undefined) this.slots.delete(oldest);
    }
  }

  delete(key: string): void {
    this.slots.delete(key);
  }

  clear(): void {
    this.slots.clear();
  }
}

/**
 * One request per key at a time. A timeline full of the same cashtag mounts
 * dozens of chips in the same second; they should cost one upstream call.
 */
export class Flights {
  private readonly inflight = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const p = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

export interface RateGateOptions {
  /** Calls allowed in any rolling minute. */
  perMinute: number;
  /** The share of that minute passive work may use. Defaults to all of it. */
  passivePerMinute?: number;
  /** First pause after a 429; doubles on each further 429 up to the max. */
  backoffMs: number;
  maxBackoffMs: number;
}

/**
 * Stays under a source's limit and stops asking after a 429. GeckoTerminal
 * answers 429 with `retry-after: 0`, which is no help, so the pause is ours:
 * it doubles while the source keeps refusing and resets on the first success.
 */
export class RateGate {
  private stamps: number[] = [];
  private blockedUntil = 0;
  private backoff: number;

  constructor(
    private readonly opts: RateGateOptions,
    private readonly now: Clock,
  ) {
    this.backoff = opts.backoffMs;
  }

  /** True when a call may go out now; the call is counted. */
  take(priority: Priority): boolean {
    const t = this.now();
    if (t < this.blockedUntil) return false;
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    const cap =
      priority === 'passive' ? (this.opts.passivePerMinute ?? this.opts.perMinute) : this.opts.perMinute;
    if (this.stamps.length >= cap) return false;
    this.stamps.push(t);
    return true;
  }

  rateLimited(retryAfterMs = 0): void {
    this.blockedUntil = this.now() + Math.max(this.backoff, retryAfterMs);
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs);
  }

  succeeded(): void {
    this.backoff = this.opts.backoffMs;
  }
}

export interface JsonSourceOptions {
  name: SourceName;
  fetch: FetchLike;
  now: Clock;
  gate: RateGate;
  timeoutMs: number;
  /** How old an answer may be and still stand in for a failed request. */
  staleMaxMs: number;
  maxEntries?: number;
}

function retryAfterMs(res: Response): number {
  const s = Number(res.headers.get('retry-after'));
  return Number.isFinite(s) && s > 0 ? Math.min(s, 600) * 1000 : 0;
}

/**
 * GET-and-parse with a cache in front. A 404 is an answer (null, cached like
 * any other); a 429, a 5xx, a timeout or a body in the wrong shape is not, and
 * falls back to the last good answer while one is young enough. Only when
 * there is none does the caller see an UpstreamError, so "the source is down"
 * never reads as "this token does not exist".
 */
export class JsonSource {
  private readonly cache: TtlCache<unknown>;
  /** One request per URL at a time, remembering which share of the budget it spends. */
  private readonly inflight = new Map<string, { done: Promise<unknown>; priority: Priority }>();

  constructor(private readonly o: JsonSourceOptions) {
    this.cache = new TtlCache<unknown>(o.now, o.maxEntries ?? 2_000);
  }

  async get<T>(
    url: string,
    ttlMs: number,
    parse: (raw: unknown) => T,
    priority: Priority = 'active',
  ): Promise<T | null> {
    const hit = this.cache.fresh(url);
    if (hit) return hit.value as T | null;
    const running = this.inflight.get(url);
    if (!running) return this.start(url, ttlMs, parse, priority);
    try {
      return (await running.done) as T | null;
    } catch (e) {
      // A reader's request that joined background work, and the background
      // share turned that work away, still has the share kept for readers.
      const turnedAway = e instanceof UpstreamError && e.status === 429;
      if (priority === 'passive' || running.priority === 'active' || !turnedAway) throw e;
      const again = this.inflight.get(url);
      if (again?.priority === 'active') return (await again.done) as T | null;
      return this.start(url, ttlMs, parse, 'active');
    }
  }

  private start<T>(url: string, ttlMs: number, parse: (raw: unknown) => T, priority: Priority): Promise<T | null> {
    const done = (async (): Promise<T | null> => {
      try {
        const value = await this.load(url, parse, priority);
        this.cache.set(url, value, ttlMs);
        return value;
      } catch (e) {
        const old = this.cache.stale(url, this.o.staleMaxMs);
        if (old) return old.value as T | null;
        throw e instanceof UpstreamError ? e : new UpstreamError(this.o.name, errorText(e));
      }
    })();
    const entry = { done, priority };
    this.inflight.set(url, entry);
    // Registered before any caller awaits `done`, so the slot is free by the time a joiner retries.
    const clear = () => {
      if (this.inflight.get(url) === entry) this.inflight.delete(url);
    };
    done.then(clear, clear);
    return done;
  }

  private async load<T>(url: string, parse: (raw: unknown) => T, priority: Priority): Promise<T | null> {
    const name = this.o.name;
    if (!this.o.gate.take(priority)) throw new UpstreamError(name, 'backing off', 429);
    let res: Response;
    try {
      res = await this.o.fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (e) {
      throw new UpstreamError(name, `request failed: ${errorText(e)}`);
    }
    if (res.status === 429) {
      this.o.gate.rateLimited(retryAfterMs(res));
      throw new UpstreamError(name, 'rate limited', 429);
    }
    if (res.status === 404) {
      this.o.gate.succeeded();
      return null;
    }
    if (!res.ok) throw new UpstreamError(name, `HTTP ${res.status}`, res.status);
    this.o.gate.succeeded();
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new UpstreamError(name, 'answer is not JSON', res.status);
    }
    try {
      return parse(raw);
    } catch (e) {
      throw new UpstreamError(name, `unexpected answer: ${errorText(e)}`, res.status);
    }
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── shape helpers ─────────────────────────────────────────────────────────

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Finite number from a number or a numeric string; NaN never gets through. */
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

// ─── DexScreener ───────────────────────────────────────────────────────────

/** One Arc pool as DexScreener sees it, normalised. */
export interface ArcPair {
  /** Lowercase pool address (v2/v3) or pool id (v4). */
  pool: string;
  dex: string;
  base: { address: Address; symbol: string; name: string };
  quote: Address;
  /** USD per whole base token. Null rather than 0 when unknown. */
  priceUsd: number | null;
  /** Percent, 5.2 means +5.2%. */
  change24hPct: number | null;
  /** `liquidity.quote`: whole quote tokens in the pool. For a USDC quote, the USDC a seller can reach. */
  quoteDepth: number | null;
  liquidityUsd: number | null;
  mcapUsd: number | null;
  createdAtMs: number | null;
  imageUrl: string | null;
}

export function parsePair(raw: unknown): ArcPair | null {
  const p = obj(raw);
  if (!p || p.chainId !== 'arc') return null;
  const pool = str(p.pairAddress)?.toLowerCase() ?? '';
  const base = obj(p.baseToken);
  const quote = obj(p.quoteToken);
  const baseAddress = toAddress(base?.address);
  const quoteAddress = toAddress(quote?.address);
  // Pool ids end up in GeckoTerminal URLs, so anything that is not plain hex is dropped here.
  if (!POOL_RE.test(pool) || !base || !baseAddress || !quoteAddress) return null;
  const liquidity = obj(p.liquidity);
  const price = num(p.priceUsd);
  const created = num(p.pairCreatedAt);
  return {
    pool,
    dex: str(p.dexId) ?? '',
    base: { address: baseAddress, symbol: str(base.symbol) ?? '', name: str(base.name) ?? '' },
    quote: quoteAddress,
    priceUsd: price !== null && price > 0 ? price : null,
    change24hPct: num(obj(p.priceChange)?.h24),
    quoteDepth: num(liquidity?.quote),
    liquidityUsd: num(liquidity?.usd),
    mcapUsd: num(p.marketCap) ?? num(p.fdv),
    createdAtMs: created !== null && created > 0 ? created : null,
    imageUrl: str(obj(p.info)?.imageUrl),
  };
}

function pairsOf(list: unknown): ArcPair[] {
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('pairs is not a list');
  return list.map(parsePair).filter((p): p is ArcPair => p !== null);
}

export class DexScreener {
  static readonly base = 'https://api.dexscreener.com';

  constructor(private readonly http: JsonSource) {}

  /** Arc pairs whose base or quote matches the query. Capped at 30 pairs upstream. */
  async search(query: string, ttlMs: number): Promise<ArcPair[]> {
    const url = `${DexScreener.base}/latest/dex/search?q=${encodeURIComponent(query)}`;
    return (await this.http.get(url, ttlMs, (raw) => pairsOf(obj(raw)?.pairs))) ?? [];
  }

  /** Every Arc pool the token is in, on either side. */
  async tokenPairs(token: Address, ttlMs: number, priority: Priority = 'active'): Promise<ArcPair[]> {
    const url = `${DexScreener.base}/token-pairs/v1/arc/${token}`;
    return (await this.http.get(url, ttlMs, pairsOf, priority)) ?? [];
  }

  /** Up to 30 pools by id in one call: how a batch of known pools is re-priced. */
  async pairs(pools: string[], ttlMs: number, priority: Priority = 'active'): Promise<ArcPair[]> {
    const ids = pools.filter((p) => POOL_RE.test(p)).slice(0, 30);
    if (ids.length === 0) return [];
    const url = `${DexScreener.base}/latest/dex/pairs/arc/${ids.join(',')}`;
    return (
      (await this.http.get(
        url,
        ttlMs,
        (raw) => {
          const body = obj(raw);
          return pairsOf(body?.pairs ?? (body?.pair ? [body.pair] : null));
        },
        priority,
      )) ?? []
    );
  }
}

// ─── GeckoTerminal ─────────────────────────────────────────────────────────

export type Timeframe = 'minute' | 'hour' | 'day';

export interface Candle {
  /** Unix seconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface GtTokenInfo {
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  /** Largest first; callers filter them through allowedIconUrl. */
  imageUrls: string[];
  holderCount: number | null;
}

/** GeckoTerminal answers newest first; everything past this point is oldest first, one candle per time. */
export function parseCandles(raw: unknown): Candle[] {
  const list = obj(obj(obj(raw)?.data)?.attributes)?.ohlcv_list;
  if (!Array.isArray(list)) throw new Error('ohlcv_list missing');
  const byTime = new Map<number, Candle>();
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.slice(0, 6).map(num);
    if (t === null || o === null || h === null || l === null || c === null || t <= 0) continue;
    byTime.set(t, { t, o, h, l, c, v: v ?? 0 });
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function parseTokenInfo(raw: unknown): GtTokenInfo {
  const a = obj(obj(obj(raw)?.data)?.attributes);
  if (!a) throw new Error('token attributes missing');
  const image = obj(a.image);
  const urls = [str(a.image_url), str(image?.large), str(image?.small)].filter(
    (u): u is string => typeof u === 'string' && u.startsWith('https://'),
  );
  const decimals = num(a.decimals);
  const holders = num(obj(a.holders)?.count);
  return {
    symbol: str(a.symbol),
    name: str(a.name),
    decimals: decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null,
    imageUrls: [...new Set(urls)],
    holderCount: holders !== null && holders >= 0 ? Math.round(holders) : null,
  };
}

export class GeckoTerminal {
  static readonly base = 'https://api.geckoterminal.com/api/v2/networks/arc';

  constructor(private readonly http: JsonSource) {}

  /**
   * Candles for `token` in one pool, oldest first; null when GeckoTerminal
   * does not index the pool. `token=` pins the side, because GeckoTerminal's
   * base/quote order is its own and need not match DexScreener's.
   */
  ohlcv(
    pool: string,
    timeframe: Timeframe,
    aggregate: number,
    limit: number,
    token: Address,
    ttlMs: number,
    priority: Priority,
  ): Promise<Candle[] | null> {
    if (!POOL_RE.test(pool)) return Promise.resolve(null);
    const url =
      `${GeckoTerminal.base}/pools/${pool}/ohlcv/${timeframe}` +
      `?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${token}`;
    return this.http.get(url, ttlMs, parseCandles, priority);
  }

  tokenInfo(token: Address, ttlMs: number, priority: Priority): Promise<GtTokenInfo | null> {
    return this.http.get(`${GeckoTerminal.base}/tokens/${token}/info`, ttlMs, parseTokenInfo, priority);
  }
}

// ─── CoinGecko ─────────────────────────────────────────────────────────────

export interface CgListing {
  id: string;
  symbol: string;
  name: string;
  address: Address;
}

export function parseArcListings(raw: unknown): CgListing[] {
  if (!Array.isArray(raw)) throw new Error('coins list is not a list');
  const out: CgListing[] = [];
  for (const row of raw) {
    const c = obj(row);
    const address = toAddress(obj(c?.platforms)?.arc);
    const id = str(c?.id);
    if (!c || !address || !id) continue;
    out.push({ id, symbol: str(c.symbol) ?? '', name: str(c.name) ?? '', address });
  }
  return out;
}

export class CoinGecko {
  /** About 4 MB for every coin; only the Arc rows are kept. */
  static readonly listUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';

  constructor(private readonly http: JsonSource) {}

  async arcListings(ttlMs: number): Promise<CgListing[]> {
    return (await this.http.get(CoinGecko.listUrl, ttlMs, parseArcListings)) ?? [];
  }
}

// ─── icons ─────────────────────────────────────────────────────────────────

/**
 * The only hosts an icon is fetched from. Every icon URL we hand out comes
 * from GeckoTerminal or DexScreener, and today they point at these:
 *   coin-images.coingecko.com  CoinGecko's image CDN (GeckoTerminal image_url)
 *   assets.coingecko.com       CoinGecko's older image host
 *   assets.geckoterminal.com   GeckoTerminal's own uploads, for tokens without a CoinGecko page
 *   cdn.dexscreener.com        DexScreener profile images (info.imageUrl)
 *   dd.dexscreener.com         DexScreener token images
 *
 * WHY A LIST AND NOT "ANY HTTPS URL". The server fetches these on a reader's
 * behalf, and a token's creator chooses its image URL. An open fetch would let
 * anyone point this service at a private address (metadata endpoints, the
 * database) or at a slow or huge file. With a fixed list of public CDNs, and
 * redirects followed only to the same list, no request ever leaves for a
 * private address. IP literals are refused outright.
 */
export const ICON_HOSTS: readonly string[] = [
  'coin-images.coingecko.com',
  'assets.coingecko.com',
  'assets.geckoterminal.com',
  'cdn.dexscreener.com',
  'dd.dexscreener.com',
];

export function allowedIconUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  return ICON_HOSTS.includes(u.hostname.toLowerCase()) ? u : null;
}

/**
 * DexScreener's profile images are served at whatever size the query asks
 * for; the default in `info.imageUrl` is 800x800, which is past our byte cap
 * and far past what a chip draws.
 */
function sizedForIcon(u: URL): URL {
  if (u.hostname === 'cdn.dexscreener.com' && u.pathname.startsWith('/cms/images/')) {
    const s = new URL(u.toString());
    s.searchParams.set('width', '256');
    s.searchParams.set('height', '256');
    s.searchParams.set('quality', '90');
    return s;
  }
  return u;
}

/**
 * What the bytes are, from their first bytes. The type we send back comes
 * from here, not from the upstream header, so an HTML page labelled image/png
 * is refused. SVG is refused by design: it can carry script, and these bytes
 * are served from our own origin.
 */
export function sniffImage(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6) {
    const head = b.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  return null;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }
    return Buffer.concat(chunks);
  }
  try {
    const ab = await res.arrayBuffer();
    return ab.byteLength > maxBytes ? null : Buffer.from(ab);
  } catch {
    return null;
  }
}

export interface IconBytes {
  contentType: string;
  bytes: Buffer;
}

export interface IconFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export const ICON_MAX_BYTES = 256 * 1024;

/**
 * Image bytes from an allowed host, or null. The whole exchange, redirects
 * and body included, shares one deadline, and the body is read in chunks so
 * a file past the cap is dropped without being held in memory.
 */
export async function fetchIcon(
  fetchImpl: FetchLike,
  rawUrl: string,
  opts: IconFetchOptions = {},
): Promise<IconBytes | null> {
  const maxBytes = opts.maxBytes ?? ICON_MAX_BYTES;
  const allowed = allowedIconUrl(rawUrl);
  if (!allowed) return null;
  let url = sizedForIcon(allowed);
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 5_000);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 2); hop++) {
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: deadline,
        headers: { accept: 'image/png,image/webp,image/jpeg,image/gif,image/avif;q=0.9' },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      let next: URL | null = null;
      try {
        next = location ? allowedIconUrl(new URL(location, url).toString()) : null;
      } catch {
        next = null;
      }
      if (!next) return null;
      url = next;
      continue;
    }
    if (res.status !== 200) return null;
    const declared = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!declared.startsWith('image/') || declared.includes('svg')) return null;
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) return null;
    const bytes = await readCapped(res, maxBytes);
    if (!bytes || bytes.length === 0) return null;
    const type = sniffImage(bytes);
    return type ? { contentType: type, bytes } : null;
  }
  return null;
}
