import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { decodeFunctionData, encodeFunctionData, erc20Abi, parseAbi, type Hex, type TransactionReceipt } from 'viem';
import { APP_CONFIG, AppConfig } from '../config';
import { ArcChain, gasUsdcRaw } from '../arc/chain';
import { circleAssetByAddress } from '../arc/network';
import { stableUuid } from '../circle/ids';
import { CircleWallets, type ExecuteParams } from '../circle/wallets';
import { ActionsStore } from '../trade/actions';
import {
  TRADE_ERRORS,
  lower,
  type Address,
  type ExecuteRequest,
  type Executed,
  type Leg,
  type LegKind,
  type Quote,
  type QuoteRequest,
  type SwapRouter,
} from '../trade/types';

/**
 * KYBERSWAP: the router for every Arc token App Kit Swap does not list.
 *
 * Chosen on 2026-09-28 after comparing every aggregator that answers for Arc
 * (chain 5042): KyberSwap reaches hooked Uniswap v4 pools, Aero and the meme
 * launchpads, charges no protocol fee, takes our fee as a query parameter, and
 * needs no key at 3 requests a second. It has no testnet, so on testnet this
 * router supports nothing and the Circle assets route through App Kit alone.
 *
 * A trade from a Circle wallet is at most two transactions, both sent by
 * Circle with value 0: approve the router for EXACTLY the amount in, then call
 * the router with the calldata KyberSwap built. Never an unlimited approval:
 * these wallets are custodial, and a standing allowance to a contract we do
 * not control is our users' money on someone else's terms.
 *
 * The calldata is a third party's. Before Circle signs it, it is decoded and
 * held to what the reader asked for: this token in, that token out, this
 * amount, paid to this wallet, with a floor no lower than our own slippage
 * allows. The router contract enforces that floor on the wallet's balance, so
 * a build that passes these checks cannot cost the reader more than the quote
 * said, whatever else it does.
 *
 * USDC is always the ERC-20 at 0x3600…0000 in 6 decimals. KyberSwap also
 * accepts native gas USDC as 0xEeee… in 18 decimals with a nonzero value; this
 * router refuses that form so money is only ever one unit.
 */

export const KYBER_OPTIONS = Symbol('KYBER_OPTIONS');

export interface KyberOptions {
  /** Aggregator API base for Arc. Setting it also enables the router off mainnet. */
  baseUrl?: string;
  /** Sent as x-client-id and as the build's source, so KyberSwap can attribute our volume. */
  clientId?: string;
  /** Requests per second this process allows itself. KyberSwap's public limit is 3. */
  rps?: number;
  /** Slippage tolerance in basis points for the built swap. */
  slippageBps?: number;
  /** Seconds from build until the router refuses the swap. */
  deadlineSec?: number;
  /** Router contracts we approve and call. Anything else KyberSwap names is refused. */
  routers?: string[];
  /** How long a quote may queue for a request slot before it answers "too much traffic". */
  quoteWaitMs?: number;
  /** The same for a trade the reader already pressed; it may wait longer. */
  executeWaitMs?: number;
  httpTimeoutMs?: number;
  /** Everything execute does, from the press to an answer, fits in this. */
  executeBudgetMs?: number;
  /** The part of the budget kept for sending the swap and reading its receipt. */
  sendReserveMs?: number;
}

/** A USDC round trip through a token, for the market gate. */
export interface SellProbe {
  /** Raw token units that `usdcRaw` buys. */
  buyOutRaw: bigint;
  /** 6-decimal USDC that selling `buyOutRaw` straight back returns. */
  sellBackUsdcRaw: bigint;
  /** Percent lost on the way round, 1.5 means 1.5%. Negative when the round trip gains. */
  roundTripLossPct: number;
}

/**
 * The swap was sent and has an on-chain hash, but its receipt did not arrive
 * in time. Not a failure: the caller answers with the hash and lets /confirm
 * settle it. The legs are already recorded on the action.
 */
export class SwapPendingError extends Error {
  constructor(
    readonly txHash: Address,
    readonly legs: Leg[],
  ) {
    super('Swap sent, confirmation still pending');
    this.name = 'SwapPendingError';
  }
}

/**
 * Circle did not hand back a hash for a leg. The legs say which case it is:
 * a leg marked failed provably never reached the chain, so the action may be
 * tried again; a leg still pending may yet land, so it must not. The message
 * is Circle's own, for the caller to turn into a sentence.
 */
export class CircleSendError extends Error {
  constructor(
    message: string,
    readonly legs: Leg[],
  ) {
    super(message);
    this.name = 'CircleSendError';
  }
}

const DEFAULTS = {
  baseUrl: 'https://aggregator-api.kyberswap.com/arc/api/v1',
  clientId: 'poppin-arc',
  rps: 3,
  // The Solana engine's default too (spot-core route/engine.ts).
  slippageBps: 100,
  deadlineSec: 300,
  // MetaAggregationRouterV2, the same address on every KyberSwap chain; its
  // bytecode on Arc was checked with eth_getCode on 2026-09-28.
  routers: ['0x6131b5fae19ea4f9d964eac0408e4408b66337b5'],
  quoteWaitMs: 2_000,
  executeWaitMs: 10_000,
  httpTimeoutMs: 8_000,
  // The extension gives up on /swap at 90 s, and a press it gave up on is
  // pressed again under a new key. The trade service spends up to about 20 s
  // before this router (the market gate) and 5 s after it, so 60 s here keeps
  // every answer inside 90 s. The swap itself is only sent while 20 s remain,
  // enough for Circle's hash and Arc's sub-second receipt.
  executeBudgetMs: 60_000,
  sendReserveMs: 20_000,
};

