import { ConflictException, HttpException } from '@nestjs/common';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Hash } from 'viem';
import type { ArcChain } from '../arc/chain';
import type { CircleKit } from '../circle/kit';
import { loadConfig, type AppConfig } from '../config';
import { lower, TRADE_ERRORS, type Address, type ExecuteRequest, type Leg } from '../trade/types';
import {
  CircleSwapRouter,
  DEFAULT_SLIPPAGE_BPS,
  impactFrom,
  slippageBpsFrom,
  swapSendState,
  SwapNotCompleted,
} from './circle-swap.router';

// App Kit's bundle pulls ESM-only dependencies Jest will not load. The router
// only needs the class as a DI token; every test hands it a plain object.
jest.mock('../circle/kit', () => ({ CircleKit: class CircleKit {} }));

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const FEE_TO = '0x2222222222222222222222222222222222222222' as Address;
const SPENDER = '0x3333333333333333333333333333333333333333' as Address;
const SWAP_HASH = `0x${'ab'.repeat(32)}` as Hash;
const APPROVE_HASH = `0x${'cd'.repeat(32)}` as Hash;
const OTHER_HASH = `0x${'ef'.repeat(32)}` as Hash;
/** App Kit's swap contract on Arc mainnet (kitContracts.adapter); every kit swap pulls its input into it. */
const KIT_ADAPTER = '0x7fb8c7260b63934d8da38af902f87ae6e284a845' as Address;

const base = loadConfig({ ARC_NETWORK: 'mainnet', SPOT_FEE_BPS: '100', FEE_RECIPIENT: FEE_TO });
const USDC = lower(base.network.usdc.address);
const EURC = lower(base.network.eurc.address);
const BTC = lower(base.network.cirbtc.address);

function kitError(code: number, name: string, trace?: Record<string, unknown>): Error {
  return Object.assign(new Error(name), {
    code,
    name,
    type: 'TEST',
    recoverability: 'FATAL',
    cause: trace ? { trace } : undefined,
  });
}

function transferLog(token: string, from: Address, to: Address, value: bigint, hash: Hash = SWAP_HASH) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: 101n,
    blockHash: `0x${'00'.repeat(32)}`,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

function receipt(
  status: 'success' | 'reverted',
  logs: unknown[] = [],
  hash: Hash = SWAP_HASH,
  effectiveGasPrice: bigint | null = 20_000_000_000n,
) {
  // 200k gas at 20 gwei: 0.004 USDC.
  return { status, logs, gasUsed: 200_000n, effectiveGasPrice, blockNumber: 101n, transactionHash: hash };
}

/** getLogs answering only the Transfer query, with these (hash, value) pairs out of the wallet. */
function transfersOut(...rows: [Hash, bigint][]) {
  return async ({ event }: { event: { name: string } }) =>
    event.name === 'Transfer'
      ? rows.map(([transactionHash, value]) => ({ transactionHash, args: { from: WALLET, to: KIT_ADAPTER, value } }))
      : [];
}

/** A receipt that paid EURC back to the wallet, as a real kit swap does. */
const paidBack = (hash: Hash = SWAP_HASH) =>
  receipt('success', [transferLog(EURC, KIT_ADAPTER, WALLET, 8_500_000n, hash)], hash);

const never = () => new Promise<never>(() => undefined);

function setup(over: Partial<AppConfig> = {}) {
  const kit = { estimateSwap: jest.fn(), swap: jest.fn(), getTokenRates: jest.fn() };
  const adapter = { name: 'circle-wallets-adapter' };
  const circle = { kit, adapter, arcChain: 'Arc' } as unknown as CircleKit;
  const client = { getBlockNumber: jest.fn().mockResolvedValue(100n), getLogs: jest.fn().mockResolvedValue([]) };
  const chainMock = { client, receipt: jest.fn(), balancesOf: jest.fn() };
  const router = new CircleSwapRouter({ ...base, ...over }, circle, chainMock as unknown as ArcChain);
  kit.getTokenRates.mockResolvedValue({
    rates: {
      Arc: {
        [USDC]: { priceUSD: '1', fetchedAt: 0 },
        [EURC]: { priceUSD: '1.17', fetchedAt: 0 },
        [BTC]: { priceUSD: '83000', fetchedAt: 0 },
      },
    },
  });
  return { router, kit, adapter, client, chain: chainMock };
}

