import type { Address, ArcToken } from '../trade/types';

/**
 * What the chip and the panel need to know about a token before anyone may
 * press Buy: its face, its price, and whether we let it be traded at all.
 *
 * THE GATE DECIDES, THE MAP ONLY NAMES. Same rule as the Solana chip: a
 * cashtag resolves to at most one contract, and that contract must still pass
 * a live check (a sell quote exists, a round trip does not lose too much, the
 * USDC side is deep enough) before a Buy button is drawn. On Arc this is not
 * caution for its own sake: on 2026-09-28, 16 of GeckoTerminal's top 20 Arc
 * pools by volume held under $1.10 of real USDC, and several top memecoins
 * could be bought but not sold.
 */

export interface AssetView {
  token: ArcToken;
  /** USD per whole token. */
  priceUsd: number | null;
  /** Percent, 5.2 means +5.2%. */
  change24hPct: number | null;
  mcapUsd: number | null;
  holderCount: number | null;
  /** USDC-side depth of the pool we route through, in USD. */
  liquidityUsd: number | null;
  poolCreatedAtMs: number | null;
  /** Hourly closes over 24h, oldest first. */
  spark24h: number[] | null;
}

export type GateVerdict = { ok: true } | { ok: false; reason: string };

export interface SeriesPoint {
  /** Unix seconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type SeriesRange = '1H' | '1D' | '1W' | '1M';

export interface MarketPort {
  /** Cashtag or name (with or without "$", any case) to at most one Arc contract. */
  resolveTicker(ticker: string): Promise<Address | null>;
  /** Face and price for one token; null when we cannot describe it. */
  describe(address: Address): Promise<AssetView | null>;
  /** The live permission slip. Circle assets always pass. */
  gate(address: Address): Promise<GateVerdict>;
  /** USD prices for many tokens at once; missing entries mean unknown. */
  prices(addresses: Address[]): Promise<Map<Address, number>>;
  series(address: Address, range: SeriesRange): Promise<SeriesPoint[]>;
  /** Logo bytes for the extension's icon route, or null. */
  icon(address: Address): Promise<{ contentType: string; bytes: Buffer } | null>;
  /** Tokens pinned by us (USDC, EURC, cirBTC, allowlisted stocks), for the ticker map. */
  pinned(): ArcToken[];
}

export const MARKET = Symbol('MARKET');
