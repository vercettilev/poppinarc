import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { BridgeResult, BridgeStep, ChainDefinition } from '@circle-fin/app-kit';
import {
  Arbitrum,
  ArbitrumSepolia,
  Arc,
  ArcTestnet,
  Base,
  BaseSepolia,
  Ethereum,
  EthereumSepolia,
  Solana,
  SolanaDevnet,
} from '@circle-fin/app-kit/chains';
import type { Blockchain, TokenBlockchain } from '@circle-fin/developer-controlled-wallets';
import {
  createPublicClient,
  defineChain,
  erc20Abi,
  formatUnits,
  http,
  parseEventLogs,
  parseUnits,
  type Hash,
  type Log,
  type PublicClient,
} from 'viem';
import { APP_CONFIG, real, type AppConfig } from '../config';
import { ArcChain } from '../arc/chain';
import { stableUuid } from '../circle/ids';
import { CircleKit, toJsonSafe } from '../circle/kit';
import { CircleWallets } from '../circle/wallets';
import { DbService } from '../db/db.service';
import { ActionsStore, type ActionRow, type ActionStatus } from '../trade/actions';
import { lower, type Address, type Leg, type LegKind } from '../trade/types';

/**
 * DEPOSITS FROM OTHER NETWORKS: money that lands in a user's wallet on
 * Solana (or Base, Ethereum, Arbitrum) moves to their Arc wallet by itself.
 *
 * Each user gets a Circle wallet on every enabled network. A sweep reads
 * those wallets' USDC, and when a balance is worth moving it burns it with
 * App Kit Bridge (CCTP V2, Fast) and Circle's Forwarding Service mints it on
 * Arc. The forwarder matters twice: nobody has to hold USDC on Arc to pay for
 * the mint, and once the burn has landed the mint happens on Circle's side
 * whether or not this server is still alive to watch it.
 *
 * THE ONE MISTAKE THIS FILE EXISTS TO NOT MAKE is burning twice. App Kit's
 * retry, handed a result whose burn step says "error", sends a NEW burn
 * (bridge.check.json, retry table), and a burn step can say "error" while its
 * transaction lands anyway (a receipt wait that timed out, a Circle queue that
 * answered late, a smart account's batch whose poll ran out). So a new burn
 * is only ever started after the chain has said the last one did not happen:
 * a reverted transaction, or a source balance that is still all there once
 * the grace period has passed. Everything after a successful burn goes
 * through retry with the steps cut back to the last success, which can only
 * fetch the attestation and wait for the forwarder.
 *
 * A NETWORK IS ONLY OFFERED WHEN ITS GAS IS PAID FOR. Circle Wallets sponsor
 * nothing on Solana (the wallet is its own fee payer, and every burn also
 * funds a CCTP message account's rent), so Solana needs DEPOSIT_SOL_FUNDER,
 * a wallet of ours that tops deposit wallets up. EVM networks need smart
 * accounts, whose gas Gas Station sponsors. Anything else is refused at boot,
 * so no one is shown an address their money would sit in.
 *
 * Statuses on the action row:
 *   pending    created; the burn has not been seen to succeed
 *   sent       the burn landed; the money is on its way to Arc
 *   confirmed  the mint has a successful receipt on Arc crediting the user
 *   failed     the money did not leave (or needs a person, see `reconcile:`)
 */

export type DepositNetworkKey = 'SOL' | 'BASE' | 'ETH' | 'ARB';
export type DepositNetworkLabel = 'Solana' | 'Base' | 'Ethereum' | 'Arbitrum';

export interface DepositNetwork {
  key: DepositNetworkKey;
  /** The network's name as a person reads it next to a deposit address. */
  label: DepositNetworkLabel;
  kind: 'solana' | 'evm';
  /** Circle Wallets' blockchain code on this deploy's network. */
  walletsBlockchain: string;
  /** App Kit's chain object: what bridge() and retryBridge() want. */
  chain: ChainDefinition;
  /** EVM networks only. */
  chainId: number | null;
  /** USDC on this network: lowercase 0x on EVM, the base58 mint on Solana. */
  usdc: string;
  rpcUrl: string;
}

export interface DepositConfig {
  networks: DepositNetworkKey[];
  /** Balances below this stay where they are: moving them would cost a real share of them. */
  minUsdcRaw: bigint;
  /** The same for Solana, where each move also costs us about 0.004 SOL of rent that is not reclaimed. */
  minUsdcSolRaw: bigint;
  /** 0 means the loop never starts on its own; sweepOnce still works. */
  sweepMs: number;
  /** SOL a Solana deposit wallet must hold before we try to move its USDC. */
  minSolLamports: bigint;
  /** Our Solana wallet (base58, a Circle wallet of this entity) that sends deposit wallets their SOL. */
  solFunder: string | null;
  /** After a failure with an unchanged balance, wait this long before trying again. */
  retryMs: number;
  /** How long a burn of unknown outcome may stay unknown before the source balance decides. */
  graceMs: number;
  /** An open deposit older than this is handed to a person, so the wallet can move later money. */
  reconcileMs: number;
  /** How often every deposit wallet is read; in between only wallets with news are. 0 reads all every sweep. */
  fullScanMs: number;
  rpc: Partial<Record<DepositNetworkKey, string>>;
}

export const DEPOSIT_CONFIG = Symbol('DEPOSIT_CONFIG');

const ALIASES: Record<string, DepositNetworkKey> = {
  SOL: 'SOL',
  SOLANA: 'SOL',
  BASE: 'BASE',
  ETH: 'ETH',
  ETHEREUM: 'ETH',
  ARB: 'ARB',
  ARBITRUM: 'ARB',
};

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function decimal(value: string | undefined, fallback: string, decimals: number, name: string): bigint {
  const v = real(value) ?? fallback;
  let raw: bigint;
  try {
    if (!/^\d+(\.\d+)?$/.test(v)) throw new Error();
    raw = parseUnits(v, decimals);
  } catch {
    throw new Error(`${name} must be a decimal number, got "${v}"`);
  }
  if (raw <= 0n) throw new Error(`${name} must be above zero, got "${v}"`);
  return raw;
}

/** Seconds as ms, between `min` and a day; `zeroOk` also lets 0 through as "off". */
function seconds(value: string | undefined, fallback: number, name: string, min: number, zeroOk = false): number {
  const v = real(value);
  const n = v === null ? fallback : Number(v);
  const ok = Number.isFinite(n) && n <= 86_400 && (n >= min || (zeroOk && n === 0));
  if (!ok) {
    throw new Error(`${name} must be seconds between ${min} and 86400${zeroOk ? ', or 0' : ''}, got "${v}"`);
  }
  return Math.round(n * 1000);
}

/**
 * Read once at boot. DEPOSIT_NETWORKS is a comma list of SOL, BASE, ETH, ARB
 * (or their full names), default none: Arc is then the only deposit address,
 * and a network is turned on only by someone who has also paid for its gas
 * (see assertDepositGas).
 *
 * The floors on the timings are part of the no-double-burn rule: the grace
 * period has to outlast Circle's queue and Solana's blockhash expiry before
 * the balance is allowed to say "no burn landed".
 */
export function loadDepositConfig(env: NodeJS.ProcessEnv = process.env): DepositConfig {
  const list = real(env.DEPOSIT_NETWORKS) ?? 'none';
  const networks: DepositNetworkKey[] = [];
  if (list.trim().toLowerCase() !== 'none') {
    for (const part of list.split(',')) {
      const name = part.trim().toUpperCase();
      if (!name) continue;
      const key = ALIASES[name];
      if (!key) throw new Error(`DEPOSIT_NETWORKS: unknown network "${part.trim()}" (use SOL, BASE, ETH, ARB)`);
      if (!networks.includes(key)) networks.push(key);
    }
  }
  const rpc: Partial<Record<DepositNetworkKey, string>> = {};
  for (const key of ['SOL', 'BASE', 'ETH', 'ARB'] as const) {
    const url = real(env[`DEPOSIT_RPC_${key}`]);
    if (url) rpc[key] = url;
  }
  const solFunder = real(env.DEPOSIT_SOL_FUNDER);
  if (solFunder && !BASE58_ADDRESS.test(solFunder)) {
    throw new Error(`DEPOSIT_SOL_FUNDER must be a Solana address, got "${solFunder}"`);
  }
  return {
    networks,
    minUsdcRaw: decimal(env.DEPOSIT_MIN_USDC, '1', 6, 'DEPOSIT_MIN_USDC'),
    minUsdcSolRaw: decimal(env.DEPOSIT_MIN_USDC_SOL, '5', 6, 'DEPOSIT_MIN_USDC_SOL'),
    sweepMs: seconds(env.DEPOSIT_SWEEP_SECONDS, 20, 'DEPOSIT_SWEEP_SECONDS', 5, true),
    // A Solana burn funds a fresh CCTP message account with 3,900,000
    // lamports of rent (adapter-solana-kit, buildInstructions) on top of the
    // transaction fee; 0.005 SOL covers both with room.
    minSolLamports: decimal(env.DEPOSIT_MIN_SOL, '0.005', 9, 'DEPOSIT_MIN_SOL'),
    solFunder,
    retryMs: seconds(env.DEPOSIT_RETRY_SECONDS, 300, 'DEPOSIT_RETRY_SECONDS', 60),
    graceMs: seconds(env.DEPOSIT_GRACE_SECONDS, 600, 'DEPOSIT_GRACE_SECONDS', 180),
    reconcileMs: seconds(env.DEPOSIT_RECONCILE_SECONDS, 21_600, 'DEPOSIT_RECONCILE_SECONDS', 3_600),
    fullScanMs: seconds(env.DEPOSIT_FULL_SCAN_SECONDS, 3_600, 'DEPOSIT_FULL_SCAN_SECONDS', 60, true),
    rpc,
  };
}

