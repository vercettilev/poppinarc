import { Logger } from '@nestjs/common';
import type { BridgeResult, BridgeStep } from '@circle-fin/app-kit';
import { ArcTestnet, BaseSepolia, SolanaDevnet } from '@circle-fin/app-kit/chains';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Log } from 'viem';
import type { AppConfig } from '../config';
import { ARC_NETWORKS } from '../arc/network';
import { stableUuid } from '../circle/ids';
import type { ActionRow, ActionStatus } from '../trade/actions';
import type { Leg } from '../trade/types';
import {
  DEPOSIT_ERRORS,
  DepositsService,
  LiveChainReader,
  assertDepositGas,
  depositNetworks,
  legFromStep,
  loadDepositConfig,
  usdcArrived,
  usdcLeft,
  type CircleTxView,
  type DepositConfig,
  type DepositLeg,
  type InboundSince,
  type SourceBalances,
  type TxOutcome,
} from './deposits.service';

// App Kit's main entry pulls in @solana/web3.js, whose ESM-only uuid Jest
// cannot load. circle/kit.ts is loaded for real (toJsonSafe is under test);
// only the two SDK entry points behind it are stubbed.
jest.mock('@circle-fin/app-kit', () => ({ AppKit: class {} }));
jest.mock('@circle-fin/adapter-circle-wallets', () => ({ createCircleWalletsAdapter: jest.fn() }));

beforeAll(() => Logger.overrideLogger(false));

/** A KitError as App Kit builds one: an Error carrying code, type and recoverability (and a cause, when given). */
function kitError(d: { code: number; name: string; type: string; message: string; cause?: unknown }): Error {
  return Object.assign(new Error(d.message), { ...d, recoverability: 'FATAL' });
}

/*
 * Every collaborator is a fake: the ledger is an in-memory ActionsStore that
 * behaves like the real one (ON CONFLICT DO NOTHING, legs through
 * JSON.stringify with txHash lowercased), the kit and the wallets are jest
 * mocks, and the chain reader answers what each test says. No network.
 */

const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ARC_ADDR = '0xAbCdEf0000000000000000000000000000001234';
const ARC_LOWER = ARC_ADDR.toLowerCase();
const SOL_ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SIG = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
const MINT_HASH = '0xAA11bb22cc33dd44ee55ff6600778899aabbccddeeff00112233445566778899';
const MINT_HASH_2 = '0x' + 'b'.repeat(64);
const BATCH_HASH = '0x' + 'C'.repeat(64);
const SOL_WALLET = 'w-sol';
const FUNDER = 'FunDer1111111111111111111111111111111111111';
const OTHER = '0x1111111111111111111111111111111111111111';

// ---------------------------------------------------------------- fakes

type Row = ActionRow & { seq: number };

class FakeActions {
  rows = new Map<string, Row>();
  private seq = 0;

  async create(a: {
    id: string;
    uid: string;
    kind: ActionRow['kind'];
    tokenIn?: string | null;
    tokenOut?: string | null;
    amountInRaw?: bigint | null;
    usdValue?: number | null;
  }): Promise<{ created: boolean; row: ActionRow }> {
    const existing = this.rows.get(a.id);
    if (existing) return { created: false, row: clone(existing) };
    const now = new Date().toISOString();
    this.rows.set(a.id, {
      id: a.id,
      uid: a.uid,
      kind: a.kind,
      status: 'pending',
      tokenIn: a.tokenIn ?? null,
      tokenOut: a.tokenOut ?? null,
      amountInRaw: a.amountInRaw?.toString() ?? null,
      amountOutRaw: null,
      usdValue: a.usdValue ?? null,
      sourceUrl: null,
      legs: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      seq: this.seq++,
    });
    return { created: true, row: clone(this.rows.get(a.id)!) };
  }

  async get(id: string): Promise<ActionRow | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }

  async update(
    id: string,
    patch: { status?: ActionStatus; amountOutRaw?: bigint | null; legs?: Leg[]; error?: string | null },
  ): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.amountOutRaw !== undefined) r.amountOutRaw = patch.amountOutRaw?.toString() ?? null;
    // Exactly what the real store does: normalise, then JSON (which throws on a bigint).
    if (patch.legs !== undefined) {
      r.legs = JSON.parse(
        JSON.stringify(patch.legs.map((l) => (l.txHash ? { ...l, txHash: l.txHash.toLowerCase() } : l))),
      );
    }
    if (patch.error !== undefined) r.error = patch.error;
    r.updatedAt = new Date().toISOString();
  }

  /** Moves a row's clock back (its legs' too), as if it had been waiting that long. */
  age(id: string, ms: number): void {
    const r = this.rows.get(id)!;
    const back = (t: string) => new Date(Date.parse(t) - ms).toISOString();
    r.createdAt = back(r.createdAt);
    r.updatedAt = back(r.updatedAt);
    r.legs = r.legs.map((l) => ({
      ...l,
      ...(l.sentAt ? { sentAt: back(l.sentAt) } : {}),
      ...(l.confirmedAt ? { confirmedAt: back(l.confirmedAt) } : {}),
    }));
  }

  seed(row: Partial<ActionRow> & { id: string; uid: string }): void {
    const now = new Date().toISOString();
    this.rows.set(row.id, {
      kind: 'deposit',
      status: 'pending',
      tokenIn: null,
      tokenOut: ARC_USDC,
      amountInRaw: null,
      amountOutRaw: null,
      usdValue: null,
      sourceUrl: null,
      legs: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      ...row,
      seq: this.seq++,
    });
  }

  only(): Row {
    expect(this.rows.size).toBe(1);
    return [...this.rows.values()][0];
  }

  newest(): Row {
    return [...this.rows.values()].sort((a, b) => b.seq - a.seq)[0];
  }
}

function clone<T>(x: T): T {
  const { seq: _seq, ...rest } = x as T & { seq?: number };
  return JSON.parse(JSON.stringify(rest));
}

interface WalletRow {
  uid: string;
  blockchain: string;
  wallet_id: string;
  address: string;
  account_type: 'EOA' | 'SCA';
  arc_address: string;
}

function fakeDb(store: FakeActions, walletRows: WalletRow[]) {
  return {
    ready: true,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM circle_wallets')) {
        const codes = params[0] as string[];
        return walletRows.filter((r) => codes.includes(r.blockchain));
      }
      if (sql.includes('FROM actions')) {
        const uid = params[0];
        let rows = [...store.rows.values()].filter((r) => r.uid === uid && r.kind === 'deposit');
        if (sql.includes('token_in')) rows = rows.filter((r) => r.tokenIn === params[1]);
        rows.sort((a, b) => b.seq - a.seq);
        const limit = sql.includes('LIMIT $2') ? (params[1] as number) : 10;
        return rows.slice(0, limit).map((r) => ({ id: r.id, status: r.status }));
      }
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setImmediate(r));

function transferLog(token: string, to: string, value: bigint): Log {
  return {
    address: token,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { from: '0x0000000000000000000000000000000000000000', to: to as `0x${string}` },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  } as unknown as Log;
}

