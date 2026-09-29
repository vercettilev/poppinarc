import { BadRequestException, ConflictException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { decodeFunctionData, encodeFunctionData, erc20Abi, type Hex } from 'viem';
import { loadConfig } from '../config';
import type { ArcChain } from '../arc/chain';
import { stableUuid } from '../circle/ids';
import type { CircleWallets } from '../circle/wallets';
import type { ActionsStore } from '../trade/actions';
import { TRADE_ERRORS, type Address, type ExecuteRequest, type Leg } from '../trade/types';
import {
  ARC_NATIVE_LOG,
  CircleSendError,
  KYBER_ROUTER_ABI,
  KyberRouter,
  RateGate,
  SwapPendingError,
  priceImpactPct,
  receivedFromLogs,
  routeLabels,
  swapDescription,
  userOpSucceeded,
  venueLabel,
  type KyberOptions,
} from './kyber.router';

// Addresses from the 2026-09-28 live answers (ARCOON, the pinned router).
const USDC = '0x3600000000000000000000000000000000000000' as Address;
const EURC = '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1' as Address;
const MEME = '0x4621a0baa0b5d97aae77704cf2a84dabe78a4fed' as Address;
const ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5' as Address;
const ROUTER_CHECKSUM = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const EXECUTOR = '0x8f10b468b06c6fd214b65f87778827f7d113f996' as Address;
const WALLET = '0xabcdef0123456789abcdef0123456789abcdef01' as Address;
const OTHER = '0x9999999999999999999999999999999999999999' as Address;
const FEE_WALLET = '0x000000000000000000000000000000000000dead' as Address;
const ENTRY_POINT_07 = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USER_OP_EVENT = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';
const SWAP_HASH = `0x${'5'.repeat(64)}` as Address;
const APPROVE_HASH = `0x${'a'.repeat(64)}` as Address;
const CIRCLE_ID = '0c3e5f6a-1111-4222-8333-944455556666';
const BLOCK = 1_000n;

type Reply = { status?: number; body: unknown };
type Log = { address: string; topics: string[]; data: string };

const pad = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;
const word = (n: bigint) => n.toString(16).padStart(64, '0');
const transferLog = (token: string, from: string, to: string, value: bigint): Log => ({
  address: token,
  topics: [TRANSFER, pad(from), pad(to)],
  data: `0x${word(value)}`,
});
const userOpLog = (sender: string, success: boolean): Log => ({
  address: ENTRY_POINT_07,
  topics: [USER_OP_EVENT, `0x${'ab'.repeat(32)}`, pad(sender), pad('0x0')],
  data: `0x${[7n, success ? 1n : 0n, 5n, 6n].map(word).join('')}`,
});
const receipt = (status: 'success' | 'reverted', logs: Log[] = []) => ({
  status,
  logs,
  gasUsed: 500_000n,
  effectiveGasPrice: 20_000_000_000n,
  blockNumber: BLOCK,
  from: WALLET,
});

function routesReply(
  q: URLSearchParams,
  amountOut: bigint,
  extra: { inUsd?: string; outUsd?: string; exchanges?: string[][]; router?: string } = {},
): Reply {
  const summary = {
    tokenIn: q.get('tokenIn'),
    amountIn: q.get('amountIn'),
    amountInUsd: extra.inUsd ?? '1.0',
    tokenOut: q.get('tokenOut'),
    amountOut: amountOut.toString(),
    amountOutUsd: extra.outUsd ?? '0.99',
    route: (extra.exchanges ?? [['uniswap-v4-fee']]).map((path) => path.map((exchange) => ({ exchange }))),
    checksum: '1403829772300419826',
  };
  return { body: { code: 0, message: 'successfully', data: { routeSummary: summary, routerAddress: extra.router ?? ROUTER_CHECKSUM } } };
}

type Desc = {
  srcToken: Address;
  dstToken: Address;
  srcReceivers: readonly Address[];
  srcAmounts: readonly bigint[];
  feeReceivers: readonly Address[];
  feeAmounts: readonly bigint[];
  dstReceiver: Address;
  amount: bigint;
  minReturnAmount: bigint;
  flags: bigint;
  permit: Hex;
};

/** Router calldata shaped as KyberSwap builds it. The real-fixture tests below prove the ABI against live builds. */
function routerCall(desc: Desc): Hex {
  return encodeFunctionData({
    abi: KYBER_ROUTER_ABI,
    functionName: 'swap',
    args: [{ callTarget: EXECUTOR, approveTarget: '0x0000000000000000000000000000000000000000', targetData: '0x1234', desc, clientData: '0x' }],
  });
}

/** The real build's calldata with one part of its description changed. */
function tampered(data: string, change: Partial<Desc>): Hex {
  const call = decodeFunctionData({ abi: KYBER_ROUTER_ABI, data: data as Hex });
  if (call.functionName !== 'swap') throw new Error('fixture is not swap()');
  const exec = call.args[0];
  return encodeFunctionData({ abi: KYBER_ROUTER_ABI, functionName: 'swap', args: [{ ...exec, desc: { ...exec.desc, ...change } }] });
}

function buildReply(body: any, overrides: Record<string, unknown> = {}, desc: Partial<Desc> = {}): Reply {
  const s = body.routeSummary;
  const amount = BigInt(s.amountIn);
  return {
    body: {
      code: 0,
      message: 'successfully',
      data: {
        amountIn: s.amountIn,
        amountOut: s.amountOut,
        data: routerCall({
          srcToken: s.tokenIn,
          dstToken: s.tokenOut,
          srcReceivers: [EXECUTOR],
          srcAmounts: [amount],
          feeReceivers: [],
          feeAmounts: [],
          dstReceiver: body.recipient,
          amount,
          minReturnAmount: (BigInt(s.amountOut) * BigInt(10_000 - body.slippageTolerance)) / 10_000n,
          flags: 512n,
          permit: '0x',
          ...desc,
        }),
        routerAddress: ROUTER_CHECKSUM,
        transactionValue: '0',
        ...overrides,
      },
    },
  };
}

function mockKyber(h: { routes?: (q: URLSearchParams) => Reply | Promise<Reply>; build?: (body: any) => Reply | Promise<Reply> }) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = new URL(String(input));
    let r: Reply;
    if (url.pathname.endsWith('/routes')) r = await h.routes!(url.searchParams);
    else if (url.pathname.endsWith('/route/build')) r = await h.build!(JSON.parse(init.body));
    else throw new Error(`unexpected ${url}`);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
}

