import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { encodeFunctionData, erc20Abi, formatUnits, type Hash } from 'viem';
import { ArcChain, gasUsdcRaw } from '../arc/chain';
import { circleAssetByAddress } from '../arc/network';
import { CircleWallets } from '../circle/wallets';
import { APP_CONFIG, AppConfig } from '../config';
import { MARKET, type MarketPort } from '../market/market.types';
import { KyberRouter, receivedFromLogs } from '../routers/kyber.router';
import { ActionsStore } from './actions';
import { canonicalSourceUrl, GAS_RESERVE_USDC_RAW, parseAddress, parseRaw, usdToRaw } from './trade.service';
import { lower, TRADE_ERRORS, type Address, type Leg } from './types';

/**
 * A BUY OR SELL SIGNED BY THE PERSON'S OWN WALLET.
 *
 * An account that signed in with a wallet trades from that wallet when this
 * deploy runs ARC_WALLET_ACCOUNTS=own (circle/wallets.ts, ownWalletOf). This
 * service never holds a key for it, so a trade is three steps:
 *
 * 1. prepare: the extension asks for a trade. We price and build it with
 *    KyberSwap for the wallet's own address (the same calldata checks as a
 *    custodial trade), add an approval of exactly this amount when the wallet
 *    has not allowed it yet, write the action row, and answer with the
 *    address of the confirm page.
 * 2. The confirm page (trade/confirm-page.ts), opened by the extension, has
 *    the wallet send those transactions. It is a web page because wallets
 *    only speak to web pages, and it is ours so the wallet shows our host.
 * 3. submit: the page hands back the hashes. We read the swap from the chain
 *    and record it only when it is exactly the transaction we built: from
 *    this wallet, to the router, with our calldata, and successful. What the
 *    wallet received is read from the Transfer logs, never taken from the page.
 *
 * The extension polls status() until the trade is done, failed or cancelled.
 * Pending trades live in memory for fifteen minutes; the action row is the
 * durable record, and status() falls back to it after a restart.
 */

export interface WalletTx {
  kind: 'approve' | 'swap';
  to: Address;
  data: `0x${string}`;
  value: '0x0';
}

export type OwnTradeState = 'waiting' | 'sending' | 'done' | 'failed' | 'cancelled' | 'expired';

export interface OwnTradeStatus {
  state: OwnTradeState;
  signature?: string;
  outAmountRaw?: string;
  error?: string;
}

export interface PreparedOwnTrade {
  preparedId: string;
  confirmUrl: string;
  summary: { title: string; detail: string };
}

export interface ConfirmPageData {
  address: Address;
  chain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    blockExplorerUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  txs: WalletTx[];
  summary: { title: string; detail: string };
  state: OwnTradeState;
}

interface Pending {
  id: string;
  uid: string;
  address: Address;
  side: 'buy' | 'sell';
  tokenIn: Address;
  tokenOut: Address;
  amountInRaw: bigint;
  router: Address;
  callData: `0x${string}`;
  txs: WalletTx[];
  token: string;
  expiresAt: number;
  state: OwnTradeState;
  summary: { title: string; detail: string };
  result?: { signature: string; outAmountRaw: string };
  error?: string;
}

/** Sentences the extension and the confirm page print as they are. */
export const OWN_WALLET_COPY = {
  notOwn: 'This account trades from its Poppin wallet.',
  gone: 'This trade has expired. Start it again from Poppin.',
  badLink: 'This link is not valid. Start the trade again from Poppin.',
  notYours: 'That trade belongs to another account.',
  badHash: 'The wallet did not return a transaction.',
  notOurs: 'That transaction is not the trade Poppin prepared.',
  reverted: 'That trade did not go through. Only the network fee was spent.',
  slow: 'The trade was sent and is still settling. Check your wallet in a moment.',
  gas: 'Your wallet needs a few cents of USDC on Arc for the network fee.',
} as const;

/** Circle's own assets, by the names the panel shows. */
const CIRCLE_NAMES: Record<string, string> = { USDC: 'US Dollar', EURC: 'Euro', cirBTC: 'Bitcoin' };

const TTL_MS = 15 * 60 * 1000;
/** The swap itself costs about a cent on Arc; a sell still needs this much USDC for it. */
const SELL_GAS_USDC_RAW = 20_000n;

