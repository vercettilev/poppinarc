import { formatUnits } from 'viem';
import type { ActionRow } from './actions';
import type { Address, TokenKind } from './types';

/**
 * THE BOOK: what a reader holds, what it cost, and what it is worth now.
 *
 * Holdings come from the chain (the wallet's ERC-20 balances); cost comes from
 * our own ledger of buys and sells (ActionsStore). The two can disagree, for
 * example when tokens arrive from outside Poppin, so the book is built from
 * the chain and the ledger only annotates it: a position with no ledger rows
 * still shows, it just has no entry price.
 *
 * The response shape is the extension's SpotPositionsResponse, byte for byte.
 * Three rules it depends on without saying so:
 * - cash is spendable USDC and nothing else, and it is never a row, only
 *   `cashUsd`: the client adds `totalUsd + cashUsd` and would count it
 *   twice, and it sizes the Max buy from `cashUsd`, so anything else there
 *   (EURC, say) would offer money /swap cannot spend. EURC is a row;
 * - rows are sorted by value, largest first, because the panel renders in
 *   wire order;
 * - an unpriced row says null, never 0, so it reads as "unknown" instead of
 *   "worthless".
 */

export interface SpotPosition {
  mint: string;
  ticker: string;
  displayName: string;
  category: string;
  uiAmount: number;
  raw: string;
  decimals: number | null;
  priceUsd: number | null;
  valueUsd: number | null;
  change24hPct: number | null;
  netInvestedUsd: number | null;
  entryMcapUsd: number | null;
  pnlUsd: number | null;
  realizedPnlUsd: number | null;
  avgEntryPriceUsd: number | null;
  callerSourceUrl: string | null;
  unrealizedPnlUsd: number | null;
}

export interface SpotPositionsResponse {
  positions: SpotPosition[];
  totalUsd: number;
  totalPnlUsd: number | null;
  totalUnrealizedPnlUsd: number | null;
  totalRealizedPnlUsd: number | null;
  cashUsd: number;
  /** Read by nothing on Arc; sent as 0 so older clients see a number. */
  solUsd: number;
}

export function emptyBook(cashUsd = 0): SpotPositionsResponse {
  return {
    positions: [],
    totalUsd: 0,
    totalPnlUsd: null,
    totalUnrealizedPnlUsd: null,
    totalRealizedPnlUsd: null,
    cashUsd: finiteOr(cashUsd, 0),
    solUsd: 0,
  };
}

/** One mint's cost basis from the ledger, walked oldest first at average cost. */
export interface LedgerBasis {
  /** Quantity the ledger accounts for, raw units. */
  qtyRaw: bigint;
  /** What the tracked quantity cost, in USD. */
  costUsd: number;
  /** Sum of buys minus sum of sells, in USD. */
  netInvestedUsd: number;
  realizedPnlUsd: number;
  /** The post the FIRST buy came from, for "called by". */
  firstSourceUrl: string | null;
  /**
   * The walk met a sell larger than what it tracked (tokens that arrived from
   * outside the ledger). Average cost is then unknowable, so every derived
   * figure goes null instead of being quietly wrong.
   */
  broken: boolean;
}

const USDC_UNIT = 1_000_000;

/**
 * Average-cost walk over the user's buys and sells. Only rows that actually
 * traded count: a failed action moved nothing, and a pending one has no fill
 * yet. A 'sent' row (hash known, receipt not yet seen) counts, the same way
 * the Solana book counted broadcast trades, so a book read right after a
 * trade already shows it.
 */
export function walkLedger(rows: ActionRow[], usdc: Address): Map<Address, LedgerBasis> {
  const out = new Map<Address, LedgerBasis>();
  const usable = rows
    .filter((r) => (r.kind === 'buy' || r.kind === 'sell') && (r.status === 'confirmed' || r.status === 'sent'))
    .filter((r) => r.amountInRaw !== null && r.amountOutRaw !== null && isRawInt(r.amountInRaw) && isRawInt(r.amountOutRaw))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  for (const r of usable) {
    const tokenIn = (r.tokenIn ?? '').toLowerCase() as Address;
    const tokenOut = (r.tokenOut ?? '').toLowerCase() as Address;
    const inRaw = BigInt(r.amountInRaw!);
    const outRaw = BigInt(r.amountOutRaw!);

    if (r.kind === 'buy' && tokenIn === usdc && tokenOut && tokenOut !== usdc) {
      const b = basisOf(out, tokenOut);
      const usd = Number(inRaw) / USDC_UNIT;
      b.netInvestedUsd += usd;
      b.firstSourceUrl ??= r.sourceUrl ?? null;
      if (!b.broken) {
        b.qtyRaw += outRaw;
        b.costUsd += usd;
      }
    } else if (r.kind === 'sell' && tokenOut === usdc && tokenIn && tokenIn !== usdc) {
      const b = basisOf(out, tokenIn);
      const proceeds = Number(outRaw) / USDC_UNIT;
      b.netInvestedUsd -= proceeds;
      if (b.broken) continue;
      if (inRaw > b.qtyRaw || b.qtyRaw === 0n) {
        b.broken = true;
        continue;
      }
      const costOut = b.costUsd * ratio(inRaw, b.qtyRaw);
      b.realizedPnlUsd += proceeds - costOut;
      b.costUsd -= costOut;
      b.qtyRaw -= inRaw;
      if (b.qtyRaw === 0n) b.costUsd = 0;
    }
  }
  return out;
}