/** `priorLegs` null means the action row does not exist. */
function setup(env: Record<string, string> = {}, priorLegs: Leg[] | null = [], options: KyberOptions = {}) {
  const config = loadConfig({ ARC_NETWORK: 'mainnet', ...env });
  const readContract = jest.fn();
  const chain = { client: { readContract }, receipt: jest.fn() };
  const wallets = { execute: jest.fn(), client: { getTransaction: jest.fn() } };
  const saved: Leg[][] = [];
  const actions = {
    get: jest.fn(async () => (priorLegs ? { legs: priorLegs } : null)),
    update: jest.fn(async (_id: string, patch: { legs?: Leg[] }) => {
      if (patch.legs) saved.push(patch.legs);
    }),
  };
  const router = new KyberRouter(
    config,
    chain as unknown as ArcChain,
    wallets as unknown as CircleWallets,
    actions as unknown as ActionsStore,
    { rps: 1_000, ...options },
  );
  return { router, chain, readContract, wallets, actions, saved };
}

const buyReq = (over: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  uid: 'u1',
  walletId: 'w-1',
  walletAddress: WALLET,
  tokenIn: USDC,
  tokenOut: MEME,
  amountInRaw: 1_000_000n,
  actionId: 'act-1',
  ...over,
});
const sellReq = (over: Partial<ExecuteRequest> = {}) => buyReq({ tokenIn: MEME, tokenOut: USDC, amountInRaw: 10n ** 20n, ...over });

async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The router logs every refusal on purpose; the test output does not need them.
beforeAll(() => Logger.overrideLogger(false));
afterEach(() => jest.restoreAllMocks());

describe('venue labels', () => {
  it('names every Uniswap v4 flavour and Aero the way a reader would', () => {
    expect(venueLabel('uniswap-v4-fee')).toBe('Uniswap v4');
    expect(venueLabel('uniswap-v4-doppler')).toBe('Uniswap v4');
    expect(venueLabel('aero-cl')).toBe('Aero');
    expect(venueLabel('uniswap-v3')).toBe('Uniswap v3');
    expect(venueLabel('brand-new-dex-v2')).toBe('Brand New Dex');
  });

  it('lists each venue once in flow order and is never empty', () => {
    const route = [[{ exchange: 'uniswap-v4-fee' }], [{ exchange: 'uniswap-v4' }, { exchange: 'aero-cl' }]];
    expect(routeLabels(route)).toEqual(['Uniswap v4', 'Aero']);
    expect(routeLabels([])).toEqual(['KyberSwap']);
    expect(routeLabels(undefined)).toEqual(['KyberSwap']);
  });
});

describe('priceImpactPct', () => {
  it('leaves our fee out of the impact and stays finite', () => {
    // 1% fee taken from $1.00 in; the pool then loses 1% of the rest.
    expect(priceImpactPct('1.0', '0.9801', 100)).toBeCloseTo(1, 2);
    expect(priceImpactPct('1.0', '0.99', 0)).toBeCloseTo(1, 2);
    expect(priceImpactPct('', '0.5', 0)).toBe(0);
    expect(priceImpactPct('1', '0', 0)).toBe(0);
    expect(priceImpactPct('1', '1.2', 0)).toBe(0);
    expect(priceImpactPct('853816326.73', '115768.38', 0)).toBeLessThanOrEqual(100);
  });
});

describe('receipt readers', () => {
  it('sums only transfers of the output token to the wallet', () => {
    const logs = [
      transferLog(MEME, ROUTER, WALLET, 100n),
      transferLog(MEME, ROUTER, WALLET, 23n),
      transferLog(MEME, ROUTER, OTHER, 1_000n),
      transferLog(USDC, WALLET, ROUTER, 1_000_000n),
    ];
    expect(receivedFromLogs(logs, MEME, WALLET)).toBe(123n);
    expect(receivedFromLogs(logs, USDC, WALLET)).toBe(0n);
  });

  it("reads the wallet's user operation outcome from a known EntryPoint only", () => {
    expect(userOpSucceeded([userOpLog(WALLET, true)], WALLET)).toBe(true);
    expect(userOpSucceeded([userOpLog(WALLET, true), userOpLog(WALLET, false)], WALLET)).toBe(false);
    expect(userOpSucceeded([userOpLog(OTHER, false)], WALLET)).toBeNull();
    expect(userOpSucceeded([{ ...userOpLog(WALLET, false), address: OTHER }], WALLET)).toBeNull();
    expect(userOpSucceeded([], WALLET)).toBeNull();
  });
});

describe('swapDescription', () => {
  it('reads a real KyberSwap build', () => {
    expect(swapDescription(REAL_BUY.data)).toEqual({
      srcToken: USDC,
      dstToken: MEME,
      feeReceivers: [FEE_WALLET],
      dstReceiver: WALLET,
      amount: 1_000_000n,
      minReturnAmount: 113_387_384_597_443_061_021n,
      permit: '0x',
    });
    expect(swapDescription(REAL_SELL.data)).toMatchObject({ srcToken: MEME, dstToken: USDC, dstReceiver: WALLET, amount: 10n ** 20n });
  });

  it('is null for anything that is not a router swap', () => {
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER, 1n] });
    for (const data of ['', '0x', '0xe21fd0e9', `0xdeadbeef${'00'.repeat(64)}`, approve, 'not hex']) {
      expect(swapDescription(data)).toBeNull();
    }
  });
});

describe('RateGate', () => {
  it('lets 3 through per second, queues the next, and refuses a wait longer than allowed', async () => {
    let now = 0;
    const waits: number[] = [];
    const gate = new RateGate(3, 1_000, () => now, async (ms) => {
      waits.push(ms);
    });
    for (let i = 0; i < 3; i++) await gate.take(0);
    expect(waits).toEqual([]);
    await gate.take(2_000);
    expect(waits).toEqual([1_000]);
    await expect(gate.take(500)).rejects.toThrow(/local gate/);
    now = 1_000;
    await gate.take(0);
    await gate.take(0);
  });
});

