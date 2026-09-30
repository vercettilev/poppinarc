import type { HeldToken } from '../trade/positions';

/**
 * What a reader holds on the chains Arc reaches, as rows the book already
 * knows how to price and total (trade/positions.ts). A port, so the trade
 * service can ask without importing the far trades that import it.
 */
export const FAR_HOLDINGS = Symbol('FAR_HOLDINGS');

export interface FarHoldingsPort {
  /** `mints` are the ledger's remote mints for this reader; only those still held come back. */
  held(owner: `0x${string}`, mints: string[]): Promise<HeldToken[]>;
}
