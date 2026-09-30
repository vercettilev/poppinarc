import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { erc20Abi, formatUnits, type Hash, type TransactionReceipt } from 'viem';
import { FAR_HOLDINGS, type FarHoldingsPort } from '../far/far-holdings';
import { APP_CONFIG, AppConfig } from '../config';
import { ArcChain, gasUsdcRaw } from '../arc/chain';
import { circleAssetByAddress } from '../arc/network';
import { CircleWallets, type StoredWallet } from '../circle/wallets';
import { stableUuid } from '../circle/ids';
import { MARKET, type MarketPort } from '../market/market.types';
import { ActionsStore, type ActionKind, type ActionRow } from './actions';
import { buildBook, emptyBook, walkLedger, type HeldToken, type SpotPositionsResponse } from './positions';
import {
  TRADE_ERRORS,
  lower,
  type Address,
  type ExecuteRequest,
  type Executed,
  type Leg,
  type Quote,
  type SwapRouter,
  type TokenKind,
  type Venue,
} from './types';

/**
 * TRADING: one buy or one sell, from the reader's Circle wallet on Arc.
 *
 * Every trade is a USDC pair. A buy spends USDC on a token, a sell turns a
 * token back into USDC. The venue is whichever router says it can carry the
 * pair, asked in the order they were registered (circle-swap first for USDC,
 * EURC and cirBTC, the aggregator for everything else), so adding a venue is
 * adding a router, not editing this file.
 *
 * THE LEDGER ROW COMES FIRST. A trade is written to ActionsStore before the
 * first Circle call, keyed by the action id every Circle idempotency key
 * derives from. So "did we already send this?" always has an answer in our
 * own database, and asking Circle again with the same action id returns the
 * transactions it already made instead of making new ones.
 *
 * /swap waits for the receipt before answering (Arc settles in under a
 * second), so the extension's first /confirm usually says 'confirmed' and the
 * chip plays its done ceremony instead of "confirming".
 *
 * A TRADE ANSWERS WITHIN ITS BUDGET. The extension gives up on /swap at 90 s
 * and then tells the reader nothing happened, and its next press carries a
 * new key: a trade that landed after that gets bought twice. So the answer
 * leaves by `tradeBudgetMs` whatever the router is doing. A router still
 * working then keeps going in the background with the same ledger writes,
 * and the reader hears "check your balance", never "did not go through".
 *
 * A SUCCESSFUL RECEIPT IS NOT A FILL. With Gas Station the hash is the
 * bundle's, and a bundle whose inner call failed still reports success. The
 * trade counts only when the token it bought (or the USDC it sold for)
 * reached the wallet in that receipt's Transfer logs.
 */

/** Nest token for the ordered list of venues. */
export const SWAP_ROUTERS = Symbol('SWAP_ROUTERS');

export interface BuyRequest {
  mint: unknown;
  amountUsd: unknown;
  sourceUrl?: unknown;
  idempotencyKey?: unknown;
}

export interface SellRequest {
  mint: unknown;
  amountRaw: unknown;
  sourceUrl?: unknown;
  idempotencyKey?: unknown;
}

export type TradeCategory = 'memecoin' | 'spot' | 'equity' | 'commodity' | 'token' | 'unknown';

export interface BuyResponse {
  signature: string;
  dryRun: false;
  category: TradeCategory;
  outAmountRaw: string;
  shareUrl: null;
}

export interface SellResponse {
  signature: string;
  dryRun: false;
  outUsdcRaw: string;
  shareUrl: null;
}

export interface QuoteResponse {
  outAmount: number;
  pricePerUnit: number;
  priceImpactPct: number;
  route: string[];
}

export type ConfirmResponse = { status: 'confirmed' } | { status: 'unknown' } | { status: 'failed'; chainError?: string };

export interface BalanceResponse {
  uiAmount: number;
  raw: string;
  decimals: number | null;
}

/**
 * Sentences this service adds to TRADE_ERRORS. Each is a plain sentence the
 * extension prints as is: capital first, no camelCase, no dash, no address,
 * under 120 characters, and never the digits "401" (the chip's sell path reads
 * that substring as "signed out").
 */
export const TRADE_COPY = {
  /** Contains "slippage", which the extension turns into "The price moved while you pressed". */
  slippage: 'The price moved past the slippage limit. Press again.',
  reverted: 'the transaction was reverted',
  notThrough: 'That trade did not go through. Press again.',
  slow: 'That trade is taking longer than usual. Check your balance before pressing again.',
  unavailable: 'Trading is unavailable for a moment. Nothing was charged.',
  signatureRequired: 'signature is required',
  mintRequired: 'mint is required',
  /** A buy or sell sent here for an account that signs its own trades (trade/own-wallet.ts). */
  ownWallet: 'This account trades from its own wallet. Approve the trade in your wallet.',
} as const;

/**
 * Arc pays gas in the same USDC the reader spends. A wallet that pays its own
 * gas (EOA) keeps this much back so a "Max" buy does not fail for want of
 * gas; a swap plus an approval costs about two cents. With Gas Station (SCA)
 * gas is sponsored and the whole balance is spendable.
 */
export const GAS_RESERVE_USDC_RAW = 50_000n;

/** The Solana USDC mint an older extension build still asks /balance and /icon about. */
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Ledger note for a swap whose receipt succeeded while nothing reached the wallet. */
const NOTHING_ARRIVED = 'nothing arrived';

@Injectable()
export class TradeService {
  private readonly logger = new Logger('trade');
  private readonly decimalsCache = new Map<Address, number>();

