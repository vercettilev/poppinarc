import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, FirebaseAuthGuard, type AuthedUser } from '../auth/firebase-auth.guard';
import { isMajorTicker } from '../market/market.service';
import { MARKET, type AssetView, type MarketPort, type SeriesPoint, type SeriesRange } from '../market/market.types';
import { stockShaped } from '../market/stocks';
import type { SpotPositionsResponse } from '../trade/positions';
import {
  SOLANA_USDC_MINT,
  TradeService,
  errorText,
  parseAddress,
  type BalanceResponse,
  type BuyResponse,
  type ConfirmResponse,
  type QuoteResponse,
  type SellResponse,
} from '../trade/trade.service';
import type { Address } from '../trade/types';
import { remoteAssetByTicker, remoteMint } from '../routes/remote';
import { RemoteTokens, type RemoteListing } from '../routes/remote-tokens';
import { RouteQuotes } from '../routes/route-quotes';

/**
 * /embed/asset/*, answered the way the Poppin extension already expects from
 * api.poppin.so, so the extension talks to Arc with nothing but its API URL
 * changed.
 *
 * AUTH IS PER ROUTE, as the extension sends it. swap, sell, balance and
 * positions need a Firebase token (401 without one: /balance on USDC is the
 * page card's sign-in probe). Everything else is public; where the client
 * attaches a token anyway (by-mint, by-ticker, series, confirm, tweet-proof)
 * it is simply not read.
 *
 * Every POST answers 200, every address goes out lowercase, and every error
 * message is one plain string: the extension prints some of them verbatim
 * and matches words in others.
 */

export interface MatchedAsset {
  mint: string;
  symbol: string;
  name: string;
  displayName: string;
  confidence: 'confident';
  certainty: 'exact' | 'inferred';
  score: number;
  change24hPct: number | null;
  indicativeUsd: number | null;
  icon: string | null;
  mcap: number | null;
  holderCount: number | null;
  spark24h: number[] | null;
  safety: {
    liquidityUsd: number | null;
    poolCreatedAtMs: number | null;
    mintAuthorityRetained: null;
    freezeAuthorityRetained: null;
  };
  decimals: number | null;
  issuer: null;
  restrictions: string[];
  matchedDirect: string[];
  matchedThematic: string[];
}

export interface ByMintResponse {
  asset: MatchedAsset | null;
  refused?: { symbol: string; name: string } | null;
}

export type SparkRange = '15m' | '1h' | '4h' | '1d' | '1w' | '1m' | 'max';

export interface SeriesWire {
  points: number[] | null;
  times: number[] | null;
  opens: number[] | null;
  highs: number[] | null;
  lows: number[] | null;
  failed: boolean;
}

/**
 * The extension's seven chart ranges on the market layer's four. The short
 * ones are cut from the next range up, by the candles' own timestamps; 'max'
 * is the longest range there is.
 */
export const SPARK_RANGES: Record<SparkRange, { market: SeriesRange; windowSec: number | null }> = {
  '15m': { market: '1H', windowSec: 15 * 60 },
  '1h': { market: '1H', windowSec: null },
  '4h': { market: '1D', windowSec: 4 * 3600 },
  '1d': { market: '1D', windowSec: null },
  '1w': { market: '1W', windowSec: null },
  '1m': { market: '1M', windowSec: null },
  max: { market: '1M', windowSec: null },
};

const ICON_MAX_BYTES = 1_500_000;
const PRICES_MAX = 50;
/**
 * A token elsewhere this large takes its ticker from an Arc long-tail token
 * that only shares it: a post about $PENGU means the one worth billions, not
 * a launchpad coin on Arc that copied the name.
 */
const FAR_BEATS_ARC_MCAP_USD = 50_000_000;

@Controller('embed/asset')
export class AssetController {
  private readonly logger = new Logger('embed/asset');

  constructor(
    private readonly trade: TradeService,
    @Inject(MARKET) private readonly market: MarketPort,
    private readonly routes: RouteQuotes,
    private readonly tokens: RemoteTokens,
  ) {}

