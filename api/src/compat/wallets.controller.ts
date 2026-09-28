import {
  Controller,
  Get,
  HttpException,
  Inject,
  Logger,
  Optional,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { erc20Abi, formatUnits } from 'viem';
import { APP_CONFIG, AppConfig } from '../config';
import { AuthedUser, CurrentUser, FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { ArcChain } from '../arc/chain';
import { circleAssetByAddress, circleAssets } from '../arc/network';
import { CircleWallets, StoredWallet } from '../circle/wallets';
import { MARKET, type AssetView, type MarketPort } from '../market/market.types';
import { ActionsStore, type ActionRow } from '../trade/actions';
import { lower, type Address, type Leg } from '../trade/types';
import { UsersService } from '../users/users.service';
import { ensureUser, within } from './users.controller';

/**
 * THE EXTENSION'S WALLET ROUTES, answered from the user's Circle wallet on Arc.
 *
 * Shapes are the Solana backend's (WalletService.ts in the extension), filled
 * with Arc facts: `public_key` is the 0x address, `mint` is an ERC-20 address,
 * `signature` is an onchain hash. Every address leaves here lowercase,
 * because the extension compares mints with === and Set.has.
 */

/** Where the other networks' deposit addresses come from. Implemented in circle/. */
export interface DepositNetworkAddress {
  network: string;
  address: string;
}
export interface DepositAddresses {
  arc: { network: 'Arc'; address: string };
  others: DepositNetworkAddress[];
}
export interface DepositsPort {
  depositAddresses(uid: string): Promise<DepositAddresses>;
}
/**
 * A string token rather than a Symbol so the provider can be bound from a
 * module that never imports this file; two Symbols with one name are two
 * tokens, two equal strings are one.
 */
export const DEPOSITS = 'DEPOSITS';

/**
 * How long one balance read answers repeat asks. Long enough to merge the
 * panel's screens asking at the same moment, short enough that the refetch
 * after a trade (the client invalidates the list as the trade lands) reads
 * the chain again instead of getting the balances from before it.
 */
const TOKENS_TTL_MS = 1_500;
/** A slow price source must not hold the wallet screen's token list. */
const DESCRIBE_WAIT_MS = 2_500;
/** Traded tokens checked per balance read, most recently traded first. */
const LEDGER_TOKENS_MAX = 100;
/** Arrivals per /external-transfers answer. The client speaks three per poll at most. */
const TRANSFERS_MAX = 20;
/** The client's own limit on the `until` it sends back. */
const CURSOR_MAX = 250;

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Names read on chain from each contract's name(), 2026-09-28. The market's name wins when it has one. */
const CIRCLE_NAMES: Record<string, string> = { USDC: 'USDC', EURC: 'EURC', cirBTC: 'Circle Wrapped Bitcoin' };

export interface TokenRow {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: number;
  slot: number;
  isFrozen: boolean;
  name: string;
  symbol: string;
  logoURI: string | null;
  price: number | null;
  usdValue: number | null;
  isVerified: boolean;
  tags: string[];
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  holderCount: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  twitter: string | null;
  discord: string | null;
  website: string | null;
  organicScore: number | null;
  organicScoreLabel: string | null;
}

export interface TokensResponse {
  publicKey: string;
  tokens: TokenRow[];
}

export interface WalletTransaction {
  id: string;
  transaction_type: 'send_token' | 'receive_token' | 'swap';
  signature: string;
  from_address: string | null;
  to_address: string | null;
  amount: string;
  token_mint: string;
  nft_mint: null;
  status: 'pending' | 'confirmed' | 'failed';
  error_message: string | null;
  metadata: {
    chain: 'arc';
    inputMint?: string;
    outputMint?: string;
    inputAmount?: string;
    outputAmount?: string;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Legs on Arc. Trade legs carry the Wallets code ('ARC', 'ARC-TESTNET') and
 * App Kit legs its chain name ('Arc', 'Arc_Testnet'); no other network we
 * touch starts with those three letters.
 */
const ON_ARC = /^arc/i;

/**
 * The hash a row links to, always one on Arc, because Arc's explorer is
 * where the extension opens it. For a trade it is the swap; for money
 * arriving from another network it is the mint. Anything else falls back to
 * the latest Arc step with a hash. A deposit whose only hash so far is the
 * burn on Base or Ethereum has none yet: that hash does not exist on Arc's
 * explorer, so the row waits unlinked until the mint lands.
 */
export function primaryHash(legs: Leg[]): string | null {
  const arc = legs.filter((l) => l.txHash && ON_ARC.test(l.chain ?? ''));
  for (const kind of ['swap', 'mint', 'transfer'] as const) {
    const leg = arc.find((l) => l.kind === kind);
    if (leg?.txHash) return leg.txHash.toLowerCase();
  }
  const last = arc[arc.length - 1];
  return last?.txHash ? last.txHash.toLowerCase() : null;
}

/**
 * What a failed row says. Always one of these sentences: the stored error is
 * our own diagnosis (a router's or Circle's words, a deposit's internal
 * reason) and never reader copy.
 */
export const FAILED_SENTENCES = {
  swap: 'This trade did not go through.',
  deposit: 'This deposit did not go through.',
} as const;

function uiString(raw: string | null, decimals: number | null): string {
  if (raw === null || decimals === null || !/^\d+$/.test(raw)) return '0';
  return formatUnits(BigInt(raw), decimals);
}

/**
 * One ledger row as one activity row, or null when it never reached the
 * chain. A buy, sell or convert is a `swap` whose metadata carries both legs
 * in RAW units: the extension spots the USDC leg by address and divides it by
 * 10^6 itself ("Bought X $10.00"). Money arriving from another network is a
 * `receive_token` in UI units.
 */
export function toWalletTransaction(
  row: ActionRow,
  address: string | null,
  usdc: string,
  decimalsOf: (mint: string) => number | null,
): WalletTransaction | null {
  const hash = primaryHash(row.legs);
  // Failed before anything was sent: nothing moved, so there is nothing to list.
  if (row.status === 'failed' && !hash) return null;
  const status = row.status === 'confirmed' ? 'confirmed' : row.status === 'failed' ? 'failed' : 'pending';
  const tokenIn = row.tokenIn ? row.tokenIn.toLowerCase() : null;
  const tokenOut = row.tokenOut ? row.tokenOut.toLowerCase() : null;
  const base = {
    id: row.id,
    signature: hash ?? '',
    nft_mint: null,
    status,
    error_message: status === 'failed' ? FAILED_SENTENCES[row.kind === 'deposit' ? 'deposit' : 'swap'] : null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  } as const;

  if (row.kind === 'deposit') {
    const mint = tokenOut ?? usdc;
    const raw = row.amountOutRaw ?? row.amountInRaw;
    return {
      ...base,
      transaction_type: 'receive_token',
      from_address: null,
      to_address: address,
      amount: uiString(raw, decimalsOf(mint)),
      token_mint: mint,
      metadata: { chain: 'arc' },
    };
  }

  // buy, sell, convert. The row's own `amount` column was always the raw
  // input for swaps; the extension reads the metadata instead.
  return {
    ...base,
    transaction_type: 'swap',
    from_address: null,
    to_address: null,
    amount: row.amountInRaw ?? '0',
    token_mint: (row.kind === 'sell' ? tokenIn : tokenOut) ?? tokenOut ?? tokenIn ?? usdc,
    metadata: {
      chain: 'arc',
      ...(tokenIn ? { inputMint: tokenIn } : {}),
      ...(tokenOut ? { outputMint: tokenOut } : {}),
      ...(row.amountInRaw !== null ? { inputAmount: row.amountInRaw } : {}),
      ...(row.amountOutRaw !== null ? { outputAmount: row.amountOutRaw } : {}),
    },
  };
}

export interface ExternalTransferRow {
  signature: string;
  direction: 'in' | 'out';
  mint: string;
  amountUi: number;
  at: string | null;
}

export interface ExternalTransfersResponse {
  /** False means "could not look": the client keeps its cursor and asks again next tick. */
  ok: boolean;
  cursor: string | null;
  /** Oldest first. */
  transfers: ExternalTransferRow[];
}

/** A cursor is the newest arrival seen: when it was confirmed, then its id to break ties. */
function cursorOf(row: Pick<ActionRow, 'updatedAt' | 'id'>): string {
  return `${row.updatedAt}|${row.id}`;
}

/** The cursor the client sent back, or null when it is not one of ours. */
export function parseTransferCursor(v: unknown): { at: string; id: string } | null {
  if (typeof v !== 'string' || !v || v.length > CURSOR_MAX) return null;
  const bar = v.indexOf('|');
  if (bar < 1) return null;
  const at = v.slice(0, bar);
  const id = v.slice(bar + 1);
  if (!id || Number.isNaN(Date.parse(at)) || new Date(at).toISOString() !== at) return null;
  return { at, id };
}

function after(row: Pick<ActionRow, 'updatedAt' | 'id'>, c: { at: string; id: string }): boolean {
  return row.updatedAt > c.at || (row.updatedAt === c.at && row.id > c.id);
}

/**
 * "Received 25 USDC", from our own ledger: the money that arrived on Arc
 * from another network, one row per confirmed deposit, keyed by its mint
 * hash on Arc (the client never says one hash twice). Trades are ours and
 * never appear here.
 *
 * The client stores the cursor per account. With no cursor it records where
 * history ends and says nothing; from then on it says what came after. So
 * the cursor always moves to the newest arrival we know of, and a cursor we
 * cannot read (another build's, or a truncated one) is answered like no
 * cursor at all: everything we know, which the client's own memory of what
 * it already said keeps from being said twice.
 */
export function externalTransfers(rows: ActionRow[], until: unknown, usdc: string): ExternalTransfersResponse {
  const arrived = rows
    .filter((r) => r.kind === 'deposit' && r.status === 'confirmed')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1));
  const since = parseTransferCursor(until);
  const fresh = since ? arrived.filter((r) => after(r, since)) : arrived;
  const newest = arrived[arrived.length - 1];
  const cursor = newest && (!since || after(newest, since)) ? cursorOf(newest) : since ? (until as string) : null;

  const transfers: ExternalTransferRow[] = [];
  for (const r of fresh.slice(-TRANSFERS_MAX)) {
    const raw = r.amountOutRaw ?? r.amountInRaw;
    if (raw === null || !/^\d+$/.test(raw)) continue;
    const mint = r.legs.find((l) => l.kind === 'mint' && l.txHash && ON_ARC.test(l.chain ?? ''));
    transfers.push({
      // The mint's hash; the row id only if a confirmed row somehow lacks
      // one. Neither holds a ':', which the client's toast id splits on.
      signature: primaryHash(r.legs) ?? r.id,
      direction: 'in',
      mint: r.tokenOut ? lower(r.tokenOut) : usdc,
      // USDC on both ends of the move, 6 decimals on every network it crosses.
      amountUi: Number(formatUnits(BigInt(raw), 6)),
      at: mint?.confirmedAt ?? r.updatedAt,
    });
  }
  return { ok: true, cursor, transfers };
}

function intParam(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
}

@Controller('wallets')
@UseGuards(FirebaseAuthGuard)
export class WalletsController {
  private readonly logger = new Logger('compat/wallets');
  private readonly tokensCache = new Map<string, { at: number; value: Promise<TokensResponse> }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly wallets: CircleWallets,
    private readonly chain: ArcChain,
    private readonly actions: ActionsStore,
    @Optional() @Inject(MARKET) private readonly market: MarketPort | null = null,
  ) {}

  /**
   * The wallet, created here when it does not exist yet, so `exists` is true
   * for everyone Circle could serve. When Circle cannot (not configured, or
   * down), the answer is `exists: false`, which the panel shows as a set-up
   * button that calls /wallets/provision: a way forward, not a dead screen.
   */
  @Get('me')
  async me(@CurrentUser() user: AuthedUser) {
    await ensureUser(this.users, user);
    try {
      const w = await this.wallets.ensureArcWallet(user.uid);
      return { exists: true, wallet: walletView(w), depositAddress: lower(w.address) };
    } catch (e) {
      this.logger.warn(`arc wallet for ${user.uid} not ready: ${(e as Error)?.message ?? e}`);
      return { exists: false, message: 'Your wallet is being set up. Try again in a moment.' };
    }
  }

  /** The set-up button. Idempotent: the same wallet every time. */
  @Post('provision')
  async provision(@CurrentUser() user: AuthedUser) {
    await ensureUser(this.users, user);
    try {
      const w = await this.wallets.ensureArcWallet(user.uid);
      return { success: true, evm: walletView(w) };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`provision for ${user.uid} failed: ${(e as Error)?.message ?? e}`);
      throw new ServiceUnavailableException('Your wallet is being set up. Try again in a moment.');
    }
  }

  /**
   * No native balance on Arc: USDC is the gas token, and its one honest
   * figure is the ERC-20 row in /wallets/tokens. `balance: null` hides the
   * panel's SOL row everywhere with no client change, and answers without an
   * RPC call, which matters because this route gates the wallet skeleton.
   */
  @Get('balance')
  async balance(@CurrentUser() user: AuthedUser) {
    const w = await this.stored(user.uid);
    return { publicKey: w ? lower(w.address) : '', balance: null };
  }

  @Get('tokens')
  tokens(@CurrentUser() user: AuthedUser): Promise<TokensResponse> {
    const now = Date.now();
    const hit = this.tokensCache.get(user.uid);
    if (hit && now - hit.at < TOKENS_TTL_MS) return hit.value;
    if (this.tokensCache.size > 1000) {
      for (const [k, v] of this.tokensCache) if (now - v.at >= TOKENS_TTL_MS) this.tokensCache.delete(k);
    }
    const value = this.readTokens(user.uid);
    this.tokensCache.set(user.uid, { at: now, value });
    // A failed read is not remembered; the next ask tries again.
    value.catch(() => {
      if (this.tokensCache.get(user.uid)?.value === value) this.tokensCache.delete(user.uid);
    });
    return value;
  }

  /** Activity, from our own ledger of what we moved. `limit`/`offset` as the panel sends them. */
  @Get('transactions')
  async transactions(
    @CurrentUser() user: AuthedUser,
    @Query('limit') limitQ?: string,
    @Query('offset') offsetQ?: string,
  ) {
    const limit = intParam(limitQ, 15, 1, 100);
    const offset = intParam(offsetQ, 0, 0, 1000);
    const [w, rows] = await Promise.all([
      this.stored(user.uid),
      // The store answers at most 200 rows, and paging happens after rows
      // that never reached the chain are dropped, so pages stay contiguous.
      this.actions.listForUser(user.uid, 200),
    ]);
    const net = this.config.network;
    const usdc = lower(net.usdc.address);
    const decimalsOf = (mint: string) => circleAssetByAddress(net, mint)?.decimals ?? null;
    const address = w ? lower(w.address) : null;
    const transactions = rows
      .map((r) => toWalletTransaction(r, address, usdc, decimalsOf))
      .filter((t): t is WalletTransaction => t !== null)
      .slice(offset, offset + limit);
    return { transactions, limit, offset };
  }

  /**
   * The background's deposit watch, every two minutes per signed-in reader.
   * Any failure answers `ok: false` with 200, which the client reads as
   * "could not look" and keeps its cursor for the next tick.
   */
  @Get('external-transfers')
  async externalTransfers(
    @CurrentUser() user: AuthedUser,
    @Query('until') until?: string,
  ): Promise<ExternalTransfersResponse> {
    try {
      const rows = await this.actions.listForUser(user.uid, 200);
      return externalTransfers(rows, until, lower(this.config.network.usdc.address));
    } catch (e) {
      this.logger.warn(`external transfers for ${user.uid} failed: ${(e as Error)?.message ?? e}`);
      return { ok: false, cursor: null, transfers: [] };
    }
  }

  private stored(uid: string): Promise<StoredWallet | null> {
    return this.wallets.find(uid, this.config.network.walletsBlockchain);
  }

  /**
   * Balances of USDC, EURC, cirBTC and every token the ledger says this user
   * traded, in one multicall. Exactly one USDC row, the 6-decimal ERC-20, and
   * always present with usdValue equal to its amount: Receive computes
   * "Balance now" and "$X landed" from that number, and a missing row or a
   * null value means a deposit is never noticed. Other rows appear only while
   * they hold something.
   *
   * A balance that could not be read is never reported as zero. If USDC's
   * read fails the whole answer is a 503, which the client's cache answers
   * with the last good list; a zero there would show an empty wallet, and
   * Receive would take it as the starting balance and later announce money
   * that was already there as newly landed. Any other token whose read
   * failed is left out of this answer.
   */
  private async readTokens(uid: string): Promise<TokensResponse> {
    const w = await this.stored(uid);
    if (!w) return { publicKey: '', tokens: [] };
    const owner = lower(w.address);
    const net = this.config.network;
    const usdc = lower(net.usdc.address);

    const candidates = new Set<Address>(circleAssets(net).map((t) => lower(t.address)));
    for (const t of await this.tradedTokens(uid)) candidates.add(t);
    const list = [...candidates];
    const balances = await this.balancesOf(owner, list);
    if (!balances.has(usdc)) {
      throw new ServiceUnavailableException('Your balance is loading. Try again in a moment.');
    }
    const held = list.filter((a) => balances.has(a) && (a === usdc || balances.get(a)! > 0n));

    const views = new Map<Address, AssetView | null>(
      await Promise.all(held.map(async (a) => [a, await this.describe(a)] as [Address, AssetView | null])),
    );
    const unknown = held.filter((a) => !circleAssetByAddress(net, a) && !views.get(a));
    const onchain = await this.readMetadata(unknown);
    const pinned = new Set((this.market?.pinned() ?? []).map((t) => lower(t.address)));

    const tokens: TokenRow[] = [];
    for (const a of held) {
      const raw = balances.get(a) ?? 0n;
      const circle = circleAssetByAddress(net, a);
      const view = views.get(a) ?? null;
      const meta = onchain.get(a);
      const decimals = circle?.decimals ?? view?.token.decimals ?? meta?.decimals ?? null;
      // A balance without its decimals cannot be stated honestly; skip it.
      if (decimals === null) continue;
      const uiAmount = Number(formatUnits(raw, decimals));
      const price = a === usdc ? 1 : (view?.priceUsd ?? null);
      tokens.push({
        mint: a,
        amount: raw.toString(),
        decimals,
        uiAmount,
        slot: 0,
        isFrozen: false,
        name: view?.token.name || (circle ? CIRCLE_NAMES[circle.symbol] : meta?.name) || 'Unknown',
        symbol: circle?.symbol ?? (view?.token.symbol || meta?.symbol || '???'),
        logoURI: view?.token.icon ?? null,
        price,
        usdValue: a === usdc ? uiAmount : price === null ? null : uiAmount * price,
        isVerified: Boolean(circle) || pinned.has(a),
        tags: [],
        marketCap: view?.mcapUsd ?? null,
        fdv: null,
        liquidity: view?.liquidityUsd ?? null,
        holderCount: view?.holderCount ?? null,
        priceChange24h: view?.change24hPct ?? null,
        volume24h: null,
        twitter: null,
        discord: null,
        website: null,
        organicScore: null,
        organicScoreLabel: null,
      });
    }
    tokens.sort((x, y) => (x.mint === usdc ? -1 : y.mint === usdc ? 1 : (y.usdValue ?? 0) - (x.usdValue ?? 0)));
    return { publicKey: owner, tokens };
  }

  /**
   * The tokens this user bought, sold or converted, most recent first.
   * Deposits are skipped: their input is USDC on another network, an address
   * that means nothing on Arc, and their output is Arc's USDC, already read.
   *
   * The whole ledger when the store can answer that (tokensForUser, one
   * DISTINCT query), so a coin bought long ago and still held stays in the
   * wallet; the latest 200 actions until it can.
   */
  private async tradedTokens(uid: string): Promise<Address[]> {
    const store = this.actions as ActionsStore & {
      tokensForUser?: (uid: string, limit?: number) => Promise<string[]>;
    };
    let seen: Array<string | null>;
    if (typeof store.tokensForUser === 'function') {
      seen = await store.tokensForUser(uid, LEDGER_TOKENS_MAX);
    } else {
      const rows = await this.actions.listForUser(uid, 200);
      seen = rows.filter((r) => r.kind !== 'deposit').flatMap((r) => [r.tokenOut, r.tokenIn]);
    }
    const out = new Set<Address>();
    for (const t of seen) {
      if (out.size >= LEDGER_TOKENS_MAX) break;
      if (t && HEX_ADDRESS.test(t)) out.add(lower(t));
    }
    return [...out];
  }

  /**
   * balanceOf for each token in one multicall, keeping only the reads that
   * succeeded. ArcChain.balancesOf reads a failure as 0n, and when the RPC
   * refuses the whole batch (an outage, a rate limit) viem marks every call
   * failed rather than throwing, so its map would say "empty wallet".
   */
  private async balancesOf(owner: Address, tokens: Address[]): Promise<Map<Address, bigint>> {
    const results = await this.chain.client.multicall({
      contracts: tokens.map((address) => ({
        address,
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [owner] as const,
      })),
      allowFailure: true,
    });
    const out = new Map<Address, bigint>();
    results.forEach((r, i) => {
      if (r.status === 'success' && typeof r.result === 'bigint') out.set(tokens[i], r.result);
    });
    return out;
  }

  private async describe(a: Address): Promise<AssetView | null> {
    if (!this.market) return null;
    try {
      return await within(this.market.describe(a), DESCRIBE_WAIT_MS);
    } catch {
      return null;
    }
  }

  /** decimals, symbol and name straight from the contracts the market could not describe. */
  private async readMetadata(
    tokens: Address[],
  ): Promise<Map<Address, { decimals: number | null; symbol: string | null; name: string | null }>> {
    const out = new Map<Address, { decimals: number | null; symbol: string | null; name: string | null }>();
    if (!tokens.length) return out;
    try {
      const fns = ['decimals', 'symbol', 'name'] as const;
      const results = await this.chain.client.multicall({
        contracts: tokens.flatMap((address) => fns.map((functionName) => ({ address, abi: erc20Abi, functionName }))),
        allowFailure: true,
      });
      tokens.forEach((a, i) => {
        const [d, s, n] = results.slice(i * 3, i * 3 + 3);
        out.set(a, {
          decimals: d?.status === 'success' ? Number(d.result) : null,
          symbol: s?.status === 'success' ? String(s.result) : null,
          name: n?.status === 'success' ? String(n.result) : null,
        });
      });
    } catch (e) {
      this.logger.warn(`token metadata read failed: ${(e as Error)?.message ?? e}`);
    }
    return out;
  }
}