  /**
   * The whole of /swap or /sell, counted from the moment it starts, before
   * the answer leaves no matter what the router is doing. 20 s under the
   * extension's 90 s timeout, for the network and a slow start.
   */
  tradeBudgetMs = 70_000;
  /**
   * A router gets at least this long to send. With less left of the budget
   * the trade is refused before anything is sent (a calm "nothing was
   * charged"), rather than started and then answered with "check your
   * balance".
   */
  minExecuteMs = 10_000;
  /** How long /swap and /sell wait for the receipt, after the router's own wait, before answering "sent, still settling". Part of the budget. */
  receiptWaitMs = 5_000;
  /** The receipt wait for a trade still settling after its answer left; nobody is waiting on it, so it can be longer. */
  lateReceiptWaitMs = 30_000;
  /** How long /confirm waits before saying 'unknown' (the client asks again). */
  confirmWaitMs = 10_000;
  /** A sell right after a buy may read a balance one block behind; one re-read covers it. */
  balanceRetryMs = 500;

  constructor(
    @Inject(SWAP_ROUTERS) private readonly routers: SwapRouter[],
    @Inject(MARKET) private readonly market: MarketPort,
    private readonly chain: ArcChain,
    private readonly actions: ActionsStore,
    private readonly wallets: CircleWallets,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(FAR_HOLDINGS) private readonly far: FarHoldingsPort | null = null,
  ) {}

  get usdc(): Address {
    return lower(this.config.network.usdc.address);
  }

  get eurc(): Address {
    return lower(this.config.network.eurc.address);
  }

  /** The first venue that can carry this pair, or 422 "No route". */
  routerFor(tokenIn: Address, tokenOut: Address): SwapRouter {
    const r = this.routers.find((x) => x.supports(tokenIn, tokenOut));
    if (!r) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    return r;
  }

  // ─── quote ────────────────────────────────────────────────────────────────

  /** USDC in, `mint` out. Unauthenticated; the chip asks while the reader types. */
  async quote(mintInput: unknown, amountUsd: unknown): Promise<QuoteResponse> {
    const mint = parseAddress(mintInput);
    const amountInRaw = usdToRaw(amountUsd);
    if (!mint || amountInRaw === null || amountInRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.badBuy);
    if (mint === this.usdc) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);

    const verdict = await this.market.gate(mint).catch((e) => {
      this.logger.warn(`gate ${mint} failed: ${errorText(e)}`);
      throw new UnprocessableEntityException(TRADE_ERRORS.quoteUnavailable);
    });
    if (!verdict.ok) throw new UnprocessableEntityException(TRADE_ERRORS.notAllowed(verdict.reason));

    const router = this.routerFor(this.usdc, mint);
    let q: Quote;
    try {
      q = await router.quote({ tokenIn: this.usdc, tokenOut: mint, amountInRaw });
    } catch (e) {
      throw quoteRefusal(e);
    }
    const decimals = await this.decimalsOf(mint).catch(() => null);
    if (decimals === null) throw new UnprocessableEntityException(TRADE_ERRORS.quoteUnavailable);