const burnStep = (over: Partial<BridgeStep> = {}): BridgeStep => ({
  name: 'burn',
  state: 'success',
  txHash: SIG,
  data: { txHash: SIG, status: 'success', gasUsed: 5000n, blockNumber: 123n },
  ...over,
});
const attestStep: BridgeStep = {
  name: 'fetchAttestation',
  state: 'success',
  data: { message: '0x01', attestation: '0x02', eventNonce: '0x03', cctpVersion: 2, status: 'complete' },
};
const mintStep: BridgeStep = { name: 'mint', state: 'success', txHash: MINT_HASH, forwarded: true };

function result(steps: BridgeStep[], state: BridgeResult['state'] = 'success'): BridgeResult {
  return {
    amount: '12.5',
    token: 'USDC',
    state,
    provider: 'CCTPV2BridgingProvider',
    config: { transferSpeed: 'FAST' },
    source: { address: SOL_ADDR, chain: SolanaDevnet },
    destination: { address: ARC_LOWER, chain: ArcTestnet, recipientAddress: ARC_LOWER, useForwarder: true },
    steps,
  };
}

// fullScanMs 0: every sweep reads every wallet, so each test sees every
// wallet on every sweep; the feed-driven sweep has tests of its own.
const CFG: DepositConfig = {
  networks: ['SOL'],
  minUsdcRaw: 1_000_000n,
  minUsdcSolRaw: 1_000_000n,
  sweepMs: 20_000,
  minSolLamports: 5_000_000n,
  solFunder: FUNDER,
  retryMs: 300_000,
  graceMs: 600_000,
  reconcileMs: 6 * 3_600_000,
  fullScanMs: 0,
  rpc: {},
};

const SOL_ROW: WalletRow = {
  uid: 'u1',
  blockchain: 'SOL-DEVNET',
  wallet_id: SOL_WALLET,
  address: SOL_ADDR,
  account_type: 'EOA',
  arc_address: ARC_ADDR,
};

const BASE_ROW: WalletRow = {
  uid: 'u2',
  blockchain: 'BASE-SEPOLIA',
  wallet_id: 'w-base',
  address: ARC_ADDR,
  account_type: 'SCA',
  arc_address: ARC_ADDR,
};

function setup(
  opts: {
    cfg?: Partial<DepositConfig>;
    walletRows?: WalletRow[];
    store?: FakeActions;
    accountType?: 'EOA' | 'SCA';
  } = {},
) {
  const store = opts.store ?? new FakeActions();
  const db = fakeDb(store, opts.walletRows ?? [SOL_ROW]);
  const handlers: Record<string, Array<(p: unknown) => void>> = {};
  const kit = {
    bridge: jest.fn(),
    retryBridge: jest.fn(),
    on: jest.fn((name: string, h: (p: unknown) => void) => {
      (handlers[name] ??= []).push(h);
    }),
  };
  const adapter = { adapter: 'circle-wallets' };
  const circle = { kit, adapter, arcChain: 'Arc_Testnet', solanaChain: 'Solana_Devnet' };
  const client = {
    createTransaction: jest.fn(async (_input: Record<string, unknown>) => ({ data: { id: 'topup-tx', state: 'INITIATED' } })),
  };
  const wallets = {
    configured: true,
    client,
    ensureArcWallet: jest.fn(async (uid: string) => ({ uid, blockchain: 'ARC-TESTNET', walletId: 'w-arc', address: ARC_ADDR, accountType: 'EOA' })),
    ensureSolanaDepositWallet: jest.fn(async (uid: string) => ({ uid, blockchain: 'SOL-DEVNET', walletId: SOL_WALLET, address: SOL_ADDR, accountType: 'EOA' })),
    ensureEvmDepositWallet: jest.fn(async (uid: string, blockchain: string) => ({ uid, blockchain, walletId: `w-${blockchain}`, address: ARC_ADDR, accountType: 'EOA' })),
  };
  const arc = {
    receipt: jest.fn(async () => ({ status: 'success' as const, logs: [transferLog(ARC_USDC, ARC_LOWER, 12_400_000n)] })),
  };
  const balances: { current: SourceBalances } = { current: { usdcRaw: 12_500_000n, gasRaw: 10_000_000n } };
  const reader = {
    balances: jest.fn(async () => balances.current),
    txOutcome: jest.fn(async (): Promise<TxOutcome> => 'unknown'),
    circleTx: jest.fn(async (): Promise<CircleTxView | null> => null),
    inbound: jest.fn(async (): Promise<InboundSince> => ({ walletIds: new Set<string>(), until: new Date().toISOString() })),
  };
  const config = {
    network: ARC_NETWORKS.testnet,
    circle: { accountType: opts.accountType ?? 'SCA' },
  } as unknown as AppConfig;
  const service = new DepositsService(
    config,
    db as never,
    wallets as never,
    circle as never,
    store as never,
    arc as never,
    { ...CFG, ...opts.cfg },
    reader,
  );
  const emit = (name: string, payload: unknown) => (handlers[name] ?? []).forEach((h) => h(payload));
  return { service, store, db, kit, adapter, wallets, client, arc, reader, balances, emit };
}

const firstId = (usdcRaw: string, after = 'first', wallet = SOL_WALLET) => stableUuid('deposit', wallet, usdcRaw, after);

// ---------------------------------------------------------------- config

describe('loadDepositConfig', () => {
  it('defaults to Arc alone, and to timings that leave the chain time to answer', () => {
    const c = loadDepositConfig({});
    expect(c).toMatchObject({
      networks: [],
      minUsdcRaw: 1_000_000n,
      minUsdcSolRaw: 5_000_000n,
      sweepMs: 20_000,
      minSolLamports: 5_000_000n,
      solFunder: null,
      retryMs: 300_000,
      graceMs: 600_000,
      reconcileMs: 21_600_000,
      fullScanMs: 3_600_000,
    });
  });

  it('reads names or codes in order, "none", and treats a placeholder as unset', () => {
    expect(loadDepositConfig({ DEPOSIT_NETWORKS: 'solana, base,ETH,base' }).networks).toEqual(['SOL', 'BASE', 'ETH']);
    expect(loadDepositConfig({ DEPOSIT_NETWORKS: 'SOL,polygon,MATIC,arb' }).networks).toEqual(['SOL', 'POLYGON', 'ARB']);
    expect(loadDepositConfig({ DEPOSIT_SOL_FUNDER: 'auto' }).solFunder).toBe('auto');
    expect(loadDepositConfig({ DEPOSIT_NETWORKS: 'none' }).networks).toEqual([]);
    expect(loadDepositConfig({ DEPOSIT_NETWORKS: '<networks>' }).networks).toEqual([]);
    expect(
      loadDepositConfig({
        DEPOSIT_MIN_USDC: '2.5',
        DEPOSIT_SWEEP_SECONDS: '0',
        DEPOSIT_FULL_SCAN_SECONDS: '0',
        DEPOSIT_SOL_FUNDER: FUNDER,
      }),
    ).toMatchObject({ minUsdcRaw: 2_500_000n, sweepMs: 0, fullScanMs: 0, solFunder: FUNDER });
  });

  it('refuses what it cannot read at boot', () => {
    expect(() => loadDepositConfig({ DEPOSIT_NETWORKS: 'SOL,dogechain' })).toThrow(/dogechain/);
    expect(() => loadDepositConfig({ DEPOSIT_MIN_USDC: 'lots' })).toThrow(/DEPOSIT_MIN_USDC/);
    expect(() => loadDepositConfig({ DEPOSIT_MIN_USDC: '0' })).toThrow(/above zero/);
    expect(() => loadDepositConfig({ DEPOSIT_SWEEP_SECONDS: '-1' })).toThrow(/DEPOSIT_SWEEP_SECONDS/);
    expect(() => loadDepositConfig({ DEPOSIT_SOL_FUNDER: '0xabc' })).toThrow(/DEPOSIT_SOL_FUNDER/);
  });

  it('refuses a grace period or retry window short enough to guess wrong about a burn', () => {
    expect(() => loadDepositConfig({ DEPOSIT_GRACE_SECONDS: '0' })).toThrow(/DEPOSIT_GRACE_SECONDS/);
    expect(() => loadDepositConfig({ DEPOSIT_GRACE_SECONDS: '179' })).toThrow(/DEPOSIT_GRACE_SECONDS/);
    expect(() => loadDepositConfig({ DEPOSIT_RETRY_SECONDS: '0' })).toThrow(/DEPOSIT_RETRY_SECONDS/);
    expect(() => loadDepositConfig({ DEPOSIT_RECONCILE_SECONDS: '600' })).toThrow(/DEPOSIT_RECONCILE_SECONDS/);
    expect(loadDepositConfig({ DEPOSIT_GRACE_SECONDS: '180', DEPOSIT_RETRY_SECONDS: '60' })).toMatchObject({
      graceMs: 180_000,
      retryMs: 60_000,
    });
  });
});