/**
 * Refuses, at boot, a network whose deposit wallets could not pay to move
 * money out. The EVM rule is per deploy here and per user in
 * depositAddresses, because a user's EVM deposit wallet takes its account
 * type from their Arc wallet.
 */
export function assertDepositGas(cfg: DepositConfig, accountType: 'EOA' | 'SCA'): void {
  if (cfg.networks.includes('SOL') && !cfg.solFunder) {
    throw new Error(
      'DEPOSIT_NETWORKS includes SOL but DEPOSIT_SOL_FUNDER is not set: a Solana deposit wallet pays its own fees and CCTP rent, and nothing else would send it SOL',
    );
  }
  const evm = cfg.networks.filter((k) => k !== 'SOL');
  if (evm.length && accountType !== 'SCA') {
    throw new Error(
      `DEPOSIT_NETWORKS includes ${evm.join(', ')} but CIRCLE_ACCOUNT_TYPE is ${accountType}: only smart accounts have their gas sponsored, and an EOA would wait for ETH that nothing sends it`,
    );
  }
}

type EvmChainObject =
  | typeof Base
  | typeof BaseSepolia
  | typeof Ethereum
  | typeof EthereumSepolia
  | typeof Arbitrum
  | typeof ArbitrumSepolia;

/** Every network this deploy could take deposits from, enabled or not. Addresses come from App Kit's chain objects. */
export function depositNetworks(arc: AppConfig['network']['name'], rpc: DepositConfig['rpc'] = {}): DepositNetwork[] {
  const main = arc === 'mainnet';
  const evm = (key: DepositNetworkKey, label: DepositNetworkLabel, chain: EvmChainObject, code: string): DepositNetwork => ({
    key,
    label,
    kind: 'evm',
    walletsBlockchain: code,
    chain,
    chainId: chain.chainId,
    usdc: chain.usdcAddress.toLowerCase(),
    rpcUrl: rpc[key] ?? chain.rpcEndpoints[0],
  });
  const sol = main ? Solana : SolanaDevnet;
  return [
    {
      key: 'SOL',
      label: 'Solana',
      kind: 'solana',
      walletsBlockchain: main ? 'SOL' : 'SOL-DEVNET',
      chain: sol,
      chainId: null,
      usdc: sol.usdcAddress,
      rpcUrl: rpc.SOL ?? sol.rpcEndpoints[0],
    },
    evm('BASE', 'Base', main ? Base : BaseSepolia, main ? 'BASE' : 'BASE-SEPOLIA'),
    evm('ETH', 'Ethereum', main ? Ethereum : EthereumSepolia, main ? 'ETH' : 'ETH-SEPOLIA'),
    evm('ARB', 'Arbitrum', main ? Arbitrum : ArbitrumSepolia, main ? 'ARB' : 'ARB-SEPOLIA'),
  ];
}

/** One user's wallet on one deposit network, with the Arc address it drains into. */
export interface SourceWallet {
  uid: string;
  net: DepositNetwork;
  walletId: string;
  /** As its chain spells it: base58 on Solana (case matters), lowercase 0x on EVM. */
  address: string;
  accountType: 'EOA' | 'SCA';
  arcAddress: Address;
}

export interface SourceBalances {
  usdcRaw: bigint;
  /** Native gas balance (lamports, wei); null when gas is sponsored and was not read. */
  gasRaw: bigint | null;
}

export type TxOutcome = 'success' | 'reverted' | 'unknown';

/** Circle's record of one of its transactions (here: a smart account's batched approve and burn). */
export interface CircleTxView {
  state: string;
  txHash: string | null;
  errorReason: string | null;
}

export interface InboundSince {
  /** Wallets that received something (any token, gas included) in the window. */
  walletIds: Set<string>;
  /** Where the next read starts: when this one began, or the last item seen if it stopped early. */
  until: string;
}

/** Reads from the deposit networks and from Circle. A fake stands in for it in tests. */
export interface DepositChainReader {
  balances(w: SourceWallet): Promise<SourceBalances>;
  /**
   * Whether a burn moved the money: 'success' only when the transaction
   * succeeded and USDC left `from` in it; 'unknown' while the chain has not
   * seen it.
   */
  txOutcome(net: DepositNetwork, hash: string, from: string): Promise<TxOutcome>;
  /** Circle's view of one transaction by its id; null when Circle could not be asked. */
  circleTx(id: string): Promise<CircleTxView | null>;
  /** Inbound transfers on one network since `since` (ISO). Throws when it could not look. */
  inbound(net: DepositNetwork, since: string): Promise<InboundSince>;
}

export const DEPOSIT_CHAIN_READER = Symbol('DEPOSIT_CHAIN_READER');

/**
 * A leg as a deposit stores it. `step` is App Kit's own step name, kept so a
 * resume can hand the kit back its steps. A Solana signature lives in
 * `signature`, not `txHash`: the store lowercases txHash (right for 0x, fatal
 * for base58) and every reader of txHash expects 0x.
 */
export interface DepositLeg extends Leg {
  step?: string;
  signature?: string;
  forwarded?: boolean;
  explorerUrl?: string;
  /** The step's data with bigints as strings (toJsonSafe). */
  data?: unknown;
  /** On source legs: the App Kit provider that ran them, which retryBridge looks up by name. */
  provider?: string;
  /** On a needs-gas failure: the gas balance we saw, so a top-up is noticed. */
  gasRaw?: string;
  /** A smart account's batched approve and burn: Circle's transaction id, the way back to its hash. */
  batchId?: string;
}

/** Internal reasons on failed or waiting deposits. The prefix before the colon is what code reads. */
export const DEPOSIT_ERRORS = {
  needsSol: (have: bigint, need: bigint) =>
    `needs_gas: the Solana deposit wallet holds ${formatUnits(have, 9)} SOL and moving USDC out needs ${formatUnits(need, 9)} SOL for fees and rent; transfers out of Solana are not sponsored`,
  needsEth: (label: string) =>
    `needs_gas: the ${label} deposit wallet is an EOA with no ETH, so it cannot pay for the approve and burn`,
  needsGasKit: (label: string, why: string) => `needs_gas: ${label}: ${why}`,
  notStarted: (why: string) => `not_started: the transfer stopped before any burn was sent: ${why}`,
  burnReverted: (why: string) => `burn_reverted: the burn failed on chain and the money did not move: ${why}`,
  burnUnknown: (why: string) => `burn_unknown: waiting for the chain to settle the burn: ${why}`,
  burnNeverLanded: 'burn_not_sent: the source balance is still all there after the grace period, so no burn landed',
  reconcile:
    'reconcile: the source balance dropped but no burn hash was recorded; the forwarder may still deliver it, check by hand',
  stuckAfterBurn: (hours: number, why: string) =>
    `reconcile: the burn landed but no arrival on Arc was confirmed within ${hours} hours; check by hand: ${why}`,
  stuckUnknown: (hours: number, why: string) =>
    `reconcile: the burn's outcome was still unknown after ${hours} hours; check by hand: ${why}`,
  afterBurn: (why: string) => `after_burn: the burn landed and the rest will be retried: ${why}`,
  arrivalUnconfirmed: (why: string) => `arrival_unconfirmed: the mint has no successful receipt on Arc yet: ${why}`,
} as const;