    const outAmount = Number(formatUnits(q.amountOutRaw, decimals));
    if (!(outAmount > 0)) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    const usdIn = Number(amountInRaw) / 1e6;
    return {
      outAmount,
      pricePerUnit: usdIn / outAmount,
      priceImpactPct: Number.isFinite(q.priceImpactPct) ? q.priceImpactPct : 0,
      route: Array.isArray(q.route) && q.route.length ? q.route.map(String) : [venueLabel(router.venue)],
    };
  }

  // ─── buy ──────────────────────────────────────────────────────────────────

  async buy(uid: string, req: BuyRequest): Promise<BuyResponse> {
    const startedAt = Date.now();
    const mint = parseAddress(req.mint);
    const amountInRaw = usdToRaw(req.amountUsd);
    if (!mint || amountInRaw === null || amountInRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.badBuy);
    if (mint === this.usdc) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    const usdc = this.usdc;
    const trade = { kind: 'buy' as const, tokenIn: usdc, tokenOut: mint, amountInRaw };

    const key = idempotencyKeyOf(req.idempotencyKey);
    const actionId = key ? stableUuid('trade', uid, key) : randomUUID();
    if (key) {
      const replay = await this.infra(this.replayable(actionId, uid, trade));
      if (replay) return this.buyReplay(replay, mint);
    }

    const [verdict, category] = await Promise.all([
      this.market.gate(mint).catch((e) => {
        this.logger.warn(`gate ${mint} failed: ${errorText(e)}`);
        throw new UnprocessableEntityException(TRADE_ERRORS.quoteUnavailable);
      }),
      this.categoryOf(mint),
    ]);
    if (!verdict.ok) throw new UnprocessableEntityException(TRADE_ERRORS.notAllowed(verdict.reason));
    const router = this.routerFor(usdc, mint);

    // A reader without a wallet holds nothing, and the natural next step is
    // "Add USDC", which the insufficient sentence opens. No Circle call here:
    // wallets are made at sign-in and on the deposit screen.
    const wallet = await this.infra(this.arcWallet(uid));
    if (wallet?.own) throw new ConflictException(TRADE_COPY.ownWallet);
    const have = wallet ? await this.readBalance(wallet.address as Address, usdc) : 0n;
    if (have !== null) {
      const spendable = this.spendableUsdc(have);
      if (amountInRaw > spendable) {
        throw new BadRequestException(TRADE_ERRORS.insufficientUsdc(floorCents(spendable), ceilCents(amountInRaw)));
      }
    }
    if (!wallet) throw new BadRequestException(TRADE_ERRORS.insufficientUsdc(0, ceilCents(amountInRaw)));

    const claimed = await this.infra(
      this.claim(actionId, uid, trade, { usdValue: Number(amountInRaw) / 1e6, sourceUrl: canonicalSourceUrl(req.sourceUrl) }),
    );
    if (claimed.replay) return this.buyReplay(claimed.replay, mint, category);

    const done = await this.run(router, wallet, trade, actionId, startedAt);
    return {
      signature: done.txHash,
      dryRun: false,
      category,
      outAmountRaw: done.amountOutRaw.toString(),
      shareUrl: null,
    };
  }

  // ─── sell ─────────────────────────────────────────────────────────────────

  async sell(uid: string, req: SellRequest): Promise<SellResponse> {
    const startedAt = Date.now();
    const mint = parseAddress(req.mint);
    const amountInRaw = parseRaw(req.amountRaw);
    if (!mint || amountInRaw === null || amountInRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.badSell);
    if (mint === this.usdc) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    const usdc = this.usdc;
    const trade = { kind: 'sell' as const, tokenIn: mint, tokenOut: usdc, amountInRaw };

    const key = idempotencyKeyOf(req.idempotencyKey);
    const actionId = key ? stableUuid('trade', uid, key) : randomUUID();
    if (key) {
      const replay = await this.infra(this.replayable(actionId, uid, trade));
      if (replay) return sellReplay(replay);
    }

    // No gate on the way out. A token the gate turns down today may be one
    // the reader bought yesterday, and leaving must stay possible; if no
    // venue can carry it the router says so.
    const router = this.routerFor(mint, usdc);
    const wallet = await this.infra(this.arcWallet(uid));
    if (!wallet) throw new BadRequestException(TRADE_ERRORS.walletNotFound);
    if (wallet.own) throw new ConflictException(TRADE_COPY.ownWallet);

    let have = await this.readBalance(wallet.address as Address, mint);
    if (have !== null && have < amountInRaw && this.balanceRetryMs > 0) {
      await sleep(this.balanceRetryMs);
      have = (await this.readBalance(wallet.address as Address, mint)) ?? have;
    }
    if (have !== null && have < amountInRaw) {
      const decimals = await this.decimalsOf(mint).catch(() => 18);
      throw new BadRequestException(TRADE_ERRORS.insufficientSell(uiForSentence(have, decimals)));
    }

    const claimed = await this.infra(
      this.claim(actionId, uid, trade, { usdValue: null, sourceUrl: canonicalSourceUrl(req.sourceUrl) }),
    );
    if (claimed.replay) return sellReplay(claimed.replay);

    const done = await this.run(router, wallet, trade, actionId, startedAt);
    return { signature: done.txHash, dryRun: false, outUsdcRaw: done.amountOutRaw.toString(), shareUrl: null };
  }

  // ─── confirm ──────────────────────────────────────────────────────────────

  /**
   * What the chain says about one hash. 'unknown' means "not yet", never
   * "failed": the extension asks again. A receipt we see here also settles
   * the ledger row, so a /swap that answered before its receipt still ends
   * up confirmed in the book.
   *
   * For a hash that is one of our trades' swaps, success alone is not
   * enough: the fill must be in the receipt (see the header). The ledger row
   * names the token and the wallet to look for, so when it cannot be read
   * the answer is 'unknown' rather than a 'confirmed' that may be false. Only
   * a hash with no ledger row at all is answered from the receipt status.
   */
  async confirm(signature: unknown): Promise<ConfirmResponse> {
    const hash = parseHash(signature);
    if (!hash) throw new BadRequestException(TRADE_COPY.signatureRequired);
    let receipt: TransactionReceipt;
    try {
      receipt = await this.chain.receipt(hash as Hash, this.confirmWaitMs);
    } catch {
      return { status: 'unknown' };
    }
    const failed: ConfirmResponse = { status: 'failed', chainError: TRADE_COPY.reverted };

    let row: ActionRow | null;
    let owner: Address | null = null;
    try {
      row = await this.actions.byTxHash(hash);
      if (row && !isSwapOf(row, hash)) row = null;
      if (row) owner = lowerOrNull((await this.arcWallet(row.uid))?.address);
    } catch (e) {
      this.logger.warn(`confirm ${hash}: ledger unreadable: ${errorText(e)}`);
      return receipt.status === 'success' ? { status: 'unknown' } : failed;
    }
    if (!row) return receipt.status === 'success' ? { status: 'confirmed' } : failed;
    if (receipt.status === 'success' && (!owner || !row.tokenOut)) {
      this.logger.error(`confirm ${hash}: action ${row.id} has no wallet or token to check the fill against`);
      return { status: 'unknown' };
    }

    const filled = receipt.status === 'success' ? receivedIn(receipt.logs, lower(row.tokenOut!), owner!) : 0n;
    await this.settleLedger(row, hash, receipt, filled).catch((e) => this.logger.warn(`settle ${hash}: ${errorText(e)}`));
    return receipt.status === 'success' && filled > 0n ? { status: 'confirmed' } : failed;
  }

  // ─── balance ──────────────────────────────────────────────────────────────

  /**
   * One token's balance. Never an error for a chain read: an unreadable
   * balance is zeros with decimals null, which the extension already treats
   * as "nothing to sell". USDC reports what is spendable, the same figure the
   * book calls cash.
   */
  async balance(uid: string, mintInput: unknown): Promise<BalanceResponse> {
    const mint = typeof mintInput === 'string' && mintInput.trim() === SOLANA_USDC_MINT ? this.usdc : parseAddress(mintInput);
    if (!mint) throw new BadRequestException(TRADE_COPY.mintRequired);
    const zeros = (decimals: number | null): BalanceResponse => ({ uiAmount: 0, raw: '0', decimals });

    const wallet = await this.arcWallet(uid).catch(() => null);
    const decimals = await this.decimalsOf(mint).catch(() => null);
    if (!wallet) return zeros(decimals);
    let raw = await this.readBalance(wallet.address as Address, mint);
    if (raw === null || decimals === null) return zeros(null);
    if (mint === this.usdc) raw = this.spendableUsdc(raw);
    return { uiAmount: Number(formatUnits(raw, decimals)), raw: raw.toString(), decimals };
  }

  // ─── positions ────────────────────────────────────────────────────────────

  /**
   * The reader's book. No wallet yet is the new-reader path and answers an
   * empty book; a chain that cannot be read is a 503, because an empty book
   * would tell a funded reader to deposit.
   *
   * `cashUsd` is spendable USDC and nothing else. The extension sizes the
   * Max buy from it and prints it as "you have $X USDC", and /swap spends
   * only USDC; EURC counted there would offer a Max the buy then refuses. So
   * EURC is a position like any other token, priced in dollars.
   */
  async positions(uid: string): Promise<SpotPositionsResponse> {
    const wallet = await this.infra(this.arcWallet(uid));
    if (!wallet) return emptyBook(0);
    const owner = wallet.address.toLowerCase() as Address;
    const usdc = this.usdc;

    const rows = await this.infra(this.actions.listForUser(uid, 200));
    const basis = walkLedger(rows, usdc);
    const pinned = new Map(this.market.pinned().map((t) => [lower(t.address), t]));
    // EURC is always looked for, pinned or not: a reader can hold it without ever trading it here.
    // The ledger also names tokens on other chains (remote:base:0x...); the far port reads those.
    const ledgerKeys = [...basis.keys()];
    const tokens = unique([usdc, this.eurc, ...pinned.keys(), ...ledgerKeys.filter((k) => /^0x[0-9a-f]{40}$/.test(k))]);

    let balances: Map<string, bigint>;
    try {
      balances = await this.chain.balancesOf(owner, tokens);
    } catch (e) {
      this.logger.warn(`balances ${owner}: ${errorText(e)}`);
      throw new ServiceUnavailableException('Balances are unavailable right now');
    }
    const rawOf = (t: Address) => balances.get(t) ?? 0n;
    const heldAddrs = tokens.filter((t) => t !== usdc && rawOf(t) > 0n);

    const [prices, views, decimals] = await Promise.all([
      this.market.prices(heldAddrs).catch(() => new Map<Address, number>()),
      Promise.all(heldAddrs.map((t) => this.market.describe(t).catch(() => null))),
      Promise.all(heldAddrs.map((t) => this.decimalsOf(t).catch(() => null))),
    ]);
    const priceOf = (t: Address): number | null => {
      const p = prices.get(t);
      return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
    };

    const held: HeldToken[] = [];
    heldAddrs.forEach((address, i) => {
      const view = views[i];
      const pin = pinned.get(address);
      const circle = circleAssetByAddress(this.config.network, address);
      const dec = decimals[i] ?? view?.token.decimals ?? pin?.decimals ?? null;
      if (dec === null || !Number.isInteger(dec)) {
        this.logger.warn(`no decimals for held ${address}; row left out`);
        return;
      }
      held.push({
        address,
        raw: rawOf(address),
        decimals: dec,
        symbol: view?.token.symbol ?? pin?.symbol ?? circle?.symbol ?? null,
        name: view?.token.name ?? pin?.name ?? null,
        kind: view?.token.kind ?? pin?.kind ?? null,
        priceUsd: priceOf(address) ?? view?.priceUsd ?? null,
        change24hPct: view?.change24hPct ?? null,
      });
    });

    const remote = ledgerKeys.filter((k) => k.startsWith('remote:'));
    if (this.far && remote.length > 0) {
      held.push(...(await this.far.held(owner, remote).catch((e: unknown) => {
        this.logger.warn(`far holdings ${owner}: ${errorText(e)}`);
        return [];
      })));
    }

    const usdcUsd = Number(this.spendableUsdc(rawOf(usdc))) / 1e6;
    return buildBook(held, basis, usdcUsd, new Set([usdc]));
  }

  // ─── shared helpers ───────────────────────────────────────────────────────

  /**
   * ERC-20 decimals, from the chain and remembered forever. Circle's own
   * assets answer from the network table (checked on chain when it was
   * written); the market layer is asked only when the chain read fails.
   */
  async decimalsOf(token: Address): Promise<number> {
    const t = lower(token);
    const circle = circleAssetByAddress(this.config.network, t);
    if (circle) return circle.decimals;
    const cached = this.decimalsCache.get(t);
    if (cached !== undefined) return cached;
    let d: number | null = null;
    try {
      const v = await this.chain.client.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' });
      d = Number(v);
    } catch (e) {
      this.logger.warn(`decimals() ${t}: ${errorText(e)}`);
      d = (await this.market.describe(t).catch(() => null))?.token.decimals ?? null;
    }
    if (d === null || !Number.isInteger(d) || d < 0 || d > 36) throw new Error(`no decimals for ${t}`);
    this.decimalsCache.set(t, d);
    return d;
  }

  /** What the reader could spend on a buy, after the gas reserve when the wallet pays its own gas. */
  spendableUsdc(raw: bigint): bigint {
    const reserve = this.config.circle.accountType === 'EOA' ? GAS_RESERVE_USDC_RAW : 0n;
    return raw > reserve ? raw - reserve : 0n;
  }

  /** The extension's category label; nothing reads it, so a miss is 'token'. */
  async categoryOf(mint: Address): Promise<TradeCategory> {
    const circle = circleAssetByAddress(this.config.network, mint);
    if (circle) return 'spot';
    const pin = this.market.pinned().find((t) => lower(t.address) === mint);
    const kind: TokenKind | null =
      pin?.kind ?? (await this.market.describe(mint).catch(() => null))?.token.kind ?? null;
    switch (kind) {
      case 'cash':
      case 'circle':
        return 'spot';
      case 'stock':
        return 'equity';
      case 'long-tail':
        return 'memecoin';
      default:
        return 'token';
    }
  }

  private arcWallet(uid: string): Promise<StoredWallet | null> {
    return this.wallets.find(uid, this.config.network.walletsBlockchain);
  }

  /** One ERC-20 balance, or null when the chain cannot be read (callers fail open). */
  private async readBalance(owner: Address, token: Address): Promise<bigint | null> {
    try {
      const m = await this.chain.balancesOf(lower(owner), [token]);
      return m.get(token) ?? 0n;
    } catch (e) {
      this.logger.warn(`balanceOf ${token} for ${owner}: ${errorText(e)}`);
      return null;
    }
  }

  /**
   * An idempotency key seen before. The rules match the Solana backend the
   * extension was written against:
   * - completed (confirmed with a hash): replay the recorded answer;
   * - failed with no swap sent (swapSendState 'not-sent'): tried again under
   *   the same action id, so any approval already made is reused and every
   *   Circle key the router derives is the same as the first time;
   * - anything else (in progress, sent, maybe sent, failed on chain, or a
   *   different trade under the same key): 409.
   * Returns the row to replay, or null to go ahead.
   */
  private async replayable(
    actionId: string,
    uid: string,
    trade: { kind: ActionKind; tokenIn: Address; tokenOut: Address; amountInRaw: bigint },
  ): Promise<ActionRow | null> {
    const row = await this.actions.get(actionId);
    if (!row) return null;
    const verdict = replayVerdict(row, uid, trade);
    if (verdict === 'replay') return row;
    if (verdict === 'retry') return null;
    throw new ConflictException(TRADE_ERRORS.idempotencyConflict);
  }

  /** Write the ledger row, or take back a failed one; a concurrent twin gets its replay or a 409. */
  private async claim(
    actionId: string,
    uid: string,
    trade: { kind: ActionKind; tokenIn: Address; tokenOut: Address; amountInRaw: bigint },
    extra: { usdValue: number | null; sourceUrl: string | null },
  ): Promise<{ replay: ActionRow | null }> {
    const { created, row } = await this.actions.create({
      id: actionId,
      uid,
      kind: trade.kind,
      tokenIn: trade.tokenIn,
      tokenOut: trade.tokenOut,
      amountInRaw: trade.amountInRaw,
      usdValue: extra.usdValue,
      sourceUrl: extra.sourceUrl,
    });
    if (created) return { replay: null };
    const verdict = replayVerdict(row, uid, trade);
    if (verdict === 'replay') return { replay: row };
    if (verdict === 'retry') {
      await this.actions.update(actionId, { status: 'pending', error: null });
      return { replay: null };
    }
    throw new ConflictException(TRADE_ERRORS.idempotencyConflict);
  }

  /**
   * Execute through the router, record the legs, and wait for the receipt,
   * all within the trade budget.
   *
   * Routers record legs in two ways and both are honoured: the aggregator
   * writes them to the action row itself, and circle-swap hands them over
   * through hooks (a pending swap leg right before it sends, the outcome of a
   * swap that outlived its wait) and on the errors it throws.
   *
   * The router gets the budget minus the receipt wait. When that runs out the
   * answer is "taking longer than usual, check your balance" and the row stays
   * 'pending', so the same key is a 409 and never a second send. The router
   * is not stopped (a Circle transaction cannot be called back); its outcome
   * lands in the ledger through the same writes an answer in time would get.
   *
   * After a hash exists nothing here may turn the answer into an error except
   * the chain itself: a ledger write that fails after the trade landed is
   * logged, and the reader still gets their signature. The opposite (a 500
   * for a filled trade) is how a reader buys twice.
   */
  private async run(
    router: SwapRouter,
    wallet: StoredWallet,
    trade: TradeSpec,
    actionId: string,
    startedAt: number,
  ): Promise<{ txHash: Address; amountOutRaw: bigint }> {
    const owner = lower(wallet.address);
    const req: ExecuteRequest = {
      uid: wallet.uid,
      walletId: wallet.walletId,
      walletAddress: owner,
      tokenIn: trade.tokenIn,
      tokenOut: trade.tokenOut,
      amountInRaw: trade.amountInRaw,
      actionId,
    };
    const hooks: RouterHooks = {
      // Must land: if the "maybe sent" mark cannot be written, the send does
      // not happen (the router aborts when this throws).
      beforeSend: (legs) => this.actions.update(actionId, { legs }),
      // A late success goes through the same fill check as one in time; the
      // router's own "confirmed" is a receipt status, not a fill.
      onLate: (legs, late) =>
        late
          ? this.settleTrade({ ...late, legs }, trade, actionId, owner, this.lateReceiptWaitMs).then(
              (r) => this.logger.log(`late trade ${actionId} settled ${r.txHash}`),
              (e) => this.logger.warn(`late trade ${actionId} ended: ${errorText(e)}`),
            )
          : this.actions
              .update(actionId, { legs, status: statusFromLegs(legs, null) })
              .catch((e) => this.logger.error(`ledger late ${actionId}: ${errorText(e)}`)),
    };

    const left = startedAt + this.tradeBudgetMs - this.receiptWaitMs - Date.now();
    if (left < this.minExecuteMs) {
      // Nothing sent yet, so this is a clean refusal and the same key may try again.
      this.logger.warn(`trade ${actionId}: ${Date.now() - startedAt} ms spent before sending; refused unsent`);
      await this.actions
        .update(actionId, { status: 'failed', error: 'trade budget spent before sending' })
        .catch((e) => this.logger.error(`ledger budget ${actionId}: ${errorText(e)}`));
      throw new ServiceUnavailableException(TRADE_COPY.unavailable);
    }

    const sending = this.send(router, req, hooks, actionId);
    const first = await within(sending, left);
    if (first === TIMED_OUT) {
      void sending
        .then((executed) => this.settleTrade(executed, trade, actionId, owner, this.lateReceiptWaitMs))
        .then(
          (r) => this.logger.log(`late trade ${actionId} settled ${r.txHash}`),
          (e) => this.logger.warn(`late trade ${actionId} ended: ${errorText(e)}`),
        );
      this.logger.warn(`trade ${actionId} still sending after ${Date.now() - startedAt} ms; answered slow, left running`);
      throw new GatewayTimeoutException(TRADE_COPY.slow);
    }
    return this.settleTrade(first, trade, actionId, owner, this.receiptWaitMs);
  }

  /** The router's execute, with its failures recorded and a "sent, receipt pending" error turned into an answer. */
  private async send(router: SwapRouter, req: ExecuteRequest, hooks: RouterHooks, actionId: string): Promise<Executed> {
    try {
      return await (router as RouterWithHooks).execute(req, hooks);
    } catch (e) {
      const pending = sentButPending(e);
      if (!pending) throw await this.executeFailed(actionId, e);
      // Sent, with a hash, and no receipt yet: an answer, not a failure.
      return { venue: router.venue, txHash: pending.txHash, amountOutRaw: 0n, legs: pending.legs };
    }
  }

  /**
   * Record a sent swap and settle it from its receipt. Confirmed only when
   * the receipt succeeded AND the output token reached the wallet; the fill
   * reported is the one in the Transfer logs, never the router's figure.
   */
  private async settleTrade(
    executed: Executed,
    trade: TradeSpec,
    actionId: string,
    owner: Address,
    receiptWaitMs: number,
  ): Promise<{ txHash: Address; amountOutRaw: bigint }> {
    const txHash = lower(executed.txHash);
    let legs = withSwapLeg(executed.legs, txHash, this.config.network.walletsBlockchain);
    await this.actions
      .update(actionId, { status: 'sent', legs, amountOutRaw: executed.amountOutRaw > 0n ? executed.amountOutRaw : null })
      .catch((e) => this.logger.error(`ledger sent ${actionId} ${txHash}: ${errorText(e)}`));

    // The routers already waited for this receipt; when they have it, this
    // read is immediate. The wait is short because theirs was not.
    let receipt: TransactionReceipt;
    try {
      receipt = await this.chain.receipt(txHash as Hash, receiptWaitMs);
    } catch {
      // Not seen yet. The extension confirms on its own and re-asks.
      return { txHash, amountOutRaw: executed.amountOutRaw };
    }

    const gas = gasOf(receipt);
    const filled = receipt.status === 'success' ? receivedIn(receipt.logs, trade.tokenOut, owner) : 0n;
    if (filled === 0n) {
      const why = receipt.status === 'success' ? NOTHING_ARRIVED : TRADE_COPY.reverted;
      if (receipt.status === 'success') this.logger.warn(`trade ${actionId} ${txHash}: receipt succeeded, ${why}`);
      legs = markLeg(legs, txHash, { status: 'failed', error: why, gasUsdcRaw: gas });
      await this.actions
        .update(actionId, { status: 'failed', legs, error: why })
        .catch((e) => this.logger.error(`ledger fail ${actionId}: ${errorText(e)}`));
      throw new BadRequestException(
        trade.kind === 'buy' ? TRADE_ERRORS.chainFailed(TRADE_COPY.reverted) : TRADE_ERRORS.sellChainFailed(TRADE_COPY.reverted),
      );
    }

    legs = markLeg(legs, txHash, { status: 'confirmed', confirmedAt: new Date().toISOString(), gasUsdcRaw: gas });
    await this.actions
      .update(actionId, { status: 'confirmed', legs, amountOutRaw: filled })
      .catch((e) => this.logger.error(`ledger confirm ${actionId} ${txHash}: ${errorText(e)}`));
    return { txHash, amountOutRaw: filled };
  }

  /**
   * Record a router failure and choose what the reader hears. When the legs
   * say a swap may have left (Circle took the request and we lost sight of
   * it), the answer is "check before pressing again", never "did not go
   * through": the next press has a new key and would buy a second time.
   */
  private async executeFailed(actionId: string, e: unknown): Promise<HttpException> {
    const carried = legsOf(e);
    let legs = carried;
    if (!legs) legs = (await this.actions.get(actionId).catch(() => null))?.legs ?? null;
    const state = legs ? swapSendState(legs) : 'not-sent';
    await this.actions
      .update(actionId, {
        status: state === 'maybe-sent' ? 'pending' : 'failed',
        error: errorText(e).slice(0, 500),
        ...(carried ? { legs: carried } : {}),
      })
      .catch((x) => this.logger.error(`ledger fail-mark ${actionId}: ${errorText(x)}`));
    if (state === 'maybe-sent') return new GatewayTimeoutException(TRADE_COPY.slow);
    return executeRefusal(e);
  }

  /**
   * Bring a trade's ledger row in line with a receipt seen by /confirm, by
   * the rule settleTrade uses: a revert or an empty fill is failed, anything
   * else confirmed with the fill. The chain wins over whatever the row said.
   */
  private async settleLedger(row: ActionRow, hash: string, receipt: TransactionReceipt, filled: bigint): Promise<void> {
    const ok = receipt.status === 'success' && filled > 0n;
    if (row.status === (ok ? 'confirmed' : 'failed')) return;
    const gas = gasOf(receipt);
    if (!ok) {
      const why = receipt.status === 'success' ? NOTHING_ARRIVED : TRADE_COPY.reverted;
      await this.actions.update(row.id, {
        status: 'failed',
        legs: markLeg(row.legs, hash, { status: 'failed', error: why, gasUsdcRaw: gas }),
        error: why,
      });
      return;
    }
    await this.actions.update(row.id, {
      status: 'confirmed',
      legs: markLeg(row.legs, hash, { status: 'confirmed', confirmedAt: new Date().toISOString(), gasUsdcRaw: gas }),
      amountOutRaw: filled,
    });
  }

  private async buyReplay(row: ActionRow, mint: Address, category?: TradeCategory): Promise<BuyResponse> {
    return {
      signature: swapHash(row) ?? '',
      dryRun: false,
      category: category ?? (await this.categoryOf(mint)),
      outAmountRaw: row.amountOutRaw ?? '',
      shareUrl: null,
    };
  }

  /** Database and wallet lookups before any money moves: a failure there is a calm 503, not a 500. */
  private async infra<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`infra: ${errorText(e)}`);
      throw new ServiceUnavailableException(TRADE_COPY.unavailable);
    }
  }
}

