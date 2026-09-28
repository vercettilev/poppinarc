import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { SwapConfig, SwapParams, SwapResult } from '@circle-fin/app-kit';
import { Arc, ArcTestnet } from '@circle-fin/app-kit/chains';
import {
  erc20Abi,
  formatUnits,
  getAbiItem,
  parseEventLogs,
  parseUnits,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { ArcChain, gasUsdcRaw } from '../arc/chain';
import { circleAssetByAddress, circleAssets, type TokenInfo } from '../arc/network';
import { CircleKit } from '../circle/kit';
import { APP_CONFIG, AppConfig, real } from '../config';
import {
  lower,
  TRADE_ERRORS,
  type Address,
  type Executed,
  type ExecuteRequest,
  type Leg,
  type Quote,
  type QuoteRequest,
  type SwapRouter,
} from '../trade/types';

/**
 * CIRCLE APP KIT SWAP, the venue for Circle's own assets on Arc.
 *
 * App Kit Swap trades exactly three tokens here: USDC, EURC and cirBTC. It
 * prices through Circle's swap service and executes from the user's Circle
 * wallet through the Circle Wallets adapter; every other token goes to the
 * aggregator venue.
 *
 * NO IDEMPOTENCY KEY. Unlike CircleWallets.execute, App Kit sends through the
 * adapter's EIP-1193 provider, which makes up a fresh Circle idempotency key
 * for every transaction. Calling kit.swap twice for one action is two swaps.
 * So a retry is prevented by the caller's action row, not by Circle:
 *
 * 1. Before execute, the caller reads the action and asks `mayHaveSent(legs)`.
 *    Anything but a plain "no" is a 409, never a second kit.swap.
 * 2. execute calls `hooks.beforeSend` with a pending swap leg immediately
 *    before kit.swap; the caller persists it. If the process dies mid-swap, the
 *    row still says "maybe sent" and step 1 refuses the retry.
 * 3. Every failure after that point is a SwapNotCompleted carrying the legs to
 *    persist and a sendState. A swap leg marked failed WITHOUT a hash is only
 *    ever written when the kit failed before it could send, which is what
 *    makes the action safe to retry.
 *
 * Within one process, a second execute for an action already sending is a
 * 409 straight away, so two requests racing past the ledger still send once.
 *
 * When the kit fails in a way that does not say whether the swap left, the
 * chain answers instead, but only with proof: exactly one successful
 * transaction since the block we started at that moves the input amount from
 * the wallet into App Kit's swap contract and pays the output token back to
 * the wallet, and that no other action holds or may still be sending. Presets
 * make equal amounts common, so anything less stays "maybe sent".
 *
 * ONE DEADLINE. execute answers within its budget, or the caller's deadline
 * when that is sooner, counting the kit's wait and every chain read. A slow
 * RPC turns into a "sent" or "maybe sent" answer, never a request the
 * extension abandons and presses again under a new key.
 */

export type SwapSendState = 'not-sent' | 'maybe-sent' | 'sent';

/**
 * Whether a swap may already have been sent for an action, from its recorded
 * legs alone. A hash means the chain has it. A swap leg without a hash that is
 * not `failed` means kit.swap was called and its outcome is unknown.
 */
export function swapSendState(legs: readonly Leg[]): SwapSendState {
  let state: SwapSendState = 'not-sent';
  for (const leg of legs) {
    if (leg.kind !== 'swap') continue;
    if (leg.txHash) return 'sent';
    if (leg.status !== 'failed') state = 'maybe-sent';
  }
  return state;
}

/** A swap that did not complete, with the legs the caller must record. */
export class SwapNotCompleted extends HttpException {
  constructor(
    status: number,
    message: string,
    readonly legs: Leg[],
    readonly sendState: SwapSendState,
  ) {
    super(message, status);
  }
}

export interface SwapHooks {
  /** Persist these legs; called right before kit.swap. Throwing aborts the send. */
  beforeSend?: (legs: Leg[]) => void | Promise<void>;
  /**
   * The outcome of a swap that outlived execute's wait. `executed` is null when
   * it failed; the legs say how.
   */
  onLate?: (legs: Leg[], executed: Executed | null) => void | Promise<void>;
  /** When the caller stops waiting (epoch ms). execute answers by then, or sooner by its own budget. */
  deadlineAt?: number;
  /**
   * Whether another action records this swap hash, or may own it. Asked
   * before a swap found only on chain is claimed for this action. True, or no
   * answer, leaves the outcome "maybe sent" instead.
   */
  ownedElsewhere?: (txHash: string) => boolean | Promise<boolean>;
}

/** 0.5%. Stable pairs move far less; cirBTC moves more but rarely in seconds. */
export const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 1000;

/**
 * ARC_SLIPPAGE_BPS, read here until AppConfig has a `slippageBps` field. A bad
 * value falls back to the default instead of stopping the boot: slippage has a
 * safe default, and a typo should not take trading down.
 */
export function slippageBpsFrom(env: NodeJS.ProcessEnv): { bps: number; ignored: string | null } {
  const v = real(env.ARC_SLIPPAGE_BPS);
  if (v === null) return { bps: DEFAULT_SLIPPAGE_BPS, ignored: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLIPPAGE_BPS) return { bps: DEFAULT_SLIPPAGE_BPS, ignored: v };
  return { bps: n, ignored: null };
}

/**
 * Percent of value lost between what goes in and what comes out, at market
 * prices. Clamped to [0, 100] and always finite, because the extension calls
 * toFixed on it.
 */
export function impactFrom(inUsd: number, outUsd: number): number {
  if (!(inUsd > 0) || !Number.isFinite(inUsd) || !Number.isFinite(outUsd)) return 0;
  const pct = (1 - outUsd / inUsd) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(100, Math.round(pct * 100) / 100);
}

/** App Kit's registry names. It resolves these to the same addresses as network.ts. */
const KIT_SYMBOL: Record<TokenInfo['symbol'], string> = { USDC: 'USDC', EURC: 'EURC', cirBTC: 'CIRBTC' };

/**
 * A quote before sign-in has no wallet yet. The service prices the trade for
 * any sender and nothing is executed, so a fixed address stands in.
 */
const QUOTE_ONLY_ADDRESS: Address = '0x000000000000000000000000000000000000dead';

/** A cent of USDC: what a shortfall sentence adds for gas the wallet could not pay. */
const GAS_HEADROOM_RAW = 10_000n;

/**
 * Sentences shared with trade.service.ts (TRADE_COPY there), repeated here
 * because importing that service would pull the whole trade module into the
 * router. "slippage" is the word the extension turns into "The price moved
 * while you pressed".
 */
const SLIPPAGE_SENTENCE = 'The price moved past the slippage limit. Press again.';
const UNAVAILABLE_SENTENCE = 'Trading is unavailable for a moment. Nothing was charged.';

const RATES_TTL_MS = 30_000;
const RECEIPT_TIMEOUT_MS = 30_000;
/** The most a balance or block read may take. A slow RPC costs the check, not the send's time. */
const READ_MS = 5_000;
/** A swap that ends after execute answered gets this long to be settled for onLate. */
const LATE_SETTLE_MS = 60_000;
/**
 * How long a swap whose end is unknown still counts as the possible owner of
 * a matching transfer. Circle may send a queued transaction minutes after
 * the kit gave up on it.
 */
const OPEN_TTL_MS = 15 * 60_000;
const MAX_OWNED = 2_000;
const MAX_CANDIDATES = 3;
const MAX_APPROVALS = 3;

/** Kit error codes raised before anything is signed: nothing left the wallet. */
const PRE_SEND = (code: number) =>
  (code >= 1000 && code < 1100) || code === 6001 || code === 7001 || code === 8001 || (code >= 9001 && code <= 9003);

const APPROVAL = getAbiItem({ abi: erc20Abi, name: 'Approval' });
const TRANSFER = getAbiItem({ abi: erc20Abi, name: 'Transfer' });

interface Pair {
  in: TokenInfo;
  out: TokenInfo;
}

interface Attempt {
  req: ExecuteRequest;
  pair: Pair;
  wallet: Address;
  fromBlock: bigint | null;
  sentAt: string;
  /** When kit.swap returned or threw; null while it runs. */
  endedAt: number | null;
}

type FeeLine = { token?: unknown; amount?: string | null; type?: string };

@Injectable()
export class CircleSwapRouter implements SwapRouter {
  readonly venue = 'circle-swap' as const;
  private readonly logger = new Logger('routers/circle-swap');
  readonly slippageBps: number;

  /**
   * execute answers within this from its start, or by the caller's deadline
   * when sooner. The trade service keeps its own 70 s budget around it, and
   * the extension gives up at 90 s.
   */
  budgetMs = 60_000;
  /** Kept back from the kit's wait to read the receipt, or search the chain, afterwards. */
  settleReserveMs = 8_000;
  /** With less than this left for the kit, the swap is not started: nothing was charged. */
  minSendMs = 5_000;

  private rates: { at: number; prices: Map<string, number> } | null = null;
  private ratesInFlight: Promise<Map<string, number> | null> | null = null;

  /** Actions between the start of execute and the send. */
  private readonly starting = new Set<string>();
  /** Swaps this process started whose hash is not known yet: still running, or ended without saying. */
  private readonly open = new Set<Attempt>();
  /** Recent swap hashes and the action each belongs to, so one transaction is never claimed twice. */
  private readonly owners = new Map<string, string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly circle: CircleKit,
    private readonly chain: ArcChain,
  ) {
    const fromConfig = (config as AppConfig & { slippageBps?: number }).slippageBps;
    if (typeof fromConfig === 'number') {
      this.slippageBps = fromConfig;
    } else {
      const parsed = slippageBpsFrom(process.env);
      if (parsed.ignored !== null) {
        this.logger.warn(`ARC_SLIPPAGE_BPS "${parsed.ignored}" is not 1..${MAX_SLIPPAGE_BPS}; using ${parsed.bps}`);
      }
      this.slippageBps = parsed.bps;
    }
  }

  supports(tokenIn: Address, tokenOut: Address): boolean {
    const a = circleAssetByAddress(this.config.network, tokenIn);
    const b = circleAssetByAddress(this.config.network, tokenOut);
    return Boolean(a && b && a !== b);
  }

  /** The caller's retry guard: true unless the legs prove no swap left. */
  mayHaveSent(legs: readonly Leg[]): boolean {
    return swapSendState(legs) !== 'not-sent';
  }

  async quote(req: QuoteRequest): Promise<Quote> {
    const pair = this.pair(req.tokenIn, req.tokenOut);
    if (req.amountInRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.tooSmall);
    const wallet = req.from ? lower(req.from) : null;
    const params = this.swapParams(pair, req.amountInRaw, wallet ?? QUOTE_ONLY_ADDRESS);

    const [estimate, prices] = await Promise.all([
      this.circle.kit.estimateSwap(params).catch(async (e: unknown): Promise<never> => {
        throw await this.refusal(e, pair, req.amountInRaw, wallet);
      }),
      this.usdPrices(),
    ]);

    const amountOutRaw = toRaw(estimate.estimatedOutput?.amount, pair.out.decimals);
    if (amountOutRaw === null || amountOutRaw <= 0n) {
      throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    }
    // The stop limit is the floor the swap contract enforces. If the service
    // leaves it out, the same slippage we send gives the same floor.
    const stop = toRaw(estimate.stopLimit?.amount, pair.out.decimals);
    const floor = (amountOutRaw * BigInt(10_000 - this.slippageBps)) / 10_000n;
    const minAmountOutRaw = stop === null ? floor : stop > amountOutRaw ? amountOutRaw : stop;

    return {
      venue: this.venue,
      tokenIn: lower(pair.in.address),
      tokenOut: lower(pair.out.address),
      amountInRaw: req.amountInRaw,
      amountOutRaw,
      minAmountOutRaw,
      priceImpactPct: this.impactPct(pair, req.amountInRaw, amountOutRaw, estimate.fees, prices),
      route: ['Circle'],
    };
  }

  async execute(req: ExecuteRequest, hooks: SwapHooks = {}): Promise<Executed> {
    const pair = this.pair(req.tokenIn, req.tokenOut);
    if (req.amountInRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.tooSmall);
    const callerDeadline = hooks.deadlineAt;
    const until = Math.min(
      Date.now() + this.budgetMs,
      typeof callerDeadline === 'number' && Number.isFinite(callerDeadline) ? callerDeadline : Number.POSITIVE_INFINITY,
    );
    const wallet = lower(req.walletAddress);
    const params = this.swapParams(pair, req.amountInRaw, wallet);

    // A plain 409 with no legs: the twin's pending leg in the row must stay.
    if (this.busy(req.actionId)) throw new ConflictException(TRADE_ERRORS.idempotencyConflict);
    this.starting.add(req.actionId);
    let a: Attempt;
    try {
      a = await this.prepare(req, pair, wallet, until, hooks);
    } finally {
      this.starting.delete(req.actionId);
    }

    const kitWait = left(until) - this.settleReserveMs;
    if (kitWait <= 0) {
      // The ledger write took the time. Nothing was sent, and the failed leg says so.
      this.open.delete(a);
      throw new SwapNotCompleted(
        HttpStatus.SERVICE_UNAVAILABLE,
        UNAVAILABLE_SENTENCE,
        [this.failedLeg(a, 'not sent: out of time')],
        'not-sent',
      );
    }

    const call = startSwap(() => this.circle.kit.swap(params));
    const ended = () => {
      a.endedAt = Date.now();
    };
    void call.then(ended, ended);

    let outcome: SwapResult | typeof TIMED_OUT;
    try {
      outcome = await within(call, kitWait);
    } catch (e) {
      return this.afterThrow(e, a, until, hooks);
    }
    if (outcome === TIMED_OUT) {
      // The kit keeps going. Its end is reported through onLate, and only
      // after execute has answered, so the late word lands after the caller
      // records this one.
      let answered!: () => void;
      const done = new Promise<void>((resolve) => (answered = resolve));
      this.settleLate(call, a, hooks, done);
      try {
        return await this.unknownOutcome(a, until, hooks, `still sending after ${kitWait} ms`);
      } finally {
        answered();
      }
    }
    return this.settle(outcome.txHash, a, until, { reportedOut: outcome.amountOut });
  }

  /**
   * Everything before kit.swap. Refusals here are plain HttpExceptions with no
   * legs: nothing was written, so the caller keeps whatever the row holds.
   */
  private async prepare(
    req: ExecuteRequest,
    pair: Pair,
    wallet: Address,
    until: number,
    hooks: SwapHooks,
  ): Promise<Attempt> {
    // App Kit checks balances before a swap only on Solana. On Arc a short
    // balance shows up as a revert that costs gas, so ask the chain first. The
    // block number bounds the later search for the approval and, if the kit
    // loses track, for the swap itself.
    const readMs = Math.min(READ_MS, left(until));
    const [have, fromBlock] = await Promise.all([this.balanceOf(wallet, pair.in, readMs), this.blockNumber(readMs)]);
    if (have !== null && have < req.amountInRaw) {
      throw new BadRequestException(this.shortfallSentence(pair.in, have, req.amountInRaw));
    }
    // Started with too little time, a swap would be answered "maybe sent"
    // while it is still on its way. Better a clean refusal now.
    if (left(until) - this.settleReserveMs < this.minSendMs) {
      throw new ServiceUnavailableException(UNAVAILABLE_SENTENCE);
    }

    const a: Attempt = { req, pair, wallet, fromBlock, sentAt: new Date().toISOString(), endedAt: null };
    await hooks.beforeSend?.([{ kind: 'swap', status: 'pending', chain: this.legChain, sentAt: a.sentAt }]);
    this.open.add(a);
    return a;
  }

  // ─── Execution outcomes ─────────────────────────────────────────────────

  /**
   * Turn a swap hash into the Executed the caller records, reading the receipt
   * as the truth: success is confirmed, a revert is a failure, no receipt by
   * the deadline is a sent swap the caller confirms later.
   */
  private async settle(
    txHash: string,
    a: Attempt,
    until: number,
    o: { reportedOut?: string; kitError?: unknown; receipt?: TransactionReceipt } = {},
  ): Promise<Executed> {
    const hash = lower(txHash) as Hash;
    this.owned(a, hash);
    const sent: Executed = {
      venue: this.venue,
      txHash: hash,
      amountOutRaw: 0n,
      legs: [{ kind: 'swap', status: 'sent', chain: this.legChain, txHash: hash, sentAt: a.sentAt }],
    };

    let receipt = o.receipt;
    if (!receipt) {
      const wait = Math.min(RECEIPT_TIMEOUT_MS, left(until));
      if (wait <= 0) return sent;
      try {
        const r = await within(this.chain.receipt(hash, wait), wait);
        if (r === TIMED_OUT) return sent;
        receipt = r;
      } catch {
        return sent;
      }
    }

    // From here the hash is the answer. An unexpected error would reach the
    // caller with no hash to record, and the reader would press again; so
    // anything that goes wrong reading the receipt answers "sent", and only a
    // revert is thrown, on purpose.
    let legs: Leg[];
    let amountOutRaw = 0n;
    try {
      const approvals = await this.approvals(a, receipt.blockNumber, hash, until);
      const swapLeg: Leg = {
        kind: 'swap',
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        chain: this.legChain,
        txHash: hash,
        sentAt: a.sentAt,
        confirmedAt: new Date().toISOString(),
      };
      const gas = gasOf(receipt);
      if (gas !== undefined) swapLeg.gasUsdcRaw = gas;
      if (receipt.status !== 'success') swapLeg.error = revertReason(o.kitError);
      legs = [...approvals, swapLeg];
      if (receipt.status === 'success') amountOutRaw = this.fill(receipt, a, hash, o.reportedOut);
    } catch (e) {
      this.logger.error(`swap ${hash}: receipt unreadable, answering sent: ${kitInfo(e).message}`);
      return sent;
    }

    if (receipt.status !== 'success') {
      const reason = revertReason(o.kitError);
      throw new SwapNotCompleted(
        HttpStatus.BAD_REQUEST,
        this.isUsdc(a.pair.in) ? TRADE_ERRORS.chainFailed(reason) : TRADE_ERRORS.sellChainFailed(reason),
        legs,
        'sent',
      );
    }
    return { venue: this.venue, txHash: hash, amountOutRaw, legs };
  }

  /**
   * What actually arrived, from the receipt. The kit's own amountOut is a
   * service lookup that may be missing; the Transfer logs are the fill.
   */
  private fill(receipt: TransactionReceipt, a: Attempt, hash: string, reportedOut?: string): bigint {
    const got = received(receipt, a.pair.out, a.wallet);
    if (got !== null) return got;
    const reported = toRaw(reportedOut, a.pair.out.decimals);
    if (reported !== null) return reported;
    this.logger.warn(`swap ${hash}: no Transfer to the wallet and no reported amount; recording 0`);
    return 0n;
  }

  /** kit.swap threw. Decide from the error, then from the chain, whether the swap left. */
  private async afterThrow(e: unknown, a: Attempt, until: number, hooks: SwapHooks): Promise<Executed> {
    const kit = kitInfo(e);
    // The kit attaches the swap hash to every error raised after broadcast.
    if (kit.txHash) return this.settle(kit.txHash, a, until, { kitError: e });

    if (kit.code !== null && PRE_SEND(kit.code)) {
      this.open.delete(a);
      const refusal = await this.refusal(e, a.pair, a.req.amountInRaw, a.wallet, Math.min(READ_MS, left(until)));
      throw new SwapNotCompleted(
        refusal.getStatus(),
        refusal.message,
        [this.failedLeg(a, kit.name ?? 'refused')],
        'not-sent',
      );
    }

    this.logger.warn(`swap for action ${a.req.actionId} threw without a hash: ${kit.name ?? ''} ${kit.message}`);
    return this.unknownOutcome(a, until, hooks, kit.name ?? 'no hash from the kit');
  }

  /** The kit cannot say whether the swap left. The chain can, if it did and nobody else could own it. */
  private async unknownOutcome(a: Attempt, until: number, hooks: SwapHooks, why: string): Promise<Executed> {
    const found = await this.findSwapOnChain(a, until, hooks);
    if (found) return this.settle(found.hash, a, until, { receipt: found.receipt });
    throw new SwapNotCompleted(
      HttpStatus.CONFLICT,
      TRADE_ERRORS.idempotencyConflict,
      [{ kind: 'swap', status: 'pending', chain: this.legChain, sentAt: a.sentAt, error: `outcome unknown: ${why}` }],
      'maybe-sent',
    );
  }

  /** A swap still running after execute returned: report its end through onLate. */
  private settleLate(call: Promise<SwapResult>, a: Attempt, hooks: SwapHooks, answered: Promise<void>): void {
    call
      .then(
        (r) => this.settle(r.txHash, a, Date.now() + LATE_SETTLE_MS, { reportedOut: r.amountOut }),
        (e: unknown) => this.afterThrow(e, a, Date.now() + LATE_SETTLE_MS, hooks),
      )
      .then(
        async (executed) => {
          await answered;
          await hooks.onLate?.(executed.legs, executed);
        },
        async (e: unknown) => {
          await answered;
          if (e instanceof SwapNotCompleted) return hooks.onLate?.(e.legs, null);
          this.logger.error(`late swap for action ${a.req.actionId} ended unknown: ${kitInfo(e).message}`);
        },
      )
      .catch((e: unknown) => this.logger.error(`onLate for action ${a.req.actionId} threw: ${kitInfo(e).message}`));
  }

  /**
   * Every App Kit swap pulls its input from the wallet into the kit's swap
   * contract in one Transfer, then pays the output back to the wallet (seen
   * on Arc mainnet). An approval moves nothing. So a successful transaction
   * since our start block with exactly that Transfer, and the output paid to
   * the wallet, is a kit swap of this size.
   *
   * It is this action's swap only if nothing else could have made it: no other
   * swap of the same token and amount from this wallet still open in this
   * process, no other action holding its hash, and no second match. Presets
   * and hold-to-buy repeat amounts, so ambiguity is ordinary and stays "maybe".
   */
  private async findSwapOnChain(
    a: Attempt,
    until: number,
    hooks: SwapHooks,
  ): Promise<{ hash: Hash; receipt: TransactionReceipt } | null> {
    if (a.fromBlock === null || this.hasRival(a)) return null;
    try {
      const logs = await within(
        this.chain.client.getLogs({
          address: a.pair.in.address,
          event: TRANSFER,
          args: { from: a.wallet, to: this.kitAdapter },
          fromBlock: a.fromBlock,
          toBlock: 'latest',
        }),
        left(until),
      );
      if (logs === TIMED_OUT) return null;

      const byTx = new Map<string, bigint>();
      for (const log of logs) {
        if (!log.transactionHash || log.args.value === undefined) continue;
        const h = log.transactionHash.toLowerCase();
        byTx.set(h, (byTx.get(h) ?? 0n) + log.args.value);
      }
      const candidates = [...byTx]
        .filter(([h, sum]) => sum === a.req.amountInRaw && !this.ownedByOther(h, a))
        .map(([h]) => h as Hash);
      if (candidates.length === 0 || candidates.length > MAX_CANDIDATES) return null;

      const proven: { hash: Hash; receipt: TransactionReceipt }[] = [];
      for (const hash of candidates) {
        const wait = Math.min(RECEIPT_TIMEOUT_MS, left(until));
        if (wait <= 0) return null;
        const receipt = await within(this.chain.receipt(hash, wait), wait);
        if (receipt === TIMED_OUT) return null;
        if (receipt.status !== 'success' || received(receipt, a.pair.out, a.wallet) === null) continue;
        if (hooks.ownedElsewhere) {
          const elsewhere = await within(Promise.resolve(hooks.ownedElsewhere(hash)), left(until));
          if (elsewhere === TIMED_OUT) return null;
          if (elsewhere) continue;
        }
        proven.push({ hash, receipt });
      }
      // A rival may have started while we read the chain.
      if (proven.length !== 1 || this.hasRival(a)) return null;
      return proven[0];
    } catch (e) {
      this.logger.warn(`could not search the chain for action ${a.req.actionId}: ${kitInfo(e).message}`);
      return null;
    }
  }

  /**
   * The kit sends an on-chain approve for any input it cannot permit (every
   * token but USDC, and USDC too when permit falls back), and does not return
   * its hash. The Approval events from this wallet between our start and the
   * swap, outside the swap itself (a permit emits one there), are those
   * approvals. Only for our ledger, so a failed or late search records none.
   */
  private async approvals(a: Attempt, toBlock: bigint, swapHash: string, until: number): Promise<Leg[]> {
    if (a.fromBlock === null || left(until) <= 0) return [];
    try {
      const logs = await within(
        this.chain.client.getLogs({
          address: a.pair.in.address,
          event: APPROVAL,
          args: { owner: a.wallet },
          fromBlock: a.fromBlock,
          toBlock,
        }),
        left(until),
      );
      if (logs === TIMED_OUT) {
        this.logger.warn(`approval search for action ${a.req.actionId} ran out of time`);
        return [];
      }
      const hashes = [
        ...new Set(logs.map((l) => l.transactionHash?.toLowerCase()).filter((h): h is string => !!h && h !== swapHash)),
      ].slice(-MAX_APPROVALS);
      const legs: Leg[] = [];
      for (const h of hashes) {
        const wait = Math.min(RECEIPT_TIMEOUT_MS, left(until));
        if (wait <= 0) break;
        const r = await within(this.chain.receipt(h as Hash, wait), wait);
        if (r === TIMED_OUT) break;
        const leg: Leg = {
          kind: 'approve',
          status: r.status === 'success' ? 'confirmed' : 'failed',
          chain: this.legChain,
          txHash: h,
          sentAt: a.sentAt,
          confirmedAt: new Date().toISOString(),
        };
        const gas = gasOf(r);
        if (gas !== undefined) leg.gasUsdcRaw = gas;
        legs.push(leg);
      }
      return legs;
    } catch (e) {
      this.logger.warn(`approval search failed for action ${a.req.actionId}: ${kitInfo(e).message}`);
      return [];
    }
  }

  // ─── Attempts in this process ───────────────────────────────────────────

  /** An action with a send starting, running, or ended without an answer. */
  private busy(actionId: string): boolean {
    if (this.starting.has(actionId)) return true;
    this.pruneOpen();
    for (const o of this.open) if (o.req.actionId === actionId) return true;
    return false;
  }

  /** Another open swap from this wallet whose Transfer would look exactly like this one's. */
  private hasRival(a: Attempt): boolean {
    this.pruneOpen();
    const token = lower(a.pair.in.address);
    for (const o of this.open) {
      if (o === a) continue;
      if (o.wallet === a.wallet && lower(o.pair.in.address) === token && o.req.amountInRaw === a.req.amountInRaw) {
        return true;
      }
    }
    return false;
  }

  private pruneOpen(): void {
    const now = Date.now();
    for (const o of this.open) if (o.endedAt !== null && now - o.endedAt > OPEN_TTL_MS) this.open.delete(o);
  }

  /** The swap's hash is known: it belongs to this action, and the attempt is no longer open. */
  private owned(a: Attempt, hash: string): void {
    this.open.delete(a);
    this.owners.delete(hash);
    this.owners.set(hash, a.req.actionId);
    if (this.owners.size > MAX_OWNED) {
      const oldest = this.owners.keys().next();
      if (!oldest.done) this.owners.delete(oldest.value);
    }
  }

  private ownedByOther(hash: string, a: Attempt): boolean {
    const owner = this.owners.get(hash);
    return owner !== undefined && owner !== a.req.actionId;
  }

  private failedLeg(a: Attempt, error: string): Leg {
    return { kind: 'swap', status: 'failed', chain: this.legChain, sentAt: a.sentAt, error };
  }

  // ─── Refusals ───────────────────────────────────────────────────────────

  /** A kit error raised before sending, as the sentence the extension knows. */
  private async refusal(
    e: unknown,
    pair: Pair,
    amountInRaw: bigint,
    wallet: Address | null,
    readMs = READ_MS,
  ): Promise<HttpException> {
    if (e instanceof HttpException) return e;
    const { code, name, message } = kitInfo(e);
    switch (code) {
      case 1007: // INPUT_INSUFFICIENT_SWAP_AMOUNT
      case 1013: // INPUT_AMOUNT_OUT_OF_RANGE
        return new BadRequestException(TRADE_ERRORS.tooSmall);
      case 1009: // INPUT_SLIPPAGE_CONSTRAINT_NOT_MET: the price moved between quote and gas estimate
        return new UnprocessableEntityException(SLIPPAGE_SENTENCE);
      case 1003: // INPUT_UNSUPPORTED_ROUTE
      case 1006: // INPUT_UNSUPPORTED_TOKEN
      case 6001: // LIQUIDITY_INSUFFICIENT
        return new UnprocessableEntityException(TRADE_ERRORS.noRoute);
      case 9001: {
        const have = wallet ? await this.balanceOf(wallet, pair.in, readMs) : null;
        return new BadRequestException(this.shortfallSentence(pair.in, have ?? 0n, amountInRaw));
      }
      case 9002: {
        // Gas on Arc is USDC; the wallet cannot pay for the transaction.
        const usdc = this.config.network.usdc;
        const have = wallet ? await this.balanceOf(wallet, usdc, readMs) : null;
        const need = (this.isUsdc(pair.in) ? amountInRaw : 0n) + GAS_HEADROOM_RAW;
        return new BadRequestException(TRADE_ERRORS.insufficientUsdc(floorCents(have ?? 0n), ceilCents(need)));
      }
      case 7001:
        return new UnprocessableEntityException(TRADE_ERRORS.rateLimited);
      default:
        this.logger.warn(`circle swap refused: ${code ?? '-'} ${name ?? ''} ${message}`);
        return new UnprocessableEntityException(TRADE_ERRORS.quoteUnavailable);
    }
  }

  /**
   * Rounded so the sentence never reads as enough (a balance down, the need
   * up, to the cent) and never carries "401", which the chip's sell path reads
   * as "signed out".
   */
  private shortfallSentence(token: TokenInfo, have: bigint, need: bigint): string {
    return this.isUsdc(token)
      ? TRADE_ERRORS.insufficientUsdc(floorCents(have), ceilCents(need))
      : TRADE_ERRORS.insufficientSell(uiForSentence(have, token.decimals));
  }

  // ─── Pricing ────────────────────────────────────────────────────────────

  /**
   * App Kit returns no price impact, so it is measured against Circle's own
   * USD rates: value in versus value out. Poppin's fee is added back first, so
   * the number is the market's cost, as on Solana where Jupiter's impact
   * never included our fee. No rates, no claim: 0.
   */
  private impactPct(
    pair: Pair,
    amountInRaw: bigint,
    amountOutRaw: bigint,
    fees: readonly FeeLine[] | undefined,
    prices: Map<string, number> | null,
  ): number {
    if (!prices) return 0;
    const pIn = prices.get(lower(pair.in.address));
    const pOut = prices.get(lower(pair.out.address));
    if (!pIn || !pOut) return 0;
    const inUsd = ui(amountInRaw, pair.in.decimals) * pIn;
    let outUsd = ui(amountOutRaw, pair.out.decimals) * pOut;
    for (const f of fees ?? []) {
      if (f.type !== 'developer' || f.amount == null) continue;
      const token = this.assetByName(f.token);
      const price = token ? prices.get(lower(token.address)) : undefined;
      const amount = Number(f.amount);
      if (price && Number.isFinite(amount)) outUsd += amount * price;
    }
    return impactFrom(inUsd, outUsd);
  }

  /** Circle's USD rates for our three assets, shared for 30 s across quotes. */
  private async usdPrices(): Promise<Map<string, number> | null> {
    if (this.rates && Date.now() - this.rates.at < RATES_TTL_MS) return this.rates.prices;
    this.ratesInFlight ??= this.fetchRates().finally(() => {
      this.ratesInFlight = null;
    });
    return this.ratesInFlight;
  }

  private async fetchRates(): Promise<Map<string, number> | null> {
    try {
      const res = await this.circle.kit.getTokenRates({
        chain: this.circle.arcChain,
        tokens: Object.values(KIT_SYMBOL),
        ...(this.config.circle.apiKey ? { apiKey: this.config.circle.apiKey } : {}),
      });
      const byChain = res.rates[this.circle.arcChain] ?? Object.values(res.rates)[0];
      if (!byChain) return null;
      const prices = new Map<string, number>();
      for (const [address, rate] of Object.entries(byChain)) {
        const p = Number(rate.priceUSD);
        if (Number.isFinite(p) && p > 0) prices.set(address.toLowerCase(), p);
      }
      this.rates = { at: Date.now(), prices };
      return prices;
    } catch (e) {
      this.logger.warn(`token rates unavailable: ${kitInfo(e).message}`);
      return null;
    }
  }

  // ─── Plumbing ───────────────────────────────────────────────────────────

  private swapParams(pair: Pair, amountInRaw: bigint, address: Address): SwapParams {
    return {
      // The Circle Wallets adapter signs for any of our wallets; `address`
      // says which one, and it throws at runtime without it.
      from: { adapter: this.circle.adapter, chain: this.circle.arcChain, address },
      tokenIn: KIT_SYMBOL[pair.in.symbol],
      tokenOut: KIT_SYMBOL[pair.out.symbol],
      // Human units; the kit converts with the registry's decimals.
      amountIn: formatUnits(amountInRaw, pair.in.decimals),
      config: this.swapConfig(),
    };
  }

  private swapConfig(): SwapConfig {
    const config: SwapConfig = {
      slippageBps: this.slippageBps,
      // A smart account's typed-data signature is its owner's, which an
      // EIP-2612 permit rejects on chain. SCA wallets approve instead.
      allowanceStrategy: this.config.circle.accountType === 'SCA' ? 'approve' : 'permit',
    };
    if (this.config.circle.apiKey) config.apiKey = this.config.circle.apiKey;
    // Both or neither: the kit's schema requires a positive fee and a recipient.
    if (this.config.feeBps > 0 && this.config.feeRecipient) {
      config.customFee = { percentageBps: this.config.feeBps, recipientAddress: this.config.feeRecipient };
    }
    return config;
  }

  private pair(tokenIn: string, tokenOut: string): Pair {
    const a = circleAssetByAddress(this.config.network, tokenIn);
    const b = circleAssetByAddress(this.config.network, tokenOut);
    if (!a || !b || a === b) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    return { in: a, out: b };
  }

  /** One ERC-20 balance, or null when the chain did not answer in time. */
  private async balanceOf(owner: Address, token: TokenInfo, ms = READ_MS): Promise<bigint | null> {
    if (ms <= 0) return null;
    try {
      const balances = await within(this.chain.balancesOf(owner, [token.address]), ms);
      if (balances === TIMED_OUT) {
        this.logger.warn(`balance read timed out after ${ms} ms`);
        return null;
      }
      return balances.get(token.address.toLowerCase()) ?? null;
    } catch (e) {
      this.logger.warn(`balance read failed: ${kitInfo(e).message}`);
      return null;
    }
  }

  /** The current block, or null when the chain did not answer in time. */
  private async blockNumber(ms: number): Promise<bigint | null> {
    if (ms <= 0) return null;
    try {
      const n = await within(this.chain.client.getBlockNumber(), ms);
      return n === TIMED_OUT ? null : n;
    } catch {
      return null;
    }
  }

  /** App Kit's swap contract on this network, from the kit's own chain table. */
  private get kitAdapter(): Address {
    const def = this.config.network.appKitChain === 'Arc' ? Arc : ArcTestnet;
    return lower(def.kitContracts.adapter);
  }

  private assetByName(token: unknown): TokenInfo | null {
    if (typeof token !== 'string') return null;
    const t = token.toLowerCase();
    return (
      circleAssets(this.config.network).find(
        (a) => a.symbol.toLowerCase() === t || a.address.toLowerCase() === t,
      ) ?? null
    );
  }

  private isUsdc(token: TokenInfo): boolean {
    return token.address.toLowerCase() === this.config.network.usdc.address.toLowerCase();
  }

  private get legChain(): string {
    return this.config.network.walletsBlockchain;
  }
}