function balances(map: Record<string, bigint>) {
  return async (_owner: string, tokens: string[]) =>
    new Map(tokens.map((t) => [t.toLowerCase(), map[t.toLowerCase()] ?? 0n] as [string, bigint]));
}

const buy = (over: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  uid: 'u1',
  walletId: 'w1',
  walletAddress: WALLET,
  tokenIn: USDC,
  tokenOut: EURC,
  amountInRaw: 10_000_000n,
  actionId: 'a1',
  ...over,
});

async function thrown(p: Promise<unknown>): Promise<SwapNotCompleted | HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('expected a throw');
}

beforeEach(() => {
  delete process.env.ARC_SLIPPAGE_BPS;
});

describe('supports', () => {
  it('takes any two different Circle assets, in any casing', () => {
    const { router } = setup();
    expect(router.supports(USDC, EURC)).toBe(true);
    expect(router.supports(base.network.cirbtc.address, USDC)).toBe(true);
    expect(router.supports(EURC, BTC)).toBe(true);
    expect(router.supports(USDC, USDC)).toBe(false);
    expect(router.supports(USDC, '0x4444444444444444444444444444444444444444')).toBe(false);
  });
});

describe('quote', () => {
  it('asks App Kit in registry symbols and human units, with slippage and our fee', async () => {
    const { router, kit, adapter } = setup();
    kit.estimateSwap.mockResolvedValue({
      estimatedOutput: { token: 'EURC', amount: '8.5' },
      stopLimit: { token: 'EURC', amount: '8.4575' },
      fees: [{ token: 'USDC', amount: '0.1', type: 'developer' }],
    });

    const q = await router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 10_000_000n, from: WALLET });

    expect(kit.estimateSwap).toHaveBeenCalledWith({
      from: { adapter, chain: 'Arc', address: WALLET },
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      config: {
        slippageBps: DEFAULT_SLIPPAGE_BPS,
        allowanceStrategy: 'permit',
        customFee: { percentageBps: 100, recipientAddress: FEE_TO },
      },
    });
    expect(q).toMatchObject({
      venue: 'circle-swap',
      tokenIn: USDC,
      tokenOut: EURC,
      amountInRaw: 10_000_000n,
      amountOutRaw: 8_500_000n,
      minAmountOutRaw: 8_457_500n,
      route: ['Circle'],
    });
    // In $10. Out 8.5 EURC at $1.17 = $9.945, plus our $0.10 fee added back =
    // $10.045: better than market, so no impact.
    expect(q.priceImpactPct).toBe(0);
  });

  it('measures impact against Circle rates without counting our fee', async () => {
    const { router, kit } = setup();
    kit.estimateSwap.mockResolvedValue({
      estimatedOutput: { token: 'CIRBTC', amount: '0.00011' },
      stopLimit: { token: 'CIRBTC', amount: '0.000109' },
      fees: [{ token: 'USDC', amount: '0.1', type: 'developer' }, { token: 'USDC', amount: '0.2', type: 'swap' }],
    });

    const q = await router.quote({ tokenIn: USDC, tokenOut: BTC, amountInRaw: 10_000_000n });

    // 0.00011 BTC at $83,000 = $9.13, plus $0.10 fee = $9.23 of $10: 7.7%.
    expect(q.priceImpactPct).toBe(7.7);
    expect(q.amountOutRaw).toBe(11_000n);
    expect(Number.isFinite(q.priceImpactPct)).toBe(true);
  });

  it('prices before sign-in with a stand-in sender and leaves out the fee when it is not configured', async () => {
    const { router, kit } = setup({ feeBps: 0 });
    kit.estimateSwap.mockResolvedValue({ estimatedOutput: { amount: '8.5' }, stopLimit: { amount: '8.45' } });
    await router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 1_000_000n });
    const params = kit.estimateSwap.mock.calls[0][0];
    expect(params.from.address).toBe('0x000000000000000000000000000000000000dead');
    expect(params.config).not.toHaveProperty('customFee');
    expect(params.amountIn).toBe('1');
  });

  it('gives impact 0 when rates are unavailable, and derives the floor from slippage if no stop limit', async () => {
    const { router, kit } = setup();
    kit.getTokenRates.mockRejectedValue(new Error('down'));
    kit.estimateSwap.mockResolvedValue({ estimatedOutput: { amount: '8.5' } });
    const q = await router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 10_000_000n });
    expect(q.priceImpactPct).toBe(0);
    expect(q.minAmountOutRaw).toBe((8_500_000n * 9_950n) / 10_000n);
  });

  it('shares one rates call across quotes', async () => {
    const { router, kit } = setup();
    kit.estimateSwap.mockResolvedValue({ estimatedOutput: { amount: '8.5' }, stopLimit: { amount: '8.45' } });
    await Promise.all([
      router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 1_000_000n }),
      router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 2_000_000n }),
    ]);
    await router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 3_000_000n });
    expect(kit.getTokenRates).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1013, 'INPUT_AMOUNT_OUT_OF_RANGE', 400, TRADE_ERRORS.tooSmall],
    [1007, 'INPUT_INSUFFICIENT_SWAP_AMOUNT', 400, TRADE_ERRORS.tooSmall],
    [6001, 'LIQUIDITY_INSUFFICIENT', 422, TRADE_ERRORS.noRoute],
    [1003, 'INPUT_UNSUPPORTED_ROUTE', 422, TRADE_ERRORS.noRoute],
    [7001, 'RATE_LIMIT_EXCEEDED', 422, TRADE_ERRORS.rateLimited],
    [8001, 'SERVICE_INTERNAL_ERROR', 422, TRADE_ERRORS.quoteUnavailable],
  ])('maps kit error %i to the sentence the extension knows', async (code, name, status, message) => {
    const { router, kit } = setup();
    kit.estimateSwap.mockRejectedValue(kitError(code, name));
    const e = await thrown(router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 1_000_000n }));
    expect(e.getStatus()).toBe(status);
    expect(e.message).toBe(message);
  });

  it('reads the balance to word a balance error', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 2_500_000n }));
    kit.estimateSwap.mockRejectedValue(kitError(9001, 'BALANCE_INSUFFICIENT_TOKEN'));
    const e = await thrown(router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 10_000_000n, from: WALLET }));
    expect(e.getStatus()).toBe(400);
    expect(e.message).toBe('Insufficient USDC: wallet holds $2.50, needs $10.00');
  });

  it('turns anything else into Quote unavailable, and refuses unknown pairs and zero', async () => {
    const { router, kit } = setup();
    kit.estimateSwap.mockRejectedValue(new Error('socket hang up'));
    let e = await thrown(router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 1n }));
    expect([e.getStatus(), e.message]).toEqual([422, TRADE_ERRORS.quoteUnavailable]);
    e = await thrown(router.quote({ tokenIn: USDC, tokenOut: USDC, amountInRaw: 1n }));
    expect([e.getStatus(), e.message]).toEqual([422, TRADE_ERRORS.noRoute]);
    e = await thrown(router.quote({ tokenIn: USDC, tokenOut: EURC, amountInRaw: 0n }));
    expect([e.getStatus(), e.message]).toEqual([400, TRADE_ERRORS.tooSmall]);
  });

  it('uses approve for smart accounts, whose signatures a permit rejects', async () => {
    const { router, kit } = setup({ circle: { ...base.circle, accountType: 'SCA' } });
    kit.estimateSwap.mockResolvedValue({ estimatedOutput: { amount: '1' }, stopLimit: { amount: '1' } });
    await router.quote({ tokenIn: EURC, tokenOut: USDC, amountInRaw: 1_000_000n });
    expect(kit.estimateSwap.mock.calls[0][0].config.allowanceStrategy).toBe('approve');
  });
});