describe('assertDepositGas', () => {
  const cfg = (networks: DepositConfig['networks'], solFunder: string | null = null) => ({ ...CFG, networks, solFunder });

  it('refuses Solana without a funder, and takes EVM networks whatever the Arc wallet is', () => {
    expect(() => assertDepositGas(cfg(['SOL']), 'SCA')).toThrow(/DEPOSIT_SOL_FUNDER/);
    // EVM deposit wallets are smart accounts even for EOA users (Gas Station pays).
    expect(() => assertDepositGas(cfg(['BASE', 'ETH', 'POLYGON']), 'EOA')).not.toThrow();
    expect(() => assertDepositGas(cfg(['SOL', 'BASE'], FUNDER), 'SCA')).not.toThrow();
    expect(() => assertDepositGas(cfg(['SOL'], 'auto'), 'EOA')).not.toThrow();
    expect(() => assertDepositGas(cfg([]), 'EOA')).not.toThrow();
  });

  it('is checked when the service is built, so a bad deploy stops at boot', () => {
    expect(() => setup({ cfg: { solFunder: null } })).toThrow(/DEPOSIT_SOL_FUNDER/);
    expect(() => setup({ cfg: { networks: ['ARB'] }, accountType: 'EOA' })).not.toThrow();
  });
});

// ---------------------------------------------------------------- addresses

