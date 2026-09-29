import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ARC_CCTP_DOMAIN, CHAINS, type RemoteAsset } from './remote';

/**
 * THE ROUTE FROM A READER'S ARC BALANCE TO AN ASSET ON ANOTHER CHAIN, PRICED.
 *
 * Two legs, each priced by whoever runs it:
 *   1. Arc to the asset's chain over CCTP. The fee is Circle's own answer for
 *      that pair of domains (iris-api /v2/burn/USDC/fees), read every ten
 *      minutes. Measured 2026-09-29: 0 from Arc to Solana, Base, Ethereum
 *      and HyperEVM.
 *   2. USDC to the asset on its home venue: Jupiter's quote on Solana,
 *      KyberSwap's route on Base and Ethereum (with the network fee it
 *      estimates), Hyperliquid's mid price for HYPE.
 *
 * A preview is kept fifteen seconds per asset and amount, so a room that
 * several people open at once asks each venue once.
 */

export interface RouteLeg {
  kind: 'bridge' | 'swap';
  /** "Arc to Solana, over CCTP" / "USDC to SOL on Jupiter". */
  label: string;
  detail: string;
  feeUsd: number | null;
}

export interface RoutePreview {
  asset: { key: string; ticker: string; name: string; chain: string };
  amountUsd: number;
  legs: RouteLeg[];
  /** What the reader would receive, in whole units, as the venue quoted it. */
  outAmount: number;
  outUsd: number | null;
  priceUsd: number;
  cctpFeeUsd: number;
  /** The destination's own network fee for the swap, when the venue estimates one. */
  networkFeeUsd: number | null;
  priceImpactPct: number | null;
  /** False until trades on other chains open (Circle Wallets on mainnet). */
  available: false;
  note: string;
  quotedAt: string;
}

const UA = { 'user-agent': 'poppin-arc/1.0 (+https://github.com/vercettilev/poppinarc)' };
const TTL_MS = 15_000;
const FEE_TTL_MS = 10 * 60_000;
/** A Solana swap's network fee, priority included, measured in cents at most. */
const SOLANA_FEE_USD = 0.002;

type Fetch = typeof fetch;

@Injectable()
export class RouteQuotes {
  private readonly logger = new Logger('routes');
  private readonly previews = new Map<string, { at: number; value: Promise<RoutePreview> }>();
  private readonly fees = new Map<number, { at: number; bps: number }>();
  fetchFn: Fetch = (...a) => fetch(...a);

