import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  hashTypedData,
  maxUint256,
  pad,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Hex,
  type PublicClient,
} from 'viem';
import { ArcChain } from '../arc/chain';
import { CircleWallets } from '../circle/wallets';
import { APP_CONFIG, AppConfig } from '../config';
import { receivedFromLogs } from '../routers/kyber.router';
import { RemoteTokens } from '../routes/remote-tokens';
import { RouteQuotes } from '../routes/route-quotes';
import type { RemoteAsset } from '../routes/remote';
import { ActionsStore } from '../trade/actions';
import type { OwnTradeStatus, WalletTx } from '../trade/own-wallet';
import type { HeldToken } from '../trade/positions';
import { canonicalSourceUrl, GAS_RESERVE_USDC_RAW, parseRaw, usdToRaw } from '../trade/trade.service';
import { TRADE_ERRORS, lower, type Leg } from '../trade/types';
import { circleAccount, replaySafeTypedData, wrapOwnerSignature, type AccountCall } from './circle-account';
import { FAR_NETWORKS, FORWARD_HOOK, isFarChain, permitAbi, tokenMessengerAbi, type FarChain, type FarNetwork } from './far-chains';
import { buildFarSwap, FarSwapError, type FarSwap } from './far-swaps';
import type { FarHoldingsPort } from './far-holdings';
import { Bundler, chainClient, draftUserOp, type Op, type Permit } from './user-ops';

/**
 * A BUY OR SELL ON BASE OR ARBITRUM, FROM THE READER'S ARC BALANCE.
 *
 * Arc is where the money lives. Buying $BRETT on Base is:
 *   1. on Arc, from the reader's own wallet: approve USDC to CCTP and burn it
 *      with a forwarding request (depositForBurnWithHook, "cctp-forward");
 *   2. Circle's Forwarding Service mints that USDC on Base, straight into the
 *      reader's Circle smart account (far/circle-account.ts), so nobody
 *      needs gas on Base to receive it;
 *   3. the account swaps it on KyberSwap in one user operation the wallet
 *      signs, gas paid in USDC through Circle Paymaster. The first one also
 *      carries a signed permit that lets the paymaster take that gas.
 * Selling is one user operation the other way: swap to USDC and burn it back
 * to Arc with a forwarding request, so it lands in the reader's own wallet.
 *
 * The confirm page (trade/confirm-page.ts) walks the wallet through it one
 * step at a time: next() says what the page should do now, step() takes what
 * the wallet did. Every hash and signature is checked before it counts: the
 * burn must be exactly the transaction built here, and each signature must
 * recover to the wallet that owns the account.
 *
 * A little USDC stays in the account (ACCOUNT_RESERVE) for the paymaster's
 * prefund, which it takes before the calls run. USDC already in the account
 * is spent first, so a buy that stopped halfway resumes without Arc.
 */

export type FarPhase = 'arc' | 'bridging' | 'permit' | 'order' | 'sending' | 'returning' | 'done' | 'failed' | 'cancelled';