describe('KyberRouter.quote', () => {
  it('prices a buy with our fee on the USDC going in', async () => {
    const { router } = setup({ SPOT_FEE_BPS: '100', FEE_RECIPIENT: FEE_WALLET });
    const fetchMock = mockKyber({
      routes: (q) => routesReply(q, 114_735_745_933_987_102_720n, { outUsd: '0.9801', exchanges: [['uniswap-v4-fee'], ['aero-cl']] }),
    });
    const q = await router.quote({ tokenIn: USDC, tokenOut: MEME, amountInRaw: 1_000_000n });

    expect(q).toEqual({
      venue: 'kyber',
      tokenIn: USDC,
      tokenOut: MEME,
      amountInRaw: 1_000_000n,
      amountOutRaw: 114_735_745_933_987_102_720n,
      minAmountOutRaw: (114_735_745_933_987_102_720n * 9_900n) / 10_000n,
      priceImpactPct: 1,
      route: ['Uniswap v4', 'Aero'],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(url.startsWith('https://aggregator-api.kyberswap.com/arc/api/v1/routes?')).toBe(true);
    expect(params.get('feeAmount')).toBe('100');
    expect(params.get('isInBps')).toBe('true');
    expect(params.get('chargeFeeBy')).toBe('currency_in');
    expect(params.get('feeReceiver')).toBe(FEE_WALLET);
    expect((init.headers as Record<string, string>)['x-client-id']).toBe('poppin-arc');
  });

  it('takes the fee from the USDC coming out of a sell', async () => {
    const { router } = setup({ SPOT_FEE_BPS: '100', FEE_RECIPIENT: FEE_WALLET });
    const fetchMock = mockKyber({ routes: (q) => routesReply(q, 969_934n) });
    await router.quote({ tokenIn: MEME, tokenOut: USDC, amountInRaw: 115_000_000_000_000_000_000n });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('chargeFeeBy')).toBe('currency_out');
  });

  it('sends no fee parameters when no fee is configured', async () => {
    const { router } = setup();
    const fetchMock = mockKyber({ routes: (q) => routesReply(q, 5n) });
    await router.quote({ tokenIn: USDC, tokenOut: MEME, amountInRaw: 1n });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.has('feeAmount')).toBe(false);
  });

  it('turns a 429 into the rate-limit sentence', async () => {
    const { router } = setup();
    mockKyber({ routes: () => ({ status: 429, body: { message: 'too many requests' } }) });
    const e = await rejection(router.quote({ tokenIn: USDC, tokenOut: MEME, amountInRaw: 1_000_000n }));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(e.message).toBe(TRADE_ERRORS.rateLimited);
  });

  it('turns route-not-found into the no-route sentence and an outage into quote unavailable', async () => {
    const { router } = setup();
    mockKyber({ routes: () => ({ status: 400, body: { code: 4008, message: 'route not found' } }) });
    const noRoute = await rejection(router.quote({ tokenIn: MEME, tokenOut: USDC, amountInRaw: 10n ** 21n }));
    expect(noRoute.message).toBe(TRADE_ERRORS.noRoute);

    jest.restoreAllMocks();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    const down = await rejection(router.quote({ tokenIn: USDC, tokenOut: MEME, amountInRaw: 1n }));
    expect(down.message).toBe(TRADE_ERRORS.quoteUnavailable);
  });

  it('refuses a router it has not pinned', async () => {
    const { router } = setup();
    mockKyber({ routes: (q) => routesReply(q, 5n, { router: OTHER }) });
    const e = await rejection(router.quote({ tokenIn: USDC, tokenOut: MEME, amountInRaw: 1n }));
    expect(e.message).toBe(TRADE_ERRORS.quoteUnavailable);
  });

  it('supports nothing on testnet, and leaves pairs of Circle assets to App Kit', () => {
    const config = loadConfig({ ARC_NETWORK: 'testnet' });
    const r = new KyberRouter(config, {} as ArcChain, {} as CircleWallets, {} as ActionsStore);
    expect(r.supports(USDC, MEME)).toBe(false);
    const { router } = setup();
    expect(router.supports(USDC, MEME)).toBe(true);
    expect(router.supports(MEME, USDC)).toBe(true);
    expect(router.supports(EURC, MEME)).toBe(true);
    expect(router.supports(USDC, EURC)).toBe(false);
    expect(router.supports(EURC, USDC)).toBe(false);
    expect(router.supports(USDC, USDC)).toBe(false);
    expect(router.supports('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address, MEME)).toBe(false);
  });
});

describe('KyberRouter.prepareForWallet', () => {
  it("builds a pair of Circle's own assets for a wallet that signs for itself, and sends nothing", async () => {
    const { router, readContract, wallets } = setup();
    mockKyber({ routes: (q) => routesReply(q, 21_990_000n), build: (body) => buildReply(body) });
    readContract.mockResolvedValue(0n);
    const s = await router.prepareForWallet({
      tokenIn: USDC,
      tokenOut: EURC,
      amountInRaw: 25_000_000n,
      walletAddress: WALLET,
      actionId: 'act-own',
    });

    expect(s.router).toBe(ROUTER);
    expect(s.amountOut).toBe(21_990_000n);
    expect(s.allowance).toBe(0n);
    expect(s.minOut).toBe((21_990_000n * 9_900n) / 10_000n);
    const d = swapDescription(s.callData)!;
    expect(d.dstReceiver).toBe(WALLET);
    expect(d.amount).toBe(25_000_000n);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'allowance', args: [WALLET, ROUTER] }));
    expect(wallets.execute).not.toHaveBeenCalled();
  });

  it('refuses a build that would pay anyone but the wallet', async () => {
    const { router, readContract } = setup();
    mockKyber({ routes: (q) => routesReply(q, 21_990_000n), build: (body) => buildReply(body, {}, { dstReceiver: OTHER }) });
    readContract.mockResolvedValue(0n);
    const e = await rejection(
      router.prepareForWallet({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 25_000_000n, walletAddress: WALLET, actionId: 'act-own' }),
    );
    expect(e).toBeInstanceOf(UnprocessableEntityException);
  });

  it('prepares nothing on testnet, where KyberSwap does not run', async () => {
    const { router } = setup({ ARC_NETWORK: 'testnet' });
    const e = await rejection(
      router.prepareForWallet({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 1n, walletAddress: WALLET, actionId: 'a' }),
    );
    expect(e).toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('KyberRouter.execute', () => {
  it('skips the approve when the allowance already covers the trade', async () => {
    const { router, readContract, wallets, chain, saved } = setup();
    const fetchMock = mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValue(5_000_000n);
    wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt.mockResolvedValue(
      receipt('success', [transferLog(MEME, ROUTER, WALLET, 114_000n), transferLog(MEME, ROUTER, OTHER, 999n)]),
    );

    const out = await router.execute(buyReq());

    expect(wallets.execute).toHaveBeenCalledTimes(1);
    const [sent, sendTimeout] = wallets.execute.mock.calls[0];
    expect(sent.contractAddress).toBe(ROUTER);
    expect(sent.idempotencyKey).toBe(stableUuid('act-1', 'swap'));
    expect(sent.amount).toBeUndefined();
    expect(sent.callData.startsWith('0xe21fd0e9')).toBe(true);
    expect(readContract.mock.calls[0][0]).toMatchObject({ address: USDC, functionName: 'allowance', args: [WALLET, ROUTER] });
    // Every wait inside execute ends within its 60 s budget.
    expect(sendTimeout).toBeGreaterThan(50_000);
    expect(sendTimeout).toBeLessThanOrEqual(60_000);
    expect(chain.receipt.mock.calls[0][1]).toBeLessThanOrEqual(60_000);

    const build = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(build.sender).toBe(WALLET);
    expect(build.recipient).toBe(WALLET);
    expect(build.slippageTolerance).toBe(100);

    expect(out.venue).toBe('kyber');
    expect(out.txHash).toBe(SWAP_HASH);
    expect(out.amountOutRaw).toBe(114_000n);
    expect(out.legs).toHaveLength(1);
    expect(out.legs[0]).toMatchObject({ kind: 'swap', status: 'confirmed', txHash: SWAP_HASH, gasUsdcRaw: '10000' });
    // The pending swap leg was written before Circle was asked to send it.
    expect(saved[0]).toEqual([expect.objectContaining({ kind: 'swap', status: 'pending' })]);
  });

  it('approves exactly the amount in, waits for it on chain, then swaps', async () => {
    const { router, readContract, wallets, chain } = setup();
    const fetchMock = mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(1_234_567n);
    wallets.execute
      .mockResolvedValueOnce({ circleTxId: 'c-approve', txHash: APPROVE_HASH })
      .mockResolvedValueOnce({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt
      .mockResolvedValueOnce(receipt('success'))
      .mockResolvedValueOnce(receipt('success', [transferLog(MEME, ROUTER, WALLET, 115_000n)]));

    const out = await router.execute(buyReq({ amountInRaw: 1_234_567n }));

    expect(wallets.execute).toHaveBeenCalledTimes(2);
    const approve = wallets.execute.mock.calls[0][0];
    expect(approve.contractAddress).toBe(USDC);
    expect(approve.idempotencyKey).toBe(stableUuid('act-1', 'approve'));
    const decoded = decodeFunctionData({ abi: erc20Abi, data: approve.callData });
    expect(decoded.functionName).toBe('approve');
    expect(String(decoded.args[0]).toLowerCase()).toBe(ROUTER);
    // Exact, never unlimited.
    expect(decoded.args[1]).toBe(1_234_567n);
    // The approval is read at the approval's own block, not at "latest".
    expect(readContract.mock.calls[0][0].blockNumber).toBeUndefined();
    expect(readContract.mock.calls[1][0]).toMatchObject({ functionName: 'allowance', blockNumber: BLOCK });

    // The approve's receipt came before the swap was built and sent, and the
    // route was priced again after the approval.
    const approveReceipt = chain.receipt.mock.invocationCallOrder[0];
    const buildCall = fetchMock.mock.invocationCallOrder[2];
    expect(approveReceipt).toBeLessThan(buildCall);
    expect(fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname.split('/').pop())).toEqual([
      'routes',
      'routes',
      'build',
    ]);
    expect(wallets.execute.mock.calls[1][0].idempotencyKey).toBe(stableUuid('act-1', 'swap'));
    expect(out.legs.map((l) => [l.kind, l.status])).toEqual([
      ['approve', 'confirmed'],
      ['swap', 'confirmed'],
    ]);
  });

  it('reads the allowance again when the node has not seen the approval block yet', async () => {
    const { router, readContract, wallets, chain } = setup();
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract
      .mockResolvedValueOnce(0n)
      .mockRejectedValueOnce(new Error('header not found'))
      .mockResolvedValueOnce(1_000_000n);
    wallets.execute
      .mockResolvedValueOnce({ circleTxId: 'c-approve', txHash: APPROVE_HASH })
      .mockResolvedValueOnce({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt
      .mockResolvedValueOnce(receipt('success'))
      .mockResolvedValueOnce(receipt('success', [transferLog(MEME, ROUTER, WALLET, 1n)]));

    const out = await router.execute(buyReq());
    expect(out.legs.map((l) => l.status)).toEqual(['confirmed', 'confirmed']);
    expect(readContract).toHaveBeenCalledTimes(3);
  });

  it('stops when the approval does not show on chain', async () => {
    const { router, readContract, wallets, chain } = setup();
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValue(0n);
    wallets.execute.mockResolvedValueOnce({ circleTxId: 'c-approve', txHash: APPROVE_HASH });
    chain.receipt.mockResolvedValueOnce(receipt('success'));

    const e = await rejection(router.execute(buyReq()));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toBe(TRADE_ERRORS.chainFailed('the spending approval did not go through'));
    expect(wallets.execute).toHaveBeenCalledTimes(1);
  });

  it('approves again under a new key after an approval that did not take', async () => {
    const prior: Leg[] = [{ kind: 'approve', status: 'failed', chain: 'ARC', txHash: APPROVE_HASH }];
    const { router, readContract, wallets, chain } = setup({}, prior);
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(1_000_000n);
    wallets.execute
      .mockResolvedValueOnce({ circleTxId: 'c-approve-2', txHash: `0x${'b'.repeat(64)}` })
      .mockResolvedValueOnce({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt
      .mockResolvedValueOnce(receipt('success'))
      .mockResolvedValueOnce(receipt('success', [transferLog(MEME, ROUTER, WALLET, 1n)]));

    const out = await router.execute(buyReq());
    expect(wallets.execute.mock.calls[0][0].idempotencyKey).toBe(stableUuid('act-1', 'approve', '1'));
    expect(out.legs.map((l) => [l.kind, l.status])).toEqual([
      ['approve', 'failed'],
      ['approve', 'confirmed'],
      ['swap', 'confirmed'],
    ]);
  });

  it('resumes an approval that may still land under its own key', async () => {
    const prior: Leg[] = [{ kind: 'approve', status: 'pending', chain: 'ARC' }];
    const { router, readContract, wallets, chain } = setup({}, prior);
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(1_000_000n);
    wallets.execute
      .mockResolvedValueOnce({ circleTxId: 'c-approve', txHash: APPROVE_HASH })
      .mockResolvedValueOnce({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt
      .mockResolvedValueOnce(receipt('success'))
      .mockResolvedValueOnce(receipt('success', [transferLog(MEME, ROUTER, WALLET, 1n)]));

    const out = await router.execute(buyReq());
    expect(wallets.execute.mock.calls[0][0].idempotencyKey).toBe(stableUuid('act-1', 'approve'));
    expect(out.legs.map((l) => [l.kind, l.status])).toEqual([
      ['approve', 'confirmed'],
      ['swap', 'confirmed'],
    ]);
  });

  it('reports a reverted swap as failed on chain, in the words the extension knows', async () => {
    // A hash with "401" in it: the chip reads /401/ in a sell error as signed out.
    const hash = `0x401a${'0'.repeat(56)}0401` as Address;
    const { router, readContract, wallets, chain, saved } = setup();
    mockKyber({ routes: (q) => routesReply(q, 979_733n), build: (b) => buildReply(b) });
    readContract.mockResolvedValue(10n ** 30n);
    wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: hash });
    chain.receipt.mockResolvedValue(receipt('reverted'));

    const e = await rejection(router.execute(sellReq()));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message.startsWith('Sell failed on chain: ')).toBe(true);
    expect(e.message).toMatch(/slippage/);
    expect(e.message).not.toMatch(/insufficient|enough|401|0x/i);
    expect(saved[saved.length - 1]).toEqual([expect.objectContaining({ kind: 'swap', status: 'failed', txHash: hash })]);
  });

  it('counts USDC paid out as native value, once', async () => {
    const { router, readContract, wallets, chain } = setup();
    mockKyber({ routes: (q) => routesReply(q, 979_733n), build: (b) => buildReply(b) });
    readContract.mockResolvedValue(10n ** 30n);
    wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    const native = (v: bigint) => transferLog(ARC_NATIVE_LOG, ROUTER, WALLET, v * 10n ** 12n);

    chain.receipt.mockResolvedValue(receipt('success', [native(979_000n)]));
    expect((await router.execute(sellReq({ actionId: 'n-1' }))).amountOutRaw).toBe(979_000n);

    // An ERC-20 payout logs at 0x3600 and at the native address; not doubled.
    chain.receipt.mockResolvedValue(receipt('success', [transferLog(USDC, ROUTER, WALLET, 979_000n), native(979_000n)]));
    expect((await router.execute(sellReq({ actionId: 'n-2' }))).amountOutRaw).toBe(979_000n);
  });

  it('trusts a successful EOA swap that logged no transfer and reads the balance instead', async () => {
    const { router, readContract, wallets, chain } = setup();
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockImplementation(async (p: { functionName: string; blockNumber?: bigint }) => {
      if (p.functionName === 'allowance') return 10n ** 30n;
      return p.blockNumber === BLOCK - 1n ? 100n : 114_100n;
    });
    wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt.mockResolvedValue(receipt('success'));

    const out = await router.execute(buyReq());
    expect(out.amountOutRaw).toBe(114_000n);
    expect(out.legs[0].status).toBe('confirmed');
  });

  it('fails an SCA bundle whose user operation reverted, or that proves nothing and delivered nothing', async () => {
    for (const logs of [[userOpLog(WALLET, false), transferLog(MEME, ROUTER, WALLET, 5n)], [transferLog(MEME, ROUTER, OTHER, 5n)]]) {
      const { router, readContract, wallets, chain, saved } = setup({ CIRCLE_ACCOUNT_TYPE: 'SCA' });
      mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
      readContract.mockResolvedValue(10n ** 30n);
      wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
      chain.receipt.mockResolvedValue(receipt('success', logs));

      const e = await rejection(router.execute(buyReq()));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message.startsWith('Swap failed on chain: ')).toBe(true);
      expect(saved[saved.length - 1]).toEqual([expect.objectContaining({ kind: 'swap', status: 'failed' })]);
      jest.restoreAllMocks();
    }
  });

  it('confirms an SCA bundle whose user operation ran', async () => {
    const { router, readContract, wallets, chain } = setup({ CIRCLE_ACCOUNT_TYPE: 'SCA' });
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValue(10n ** 30n);
    wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt.mockResolvedValue(receipt('success', [userOpLog(WALLET, true), transferLog(MEME, ROUTER, WALLET, 77n)]));
    expect((await router.execute(buyReq())).amountOutRaw).toBe(77n);
  });

  it('settles a swap already sent on this action instead of sending another', async () => {
    const prior: Leg[] = [{ kind: 'swap', status: 'sent', chain: 'ARC', circleTxId: 'c-swap', txHash: SWAP_HASH }];
    const { router, wallets, chain } = setup({}, prior);
    const fetchMock = mockKyber({});
    chain.receipt.mockResolvedValue(receipt('success', [transferLog(MEME, ROUTER, WALLET, 42n)]));

    const out = await router.execute(buyReq());
    expect(out.amountOutRaw).toBe(42n);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wallets.execute).not.toHaveBeenCalled();
  });

  it('refuses to send when an earlier attempt may have sent without a hash', async () => {
    const prior: Leg[] = [{ kind: 'swap', status: 'pending', chain: 'ARC' }];
    const { router, wallets } = setup({}, prior);
    mockKyber({});
    const e = await rejection(router.execute(buyReq()));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toBe(TRADE_ERRORS.idempotencyConflict);
    expect(wallets.execute).not.toHaveBeenCalled();
  });

  it('sends nothing for an action that was never recorded', async () => {
    const { router, wallets } = setup({}, null);
    const fetchMock = mockKyber({});
    const e = await rejection(router.execute(buyReq()));
    expect(e.message).toMatch(/not recorded/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wallets.execute).not.toHaveBeenCalled();
  });

  it('hands back the hash when the receipt is slow', async () => {
    const { router, readContract, wallets, chain } = setup();
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValue(10n ** 30n);
    wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt.mockRejectedValue(new Error('timed out'));

    const e = await rejection(router.execute(buyReq()));
    expect(e).toBeInstanceOf(SwapPendingError);
    expect(e.txHash).toBe(SWAP_HASH);
    expect(e.legs[0]).toMatchObject({ kind: 'swap', status: 'sent' });
  });

  it('never signs a build that differs from what the reader asked for', async () => {
    const cases: Array<[string, Record<string, unknown>, Partial<Desc>]> = [
      ['another router', { routerAddress: OTHER }, {}],
      ['native value', { transactionValue: '1' }, {}],
      ['no calldata', { data: '0x' }, {}],
      ['another selector', { data: `0xdeadbeef${'00'.repeat(64)}` }, {}],
      ['pays someone else', {}, { dstReceiver: OTHER }],
      ['buys another token', {}, { dstToken: OTHER }],
      ['spends another token', {}, { srcToken: OTHER }],
      ['spends more', {}, { amount: 2_000_000n }],
      ['no floor', {}, { minReturnAmount: 0n }],
      ['a floor under our slippage', {}, { minReturnAmount: 113_000n }],
      ['a permit', {}, { permit: '0x01' }],
      ['a fee to someone else', {}, { feeReceivers: [OTHER], feeAmounts: [100n] }],
    ];
    for (const [name, envelope, desc] of cases) {
      const { router, readContract, wallets } = setup();
      mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b, envelope, desc) });
      readContract.mockResolvedValue(10n ** 30n);
      const e = await rejection(router.execute(buyReq()));
      expect([name, e.message]).toEqual([name, TRADE_ERRORS.quoteUnavailable]);
      expect(wallets.execute).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    }
  });

  it('signs a real KyberSwap build with our fee, and refuses it once it pays someone else', async () => {
    const env = { SPOT_FEE_BPS: '100', FEE_RECIPIENT: FEE_WALLET };
    const reply = (data: string): Reply => ({
      body: { code: 0, data: { amountIn: '1000000', amountOut: REAL_BUY.buildOut, data, routerAddress: ROUTER_CHECKSUM, transactionValue: '0' } },
    });

    const ok = setup(env);
    mockKyber({ routes: (q) => routesReply(q, REAL_BUY.routeOut), build: () => reply(REAL_BUY.data) });
    ok.readContract.mockResolvedValue(10n ** 30n);
    ok.wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    ok.chain.receipt.mockResolvedValue(receipt('success', [transferLog(MEME, ROUTER, WALLET, 114_000n)]));
    await ok.router.execute(buyReq());
    expect(ok.wallets.execute.mock.calls[0][0].callData).toBe(REAL_BUY.data);
    jest.restoreAllMocks();

    for (const change of [{ dstReceiver: OTHER }, { feeReceivers: [OTHER] }, { minReturnAmount: 1n }, { amount: 1_000_001n }]) {
      const bad = setup(env);
      mockKyber({ routes: (q) => routesReply(q, REAL_BUY.routeOut), build: () => reply(tampered(REAL_BUY.data, change)) });
      bad.readContract.mockResolvedValue(10n ** 30n);
      const e = await rejection(bad.router.execute(buyReq()));
      expect(e.message).toBe(TRADE_ERRORS.quoteUnavailable);
      expect(bad.wallets.execute).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    }
  });

  it('signs a real sell build whose floor sits a wei under the route, with the fee on the USDC out', async () => {
    const { router, readContract, wallets, chain } = setup({ SPOT_FEE_BPS: '100', FEE_RECIPIENT: FEE_WALLET });
    mockKyber({
      routes: (q) => routesReply(q, REAL_SELL.routeOut),
      build: () => ({
        body: { code: 0, data: { amountIn: '100000000000000000000', amountOut: REAL_SELL.buildOut, data: REAL_SELL.data, routerAddress: ROUTER_CHECKSUM, transactionValue: '0' } },
      }),
    });
    readContract.mockResolvedValue(10n ** 30n);
    wallets.execute.mockResolvedValue({ circleTxId: 'c-swap', txHash: SWAP_HASH });
    chain.receipt.mockResolvedValue(receipt('success', [transferLog(USDC, ROUTER, WALLET, 837_645n)]));

    const out = await router.execute(sellReq());
    expect(wallets.execute.mock.calls[0][0].callData).toBe(REAL_SELL.data);
    expect(out.amountOutRaw).toBe(837_645n);
  });

  it('runs two trades from the same wallet and token one after the other', async () => {
    const { router, readContract, wallets, chain } = setup();
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    const events: string[] = [];
    readContract.mockImplementation(async () => {
      events.push('allowance');
      return 10n ** 30n;
    });
    wallets.execute.mockImplementation(async (p: { idempotencyKey: string }) => {
      events.push('send');
      return { circleTxId: p.idempotencyKey, txHash: SWAP_HASH };
    });
    chain.receipt.mockImplementation(async () => {
      events.push('receipt');
      return receipt('success', [transferLog(MEME, ROUTER, WALLET, 1n)]);
    });

    await Promise.all([router.execute(buyReq({ actionId: 'a' })), router.execute(buyReq({ actionId: 'b' }))]);
    expect(events).toEqual(['allowance', 'send', 'receipt', 'allowance', 'send', 'receipt']);
  });
});

describe('KyberRouter.execute time budget', () => {
  it('backs out before sending the swap once the send deadline has passed', async () => {
    const { router, readContract, wallets, saved } = setup({}, [], { executeBudgetMs: 300, sendReserveMs: 250 });
    mockKyber({
      routes: (q) => routesReply(q, 115_000n),
      build: async (b) => {
        await sleep(120);
        return buildReply(b);
      },
    });
    readContract.mockResolvedValue(10n ** 30n);

    const e = await rejection(router.execute(buyReq()));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(e.message).toBe(TRADE_ERRORS.rateLimited);
    expect(wallets.execute).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('gives up waiting behind another trade from the same wallet, and the queue still holds', async () => {
    const { router, readContract, wallets, chain } = setup({}, [], { executeBudgetMs: 400, sendReserveMs: 300 });
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    readContract.mockResolvedValue(10n ** 30n);
    let land!: (v: unknown) => void;
    wallets.execute.mockResolvedValue({ circleTxId: 'c-next', txHash: SWAP_HASH });
    wallets.execute.mockImplementationOnce(() => new Promise((r) => (land = r)));
    chain.receipt.mockResolvedValue(receipt('success', [transferLog(MEME, ROUTER, WALLET, 1n)]));

    const first = router.execute(buyReq({ actionId: 'slow' }));
    const second = await rejection(router.execute(buyReq({ actionId: 'queued' })));
    expect(second.message).toBe(TRADE_ERRORS.rateLimited);
    expect(wallets.execute).toHaveBeenCalledTimes(1);

    // A third trade queued now waits for the first, not for the one that
    // gave up, and runs once the first is done.
    const third = router.execute(buyReq({ actionId: 'third' }));
    await sleep(20);
    expect(wallets.execute).toHaveBeenCalledTimes(1);
    land({ circleTxId: 'c-slow', txHash: SWAP_HASH });
    await expect(first).resolves.toMatchObject({ txHash: SWAP_HASH });
    await expect(third).resolves.toMatchObject({ txHash: SWAP_HASH });
    expect(wallets.execute).toHaveBeenCalledTimes(2);
    expect(wallets.execute.mock.calls[1][0].idempotencyKey).toBe(stableUuid('third', 'swap'));
  });
});

describe('KyberRouter.execute when Circle throws', () => {
  function tradeWith(fault: unknown, lookup?: unknown, prior: Leg[] = []) {
    const t = setup({}, prior);
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    t.readContract.mockResolvedValue(10n ** 30n);
    t.wallets.execute.mockRejectedValueOnce(fault);
    if (lookup !== undefined) t.wallets.client.getTransaction.mockResolvedValue(lookup);
    return t;
  }

  it('marks a swap Circle failed before the chain as never sent, and retries it under a new key', async () => {
    const fault = new Error(`Transaction ${CIRCLE_ID} FAILED (ESTIMATION_ERROR): execution reverted`);
    const { router, wallets, saved } = tradeWith(fault, { data: { transaction: { id: CIRCLE_ID, state: 'FAILED' } } });

    const e = await rejection(router.execute(buyReq()));
    expect(e).toBeInstanceOf(CircleSendError);
    expect(e.message).toBe(fault.message);
    expect(wallets.client.getTransaction).toHaveBeenCalledWith({ id: CIRCLE_ID });
    const failed = { kind: 'swap', status: 'failed', circleTxId: CIRCLE_ID };
    expect(e.legs).toEqual([expect.objectContaining(failed)]);
    expect(saved[saved.length - 1]).toEqual([expect.objectContaining(failed)]);
    expect(e.legs[0].txHash).toBeUndefined();
    jest.restoreAllMocks();

    const retry = setup({}, e.legs);
    mockKyber({ routes: (q) => routesReply(q, 115_000n), build: (b) => buildReply(b) });
    retry.readContract.mockResolvedValue(10n ** 30n);
    retry.wallets.execute.mockResolvedValue({ circleTxId: 'c-2', txHash: SWAP_HASH });
    retry.chain.receipt.mockResolvedValue(receipt('success', [transferLog(MEME, ROUTER, WALLET, 9n)]));
    const out = await retry.router.execute(buyReq());
    expect(retry.wallets.execute.mock.calls[0][0].idempotencyKey).toBe(stableUuid('act-1', 'swap', '1'));
    expect(out.legs.map((l) => l.status)).toEqual(['failed', 'confirmed']);
  });

  it('settles from the chain when Circle failed a swap that has a hash', async () => {
    const fault = new Error(`Transaction ${CIRCLE_ID} FAILED (FAILED_ON_CHAIN)`);
    const { router, chain } = tradeWith(fault, { data: { transaction: { id: CIRCLE_ID, state: 'FAILED', txHash: SWAP_HASH } } });
    chain.receipt.mockResolvedValue(receipt('reverted'));

    const e = await rejection(router.execute(buyReq()));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/^Swap failed on chain: .*slippage/);
    expect(chain.receipt.mock.calls[0][0]).toBe(SWAP_HASH);
  });

  it('keeps a swap whose outcome is unknown as maybe sent', async () => {
    const { router, wallets } = tradeWith(new Error('The operation was aborted due to timeout'));
    const e = await rejection(router.execute(buyReq()));
    expect(e).toBeInstanceOf(CircleSendError);
    expect(e.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'pending' })]);
    expect(wallets.client.getTransaction).not.toHaveBeenCalled();
  });

  it('takes the fields Circle attaches to its error as the whole answer', async () => {
    const denied = Object.assign(new Error('denied'), { circleTxId: 'c-9', state: 'DENIED' });
    const a = tradeWith(denied);
    const e = await rejection(a.router.execute(buyReq()));
    expect(e.legs).toEqual([expect.objectContaining({ status: 'failed', circleTxId: 'c-9' })]);
    expect(a.wallets.client.getTransaction).not.toHaveBeenCalled();
    jest.restoreAllMocks();

    const hashed = Object.assign(new Error('failed'), { circleTxId: 'c-9', state: 'FAILED', txHash: SWAP_HASH });
    const b = tradeWith(hashed);
    b.chain.receipt.mockResolvedValue(receipt('success', [transferLog(MEME, ROUTER, WALLET, 3n)]));
    expect((await b.router.execute(buyReq())).amountOutRaw).toBe(3n);
  });

  it('treats a create Circle refused as never sent', async () => {
    const refused = Object.assign(new Error('Invalid call data'), { status: 400, method: 'POST' });
    const { router } = tradeWith(refused);
    const e = await rejection(router.execute(buyReq()));
    expect(e.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'failed' })]);

    jest.restoreAllMocks();
    const conflict = Object.assign(new Error('Idempotency key reused'), { status: 409, method: 'POST' });
    const again = tradeWith(conflict);
    const e2 = await rejection(again.router.execute(buyReq()));
    expect(e2.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'pending' })]);
  });
});