describe('depositAddresses', () => {
  it('lists Arc first, then each network in order, 0x lowercase and base58 untouched', async () => {
    const { service, wallets } = setup({ cfg: { networks: ['SOL', 'BASE', 'ETH'] } });
    wallets.ensureArcWallet.mockImplementation(async (uid: string) => ({
      uid,
      blockchain: 'ARC-TESTNET',
      walletId: 'w-arc',
      address: ARC_ADDR,
      accountType: 'SCA',
    }));
    wallets.ensureEvmDepositWallet.mockImplementation(async (uid: string, blockchain: string) => {
      if (blockchain === 'ETH-SEPOLIA') throw new Error('derive failed');
      return { uid, blockchain, walletId: `w-${blockchain}`, address: ARC_ADDR, accountType: 'EOA' };
    });
    const out = await service.depositAddresses('u1');
    expect(out).toEqual({
      arc: { network: 'Arc', address: ARC_LOWER },
      others: [
        { network: 'Solana', address: SOL_ADDR, minUsdcRaw: '1000000' },
        { network: 'Base', address: ARC_LOWER, minUsdcRaw: '1000000' },
      ],
    });
    expect(wallets.ensureEvmDepositWallet).toHaveBeenCalledWith('u1', 'BASE-SEPOLIA');
    expect(wallets.ensureEvmDepositWallet).toHaveBeenCalledWith('u1', 'ETH-SEPOLIA');
  });

  it('gives a user whose Arc wallet is an EOA an address on every EVM network too', async () => {
    const { service, wallets } = setup({ cfg: { networks: ['BASE', 'SOL', 'POLYGON'] } });
    wallets.ensureEvmDepositWallet.mockImplementation(async (uid: string, blockchain: string) => ({
      uid,
      blockchain,
      walletId: `w-${blockchain}`,
      address: '0x' + blockchain.length.toString(16).padStart(40, '0'),
      accountType: 'SCA',
    }));
    const out = await service.depositAddresses('u1');
    expect(out.others.map((o) => o.network)).toEqual(['Base', 'Solana', 'Polygon']);
    expect(wallets.ensureEvmDepositWallet).toHaveBeenCalledWith('u1', 'BASE-SEPOLIA');
    expect(wallets.ensureEvmDepositWallet).toHaveBeenCalledWith('u1', 'MATIC-AMOY');
  });

  it('is Arc alone when no other network is enabled', async () => {
    const { service, wallets } = setup({ cfg: { networks: [] } });
    expect(await service.depositAddresses('u1')).toEqual({ arc: { network: 'Arc', address: ARC_LOWER }, others: [] });
    expect(wallets.ensureSolanaDepositWallet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- sweep

describe('sweepOnce', () => {
  it('moves a Solana balance to Arc through the forwarder, once, and confirms it from the Arc receipt', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(result([{ name: 'approve', state: 'noop' }, burnStep(), attestStep, mintStep]));

    const report = await t.service.sweepOnce();
    await t.service.idle();

    const id = firstId('12500000');
    expect(report.started).toEqual([id]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
    expect(t.kit.bridge).toHaveBeenCalledWith({
      from: { adapter: t.adapter, chain: SolanaDevnet, address: SOL_ADDR },
      to: { chain: 'Arc_Testnet', recipientAddress: ARC_LOWER, useForwarder: true },
      amount: '12.5',
      config: { transferSpeed: 'FAST' },
      invocationMeta: { traceId: id },
    });

    const row = t.store.only();
    expect(row).toMatchObject({
      id,
      uid: 'u1',
      kind: 'deposit',
      status: 'confirmed',
      tokenIn: SolanaDevnet.usdcAddress,
      tokenOut: ARC_USDC,
      amountInRaw: '12500000',
      amountOutRaw: '12400000',
      error: null,
    });
    const legs = row.legs as DepositLeg[];
    expect(legs.map((l) => [l.kind, l.status])).toEqual([
      ['burn', 'confirmed'],
      ['attest', 'confirmed'],
      ['mint', 'confirmed'],
    ]);
    // The signature keeps its case and stays out of txHash; bigints became strings.
    expect(legs[0]).toMatchObject({ signature: SIG, chain: 'Solana_Devnet', provider: 'CCTPV2BridgingProvider' });
    expect(legs[0].txHash).toBeUndefined();
    expect(legs[0].data).toMatchObject({ gasUsed: '5000', blockNumber: '123' });
    expect(legs[2]).toMatchObject({ txHash: MINT_HASH.toLowerCase(), forwarded: true, chain: 'Arc_Testnet' });
    expect(t.arc.receipt).toHaveBeenCalledWith(MINT_HASH.toLowerCase());

    // The money has left: the next sweep sees an empty wallet and does nothing.
    t.balances.current = { usdcRaw: 0n, gasRaw: 6_000_000n };
    const again = await t.service.sweepOnce();
    await t.service.idle();
    expect(again.started).toEqual([]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
  });

  it('leaves balances under the minimum alone', async () => {
    const t = setup();
    t.balances.current = { usdcRaw: 999_999n, gasRaw: 10_000_000n };
    const report = await t.service.sweepOnce();
    expect(report).toMatchObject({ scanned: 1, started: [], held: [] });
    expect(t.store.rows.size).toBe(0);
    expect(t.kit.bridge).not.toHaveBeenCalled();
  });

  it('does not start a second transfer while the first is still running', async () => {
    const t = setup();
    const gate = deferred<BridgeResult>();
    t.kit.bridge.mockReturnValue(gate.promise);

    await t.service.sweepOnce();
    await t.service.sweepOnce();
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);

    gate.resolve(result([burnStep(), attestStep, mintStep]));
    await t.service.idle();
    expect(t.store.only().status).toBe('confirmed');
  });

  it('two replicas sweeping the same wallet at once start one transfer', async () => {
    const store = new FakeActions();
    const a = setup({ store });
    const b = setup({ store });
    for (const t of [a, b]) t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));

    await Promise.all([a.service.sweepOnce(), b.service.sweepOnce()]);
    await Promise.all([a.service.idle(), b.service.idle()]);

    expect(a.kit.bridge.mock.calls.length + b.kit.bridge.mock.calls.length).toBe(1);
    expect(store.only().status).toBe('confirmed');
  });

  it('shares one pass between callers that arrive while it runs', async () => {
    const t = setup();
    t.balances.current = { usdcRaw: 0n, gasRaw: 0n };
    const p1 = t.service.sweepOnce();
    const p2 = t.service.sweepOnce();
    expect(p2).toBe(p1);
    await p1;
    expect(t.reader.balances).toHaveBeenCalledTimes(1);
  });

  it('records the burn the moment the kit reports it, before the attestation wait', async () => {
    const t = setup();
    const gate = deferred<void>();
    const id = firstId('12500000');
    t.kit.bridge.mockImplementation(async () => {
      t.emit('bridge.burn', { protocol: 'cctp', version: 'v2', method: 'burn', traceId: id, values: burnStep() });
      await gate.promise;
      return result([burnStep(), attestStep, mintStep]);
    });

    await t.service.sweepOnce();
    await tick();
    await tick();
    const mid = t.store.only();
    expect(mid.status).toBe('sent');
    expect((mid.legs as DepositLeg[])[0]).toMatchObject({ kind: 'burn', status: 'confirmed', signature: SIG });

    // An event for someone else's trace is ignored.
    t.emit('bridge.burn', { protocol: 'cctp', traceId: 'not-ours', values: burnStep() });

    gate.resolve();
    await t.service.idle();
    expect(t.store.only().status).toBe('confirmed');
  });

  it('holds a Solana wallet with too little SOL, tops it up once from the funder, then moves it', async () => {
    const t = setup();
    t.balances.current = { usdcRaw: 12_500_000n, gasRaw: 1_000_000n };

    const first = await t.service.sweepOnce();
    const row = t.store.only();
    expect(first.held).toEqual([row.id]);
    expect(row.status).toBe('failed');
    expect(row.error).toBe(DEPOSIT_ERRORS.needsSol(1_000_000n, 5_000_000n));
    const legs = row.legs as DepositLeg[];
    expect(legs[0]).toMatchObject({ kind: 'burn', status: 'failed', gasRaw: '1000000' });
    expect(legs[1]).toMatchObject({ kind: 'transfer', status: 'sent', circleTxId: 'topup-tx', chain: 'Solana_Devnet' });
    expect(t.kit.bridge).not.toHaveBeenCalled();

    // What it lacks of the minimum, from our funder, keyed on the action.
    expect(t.client.createTransaction).toHaveBeenCalledTimes(1);
    expect(t.client.createTransaction).toHaveBeenCalledWith({
      walletAddress: FUNDER,
      blockchain: 'SOL-DEVNET',
      destinationAddress: SOL_ADDR,
      amount: ['0.004'],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: stableUuid(row.id, 'sol-topup'),
      refId: `deposit:${row.id}`,
    });

    // Same balances, many sweeps inside the retry window: no new rows, no second top-up, no bridge.
    for (let i = 0; i < 3; i++) {
      const r = await t.service.sweepOnce();
      expect(r.held).toEqual([row.id]);
    }
    expect(t.store.rows.size).toBe(1);
    expect(t.client.createTransaction).toHaveBeenCalledTimes(1);

    // SOL arrives: one new attempt, chained after the held one.
    t.balances.current = { usdcRaw: 12_500_000n, gasRaw: 5_000_000n };
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    const after = await t.service.sweepOnce();
    await t.service.idle();
    expect(after.started).toEqual([firstId('12500000', row.id)]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
    expect(t.store.newest().status).toBe('confirmed');
    expect(t.client.createTransaction).toHaveBeenCalledTimes(1);
  });

  it('sends a top-up again when the last one has not shown up by the retry window, under a new key', async () => {
    const t = setup();
    t.balances.current = { usdcRaw: 12_500_000n, gasRaw: 0n };
    t.client.createTransaction.mockRejectedValueOnce(new Error('insufficient balance in the funder'));
    await t.service.sweepOnce();
    const first = t.store.only();
    expect((first.legs as DepositLeg[])[1]).toMatchObject({ kind: 'transfer', status: 'failed' });

    t.store.age(first.id, CFG.retryMs + 1);
    const r = await t.service.sweepOnce();
    const second = t.store.newest();
    expect(second.id).toBe(firstId('12500000', first.id));
    expect(r.held).toEqual([second.id]);
    expect(t.client.createTransaction).toHaveBeenCalledTimes(2);
    const keys = t.client.createTransaction.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toEqual([stableUuid(first.id, 'sol-topup'), stableUuid(second.id, 'sol-topup')]);
    expect(t.client.createTransaction.mock.calls[1][0]).toMatchObject({ amount: ['0.005'] });
    expect(t.kit.bridge).not.toHaveBeenCalled();
  });

  it('holds on the kit reporting no gas, and waits for a top-up', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(
      result(
        [
          {
            name: 'burn',
            state: 'error',
            errorMessage: 'Insufficient SOL on Solana_Devnet to cover gas fees',
            error: kitError({
              code: 9002,
              name: 'BALANCE_INSUFFICIENT_GAS',
              type: 'BALANCE',
              message: 'Insufficient SOL on Solana_Devnet to cover gas fees',
            }),
          },
        ],
        'error',
      ),
    );
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/^needs_gas:/);
    t.store.age(row.id, CFG.retryMs * 2);
    const r = await t.service.sweepOnce();
    expect(r.held).toEqual([row.id]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
  });

  it('never burns again when a burn marked error has landed: it finishes through retry from the burn', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(
      result([burnStep({ state: 'error', errorMessage: 'Timed out waiting for transaction', data: undefined })], 'error'),
    );
    t.reader.txOutcome.mockResolvedValue('success');
    t.kit.retryBridge.mockImplementation(async (r: BridgeResult) => ({
      ...r,
      state: 'success',
      steps: [...r.steps, attestStep, mintStep],
    }));

    await t.service.sweepOnce();
    await t.service.idle();

    expect(t.reader.txOutcome).toHaveBeenCalledWith(expect.objectContaining({ key: 'SOL' }), SIG, SOL_ADDR);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
    expect(t.kit.retryBridge).toHaveBeenCalledTimes(1);
    const [rebuilt, ctx] = t.kit.retryBridge.mock.calls[0] as [BridgeResult, unknown];
    expect(ctx).toEqual({ from: t.adapter });
    expect(rebuilt.steps).toEqual([expect.objectContaining({ name: 'burn', state: 'success', txHash: SIG })]);
    expect(rebuilt).toMatchObject({
      amount: '12.5',
      token: 'USDC',
      provider: 'CCTPV2BridgingProvider',
      config: { transferSpeed: 'FAST' },
      source: { address: SOL_ADDR, chain: SolanaDevnet },
      destination: { address: ARC_LOWER, chain: ArcTestnet, recipientAddress: ARC_LOWER, useForwarder: true },
    });
    expect(t.store.only()).toMatchObject({ status: 'confirmed', amountOutRaw: '12400000' });
  });

  it('a burn the chain reverted closes the action, and the next try waits for the retry window', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(
      result([burnStep({ state: 'error', errorMessage: 'custom program error: 0x1', data: undefined })], 'error'),
    );
    t.reader.txOutcome.mockResolvedValue('reverted');

    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/^burn_reverted:/);
    expect(t.kit.retryBridge).not.toHaveBeenCalled();

    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);

    t.store.age(row.id, CFG.retryMs + 1);
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    const r = await t.service.sweepOnce();
    await t.service.idle();
    expect(r.started).toEqual([firstId('12500000', row.id)]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(2);
  });

  it('an unexplained failure with no burn hash waits out the grace period, then the balance decides', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(
      result([{ name: 'burn', state: 'error', errorMessage: 'socket hang up', error: new Error('socket hang up') }], 'error'),
    );

    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row.status).toBe('pending');
    expect(row.error).toMatch(/^burn_unknown:/);

    // Inside the grace period: looked at, nothing sent, nothing decided.
    const inside = await t.service.sweepOnce();
    await t.service.idle();
    expect(inside.resumed).toEqual([row.id]);
    expect(t.store.only().status).toBe('pending');

    // After it, with the money all still there: no burn landed.
    t.store.age(row.id, CFG.graceMs + 1);
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.store.only()).toMatchObject({ status: 'failed', error: DEPOSIT_ERRORS.burnNeverLanded });
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
    expect(t.kit.retryBridge).not.toHaveBeenCalled();
  });

  it('marks for a person, never re-burns, when the balance dropped with no hash on record', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(result([{ name: 'burn', state: 'error', errorMessage: 'fetch failed' }], 'error'));
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();

    t.store.age(row.id, CFG.graceMs + 1);
    t.balances.current = { usdcRaw: 0n, gasRaw: 6_000_000n };
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.store.only()).toMatchObject({ status: 'failed', error: DEPOSIT_ERRORS.reconcile });
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
  });

  it('a KitError raised before anything was sent closes the action at once', async () => {
    const t = setup();
    t.kit.bridge.mockRejectedValue(
      kitError({ code: 1003, name: 'INPUT_UNSUPPORTED_ROUTE', type: 'INPUT', message: 'Route not supported' }),
    );
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.store.only()).toMatchObject({ status: 'failed', error: DEPOSIT_ERRORS.notStarted('Route not supported') });
  });

  it('resumes a sent deposit after a restart from its recorded burn, without burning again', async () => {
    const t = setup();
    const id = firstId('12500000');
    t.store.seed({
      id,
      uid: 'u1',
      status: 'sent',
      tokenIn: SolanaDevnet.usdcAddress,
      amountInRaw: '12500000',
      legs: [
        { kind: 'burn', step: 'burn', status: 'confirmed', chain: 'Solana_Devnet', signature: SIG, provider: 'CCTPV2BridgingProvider' },
      ] as DepositLeg[],
    });
    t.kit.retryBridge.mockImplementation(async (r: BridgeResult) => ({
      ...r,
      state: 'success',
      steps: [...r.steps, attestStep, mintStep],
    }));

    const report = await t.service.sweepOnce();
    await t.service.idle();

    expect(report.resumed).toEqual([id]);
    expect(t.kit.bridge).not.toHaveBeenCalled();
    expect(t.reader.balances).not.toHaveBeenCalled();
    const [rebuilt] = t.kit.retryBridge.mock.calls[0] as [BridgeResult];
    expect(rebuilt.steps).toEqual([{ name: 'burn', state: 'success', txHash: SIG }]);
    expect(t.store.only()).toMatchObject({ status: 'confirmed', amountOutRaw: '12400000' });
  });

  it('after the burn, a failed attestation or mint is retried on the window, never from the burn', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(
      result([burnStep(), { name: 'fetchAttestation', state: 'error', errorMessage: 'attestation timed out' }], 'error'),
    );
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row).toMatchObject({ status: 'sent', error: DEPOSIT_ERRORS.afterBurn('attestation timed out') });

    // Within the retry window: left alone.
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.kit.retryBridge).not.toHaveBeenCalled();

    t.store.age(row.id, CFG.retryMs + 1);
    t.kit.retryBridge.mockImplementation(async (r: BridgeResult) => ({ ...r, state: 'success', steps: [...r.steps, attestStep, mintStep] }));
    await t.service.sweepOnce();
    await t.service.idle();
    const [rebuilt] = t.kit.retryBridge.mock.calls[0] as [BridgeResult];
    // The errored attestation is cut off, so the kit's next step is the attestation again.
    expect(rebuilt.steps.map((s) => [s.name, s.state])).toEqual([['burn', 'success']]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
    expect(t.store.only().status).toBe('confirmed');
  });

  it('keeps a deposit sent until the Arc receipt says the mint succeeded', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    t.arc.receipt.mockRejectedValueOnce(new Error('receipt timeout'));
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row.status).toBe('sent');
    expect(row.error).toMatch(/^arrival_unconfirmed:/);

    t.store.age(row.id, CFG.retryMs + 1);
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.kit.retryBridge).not.toHaveBeenCalled();
    expect(t.store.only()).toMatchObject({ status: 'confirmed', amountOutRaw: '12400000' });
  });

  it('bridges from an EVM smart account without reading gas, and holds an EOA with no ETH', async () => {
    const baseRow = BASE_ROW;
    const sca = setup({ cfg: { networks: ['BASE'] }, walletRows: [baseRow] });
    sca.balances.current = { usdcRaw: 5_000_000n, gasRaw: null };
    sca.kit.bridge.mockResolvedValue({
      ...result([{ name: 'approve', state: 'success', txHash: '0x' + '1'.repeat(64) }, burnStep({ txHash: '0x' + '2'.repeat(64) }), attestStep, mintStep]),
      source: { address: ARC_LOWER, chain: BaseSepolia },
    });
    await sca.service.sweepOnce();
    await sca.service.idle();
    expect(sca.kit.bridge).toHaveBeenCalledWith(
      expect.objectContaining({ from: { adapter: sca.adapter, chain: BaseSepolia, address: ARC_LOWER }, amount: '5' }),
    );
    const row = sca.store.only();
    expect(row.tokenIn).toBe(BaseSepolia.usdcAddress.toLowerCase());
    expect((row.legs as DepositLeg[]).map((l) => l.kind)).toEqual(['approve', 'burn', 'attest', 'mint']);
    expect((row.legs as DepositLeg[])[1]).toMatchObject({ txHash: '0x' + '2'.repeat(64), chain: 'Base_Sepolia' });

    const eoa = setup({ cfg: { networks: ['BASE'] }, walletRows: [{ ...baseRow, account_type: 'EOA' }] });
    eoa.balances.current = { usdcRaw: 5_000_000n, gasRaw: 0n };
    const r = await eoa.service.sweepOnce();
    expect(r.held).toHaveLength(1);
    expect(eoa.store.only().error).toBe(DEPOSIT_ERRORS.needsEth('Base'));
    expect(eoa.kit.bridge).not.toHaveBeenCalled();
  });

  it('holds on Circle\'s own INSUFFICIENT_NATIVE_TOKEN failure instead of retrying on a timer', async () => {
    const t = setup({ cfg: { networks: ['BASE'] }, walletRows: [{ ...BASE_ROW, account_type: 'EOA' }] });
    // A little ETH: past our own pre-check, short of what the approve costs.
    t.balances.current = { usdcRaw: 5_000_000n, gasRaw: 1n };
    const why = 'Transaction 5e1f FAILED (INSUFFICIENT_NATIVE_TOKEN): not enough ETH for gas';
    t.kit.bridge.mockResolvedValue({
      ...result([{ name: 'approve', state: 'error', errorMessage: why, error: new Error(why) }], 'error'),
      source: { address: ARC_LOWER, chain: BaseSepolia },
    });
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row).toMatchObject({ status: 'failed', error: DEPOSIT_ERRORS.needsGasKit('Base', why) });
    expect((row.legs as DepositLeg[]).find((l) => l.gasRaw !== undefined)?.gasRaw).toBe('1');

    // Past the retry window with the same ETH: still held, no new transaction.
    t.store.age(row.id, CFG.retryMs + 1);
    const r = await t.service.sweepOnce();
    expect(r.held).toEqual([row.id]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
    expect(t.store.rows.size).toBe(1);
  });

  it('does nothing without Circle keys', async () => {
    const t = setup();
    (t.service as unknown as { wallets: { configured: boolean } }).wallets.configured = false;
    expect(await t.service.sweepOnce()).toEqual({ full: false, scanned: 0, started: [], resumed: [], held: [], errors: 0 });
    expect(t.db.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- smart account batches

describe('batched approve and burn (smart account)', () => {
  const batchResult = (step: BridgeStep): BridgeResult => ({
    ...result([step], 'error'),
    source: { address: ARC_LOWER, chain: BaseSepolia },
  });
  const onBase = () => {
    const t = setup({ cfg: { networks: ['BASE'] }, walletRows: [BASE_ROW] });
    t.balances.current = { usdcRaw: 5_000_000n, gasRaw: null };
    return t;
  };

  it('never reads a batch whose poll ran out as nothing sent: Circle and then the chain decide', async () => {
    const t = onBase();
    // What App Kit returns when Circle's poll budget runs out: only an
    // errored approve, no burn step, although the burn is in the same operation.
    t.kit.bridge.mockResolvedValue(
      batchResult({
        name: 'approve',
        state: 'error',
        batched: true,
        batchId: 'b-1',
        errorMessage: 'No receipt returned for approve in batch b-1.',
        errorCategory: 'polling_timeout',
        error: kitError({
          code: 3002,
          name: 'NETWORK_TIMEOUT',
          type: 'NETWORK',
          message: 'Batched UserOperation b-1 did not confirm within 60 polls.',
          cause: { trace: { batchId: 'b-1' } },
        }),
      }),
    );
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row.status).toBe('pending');
    expect(row.error).toMatch(/^burn_unknown:/);
    expect((row.legs as DepositLeg[])[0]).toMatchObject({ kind: 'approve', status: 'failed', batchId: 'b-1' });

    // Still in Circle's queue: the grace period passing decides nothing, and nothing is re-sent.
    t.reader.circleTx.mockResolvedValue({ state: 'QUEUED', txHash: null, errorReason: null });
    t.store.age(row.id, CFG.graceMs + 1);
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.store.only().status).toBe('pending');
    expect(t.reader.circleTx).toHaveBeenCalledWith('b-1');
    expect(t.reader.balances).toHaveBeenCalledTimes(1);

    // It landed: Circle has the hash, the chain says USDC left, the kit finishes from the burn.
    t.reader.circleTx.mockResolvedValue({ state: 'COMPLETE', txHash: BATCH_HASH, errorReason: null });
    t.reader.txOutcome.mockResolvedValue('success');
    t.kit.retryBridge.mockImplementation(async (r: BridgeResult) => ({
      ...r,
      state: 'success',
      steps: [...r.steps, attestStep, mintStep],
    }));
    await t.service.sweepOnce();
    await t.service.idle();
    const hash = BATCH_HASH.toLowerCase();
    expect(t.reader.txOutcome).toHaveBeenCalledWith(expect.objectContaining({ key: 'BASE' }), hash, ARC_LOWER);
    const [rebuilt] = t.kit.retryBridge.mock.calls[0] as [BridgeResult];
    expect(rebuilt.steps.map((s) => [s.name, s.state, s.txHash])).toEqual([
      ['approve', 'success', hash],
      ['burn', 'success', hash],
    ]);
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
    expect(t.store.only()).toMatchObject({ status: 'confirmed', amountOutRaw: '12400000' });
  });

  it('a batch Circle denied never reached the chain, so it closes at once', async () => {
    const t = onBase();
    t.kit.bridge.mockResolvedValue(
      batchResult({
        name: 'approve',
        state: 'error',
        batched: true,
        batchId: 'b-2',
        errorMessage: 'No receipt returned for approve in batch b-2.',
        errorCategory: 'unknown',
        error: kitError({
          code: 4001,
          name: 'RPC_ENDPOINT_ERROR',
          type: 'RPC',
          message: 'Batched UserOperation b-2 failed off-chain with state DENIED.',
          cause: { trace: { batchId: 'b-2', kind: 'failed_offchain', state: 'DENIED', errorReason: 'POLICY_REJECTED' } },
        }),
      }),
    );
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/^not_started:.*POLICY_REJECTED/);
    expect(t.reader.txOutcome).not.toHaveBeenCalled();
  });

  it('a batch that reverted on chain goes to the chain with its hash, and is closed when no USDC left', async () => {
    const t = onBase();
    t.kit.bridge.mockResolvedValue(
      batchResult({
        name: 'approve',
        state: 'error',
        batched: true,
        batchId: 'b-3',
        errorMessage: 'No receipt returned for approve in batch b-3.',
        error: kitError({
          code: 5001,
          name: 'ONCHAIN_TRANSACTION_REVERTED',
          type: 'ONCHAIN',
          message: 'Batched UserOperation b-3 reverted on-chain.',
          cause: { trace: { batchId: 'b-3', kind: 'reverted_onchain', txHash: BATCH_HASH } },
        }),
      }),
    );
    t.reader.txOutcome.mockResolvedValue('reverted');
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.reader.txOutcome).toHaveBeenCalledWith(expect.anything(), BATCH_HASH.toLowerCase(), ARC_LOWER);
    const row = t.store.only();
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/^burn_reverted:/);
    expect((row.legs as DepositLeg[]).find((l) => l.kind === 'burn')).toMatchObject({
      status: 'failed',
      txHash: BATCH_HASH.toLowerCase(),
      batchId: 'b-3',
    });
  });
});