function walletView(w: StoredWallet) {
  return {
    id: w.walletId,
    user_id: w.uid,
    public_key: lower(w.address),
    wallet_type: 'circle',
    is_active: true,
  };
}

/**
 * Where a person can send USDC from, per network. Arc first, always; the
 * other networks' addresses come from the deposits service when it is wired,
 * and until then the list is Arc alone.
 */
@Controller('arc')
@UseGuards(FirebaseAuthGuard)
export class ArcDepositsController {
  private readonly logger = new Logger('compat/deposits');

  constructor(
    private readonly users: UsersService,
    private readonly wallets: CircleWallets,
    @Optional() @Inject(DEPOSITS) private readonly deposits: DepositsPort | null = null,
  ) {}

  @Get('deposit-addresses')
  async depositAddresses(@CurrentUser() user: AuthedUser): Promise<DepositAddresses> {
    await ensureUser(this.users, user);
    try {
      if (this.deposits) {
        const d = await this.deposits.depositAddresses(user.uid);
        return {
          arc: { network: 'Arc', address: evmLower(d.arc.address) },
          others: d.others.map((o) => ({ network: o.network, address: evmLower(o.address) })),
        };
      }
      const w = await this.wallets.ensureArcWallet(user.uid);
      return { arc: { network: 'Arc', address: lower(w.address) }, others: [] };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`deposit addresses for ${user.uid} failed: ${(e as Error)?.message ?? e}`);
      throw new ServiceUnavailableException('Deposit addresses are being set up. Try again in a moment.');
    }
  }
}

/** EVM addresses lowercase; anything else (a Solana address) is case-exact and left alone. */
function evmLower(a: string): string {
  return HEX_ADDRESS.test(a) ? a.toLowerCase() : a;
}