const TIMED_OUT = Symbol('timed out');
/** setTimeout's ceiling; anything longer fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.min(Math.max(ms, 0), MAX_TIMER_MS));
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Milliseconds until a deadline; negative once it has passed. */
function left(until: number): number {
  return until - Date.now();
}

/** kit.swap as a promise, even if it throws before returning one. */
function startSwap(send: () => Promise<SwapResult>): Promise<SwapResult> {
  try {
    return send();
  } catch (e) {
    return Promise.reject(e);
  }
}

/**
 * What a thrown value says about itself. KitError is matched by shape, not by
 * class: App Kit bundles its own copies of the error classes, and the fields
 * are the contract.
 */
function kitInfo(e: unknown): { code: number | null; name: string | null; message: string; txHash: string | null } {
  const o = (typeof e === 'object' && e !== null ? e : {}) as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    recoverability?: unknown;
    cause?: { trace?: unknown };
  };
  const isKit = typeof o.code === 'number' && typeof o.recoverability === 'string';
  const trace = (o.cause?.trace ?? {}) as { txHash?: unknown };
  const txHash = typeof trace.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(trace.txHash) ? trace.txHash : null;
  return {
    code: isKit ? (o.code as number) : null,
    name: typeof o.name === 'string' ? o.name : null,
    message: typeof o.message === 'string' ? o.message : String(e),
    txHash,
  };
}

