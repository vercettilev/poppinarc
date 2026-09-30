import type { Hex } from 'viem';
import { swapDescription } from '../routers/kyber.router';
import type { FarChain } from './far-chains';

/**
 * A KYBERSWAP SWAP ON BASE OR ARBITRUM, BUILT FOR A READER'S CIRCLE ACCOUNT.
 *
 * The same checks the Arc router owes itself (routers/kyber.router.ts),
 * because the reader's wallet is about to sign an operation that runs this
 * calldata: KyberSwap's own router, exactly our amount of exactly our token,
 * the output paid to the account and nowhere else, no permit smuggled in, no
 * fee to anyone, and a floor no lower than our slippage allows under the
 * build's own price.
 */

export const KYBER_ROUTER: Hex = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
const API = 'https://aggregator-api.kyberswap.com';
const CLIENT_ID = 'poppin-arc';
/** One percent: the signature and the bundler take a minute, not a block. */
export const FAR_SLIPPAGE_BPS = 100;
/** The operation is signed, then sent; it must still be valid when it lands. */
const DEADLINE_SEC = 20 * 60;

export interface FarSwap {
  router: Hex;
  callData: Hex;
  amountOut: bigint;
  minOut: bigint;
  gasUsd: number | null;
}

export class FarSwapError extends Error {}

type Fetch = typeof fetch;

export async function buildFarSwap(args: {
  chain: FarChain;
  tokenIn: Hex;
  tokenOut: Hex;
  amountIn: bigint;
  account: Hex;
  fetchFn?: Fetch;
}): Promise<FarSwap> {
  const { chain, amountIn } = args;
  if (!chain.kyber) throw new FarSwapError(`KyberSwap does not route on ${chain.label}.`);
  const tokenIn = lower(args.tokenIn);
  const tokenOut = lower(args.tokenOut);
  const account = lower(args.account);
  const doFetch = args.fetchFn ?? ((...a: Parameters<Fetch>) => fetch(...a));
  const call = async <T>(path: string, init?: { body: unknown }): Promise<T> => {
    const res = await doFetch(`${API}/${chain.kyber}/api/v1${path}`, {
      method: init ? 'POST' : 'GET',
      headers: { 'x-client-id': CLIENT_ID, ...(init ? { 'content-type': 'application/json' } : {}) },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: T } | null;
    if (!res.ok || !body || body.code !== 0 || !body.data) {
      throw new FarSwapError(body?.message ? `KyberSwap: ${body.message}` : `KyberSwap HTTP ${res.status}`);
    }
    return body.data;
  };

  const route = await call<{ routeSummary?: Record<string, unknown> & { amountOut?: string; gasUsd?: string }; routerAddress?: string }>(
    `/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}`,
  );
  const summary = route.routeSummary;
  if (!summary || lower(String(route.routerAddress ?? '')) !== KYBER_ROUTER) throw new FarSwapError('KyberSwap offered no route.');
  const quoted = raw(summary.amountOut);
  if (!quoted || quoted <= 0n) throw new FarSwapError('KyberSwap offered no route.');

  const built = await call<{ data?: string; routerAddress?: string; amountIn?: string; amountOut?: string; transactionValue?: string }>(
    '/route/build',
    {
      body: {
        routeSummary: summary,
        sender: account,
        recipient: account,
        slippageTolerance: FAR_SLIPPAGE_BPS,
        deadline: Math.floor(Date.now() / 1000) + DEADLINE_SEC,
        source: CLIENT_ID,
      },
    },
  );
  const refuse = (why: string): never => {
    throw new FarSwapError(`Refusing KyberSwap's build: ${why}.`);
  };
  if (lower(String(built.routerAddress ?? '')) !== KYBER_ROUTER) refuse('it names another router');
  if (raw(built.amountIn) !== amountIn) refuse('it spends another amount');
  if ((raw(built.transactionValue ?? '0') ?? 1n) !== 0n) refuse('it carries native value');
  const data = typeof built.data === 'string' ? built.data : '';
  const d = swapDescription(data);
  if (!d) return refuse('the calldata is not a router swap');
  if (d.srcToken !== tokenIn) refuse(`the calldata spends ${d.srcToken}`);
  if (d.dstToken !== tokenOut) refuse(`the calldata buys ${d.dstToken}`);
  if (d.dstReceiver !== account) refuse(`the calldata pays ${d.dstReceiver}`);
  if (d.amount !== amountIn) refuse(`the calldata spends ${d.amount}`);
  if (d.permit !== '0x') refuse('the calldata carries a permit');
  if (d.feeReceivers.length > 0) refuse(`the calldata pays a fee to ${d.feeReceivers.join(',')}`);
  const builtOut = raw(built.amountOut) ?? quoted;
  // A build may price a block later, a little under the quote, never by more than half a percent.
  if (builtOut * 10_000n < quoted * 9_950n) refuse(`it prices ${builtOut}, well under the quote ${quoted}`);
  const floor = (builtOut * BigInt(10_000 - FAR_SLIPPAGE_BPS)) / 10_000n;
  if (d.minReturnAmount === 0n || d.minReturnAmount + 1n < floor) refuse(`its floor ${d.minReturnAmount} is under ${floor}`);
  const gas = Number(summary.gasUsd);
  return { router: KYBER_ROUTER, callData: data as Hex, amountOut: builtOut, minOut: d.minReturnAmount, gasUsd: Number.isFinite(gas) ? gas : null };
}

function lower(a: string): Hex {
  return a.toLowerCase() as Hex;
}

function raw(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  return BigInt(v);
}