export interface DepositAddressesView {
  arc: { network: 'Arc'; address: string };
  /** minUsdcRaw: the smallest deposit the sweep moves, raw 6-decimal USDC as a decimal string. */
  others: Array<{ network: DepositNetworkLabel; address: string; minUsdcRaw: string }>;
}

export interface DepositView {
  id: string;
  network: DepositNetworkLabel | null;
  status: ActionStatus;
  /** USDC raw (6 decimals) taken from the source wallet. */
  amountRaw: string | null;
  /** USDC raw that reached the Arc wallet, from the mint receipt. */
  arrivedRaw: string | null;
  /** 0x hash on EVM, base58 signature on Solana. */
  burnTxHash: string | null;
  mintTxHash: string | null;
  createdAt: string;
  updatedAt: string;
  /** Internal reason (DEPOSIT_ERRORS), for our own screens and logs, never user copy. */
  error: string | null;
}

export interface SweepReport {
  /** True when every deposit wallet was read; false when only those with news were. */
  full: boolean;
  scanned: number;
  started: string[];
  resumed: string[];
  held: string[];
  errors: number;
}

type Patch = { status?: ActionStatus; amountOutRaw?: bigint | null; legs?: DepositLeg[]; error?: string | null };

const HISTORY = 10;
const SWEEP_CONCURRENCY = 4;
const OPEN: ReadonlySet<ActionStatus> = new Set(['pending', 'sent']);
/** Circle may index a transfer a little after its createDate; each feed read reaches back this far. */
const INBOUND_OVERLAP_MS = 5 * 60_000;
const INBOUND_PAGE = 50;
const INBOUND_MAX_PAGES = 20;
/** Circle transaction states that may still reach the chain. */
const CIRCLE_IN_FLIGHT: ReadonlySet<string> = new Set(['INITIATED', 'CLEARED', 'QUEUED', 'SENT']);
/** Circle transaction states that never reached the chain. */
const CIRCLE_OFFCHAIN: ReadonlySet<string> = new Set(['CANCELLED', 'DENIED']);