  // ─── discovery ────────────────────────────────────────────────────────────

  /** The strip's remote switch. Read once per page; a malformed answer would be cached and fail closed later. */
  @Get('x-strip-config')
  xStripConfig(): { enabled: boolean; disabledMints: string[] } {
    return { enabled: true, disabledMints: [] };
  }

  /**
   * Cashtag to one tradeable contract. Only a mint that by-mint would
   * describe and /swap would trade comes back; USDC never does, because a
   * chip that buys USDC with USDC is not a trade. An upstream failure is a
   * 503, not null: the chip caches a null for the whole page, but forgets a
   * failure and asks again.
   */
  @Post('by-ticker')
  @HttpCode(200)
  async byTicker(@Body() body: unknown): Promise<{ mint: string | null }> {
    const raw = field(body, 'ticker');
    const key = typeof raw === 'string' ? raw.trim().replace(/^\$/, '').toUpperCase() : '';
    if (!/^[A-Z0-9]{2,10}$/.test(key)) return { mint: null };
    // The hand-kept assets on other chains (routes/remote.ts), before any
    // Arc token that happens to share their ticker.
    const remote = remoteAssetByTicker(key);
    if (remote) return { mint: remoteMint(remote.key) };

    let arc: string | null = null;
    let failed = false;
    try {
      const found = parseAddress(await this.market.resolveTicker(key));
      if (found === this.trade.usdc) return { mint: null };
      if (found && (await this.market.gate(found)).ok) arc = found;
    } catch (e) {
      failed = true;
      this.logger.warn(`by-ticker ${key}: ${errorText(e)}`);
    }
    // Circle's own assets, and a major's canonical Arc contract, are the asset itself: trade it here.
    if (arc && (isMajorTicker(key) || this.market.pinned().some((t) => t.address.toLowerCase() === arc))) return { mint: arc };
    // Any other token, on a chain Arc reaches. A stock's ticker never goes looking there.
    let far: RemoteListing | null = null;
    if (!stockShaped(key)) {
      try {
        far = await this.tokens.byTicker(key);
      } catch (e) {
        failed = true;
        this.logger.warn(`by-ticker ${key} elsewhere: ${errorText(e)}`);
      }
    }
    if (arc) return { mint: far && (far.mcapUsd ?? 0) >= FAR_BEATS_ARC_MCAP_USD ? far.mint : arc };
    if (far) return { mint: far.mint };
    if (failed) throw new ServiceUnavailableException('Lookup unavailable');
    return { mint: null };
  }

  /**
   * The chip's permission slip. asset:null makes the chip remove itself, so
   * it means a real "no": a token nobody can name, or USDC. A token we can
   * name but the gate turns down comes back as `refused` so the token room
   * can say which token it is refusing.
   */
  @Post('by-mint')
  @HttpCode(200)
  async byMint(@Body() body: unknown): Promise<ByMintResponse> {
    const far = await this.farListing(field(body, 'mint'));
    if (far !== undefined) return { asset: far ? await this.describeRemote(far) : null };
    const mint = parseAddress(field(body, 'mint'));
    if (!mint || mint === this.trade.usdc) return { asset: null };
    let view: AssetView | null;
    let verdict: Awaited<ReturnType<MarketPort['gate']>>;
    try {
      [view, verdict] = await Promise.all([this.market.describe(mint), this.market.gate(mint)]);
    } catch (e) {
      this.logger.warn(`by-mint ${mint}: ${errorText(e)}`);
      throw new ServiceUnavailableException('Lookup unavailable');
    }
    const symbol = view?.token.symbol?.trim().replace(/^\$/, '') ?? '';
    if (!view || !symbol) return { asset: null };
    if (!verdict.ok) return { asset: null, refused: { symbol, name: view.token.name || symbol } };
    const decimals = await this.trade.decimalsOf(mint).catch(() => validDecimals(view!.token.decimals));
    return { asset: toMatchedAsset(mint, view, decimals) };
  }