// ---------------------------------------------------------------- after the burn

describe('after the burn', () => {
  it('hands a deposit stuck after its burn to a person, and later money to that wallet moves again', async () => {
    const t = setup();
    const stuck = result([burnStep(), { name: 'fetchAttestation', state: 'error', errorMessage: 'attestation timed out' }], 'error');
    t.kit.bridge.mockResolvedValue(stuck);
    t.kit.retryBridge.mockImplementation(async (r: BridgeResult) => ({
      ...r,
      steps: [...r.steps, { name: 'fetchAttestation', state: 'error', errorMessage: 'attestation timed out' }],
    }));
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row.status).toBe('sent');

    t.store.age(row.id, CFG.retryMs + 1);
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.kit.retryBridge).toHaveBeenCalledTimes(1);
    expect(t.store.only().status).toBe('sent');

    // Past the reconcile window: closed for a person, no more retries.
    t.store.age(row.id, CFG.reconcileMs);
    await t.service.sweepOnce();
    await t.service.idle();
    const closed = t.store.only();
    expect(closed.status).toBe('failed');
    expect(closed.error).toMatch(/^reconcile: the burn landed but no arrival on Arc was confirmed within 6 hours/);
    expect(t.kit.retryBridge).toHaveBeenCalledTimes(1);

    // The wallet is free again: new money moves.
    t.balances.current = { usdcRaw: 3_000_000n, gasRaw: 10_000_000n };
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    const r = await t.service.sweepOnce();
    await t.service.idle();
    expect(r.started).toEqual([firstId('3000000', row.id)]);
    expect(t.store.newest().status).toBe('confirmed');
  });

  it('a mint that reverted on Arc is asked of the kit again, not re-read for ever', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    t.arc.receipt.mockResolvedValueOnce({ status: 'reverted' as never, logs: [] });
    await t.service.sweepOnce();
    await t.service.idle();
    const row = t.store.only();
    expect(row).toMatchObject({ status: 'sent', error: DEPOSIT_ERRORS.arrivalUnconfirmed('the mint reverted') });
    expect((row.legs as DepositLeg[]).find((l) => l.kind === 'mint')?.status).toBe('failed');

    t.store.age(row.id, CFG.retryMs + 1);
    t.kit.retryBridge.mockImplementation(async (r: BridgeResult) => ({
      ...r,
      state: 'success',
      steps: [...r.steps, { ...mintStep, txHash: MINT_HASH_2 }],
    }));
    await t.service.sweepOnce();
    await t.service.idle();
    const [rebuilt] = t.kit.retryBridge.mock.calls[0] as [BridgeResult];
    expect(rebuilt.steps.map((s) => s.name)).toEqual(['burn', 'fetchAttestation']);
    expect(t.arc.receipt).toHaveBeenLastCalledWith(MINT_HASH_2);
    expect(t.store.only()).toMatchObject({ status: 'confirmed', amountOutRaw: '12400000' });
    expect(t.kit.bridge).toHaveBeenCalledTimes(1);
  });

  it('is not confirmed by a mint receipt that credits someone else', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    t.arc.receipt.mockResolvedValueOnce({ status: 'success', logs: [transferLog(ARC_USDC, OTHER, 12_400_000n)] });
    await t.service.sweepOnce();
    await t.service.idle();
    expect(t.store.only()).toMatchObject({
      status: 'sent',
      amountOutRaw: null,
      error: DEPOSIT_ERRORS.arrivalUnconfirmed('no USDC reached the recipient in the mint receipt'),
    });
  });
});