describe('execute', () => {
  it('confirms from the receipt, reads the fill from Transfer logs and finds the approval', async () => {
    const { router, kit, client, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [EURC]: 20_000_000n }));
    client.getLogs.mockImplementation(async ({ event }: { event: { name: string } }) =>
      event.name === 'Approval'
        ? [
            { transactionHash: APPROVE_HASH, args: { owner: WALLET, spender: SPENDER } },
            // A permit inside the swap emits Approval too; it is not a leg.
            { transactionHash: SWAP_HASH, args: { owner: WALLET, spender: SPENDER } },
          ]
        : [],
    );
    kit.swap.mockResolvedValue({ txHash: SWAP_HASH.toUpperCase().replace('0X', '0x'), amountOut: '9.9' });
    chain.receipt.mockImplementation(async (hash: string) =>
      hash === APPROVE_HASH
        ? receipt('success', [], APPROVE_HASH)
        : receipt('success', [
            transferLog(EURC, WALLET, SPENDER, 10_000_000n),
            transferLog(USDC, SPENDER, WALLET, 11_654_321n),
          ]),
    );
    const beforeSend = jest.fn();

    const out = await router.execute(buy({ tokenIn: EURC, tokenOut: USDC }), { beforeSend });

    expect(beforeSend).toHaveBeenCalledWith([expect.objectContaining({ kind: 'swap', status: 'pending', chain: 'ARC' })]);
    expect(beforeSend.mock.invocationCallOrder[0]).toBeLessThan(kit.swap.mock.invocationCallOrder[0]);
    expect(out.venue).toBe('circle-swap');
    expect(out.txHash).toBe(SWAP_HASH);
    // The chain says 11.654321, not the service's 9.9.
    expect(out.amountOutRaw).toBe(11_654_321n);
    expect(out.legs).toEqual([
      expect.objectContaining({ kind: 'approve', status: 'confirmed', txHash: APPROVE_HASH, gasUsdcRaw: '4000' }),
      expect.objectContaining({ kind: 'swap', status: 'confirmed', txHash: SWAP_HASH, gasUsdcRaw: '4000' }),
    ]);
    expect(client.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ address: base.network.eurc.address, args: { owner: WALLET }, fromBlock: 100n, toBlock: 101n }),
    );
    expect(swapSendState(out.legs)).toBe('sent');
  });

  it('falls back to the reported amount when the receipt has no Transfer to the wallet', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockResolvedValue({ txHash: SWAP_HASH, amountOut: '8.5' });
    chain.receipt.mockResolvedValue(receipt('success'));
    const out = await router.execute(buy());
    expect(out.amountOutRaw).toBe(8_500_000n);
  });

  it('refuses a short balance before sending anything, with no legs to overwrite the row', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 2_500_000n }));
    const beforeSend = jest.fn();
    const e = await thrown(router.execute(buy(), { beforeSend }));
    expect(e).not.toBeInstanceOf(SwapNotCompleted);
    expect([e.getStatus(), e.message]).toEqual([400, 'Insufficient USDC: wallet holds $2.50, needs $10.00']);
    expect(kit.swap).not.toHaveBeenCalled();
    expect(beforeSend).not.toHaveBeenCalled();
  });

  it('rounds a USDC shortfall so it never reads as enough', async () => {
    const { router, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 9_996_000n }));
    const e = await thrown(router.execute(buy()));
    expect(e.message).toBe('Insufficient USDC: wallet holds $9.99, needs $10.00');
  });

  it('words a short sell balance in the sell sentence, never with the digits 401', async () => {
    const { router, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [BTC]: 5_000n }));
    let e = await thrown(router.execute(buy({ tokenIn: BTC, tokenOut: USDC, amountInRaw: 10_000n })));
    expect(e.message).toBe('Insufficient balance: wallet holds 0.00005, sell asked for more');

    // 0.00401 cirBTC would read as "signed out" on the chip's sell path.
    chain.balancesOf.mockImplementation(balances({ [BTC]: 401_000n }));
    e = await thrown(router.execute(buy({ tokenIn: BTC, tokenOut: USDC, amountInRaw: 1_000_000n, actionId: 'a2' })));
    expect(e.message).toBe('Insufficient balance: wallet holds 0.004009, sell asked for more');
    expect(e.message).not.toMatch(/401/);
  });

  it('rounds the gas shortfall sentence the same way', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(async (_o: string, tokens: string[]) =>
      new Map(tokens.map((t) => [t.toLowerCase(), t.toLowerCase() === EURC ? 10_000_000n : 3_996n] as [string, bigint])),
    );
    kit.swap.mockRejectedValue(kitError(9002, 'BALANCE_INSUFFICIENT_GAS'));
    const e = (await thrown(router.execute(buy({ tokenIn: EURC, tokenOut: USDC })))) as SwapNotCompleted;
    expect([e.getStatus(), e.message, e.sendState]).toEqual([
      400,
      'Insufficient USDC: wallet holds $0.00, needs $0.01',
      'not-sent',
    ]);
  });

  it('does not send when the caller cannot record the attempt', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    await expect(
      router.execute(buy(), { beforeSend: () => Promise.reject(new Error('db down')) }),
    ).rejects.toThrow('db down');
    expect(kit.swap).not.toHaveBeenCalled();
  });

  it('marks a refusal before broadcast as a failed leg with no hash, safe to retry', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(kitError(1013, 'INPUT_AMOUNT_OUT_OF_RANGE'));
    const e = (await thrown(router.execute(buy()))) as SwapNotCompleted;
    expect([e.getStatus(), e.message, e.sendState]).toEqual([400, TRADE_ERRORS.tooSmall, 'not-sent']);
    expect(e.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'failed' })]);
    expect(e.legs[0].txHash).toBeUndefined();
    expect(router.mayHaveSent(e.legs)).toBe(false);
  });

  it('answers a price move before sending with the slippage sentence', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(kitError(1009, 'INPUT_SLIPPAGE_CONSTRAINT_NOT_MET'));
    const e = (await thrown(router.execute(buy()))) as SwapNotCompleted;
    expect([e.getStatus(), e.message, e.sendState]).toEqual([
      422,
      'The price moved past the slippage limit. Press again.',
      'not-sent',
    ]);
    // Safe to retry under the same action.
    kit.swap.mockResolvedValue({ txHash: SWAP_HASH });
    chain.receipt.mockResolvedValue(paidBack());
    await expect(router.execute(buy())).resolves.toMatchObject({ txHash: SWAP_HASH });
  });

  it('reports a revert with its hash and gas, in the buy or sell sentence', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n, [EURC]: 10_000_000n }));
    chain.receipt.mockResolvedValue(receipt('reverted'));

    kit.swap.mockRejectedValue(kitError(5001, 'ONCHAIN_TRANSACTION_REVERTED', { txHash: SWAP_HASH }));
    let e = (await thrown(router.execute(buy()))) as SwapNotCompleted;
    expect([e.getStatus(), e.message, e.sendState]).toEqual([
      400,
      'Swap failed on chain: the transaction reverted',
      'sent',
    ]);
    expect(e.legs).toEqual([
      expect.objectContaining({ kind: 'swap', status: 'failed', txHash: SWAP_HASH, gasUsdcRaw: '4000' }),
    ]);

    kit.swap.mockRejectedValue(kitError(1009, 'INPUT_SLIPPAGE_CONSTRAINT_NOT_MET', { txHash: SWAP_HASH }));
    e = (await thrown(router.execute(buy({ tokenIn: EURC, tokenOut: USDC })))) as SwapNotCompleted;
    expect(e.message).toBe('Sell failed on chain: the price moved past the slippage limit');
  });

  it('believes the receipt over a kit timeout that carried the hash', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(kitError(3002, 'NETWORK_TIMEOUT', { txHash: SWAP_HASH }));
    chain.receipt.mockResolvedValue(receipt('success', [transferLog(EURC, SPENDER, WALLET, 8_500_000n)]));
    const out = await router.execute(buy());
    expect(out.amountOutRaw).toBe(8_500_000n);
    expect(out.legs.at(-1)).toMatchObject({ kind: 'swap', status: 'confirmed', txHash: SWAP_HASH });
  });

  it('confirms a swap whose receipt has no gas price, leaving gas out of the leg', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockResolvedValue({ txHash: SWAP_HASH });
    chain.receipt.mockResolvedValue(
      receipt('success', [transferLog(EURC, KIT_ADAPTER, WALLET, 8_500_000n)], SWAP_HASH, null),
    );
    const out = await router.execute(buy());
    expect(out.amountOutRaw).toBe(8_500_000n);
    expect(out.legs.at(-1)).toMatchObject({ kind: 'swap', status: 'confirmed', txHash: SWAP_HASH });
    expect(out.legs.at(-1)).not.toHaveProperty('gasUsdcRaw');
  });

  it('returns a sent swap when the receipt is not there yet', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockResolvedValue({ txHash: SWAP_HASH });
    chain.receipt.mockRejectedValue(new Error('timed out'));
    const out = await router.execute(buy());
    expect(out).toMatchObject({ txHash: SWAP_HASH, amountOutRaw: 0n });
    expect(out.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'sent', txHash: SWAP_HASH })]);
  });

  it('finds a swap the kit lost track of: input into the kit contract, output back to the wallet', async () => {
    const { router, kit, client, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(new Error('Transaction 9f0 STUCK'));
    client.getLogs.mockImplementation(transfersOut([APPROVE_HASH, 3n], [SWAP_HASH, 10_000_000n]));
    chain.receipt.mockResolvedValue(paidBack());
    const ownedElsewhere = jest.fn().mockResolvedValue(false);
    const out = await router.execute(buy(), { ownedElsewhere });
    expect(out.txHash).toBe(SWAP_HASH);
    expect(out.amountOutRaw).toBe(8_500_000n);
    expect(client.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: base.network.usdc.address,
        args: { from: WALLET, to: KIT_ADAPTER },
        fromBlock: 100n,
      }),
    );
    expect(ownedElsewhere).toHaveBeenCalledWith(SWAP_HASH);
  });

  it('does not claim a matching transfer that paid nothing back to the wallet', async () => {
    const { router, kit, client, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(kitError(3001, 'NETWORK_ERROR'));
    client.getLogs.mockImplementation(transfersOut([SWAP_HASH, 10_000_000n]));
    chain.receipt.mockResolvedValue(receipt('success', [transferLog(USDC, WALLET, KIT_ADAPTER, 10_000_000n)]));
    const e = (await thrown(router.execute(buy()))) as SwapNotCompleted;
    expect([e.getStatus(), e.sendState]).toEqual([409, 'maybe-sent']);
  });

  it('stays maybe-sent when two swaps of the same amount match', async () => {
    const { router, kit, client, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(kitError(3001, 'NETWORK_ERROR'));
    client.getLogs.mockImplementation(transfersOut([OTHER_HASH, 10_000_000n], [SWAP_HASH, 10_000_000n]));
    chain.receipt.mockImplementation(async (h: Hash) => paidBack(h));
    const e = (await thrown(router.execute(buy()))) as SwapNotCompleted;
    expect([e.getStatus(), e.sendState]).toEqual([409, 'maybe-sent']);
  });

  it('skips a hash another action holds, and stays maybe-sent when the ledger cannot say', async () => {
    const { router, kit, client, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(kitError(3001, 'NETWORK_ERROR'));
    client.getLogs.mockImplementation(transfersOut([OTHER_HASH, 10_000_000n], [SWAP_HASH, 10_000_000n]));
    chain.receipt.mockImplementation(async (h: Hash) => paidBack(h));

    const out = await router.execute(buy(), { ownedElsewhere: (h) => h === OTHER_HASH });
    expect(out.txHash).toBe(SWAP_HASH);

    const e = (await thrown(
      router.execute(buy({ actionId: 'a2' }), {
        ownedElsewhere: () => Promise.reject(new Error('db down')),
      }),
    )) as SwapNotCompleted;
    expect([e.getStatus(), e.sendState]).toEqual([409, 'maybe-sent']);
  });

  it('never takes over the swap of an earlier press of the same amount that is still sending', async () => {
    const { router, kit, client, chain } = setup();
    router.budgetMs = 60;
    router.settleReserveMs = 40;
    router.minSendMs = 1;
    chain.balancesOf.mockImplementation(balances({ [USDC]: 20_000_000n }));
    chain.receipt.mockResolvedValue(paidBack());

    // Press A: the kit outlives the wait and keeps going.
    let finishA!: (r: unknown) => void;
    kit.swap.mockReturnValueOnce(new Promise((resolve) => (finishA = resolve)));
    const onLate = jest.fn();
    const a = (await thrown(router.execute(buy({ actionId: 'A' }), { onLate }))) as SwapNotCompleted;
    expect(a.sendState).toBe('maybe-sent');

    // Press B, same amount: its kit fails without a hash, and A's swap lands on chain.
    router.budgetMs = 60_000;
    router.settleReserveMs = 8_000;
    kit.swap.mockRejectedValueOnce(kitError(3001, 'NETWORK_ERROR'));
    client.getLogs.mockImplementation(transfersOut([SWAP_HASH, 10_000_000n]));
    const b = (await thrown(router.execute(buy({ actionId: 'B' })))) as SwapNotCompleted;
    expect([b.getStatus(), b.sendState]).toEqual([409, 'maybe-sent']);

    // A's own late word still carries its hash.
    finishA({ txHash: SWAP_HASH });
    await new Promise((r) => setTimeout(r, 20));
    expect(onLate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ txHash: SWAP_HASH }));
  });

  it('refuses a twin of an action that is already sending, without legs', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    let finish!: (r: unknown) => void;
    kit.swap.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    chain.receipt.mockResolvedValue(paidBack());

    const first = router.execute(buy());
    const twin = await thrown(router.execute(buy()));
    expect(twin).toBeInstanceOf(ConflictException);
    expect(twin).not.toHaveProperty('legs');
    expect(twin.message).toBe(TRADE_ERRORS.idempotencyConflict);

    finish({ txHash: SWAP_HASH });
    await expect(first).resolves.toMatchObject({ txHash: SWAP_HASH });
    expect(kit.swap).toHaveBeenCalledTimes(1);
  });

  it('answers 409 and leaves the action maybe-sent when neither kit nor chain can tell', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockRejectedValue(new Error('socket hang up'));
    const e = (await thrown(router.execute(buy()))) as SwapNotCompleted;
    expect([e.getStatus(), e.message, e.sendState]).toEqual([409, TRADE_ERRORS.idempotencyConflict, 'maybe-sent']);
    expect(e.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'pending' })]);
    expect(router.mayHaveSent(e.legs)).toBe(true);
  });

  it('answers sent at the deadline instead of waiting on a slow receipt', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    router.settleReserveMs = 100;
    router.minSendMs = 1;
    kit.swap.mockImplementation(() => new Promise((r) => setTimeout(() => r({ txHash: SWAP_HASH }), 50)));
    chain.receipt.mockImplementation(never);
    const started = Date.now();

    const out = await router.execute(buy(), { deadlineAt: started + 200 });

    expect(Date.now() - started).toBeLessThan(400);
    expect(out.legs).toEqual([expect.objectContaining({ kind: 'swap', status: 'sent', txHash: SWAP_HASH })]);
    // The receipt wait was cut to what was left, not the usual 30 s.
    expect(chain.receipt.mock.calls[0][1]).toBeLessThanOrEqual(200);
  });

  it('keeps the whole answer within the budget when the kit and the chain both stall', async () => {
    const { router, kit, client, chain } = setup();
    router.budgetMs = 200;
    router.settleReserveMs = 100;
    router.minSendMs = 1;
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    kit.swap.mockImplementation(never);
    client.getLogs.mockImplementation(never);
    const started = Date.now();
    const e = (await thrown(router.execute(buy()))) as SwapNotCompleted;
    expect(Date.now() - started).toBeLessThan(400);
    expect([e.getStatus(), e.sendState]).toEqual([409, 'maybe-sent']);
  });

  it('does not start a swap it has no time to finish', async () => {
    const { router, kit, chain } = setup();
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    const beforeSend = jest.fn();
    const e = await thrown(router.execute(buy(), { beforeSend, deadlineAt: Date.now() + 1_000 }));
    expect([e.getStatus(), e.message]).toEqual([503, 'Trading is unavailable for a moment. Nothing was charged.']);
    expect(e).not.toBeInstanceOf(SwapNotCompleted);
    expect(beforeSend).not.toHaveBeenCalled();
    expect(kit.swap).not.toHaveBeenCalled();
  });

  it('reports a swap that outlives the wait through onLate, after execute answered', async () => {
    const { router, kit, chain } = setup();
    router.budgetMs = 50;
    router.settleReserveMs = 40;
    router.minSendMs = 1;
    chain.balancesOf.mockImplementation(balances({ [USDC]: 10_000_000n }));
    let finish!: (r: unknown) => void;
    kit.swap.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    chain.receipt.mockResolvedValue(receipt('success', [transferLog(EURC, SPENDER, WALLET, 8_500_000n)]));
    const late = new Promise<[Leg[], unknown]>((resolve) => {
      void router
        .execute(buy(), { onLate: (legs, executed) => resolve([legs, executed]) })
        .catch((e: SwapNotCompleted) => {
          expect(e.sendState).toBe('maybe-sent');
          finish({ txHash: SWAP_HASH });
        });
    });
    const [legs, executed] = await late;
    expect(legs.at(-1)).toMatchObject({ kind: 'swap', status: 'confirmed', txHash: SWAP_HASH });
    expect(executed).toMatchObject({ txHash: SWAP_HASH, amountOutRaw: 8_500_000n });
  });
});