  /**
   * Logo bytes for the chip. The extension's service worker only takes an
   * image/* answer under 1.5 MB, and turns a 404 into "try asset.icon".
   */
  @Get('icon')
  async icon(@Query('mint') mintQ: unknown, @Res() res: Response): Promise<void> {
    const far = typeof mintQ === 'string' && mintQ.startsWith('remote:');
    const mint = far ? null : typeof mintQ === 'string' && mintQ.trim() === SOLANA_USDC_MINT ? this.trade.usdc : parseAddress(mintQ);
    if (!far && !mint) throw new BadRequestException('mint required');
    let icon: { contentType: string; bytes: Buffer } | null;
    try {
      icon = far ? await this.tokens.icon(mintQ) : await this.market.icon(mint!);
    } catch (e) {
      // Not a miss: no cache header, so the chip's one retry can succeed.
      this.logger.warn(`icon ${String(mintQ)}: ${errorText(e)}`);
      res.status(404).end();
      return;
    }
    if (!icon || !/^image\//i.test(icon.contentType) || icon.bytes.length === 0 || icon.bytes.length > ICON_MAX_BYTES) {
      res.status(404).set('Cache-Control', 'public, max-age=300').end();
      return;
    }
    res
      .status(200)
      .set({
        'Content-Type': icon.contentType,
        'Content-Length': String(icon.bytes.length),
        'Cache-Control': 'public, max-age=86400, immutable',
      })
      .end(icon.bytes);
  }

  // ─── trading ──────────────────────────────────────────────────────────────

  /** USDC in, token out, for the price line while the reader types. No sign-in needed. */
  @Post('quote')
  @HttpCode(200)
  async quote(@Body() body: unknown): Promise<QuoteResponse> {
    const far = await this.farListing(field(body, 'mint'));
    if (far === null) throw new UnprocessableEntityException('No route for this asset.');
    if (far) {
      const p = await this.routes.preview(far.asset, Number(field(body, 'amountUsd') ?? 25));
      return { outAmount: p.outAmount, pricePerUnit: p.priceUsd, priceImpactPct: p.priceImpactPct ?? 0, route: p.legs.map((l) => l.label) };
    }
    return this.trade.quote(field(body, 'mint'), field(body, 'amountUsd'));
  }

  /**
   * A mint on another chain, as a listing; undefined when the mint is not a
   * remote one at all, null when it names nothing we would route to. A
   * lookup that could not finish is a 503, so the chip asks again.
   */
  private async farListing(mint: unknown): Promise<RemoteListing | null | undefined> {
    try {
      return await this.tokens.assetOf(mint);
    } catch (e) {
      this.logger.warn(`remote ${String(mint)}: ${errorText(e)}`);
      throw new ServiceUnavailableException('Lookup unavailable');
    }
  }

  /** A remote asset as the chip and the token room read any asset: named, priced, never "exact". */
  private async describeRemote(far: RemoteListing): Promise<MatchedAsset | null> {
    const a = far.asset;
    let price: number | null = null;
    try {
      price = await this.routes.priceUsd(a);
    } catch {
      // The snapshot's price, hours old at most; named without one is still a room.
      price = far.priceUsd;
    }
    return {
      mint: far.mint,
      symbol: a.ticker,
      name: a.name,
      displayName: a.name,
      confidence: 'confident',
      certainty: 'inferred',
      score: 0,
      change24hPct: null,
      indicativeUsd: price,
      icon: far.icon,
      mcap: far.mcapUsd,
      holderCount: null,
      spark24h: null,
      safety: { liquidityUsd: null, poolCreatedAtMs: null, mintAuthorityRetained: null, freezeAuthorityRetained: null },
      decimals: a.decimals,
      issuer: null,
      restrictions: [],
      matchedDirect: [],
      matchedThematic: [],
    };
  }

  /** The publisher embed's form of the same quote. */
  @Get('quote')
  async quoteGet(
    @Query('mint') mint: unknown,
    @Query('amountUsd') amountUsd: unknown,
  ): Promise<QuoteResponse & { mint: string; amountUsd: number }> {
    const q = await this.trade.quote(mint, amountUsd);
    return { mint: parseAddress(mint)!, amountUsd: Number(amountUsd), ...q };
  }