export interface WalletChain {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  blockExplorerUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export type FarStep =
  | { kind: 'arc'; chain: WalletChain; txs: WalletTx[]; say: string }
  | { kind: 'wait'; say: string }
  | { kind: 'sign-typed'; chain: WalletChain; typedData: unknown; say: string }
  | { kind: 'sign-hash'; hash: Hex; say: string }
  | { kind: 'done'; say: string; txUrl: string | null }
  | { kind: 'failed'; say: string };

export interface FarPageData {
  flow: 'far';
  address: Hex;
  summary: { title: string; detail: string };
}

interface Order {
  calls: AccountCall[];
  /** Buy: USDC spent. Sell: the token sold. */
  spendRaw: bigint;
  swap: FarSwap;
  op?: Op;
  hash?: Hex;
}

interface FarPending {
  id: string;
  uid: string;
  token: string;
  side: 'buy' | 'sell';
  owner: Hex;
  account: Hex;
  chain: FarChain;
  asset: RemoteAsset;
  phase: FarPhase;
  summary: { title: string; detail: string };
  expiresAt: number;
  legs: Leg[];
  /** Buy: USDC burned on Arc, and the Arc transactions that burn it. */
  burnRaw?: bigint;
  expectRaw?: bigint;
  arcTxs?: WalletTx[];
  burnHash?: Hex;
  bridgingSince?: number;
  order?: Order;
  permit?: Permit;
  userOpHash?: Hex;
  txHash?: Hex;
  outRaw?: bigint;
  error?: string;
}

/** Sentences the page and the extension show as they are. */
export const FAR_COPY = {
  notOpen: (chain: string) => `Buying on ${chain} from your Arc balance is not open yet.`,
  tooSmall: (min: number) => `Buy at least $${min} on another chain: Circle's fees are a few cents.`,
  moving: (chain: string) => `Circle is moving your USDC to ${chain}. This takes about a minute.`,
  returning: 'Circle is moving your USDC back to Arc.',
  permit: (chain: string) => `Allow network fees on ${chain} to be paid in USDC. You sign this once.`,
  order: (chain: string) => `Confirm the order on ${chain}. Your wallet shows a code: that is the order.`,
  sending: (chain: string) => `Sending your order on ${chain}.`,
  arc: 'Send your USDC from Arc. Your wallet asks twice: allow, then send.',
  arcOnce: 'Send your USDC from Arc.',
  done: 'Done. You can close this window.',
  wrongSigner: 'Sign with the wallet you signed in with.',
  notOurs: 'That transaction is not the one Poppin prepared.',
  burnFailed: 'Sending from Arc did not go through. Only the network fee was spent.',
  orderFailed: (chain: string) => `The order did not go through on ${chain}. Your USDC is safe in your ${chain} account; try again.`,
  noGas: (chain: string) => `Your ${chain} account needs about $0.25 of USDC for the network fee. Buy anything there first.`,
  noPrice: 'This could not be priced right now. Try again in a moment.',
} as const;

const TTL_MS = 30 * 60 * 1000;
const MIN_BUY_USD = 2;
/** Kept in the Circle account so the paymaster's prefund is always there. */
export const ACCOUNT_RESERVE_RAW = 250_000n;
/** The paymaster's allowance, signed once; signed again when less than a dollar of it is left. */
const PERMIT_RAW = 10_000_000n;
const PERMIT_LOW_RAW = 1_000_000n;
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

@Injectable()
export class FarTrades implements FarHoldingsPort {
  private readonly logger = new Logger('far/trades');
  private readonly pending = new Map<string, FarPending>();
  private readonly usdcDomains = new Map<number, { name: string; version: string }>();
  fetchFn: typeof fetch = (...a) => fetch(...a);
  clientFor: (chain: FarChain) => PublicClient = chainClient;
  bundlerFor: (chain: FarChain) => Bundler = (chain) => new Bundler(chain.bundlerUrl, this.fetchFn);
  swapFor = buildFarSwap;
  arcReceiptWaitMs = 45_000;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly arc: ArcChain,
    private readonly actions: ActionsStore,
    private readonly wallets: CircleWallets,
    private readonly tokens: RemoteTokens,
    private readonly routes: RouteQuotes,
  ) {}

  private get net(): FarNetwork {
    return FAR_NETWORKS[this.config.network.name];
  }

  private get arcUsdc(): Hex {
    return lower(this.config.network.usdc.address);
  }

  /**
   * Can a reader of this deploy trade this asset where it lives? Not native
   * ETH: it leaves no Transfer log to count, and nothing to approve when sold.
   */
  opensFor(asset: Pick<RemoteAsset, 'chain' | 'address'>): boolean {
    return (
      this.config.walletAccounts === 'own' &&
      isFarChain(asset.chain) &&
      this.net.chains[asset.chain].kyber !== null &&
      asset.address.toLowerCase() !== NATIVE
    );
  }

  /** The reader's tokens in their Circle accounts, priced by the live route. */
  async held(owner: Hex, mints: string[]): Promise<HeldToken[]> {
    const account = circleAccount(lower(owner)).address;
    const out: HeldToken[] = [];
    for (const mint of [...new Set(mints)]) {
      const listing = await this.tokens.assetOf(mint).catch(() => null);
      const asset = listing?.asset;
      if (!listing || !asset || !this.opensFor(asset) || !isFarChain(asset.chain)) continue;
      const chain = this.net.chains[asset.chain];
      const raw = await this.balanceOf(this.clientFor(chain), asset.address as Hex, account).catch(() => 0n);
      if (raw <= 0n) continue;
      const price = await this.routes.priceUsd(asset).catch(() => listing.priceUsd);
      out.push({
        address: listing.mint as Hex,
        raw,
        decimals: asset.decimals,
        symbol: asset.ticker,
        name: asset.name,
        kind: 'long-tail',
        priceUsd: price,
        change24hPct: null,
      });
    }
    return out;
  }

  owns(id: unknown): boolean {
    return typeof id === 'string' && this.pending.has(id);
  }

  // ─── prepare ──────────────────────────────────────────────────────────────