describe('swapSendState', () => {
  const leg = (l: Partial<Leg>): Leg => ({ kind: 'swap', status: 'pending', chain: 'ARC', ...l });

  it('says not-sent only when every swap leg failed without a hash', () => {
    expect(swapSendState([])).toBe('not-sent');
    expect(swapSendState([leg({ kind: 'approve', status: 'confirmed', txHash: APPROVE_HASH })])).toBe('not-sent');
    expect(swapSendState([leg({ status: 'failed' })])).toBe('not-sent');
  });

  it('says maybe-sent for a swap leg with no hash that did not fail', () => {
    expect(swapSendState([leg({ status: 'pending' })])).toBe('maybe-sent');
    expect(swapSendState([leg({ status: 'failed' }), leg({ status: 'sent' })])).toBe('maybe-sent');
  });

  it('says sent whenever a swap leg has a hash, even a failed one', () => {
    expect(swapSendState([leg({ status: 'failed', txHash: SWAP_HASH })])).toBe('sent');
    expect(swapSendState([leg({ status: 'pending' }), leg({ status: 'confirmed', txHash: SWAP_HASH })])).toBe('sent');
  });
});

describe('slippage and impact helpers', () => {
  it('reads ARC_SLIPPAGE_BPS safely', () => {
    expect(slippageBpsFrom({})).toEqual({ bps: 50, ignored: null });
    expect(slippageBpsFrom({ ARC_SLIPPAGE_BPS: '75' })).toEqual({ bps: 75, ignored: null });
    expect(slippageBpsFrom({ ARC_SLIPPAGE_BPS: '<bps>' })).toEqual({ bps: 50, ignored: null });
    expect(slippageBpsFrom({ ARC_SLIPPAGE_BPS: 'abc' })).toEqual({ bps: 50, ignored: 'abc' });
    expect(slippageBpsFrom({ ARC_SLIPPAGE_BPS: '0' })).toEqual({ bps: 50, ignored: '0' });
    expect(slippageBpsFrom({ ARC_SLIPPAGE_BPS: '12.5' })).toEqual({ bps: 50, ignored: '12.5' });
  });

  it('takes slippage from AppConfig, which reads ARC_SLIPPAGE_BPS', async () => {
    expect(setup({ slippageBps: 30 } as Partial<AppConfig>).router.slippageBps).toBe(30);
    expect(loadConfig({ ARC_SLIPPAGE_BPS: '80' }).slippageBps).toBe(80);
    expect(loadConfig({}).slippageBps).toBe(50);
  });

  it('keeps impact finite and within 0..100', () => {
    expect(impactFrom(10, 9.9)).toBe(1);
    expect(impactFrom(10, 11)).toBe(0);
    expect(impactFrom(0, 1)).toBe(0);
    expect(impactFrom(Number.NaN, 1)).toBe(0);
    expect(impactFrom(10, Number.POSITIVE_INFINITY)).toBe(0);
    expect(impactFrom(10, -5)).toBe(100);
  });
});