  @Post('swap')
  @HttpCode(200)
  @UseGuards(FirebaseAuthGuard)
  swap(@CurrentUser() user: AuthedUser, @Body() body: unknown): Promise<BuyResponse> {
    // payWith is a legacy field from the Solana product; accepted and ignored.
    return this.trade.buy(user.uid, {
      mint: field(body, 'mint'),
      amountUsd: field(body, 'amountUsd'),
      sourceUrl: field(body, 'sourceUrl'),
      idempotencyKey: field(body, 'idempotencyKey'),
    });
  }

  @Post('sell')
  @HttpCode(200)
  @UseGuards(FirebaseAuthGuard)
  sell(@CurrentUser() user: AuthedUser, @Body() body: unknown): Promise<SellResponse> {
    return this.trade.sell(user.uid, {
      mint: field(body, 'mint'),
      amountRaw: field(body, 'amountRaw'),
      sourceUrl: field(body, 'sourceUrl'),
      idempotencyKey: field(body, 'idempotencyKey'),
    });
  }

  /** Public: the client attaches a token when it has one, and it is not needed. */
  @Post('confirm')
  @HttpCode(200)
  confirm(@Body() body: unknown): Promise<ConfirmResponse> {
    return this.trade.confirm(field(body, 'signature'));
  }

  @Post('balance')
  @HttpCode(200)
  @UseGuards(FirebaseAuthGuard)
  balance(@CurrentUser() user: AuthedUser, @Body() body: unknown): Promise<BalanceResponse> {
    return this.trade.balance(user.uid, field(body, 'mint'));
  }

  // ─── book and charts ──────────────────────────────────────────────────────

  @Post('positions')
  @HttpCode(200)
  @UseGuards(FirebaseAuthGuard)
  positions(@CurrentUser() user: AuthedUser): Promise<SpotPositionsResponse> {
    return this.trade.positions(user.uid);
  }

  /**
   * Candles for one range. A thrown upstream is `failed: true` ("Try again");
   * an empty answer is `failed: false` ("No chart for this range"), which the
   * chip caches for the page.
   */
  @Post('series')
  @HttpCode(200)
  async series(@Body() body: unknown): Promise<SeriesWire> {
    const mint = parseAddress(field(body, 'mint'));
    const rangeIn = field(body, 'range');
    const range: SparkRange =
      typeof rangeIn === 'string' && Object.hasOwn(SPARK_RANGES, rangeIn) ? (rangeIn as SparkRange) : '1d';
    if (!mint) return emptySeries(false);
    let points: SeriesPoint[];
    try {
      points = await this.market.series(mint, SPARK_RANGES[range].market);
    } catch (e) {
      this.logger.warn(`series ${mint} ${range}: ${errorText(e)}`);
      return emptySeries(true);
    }
    return toSeriesWire(points, range, Date.now());
  }

  /**
   * Mid prices for up to 50 mints. Keyed by the string each caller sent
   * (trimmed), because the extension looks answers up by its own key; an
   * unknown or non-positive price is simply absent.
   */
  @Post('prices')
  @HttpCode(200)
  async prices(@Body() body: unknown): Promise<{ prices: Record<string, { usd: number; change24hPct: number | null }> }> {
    const list = field(body, 'mints');
    const keysByMint = new Map<Address, string[]>();
    const seen = new Set<string>();
    for (const m of Array.isArray(list) ? list : []) {
      if (typeof m !== 'string') continue;
      const key = m.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > PRICES_MAX) break;
      const mint = parseAddress(key);
      if (!mint) continue;
      keysByMint.set(mint, [...(keysByMint.get(mint) ?? []), key]);
    }
    if (!keysByMint.size) return { prices: {} };
    let found: Map<Address, number>;
    try {
      found = await this.market.prices([...keysByMint.keys()]);
    } catch (e) {
      this.logger.warn(`prices: ${errorText(e)}`);
      throw new ServiceUnavailableException('Prices unavailable');
    }
    const out: Record<string, { usd: number; change24hPct: number | null }> = {};
    for (const [mint, keys] of keysByMint) {
      const usd = found.get(mint);
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) continue;
      for (const k of keys) out[k] = { usd, change24hPct: null };
    }
    return { prices: out };
  }

  /** Buyers from one post. Not counted on Arc yet; below 3 the client hides the line anyway. */
  @Post('tweet-proof')
  @HttpCode(200)
  tweetProof(): { buyers: number } {
    return { buyers: 0 };
  }
}