// ---------------------------------------------------------------- feed-driven sweeps

describe('between full scans', () => {
  const SOL_ROW_2: WalletRow = {
    ...SOL_ROW,
    uid: 'u3',
    wallet_id: 'w-sol-2',
    address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  };

  it('reads only wallets with inbound news or a reason to look again, and keeps its place when the feed fails', async () => {
    const t = setup({ cfg: { fullScanMs: 3_600_000 }, walletRows: [SOL_ROW, SOL_ROW_2] });
    t.balances.current = { usdcRaw: 0n, gasRaw: 0n };

    const first = await t.service.sweepOnce();
    expect(first).toMatchObject({ full: true, scanned: 2 });
    expect(t.reader.inbound).not.toHaveBeenCalled();

    // Nothing arrived: one feed read, no wallet read.
    const quiet = await t.service.sweepOnce();
    expect(quiet).toMatchObject({ full: false, scanned: 0 });
    expect(t.reader.balances).toHaveBeenCalledTimes(2);
    expect(t.reader.inbound).toHaveBeenCalledTimes(1);

    // USDC lands in one wallet: that one is read and moves.
    t.reader.inbound.mockResolvedValueOnce({ walletIds: new Set([SOL_WALLET]), until: '2026-09-28T12:00:00.000Z' });
    t.balances.current = { usdcRaw: 12_500_000n, gasRaw: 10_000_000n };
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    const news = await t.service.sweepOnce();
    await t.service.idle();
    expect(news).toMatchObject({ full: false, scanned: 1, started: [firstId('12500000')] });
    expect(t.store.only().status).toBe('confirmed');

    // The feed fails: counted, and the next read starts from the same place.
    t.balances.current = { usdcRaw: 0n, gasRaw: 6_000_000n };
    t.reader.inbound.mockRejectedValueOnce(new Error('503'));
    const down = await t.service.sweepOnce();
    expect(down.errors).toBe(1);
    // The wallet whose bridge just ended is looked at once more; the other is not.
    expect(down.scanned).toBe(1);
    await t.service.sweepOnce();
    const sinceOf = (i: number) => (t.reader.inbound.mock.calls[i] as unknown as [unknown, string])[1];
    expect(sinceOf(3)).toBe(sinceOf(2));
    expect(sinceOf(2)).toBe(new Date(Date.parse('2026-09-28T12:00:00.000Z') - 5 * 60_000).toISOString());
  });
});