const ADDRESS = /^0x[0-9a-f]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const NATIVE = new Set(['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '0x0000000000000000000000000000000000000000']);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Where Arc logs movements of native USDC: a Transfer event from this pseudo
 * address, in 18 decimals. Every ERC-20 transfer at 0x3600 emits one here as
 * well, and a plain value transfer emits ONLY this one (both checked with
 * eth_getLogs on 2026-09-28).
 */
export const ARC_NATIVE_LOG = '0xfffffffffffffffffffffffffffffffffffffffe' as Address;

/**
 * ERC-4337's UserOperationEvent(bytes32 userOpHash, address indexed sender,
 * address indexed paymaster, uint256 nonce, bool success, uint256, uint256),
 * the same in EntryPoint v0.6, v0.7 and v0.8, all three deployed on Arc.
 */
const USER_OP_EVENT = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';
const ENTRY_POINTS = new Set([
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789',
  '0x0000000071727de22e5e9d8baf0edac6f37da032',
  '0x4337084d9e255ff0702461cf8895ce9e3b5ff108',
]);

/**
 * The two entry points of MetaAggregationRouterV2 that KyberSwap builds for,
 * both present in the router's bytecode on Arc. `swap` is what every build on
 * 2026-09-28 used; `swapSimpleMode` carries the same description.
 */
export const KYBER_ROUTER_ABI = parseAbi([
  'struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }',
  'struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }',
  'function swap(SwapExecutionParams execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
  'function swapSimpleMode(address caller, SwapDescriptionV2 desc, bytes executorData, bytes clientData) returns (uint256 returnAmount, uint256 gasUsed)',
]);

/** The part of a router call that decides whose money goes where. Addresses lowercase. */
export interface SwapDescription {
  srcToken: Address;
  dstToken: Address;
  feeReceivers: Address[];
  dstReceiver: Address;
  amount: bigint;
  minReturnAmount: bigint;
  permit: Hex;
}

/** The swap description inside router calldata, or null for anything that is not a router swap. */
export function swapDescription(data: string): SwapDescription | null {
  if (!/^0x([0-9a-fA-F]{2})+$/.test(data)) return null;
  try {
    const call = decodeFunctionData({ abi: KYBER_ROUTER_ABI, data: data as Hex });
    const d = call.functionName === 'swap' ? call.args[0].desc : call.args[1];
    return {
      srcToken: lower(d.srcToken),
      dstToken: lower(d.dstToken),
      feeReceivers: d.feeReceivers.map((r) => lower(r)),
      dstReceiver: lower(d.dstReceiver),
      amount: d.amount,
      minReturnAmount: d.minReturnAmount,
      permit: d.permit,
    };
  } catch {
    return null;
  }
}

/**
 * KyberSwap's own error codes, read from its docs and live answers. 4008 and
 * 4010 are "route not found", 4011 is a token it has never indexed, 4009 is an
 * amount larger than any route takes. 4005 and 4007 mean our fee would eat
 * the whole trade, which for the reader is simply too small.
 */
const NO_ROUTE_CODES = new Set([4008, 4009, 4010, 4011]);
const TOO_SMALL_CODES = new Set([4005, 4007]);

/**
 * Circle's terminal states that say a transaction without a hash never went
 * anywhere. STUCK is not one of them: it was broadcast and may still land.
 */
const NEVER_SENT_STATES = new Set(['CANCELLED', 'DENIED', 'FAILED']);
/** How the Wallets SDK words a terminal state while waiting for a hash (developer-controlled-wallets 2026-09). */
const CIRCLE_TERMINAL = /\bTransaction ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) (CANCELLED|DENIED|FAILED|STUCK)\b/i;

type FailureKind = 'no-route' | 'too-small' | 'rate-limited' | 'unavailable';

/** Inside this file only; the public methods turn it into the extension's sentences. */
class KyberFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    detail: string,
  ) {
    super(detail);
    this.name = 'KyberFailure';
  }
}

function toHttp(e: unknown): unknown {
  if (!(e instanceof KyberFailure)) return e;
  switch (e.kind) {
    case 'no-route':
      return new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    case 'too-small':
      return new BadRequestException(TRADE_ERRORS.tooSmall);
    case 'rate-limited':
      return new UnprocessableEntityException(TRADE_ERRORS.rateLimited);
    default:
      return new UnprocessableEntityException(TRADE_ERRORS.quoteUnavailable);
  }
}

/**
 * At most `perWindow` request starts in any `windowMs`, for this process.
 *
 * KyberSwap answers 429 past 3 requests a second per client, and a 429 in the
 * middle of a trade means a pressed button that does nothing. So requests
 * queue here instead, and one that would queue longer than its caller can
 * wait fails at once with the "too much traffic" sentence, before anything is
 * sent. Slots are reserved in order, so waiting callers are served first in,
 * first out.
 */
export class RateGate {
  private slots: number[] = [];

  constructor(
    private readonly perWindow: number,
    private readonly windowMs = 1_000,
    private readonly clock: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = delay,
  ) {}

  async take(maxWaitMs: number): Promise<void> {
    const now = this.clock();
    this.slots = this.slots.filter((t) => t > now - this.windowMs);
    let at = now;
    const n = this.slots.length;
    if (n) at = Math.max(at, this.slots[n - 1]);
    if (n >= this.perWindow) at = Math.max(at, this.slots[n - this.perWindow] + this.windowMs);
    const wait = at - now;
    if (wait > maxWaitMs) throw new KyberFailure('rate-limited', `local gate: next slot in ${wait} ms`);
    this.slots.push(at);
    if (wait > 0) await this.sleep(wait);
  }
}

/**
 * KyberSwap's source ids as a reader would say them. Every Uniswap v4 flavour
 * (hooked, fee, doppler…) is still Uniswap v4 to a reader, and Aero's
 * concentrated pools are just Aero.
 */
const VENUE_LABELS: Record<string, string> = {
  'achswap-v2': 'AchSwap',
  'achswap-v3': 'AchSwap',
  'aero-cl': 'Aero',
  'arcade-fun': 'Arcade Fun',
  'arcade-v3': 'Arcade',
  'arcane-v3': 'Arcane',
  'dyor-swap': 'DyorSwap',
  flap: 'Flap',
  'kyberswap-limit-order-v2': 'KyberSwap',
  lunya: 'Lunya',
  'lunya-fun': 'Lunya Fun',
  'synthra-v3': 'Synthra',
  'uniswap-v2': 'Uniswap v2',
  'uniswap-v3': 'Uniswap v3',
  'uniswap-v4': 'Uniswap v4',
  'virtual-fun-v2': 'Virtual Fun',
  'warpdex-v2': 'WarpDex',
};