describe('KyberRouter.sellProbe', () => {
  it('quotes a USDC round trip without our fee', async () => {
    const { router } = setup({ SPOT_FEE_BPS: '100', FEE_RECIPIENT: FEE_WALLET });
    const fetchMock = mockKyber({
      routes: (q) => (q.get('tokenIn') === USDC ? routesReply(q, 115_894_682_949_432_557_568n) : routesReply(q, 979_733n)),
    });

    const p = await router.sellProbe(MEME, 1_000_000n);

    expect(p).toEqual({ buyOutRaw: 115_894_682_949_432_557_568n, sellBackUsdcRaw: 979_733n, roundTripLossPct: 2.03 });
    const second = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(second.get('tokenIn')).toBe(MEME);
    expect(second.get('amountIn')).toBe('115894682949432557568');
    expect(second.has('feeAmount')).toBe(false);
  });

  it('is null when the token cannot be sold back, and throws when KyberSwap cannot be asked', async () => {
    const { router } = setup();
    mockKyber({
      routes: (q) =>
        q.get('tokenIn') === USDC ? routesReply(q, 10n ** 21n) : { status: 400, body: { code: 4008, message: 'route not found' } },
    });
    await expect(router.sellProbe(MEME, 1_000_000n)).resolves.toBeNull();

    jest.restoreAllMocks();
    mockKyber({ routes: () => ({ status: 429, body: {} }) });
    const e = await rejection(router.sellProbe(MEME, 1_000_000n));
    expect(e.message).toBe(TRADE_ERRORS.rateLimited);
  });
});