// ---------------------------------------------------------------- live reader

describe('LiveChainReader', () => {
  const [SOL_NET] = depositNetworks('testnet');
  const tx = (i: number) => ({ id: `t${i}`, walletId: `w${i % 7}`, createDate: `2026-09-28T10:00:${String(i % 60).padStart(2, '0')}.000Z` });

  it('pages the inbound feed oldest first and reports every wallet that received something', async () => {
    const listTransactions = jest
      .fn()
      .mockResolvedValueOnce({ data: { transactions: Array.from({ length: 50 }, (_, i) => tx(i)) } })
      .mockResolvedValueOnce({ data: { transactions: [tx(50), { id: 't51', createDate: 'x' }] } });
    const reader = new LiveChainReader({ client: { listTransactions } } as never);
    const before = Date.now();
    const out = await reader.inbound(SOL_NET, '2026-09-28T09:55:00.000Z');
    expect(listTransactions).toHaveBeenNthCalledWith(1, {
      blockchain: 'SOL-DEVNET',
      txType: 'INBOUND',
      includeAll: true,
      from: '2026-09-28T09:55:00.000Z',
      order: 'ASC',
      pageSize: 50,
    });
    expect(listTransactions.mock.calls[1][0]).toMatchObject({ pageAfter: 't49' });
    expect([...out.walletIds].sort()).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    expect(Date.parse(out.until)).toBeGreaterThanOrEqual(before);
  });

  it('stops after its page budget and says where, so the next read carries on', async () => {
    let n = 0;
    const listTransactions = jest.fn(async () => ({ data: { transactions: Array.from({ length: 50 }, () => tx(n++)) } }));
    const reader = new LiveChainReader({ client: { listTransactions } } as never);
    const out = await reader.inbound(SOL_NET, '2026-09-28T09:55:00.000Z');
    expect(listTransactions).toHaveBeenCalledTimes(20);
    expect(out.until).toBe(tx(999).createDate);
  });

  it("reads Circle's record of a batch, with an empty hash as none", async () => {
    const getTransaction = jest
      .fn()
      .mockResolvedValueOnce({ data: { transaction: { state: 'QUEUED', txHash: '' } } })
      .mockResolvedValueOnce({ data: { transaction: { state: 'COMPLETE', txHash: BATCH_HASH, errorReason: undefined } } });
    const reader = new LiveChainReader({ client: { getTransaction } } as never);
    expect(await reader.circleTx('b-1')).toEqual({ state: 'QUEUED', txHash: null, errorReason: null });
    expect(await reader.circleTx('b-1')).toEqual({ state: 'COMPLETE', txHash: BATCH_HASH, errorReason: null });
    expect(getTransaction).toHaveBeenCalledWith({ id: 'b-1' });
  });

  it('reads Solana USDC and SOL from one Circle balance call', async () => {
    const getWalletTokenBalance = jest.fn(async () => ({
      data: {
        tokenBalances: [
          { amount: '12.5', token: { tokenAddress: SolanaDevnet.usdcAddress, decimals: 6, isNative: false } },
          { amount: '0.0061', token: { isNative: true, decimals: 9 } },
        ],
      },
    }));
    const reader = new LiveChainReader({ client: { getWalletTokenBalance } } as never);
    const src = { uid: 'u1', net: SOL_NET, walletId: SOL_WALLET, address: SOL_ADDR, accountType: 'EOA' as const, arcAddress: ARC_LOWER as `0x${string}` };
    expect(await reader.balances(src)).toEqual({ usdcRaw: 12_500_000n, gasRaw: 6_100_000n });
    expect(getWalletTokenBalance).toHaveBeenCalledWith({ id: SOL_WALLET, includeAll: true });
  });
});