export function venueLabel(exchange: string): string {
  const slug = exchange.trim().toLowerCase();
  if (VENUE_LABELS[slug]) return VENUE_LABELS[slug];
  if (slug.startsWith('uniswap-v4')) return 'Uniswap v4';
  if (slug.startsWith('aero')) return 'Aero';
  // A source added after this list: drop the version and capitalise.
  const words = slug.split(/[-_\s]+/).filter((w) => w && !/^v\d+$/.test(w));
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : 'KyberSwap';
}

interface KyberHop {
  exchange?: string;
}

interface KyberRouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd?: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd?: string;
  route?: KyberHop[][];
  routerAddress?: string;
  /** The rest (checksum, timestamp, pool state) goes back to /route/build untouched. */
  [key: string]: unknown;
}

interface KyberRoutesData {
  routeSummary?: KyberRouteSummary;
  routerAddress?: string;
}

interface KyberBuildData {
  amountIn?: string;
  amountOut?: string;
  data?: string;
  routerAddress?: string;
  transactionValue?: string;
}

interface KyberEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

interface Priced {
  summary: KyberRouteSummary;
  router: Address;
  amountOut: bigint;
  feeBps: number;
  /** Where our fee goes in this route, or null when none was asked for. */
  feeReceiver: Address | null;
}

/** Route labels in the order the money flows, each venue once, never empty. */
export function routeLabels(route: KyberHop[][] | undefined): string[] {
  const out: string[] = [];
  for (const path of route ?? []) {
    for (const hop of path ?? []) {
      if (!hop?.exchange) continue;
      const label = venueLabel(hop.exchange);
      if (!out.includes(label)) out.push(label);
    }
  }
  return out.length ? out : ['KyberSwap'];
}

/**
 * Market impact in percent, from KyberSwap's USD valuation of both sides.
 *
 * Our own fee is taken out of the input side before comparing, so the figure
 * is the pool's doing and not ours: the reader sees what they get, and never a
 * fee line. Unknown valuations (a token KyberSwap cannot price) read as 0,
 * because the extension needs a finite number and "unknown" is not "bad".
 */
export function priceImpactPct(inUsd: unknown, outUsd: unknown, feeBps: number): number {
  const i = Number(inUsd);
  const o = Number(outUsd);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i <= 0 || o <= 0) return 0;
  const pct = (1 - o / (i * (1 - feeBps / 10_000))) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round(Math.min(pct, 100) * 100) / 100;
}

type LogLike = { address: string; topics: readonly string[]; data: string };

/**
 * What `owner` received of `token` in a receipt: the sum of its ERC-20
 * Transfer logs to that address. This, not the quote and not the build, is
 * the amount a trade reports. It also holds for Arc USDC, whose 0x3600
 * interface emits standard Transfer logs (checked with eth_getLogs 2026-09-28).
 */
export function receivedFromLogs(logs: ReadonlyArray<LogLike>, token: Address, owner: Address): bigint {
  const t = lower(token);
  const o = lower(owner).slice(2);
  let sum = 0n;
  for (const l of logs) {
    if (lower(l.address) !== t) continue;
    if (l.topics.length !== 3 || l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (l.topics[2]?.toLowerCase().slice(-40) !== o) continue;
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(l.data)) continue;
    sum += BigInt(l.data);
  }
  return sum;
}

/**
 * What an ERC-4337 bundle says about the user operation of `sender` in it:
 * false when it reverted, true when it ran, null when the receipt has none
 * (an EOA wallet, whose receipt status already answers). Only the known
 * EntryPoints count, so a pool hook cannot speak for the wallet.
 */
export function userOpSucceeded(logs: ReadonlyArray<LogLike>, sender: Address): boolean | null {
  const s = lower(sender).slice(2);
  let seen: boolean | null = null;
  for (const l of logs) {
    if (!ENTRY_POINTS.has(lower(l.address))) continue;
    if (l.topics[0]?.toLowerCase() !== USER_OP_EVENT) continue;
    if (l.topics[2]?.toLowerCase().slice(-40) !== s) continue;
    const word = l.data.slice(2 + 64, 2 + 128);
    if (!/^[0-9a-fA-F]{64}$/.test(word)) continue;
    if (BigInt(`0x${word}`) === 0n) return false;
    seen = true;
  }
  return seen;
}