// ─── shapes ─────────────────────────────────────────────────────────────────

/**
 * An AssetView in the extension's MatchedAsset shape. by-mint is always an
 * exact, confident match. Mint and freeze authority are Solana ideas with no
 * honest Arc equivalent, so they are null rather than guessed; a price of 0
 * is null, because the chip paints any number as a price.
 */
export function toMatchedAsset(mint: Address, view: AssetView, decimals: number | null): MatchedAsset {
  const t = view.token;
  const symbol = t.symbol.trim().replace(/^\$/, '');
  const name = t.name?.trim() || symbol;
  return {
    mint,
    symbol,
    name,
    displayName: name,
    confidence: 'confident',
    certainty: 'exact',
    score: Number.MAX_SAFE_INTEGER,
    change24hPct: finiteOrNull(view.change24hPct),
    indicativeUsd: positiveOrNull(view.priceUsd),
    icon: typeof t.icon === 'string' && t.icon.startsWith('https://') ? t.icon : null,
    mcap: positiveOrNull(view.mcapUsd),
    holderCount: finiteOrNull(view.holderCount),
    spark24h: Array.isArray(view.spark24h) && view.spark24h.every(Number.isFinite) ? view.spark24h : null,
    safety: {
      liquidityUsd: finiteOrNull(view.liquidityUsd),
      poolCreatedAtMs: finiteOrNull(view.poolCreatedAtMs),
      mintAuthorityRetained: null,
      freezeAuthorityRetained: null,
    },
    decimals,
    issuer: null,
    restrictions: t.kind === 'stock' && Array.isArray(t.restrictions) ? [...t.restrictions] : [],
    matchedDirect: [],
    matchedThematic: [],
  };
}

/**
 * Candles to the wire. Times go out in epoch milliseconds, oldest first, and
 * opens/highs/lows travel with the closes or not at all. The newest candle is
 * stamped "now" when it is the bucket still in progress, so a trade made a
 * minute ago lands on the chart instead of past its right edge.
 */
export function toSeriesWire(points: SeriesPoint[], range: SparkRange, nowMs: number): SeriesWire {
  let pts = (Array.isArray(points) ? points : [])
    .filter((p) => [p.t, p.o, p.h, p.l, p.c].every((x) => typeof x === 'number' && Number.isFinite(x)))
    .sort((a, b) => a.t - b.t);
  const windowSec = SPARK_RANGES[range].windowSec;
  if (windowSec !== null) {
    const cut = pts.filter((p) => p.t * 1000 >= nowMs - windowSec * 1000);
    // Too few candles inside the window means a thin pool, not no chart:
    // the wider series is the honest picture.
    if (cut.length >= 2) pts = cut;
  }
  if (pts.length < 2) return emptySeries(false);
  const times = pts.map((p) => p.t * 1000);
  const last = times.length - 1;
  const step = times[last] - times[last - 1];
  if (step > 0 && nowMs > times[last] && nowMs - times[last] < step) times[last] = nowMs;
  return {
    points: pts.map((p) => p.c),
    times,
    opens: pts.map((p) => p.o),
    highs: pts.map((p) => p.h),
    lows: pts.map((p) => p.l),
    failed: false,
  };
}

function emptySeries(failed: boolean): SeriesWire {
  return { points: null, times: null, opens: null, highs: null, lows: null, failed };
}

function field(body: unknown, key: string): unknown {
  return body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function positiveOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function validDecimals(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
}