// ─── pure helpers, exported for tests and the controller ────────────────────

/** A 0x address in the one casing this service speaks, or null. */
export function parseAddress(v: unknown): Address | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? lower(s) : null;
}

function parseHash(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(s) ? s.toLowerCase() : null;
}

/** A decimal-integer raw amount; hex, signs, decimals and exponents are refused. */
export function parseRaw(v: unknown): bigint | null {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : null;
  if (s === null || !/^[0-9]+$/.test(s) || s.length > 78) return null;
  return BigInt(s);
}

/**
 * Dollars to 6-decimal USDC, rounded DOWN, through the decimal string rather
 * than float multiplication (0.57 * 1e6 is 569999.9999999999 in floating
 * point, which would buy a micro-dollar less than asked).
 */
export function usdToRaw(v: unknown): bigint | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) return null;
  const [whole, frac = ''] = n.toFixed(8).split('.');
  return BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
}

function idempotencyKeyOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, 200) : null;
}

/**
 * The post a trade came from, in one canonical form, or null. Only a tweet or
 * a Reddit post counts; anything after the status id or the post id (a photo
 * suffix, tracking parameters) is dropped instead of voiding the attribution.
 */
export function canonicalSourceUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|mobile|m|old|new)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if ((host === 'x.com' || host === 'twitter.com') && parts.length >= 3 && parts[1] === 'status') {
    const [handle, , id] = parts;
    if (/^[A-Za-z0-9_]{1,15}$/.test(handle) && /^[0-9]{1,25}$/.test(id)) return `https://x.com/${handle}/status/${id}`;
    return null;
  }
  if (host === 'reddit.com' && parts.length >= 4 && parts[0] === 'r' && parts[2] === 'comments') {
    const [, sub, , id] = parts;
    if (/^[A-Za-z0-9_]{2,21}$/.test(sub) && /^[a-z0-9]{1,12}$/i.test(id)) {
      return `https://www.reddit.com/r/${sub}/comments/${id.toLowerCase()}/`;
    }
  }
  return null;
}