function toRaw(v: unknown): bigint | null {
  return typeof v === 'string' && /^[0-9]+$/.test(v) ? BigInt(v) : null;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Circle's idempotency key for one attempt at one leg. The first attempt keeps
 * the plain key; a later one exists only after every earlier attempt provably
 * never reached the chain, and needs a key of its own because Circle answers
 * a repeated key with the transaction that already failed.
 */
function legKey(actionId: string, leg: 'approve' | 'swap', attempt: number): string {
  return attempt === 0 ? stableUuid(actionId, leg) : stableUuid(actionId, leg, String(attempt));
}

const nowIso = () => new Date().toISOString();

/**
 * The action's legs as this trade sees them, written back after every step.
 *
 * A write BEFORE a send must land, or a crash between the send and the next
 * write would leave no trace that money moved; so those throw. A write AFTER
 * a send is best effort, because failing a trade that already landed over a
 * ledger hiccup is worse than a stale ledger row.
 */
class Ledger {
  constructor(
    private readonly store: ActionsStore,
    private readonly actionId: string,
    private readonly legs: Leg[],
    private readonly logger: Logger,
  ) {}

  all(kind: LegKind): Leg[] {
    return this.legs.filter((l) => l.kind === kind);
  }

  add(leg: Leg): Leg {
    this.legs.push(leg);
    return leg;
  }

  snapshot(): Leg[] {
    return this.legs.map((l) => ({ ...l }));
  }

  async save(mustLand: boolean): Promise<void> {
    try {
      await this.store.update(this.actionId, { legs: this.snapshot() });
    } catch (e) {
      if (mustLand) throw e;
      this.logger.error(`action ${this.actionId}: legs not recorded: ${errText(e)}`);
    }
  }
}

type Trade = ExecuteRequest & {
  tokenIn: Address;
  tokenOut: Address;
  walletAddress: Address;
  /** When execute must have answered (epoch ms). */
  deadline: number;
  /** The last moment the swap may still be sent (epoch ms). */
  sendBy: number;
};

/** A swap built for a wallet that signs for itself; see prepareForWallet. */
export interface WalletSwap {
  /** The pinned KyberSwap router the calldata calls, and the spender to approve. */
  router: Address;
  callData: Address;
  /** The calldata's own floor: less than this and the swap reverts. */
  minOut: bigint;
  /** What the route promised when it was priced. */
  amountOut: bigint;
  /** What the wallet already allows the router to spend of the input token. */
  allowance: bigint;
  priceImpactPct: number;
  route: string[];
}

type SendOutcome = { state: 'sent' } | { state: 'not-sent' | 'unknown'; error: unknown };

@Injectable()
export class KyberRouter implements SwapRouter {
  readonly venue = 'kyber' as const;
  private readonly logger = new Logger('routers/kyber');
  private readonly opts: Required<KyberOptions>;
  private readonly routers: Set<string>;
  private readonly enabled: boolean;
  private readonly usdc: Address;
  private readonly gate: RateGate;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly chain: ArcChain,
    private readonly wallets: CircleWallets,
    private readonly actions: ActionsStore,
    @Optional() @Inject(KYBER_OPTIONS) options?: KyberOptions,
  ) {
    this.opts = { ...DEFAULTS, ...(options ?? {}) };
    this.routers = new Set(this.opts.routers.map((r) => r.toLowerCase()));
    this.enabled = config.network.name === 'mainnet' || Boolean(options?.baseUrl);
    this.usdc = lower(config.network.usdc.address);
    this.gate = new RateGate(Math.max(1, this.opts.rps));
  }

  /**
   * Any two different ERC-20s, except a pair of Circle's own assets: those are
   * App Kit Swap's, and saying no here keeps the choice independent of the
   * order the routers are listed in.
   */
  supports(tokenIn: Address, tokenOut: Address): boolean {
    if (!this.enabled) return false;
    const a = lower(tokenIn);
    const b = lower(tokenOut);
    if (!ADDRESS.test(a) || !ADDRESS.test(b) || a === b || NATIVE.has(a) || NATIVE.has(b)) return false;
    const net = this.config.network;
    return !(circleAssetByAddress(net, a) && circleAssetByAddress(net, b));
  }

  async quote(req: QuoteRequest): Promise<Quote> {
    const tokenIn = lower(req.tokenIn);
    const tokenOut = lower(req.tokenOut);
    this.assertTradable(tokenIn, tokenOut, req.amountInRaw);
    try {
      const p = await this.price(tokenIn, tokenOut, req.amountInRaw, true, null);
      return {
        venue: this.venue,
        tokenIn,
        tokenOut,
        amountInRaw: req.amountInRaw,
        amountOutRaw: p.amountOut,
        minAmountOutRaw: (p.amountOut * BigInt(10_000 - this.opts.slippageBps)) / 10_000n,
        priceImpactPct: priceImpactPct(p.summary.amountInUsd, p.summary.amountOutUsd, p.feeBps),
        route: routeLabels(p.summary.route),
      };
    } catch (e) {
      throw toHttp(e);
    }
  }

  /**
   * Buy `usdcRaw` of `token` and sell all of it straight back, on paper: two
   * quotes, no fee, nothing sent. The market gate reads the loss to decide
   * whether a Buy button may be drawn, because on Arc some tokens can be
   * bought and not sold. Null means either leg has no route at this size.
   * A rate limit or an outage throws instead, since "we could not ask" must
   * not read as "cannot be sold". Costs two of the 3 requests a second, so
   * callers cache the verdict.
   */
  async sellProbe(token: Address, usdcRaw: bigint): Promise<SellProbe | null> {
    const t = lower(token);
    if (usdcRaw <= 0n || !this.supports(this.usdc, t)) return null;
    try {
      const buy = await this.price(this.usdc, t, usdcRaw, false, null);
      const back = await this.price(t, this.usdc, buy.amountOut, false, null);
      const lossPct = (Number(usdcRaw - back.amountOut) * 100) / Number(usdcRaw);
      return {
        buyOutRaw: buy.amountOut,
        sellBackUsdcRaw: back.amountOut,
        roundTripLossPct: Math.round(lossPct * 100) / 100,
      };
    } catch (e) {
      if (e instanceof KyberFailure && (e.kind === 'no-route' || e.kind === 'too-small')) return null;
      throw toHttp(e);
    }
  }

  async execute(req: ExecuteRequest): Promise<Executed> {
    const deadline = Date.now() + this.opts.executeBudgetMs;
    const trade: Trade = {
      ...req,
      tokenIn: lower(req.tokenIn),
      tokenOut: lower(req.tokenOut),
      walletAddress: lower(req.walletAddress),
      deadline,
      sendBy: deadline - this.opts.sendReserveMs,
    };
    this.assertTradable(trade.tokenIn, trade.tokenOut, trade.amountInRaw);
    try {
      // One trade at a time per wallet and input token: exact approvals mean a
      // second trade reading the allowance while the first is between its
      // approve and its swap would spend the first one's approval. The wait
      // is bounded, so a trade queued behind a slow one still answers in time.
      return await this.exclusive(`${trade.walletAddress}:${trade.tokenIn}`, trade.sendBy - Date.now(), () =>
        this.run(trade),
      );
    } catch (e) {
      throw toHttp(e);
    }
  }

  /**
   * A swap for a wallet this service does not hold (trade/own-wallet.ts): the
   * same route, the same build and the same calldata checks as execute, and
   * nothing sent, because the person's own wallet sends it. Any pair is
   * allowed here, two of Circle's own assets included, since App Kit Swap
   * can only send from a Circle wallet.
   */
  async prepareForWallet(req: {
    tokenIn: Address;
    tokenOut: Address;
    amountInRaw: bigint;
    walletAddress: Address;
    actionId: string;
  }): Promise<WalletSwap> {
    const tokenIn = lower(req.tokenIn);
    const tokenOut = lower(req.tokenOut);
    const walletAddress = lower(req.walletAddress);
    if (
      !this.enabled ||
      !ADDRESS.test(tokenIn) ||
      !ADDRESS.test(tokenOut) ||
      tokenIn === tokenOut ||
      NATIVE.has(tokenIn) ||
      NATIVE.has(tokenOut)
    ) {
      throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    }
    if (req.amountInRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.tooSmall);
    const deadline = Date.now() + this.opts.executeBudgetMs;
    const t: Trade = {
      uid: '',
      walletId: '',
      walletAddress,
      tokenIn,
      tokenOut,
      amountInRaw: req.amountInRaw,
      actionId: req.actionId,
      deadline,
      sendBy: deadline - this.opts.sendReserveMs,
    };
    try {
      const p = await this.price(tokenIn, tokenOut, req.amountInRaw, true, t.sendBy);
      const b = await this.build(p, t);
      const allowance = await this.allowance(tokenIn, walletAddress, p.router);
      return {
        router: p.router,
        callData: b.callData,
        minOut: b.minOut,
        amountOut: p.amountOut,
        allowance,
        priceImpactPct: priceImpactPct(p.summary.amountInUsd, p.summary.amountOutUsd, p.feeBps),
        route: routeLabels(p.summary.route),
      };
    } catch (e) {
      throw toHttp(e);
    }
  }

  private async run(t: Trade): Promise<Executed> {
    const row = await this.actions.get(t.actionId);
    // The caller writes the action before execute. Without it, the pending
    // leg written before each send would update nothing, and the guard below
    // against a second swap would have nothing to read on a retry.
    if (!row) throw new Error(`action ${t.actionId} is not recorded; nothing was sent`);
    const ledger = new Ledger(this.actions, t.actionId, (row.legs ?? []).map((l) => ({ ...l })), this.logger);

    // A swap leg with a hash means a swap was sent: settle that one from the
    // chain, never build a second. One without a hash that is not marked
    // failed may have been sent, and we cannot know; the reader retries with
    // a new key instead of risking a double spend. Only when every earlier
    // attempt provably never left does this action try again.
    const swaps = ledger.all('swap');
    const landed = swaps.find((l) => l.txHash);
    if (landed) return this.settle(t, ledger, landed, null);
    if (swaps.some((l) => l.status !== 'failed')) throw new ConflictException(TRADE_ERRORS.idempotencyConflict);

    let priced = await this.price(t.tokenIn, t.tokenOut, t.amountInRaw, true, t.sendBy);
    const spender = priced.router;

    if ((await this.allowance(t.tokenIn, t.walletAddress, spender)) < t.amountInRaw) {
      await this.approve(t, spender, ledger);
      // The approval took a few seconds. Price again, so the slippage floor
      // the build writes comes from a current price and not the one before.
      priced = await this.price(t.tokenIn, t.tokenOut, t.amountInRaw, true, t.sendBy);
      if (priced.router !== spender) throw new KyberFailure('unavailable', 'router changed during the approval');
    }

    const built = await this.build(priced, t);

    // The last moment to back out with nothing spent. Past it, the swap could
    // still be settling when the extension stops waiting, and a press it gave
    // up on comes back under a new key and buys twice.
    if (Date.now() > t.sendBy) throw new KyberFailure('rate-limited', 'out of time before sending the swap');

    const leg = ledger.add({ kind: 'swap', status: 'pending', chain: this.chainCode, sentAt: nowIso() });
    await ledger.save(true);
    const sent = await this.send(
      ledger,
      leg,
      {
        walletId: t.walletId,
        contractAddress: spender,
        callData: built.callData,
        idempotencyKey: legKey(t.actionId, 'swap', swaps.length),
        refId: `${t.actionId}:swap`,
      },
      this.left(t.deadline),
    );
    if (sent.state !== 'sent') throw new CircleSendError(errText(sent.error), ledger.snapshot());
    return this.settle(t, ledger, leg, built.minOut);
  }

  /** Approve the router for exactly this trade's amount and wait until the chain shows it. */
  private async approve(t: Trade, spender: Address, ledger: Ledger): Promise<void> {
    // An approval that may still land is resumed under its own key (Circle
    // answers a repeated key with the same transaction); one that finished,
    // either way, is not reused, because the allowance just read short.
    const approves = ledger.all('approve');
    let leg = approves.find((l) => l.status === 'pending' || l.status === 'sent');
    const attempt = leg ? approves.indexOf(leg) : approves.length;

    if (!leg?.txHash) {
      if (Date.now() > t.sendBy) throw new KyberFailure('rate-limited', 'out of time before the approval');
      if (!leg) {
        leg = ledger.add({ kind: 'approve', status: 'pending', chain: this.chainCode, sentAt: nowIso() });
        await ledger.save(true);
      }
      const sent = await this.send(
        ledger,
        leg,
        {
          walletId: t.walletId,
          contractAddress: t.tokenIn,
          callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, t.amountInRaw] }),
          idempotencyKey: legKey(t.actionId, 'approve', attempt),
          refId: `${t.actionId}:approve`,
        },
        this.left(t.sendBy),
      );
      if (sent.state === 'not-sent') throw new CircleSendError(errText(sent.error), ledger.snapshot());
      // Still on its way. Nothing was traded, and pressing again resumes this
      // same approval instead of starting another.
      if (sent.state === 'unknown') throw new KyberFailure('rate-limited', `approval unconfirmed: ${errText(sent.error)}`);
    }

    const hash = leg.txHash as Address;
    let receipt: TransactionReceipt;
    try {
      receipt = await this.chain.receipt(hash, this.left(t.sendBy));
    } catch (e) {
      throw new KyberFailure('rate-limited', `approval ${hash} has no receipt yet: ${errText(e)}`);
    }
    leg.gasUsdcRaw = gasUsdcRaw(receipt).toString();

    // A successful receipt says the transaction ran; the allowance says the
    // approval took. Only the second counts, and it also covers an SCA
    // wallet, whose bundle can succeed while the call inside it fails.
    let granted = 0n;
    if (receipt.status === 'success') {
      try {
        granted = await this.allowanceAfter(t, spender, receipt.blockNumber);
      } catch (e) {
        await ledger.save(false);
        throw new KyberFailure('rate-limited', `allowance unreadable after ${hash}: ${errText(e)}`);
      }
    }
    if (granted < t.amountInRaw) {
      leg.status = 'failed';
      leg.error = receipt.status === 'success' ? 'allowance still short after approve' : 'approve reverted';
      await ledger.save(false);
      throw this.chainFailure(t, 'the spending approval did not go through');
    }
    leg.status = 'confirmed';
    leg.confirmedAt = nowIso();
    await ledger.save(false);
  }

  /**
   * Ask Circle to send one leg, and record on the leg what came of it.
   *
   * A throw from Circle is not one thing. The SDK's wait throws on a terminal
   * state (CANCELLED, DENIED, FAILED, STUCK) even when the transaction already
   * has a hash; a create Circle refused never made a transaction at all; a
   * timeout knows nothing. So the leg ends in one of three places: with a
   * hash (the chain decides), failed (provably never sent, so the action may
   * be tried again), or pending (maybe sent, never retried).
   */
  private async send(ledger: Ledger, leg: Leg, p: ExecuteParams, timeoutMs: number): Promise<SendOutcome> {
    try {
      const tx = await this.wallets.execute(p, timeoutMs);
      leg.circleTxId = tx.circleTxId;
      leg.txHash = lower(tx.txHash);
      leg.status = 'sent';
      await ledger.save(false);
      return { state: 'sent' };
    } catch (e) {
      const fault = await this.circleFault(e);
      if (fault.circleTxId) leg.circleTxId = fault.circleTxId;
      leg.error = errText(e).slice(0, 300);
      if (fault.txHash) {
        leg.txHash = fault.txHash;
        leg.status = 'sent';
        await ledger.save(false);
        return { state: 'sent' };
      }
      if (fault.neverSent) leg.status = 'failed';
      await ledger.save(false);
      return { state: fault.neverSent ? 'not-sent' : 'unknown', error: e };
    }
  }

  /**
   * What a Circle failure says about the transaction behind it. Fields on the
   * error (circleTxId, state, txHash) are the whole answer when present;
   * otherwise the SDK's own wording names the id and the state, and Circle is
   * asked once whether that transaction has a hash.
   */
  private async circleFault(e: unknown): Promise<{ circleTxId?: string; txHash?: Address; neverSent: boolean }> {
    const x = (e ?? {}) as { circleTxId?: unknown; state?: unknown; txHash?: unknown; status?: unknown; method?: unknown };
    const structured = typeof x.circleTxId === 'string';
    let id = structured ? (x.circleTxId as string) : undefined;
    let state = typeof x.state === 'string' ? x.state.toUpperCase() : undefined;
    let hash = typeof x.txHash === 'string' && TX_HASH.test(x.txHash) ? lower(x.txHash) : undefined;
    const said = structured ? null : CIRCLE_TERMINAL.exec(errText(e));
    if (said) {
      id = said[1];
      state ??= said[2].toUpperCase();
    }
    if (id && !hash && !structured) {
      try {
        const tx = (await this.wallets.client.getTransaction({ id })).data?.transaction;
        if (typeof tx?.txHash === 'string' && TX_HASH.test(tx.txHash)) hash = lower(tx.txHash);
        if (typeof tx?.state === 'string') state = tx.state.toUpperCase();
      } catch (err) {
        this.logger.warn(`Circle transaction ${id} unreadable: ${errText(err)}`);
      }
    }
    // A 4xx answer to the create itself (the SDK's HTTP errors carry method
    // and status) means Circle made no transaction. 408 and 409 are excluded:
    // one is a timeout, the other says this key was used before.
    const status = typeof x.status === 'number' ? x.status : 0;
    const refused = x.method === 'POST' && status >= 400 && status < 500 && status !== 408 && status !== 409;
    return { circleTxId: id, txHash: hash, neverSent: !hash && (refused || (state !== undefined && NEVER_SENT_STATES.has(state))) };
  }

  /** Wait for the swap's receipt and read what actually arrived. */
  private async settle(t: Trade, ledger: Ledger, leg: Leg, minOut: bigint | null): Promise<Executed> {
    const hash = lower(leg.txHash as string);
    let receipt: TransactionReceipt;
    try {
      receipt = await this.chain.receipt(hash, this.left(t.deadline));
    } catch (e) {
      this.logger.warn(`swap ${hash} has no receipt yet: ${errText(e)}`);
      throw new SwapPendingError(hash, ledger.snapshot());
    }
    leg.gasUsdcRaw = gasUsdcRaw(receipt).toString();

    // An SCA wallet's receipt is the bundle's; whether the swap inside ran is
    // in the EntryPoint's event. An EOA's receipt status is the swap's own.
    const op = userOpSucceeded(receipt.logs, t.walletAddress);
    if (receipt.status !== 'success' || op === false) {
      leg.status = 'failed';
      leg.error = op === false ? 'user operation reverted' : 'reverted';
      await ledger.save(false);
      // After an exact approval, a KyberSwap swap reverts almost only on its
      // minimum-out check. The word "slippage" is also what the extension
      // turns into "The price moved while you pressed. Try again." No hash in
      // the sentence: the extension hides any sentence with one, and reads
      // "401" anywhere in a sell error as signed out. The leg keeps the hash.
      throw this.chainFailure(t, 'it was rejected, most likely because the price moved past the slippage limit');
    }

    let out = receivedFromLogs(receipt.logs, t.tokenOut, t.walletAddress);
    if (t.tokenOut === this.usdc) {
      // USDC paid out as native value logs only at ARC_NATIVE_LOG, in 18
      // decimals. An ERC-20 payout logs in both places, so take the larger
      // reading rather than the sum.
      const native = receivedFromLogs(receipt.logs, ARC_NATIVE_LOG, t.walletAddress) / 10n ** 12n;
      if (native > out) out = native;
    }

    if (out === 0n) {
      if (op === null && this.config.circle.accountType === 'SCA') {
        // A bundle without our user operation's event proves nothing about
        // the swap inside it, and nothing arrived.
        leg.status = 'failed';
        leg.error = 'succeeded without delivering the output token';
        await ledger.save(false);
        throw this.chainFailure(t, 'nothing arrived in the wallet');
      }
      // The call itself succeeded, and the router only succeeds after
      // checking that this wallet's balance of the output rose by at least
      // the minimum. So the trade filled and only our reading is short:
      // answering "failed" here would invite a second, real trade.
      out = await this.balanceRise(t, receipt);
      if (out === 0n && minOut !== null) out = minOut;
      this.logger.warn(`swap ${hash} succeeded without a Transfer log to the wallet; reporting ${out}`);
    }

    leg.status = 'confirmed';
    leg.confirmedAt = nowIso();
    await ledger.save(false);
    return { venue: this.venue, txHash: hash, amountOutRaw: out, legs: ledger.snapshot() };
  }

  /** The wallet's balance of the output across the swap's block, for a payout that logged nothing. */
  private async balanceRise(t: Trade, receipt: TransactionReceipt): Promise<bigint> {
    const block = receipt.blockNumber;
    if (typeof block !== 'bigint' || block < 1n) return 0n;
    const read = (blockNumber: bigint) =>
      this.chain.client.readContract({
        address: t.tokenOut,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [t.walletAddress],
        blockNumber,
      });
    try {
      const [before, after] = await Promise.all([read(block - 1n), read(block)]);
      let rise = after - before;
      // An EOA pays Arc's gas from the same USDC balance it was paid into.
      if (t.tokenOut === this.usdc && typeof receipt.from === 'string' && lower(receipt.from) === t.walletAddress) {
        rise += gasUsdcRaw(receipt);
      }
      return rise > 0n ? rise : 0n;
    } catch (e) {
      this.logger.warn(`balance of ${t.tokenOut} around block ${block} unreadable: ${errText(e)}`);
      return 0n;
    }
  }

  /**
   * GET /routes, checked against what we asked. Any router other than the
   * pinned ones is refused here, before a quote is shown, because execute
   * would refuse it anyway. `sendBy` is the trade's send deadline, or null
   * for a quote.
   */
  private async price(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    withFee: boolean,
    sendBy: number | null,
  ): Promise<Priced> {
    const q = new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString() });
    const fee = withFee ? this.feeFor(tokenIn, tokenOut) : null;
    if (fee) {
      q.set('feeAmount', String(fee.bps));
      q.set('isInBps', 'true');
      q.set('chargeFeeBy', fee.side);
      q.set('feeReceiver', fee.receiver);
    }
    const data = await this.call<KyberRoutesData>(`/routes?${q.toString()}`, { method: 'GET' }, sendBy);
    const s = data.routeSummary;
    if (!s || lower(String(s.tokenIn)) !== tokenIn || lower(String(s.tokenOut)) !== tokenOut) {
      throw new KyberFailure('unavailable', 'route does not match the requested pair');
    }
    if (toRaw(s.amountIn) !== amountIn) throw new KyberFailure('unavailable', 'route does not match the requested amount');
    const amountOut = toRaw(s.amountOut);
    if (amountOut === null) throw new KyberFailure('unavailable', `unreadable amountOut ${String(s.amountOut)}`);
    if (amountOut === 0n) throw new KyberFailure('no-route', 'route delivers nothing');
    const router = lower(String(data.routerAddress ?? s.routerAddress ?? ''));
    if (!this.routers.has(router)) {
      this.logger.error(`KyberSwap named router ${router}, not a pinned one; refusing. Update KYBER_OPTIONS.routers if it moved.`);
      throw new KyberFailure('unavailable', `unexpected router ${router}`);
    }
    return { summary: s, router, amountOut, feeBps: fee?.bps ?? 0, feeReceiver: fee?.receiver ?? null };
  }

  /**
   * POST /route/build, then the checks a custodial wallet owes itself before
   * signing what a third party wrote. The envelope must name the router we
   * approved, our amount and no native value. The calldata itself is decoded
   * and must spend exactly this amount of this token, pay the output token to
   * this wallet, carry no permit, pay fees to nobody but us, and hold a floor
   * no lower than our slippage allows under the price we just saw. A build
   * reprices by a wei or two, so the floor gets one basis point of grace.
   */
  private async build(p: Priced, t: Trade): Promise<{ callData: Address; minOut: bigint }> {
    const b = await this.call<KyberBuildData>(
      '/route/build',
      {
        method: 'POST',
        body: {
          routeSummary: p.summary,
          sender: t.walletAddress,
          recipient: t.walletAddress,
          slippageTolerance: this.opts.slippageBps,
          deadline: Math.floor(Date.now() / 1000) + this.opts.deadlineSec,
          source: this.opts.clientId,
        },
      },
      t.sendBy,
    );
    const refuse = (why: string): never => {
      this.logger.error(`refusing KyberSwap build for action ${t.actionId}: ${why}`);
      throw new KyberFailure('unavailable', why);
    };
    if (lower(String(b.routerAddress ?? '')) !== p.router) refuse('build names another router');
    if (toRaw(b.amountIn) !== t.amountInRaw) refuse('build spends another amount');
    const value = toRaw(b.transactionValue ?? '0');
    if (value === null || value !== 0n) refuse('build carries native value');
    const data = typeof b.data === 'string' ? b.data : '';

    const d = swapDescription(data);
    if (!d) return refuse('calldata is not a router swap');
    if (d.srcToken !== t.tokenIn) refuse(`calldata spends ${d.srcToken}`);
    if (d.dstToken !== t.tokenOut) refuse(`calldata buys ${d.dstToken}`);
    if (d.dstReceiver !== t.walletAddress) refuse(`calldata pays ${d.dstReceiver}`);
    if (d.amount !== t.amountInRaw) refuse(`calldata spends ${d.amount}`);
    if (d.permit !== '0x') refuse('calldata carries a permit');
    const feeTo = p.feeReceiver;
    if (d.feeReceivers.some((r) => r !== feeTo)) refuse(`calldata pays a fee to ${d.feeReceivers.join(',')}`);
    const floorBps = BigInt(Math.max(0, 10_000 - this.opts.slippageBps - 1));
    if (d.minReturnAmount === 0n || d.minReturnAmount * 10_000n < p.amountOut * floorBps) {
      refuse(`calldata floor ${d.minReturnAmount} is under ${p.amountOut} less slippage`);
    }
    return { callData: data as Address, minOut: d.minReturnAmount };
  }

  /**
   * One request to KyberSwap, through the rate gate. Everything that goes
   * wrong becomes a KyberFailure with a kind, and the kind picks the sentence.
   * During a trade, the wait and the request both end by the send deadline.
   */
  private async call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }, sendBy: number | null): Promise<T> {
    const within = (ms: number) => (sendBy === null ? ms : Math.min(ms, sendBy - Date.now()));
    await this.gate.take(within(sendBy === null ? this.opts.quoteWaitMs : this.opts.executeWaitMs));
    const timeoutMs = Math.floor(within(this.opts.httpTimeoutMs));
    if (timeoutMs < 1) throw new KyberFailure('rate-limited', 'out of time before asking KyberSwap');
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}${path}`, {
        method: init.method,
        headers: {
          accept: 'application/json',
          'x-client-id': this.opts.clientId,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      this.logger.warn(`${init.method} ${path.split('?')[0]} failed: ${errText(e)}`);
      throw new KyberFailure('unavailable', errText(e));
    }
    if (res.status === 429) {
      this.logger.warn(`${init.method} ${path.split('?')[0]} answered 429`);
      throw new KyberFailure('rate-limited', 'HTTP 429');
    }
    const body = (await res.json().catch(() => null)) as KyberEnvelope<T> | null;
    if (res.ok && body && body.code === 0 && body.data) return body.data;

    const code = typeof body?.code === 'number' ? body.code : null;
    const detail = `HTTP ${res.status} code ${code ?? '-'} ${body?.message ?? ''}`.trim();
    if (code !== null && NO_ROUTE_CODES.has(code)) throw new KyberFailure('no-route', detail);
    if (code !== null && TOO_SMALL_CODES.has(code)) throw new KyberFailure('too-small', detail);
    if (/rate.?limit|too many/i.test(body?.message ?? '')) throw new KyberFailure('rate-limited', detail);
    this.logger.warn(`${init.method} ${path.split('?')[0]}: ${detail}`);
    throw new KyberFailure('unavailable', detail);
  }

  /**
   * Poppin's fee, taken in USDC whichever side USDC is on: a buy pays it from
   * the USDC going in, a sell from the USDC coming out. Charged on a meme
   * token instead, it would land in the fee wallet as something we would then
   * have to sell into the same thin pool.
   */
  private feeFor(tokenIn: Address, tokenOut: Address): { bps: number; side: 'currency_in' | 'currency_out'; receiver: Address } | null {
    const { feeBps, feeRecipient } = this.config;
    if (!feeBps || !feeRecipient) return null;
    const side = tokenOut === this.usdc && tokenIn !== this.usdc ? 'currency_out' : 'currency_in';
    return { bps: feeBps, side, receiver: lower(feeRecipient) };
  }

  private allowance(token: Address, owner: Address, spender: Address, blockNumber?: bigint): Promise<bigint> {
    return this.chain.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    });
  }

  /**
   * The allowance as of the approval's own block. Approvals are exact and
   * every swap spends its approval in full, so nearly every trade reads this;
   * at "latest", a load-balanced RPC node one block behind the one that
   * served the receipt would report the world before the approval. A node
   * that has not seen the block yet refuses the read, and catches up in a
   * moment.
   */
  private async allowanceAfter(t: Trade, spender: Address, blockNumber: bigint | null | undefined): Promise<bigint> {
    const at = typeof blockNumber === 'bigint' ? blockNumber : undefined;
    for (let i = 0; ; i++) {
      try {
        return await this.allowance(t.tokenIn, t.walletAddress, spender, at);
      } catch (e) {
        if (i >= 2 || Date.now() + 400 > t.sendBy) throw e;
        await delay(400);
      }
    }
  }

  private assertTradable(tokenIn: Address, tokenOut: Address, amountInRaw: bigint): void {
    if (!this.supports(tokenIn, tokenOut)) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    if (amountInRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.tooSmall);
  }

  /** "Swap failed" or "Sell failed", by direction: a sell is a token going back to USDC. */
  private chainFailure(t: Trade, why: string): BadRequestException {
    const sell = t.tokenOut === this.usdc && t.tokenIn !== this.usdc;
    return new BadRequestException(sell ? TRADE_ERRORS.sellChainFailed(why) : TRADE_ERRORS.chainFailed(why));
  }

  /** Milliseconds until `at`, never under a second, for waits that must not start already expired. */
  private left(at: number): number {
    return Math.max(1_000, at - Date.now());
  }

  private get chainCode(): string {
    return this.config.network.walletsBlockchain;
  }

  /**
   * Run `fn` after every earlier holder of `key` in this process has finished,
   * or fail with the traffic sentence if that takes longer than `maxWaitMs`.
   * A waiter that gives up passes its place straight on, so whoever queued
   * behind it still waits for the holder and never runs alongside it.
   */
  private async exclusive<T>(key: string, maxWaitMs: number, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = before.then(() => mine);
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const got = await Promise.race([
      before.then(() => true),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), Math.max(0, maxWaitMs));
      }),
    ]);
    clearTimeout(timer);
    if (!got) {
      release();
      throw new KyberFailure('rate-limited', `another trade on ${key} is still running`);
    }
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