@Injectable()
export class DepositsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('deposits');
  private readonly cfg: DepositConfig;
  private readonly all: DepositNetwork[];
  private readonly nets: DepositNetwork[];
  private readonly reader: DepositChainReader;

  /** Background work per source wallet id: at most one bridge or resume each. */
  private readonly running = new Map<string, Promise<void>>();
  /** Writes per action, chained, so a burn-event write can never land over the final one. */
  private readonly writes = new Map<string, Promise<void>>();
  /** Bridges this process has in flight, by action id (which is also the bridge traceId). */
  private readonly live = new Map<string, { src: SourceWallet; startedAt: string }>();
  /**
   * When to read a wallet again without news of an inbound transfer, by
   * wallet id. Absent means only news (or the next full scan) brings it back:
   * a wallet with nothing worth moving costs nothing between scans.
   */
  private readonly due = new Map<string, number>();
  /** Per network: the inbound feed has been read up to here. */
  private readonly cursor = new Map<DepositNetworkKey, string>();
  private lastFullScan = 0;
  private sweeping: Promise<SweepReport> | null = null;
  private loop: { stopped: boolean; handle: NodeJS.Timeout | null } | null = null;
  private eventsHooked = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly wallets: CircleWallets,
    private readonly circle: CircleKit,
    private readonly actions: ActionsStore,
    private readonly arc: ArcChain,
    @Optional() @Inject(DEPOSIT_CONFIG) cfg?: DepositConfig,
    @Optional() @Inject(DEPOSIT_CHAIN_READER) reader?: DepositChainReader,
  ) {
    this.cfg = cfg ?? loadDepositConfig();
    assertDepositGas(this.cfg, config.circle.accountType);
    this.all = depositNetworks(config.network.name, this.cfg.rpc);
    this.nets = this.cfg.networks.map((k) => this.all.find((n) => n.key === k)!);
    this.reader = reader ?? new LiveChainReader(wallets);
  }

  onApplicationBootstrap(): void {
    if (this.cfg.sweepMs <= 0 || !this.nets.length) return;
    if (!this.wallets.configured || !this.db.ready) {
      this.logger.warn('deposit sweep not started: Circle keys or DATABASE_URL missing');
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  // ---------------------------------------------------------------- addresses

  /**
   * Where a person can send USDC from. Arc always; each enabled network after
   * it, in DEPOSIT_NETWORKS order. An EVM network is left out for a user
   * whose Arc wallet is an EOA (from before the deploy moved to smart
   * accounts): the deposit wallet derived from it would be an EOA too, and
   * would wait for ETH. A network whose wallet cannot be made right now is
   * left out (and logged) rather than taking the Arc address down too.
   */
  async depositAddresses(uid: string): Promise<DepositAddressesView> {
    const arc = await this.wallets.ensureArcWallet(uid);
    const others: DepositAddressesView['others'] = [];
    for (const net of this.nets) {
      if (net.kind === 'evm' && arc.accountType !== 'SCA') continue;
      try {
        const w =
          net.kind === 'solana'
            ? await this.wallets.ensureSolanaDepositWallet(uid)
            : await this.wallets.ensureEvmDepositWallet(uid, net.walletsBlockchain);
        others.push({
          network: net.label,
          address: net.kind === 'evm' ? w.address.toLowerCase() : w.address,
          minUsdcRaw: this.minUsdc(net).toString(),
        });
      } catch (e) {
        this.logger.warn(`${net.label} deposit wallet for ${uid} failed: ${message(e)}`);
      }
    }
    return { arc: { network: 'Arc', address: arc.address.toLowerCase() }, others };
  }

  // ---------------------------------------------------------------- status

  /** Recent deposits for one user, newest first. */
  async status(uid: string, limit = 20): Promise<DepositView[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM actions WHERE uid = $1 AND kind = 'deposit' ORDER BY created_at DESC LIMIT $2`,
      [uid, Math.min(Math.max(limit, 1), 100)],
    );
    const found = await Promise.all(rows.map((r) => this.actions.get(r.id)));
    return found
      .filter((a): a is ActionRow => a !== null)
      .map((a) => {
        const legs = a.legs as DepositLeg[];
        const burn = legs.find((l) => l.kind === 'burn');
        const mint = legs.find((l) => l.kind === 'mint');
        return {
          id: a.id,
          network: this.all.find((n) => n.usdc === a.tokenIn)?.label ?? null,
          status: a.status,
          amountRaw: a.amountInRaw,
          arrivedRaw: a.amountOutRaw,
          burnTxHash: burn ? hashOf(burn) : null,
          mintTxHash: mint?.txHash ?? null,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          error: a.error,
        };
      });
  }

  // ---------------------------------------------------------------- loop

  /**
   * Sweep every DEPOSIT_SWEEP_SECONDS. The next sweep is scheduled only once
   * the last one has returned, so two never run at once. The bridges a sweep
   * starts run in the background; the loop does not wait for them.
   */
  start(): void {
    if (this.loop) return;
    const every = this.cfg.sweepMs > 0 ? this.cfg.sweepMs : 20_000;
    const loop: { stopped: boolean; handle: NodeJS.Timeout | null } = { stopped: false, handle: null };
    this.loop = loop;
    const schedule = () => {
      loop.handle = setTimeout(() => void tick(), every);
      loop.handle.unref?.();
    };
    const tick = async () => {
      loop.handle = null;
      try {
        await this.sweepOnce();
      } catch (e) {
        this.logger.error(`sweep failed: ${message(e)}`);
      }
      if (!loop.stopped) schedule();
    };
    schedule();
    this.logger.log(`deposit sweep every ${every / 1000}s: ${this.nets.map((n) => n.label).join(', ') || 'no network'}`);
  }

  /** Stops scheduling. A sweep or bridge already under way finishes: a burn is never abandoned halfway. */
  stop(): void {
    if (!this.loop) return;
    this.loop.stopped = true;
    if (this.loop.handle) clearTimeout(this.loop.handle);
    this.loop = null;
  }

  get looping(): boolean {
    return this.loop !== null;
  }

  /** Resolves when nothing this process started (bridge, resume, write) is still running. */
  async idle(): Promise<void> {
    while (this.running.size || this.writes.size) {
      await Promise.allSettled([...this.running.values(), ...this.writes.values()]);
    }
  }

  // ---------------------------------------------------------------- sweep

  /** One pass over the deposit wallets. A caller arriving mid-pass shares that pass. */
  sweepOnce(): Promise<SweepReport> {
    this.sweeping ??= this.runSweep().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  /**
   * Reading every wallet every 20 seconds is one Circle or RPC call per
   * wallet per sweep, which a few thousand users turn into rate limits and
   * stalled deposits. So a full scan runs at boot and then every
   * DEPOSIT_FULL_SCAN_SECONDS; the sweeps in between read Circle's inbound
   * feed (one call per network) and visit only the wallets that received
   * something, plus those this service has asked to look at again.
   */
  private async runSweep(): Promise<SweepReport> {
    const report: SweepReport = { full: false, scanned: 0, started: [], resumed: [], held: [], errors: 0 };
    if (!this.nets.length || !this.wallets.configured || !this.db.ready) return report;
    const startedAt = Date.now();
    const sources = await this.sources();
    const full = this.cfg.fullScanMs <= 0 || startedAt - this.lastFullScan >= this.cfg.fullScanMs;
    let picked = sources;
    if (full) {
      report.full = true;
    } else {
      const news = await this.inboundNews(report);
      picked = sources.filter((s) => news.has(s.walletId) || (this.due.get(s.walletId) ?? Infinity) <= startedAt);
    }
    await eachLimit(picked, SWEEP_CONCURRENCY, async (src) => {
      if (this.running.has(src.walletId)) return;
      report.scanned++;
      try {
        await this.visit(src, report);
      } catch (e) {
        report.errors++;
        // Looked at again after the retry window, not every sweep: an outage
        // must not turn into a full scan every 20 seconds.
        this.due.set(src.walletId, Date.now() + this.cfg.retryMs);
        this.logger.warn(`deposit check for ${src.uid} on ${src.net.label} failed: ${message(e)}`);
      }
    });
    if (full) {
      this.lastFullScan = startedAt;
      // Everything that arrived before this scan began has been looked at.
      const at = new Date(startedAt).toISOString();
      for (const n of this.nets) this.cursor.set(n.key, at);
    }
    return report;
  }

  /** Wallet ids with inbound transfers since the last read. A network that cannot be read keeps its cursor. */
  private async inboundNews(report: SweepReport): Promise<Set<string>> {
    const out = new Set<string>();
    await Promise.all(
      this.nets.map(async (net) => {
        const cursor = this.cursor.get(net.key) ?? new Date(this.lastFullScan).toISOString();
        const since = new Date(Date.parse(cursor) - INBOUND_OVERLAP_MS).toISOString();
        try {
          const r = await this.reader.inbound(net, since);
          r.walletIds.forEach((id) => out.add(id));
          this.cursor.set(net.key, r.until);
        } catch (e) {
          report.errors++;
          this.logger.warn(`inbound transfers on ${net.label} could not be read: ${message(e)}`);
        }
      }),
    );
    return out;
  }

  private minUsdc(net: DepositNetwork): bigint {
    return net.kind === 'solana' ? this.cfg.minUsdcSolRaw : this.cfg.minUsdcRaw;
  }

  private async visit(src: SourceWallet, report: SweepReport): Promise<void> {
    const { latest, open } = await this.history(src);
    if (open.length) {
      // Never a second transfer from a wallet while one is unsettled.
      const due = open.filter((a) => this.resumeDue(a));
      if (due.length) {
        report.resumed.push(...due.map((a) => a.id));
        this.spawn(src.walletId, async () => {
          for (const a of due) await this.resume(a, src);
        });
      } else {
        this.due.set(src.walletId, Math.min(...open.map((a) => Date.parse(a.updatedAt) + this.cfg.retryMs)));
      }
      return;
    }

    const bal = await this.reader.balances(src);
    if (bal.usdcRaw < this.minUsdc(src.net)) {
      this.due.delete(src.walletId);
      return;
    }

    if (latest?.status === 'failed' && latest.amountInRaw === bal.usdcRaw.toString()) {
      const retryAt = Date.parse(latest.updatedAt) + this.cfg.retryMs;
      const waited = Date.now() >= retryAt;
      const later = () => (waited ? this.due.delete(src.walletId) : this.due.set(src.walletId, retryAt));
      if (latest.error?.startsWith('needs_gas:')) {
        // Held until the gas balance goes up. Without a reading to compare
        // (sponsored gas that failed anyway) the retry window decides. A
        // top-up of ours that has not shown up by the retry window is sent
        // again, under a new action and so a new key. A hold the kit called
        // (it wanted more than DEPOSIT_MIN_SOL) is not topped up on a timer:
        // that needs the setting raised, not the same amount again.
        const legs = latest.legs as DepositLeg[];
        const seen = legs.find((l) => l.gasRaw !== undefined)?.gasRaw;
        const toppedUp = seen !== undefined && bal.gasRaw !== null ? bal.gasRaw > BigInt(seen) : waited;
        const topUpAgain = waited && this.cfg.solFunder !== null && legs.some(isTopUp);
        if (!toppedUp && !topUpAgain) {
          report.held.push(latest.id);
          later();
          return;
        }
      } else if (!waited) {
        later();
        return;
      }
    }

    // The id is the snapshot: this wallet, this balance, after that action.
    // A re-run, or a second replica, asks for the same row and finds it taken.
    const id = stableUuid('deposit', src.walletId, bal.usdcRaw.toString(), latest?.id ?? 'first');
    const { created, row } = await this.actions.create({
      id,
      uid: src.uid,
      kind: 'deposit',
      tokenIn: src.net.usdc,
      tokenOut: lower(this.config.network.usdc.address),
      amountInRaw: bal.usdcRaw,
      usdValue: Number(formatUnits(bal.usdcRaw, 6)),
    });
    if (!created) {
      this.due.set(src.walletId, 0);
      return;
    }

    const short = this.gasShortfall(src, bal);
    if (short) {
      const legs = [gasLeg(src, short, bal.gasRaw)];
      if (src.net.kind === 'solana' && this.cfg.solFunder) legs.push(await this.topUpSol(row.id, src, bal.gasRaw ?? 0n));
      await this.persist(row.id, { status: 'failed', error: short, legs });
      this.logger.warn(`deposit ${row.id} held: ${short}`);
      report.held.push(row.id);
      this.due.set(src.walletId, Date.now() + this.cfg.retryMs);
      return;
    }

    report.started.push(row.id);
    this.spawn(src.walletId, () => this.runBridge(row, src, bal.usdcRaw));
  }

  /** Solana always pays its own fees, and so does an EVM EOA. SCA gas is sponsored and not read. */
  private gasShortfall(src: SourceWallet, bal: SourceBalances): string | null {
    if (src.net.kind === 'solana') {
      const have = bal.gasRaw ?? 0n;
      return have < this.cfg.minSolLamports ? DEPOSIT_ERRORS.needsSol(have, this.cfg.minSolLamports) : null;
    }
    if (src.accountType === 'EOA' && bal.gasRaw === 0n) return DEPOSIT_ERRORS.needsEth(src.net.label);
    return null;
  }

  /**
   * Sends a Solana deposit wallet what it lacks of DEPOSIT_MIN_SOL from our
   * funder. Keyed on the action, so one held action can never pay twice.
   * The SOL cannot leave: the deposit wallet is ours and only ever burns
   * USDC, so what a top-up costs is the rent and fee of that one burn.
   */
  private async topUpSol(actionId: string, src: SourceWallet, have: bigint): Promise<DepositLeg> {
    const lamports = this.cfg.minSolLamports - have;
    const leg: DepositLeg = {
      kind: 'transfer',
      status: 'pending',
      chain: src.net.chain.chain,
      sentAt: new Date().toISOString(),
      data: { purpose: 'sol-topup', to: src.address, lamports: lamports.toString() },
    };
    try {
      const res = await this.wallets.client.createTransaction({
        walletAddress: this.cfg.solFunder!,
        blockchain: src.net.walletsBlockchain as TokenBlockchain,
        destinationAddress: src.address,
        amount: [formatUnits(lamports, 9)],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        idempotencyKey: stableUuid(actionId, 'sol-topup'),
        refId: `deposit:${actionId}`,
      });
      const circleTxId = res.data?.id;
      return { ...leg, status: 'sent', ...(circleTxId ? { circleTxId } : {}) };
    } catch (e) {
      // Loud on purpose: an empty funder holds every Solana deposit.
      this.logger.error(`SOL top-up for deposit ${actionId} failed (is the funder empty?): ${message(e)}`);
      return { ...leg, status: 'failed', error: message(e) };
    }
  }

  // ---------------------------------------------------------------- first run

  private async runBridge(action: ActionRow, src: SourceWallet, amountRaw: bigint): Promise<void> {
    const startedAt = new Date().toISOString();
    this.hookEvents();
    this.live.set(action.id, { src, startedAt });
    let result: BridgeResult;
    try {
      result = await this.circle.kit.bridge({
        from: { adapter: this.circle.adapter, chain: src.net.chain, address: src.address },
        to: { chain: this.circle.arcChain, recipientAddress: src.arcAddress, useForwarder: true },
        amount: formatUnits(amountRaw, 6),
        config: { transferSpeed: 'FAST' },
        invocationMeta: { traceId: action.id },
      });
    } catch (e) {
      this.live.delete(action.id);
      await this.whenThrown(action, src, e);
      return;
    }
    this.live.delete(action.id);
    await this.settle(action, src, result, startedAt);
  }

  /**
   * bridge() threw. It records every step failure in its result instead of
   * throwing, so a throw means validation, routing or setup, before any
   * step ran. The one exception worth guarding: a burn event already
   * recorded a hash, in which case the chain decides, as everywhere else.
   */
  private async whenThrown(action: ActionRow, src: SourceWallet, e: unknown): Promise<void> {
    await this.flushed(action.id);
    const fresh = (await this.actions.get(action.id)) ?? action;
    const legs = fresh.legs as DepositLeg[];
    const burn = legs.find((l) => l.kind === 'burn' && hashOf(l));
    if (burn) {
      if ((await this.checkBurn(fresh.id, src, legs, message(e), true)) === 'success') {
        await this.finishAfterBurn(fresh.id, src);
      }
      return;
    }
    await this.closeUnsent(fresh.id, src, legs, e, message(e));
  }

  /** Records what bridge() or retryBridge() returned and moves the status on. */
  private async settle(action: ActionRow, src: SourceWallet, result: BridgeResult, startedAt: string): Promise<void> {
    const legs = this.legsFrom(result, src, startedAt, action.legs as DepositLeg[]);
    const burn = result.steps.find((s) => s.name === 'burn');
    const failing = result.steps.find((s) => s.state === 'error');

    if (burn?.state === 'success') {
      if (result.state === 'success') {
        await this.persist(action.id, { status: 'sent', legs, error: null });
        await this.confirmArrival(action.id, src, legs);
      } else {
        const why = failing?.errorMessage ?? 'unfinished';
        this.logger.warn(`deposit ${action.id} burned, then stopped: ${why}`);
        await this.persist(action.id, { status: 'sent', legs, error: DEPOSIT_ERRORS.afterBurn(why) });
      }
      return;
    }

    if (burn?.txHash) {
      // The burn went out and did not come back a success: exactly the step
      // App Kit's retry would send again. The chain answers first.
      const outcome = await this.checkBurn(action.id, src, legs, burn.errorMessage ?? 'burn did not confirm', true);
      if (outcome === 'success') await this.finishAfterBurn(action.id, src);
      return;
    }

    const why = failing?.errorMessage ?? 'the kit returned no burn step';
    if (failing?.name === 'approve' && failing.batched) {
      await this.settleBatch(action.id, src, legs, failing, why);
      return;
    }
    // Sequential path: the approve failing means the burn never ran; so does
    // an error App Kit raises before it sends anything. Anything else might
    // have been sent.
    if (failing?.name === 'approve' || raisedBeforeSending(failing?.error) || looksLikeNoGas(failing?.error, why)) {
      await this.closeUnsent(action.id, src, legs, failing?.error, why);
      return;
    }
    await this.persist(action.id, { status: 'pending', legs, error: DEPOSIT_ERRORS.burnUnknown(why) });
    this.logger.warn(`deposit ${action.id} burn outcome unknown, the grace period decides: ${why}`);
  }

  /**
   * A batch-capable smart account sends approve and burn as ONE UserOperation
   * (App Kit's batched path). When that operation's poll fails, App Kit
   * reports only an errored 'approve' step and no burn step at all, while the
   * burn inside the same operation may still land. So a failed batched
   * approve says nothing sent only when Circle says the operation never
   * reached the chain; a hash goes to the chain; anything else waits, with
   * the batch id kept so a resume can ask Circle for the hash.
   */
  private async settleBatch(id: string, src: SourceWallet, legs: DepositLeg[], step: BridgeStep, why: string): Promise<void> {
    const t = traceOf(step.error);
    const reason = t.errorReason ? `${why} (${t.errorReason})` : why;
    if (t.kind === 'failed_offchain' || step.errorCategory === 'failed_offchain') {
      await this.closeUnsent(id, src, legs, step.error, reason);
      return;
    }
    const batchId = step.batchId ?? t.batchId;
    if (t.txHash) {
      const next = withBurnHash(legs, t.txHash, batchId, src.net.chain.chain);
      const outcome = await this.checkBurn(id, src, next, reason, true);
      if (outcome === 'success') await this.finishAfterBurn(id, src);
      return;
    }
    await this.persist(id, { status: 'pending', legs, error: DEPOSIT_ERRORS.burnUnknown(reason) });
    this.logger.warn(`deposit ${id}: batch ${batchId ?? '?'} outcome unknown, Circle and the chain decide: ${reason}`);
  }

  /** Closes an action whose burn provably moved no money: held for gas, or failed. */
  private async closeUnsent(id: string, src: SourceWallet, legs: DepositLeg[], err: unknown, why: string): Promise<void> {
    if (looksLikeNoGas(err, why)) {
      const bal = await this.reader.balances(src).catch(() => null);
      const error = DEPOSIT_ERRORS.needsGasKit(src.net.label, why);
      const gas = bal?.gasRaw != null ? { gasRaw: bal.gasRaw.toString() } : {};
      const next = legs.some((l) => l.kind === 'burn')
        ? legs.map((l) => (l.kind === 'burn' ? { ...l, status: 'failed' as const, ...gas } : l))
        : [...legs, gasLeg(src, why, bal?.gasRaw ?? null)];
      await this.persist(id, { status: 'failed', error, legs: next });
      this.logger.warn(`deposit ${id} held: ${error}`);
      return;
    }
    await this.persist(id, { status: 'failed', legs, error: DEPOSIT_ERRORS.notStarted(why) });
    this.logger.warn(`deposit ${id} did not start: ${why}`);
  }

  // ---------------------------------------------------------------- resume

  private resumeDue(a: ActionRow): boolean {
    // Pending checks are read-only until the chain decides, so every sweep may look.
    if (a.status === 'pending') return true;
    // Sent: straight away after a restart (no error yet), then once per retry window.
    return a.error === null || Date.now() - Date.parse(a.updatedAt) >= this.cfg.retryMs;
  }

  /** Picks up an action this process is not running: after a restart, or one left waiting. */
  private async resume(a: ActionRow, src: SourceWallet): Promise<void> {
    let legs = a.legs as DepositLeg[];
    let burn = legs.find((l) => l.kind === 'burn');

    if (a.status === 'sent' || burn?.status === 'confirmed') {
      if (this.pastReconcile(burn?.confirmedAt ?? a.createdAt)) {
        await this.handOver(a, DEPOSIT_ERRORS.stuckAfterBurn(this.reconcileHours, a.error ?? 'no arrival seen'));
        return;
      }
      await this.finishAfterBurn(a.id, src);
      return;
    }

    const stuck = () => this.handOver(a, DEPOSIT_ERRORS.stuckUnknown(this.reconcileHours, a.error ?? 'no burn seen'));

    if (!burn || !hashOf(burn)) {
      const found = await this.recoverBatch(a, src, legs);
      if (found === 'closed') return;
      if (found === 'wait') {
        if (this.pastReconcile(a.createdAt)) await stuck();
        return;
      }
      if (found) {
        legs = found;
        burn = legs.find((l) => l.kind === 'burn');
      }
    }

    if (burn && hashOf(burn)) {
      const outcome = await this.checkBurn(a.id, src, legs, burn.error ?? a.error ?? 'burn did not confirm', false);
      if (outcome === 'success') await this.finishAfterBurn(a.id, src);
      if (outcome !== 'unknown') return;
    }

    if (this.pastReconcile(a.createdAt)) {
      await stuck();
      return;
    }

    // No hash, or one the chain has not seen. Once the grace period is over
    // the source balance answers: all still there means no burn landed.
    if (Date.now() - Date.parse(a.createdAt) < this.cfg.graceMs) return;
    const bal = await this.reader.balances(src);
    if (bal.usdcRaw >= BigInt(a.amountInRaw ?? '0')) {
      await this.persist(a.id, { status: 'failed', error: DEPOSIT_ERRORS.burnNeverLanded });
      this.logger.warn(`deposit ${a.id}: no burn landed, a later sweep starts again`);
    } else {
      await this.persist(a.id, { status: 'failed', error: DEPOSIT_ERRORS.reconcile });
      this.logger.error(`deposit ${a.id}: ${DEPOSIT_ERRORS.reconcile}`);
    }
  }

  private get reconcileHours(): number {
    return Math.round((this.cfg.reconcileMs / 3_600_000) * 10) / 10;
  }

  private pastReconcile(since: string): boolean {
    return Date.now() - Date.parse(since) >= this.cfg.reconcileMs;
  }

  /**
   * An open deposit that has not settled in DEPOSIT_RECONCILE_SECONDS: a
   * forwarder that failed, an attestation that never came, a mint that
   * reverted. Retrying for ever would keep the wallet's slot, and so every
   * later deposit to it, blocked; closing it hands it to a person instead.
   */
  private async handOver(a: ActionRow, error: string): Promise<void> {
    await this.persist(a.id, { status: 'failed', error });
    this.logger.error(`deposit ${a.id} for ${a.uid}: ${error}`);
  }

  /**
   * A batched burn with no hash on record: Circle knows the operation by its
   * id. A hash comes back as the burn's hash, for the chain to judge; an
   * operation Circle cancelled or denied never reached the chain; one still
   * in Circle's queue waits, past the grace period too, because the balance
   * cannot yet say anything about it.
   */
  private async recoverBatch(a: ActionRow, src: SourceWallet, legs: DepositLeg[]): Promise<DepositLeg[] | 'closed' | 'wait' | null> {
    const batchId = legs.find((l) => l.batchId)?.batchId;
    if (!batchId) return null;
    const tx = await this.reader.circleTx(batchId).catch(() => null);
    if (!tx) return null;
    if (tx.txHash) {
      const next = withBurnHash(legs, tx.txHash, batchId, src.net.chain.chain);
      await this.persist(a.id, { legs: next });
      return next;
    }
    if (CIRCLE_OFFCHAIN.has(tx.state)) {
      const why = `batch ${batchId} ${tx.state}${tx.errorReason ? ` (${tx.errorReason})` : ''}`;
      await this.closeUnsent(a.id, src, legs, null, why);
      return 'closed';
    }
    return CIRCLE_IN_FLIGHT.has(tx.state) ? 'wait' : null;
  }

  /**
   * Asks the source chain about a burn that did not come back a success, and
   * records the answer. `recordUnknown` writes the waiting state the first
   * time; a resume that learns nothing new writes nothing.
   */
  private async checkBurn(
    id: string,
    src: SourceWallet,
    legs: DepositLeg[],
    why: string,
    recordUnknown: boolean,
  ): Promise<TxOutcome> {
    const burn = legs.find((l) => l.kind === 'burn');
    const hash = burn ? hashOf(burn) : null;
    if (!burn || !hash) return 'unknown';
    const outcome = await this.reader.txOutcome(src.net, hash, src.address).catch((): TxOutcome => 'unknown');
    if (outcome === 'success') {
      const now = new Date().toISOString();
      // A batched approve rode in the same operation, so it landed too.
      const sameBatch = (l: DepositLeg) => burn.batchId !== undefined && l.kind === 'approve' && l.batchId === burn.batchId;
      const next = legs.map((l) =>
        l === burn || sameBatch(l)
          ? { ...l, ...(hashOf(l) ? {} : txField(hash)), status: 'confirmed' as const, confirmedAt: now, error: undefined }
          : l,
      );
      await this.persist(id, { status: 'sent', legs: next, error: null });
      this.logger.log(`deposit ${id}: burn ${hash} confirmed on chain after the kit gave up on it`);
    } else if (outcome === 'reverted') {
      if (looksLikeNoGas(null, why)) {
        // Reverted for want of SOL or ETH: held until a top-up, not retried on a timer.
        await this.closeUnsent(id, src, legs, null, why);
        return outcome;
      }
      const next = legs.map((l) => (l === burn ? { ...l, status: 'failed' as const } : l));
      await this.persist(id, { status: 'failed', legs: next, error: DEPOSIT_ERRORS.burnReverted(why) });
    } else if (recordUnknown) {
      await this.persist(id, { status: 'pending', legs, error: DEPOSIT_ERRORS.burnUnknown(why) });
    }
    return outcome;
  }

  /** The burn has landed: check the mint's receipt, or have the kit finish (attestation, forwarder). */
  private async finishAfterBurn(id: string, src: SourceWallet): Promise<void> {
    await this.flushed(id);
    const a = await this.actions.get(id);
    if (!a || a.status === 'confirmed' || a.status === 'failed') return;
    const legs = a.legs as DepositLeg[];
    if (legs.some((l) => l.kind === 'mint' && l.status !== 'failed' && l.txHash)) {
      await this.confirmArrival(id, src, legs);
      return;
    }
    const rebuilt = this.rebuild(a, src, legs);
    if (!rebuilt) {
      // Only reached with a confirmed burn on record, so this is not
      // expected. Refuse rather than hand the kit something it would read
      // as "burn again".
      this.logger.error(`deposit ${id} has no confirmed burn step; not retrying`);
      return;
    }
    const startedAt = new Date().toISOString();
    let result: BridgeResult;
    try {
      result = await this.circle.kit.retryBridge(rebuilt, { from: this.circle.adapter });
    } catch (e) {
      await this.persist(id, { status: 'sent', error: DEPOSIT_ERRORS.afterBurn(message(e)) });
      this.logger.warn(`deposit ${id} resume failed: ${message(e)}`);
      return;
    }
    // retryBridge returns the steps it was given followed by the ones it ran.
    await this.settle(a, src, result, startedAt);
  }

  /**
   * The result bridge() would have returned, cut back to its last successful
   * step. The kit's retry reads only the last step, so after a successful
   * burn the only things it can do are fetch the attestation and wait for
   * the forwarder's mint. Null unless a successful burn with a hash is kept.
   */
  private rebuild(a: ActionRow, src: SourceWallet, legs: DepositLeg[]): BridgeResult | null {
    const steps: BridgeStep[] = legs
      .filter((l) => l.step)
      .map((l) => {
        const hash = hashOf(l);
        return {
          name: l.step!,
          state: l.status === 'confirmed' ? 'success' : l.status === 'failed' ? 'error' : 'pending',
          ...(hash ? { txHash: hash } : {}),
          ...(l.explorerUrl ? { explorerUrl: l.explorerUrl } : {}),
          ...(l.data !== undefined ? { data: l.data } : {}),
          ...(l.forwarded !== undefined ? { forwarded: l.forwarded } : {}),
        };
      });
    let end = steps.length;
    while (end > 0 && steps[end - 1].state !== 'success') end--;
    const kept = steps.slice(0, end);
    if (!kept.some((s) => s.name === 'burn' && s.state === 'success' && s.txHash)) return null;
    return {
      amount: formatUnits(BigInt(a.amountInRaw ?? '0'), 6),
      token: 'USDC',
      state: 'error',
      config: { transferSpeed: 'FAST' },
      provider: legs.find((l) => l.provider)?.provider ?? 'CCTPV2BridgingProvider',
      source: { address: src.address, chain: src.net.chain },
      destination: {
        address: src.arcAddress,
        chain: this.config.network.name === 'mainnet' ? Arc : ArcTestnet,
        recipientAddress: src.arcAddress,
        useForwarder: true,
      },
      steps: kept,
    };
  }

  /**
   * Confirmed means the mint has a successful receipt on Arc AND that
   * receipt credits the user's Arc address with USDC; the amount is what it
   * credits. A reverted mint is marked failed, so the next pass asks the kit
   * (and so the forwarder) again instead of re-reading the same hash.
   */
  private async confirmArrival(id: string, src: SourceWallet, legs: DepositLeg[]): Promise<void> {
    const mint = legs.find((l) => l.kind === 'mint' && l.status !== 'failed' && l.txHash);
    if (!mint?.txHash) return;
    let arrived: bigint | null = null;
    try {
      const receipt = await this.arc.receipt(mint.txHash as Hash);
      if (receipt.status !== 'success') {
        const next = legs.map((l) => (l === mint ? { ...l, status: 'failed' as const, error: 'reverted on Arc' } : l));
        await this.persist(id, { status: 'sent', legs: next, error: DEPOSIT_ERRORS.arrivalUnconfirmed('the mint reverted') });
        this.logger.error(`deposit ${id}: mint ${mint.txHash} reverted on Arc`);
        return;
      }
      arrived = usdcArrived(receipt.logs, this.config.network.usdc.address, src.arcAddress);
    } catch (e) {
      await this.persist(id, { status: 'sent', error: DEPOSIT_ERRORS.arrivalUnconfirmed(message(e)) });
      return;
    }
    if (arrived === null || arrived <= 0n) {
      const why = 'no USDC reached the recipient in the mint receipt';
      await this.persist(id, { status: 'sent', error: DEPOSIT_ERRORS.arrivalUnconfirmed(why) });
      this.logger.error(`deposit ${id}: mint ${mint.txHash}: ${why}`);
      return;
    }
    const now = new Date().toISOString();
    const next = legs.map((l) => (l === mint ? { ...l, status: 'confirmed' as const, confirmedAt: l.confirmedAt ?? now } : l));
    await this.persist(id, { status: 'confirmed', legs: next, amountOutRaw: arrived, error: null });
    this.logger.log(`deposit ${id} arrived on Arc for ${src.uid} from ${src.net.label}`);
  }

  // ---------------------------------------------------------------- events

  /**
   * The burn hash is written the moment the kit reports the burn, before the
   * attestation wait. A crash during that wait then resumes from a known
   * burn instead of a guess. Handlers are kit-wide; the traceId is the
   * action id, and only bridges this process has in flight are recorded.
   */
  private hookEvents(): void {
    if (this.eventsHooked) return;
    this.eventsHooked = true;
    this.circle.kit.on('bridge.burn', (payload: unknown) => this.onBurnEvent(payload));
  }

  private onBurnEvent(payload: unknown): void {
    const p = payload as { protocol?: string; traceId?: string; values?: BridgeStep } | null;
    if (!p || p.protocol !== 'cctp' || !p.traceId || !p.values?.txHash) return;
    const live = this.live.get(p.traceId);
    if (!live) return;
    const leg = legFromStep(p.values, live.src.net.chain.chain, live.startedAt);
    if (!leg) return;
    const patch: Patch = p.values.state === 'success' ? { legs: [leg], status: 'sent' } : { legs: [leg] };
    this.persist(p.traceId, patch).catch((e) =>
      this.logger.warn(`deposit ${p.traceId} burn event write failed: ${message(e)}`),
    );
  }

  // ---------------------------------------------------------------- plumbing

  private legsFrom(result: BridgeResult, src: SourceWallet, startedAt: string, before: DepositLeg[]): DepositLeg[] {
    const legs: DepositLeg[] = [];
    for (const step of result.steps) {
      const onSource = step.name === 'approve' || step.name === 'burn';
      const leg = legFromStep(step, onSource ? src.net.chain.chain : this.circle.arcChain, startedAt);
      if (!leg) continue;
      // A step handed back by a resume keeps the times it had.
      const prior = before.find((l) => l.step === step.name && hashOf(l) !== null && hashOf(l) === hashOf(leg));
      if (prior?.sentAt) leg.sentAt = prior.sentAt;
      if (prior?.confirmedAt && leg.status === 'confirmed') leg.confirmedAt = prior.confirmedAt;
      if (onSource) leg.provider = result.provider;
      legs.push(leg);
    }
    return legs;
  }

  private persist(id: string, patch: Patch): Promise<void> {
    const prev = this.writes.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.actions.update(id, patch));
    const tracked: Promise<void> = next
      .catch(() => undefined)
      .finally(() => {
        if (this.writes.get(id) === tracked) this.writes.delete(id);
      });
    this.writes.set(id, tracked);
    return next;
  }

  /** Waits for queued writes to one action, so a read after it sees them. */
  private async flushed(id: string): Promise<void> {
    await this.writes.get(id);
  }

  /** Runs work for one wallet in the background; the next sweep looks at the wallet again once it ends. */
  private spawn(walletId: string, work: () => Promise<void>): void {
    const p: Promise<void> = work()
      .catch((e) => this.logger.error(`deposit work for wallet ${walletId} failed: ${message(e)}`))
      .finally(() => {
        if (this.running.get(walletId) === p) this.running.delete(walletId);
        this.due.set(walletId, 0);
      });
    this.running.set(walletId, p);
  }

  private async sources(): Promise<SourceWallet[]> {
    const byCode = new Map(this.nets.map((n) => [n.walletsBlockchain, n]));
    const rows = await this.db.query<{
      uid: string;
      blockchain: string;
      wallet_id: string;
      address: string;
      account_type: 'EOA' | 'SCA';
      arc_address: string;
    }>(
      `SELECT d.uid, d.blockchain, d.wallet_id, d.address, d.account_type, a.address AS arc_address
         FROM circle_wallets d
         JOIN circle_wallets a ON a.uid = d.uid AND a.blockchain = $2
        WHERE d.blockchain = ANY($1::text[])
        ORDER BY d.created_at`,
      [[...byCode.keys()], this.config.network.walletsBlockchain],
    );
    return rows.flatMap((r) => {
      const net = byCode.get(r.blockchain);
      if (!net) return [];
      return [
        {
          uid: r.uid,
          net,
          walletId: r.wallet_id,
          address: net.kind === 'evm' ? r.address.toLowerCase() : r.address,
          accountType: r.account_type,
          arcAddress: lower(r.arc_address),
        },
      ];
    });
  }

  /** This wallet's latest deposit action and every unsettled one (oldest first). */
  private async history(src: SourceWallet): Promise<{ latest: ActionRow | null; open: ActionRow[] }> {
    const rows = await this.db.query<{ id: string; status: ActionStatus }>(
      `SELECT id, status FROM actions
        WHERE uid = $1 AND kind = 'deposit' AND token_in = $2
        ORDER BY created_at DESC
        LIMIT ${HISTORY}`,
      [src.uid, src.net.usdc],
    );
    const wanted = rows.filter((r, i) => i === 0 || OPEN.has(r.status));
    const found = (await Promise.all(wanted.map((r) => this.actions.get(r.id)))).filter(
      (a): a is ActionRow => a !== null,
    );
    return {
      latest: rows[0] ? (found.find((a) => a.id === rows[0].id) ?? null) : null,
      open: found.filter((a) => OPEN.has(a.status)).reverse(),
    };
  }
}

// -------------------------------------------------------------------- reader

/**
 * The live reads. Solana balances come from Circle's own index of the wallet
 * (USDC and SOL in one call, no rate-limited public RPC); EVM balances and
 * every transaction check go to the network's public RPC, or the one in
 * DEPOSIT_RPC_<NET>. The inbound feed and batch lookups are Circle's.
 */
export class LiveChainReader implements DepositChainReader {
  private readonly evm = new Map<DepositNetworkKey, PublicClient>();

  constructor(private readonly wallets: Pick<CircleWallets, 'client'>) {}

  async balances(w: SourceWallet): Promise<SourceBalances> {
    if (w.net.kind === 'solana') {
      const res = await this.wallets.client.getWalletTokenBalance({ id: w.walletId, includeAll: true });
      const list = res.data?.tokenBalances ?? [];
      const usdc = list.find((b) => b.token.tokenAddress === w.net.usdc);
      const sol = list.find((b) => b.token.isNative);
      return {
        usdcRaw: usdc ? parseUnits(usdc.amount, usdc.token.decimals ?? 6) : 0n,
        gasRaw: sol ? parseUnits(sol.amount, sol.token.decimals ?? 9) : 0n,
      };
    }
    const client = this.client(w.net);
    const owner = w.address as Address;
    const [usdcRaw, gasRaw] = await Promise.all([
      client.readContract({ address: w.net.usdc as Address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      w.accountType === 'EOA' ? client.getBalance({ address: owner }) : Promise.resolve(null),
    ]);
    return { usdcRaw, gasRaw };
  }

  /**
   * On EVM a successful receipt is not enough: a smart account's burn rides
   * inside a bundler transaction that succeeds even when the account's own
   * call reverted. The burn moved the money only if USDC left the source in
   * that receipt (depositForBurn pulls it with transferFrom). A Solana
   * transaction is atomic, so its status alone answers.
   */
  async txOutcome(net: DepositNetwork, hash: string, from: string): Promise<TxOutcome> {
    if (net.kind === 'evm') {
      let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>;
      try {
        receipt = await this.client(net).getTransactionReceipt({ hash: hash as Hash });
      } catch {
        return 'unknown';
      }
      if (receipt.status !== 'success') return 'reverted';
      return usdcLeft(receipt.logs, net.usdc, from) ? 'success' : 'reverted';
    }
    const res = await fetch(net.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignatureStatuses',
        params: [[hash], { searchTransactionHistory: true }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 'unknown';
    const body = (await res.json()) as {
      result?: { value?: Array<{ err: unknown; confirmationStatus?: string } | null> };
    };
    const s = body.result?.value?.[0];
    if (!s) return 'unknown';
    if (s.err) return 'reverted';
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'success' : 'unknown';
  }

  async circleTx(id: string): Promise<CircleTxView | null> {
    const res = await this.wallets.client.getTransaction({ id });
    const tx = res.data?.transaction;
    if (!tx) return null;
    return { state: tx.state, txHash: tx.txHash || null, errorReason: tx.errorReason ?? null };
  }

  /**
   * Oldest first from `since`, a page at a time. A burst longer than the page
   * budget stops early and says where, so the next sweep carries on from
   * there instead of skipping the rest.
   */
  async inbound(net: DepositNetwork, since: string): Promise<InboundSince> {
    const until = new Date().toISOString();
    const walletIds = new Set<string>();
    let pageAfter: string | undefined;
    for (let page = 0; page < INBOUND_MAX_PAGES; page++) {
      const res = await this.wallets.client.listTransactions({
        blockchain: net.walletsBlockchain as Blockchain,
        txType: 'INBOUND',
        includeAll: true,
        from: since,
        order: 'ASC',
        pageSize: INBOUND_PAGE,
        ...(pageAfter ? { pageAfter } : {}),
      });
      const list = res.data?.transactions ?? [];
      for (const t of list) if (t.walletId) walletIds.add(t.walletId);
      if (list.length < INBOUND_PAGE) return { walletIds, until };
      const last = list[list.length - 1];
      pageAfter = last.id;
      if (page === INBOUND_MAX_PAGES - 1) return { walletIds, until: last.createDate };
    }
    return { walletIds, until };
  }

  private client(net: DepositNetwork): PublicClient {
    let c = this.evm.get(net.key);
    if (!c) {
      const chain = defineChain({
        id: net.chainId!,
        name: net.chain.name,
        nativeCurrency: net.chain.nativeCurrency,
        rpcUrls: { default: { http: [net.rpcUrl] } },
      });
      c = createPublicClient({ chain, transport: http(net.rpcUrl, { batch: true }) }) as PublicClient;
      this.evm.set(net.key, c);
    }
    return c;
  }
}

// -------------------------------------------------------------------- helpers

const KIND: Record<string, LegKind> = {
  approve: 'approve',
  burn: 'burn',
  fetchAttestation: 'attest',
  reAttest: 'attest',
  mint: 'mint',
};

/** One App Kit step as a stored leg. A 'noop' step (Solana's approve) is not a leg. */
export function legFromStep(step: BridgeStep, chain: string, sentAt: string): DepositLeg | null {
  const kind = KIND[step.name];
  if (!kind || step.state === 'noop') return null;
  const status =
    step.state === 'success' ? 'confirmed' : step.state === 'error' ? 'failed' : step.txHash ? 'sent' : 'pending';
  const leg: DepositLeg = { kind, step: step.name, status, chain, ...(step.txHash ? txField(step.txHash) : {}) };
  if (kind === 'approve' || kind === 'burn') leg.sentAt = sentAt;
  if (status === 'confirmed') leg.confirmedAt = new Date().toISOString();
  if (step.forwarded !== undefined) leg.forwarded = step.forwarded;
  if (step.batchId) leg.batchId = step.batchId;
  if (step.explorerUrl) leg.explorerUrl = step.explorerUrl;
  if (step.data !== undefined) leg.data = toJsonSafe(step.data);
  if (step.errorMessage) leg.error = step.errorMessage;
  return leg;
}

/** Where a transaction id goes on a leg: 0x lowercase in txHash, a base58 signature as it is. */
function txField(hash: string): { txHash: string } | { signature: string } {
  return /^0x/i.test(hash) ? { txHash: hash.toLowerCase() } : { signature: hash };
}

/**
 * The legs with a burn hash learned outside App Kit's burn step (a batched
 * operation's trace, or Circle's record of it). Status 'sent': only the
 * chain's answer in checkBurn makes it a success.
 */
function withBurnHash(legs: DepositLeg[], hash: string, batchId: string | undefined, chain: string): DepositLeg[] {
  const tx = txField(hash);
  const batch = batchId ? { batchId } : {};
  if (legs.some((l) => l.kind === 'burn')) {
    return legs.map((l) => (l.kind === 'burn' ? { ...l, ...tx, ...batch } : l));
  }
  const provider = legs.find((l) => l.provider)?.provider;
  return [...legs, { kind: 'burn', step: 'burn', status: 'sent', chain, ...tx, ...batch, ...(provider ? { provider } : {}) }];
}

function isTopUp(l: DepositLeg): boolean {
  return l.kind === 'transfer' && (l.data as { purpose?: unknown } | undefined)?.purpose === 'sol-topup';
}

function gasLeg(src: SourceWallet, why: string, gasRaw: bigint | null): DepositLeg {
  return {
    kind: 'burn',
    step: 'burn',
    status: 'failed',
    chain: src.net.chain.chain,
    error: why,
    ...(gasRaw !== null ? { gasRaw: gasRaw.toString() } : {}),
  };
}

/** A leg's transaction id as its chain spells it. */
function hashOf(l: DepositLeg): string | null {
  return l.signature ?? l.txHash ?? null;
}

/** USDC that reached `to` in one Arc receipt, summed from its Transfer logs. Null when there are none. */
export function usdcArrived(logs: readonly Log[], usdc: string, to: string): bigint | null {
  const parsed = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: [...logs], strict: false });
  let sum = 0n;
  let seen = false;
  for (const l of parsed) {
    if (l.address.toLowerCase() !== usdc.toLowerCase()) continue;
    if (l.args.to?.toLowerCase() !== to.toLowerCase() || l.args.value === undefined) continue;
    sum += l.args.value;
    seen = true;
  }
  return seen ? sum : null;
}

/** Whether a source-chain receipt moved USDC out of `from`: the mark a burn leaves. */
export function usdcLeft(logs: readonly Log[], usdc: string, from: string): boolean {
  const parsed = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: [...logs], strict: false });
  return parsed.some(
    (l) =>
      l.address.toLowerCase() === usdc.toLowerCase() &&
      l.args.from?.toLowerCase() === from.toLowerCase() &&
      (l.args.value ?? 0n) > 0n,
  );
}

/**
 * App Kit's KitError, read by its shape. Every Circle package bundles its own
 * copy of the class, so instanceof is no use across them, and reading the
 * shape keeps App Kit's main entry (and the Solana stack behind it) out of
 * this file at runtime; only the chain table is imported.
 */
function kitError(err: unknown): { code: number; type: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; type?: unknown; recoverability?: unknown };
  return typeof e.code === 'number' && typeof e.type === 'string' && typeof e.recoverability === 'string'
    ? { code: e.code, type: e.type }
    : null;
}

interface BatchTrace {
  kind?: string;
  batchId?: string;
  txHash?: string;
  errorReason?: string;
}

/**
 * What the Circle Wallets adapter puts on a batch failure's KitError
 * (`cause.trace`): 'failed_offchain' for a CANCELLED or DENIED operation,
 * 'reverted_onchain' with the hash, 'unconfirmed' otherwise; a poll timeout
 * carries only the batch id.
 */
function traceOf(err: unknown): BatchTrace {
  const trace = (err as { cause?: { trace?: Record<string, unknown> } } | null)?.cause?.trace;
  if (!trace || typeof trace !== 'object') return {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    kind: str(trace.kind),
    batchId: str(trace.batchId),
    txHash: str(trace.txHash),
    errorReason: str(trace.errorReason),
  };
}

/**
 * Circle's own reason arrives underscored inside its message, "Transaction
 * <id> FAILED (INSUFFICIENT_NATIVE_TOKEN): ...", and App Kit turns only
 * "insufficient funds for gas" into 9002, so both spellings are read.
 */
const NO_GAS =
  /insufficient[ _](lamports|native[ _]token|sol\b|eth\b)|no record of a prior credit|insufficient funds for (gas|fee|rent|intrinsic)|to cover gas fees/i;

/** An error that means the source wallet cannot pay the network fee (9002 is BALANCE_INSUFFICIENT_GAS). */
function looksLikeNoGas(err: unknown, why: string): boolean {
  if (kitError(err)?.code === 9002) return true;
  const e = err as { message?: unknown } | null;
  const text = [why, typeof e?.message === 'string' ? e.message : '', traceOf(err).errorReason ?? ''].join(' ');
  return NO_GAS.test(text);
}

/** A KitError of a kind App Kit raises before it has sent anything. */
function raisedBeforeSending(err: unknown): boolean {
  const k = kitError(err);
  return k !== null && (k.type === 'INPUT' || k.type === 'BALANCE');
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}
