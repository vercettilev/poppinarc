import { Logger } from '@nestjs/common';
import { decodeFunctionData, erc20Abi, keccak256, pad, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '../config';
import type { RemoteListing } from '../routes/remote-tokens';
import { circleAccount } from './circle-account';
import { FAR_NETWORKS, FORWARD_HOOK, tokenMessengerAbi } from './far-chains';
import { ACCOUNT_RESERVE_RAW, FarTrades, type FarStep } from './far-trades';
import type { Bundler } from './user-ops';

beforeAll(() => Logger.overrideLogger(false));

const owner = privateKeyToAccount(keccak256(toHex('far-trades-owner')));
const OWNER = owner.address.toLowerCase() as Hex;
const ACCOUNT = circleAccount(OWNER).address.toLowerCase() as Hex;
const BASE = FAR_NETWORKS.mainnet.chains.base;
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const BRETT = '0x532f27101965dd16442e59d40670faf5ebb142e4' as Hex;
const ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5' as Hex;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BURN_HASH = `0x${'b'.repeat(64)}` as Hex;
const OP_HASH = `0x${'c'.repeat(64)}` as Hex;
const TX_HASH = `0x${'d'.repeat(64)}` as Hex;

const listing = (address: string, chain: 'base' | 'ethereum' = 'base'): RemoteListing => ({
  asset: { key: `${chain}:${address}`, ticker: 'BRETT', name: 'Brett', chain, venue: 'kyber', address, decimals: 18 },
  mint: `remote:${chain}:${address}`,
  icon: null,
  priceUsd: 0.0056,
  mcapUsd: 56e6,
});

function world() {
  const state = {
    arcUsdc: 100_000_000n,
    arcAllowance: 0n,
    accountUsdc: 0n,
    accountBrett: 0n,
    paymasterAllowance: 0n,
    forwardTx: null as string | null,
    burnTx: null as { from: string; to: string; input: string } | null,
    receipt: null as unknown,
  };
  const actions = { create: jest.fn(async () => ({ created: true, row: {} })), update: jest.fn(async () => undefined) };
  const arc = {
    balancesOf: jest.fn(async () => new Map([[ARC_USDC, state.arcUsdc]])),
    receipt: jest.fn(async () => ({ status: 'success', logs: [] })),
    client: {
      readContract: jest.fn(async () => state.arcAllowance),
      getTransaction: jest.fn(async () => state.burnTx),
    },
  };
  const client = {
    getCode: jest.fn(async () => '0x'),
    readContract: jest.fn(async (r: { functionName: string; address: string; args?: unknown[] }) => {
      switch (r.functionName) {
        case 'balanceOf':
          return r.address.toLowerCase() === BRETT ? state.accountBrett : state.accountUsdc;
        case 'allowance':
          return state.paymasterAllowance;
        case 'nonces':
          return 0n;
        case 'name':
          return 'USD Coin';
        case 'version':
          return '2';
        case 'getNonce':
          return 0n;
        default:
          throw new Error(`unexpected read ${r.functionName}`);
      }
    }),
  };
  const bundler = {
    gasPrice: jest.fn(async () => ({ maxFeePerGas: 10_000_000n, maxPriorityFeePerGas: 1_000_000n })),
    estimate: jest.fn(async (_op: unknown) => ({ callGasLimit: 400_000n, verificationGasLimit: 300_000n, preVerificationGas: 60_000n })),
    send: jest.fn(async (_op: unknown) => OP_HASH),
    receipt: jest.fn(async () => state.receipt),
  };
  const swapFor = jest.fn(async (a: { tokenIn: Hex; tokenOut: Hex; amountIn: bigint }) => ({
    router: ROUTER,
    callData: `0xe21fd0e9${a.amountIn.toString(16).padStart(64, '0')}` as Hex,
    amountOut: 880n * 10n ** 18n,
    minOut: a.tokenOut.toLowerCase() === BASE.usdc.toLowerCase() ? 4_900_000n : 870n * 10n ** 18n,
    gasUsd: 0.01,
  }));
  const fetchFn = jest.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/v2/burn/USDC/fees/')) {
      return new Response(JSON.stringify([{ finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 50_000, med: 55_000, high: 60_000 } }]));
    }
    if (url.includes('/v2/messages/')) {
      return new Response(JSON.stringify({ messages: [{ status: 'complete', ...(state.forwardTx ? { forwardTxHash: state.forwardTx } : {}) }] }));
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  const tokens = { assetOf: jest.fn(async (mint: string) => (mint.includes('ethereum') ? listing(BRETT, 'ethereum') : listing(BRETT))) };
  const routes = { priceUsd: jest.fn(async () => 0.0057) };
  const wallets = { ownWallet: jest.fn(async () => ({ address: OWNER })) };
  const far = new FarTrades(
    loadConfig({ ARC_NETWORK: 'mainnet', ARC_WALLET_ACCOUNTS: 'own' }),
    arc as never,
    actions as never,
    wallets as never,
    tokens as never,
    routes as never,
  );
  far.fetchFn = fetchFn;
  far.clientFor = () => client as never;
  far.bundlerFor = () => bundler as unknown as Bundler;
  far.swapFor = swapFor as never;
  far.arcReceiptWaitMs = 10;
  return { far, state, actions, arc, client, bundler, swapFor };
}