/*
 * Real /route/build answers for WALLET, read-only (nothing signed or sent),
 * 2026-09-28. The buy: 1 USDC into ARCOON, 100 bps fee in on the USDC going
 * in to FEE_WALLET. The sell: 100 ARCOON back to USDC, 100 bps fee on the USDC
 * coming out. routeOut is /routes' amountOut the build was made from.
 */
const REAL_BUY = {
  routeOut: 114_532_711_714_588_950_528n,
  buildOut: '114532711714588950527',
  data: '0xe21fd0e900000000000000000000000000000000000000000000000000000000000000200000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f996000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000f2000000000000000000000000000000000000000000000000000000000000011a00000000000000000000000000000000000000000000000000000000000000e54d7a5c6b52756e795f680b0f7e0c2f21281dde6ef000000000000000000000000000f1b30000000000000000000000000000f1b30000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000410733547573255427ba01797519aa71372aacce92beb5cdda6a6344871faa305b564993308729543473447f9c80864d275b9b79daa4dcde01e1677a44a22b891b1b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d40000000000000000000000000abcdef0123456789abcdef0123456789abcdef01000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001a0000000000000000000000000000e59d4000000000000000000000000000fdc8c000000000000000000000000000f1b3000000000000000063575ee7bee4b80000000000000000000000000000000000000682ab998cf1c0000000f42400000000000000000000000000000001111110f0f73c0b2ef09ec012eae758b3e03a9020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006aba48db0000000000000000000000000000000000000000000000000000000000000d20000000000000000000000000000000000000000000000000000000000000000261f598cd00000000000000007b0e2e8300899b647d5ebc66f9d4fa3f16c5406191dd734600000000000000007b0e2e8300899b647d5ebc66f9d4fa3f16c54061000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000ae0000000000000000000000000360000000000000000000000000000000000000080000000000000000000000000000001000000000000000000000000000f1b30000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000076000000000000000000000000000000000000000000000000000000000000f1b304f2d31ea00000000000000014963a429d5154e6c773ed81bdc219380c2064fe900000000000000000000000000000000000000000000000000000000000000800000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f996000000000000000000000000000000000000000000000000000000000000068000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000063575ee7bee4b80000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002c0736e774d00000000000000008c899372ba1afcec0e2a4e9e208001de188b286e5e3bc7bc0000000000000000e5cf02f2b4a9a42a815b5ea2ac25e6759184321600000000000000000000000000000000000000000000000000000000000002200000000000000000000000008366a39cc670b4001a1121b8f6a443a643e409510000000000000000000000000000000000000000000000000000000000000101000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000360000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f1b300000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed0000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000007d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000110d1e4a700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000002c0736e774d00000000000000008c899372ba1afcec0e2a4e9e208001de188b286e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002200000000000000000000000008366a39cc670b4001a1121b8f6a443a643e409510000000000000000000000000000000000000000000000000000000000000101000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000360000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f1b300000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000173c4bdd5cf95a935d2b5636c573c5f4df06204400000000000000000000000000000000000000000000000000000000000000c00000000000000000000000050000000000000000000000000000000100eed0b50000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000f1b30736e774d00000000000000018c899372ba1afcec0e2a4e9e208001de188b286e00000000000000000000000000000000000000000000000000000000000000800000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f99600000000000000000000000000000000000000000000000000000000000002200000000000000000000000008366a39cc670b4001a1121b8f6a443a643e409510000000000000000000000000000000000000000000000000000000000000101000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000360000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f1b300000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000173c4bdd5cf95a935d2b5636c573c5f4df06204400000000000000000000000000000000000000000000000000000000000000c00000000000000000000000050000000000000000000000000000000100eed0b500000000000000000000000000000000000000000000000000000000000000000000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed800000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000036000000000000000000000000000000000000000000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000abcdef0123456789abcdef0123456789abcdef0100000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000062590e98a0d31251d0000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000000010000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f996000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000f1b300000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b87b22536f75726365223a227265766965772d726561646f6e6c79222c22416d6f756e74496e555344223a22302e393939383333222c22416d6f756e744f7574555344223a22302e393830303132222c22416d6f756e744f7574223a22313134353332373131373134353838393530353237222c22526f7574654944223a2239373031613865624c5a31456a4a57793a33373361613564386b594a46564c3769222c2254696d657374616d70223a313739303539323934337d0000000000000000',
};
const REAL_SELL = {
  routeOut: 837_647n,
  buildOut: '837645',
  data: '0xe21fd0e900000000000000000000000000000000000000000000000000000000000000200000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f996000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000ac00000000000000000000000000000000000000000000000000000000000000d4000000000000000000000000000000000000000000000000000000000000009f4d7a5c6b52756e795f680b0f7e0c2f21281dde6ef00000000000000056bc75e2d6310000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000041f495203fbc4b45caa138668290af4653d90eef7255e6eed5a6ef4e46e1b9497409037fbd309ac4c30ef9d1a3b82438b7bbcab8d281423ded27a306d1091ba3561c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008e00000000000000000000000006131b5fae19ea4f9d964eac0408e4408b66337b5000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001a000000000000000052663ccab1e1c00000000000000000005b12aefafa804000000000000000000056bc75e2d63100000000000000000000000000000000ce91c00000000000000000000000000000000000000000000010000000f42400000000000000000000000000000001111110f0f73c0b2ef09ec012eae758b3e03a9020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006aba4cad00000000000000000000000000000000000000000000000000000000000008c0000000000000000000000000000000000000000000000000000000000000000261f598cd00000000000000007b0e2e8300899b647d5ebc66f9d4fa3f16c5406191dd734600000000000000007b0e2e8300899b647d5ebc66f9d4fa3f16c540610000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000006800000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed800000000000000000005af3107a400000000000000000056bc75e2d6310000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000056bc75e2d63100000736e774d00000000000000018c899372ba1afcec0e2a4e9e208001de188b286e00000000000000000000000000000000000000000000000000000000000000800000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f99600000000000000000000000000000000000000000000000000000000000002200000000000000000000000008366a39cc670b4001a1121b8f6a443a643e4095100000000000000000000000000000000000000000000000000000000000001010000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed0000000000000000000000000000000000000000000000056bc75e2d631000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000003600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000173c4bdd5cf95a935d2b5636c573c5f4df06204400000000000000000000000000000000000000000000000000000000000000c0000000000000000000000005ff120d460d67f1db5b71087bd404babb342b598600000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000056bc75e2d63100000736e774d00000000000000018c899372ba1afcec0e2a4e9e208001de188b286e00000000000000000000000000000000000000000000000000000000000000800000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f99600000000000000000000000000000000000000000000000000000000000002200000000000000000000000008366a39cc670b4001a1121b8f6a443a643e4095100000000000000000000000000000000000000000000000000000000000001010000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed0000000000000000000000000000000000000000000000056bc75e2d631000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000003600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000173c4bdd5cf95a935d2b5636c573c5f4df06204400000000000000000000000000000000000000000000000000000000000000c0000000000000000000000005ff120d460d67f1db5b71087bd404babb342b59860000000000000000000000000000000000000000000000000000000000000000000000000000000000000000360000000000000000000000000000000000000080000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004621a0baa0b5d97aae77704cf2a84dabe78a4fed0000000000000000000000003600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000abcdef0123456789abcdef0123456789abcdef010000000000000000000000000000000000000000000000056bc75e2d6310000000000000000000000000000000000000000000000000000000000000000ca75400000000000000000000000000000000000000000000000000000000000002c0000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000000010000000000000000000000008f10b468b06c6fd214b65f87778827f7d113f99600000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000056bc75e2d631000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a47b22536f75726365223a22706f7070696e2d617263222c22416d6f756e74496e555344223a22302e383534353739222c22416d6f756e744f7574555344223a22302e383337353035222c22416d6f756e744f7574223a22383337363435222c22526f7574654944223a22613861366563396167396841467152553a38396362333332374b714a504f713445222c2254696d657374616d70223a313739303539333932327d00000000000000000000000000000000000000000000000000000000',
};