  preview(asset: RemoteAsset, amountUsd: number): Promise<RoutePreview> {
    if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 10_000) {
      return Promise.reject(new UnprocessableEntityException('Pick an amount between $1 and $10,000.'));
    }
    const key = `${asset.key}:${amountUsd}`;
    const hit = this.previews.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = this.build(asset, amountUsd);
    this.previews.set(key, { at: Date.now(), value });
    value.catch(() => this.previews.delete(key));
    if (this.previews.size > 500) this.previews.clear();
    return value;
  }

  /** A whole unit's price, from a $10 route. */
  async priceUsd(asset: RemoteAsset): Promise<number> {
    return (await this.preview(asset, 10)).priceUsd;
  }

  private async build(asset: RemoteAsset, amountUsd: number): Promise<RoutePreview> {
    const chain = CHAINS[asset.chain];
    const [bps, swap] = await Promise.all([this.cctpFeeBps(chain.cctpDomain), this.swap(asset, amountUsd)]);
    const cctpFeeUsd = (amountUsd * bps) / 10_000;
    if (!(swap.outAmount > 0)) throw new UnprocessableEntityException('This route cannot be priced right now.');
    return {
      asset: { key: asset.key, ticker: asset.ticker, name: asset.name, chain: chain.label },
      amountUsd,
      legs: [
        {
          kind: 'bridge',
          label: `Arc to ${chain.label}, over CCTP`,
          detail: `Circle burns your USDC on Arc and mints the same USDC on ${chain.label}.`,
          feeUsd: cctpFeeUsd,
        },
        {
          kind: 'swap',
          label: `USDC to ${asset.ticker} on ${swap.venue}`,
          detail: swap.detail,
          feeUsd: swap.networkFeeUsd,
        },
      ],
      outAmount: swap.outAmount,
      outUsd: swap.outUsd,
      priceUsd: (amountUsd - cctpFeeUsd) / swap.outAmount,
      cctpFeeUsd,
      networkFeeUsd: swap.networkFeeUsd,
      priceImpactPct: swap.priceImpactPct,
      available: false,
      note: `Buying on ${chain.label} from your Arc balance opens with Circle Wallets. The route and every number here are live.`,
      quotedAt: new Date().toISOString(),
    };
  }

  private async cctpFeeBps(domain: number): Promise<number> {
    const hit = this.fees.get(domain);
    if (hit && Date.now() - hit.at < FEE_TTL_MS) return hit.bps;
    const rows = await this.json<Array<{ finalityThreshold?: number; minimumFee?: number }>>(
      `https://iris-api.circle.com/v2/burn/USDC/fees/${ARC_CCTP_DOMAIN}/${domain}`,
    );
    // The fast lane (threshold 1000) when Circle offers it, the standard one otherwise.
    const fast = rows.find((r) => r.finalityThreshold === 1000) ?? rows[0];
    const bps = Number(fast?.minimumFee ?? NaN);
    if (!Number.isFinite(bps) || bps < 0) throw new UnprocessableEntityException('This route cannot be priced right now.');
    this.fees.set(domain, { at: Date.now(), bps });
    return bps;
  }

  private async swap(
    asset: RemoteAsset,
    amountUsd: number,
  ): Promise<{ venue: string; detail: string; outAmount: number; outUsd: number | null; networkFeeUsd: number | null; priceImpactPct: number | null }> {
    const raw = BigInt(Math.round(amountUsd * 1e6)).toString();
    const chain = CHAINS[asset.chain];
    if (asset.venue === 'jupiter') {
      const q = await this.json<{ outAmount?: string; priceImpactPct?: string; swapUsdValue?: string; routePlan?: Array<{ swapInfo?: { label?: string } }> }>(
        `https://lite-api.jup.ag/swap/v1/quote?inputMint=${chain.usdc}&outputMint=${asset.address}&amount=${raw}&slippageBps=50`,
      );
      const via = [...new Set((q.routePlan ?? []).map((r) => r.swapInfo?.label).filter(Boolean))].join(', ');
      return {
        venue: 'Jupiter',
        detail: via ? `Jupiter routes it through ${via}.` : 'Jupiter finds the route.',
        outAmount: Number(q.outAmount ?? 0) / 10 ** asset.decimals,
        outUsd: numberOrNull(q.swapUsdValue),
        networkFeeUsd: SOLANA_FEE_USD,
        priceImpactPct: numberOrNull(q.priceImpactPct),
      };
    }
    if (asset.venue === 'kyber') {
      const slug = asset.chain === 'base' ? 'base' : 'ethereum';
      const r = await this.json<{ code?: number; data?: { routeSummary?: { amountOut?: string; amountOutUsd?: string; gasUsd?: string; route?: Array<Array<{ exchange?: string }>> } } }>(
        `https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?tokenIn=${chain.usdc}&tokenOut=${asset.address}&amountIn=${raw}`,
        { 'x-client-id': 'poppin-arc' },
      );
      const s = r.data?.routeSummary;
      if (r.code !== 0 || !s) throw new UnprocessableEntityException('This route cannot be priced right now.');
      const venues = [...new Set((s.route ?? []).flat().map((h) => h.exchange).filter(Boolean))].slice(0, 3).join(', ');
      return {
        venue: 'KyberSwap',
        detail: venues ? `KyberSwap routes it through ${venues} on ${chain.label}.` : `KyberSwap finds the route on ${chain.label}.`,
        outAmount: Number(s.amountOut ?? 0) / 10 ** asset.decimals,
        outUsd: numberOrNull(s.amountOutUsd),
        networkFeeUsd: numberOrNull(s.gasUsd),
        priceImpactPct: null,
      };
    }
    const mids = await this.json<Record<string, string>>('https://api.hyperliquid.xyz/info', undefined, { type: 'allMids' });
    const mid = Number(mids[asset.address]);
    if (!(mid > 0)) throw new UnprocessableEntityException('This route cannot be priced right now.');
    return {
      venue: 'Hyperliquid',
      detail: 'At the middle of Hyperliquid\'s own book; the fill moves with the book.',
      outAmount: amountUsd / mid,
      outUsd: amountUsd,
      networkFeeUsd: null,
      priceImpactPct: null,
    };
  }

  private async json<T>(url: string, headers: Record<string, string> = {}, body?: unknown): Promise<T> {
    try {
      const res = await this.fetchFn(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...UA, ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      this.logger.warn(`${new URL(url).host}: ${(e as Error)?.message ?? e}`);
      throw new UnprocessableEntityException('This route cannot be priced right now.');
    }
  }
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