// ---------------------------------------------------------------- status

describe('status', () => {
  it('lists recent deposits with their network, amounts and hashes', async () => {
    const t = setup();
    t.kit.bridge.mockResolvedValue(result([burnStep(), attestStep, mintStep]));
    await t.service.sweepOnce();
    await t.service.idle();

    const list = await t.service.status('u1');
    expect(list).toEqual([
      expect.objectContaining({
        id: firstId('12500000'),
        network: 'Solana',
        status: 'confirmed',
        amountRaw: '12500000',
        arrivedRaw: '12400000',
        burnTxHash: SIG,
        mintTxHash: MINT_HASH.toLowerCase(),
        error: null,
      }),
    ]);
    expect(await t.service.status('someone-else')).toEqual([]);
  });
});

// ---------------------------------------------------------------- loop

describe('start / stop', () => {
  afterEach(() => jest.useRealTimers());

  it('sweeps on the interval and never overlaps a sweep still running', async () => {
    jest.useFakeTimers();
    const t = setup();
    let gate = deferred<void>();
    const sweep = jest
      .spyOn(t.service, 'sweepOnce')
      .mockImplementation(() =>
        gate.promise.then(() => ({ full: false, scanned: 0, started: [], resumed: [], held: [], errors: 0 })),
      );

    t.service.start();
    t.service.start(); // a second start is a no-op
    expect(t.service.looping).toBe(true);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    // The first sweep is slow: time passes, no second sweep begins.
    await jest.advanceTimersByTimeAsync(120_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    gate.resolve();
    gate = deferred<void>();
    gate.resolve();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    t.service.stop();
    expect(t.service.looping).toBe(false);
    await jest.advanceTimersByTimeAsync(200_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a sweep that throws', async () => {
    jest.useFakeTimers();
    const t = setup();
    const sweep = jest.spyOn(t.service, 'sweepOnce').mockRejectedValue(new Error('db down'));
    t.service.start();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(3);
    t.service.stop();
  });
});

// ---------------------------------------------------------------- helpers

describe('helpers', () => {
  it('legFromStep drops noop steps and keeps a Solana signature exact', () => {
    expect(legFromStep({ name: 'approve', state: 'noop' }, 'Solana', 't')).toBeNull();
    expect(legFromStep({ name: 'transfer', state: 'success' }, 'Solana', 't')).toBeNull();
    const leg = legFromStep(burnStep(), 'Solana', 't')!;
    expect(leg).toMatchObject({ kind: 'burn', status: 'confirmed', signature: SIG, sentAt: 't' });
    expect(leg.txHash).toBeUndefined();
    expect(() => JSON.stringify(leg)).not.toThrow();
    expect(legFromStep({ name: 'burn', state: 'pending', txHash: '0xABC' }, 'Base', 't')).toMatchObject({
      status: 'sent',
      txHash: '0xabc',
    });
  });

  it('usdcArrived sums USDC transfers to the recipient only', () => {
    const other = '0x1111111111111111111111111111111111111111';
    const logs = [
      transferLog(ARC_USDC, ARC_LOWER, 10_000_000n),
      transferLog(ARC_USDC, other, 99n),
      transferLog('0x2222222222222222222222222222222222222222', ARC_LOWER, 7n),
      transferLog(ARC_USDC, ARC_LOWER, 2_000_000n),
    ];
    expect(usdcArrived(logs, ARC_USDC, ARC_LOWER)).toBe(12_000_000n);
    expect(usdcArrived([], ARC_USDC, ARC_LOWER)).toBeNull();
  });

  it('usdcLeft sees a burn only as USDC leaving the source, not as a successful receipt', () => {
    const usdc = BaseSepolia.usdcAddress.toLowerCase();
    const minter = '0x2222222222222222222222222222222222222222';
    const out = { ...transferLog(usdc, minter, 5_000_000n) } as Log;
    // Rewrite the Transfer's `from` to the source: topics[1] is the indexed from.
    out.topics = encodeEventTopics({
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { from: ARC_LOWER as `0x${string}`, to: minter as `0x${string}` },
    }) as Log['topics'];
    expect(usdcLeft([out], usdc, ARC_ADDR)).toBe(true);
    // A bundle whose inner call reverted: a successful receipt with no such transfer.
    expect(usdcLeft([], usdc, ARC_LOWER)).toBe(false);
    expect(usdcLeft([transferLog(usdc, ARC_LOWER, 5n)], usdc, ARC_LOWER)).toBe(false);
    expect(usdcLeft([out], ARC_USDC, ARC_LOWER)).toBe(false);
  });
});