/** Why a swap reverted, in words the extension can show and classify. */
function revertReason(e: unknown): string {
  const { code, name, message } = kitInfo(e);
  const text = `${name ?? ''} ${message}`;
  if (code === 1009 || /slippage|stop.?limit|too little|insufficient.?output|min(imum)?.?(amount|out)/i.test(text)) {
    return 'the price moved past the slippage limit';
  }
  return 'the transaction reverted';
}

/**
 * Gas paid, for our ledger only. An RPC that leaves out effectiveGasPrice
 * makes the arithmetic throw; a confirmed swap must not fail over that.
 */
function gasOf(receipt: TransactionReceipt): string | undefined {
  try {
    return gasUsdcRaw(receipt).toString();
  } catch {
    return undefined;
  }
}

/** Sum of tokenOut Transfers into the wallet in this receipt, or null if none. */
function received(receipt: TransactionReceipt, token: TokenInfo, wallet: Address): bigint | null {
  const want = token.address.toLowerCase();
  let sum = 0n;
  let seen = false;
  try {
    for (const log of parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })) {
      if (log.address.toLowerCase() !== want || log.args.to.toLowerCase() !== wallet) continue;
      sum += log.args.value;
      seen = true;
    }
  } catch {
    return null;
  }
  return seen ? sum : null;
}