/** A token the wallet holds, with whatever the market layer could say about it. */
export interface HeldToken {
  address: Address;
  raw: bigint;
  decimals: number;
  symbol: string | null;
  name: string | null;
  kind: TokenKind | null;
  priceUsd: number | null;
  change24hPct: number | null;
}

/**
 * Assemble the response. `cash` lists the addresses that are money rather
 * than positions (USDC): they never become rows, and any ledger rows for them
 * never count as an exited position either, or the headline P&L would show
 * money moved as money lost.
 */
export function buildBook(
  held: HeldToken[],
  basis: Map<Address, LedgerBasis>,
  cashUsd: number,
  cash: Set<Address>,
): SpotPositionsResponse {
  const positions: SpotPosition[] = [];
  const heldSet = new Set<Address>();
  let totalUsd = 0;
  const pnl = new Sum();
  const unrealized = new Sum();
  const realized = new Sum();

  for (const h of held) {
    const address = h.address.toLowerCase() as Address;
    if (cash.has(address) || h.raw <= 0n) continue;
    heldSet.add(address);

    const uiAmount = Number(formatUnits(h.raw, h.decimals));
    if (!(uiAmount > 0)) continue;
    const price = positive(h.priceUsd);
    const valueUsd = price === null ? null : uiAmount * price;
    const b = basis.get(address) ?? null;

    const netInvestedUsd = b ? b.netInvestedUsd : null;
    const pnlUsd = valueUsd !== null && netInvestedUsd !== null ? valueUsd - netInvestedUsd : null;
    const walked = b && !b.broken ? b : null;
    const trackedUi = walked ? Number(formatUnits(walked.qtyRaw, h.decimals)) : 0;
    const avgEntryPriceUsd = walked && trackedUi > 0 ? walked.costUsd / trackedUi : null;
    let unrealizedPnlUsd: number | null = null;
    if (walked && price !== null && avgEntryPriceUsd !== null) {
      const qty = Math.min(trackedUi, uiAmount);
      unrealizedPnlUsd = qty > 0 ? (price - avgEntryPriceUsd) * qty : 0;
    }
    const realizedPnlUsd = walked ? walked.realizedPnlUsd : null;

    const ticker = h.symbol?.trim() ? h.symbol.trim() : shortMint(address);
    positions.push({
      mint: address,
      ticker,
      displayName: h.name?.trim() ? h.name.trim() : ticker,
      category: h.kind === 'stock' ? 'equity' : 'crypto',
      uiAmount,
      raw: h.raw.toString(),
      decimals: h.decimals,
      priceUsd: price,
      valueUsd,
      change24hPct: finiteOrNull(h.change24hPct),
      netInvestedUsd,
      entryMcapUsd: null,
      pnlUsd,
      realizedPnlUsd,
      avgEntryPriceUsd,
      callerSourceUrl: b?.firstSourceUrl ?? null,
      unrealizedPnlUsd,
    });
    if (valueUsd !== null) totalUsd += valueUsd;
    pnl.add(pnlUsd);
    unrealized.add(unrealizedPnlUsd);
    realized.add(realizedPnlUsd);
  }

  // Mints the reader has fully left still belong in the all-time figures:
  // their P&L is simply what came back minus what went in. Unlike the Solana
  // book, this also holds when nothing is held any more, so a reader who
  // sold everything still sees what they made.
  for (const [address, b] of basis) {
    if (heldSet.has(address) || cash.has(address)) continue;
    const exited = -b.netInvestedUsd;
    pnl.add(exited);
    realized.add(exited);
  }

  positions.sort((a, b) => {
    if (a.valueUsd === null && b.valueUsd === null) return 0;
    if (a.valueUsd === null) return 1;
    if (b.valueUsd === null) return -1;
    return b.valueUsd - a.valueUsd;
  });

  return {
    positions,
    totalUsd,
    totalPnlUsd: pnl.value,
    totalUnrealizedPnlUsd: unrealized.value,
    totalRealizedPnlUsd: realized.value,
    cashUsd: finiteOr(cashUsd, 0),
    solUsd: 0,
  };
}

/**
 * The name a token gets when nobody can name it: a prefix of the address that
 * ends in "…". The chip tells named from unnamed by that trailing ellipsis,
 * so a middle-truncated form ("0x1234…abcd") would pass as a real ticker.
 */
export function shortMint(address: string): string {
  return `${address.slice(0, 6)}…`;
}

function basisOf(map: Map<Address, LedgerBasis>, token: Address): LedgerBasis {
  let b = map.get(token);
  if (!b) {
    b = { qtyRaw: 0n, costUsd: 0, netInvestedUsd: 0, realizedPnlUsd: 0, firstSourceUrl: null, broken: false };
    map.set(token, b);
  }
  return b;
}

/** a / b for bigints as a float, precise to 1e-12, for pro-rating cost. */
function ratio(a: bigint, b: bigint): number {
  return Number((a * 1_000_000_000_000n) / b) / 1e12;
}

function isRawInt(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function finiteOr(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** A total that stays null until something known is added to it. */
class Sum {
  value: number | null = null;
  add(n: number | null): void {
    if (n === null || !Number.isFinite(n)) return;
    this.value = (this.value ?? 0) + n;
  }
}