  async prepare(uid: string, body: unknown, base: string): Promise<{ preparedId: string; confirmUrl: string; summary: FarPending['summary'] }> {
    this.sweep();
    const own = await this.wallets.ownWallet(uid);
    if (!own) throw new ConflictException('This account trades from its Poppin wallet.');
    const owner = lower(own.address);
    const b = (body ?? {}) as { side?: unknown; mint?: unknown; amountUsd?: unknown; amountRaw?: unknown; sourceUrl?: unknown };
    const side = b.side === 'sell' ? 'sell' : b.side === 'buy' ? 'buy' : null;
    if (!side) throw new BadRequestException(TRADE_ERRORS.badBuy);
    const listing = await this.tokens.assetOf(b.mint).catch(() => {
      throw new UnprocessableEntityException(FAR_COPY.noPrice);
    });
    const asset = listing?.asset;
    if (!asset || !listing) throw new UnprocessableEntityException(TRADE_ERRORS.noRoute);
    if (!isFarChain(asset.chain) || !this.opensFor(asset)) {
      throw new UnprocessableEntityException(FAR_COPY.notOpen(asset.chain === 'ethereum' ? 'Ethereum' : asset.chain));
    }
    const chain = this.net.chains[asset.chain];
    const account = circleAccount(owner).address;
    const id = randomUUID();
    const p: FarPending = {
      id,
      uid,
      token: randomBytes(24).toString('base64url'),
      side,
      owner,
      account: lower(account),
      chain,
      asset,
      phase: 'order',
      summary: { title: '', detail: '' },
      expiresAt: Date.now() + TTL_MS,
      legs: [],
    };

    if (side === 'buy') {
      const amountRaw = usdToRaw(b.amountUsd);
      if (amountRaw === null) throw new BadRequestException(TRADE_ERRORS.badBuy);
      if (amountRaw < BigInt(MIN_BUY_USD) * 1_000_000n) throw new BadRequestException(FAR_COPY.tooSmall(MIN_BUY_USD));
      const client = this.clientFor(chain);
      const inAccount = await this.balanceOf(client, chain.usdc, p.account);
      if (inAccount >= amountRaw + ACCOUNT_RESERVE_RAW) {
        // Enough USDC already waits on this chain: no Arc leg at all.
        p.expectRaw = amountRaw;
        await this.buildBuyOrder(p, amountRaw);
      } else {
        await this.prepareBurn(p, amountRaw);
      }
      p.summary = {
        title: `Buy $${(Number(amountRaw) / 1e6).toFixed(2)} of ${asset.ticker} on ${chain.label}`,
        detail:
          p.phase === 'arc'
            ? `Circle moves your USDC to ${chain.label}, then you confirm the order there. Network fees are paid in USDC.`
            : `Paid from the USDC already in your ${chain.label} account.`,
      };
      await this.actions.create({
        id,
        uid,
        kind: 'buy',
        tokenIn: this.arcUsdc,
        tokenOut: listing.mint,
        amountInRaw: amountRaw,
        usdValue: Number(amountRaw) / 1e6,
        sourceUrl: canonicalSourceUrl(b.sourceUrl),
      });
    } else {
      const amountRaw = parseRaw(b.amountRaw);
      if (amountRaw === null || amountRaw <= 0n) throw new BadRequestException(TRADE_ERRORS.badSell);
      const client = this.clientFor(chain);
      const [held, gas] = await Promise.all([
        this.balanceOf(client, asset.address as Hex, p.account),
        this.balanceOf(client, chain.usdc, p.account),
      ]);
      if (held < amountRaw) throw new BadRequestException(TRADE_ERRORS.insufficientSell(Number(formatUnits(held, asset.decimals))));
      if (gas < ACCOUNT_RESERVE_RAW / 2n) throw new BadRequestException(FAR_COPY.noGas(chain.label));
      await this.buildSellOrder(p, amountRaw);
      const back = p.order!.swap.minOut;
      p.summary = {
        title: `Sell ${trim(formatUnits(amountRaw, asset.decimals))} ${asset.ticker} on ${chain.label}`,
        detail: `You get about $${(Number(back) / 1e6).toFixed(2)} back on Arc, less Circle's few cents.`,
      };
      await this.actions.create({
        id,
        uid,
        kind: 'sell',
        tokenIn: listing.mint,
        tokenOut: this.arcUsdc,
        amountInRaw: amountRaw,
        usdValue: Number(back) / 1e6,
        sourceUrl: canonicalSourceUrl(b.sourceUrl),
      });
    }
    this.pending.set(id, p);
    return { preparedId: id, confirmUrl: `${base}/api/v1/wallet/confirm#${id}.${p.token}`, summary: p.summary };
  }