/**
 * The holding named in the "Insufficient balance" sentence. Up to six
 * decimals, trailing zeros trimmed; and never the digits "401", which the
 * chip's sell path reads as "signed out". Such a figure is rounded down until
 * it no longer contains them: the sentence still says the reader holds less
 * than they asked to sell, which is the point.
 */
export function uiForSentence(raw: bigint, decimals: number): number {
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

function floorCents(raw: bigint): number {
  return Number(raw / 10_000n) / 100;
}

function ceilCents(raw: bigint): number {
  return Number((raw + 9_999n) / 10_000n) / 100;
}

/** USDC-like amount of `token` that reached `to` in this receipt, from Transfer logs. */
export function receivedIn(
  logs: readonly { address: string; topics: readonly (string | null)[]; data: string }[],
  token: Address,
  to: Address,
): bigint {
  const toTopic = `0x${to.slice(2).toLowerCase().padStart(64, '0')}`;
  let sum = 0n;
  for (const l of logs) {
    if (l.address.toLowerCase() !== token) continue;
    if (l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (l.topics[2]?.toLowerCase() !== toTopic || l.topics[1]?.toLowerCase() === toTopic) continue;
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(l.data)) continue;
    sum += BigInt(l.data);
  }
  return sum;
}

type Verdict = 'replay' | 'retry' | 'conflict';

function replayVerdict(
  row: ActionRow,
  uid: string,
  trade: { kind: ActionKind; tokenIn: Address; tokenOut: Address; amountInRaw: bigint },
): Verdict {
  const same =
    row.uid === uid &&
    row.kind === trade.kind &&
    (row.tokenIn ?? '').toLowerCase() === trade.tokenIn &&
    (row.tokenOut ?? '').toLowerCase() === trade.tokenOut &&
    row.amountInRaw === trade.amountInRaw.toString();
  if (!same) return 'conflict';
  if (row.status === 'confirmed' && swapHash(row)) return 'replay';
  if (row.status === 'failed' && swapSendState(row.legs) === 'not-sent') return 'retry';
  return 'conflict';
}

/**
 * Whether a swap may already have left for an action, from its legs alone:
 * a hash means the chain has it; a swap leg without a hash that is not
 * `failed` means the send was started and its outcome is unknown. Only
 * 'not-sent' is safe to try again. (The same rule as circle-swap's, kept here
 * so the retry guard does not depend on one venue.)
 */
export function swapSendState(legs: readonly Leg[]): 'not-sent' | 'maybe-sent' | 'sent' {
  let state: 'not-sent' | 'maybe-sent' | 'sent' = 'not-sent';
  for (const leg of legs) {
    if (leg.kind !== 'swap') continue;
    if (leg.txHash) return 'sent';
    if (leg.status !== 'failed') state = 'maybe-sent';
  }
  return state;
}

/** Hooks circle-swap accepts on execute; other routers ignore the extra argument. */
export interface RouterHooks {
  beforeSend?: (legs: Leg[]) => void | Promise<void>;
  onLate?: (legs: Leg[], executed: Executed | null) => void | Promise<void>;
}

type RouterWithHooks = SwapRouter & { execute(req: ExecuteRequest, hooks?: RouterHooks): Promise<Executed> };

type TradeSpec = { kind: 'buy' | 'sell'; tokenIn: Address; tokenOut: Address; amountInRaw: bigint };

const TIMED_OUT = Symbol('timed out');

/** `p`, or TIMED_OUT after `ms`. `p` keeps running either way; the caller decides what its late end means. */
function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Whether `hash` is this buy or sell's swap (not its approval, and not another kind of action). */
function isSwapOf(row: ActionRow, hash: string): boolean {
  if (row.kind !== 'buy' && row.kind !== 'sell') return false;
  const h = hash.toLowerCase();
  return row.legs.some((l) => l.kind === 'swap' && l.txHash?.toLowerCase() === h);
}

function lowerOrNull(a: string | null | undefined): Address | null {
  return typeof a === 'string' && a ? lower(a) : null;
}

/** Legs a router attached to its error (circle-swap's SwapNotCompleted, the aggregator's pending error). */
function legsOf(e: unknown): Leg[] | null {
  const legs = (e as { legs?: unknown } | null)?.legs;
  return Array.isArray(legs) ? (legs as Leg[]) : null;
}

/** An error that says "sent, with this hash, receipt still pending" (the aggregator's SwapPendingError). */
function sentButPending(e: unknown): { txHash: Address; legs: Leg[] } | null {
  if (e instanceof HttpException) return null;
  const hash = (e as { txHash?: unknown } | null)?.txHash;
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  return { txHash: lower(hash), legs: legsOf(e) ?? [] };
}

/** The action status a late outcome implies: its swap leg's, or 'pending' while the send is still unknown. */
function statusFromLegs(legs: readonly Leg[], txHash: string | null): 'pending' | 'sent' | 'confirmed' | 'failed' {
  const swap = legs.find((l) => l.kind === 'swap' && (txHash === null || l.txHash?.toLowerCase() === txHash));
  if (swap?.status === 'confirmed') return 'confirmed';
  if (swap?.txHash && swap.status !== 'failed') return 'sent';
  if (swapSendState(legs) === 'maybe-sent') return 'pending';
  return 'failed';
}

function swapHash(row: ActionRow): string | null {
  const leg = row.legs.find((l) => l.kind === 'swap' && l.txHash) ?? null;
  return leg?.txHash?.toLowerCase() ?? null;
}

function sellReplay(row: ActionRow): SellResponse {
  return { signature: swapHash(row) ?? '', dryRun: false, outUsdcRaw: row.amountOutRaw ?? '', shareUrl: null };
}

function withSwapLeg(legs: Leg[] | undefined, txHash: Address, chain: string): Leg[] {
  const out = (legs ?? []).map((l) => (l.txHash ? { ...l, txHash: l.txHash.toLowerCase() } : { ...l }));
  if (!out.some((l) => l.kind === 'swap' && l.txHash === txHash)) {
    out.push({ kind: 'swap', status: 'sent', chain, txHash, sentAt: new Date().toISOString() });
  }
  return out;
}

function markLeg(legs: Leg[], txHash: string, patch: Partial<Leg>): Leg[] {
  const h = txHash.toLowerCase();
  return legs.map((l) => (l.txHash?.toLowerCase() === h ? { ...l, ...stripUndefined(patch) } : l));
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function gasOf(receipt: TransactionReceipt): string | undefined {
  try {
    return gasUsdcRaw(receipt).toString();
  } catch {
    return undefined;
  }
}

function venueLabel(v: Venue): string {
  return v === 'circle-swap' ? 'Circle' : 'KyberSwap';
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e) ?? String(e);
}

const SLIPPAGE_RE =
  /slippage|too little received|insufficient_output_amount|amountoutminimum|price impact|return amount is not enough|min(imum)? ?return/i;
const RATE_RE = /\b429\b|rate.?limit|too many requests/i;
const NO_ROUTE_RE = /no route|route not found|no liquidity|insufficient.?liquidity|no pool/i;
const TIMEOUT_RE = /timed? ?out|timeout|aborted/i;

/** A quote that could not be priced: keep router HttpExceptions, name the rest plainly. */
function quoteRefusal(e: unknown): HttpException {
  if (e instanceof HttpException) return e;
  const m = errorText(e);
  if (RATE_RE.test(m)) return new UnprocessableEntityException(TRADE_ERRORS.rateLimited);
  if (NO_ROUTE_RE.test(m)) return new UnprocessableEntityException(TRADE_ERRORS.noRoute);
  return new UnprocessableEntityException(TRADE_ERRORS.quoteUnavailable);
}

/**
 * A router that threw before returning a hash. Reverts and minimum-output
 * failures become one slippage sentence, never "insufficient", because the
 * extension reads /insufficient/ as "your balance is short" and would open
 * Add USDC for what was a price move.
 */
function executeRefusal(e: unknown): HttpException {
  if (e instanceof HttpException) return e;
  const m = errorText(e);
  if (SLIPPAGE_RE.test(m)) return new UnprocessableEntityException(TRADE_COPY.slippage);
  if (RATE_RE.test(m)) return new UnprocessableEntityException(TRADE_ERRORS.rateLimited);
  if (NO_ROUTE_RE.test(m)) return new UnprocessableEntityException(TRADE_ERRORS.noRoute);
  if (TIMEOUT_RE.test(m)) return new GatewayTimeoutException(TRADE_COPY.slow);
  return new UnprocessableEntityException(TRADE_COPY.notThrough);
}