@Injectable()
export class OwnWalletTrades {
  private readonly logger = new Logger('trade/own-wallet');
  private readonly pending = new Map<string, Pending>();
  /** How long submit waits for the swap's receipt before answering "still settling". */
  receiptWaitMs = 45_000;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly kyber: KyberRouter,
    private readonly chain: ArcChain,
    private readonly actions: ActionsStore,
    private readonly wallets: CircleWallets,
    @Optional() @Inject(MARKET) private readonly market: MarketPort | null = null,
  ) {}

  private get usdc(): Address {
    return lower(this.config.network.usdc.address);
  }

  async prepare(uid: string, body: unknown, base: string): Promise<PreparedOwnTrade> {
    this.sweep();
    const own = await this.wallets.ownWallet(uid);
    if (!own) throw new ConflictException(OWN_WALLET_COPY.notOwn);
    const address = lower(own.address);
    const b = (body ?? {}) as { side?: unknown; mint?: unknown; amountUsd?: unknown; amountRaw?: unknown; sourceUrl?: unknown };
    const side = b.side === 'sell' ? 'sell' : b.side === 'buy' ? 'buy' : null;
    const mint = parseAddress(b.mint);
    if (!side || !mint) throw new BadRequestException(TRADE_ERRORS.badBuy);
    if (mint === this.usdc) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    const amountInRaw = side === 'buy' ? usdToRaw(b.amountUsd) : parseRaw(b.amountRaw);
    if (amountInRaw === null || amountInRaw <= 0n) {
      throw new BadRequestException(side === 'buy' ? TRADE_ERRORS.badBuy : TRADE_ERRORS.badSell);
    }
    const tokenIn = side === 'buy' ? this.usdc : mint;
    const tokenOut = side === 'buy' ? mint : this.usdc;

    // The same gate as a custodial buy; a sell is never gated, so leaving stays possible.
    if (side === 'buy' && this.market) {
      const verdict = await this.market.gate(mint).catch(() => {
        throw new UnprocessableEntityException(TRADE_ERRORS.quoteUnavailable);
      });
      if (!verdict.ok) throw new UnprocessableEntityException(TRADE_ERRORS.notAllowed(verdict.reason));
    }

    const held = await this.chain.balancesOf(address, [this.usdc, mint]);
    const usdcHeld = held.get(this.usdc) ?? 0n;
    if (side === 'buy') {
      // Arc takes gas from the same USDC, so a little stays behind for it.
      const spendable = usdcHeld > GAS_RESERVE_USDC_RAW ? usdcHeld - GAS_RESERVE_USDC_RAW : 0n;
      if (amountInRaw > spendable) {
        throw new BadRequestException(TRADE_ERRORS.insufficientUsdc(floorCents(spendable), ceilCents(amountInRaw)));
      }
    } else {
      const have = held.get(mint) ?? 0n;
      if (have < amountInRaw) {
        const decimals = await this.decimalsOf(mint);
        throw new BadRequestException(TRADE_ERRORS.insufficientSell(Number(formatUnits(have, decimals))));
      }
      if (usdcHeld < SELL_GAS_USDC_RAW) throw new BadRequestException(OWN_WALLET_COPY.gas);
    }

    const id = randomUUID();
    const swap = await this.kyber.prepareForWallet({ tokenIn, tokenOut, amountInRaw, walletAddress: address, actionId: id });
    const txs: WalletTx[] = [];
    if (swap.allowance < amountInRaw) {
      txs.push({
        kind: 'approve',
        to: tokenIn,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [swap.router, amountInRaw] }),
        value: '0x0',
      });
    }
    txs.push({ kind: 'swap', to: swap.router, data: swap.callData, value: '0x0' });

    const summary = await this.summarize(side, mint, amountInRaw, swap.amountOut);
    await this.actions.create({
      id,
      uid,
      kind: side,
      tokenIn,
      tokenOut,
      amountInRaw,
      usdValue: side === 'buy' ? Number(amountInRaw) / 1e6 : null,
      sourceUrl: canonicalSourceUrl(b.sourceUrl),
    });
    const token = randomBytes(24).toString('base64url');
    this.pending.set(id, {
      id,
      uid,
      address,
      side,
      tokenIn,
      tokenOut,
      amountInRaw,
      router: swap.router,
      callData: swap.callData,
      txs,
      token,
      expiresAt: Date.now() + TTL_MS,
      state: 'waiting',
      summary,
    });
    // The id and the key ride in the fragment, which never reaches a server
    // log or a Referer header.
    return { preparedId: id, confirmUrl: `${base}/api/v1/wallet/confirm#${id}.${token}`, summary };
  }

  /** What the confirm page needs, for the holder of the link only. */
  pageData(id: unknown, token: unknown): ConfirmPageData {
    const p = this.byToken(id, token);
    const net = this.config.network;
    return {
      address: p.address,
      chain: {
        chainId: `0x${net.chainId.toString(16)}`,
        chainName: net.name === 'mainnet' ? 'Arc' : 'Arc Testnet',
        rpcUrls: [net.rpcUrl],
        blockExplorerUrls: [net.explorer],
        // Arc's gas token is USDC, and wallets show the native currency with 18 decimals.
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      },
      txs: p.txs,
      summary: p.summary,
      state: p.state,
    };
  }

  /**
   * The page's hashes. Only the swap's own transaction settles the trade, and
   * only when it is the one we built, sent by this wallet, and successful.
   */
  async submit(body: unknown): Promise<OwnTradeStatus> {
    const b = (body ?? {}) as { id?: unknown; t?: unknown; approveHash?: unknown; swapHash?: unknown };
    const p = this.byToken(b.id, b.t);
    const swapHash = hashOf(b.swapHash);
    if (!swapHash) throw new BadRequestException(OWN_WALLET_COPY.badHash);
    if (p.state === 'done' && p.result) return this.view(p);
    // A trade marked cancelled (its window closed a moment too early) or failed
    // is still read: if the chain shows the swap we built, it happened.
    const approveHash = hashOf(b.approveHash);

    p.state = 'sending';
    const legs: Leg[] = [];
    if (approveHash) legs.push({ kind: 'approve', status: 'confirmed', txHash: approveHash, chain: this.chainCode });
    legs.push({ kind: 'swap', status: 'pending', txHash: swapHash, chain: this.chainCode, sentAt: new Date().toISOString() });
    await this.actions.update(p.id, { status: 'sent', legs });

    let receipt;
    try {
      receipt = await this.chain.receipt(swapHash, this.receiptWaitMs);
    } catch (e) {
      this.logger.warn(`own-wallet trade ${p.id}: no receipt for ${swapHash} yet: ${(e as Error)?.message ?? e}`);
      return { state: 'sending', signature: swapHash, error: OWN_WALLET_COPY.slow };
    }
    const tx = await this.chain.client.getTransaction({ hash: swapHash });
    const ours =
      lower(tx.from) === p.address && lower(tx.to ?? '0x') === p.router && lower(tx.input) === lower(p.callData);
    if (!ours) {
      // Not recorded as this trade: whatever the wallet sent, it was not what we built.
      this.logger.warn(`own-wallet trade ${p.id}: ${swapHash} is not the prepared swap`);
      p.state = 'waiting';
      await this.actions.update(p.id, { status: 'pending', legs: [] });
      throw new BadRequestException(OWN_WALLET_COPY.notOurs);
    }
    if (receipt.status !== 'success') {
      p.state = 'failed';
      p.error = OWN_WALLET_COPY.reverted;
      await this.actions.update(p.id, {
        status: 'failed',
        error: 'reverted',
        legs: legs.map((l) => (l.kind === 'swap' ? { ...l, status: 'failed' as const } : l)),
      });
      return this.view(p);
    }
    const out = receivedFromLogs(receipt.logs, p.tokenOut, p.address);
    const settled = {
      status: 'confirmed' as const,
      confirmedAt: new Date().toISOString(),
      gasUsdcRaw: gasUsdcRaw(receipt).toString(),
    };
    await this.actions.update(p.id, {
      status: 'confirmed',
      amountOutRaw: out,
      legs: legs.map((l) => (l.kind === 'swap' ? { ...l, ...settled } : l)),
    });
    p.state = 'done';
    p.result = { signature: swapHash, outAmountRaw: out.toString() };
    return this.view(p);
  }

  /** The extension's poll, for the account that prepared the trade. */
  async status(uid: string, id: unknown): Promise<OwnTradeStatus> {
    const key = typeof id === 'string' ? id : '';
    const p = this.pending.get(key);
    if (p) {
      if (p.uid !== uid) throw new ForbiddenException(OWN_WALLET_COPY.notYours);
      if (p.state === 'waiting' && p.expiresAt < Date.now()) return { state: 'expired', error: OWN_WALLET_COPY.gone };
      return this.view(p);
    }
    // Not in memory: a restart, or long ago. The ledger still knows how it ended.
    const row = /^[0-9a-f-]{36}$/.test(key) ? await this.actions.get(key) : null;
    if (!row || row.uid !== uid) throw new NotFoundException(OWN_WALLET_COPY.gone);
    const swap = row.legs.find((l) => l.kind === 'swap');
    if (row.status === 'confirmed') return { state: 'done', signature: swap?.txHash, outAmountRaw: row.amountOutRaw ?? '0' };
    if (row.status === 'failed') return { state: row.error === 'cancelled' ? 'cancelled' : 'failed', error: OWN_WALLET_COPY.reverted };
    if (row.status === 'sent') return { state: 'sending', signature: swap?.txHash, error: OWN_WALLET_COPY.slow };
    return { state: 'expired', error: OWN_WALLET_COPY.gone };
  }

  /** Closed or declined before anything was sent: by the page (with its link) or by the extension. */
  async cancel(by: { uid: string } | { token: unknown }, id: unknown): Promise<OwnTradeStatus> {
    const p = 'uid' in by ? this.pending.get(typeof id === 'string' ? id : '') : this.byToken(id, by.token);
    if (!p) throw new NotFoundException(OWN_WALLET_COPY.gone);
    if ('uid' in by && p.uid !== by.uid) throw new ForbiddenException(OWN_WALLET_COPY.notYours);
    if (p.state === 'waiting') {
      p.state = 'cancelled';
      await this.actions.update(p.id, { status: 'failed', error: 'cancelled' });
    }
    return this.view(p);
  }

  private view(p: Pending): OwnTradeStatus {
    if (p.state === 'done' && p.result) return { state: 'done', ...p.result };
    if (p.state === 'failed') return { state: 'failed', error: p.error ?? OWN_WALLET_COPY.reverted };
    return { state: p.state };
  }

  private byToken(id: unknown, token: unknown): Pending {
    const p = typeof id === 'string' ? this.pending.get(id) : undefined;
    if (!p) throw new NotFoundException(OWN_WALLET_COPY.gone);
    const a = Buffer.from(typeof token === 'string' ? token : '');
    const b = Buffer.from(p.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException(OWN_WALLET_COPY.badLink);
    if (p.state === 'waiting' && p.expiresAt < Date.now()) throw new NotFoundException(OWN_WALLET_COPY.gone);
    return p;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, p] of this.pending) if (p.expiresAt + TTL_MS < now) this.pending.delete(id);
  }

  private get chainCode(): string {
    return this.config.network.walletsBlockchain;
  }

  private async decimalsOf(token: Address): Promise<number> {
    const known = circleAssetByAddress(this.config.network, token);
    if (known) return known.decimals;
    return this.chain.client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18);
  }

  /** "Buy $25.00 of Bitcoin" and "You get about 0.0003 Bitcoin", in the panel's names. */
  private async summarize(side: 'buy' | 'sell', mint: Address, amountInRaw: bigint, amountOutRaw: bigint) {
    const known = circleAssetByAddress(this.config.network, mint);
    let name = known ? CIRCLE_NAMES[known.symbol] ?? known.symbol : null;
    let decimals = known?.decimals ?? null;
    if (!known && this.market) {
      const v = await this.market.describe(mint).catch(() => null);
      if (v) {
        name = v.token.symbol ? `$${v.token.symbol}` : v.token.name;
        decimals = v.token.decimals;
      }
    }
    decimals ??= await this.decimalsOf(mint);
    const label = name ?? 'this token';
    const amount = (raw: bigint, d: number) => trimAmount(formatUnits(raw, d));
    if (side === 'buy') {
      return {
        title: `Buy $${(Number(amountInRaw) / 1e6).toFixed(2)} of ${label}`,
        detail: `You get about ${amount(amountOutRaw, decimals)} ${label}.`,
      };
    }
    return {
      title: `Sell ${amount(amountInRaw, decimals)} ${label}`,
      detail: `You get about $${(Number(amountOutRaw) / 1e6).toFixed(2)}.`,
    };
  }
}

function hashOf(v: unknown): Hash | null {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v.toLowerCase() as Hash) : null;
}

/** At most six significant decimals, no trailing zeros: 0.000301 rather than 0.00030123. */
function trimAmount(s: string): string {
  const [whole, frac = ''] = s.split('.');
  if (!frac) return whole!;
  const lead = frac.match(/^0*/)![0].length;
  const kept = frac.slice(0, Math.min(frac.length, whole === '0' ? lead + 4 : 6)).replace(/0+$/, '');
  return kept ? `${whole}.${kept}` : whole!;
}

function floorCents(raw: bigint): number {
  return Number(raw / 10_000n) / 100;
}

function ceilCents(raw: bigint): number {
  return Number((raw + 9_999n) / 10_000n) / 100;
}