  /** The Arc leg of a buy: allow CCTP this amount if needed, then burn it toward the account. */
  private async prepareBurn(p: FarPending, amountRaw: bigint): Promise<void> {
    const held = (await this.arc.balancesOf(p.owner, [this.arcUsdc])).get(this.arcUsdc) ?? 0n;
    const spendable = held > GAS_RESERVE_USDC_RAW ? held - GAS_RESERVE_USDC_RAW : 0n;
    if (amountRaw > spendable) {
      throw new BadRequestException(TRADE_ERRORS.insufficientUsdc(Number(spendable / 10_000n) / 100, Number(amountRaw) / 1e6));
    }
    const fees = await this.bridgeFees(26, p.chain.cctpDomain);
    const protocol = (amountRaw * BigInt(Math.ceil(fees.bps * 100))) / 1_000_000n;
    const maxFee = protocol + (fees.forwardHigh * 12n) / 10n;
    p.burnRaw = amountRaw;
    p.expectRaw = amountRaw - protocol - fees.forwardMed;
    if (p.expectRaw < 1_000_000n) throw new BadRequestException(FAR_COPY.tooSmall(MIN_BUY_USD));
    const allowance = await this.arc.client.readContract({
      address: this.arcUsdc,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [p.owner, this.net.arcTokenMessenger],
    });
    const txs: WalletTx[] = [];
    if (allowance < amountRaw) {
      txs.push({
        kind: 'approve',
        to: this.arcUsdc,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [this.net.arcTokenMessenger, amountRaw] }),
        value: '0x0',
      });
    }
    txs.push({
      kind: 'swap',
      to: lower(this.net.arcTokenMessenger),
      data: encodeFunctionData({
        abi: tokenMessengerAbi,
        functionName: 'depositForBurnWithHook',
        args: [amountRaw, p.chain.cctpDomain, pad(p.account, { size: 32 }), this.arcUsdc, pad('0x', { size: 32 }), maxFee, 1000, FORWARD_HOOK],
      }),
      value: '0x0',
    });
    p.arcTxs = txs;
    p.phase = 'arc';
  }

  private async buildBuyOrder(p: FarPending, spendRaw: bigint): Promise<void> {
    const swap = await this.swap(p, p.chain.usdc, p.asset.address as Hex, spendRaw);
    p.order = {
      spendRaw,
      swap,
      calls: [
        { to: p.chain.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [swap.router, spendRaw] }) },
        { to: swap.router, data: swap.callData },
      ],
    };
    p.phase = (await this.needsPermit(p)) ? 'permit' : 'order';
  }

  private async buildSellOrder(p: FarPending, amountRaw: bigint): Promise<void> {
    const swap = await this.swap(p, p.asset.address as Hex, p.chain.usdc, amountRaw);
    const burn = swap.minOut;
    const fees = await this.bridgeFees(p.chain.cctpDomain, 26);
    const maxFee = (burn * BigInt(Math.ceil(fees.bps * 100))) / 1_000_000n + (fees.forwardHigh * 12n) / 10n;
    p.order = {
      spendRaw: amountRaw,
      swap,
      calls: [
        { to: p.asset.address as Hex, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [swap.router, amountRaw] }) },
        { to: swap.router, data: swap.callData },
        { to: p.chain.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [p.chain.tokenMessenger, burn] }) },
        {
          to: p.chain.tokenMessenger,
          data: encodeFunctionData({
            abi: tokenMessengerAbi,
            functionName: 'depositForBurnWithHook',
            args: [burn, 26, pad(p.owner, { size: 32 }), p.chain.usdc, pad('0x', { size: 32 }), maxFee, 1000, FORWARD_HOOK],
          }),
        },
      ],
    };
    p.phase = (await this.needsPermit(p)) ? 'permit' : 'order';
  }

  private async swap(p: FarPending, tokenIn: Hex, tokenOut: Hex, amountIn: bigint): Promise<FarSwap> {
    try {
      return await this.swapFor({ chain: p.chain, tokenIn, tokenOut, amountIn, account: p.account, fetchFn: this.fetchFn });
    } catch (e) {
      this.logger.warn(`far trade ${p.id}: ${(e as Error)?.message ?? e}`);
      throw new UnprocessableEntityException(e instanceof FarSwapError && /no route/i.test(e.message) ? TRADE_ERRORS.noRoute : FAR_COPY.noPrice);
    }
  }

  private async needsPermit(p: FarPending): Promise<boolean> {
    const allowance = await this.clientFor(p.chain).readContract({
      address: p.chain.usdc,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [p.account, p.chain.paymaster],
    });
    return allowance < PERMIT_LOW_RAW;
  }

  // ─── the page ─────────────────────────────────────────────────────────────

  pageData(id: unknown, token: unknown): FarPageData {
    const p = this.byToken(id, token);
    return { flow: 'far', address: p.owner, summary: p.summary };
  }

  /** What the page should do now. Waiting phases look again each time they are asked. */
  async next(id: unknown, token: unknown): Promise<FarStep> {
    const p = this.byToken(id, token);
    try {
      return await this.advance(p);
    } catch (e) {
      if (e instanceof UnprocessableEntityException || e instanceof BadRequestException) {
        return { kind: 'failed', say: String((e.getResponse() as { message?: string })?.message ?? e.message) };
      }
      this.logger.warn(`far trade ${p.id}: ${(e as Error)?.message ?? e}`);
      return { kind: 'wait', say: 'One moment.' };
    }
  }

  private async advance(p: FarPending): Promise<FarStep> {
    const label = p.chain.label;
    switch (p.phase) {
      case 'arc':
        return { kind: 'arc', chain: this.arcWalletChain(), txs: p.arcTxs ?? [], say: (p.arcTxs?.length ?? 0) > 1 ? FAR_COPY.arc : FAR_COPY.arcOnce };
      case 'bridging': {
        const arrived = await this.arrived(p);
        if (!arrived) return { kind: 'wait', say: FAR_COPY.moving(label) };
        const held = await this.balanceOf(this.clientFor(p.chain), p.chain.usdc, p.account);
        const spend = min(held - ACCOUNT_RESERVE_RAW, p.expectRaw ?? 0n);
        if (spend < 500_000n) return { kind: 'wait', say: FAR_COPY.moving(label) };
        this.leg(p, 'mint', { status: 'confirmed', chain: p.chain.key, confirmedAt: new Date().toISOString() });
        await this.buildBuyOrder(p, spend);
        return this.advance(p);
      }
      case 'permit':
        return { kind: 'sign-typed', chain: this.walletChain(p.chain), typedData: await this.permitRequest(p), say: FAR_COPY.permit(label) };
      case 'order': {
        const o = p.order!;
        if (!o.op || !o.hash) {
          const drafted = await draftUserOp({
            chain: p.chain,
            owner: p.owner,
            calls: o.calls,
            permit: p.permit ?? null,
            bundler: this.bundlerFor(p.chain),
            client: this.clientFor(p.chain),
          }).catch((e: unknown) => {
            this.logger.warn(`far trade ${p.id}: could not draft: ${(e as Error)?.message ?? e}`);
            throw new UnprocessableEntityException(FAR_COPY.noPrice);
          });
          o.op = drafted.op;
          o.hash = drafted.hash;
        }
        return { kind: 'sign-hash', hash: o.hash, say: FAR_COPY.order(label) };
      }
      case 'sending':
        return this.checkSent(p);
      case 'returning':
        return this.checkReturned(p);
      case 'done':
        return { kind: 'done', say: FAR_COPY.done, txUrl: p.txHash ? `${p.chain.explorer}/tx/${p.txHash}` : null };
      case 'failed':
      case 'cancelled':
        return { kind: 'failed', say: p.error ?? FAR_COPY.orderFailed(label) };
    }
  }

  /** What the wallet did: the Arc hashes, the permit's signature, or the order's. */
  async step(body: unknown): Promise<FarStep> {
    const b = (body ?? {}) as { id?: unknown; t?: unknown; kind?: unknown; approveHash?: unknown; burnHash?: unknown; signature?: unknown };
    const p = this.byToken(b.id, b.t);
    if (b.kind === 'arc' && p.phase === 'arc') await this.takeBurn(p, hashOf(b.approveHash), hashOf(b.burnHash));
    else if (b.kind === 'sign-typed' && p.phase === 'permit') await this.takePermit(p, sigOf(b.signature));
    else if (b.kind === 'sign-hash' && p.phase === 'order') await this.takeOrder(p, sigOf(b.signature));
    return this.next(b.id, b.t);
  }

  private async takeBurn(p: FarPending, approveHash: Hex | null, burnHash: Hex | null): Promise<void> {
    if (!burnHash) throw new BadRequestException('The wallet did not return a transaction.');
    const receipt = await this.arc.receipt(burnHash, this.arcReceiptWaitMs).catch(() => null);
    if (!receipt) throw new UnprocessableEntityException('Arc is slow to answer. Try again in a moment.');
    const tx = await this.arc.client.getTransaction({ hash: burnHash });
    const burn = p.arcTxs?.find((t) => t.kind === 'swap');
    const ours = burn && lower(tx.from) === p.owner && lower(tx.to ?? '0x') === lower(burn.to) && lower(tx.input) === lower(burn.data);
    if (!ours) throw new BadRequestException(FAR_COPY.notOurs);
    if (approveHash) this.leg(p, 'approve', { status: 'confirmed', txHash: approveHash, chain: this.config.network.walletsBlockchain });
    if (receipt.status !== 'success') {
      p.phase = 'failed';
      p.error = FAR_COPY.burnFailed;
      this.leg(p, 'burn', { status: 'failed', txHash: burnHash, chain: this.config.network.walletsBlockchain });
      await this.actions.update(p.id, { status: 'failed', error: 'burn reverted', legs: p.legs });
      return;
    }
    p.burnHash = burnHash;
    p.bridgingSince = Date.now();
    p.phase = 'bridging';
    this.leg(p, 'burn', { status: 'confirmed', txHash: burnHash, chain: this.config.network.walletsBlockchain, sentAt: new Date().toISOString() });
    await this.actions.update(p.id, { status: 'sent', legs: p.legs });
  }

  private async takePermit(p: FarPending, signature: Hex | null): Promise<void> {
    if (!signature) throw new BadRequestException(FAR_COPY.wrongSigner);
    const typed = await this.permitTyped(p);
    const signer = await recoverTypedDataAddress({ ...typed, signature } as never).catch(() => null);
    if (!signer || lower(signer) !== p.owner) throw new BadRequestException(FAR_COPY.wrongSigner);
    p.permit = { amount: PERMIT_RAW, signature: wrapOwnerSignature(signature, 'typed') };
    p.phase = 'order';
  }

  private async takeOrder(p: FarPending, signature: Hex | null): Promise<void> {
    const o = p.order;
    if (!signature || !o?.op || !o.hash) throw new BadRequestException(FAR_COPY.wrongSigner);
    const signer = await recoverMessageAddress({ message: { raw: o.hash }, signature }).catch(() => null);
    if (!signer || lower(signer) !== p.owner) throw new BadRequestException(FAR_COPY.wrongSigner);
    const op = { ...o.op, signature: wrapOwnerSignature(signature, 'personal') };
    try {
      p.userOpHash = await this.bundlerFor(p.chain).send(op);
    } catch (e) {
      this.logger.warn(`far trade ${p.id}: bundler refused: ${(e as Error)?.message ?? e}`);
      // Priced again on the next ask: gas or the route may have moved.
      o.op = undefined;
      o.hash = undefined;
      throw new UnprocessableEntityException(FAR_COPY.noPrice);
    }
    p.phase = 'sending';
    this.leg(p, 'swap', { status: 'pending', txHash: p.userOpHash, chain: p.chain.key, sentAt: new Date().toISOString() });
    await this.actions.update(p.id, { status: 'sent', legs: p.legs });
  }

  private async checkSent(p: FarPending): Promise<FarStep> {
    const receipt = await this.bundlerFor(p.chain).receipt(p.userOpHash!);
    if (!receipt) return { kind: 'wait', say: FAR_COPY.sending(p.chain.label) };
    p.txHash = lower(receipt.receipt.transactionHash);
    if (!receipt.success) {
      p.phase = 'failed';
      p.error = FAR_COPY.orderFailed(p.chain.label);
      this.leg(p, 'swap', { status: 'failed', txHash: p.txHash, chain: p.chain.key });
      await this.actions.update(p.id, { status: 'failed', error: 'order reverted', legs: p.legs });
      return this.advance(p);
    }
    this.leg(p, 'swap', { status: 'confirmed', txHash: p.txHash, chain: p.chain.key, confirmedAt: new Date().toISOString() });
    if (p.side === 'buy') {
      p.outRaw = receivedFromLogs(receipt.logs, p.asset.address as Hex, p.account);
      p.phase = 'done';
      await this.actions.update(p.id, { status: 'confirmed', amountOutRaw: p.outRaw, legs: p.legs });
      return this.advance(p);
    }
    p.phase = 'returning';
    this.leg(p, 'mint', { status: 'pending', chain: this.config.network.walletsBlockchain, sentAt: new Date().toISOString() });
    await this.actions.update(p.id, { legs: p.legs });
    return this.advance(p);
  }

  /** A sell is done when Circle has minted its USDC in the reader's wallet on Arc. */
  private async checkReturned(p: FarPending): Promise<FarStep> {
    const message = await this.irisMessage(p.chain.cctpDomain, p.txHash!);
    const forwardTx = hashOf(message?.forwardTxHash);
    if (!forwardTx) return { kind: 'wait', say: FAR_COPY.returning };
    const receipt = await this.arc.receipt(forwardTx, 10_000).catch(() => null);
    if (!receipt) return { kind: 'wait', say: FAR_COPY.returning };
    p.outRaw = receivedFromLogs(receipt.logs, this.arcUsdc, p.owner);
    p.phase = 'done';
    this.leg(p, 'mint', { status: 'confirmed', txHash: forwardTx, chain: this.config.network.walletsBlockchain, confirmedAt: new Date().toISOString() });
    await this.actions.update(p.id, { status: 'confirmed', amountOutRaw: p.outRaw, legs: p.legs });
    return this.advance(p);
  }

  /** Has Circle delivered the buy's USDC to the account? */
  private async arrived(p: FarPending): Promise<boolean> {
    const message = await this.irisMessage(26, p.burnHash!);
    if (hashOf(message?.forwardTxHash)) return true;
    const held = await this.balanceOf(this.clientFor(p.chain), p.chain.usdc, p.account);
    return held >= (p.expectRaw ?? 0n) + ACCOUNT_RESERVE_RAW;
  }

  // ─── the extension ────────────────────────────────────────────────────────

  status(uid: string, id: unknown): OwnTradeStatus {
    const p = this.pending.get(typeof id === 'string' ? id : '');
    if (!p) throw new NotFoundException('This trade has expired. Start it again from Poppin.');
    if (p.uid !== uid) throw new ForbiddenException('That trade belongs to another account.');
    switch (p.phase) {
      case 'done':
        return { state: 'done', signature: p.txHash, outAmountRaw: (p.outRaw ?? 0n).toString() };
      case 'failed':
        return { state: 'failed', error: p.error };
      case 'cancelled':
        return { state: 'cancelled' };
      case 'bridging':
      case 'sending':
      case 'returning':
        return { state: 'sending' };
      default:
        return p.expiresAt < Date.now() ? { state: 'expired', error: 'This trade has expired. Start it again from Poppin.' } : { state: 'waiting' };
    }
  }

  /** Before anything left the wallet only: once USDC is moving, the trade finishes or waits in the account. */
  async cancel(by: { uid: string } | { token: unknown }, id: unknown): Promise<OwnTradeStatus> {
    const p = 'uid' in by ? this.pending.get(typeof id === 'string' ? id : '') : this.byToken(id, by.token);
    if (!p) throw new NotFoundException('This trade has expired. Start it again from Poppin.');
    if ('uid' in by && p.uid !== by.uid) throw new ForbiddenException('That trade belongs to another account.');
    if (p.phase === 'arc' || ((p.phase === 'permit' || p.phase === 'order') && p.side === 'sell')) {
      p.phase = 'cancelled';
      await this.actions.update(p.id, { status: 'failed', error: 'cancelled' });
    }
    return this.status(p.uid, p.id);
  }

  /**
   * The panel's /confirm for a far trade's hash: the extension asks with the
   * hash status() gave it, which is a transaction on Base or Arbitrum that the
   * Arc chain has never seen. Null for a hash that is not one of ours.
   */
  settled(hash: unknown): { status: 'confirmed' | 'failed' | 'unknown' } | null {
    const h = hashOf(hash);
    if (!h) return null;
    for (const p of this.pending.values()) {
      if (p.txHash !== h) continue;
      if (p.phase === 'done') return { status: 'confirmed' };
      if (p.phase === 'failed') return { status: 'failed' };
      return { status: 'unknown' };
    }
    return null;
  }

  /** One token's balance in the reader's Circle account, for the panel's Sell. */
  async balance(uid: string, mint: unknown): Promise<{ uiAmount: number; raw: string; decimals: number | null }> {
    const own = await this.wallets.ownWallet(uid).catch(() => null);
    const listing = await this.tokens.assetOf(mint).catch(() => null);
    const asset = listing?.asset;
    if (!own || !asset || !isFarChain(asset.chain) || !this.opensFor(asset)) return { uiAmount: 0, raw: '0', decimals: asset?.decimals ?? null };
    const account = circleAccount(lower(own.address)).address;
    const raw = await this.balanceOf(this.clientFor(this.net.chains[asset.chain]), asset.address as Hex, account).catch(() => null);
    if (raw === null) return { uiAmount: 0, raw: '0', decimals: null };
    return { uiAmount: Number(formatUnits(raw, asset.decimals)), raw: raw.toString(), decimals: asset.decimals };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async permitTyped(p: FarPending) {
    const client = this.clientFor(p.chain);
    let domain = this.usdcDomains.get(p.chain.chainId);
    if (!domain) {
      const [name, version] = await Promise.all([
        client.readContract({ address: p.chain.usdc, abi: permitAbi, functionName: 'name' }),
        client.readContract({ address: p.chain.usdc, abi: permitAbi, functionName: 'version' }),
      ]);
      domain = { name, version };
      this.usdcDomains.set(p.chain.chainId, domain);
    }
    const nonce = await client.readContract({ address: p.chain.usdc, abi: permitAbi, functionName: 'nonces', args: [p.account] });
    const digest = hashTypedData({
      domain: { name: domain.name, version: domain.version, chainId: p.chain.chainId, verifyingContract: p.chain.usdc },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      // The paymaster cannot read the clock during validation, so the deadline is forever.
      message: { owner: p.account, spender: p.chain.paymaster, value: PERMIT_RAW, nonce, deadline: maxUint256 },
    });
    const typed = replaySafeTypedData(p.account, p.chain.chainId, digest);
    const { EIP712Domain: _domain, ...types } = typed.types;
    return { domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message };
  }

  /** The permit request as eth_signTypedData_v4 takes it: plain JSON, EIP712Domain included. */
  private async permitRequest(p: FarPending): Promise<unknown> {
    const t = await this.permitTyped(p);
    return {
      domain: t.domain,
      types: replaySafeTypedData(p.account, p.chain.chainId, '0x').types,
      primaryType: t.primaryType,
      message: t.message,
    };
  }

  private async bridgeFees(from: number, to: number): Promise<{ bps: number; forwardMed: bigint; forwardHigh: bigint }> {
    const res = await this.fetchFn(`${this.net.irisUrl}/v2/burn/USDC/fees/${from}/${to}?forward=true`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    const rows = (res?.ok ? await res.json().catch(() => null) : null) as Array<{ finalityThreshold?: number; minimumFee?: number; forwardFee?: { med?: number; high?: number } }> | null;
    const fast = rows?.find((r) => r.finalityThreshold === 1000) ?? rows?.[0];
    const bps = Number(fast?.minimumFee);
    const med = Number(fast?.forwardFee?.med);
    const high = Number(fast?.forwardFee?.high ?? med);
    if (!Number.isFinite(bps) || !Number.isFinite(med) || !Number.isFinite(high) || bps < 0 || med < 0) {
      throw new UnprocessableEntityException(FAR_COPY.noPrice);
    }
    return { bps, forwardMed: BigInt(Math.ceil(med)), forwardHigh: BigInt(Math.ceil(high)) };
  }

  private async irisMessage(domain: number, txHash: Hex): Promise<{ status?: string; forwardTxHash?: string } | null> {
    const res = await this.fetchFn(`${this.net.irisUrl}/v2/messages/${domain}?transactionHash=${txHash}`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as { messages?: Array<{ status?: string; forwardTxHash?: string }> } | null;
    return body?.messages?.[0] ?? null;
  }

  private balanceOf(client: PublicClient, token: Hex, owner: Hex): Promise<bigint> {
    return client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
  }

  private leg(p: FarPending, kind: Leg['kind'], patch: Partial<Leg>): void {
    const at = p.legs.findIndex((l) => l.kind === kind);
    const base: Leg = at >= 0 ? p.legs[at]! : { kind, status: 'pending', chain: p.chain.key };
    const next = { ...base, ...patch } as Leg;
    if (at >= 0) p.legs[at] = next;
    else p.legs.push(next);
  }

  private arcWalletChain(): WalletChain {
    const net = this.config.network;
    return {
      chainId: `0x${net.chainId.toString(16)}`,
      chainName: net.name === 'mainnet' ? 'Arc' : 'Arc Testnet',
      rpcUrls: [net.rpcUrl],
      blockExplorerUrls: [net.explorer],
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    };
  }

  private walletChain(c: FarChain): WalletChain {
    return {
      chainId: `0x${c.chainId.toString(16)}`,
      chainName: c.label,
      rpcUrls: [c.rpcUrl],
      blockExplorerUrls: [c.explorer],
      nativeCurrency: c.nativeCurrency,
    };
  }

  private byToken(id: unknown, token: unknown): FarPending {
    const p = typeof id === 'string' ? this.pending.get(id) : undefined;
    if (!p) throw new NotFoundException('This trade has expired. Start it again from Poppin.');
    const a = Buffer.from(typeof token === 'string' ? token : '');
    const b = Buffer.from(p.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('This link is not valid. Start the trade again from Poppin.');
    return p;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, p] of this.pending) if (p.expiresAt + TTL_MS < now) this.pending.delete(id);
  }
}

function hashOf(v: unknown): Hex | null {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v.toLowerCase() as Hex) : null;
}

function sigOf(v: unknown): Hex | null {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{130}$/.test(v) ? (v as Hex) : null;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function trim(s: string): string {
  const [w, f = ''] = s.split('.');
  const kept = f.slice(0, 6).replace(/0+$/, '');
  return kept ? `${w}.${kept}` : w!;
}
