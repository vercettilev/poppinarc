import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ARC_CCTP_DOMAIN, CHAINS, type RemoteAsset } from './remote';

/**
 * THE ROUTE FROM A READER'S ARC BALANCE TO AN ASSET ON ANOTHER CHAIN, PRICED.
 *
 * Two legs, each priced by whoever runs it:
 *   1. Arc to the asset's chain over CCTP, delivered there by Circle's
 *      Forwarding Service so the reader needs no gas on that chain to receive
 *      it. Both fees are Circle's own answer for that pair of domains
 *      (iris-api /v2/burn/USDC/fees?forward=true), read every ten minutes.
 *      Measured 2026-09-30: CCTP 0 everywhere from Arc; forwarding about
 *      $0.06 to Base, $0.08 to Arbitrum, $0.14 to Solana, $0.25 into a
 *      Hyperliquid account, $0.8-1.5 to Ethereum.
 *   2. What arrives, swapped on the asset's home venue: Jupiter's quote on
 *      Solana, KyberSwap's route on Base, Ethereum and Arbitrum (with the
 *      network fee it estimates), the mid of Hyperliquid's own book.
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
  /** Circle's Forwarding Service, which delivers the USDC on the far chain. */
  forwardFeeUsd: number;
  /** The destination's own network fee for the swap, when the venue estimates one. */
  networkFeeUsd: number | null;
  priceImpactPct: number | null;
  /** False until trades on other chains open. */
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

interface BridgeFees {
  bps: number;
  forwardUsd: number;
}

@Injectable()
export class RouteQuotes {
  private readonly logger = new Logger('routes');
  private readonly previews = new Map<string, { at: number; value: Promise<RoutePreview> }>();
  private readonly fees = new Map<string, { at: number; value: BridgeFees }>();
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
    const fees = await this.bridgeFees(chain.cctpDomain, asset.chain === 'hyperliquid');
    const cctpFeeUsd = (amountUsd * fees.bps) / 10_000;
    // The forwarding fee comes out of the USDC that lands, so the swap spends what is left.
    const arrives = Math.floor((amountUsd - cctpFeeUsd - fees.forwardUsd) * 1e6) / 1e6;
    if (!(arrives >= 0.5)) {
      throw new UnprocessableEntityException(`Circle's fees to ${chain.label} are about $${(cctpFeeUsd + fees.forwardUsd).toFixed(2)}. Pick a larger amount.`);
    }
    const swap = await this.swap(asset, arrives);
    if (!(swap.outAmount > 0)) throw new UnprocessableEntityException('This route cannot be priced right now.');
    const into = asset.chain === 'hyperliquid' ? 'into your Hyperliquid account' : `on ${chain.label}`;
    return {
      asset: { key: asset.key, ticker: asset.ticker, name: asset.name, chain: chain.label },
      amountUsd,
      legs: [
        {
          kind: 'bridge',
          label: `Arc to ${chain.label}, over CCTP`,
          detail: `Circle burns your USDC on Arc and mints it ${into}, delivered by its Forwarding Service.`,
          feeUsd: cctpFeeUsd + fees.forwardUsd,
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
      priceUsd: arrives / swap.outAmount,
      cctpFeeUsd,
      forwardFeeUsd: fees.forwardUsd,
      networkFeeUsd: swap.networkFeeUsd,
      priceImpactPct: swap.priceImpactPct,
      available: false,
      note: `Buying on ${chain.label} from your Arc balance comes next. The route and every number here are live.`,
      quotedAt: new Date().toISOString(),
    };
  }

  /** CCTP's own fee in basis points, and the Forwarding Service's in dollars (Circle quotes it in USDC units). */
  private async bridgeFees(domain: number, hyperCore: boolean): Promise<BridgeFees> {
    const key = `${domain}:${hyperCore}`;
    const hit = this.fees.get(key);
    if (hit && Date.now() - hit.at < FEE_TTL_MS) return hit.value;
    const rows = await this.json<Array<{ finalityThreshold?: number; minimumFee?: number; forwardFee?: { med?: number } }>>(
      `https://iris-api.circle.com/v2/burn/USDC/fees/${ARC_CCTP_DOMAIN}/${domain}?forward=true${hyperCore ? '&hyperCoreDeposit=true' : ''}`,
    );
    // The fast lane (threshold 1000) when Circle offers it, the standard one otherwise.
    const fast = rows.find((r) => r.finalityThreshold === 1000) ?? rows[0];
    const bps = Number(fast?.minimumFee ?? NaN);
    const forwardUsd = Number(fast?.forwardFee?.med ?? 0) / 1e6;
    if (!Number.isFinite(bps) || bps < 0 || !Number.isFinite(forwardUsd) || forwardUsd < 0) {
      throw new UnprocessableEntityException('This route cannot be priced right now.');
    }
    const value = { bps, forwardUsd };
    this.fees.set(key, { at: Date.now(), value });
    return value;
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
      const slug = asset.chain === 'base' ? 'base' : asset.chain === 'arbitrum' ? 'arbitrum' : 'ethereum';
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