function toRaw(human: string | undefined | null, decimals: number): bigint | null {
  if (typeof human !== 'string' || !/^\d+(\.\d+)?$/.test(human.trim())) return null;
  try {
    return parseUnits(human.trim(), decimals);
  } catch {
    return null;
  }
}

function ui(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

/**
 * The holding named in the "Insufficient balance" sentence: up to six
 * decimals, trailing zeros trimmed, and never the digits "401". Such a figure
 * is rounded down until it no longer has them; the sentence still says the
 * reader holds less than they asked to sell. The same rule as trade.service.ts.
 */
function uiForSentence(raw: bigint, decimals: number): number {
  let n = Number(formatUnits(raw, decimals));
  for (let places = 6; places >= 0 && /401/.test(fmt(n)); places--) {
    const f = 10 ** places;
    n = Math.floor(n * f) / f;
  }
  let step = 10;
  while (/401/.test(fmt(n)) && step < 1e18) {
    n = Math.floor(n / step) * step;
    step *= 10;
  }
  return Number(fmt(n));
}

function fmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const s = n.toFixed(6).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}

/** USDC raw to dollars, rounded down to the cent: a balance never reads as more than it is. */
function floorCents(raw: bigint): number {
  return Number(raw / 10_000n) / 100;
}

/** USDC raw to dollars, rounded up to the cent: a need never reads as less than it is. */
function ceilCents(raw: bigint): number {
  return Number((raw + 9_999n) / 10_000n) / 100;
}