const idOf = (url: string) => url.split('#')[1]!.split('.') as [string, string];

/** What a browser wallet does with the page's typed-data request. */
async function signTyped(typedData: unknown): Promise<Hex> {
  const t = typedData as { domain: never; types: Record<string, unknown>; primaryType: never; message: never };
  const { EIP712Domain: _d, ...types } = t.types;
  return (owner.signTypedData as (a: unknown) => Promise<Hex>)({ domain: t.domain, types, primaryType: t.primaryType, message: t.message });
}

describe('FarTrades: a buy on Base from the Arc balance', () => {
  it('burns on Arc toward the Circle account, waits for Circle, then has the wallet sign the permit and the order', async () => {
    const w = world();
    const prepared = await w.far.prepare('evm:owner', { side: 'buy', mint: `remote:base:${BRETT}`, amountUsd: 10 }, 'https://api.example');
    expect(prepared.summary.title).toBe('Buy $10.00 of BRETT on Base');
    const [id, t] = idOf(prepared.confirmUrl);

    // 1. Arc: allow CCTP exactly this amount, then burn it with a forwarding request for the account.
    const arcStep = (await w.far.next(id, t)) as Extract<FarStep, { kind: 'arc' }>;
    expect(arcStep.kind).toBe('arc');
    expect(arcStep.chain.chainId).toBe('0x13b2');
    expect(arcStep.txs.map((x) => x.kind)).toEqual(['approve', 'swap']);
    const burn = decodeFunctionData({ abi: tokenMessengerAbi, data: arcStep.txs[1]!.data });
    expect(burn.args).toEqual([10_000_000n, 6, pad(ACCOUNT, { size: 32 }), ARC_USDC, pad('0x', { size: 32 }), 72_000n, 1000, FORWARD_HOOK]);

    // A transaction the wallet sent that is not our burn is refused.
    w.state.burnTx = { from: OWNER, to: arcStep.txs[1]!.to, input: '0xdeadbeef' };
    await expect(w.far.step({ id, t, kind: 'arc', burnHash: BURN_HASH })).rejects.toThrow('not the one Poppin prepared');
    w.state.burnTx = { from: OWNER, to: arcStep.txs[1]!.to, input: arcStep.txs[1]!.data };
    expect(await w.far.step({ id, t, kind: 'arc', burnHash: BURN_HASH })).toEqual({ kind: 'wait', say: 'Circle is moving your USDC to Base. This takes about a minute.' });
    expect(w.far.status('evm:owner', id)).toEqual({ state: 'sending' });

    // 2. Circle delivers it: the order spends what arrived, less the account's gas reserve.
    w.state.forwardTx = `0x${'e'.repeat(64)}`;
    w.state.accountUsdc = 9_945_000n;
    const permitStep = (await w.far.next(id, t)) as Extract<FarStep, { kind: 'sign-typed' }>;
    expect(permitStep.kind).toBe('sign-typed');
    expect(permitStep.chain.chainId).toBe('0x2105');
    expect(w.swapFor.mock.calls[0]![0].amountIn).toBe(9_945_000n - ACCOUNT_RESERVE_RAW);

    // 3. The permit, signed as typed data by the wallet; a stranger's signature is refused.
    const stranger = privateKeyToAccount(keccak256(toHex('someone else')));
    const td = permitStep.typedData as { domain: never; types: Record<string, unknown>; primaryType: never; message: never };
    const { EIP712Domain: _d, ...types } = td.types;
    const bad = await (stranger.signTypedData as (a: unknown) => Promise<Hex>)({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
    await expect(w.far.step({ id, t, kind: 'sign-typed', signature: bad })).rejects.toThrow('the wallet you signed in with');
    const orderStep = (await w.far.step({ id, t, kind: 'sign-typed', signature: await signTyped(permitStep.typedData) })) as Extract<FarStep, { kind: 'sign-hash' }>;
    expect(orderStep.kind).toBe('sign-hash');

    // 4. The order: the wallet signs the operation's hash; the bundler gets it with the permit inside.
    const signature = await owner.signMessage({ message: { raw: orderStep.hash } });
    expect(await w.far.step({ id, t, kind: 'sign-hash', signature })).toEqual({ kind: 'wait', say: 'Sending your order on Base.' });
    const sent = w.bundler.send.mock.calls[0]![0] as unknown as { sender: string; factory?: string; paymaster: string; paymasterData: Hex; signature: Hex; callData: Hex };
    expect(sent.sender.toLowerCase()).toBe(ACCOUNT);
    expect(sent.factory).toBe('0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD');
    expect(sent.paymaster).toBe(BASE.paymaster);
    expect(sent.paymasterData.startsWith(`0x00${BASE.usdc.slice(2).toLowerCase()}`)).toBe(true);
    expect(parseInt(sent.signature.slice(-2), 16)).toBe(parseInt(signature.slice(-2), 16) + 32);

    // 5. Landed: what the account received is read from the Transfer logs.
    w.state.receipt = {
      success: true,
      receipt: { transactionHash: TX_HASH },
      logs: [{ address: BRETT, topics: [TRANSFER, pad(ROUTER), pad(ACCOUNT)], data: toHex(880n * 10n ** 18n) }],
    };
    const done = await w.far.next(id, t);
    expect(done).toEqual({ kind: 'done', say: 'Done. You can close this window.', txUrl: `https://basescan.org/tx/${TX_HASH}` });
    expect(w.far.status('evm:owner', id)).toEqual({ state: 'done', signature: TX_HASH, outAmountRaw: (880n * 10n ** 18n).toString() });
    expect(w.actions.update).toHaveBeenLastCalledWith(id, expect.objectContaining({ status: 'confirmed', amountOutRaw: 880n * 10n ** 18n }));
  });

  it('spends USDC already waiting in the account without going through Arc, and asks no permit while one stands', async () => {
    const w = world();
    w.state.accountUsdc = 20_000_000n;
    w.state.paymasterAllowance = 5_000_000n;
    const prepared = await w.far.prepare('evm:owner', { side: 'buy', mint: `remote:base:${BRETT}`, amountUsd: 10 }, 'https://api.example');
    expect(prepared.summary.detail).toBe('Paid from the USDC already in your Base account.');
    const [id, t] = idOf(prepared.confirmUrl);
    expect((await w.far.next(id, t)).kind).toBe('sign-hash');
    expect(w.swapFor.mock.calls[0]![0].amountIn).toBe(10_000_000n);
  });

  it("refuses Ethereum, native ETH, small buys, and more than the wallet holds on Arc", async () => {
    const w = world();
    const buy = (mint: string, amountUsd: number) => w.far.prepare('evm:owner', { side: 'buy', mint, amountUsd }, 'https://api.example');
    await expect(buy(`remote:ethereum:${BRETT}`, 10)).rejects.toThrow('Buying on Ethereum from your Arc balance is not open yet.');
    (w.far as unknown as { tokens: unknown }).tokens = { assetOf: async () => listing('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') } as never;
    await expect(buy('remote:base:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 10)).rejects.toThrow('not open yet');
    const w2 = world();
    await expect(w2.far.prepare('evm:owner', { side: 'buy', mint: `remote:base:${BRETT}`, amountUsd: 1 }, 'x')).rejects.toThrow('Buy at least $2');
    w2.state.arcUsdc = 3_000_000n;
    await expect(w2.far.prepare('evm:owner', { side: 'buy', mint: `remote:base:${BRETT}`, amountUsd: 10 }, 'x')).rejects.toThrow('Insufficient USDC');
  });
});

describe('FarTrades: a sell on Base back to the Arc balance', () => {
  it('swaps to USDC and burns it to Arc for the wallet in one signed order, then waits for Circle to mint it there', async () => {
    const w = world();
    w.state.accountBrett = 900n * 10n ** 18n;
    w.state.accountUsdc = ACCOUNT_RESERVE_RAW;
    w.state.paymasterAllowance = 5_000_000n;
    w.client.getCode.mockResolvedValue('0x6080');
    const prepared = await w.far.prepare('evm:owner', { side: 'sell', mint: `remote:base:${BRETT}`, amountRaw: (880n * 10n ** 18n).toString() }, 'x');
    expect(prepared.summary).toEqual({ title: 'Sell 880 BRETT on Base', detail: "You get about $4.90 back on Arc, less Circle's few cents." });
    const [id, t] = idOf(prepared.confirmUrl);
    const orderStep = (await w.far.next(id, t)) as Extract<FarStep, { kind: 'sign-hash' }>;
    expect(orderStep.kind).toBe('sign-hash');

    // Four calls, all or nothing: approve the router, swap, approve CCTP, burn to Arc for the wallet.
    const sentCalls = w.bundler.estimate.mock.calls[0]![0] as unknown as { callData: Hex; factory?: string };
    expect(sentCalls.factory).toBeUndefined();
    const batch = decodeFunctionData({
      abi: [{ type: 'function', name: 'executeBatch', stateMutability: 'payable', inputs: [{ name: 'calls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }], outputs: [] }],
      data: sentCalls.callData,
    });
    const calls = batch.args[0] as unknown as Array<{ target: string; data: Hex }>;
    expect(calls.map((c) => c.target.toLowerCase())).toEqual([BRETT, ROUTER, BASE.usdc.toLowerCase(), BASE.tokenMessenger.toLowerCase()]);
    const back = decodeFunctionData({ abi: tokenMessengerAbi, data: calls[3]!.data });
    expect(back.args.slice(0, 4)).toEqual([4_900_000n, 26, pad(OWNER, { size: 32 }), BASE.usdc]);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[2]!.data }).args).toEqual([BASE.tokenMessenger, 4_900_000n]);

    const signature = await owner.signMessage({ message: { raw: orderStep.hash } });
    await w.far.step({ id, t, kind: 'sign-hash', signature });
    w.state.receipt = { success: true, receipt: { transactionHash: TX_HASH }, logs: [] };
    expect(await w.far.next(id, t)).toEqual({ kind: 'wait', say: 'Circle is moving your USDC back to Arc.' });

    // Circle mints on Arc: the USDC the wallet received there is the sell's result.
    w.state.forwardTx = `0x${'f'.repeat(64)}`;
    w.arc.receipt.mockResolvedValueOnce({
      status: 'success',
      logs: [{ address: ARC_USDC, topics: [TRANSFER, pad('0x0000000000000000000000000000000000000000'), pad(OWNER)], data: toHex(4_880_000n) }],
    } as never);
    expect((await w.far.next(id, t)).kind).toBe('done');
    expect(w.far.status('evm:owner', id)).toMatchObject({ state: 'done', outAmountRaw: '4880000' });
  });

  it('says so when the account has no USDC left for the network fee', async () => {
    const w = world();
    w.state.accountBrett = 900n * 10n ** 18n;
    w.state.accountUsdc = 0n;
    await expect(
      w.far.prepare('evm:owner', { side: 'sell', mint: `remote:base:${BRETT}`, amountRaw: '1000' }, 'x'),
    ).rejects.toThrow('Your Base account needs about $0.25 of USDC for the network fee.');
  });
});

describe('FarTrades: holdings', () => {
  it('reads what the account still holds of the ledger’s tokens, priced by the live route', async () => {
    const w = world();
    w.state.accountBrett = 5n * 10n ** 18n;
    const held = await w.far.held(OWNER, [`remote:base:${BRETT}`, `remote:base:${BRETT}`]);
    expect(held).toEqual([
      { address: `remote:base:${BRETT}`, raw: 5n * 10n ** 18n, decimals: 18, symbol: 'BRETT', name: 'Brett', kind: 'long-tail', priceUsd: 0.0057, change24hPct: null },
    ]);
  });
});

