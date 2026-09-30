/**
 * A TRADE ON ANOTHER CHAIN, END TO END, WITH PLAY MONEY: Arc testnet to Base
 * Sepolia and back, through the same modules the API uses (far/*).
 *
 *   1. Arc: approve CCTP and burn USDC with a forwarding request, to the
 *      owner's Circle account on Base Sepolia.
 *   2. Wait for Circle's Forwarding Service to mint it there.
 *   3. First user operation, gas paid in USDC through Circle Paymaster, with
 *      the permit signed the way a browser wallet signs it (typed data over
 *      Circle's replay-safe message) and the operation signed with
 *      personal_sign: a small USDC transfer to the owner. It also deploys
 *      the account.
 *   4. Second user operation, no permit this time (the allowance stands):
 *      burn the rest back to Arc with a forwarding request, to the owner.
 *   5. Wait for Circle to mint it on Arc.
 *
 * KyberSwap does not route on testnets, so a transfer stands in for the swap;
 * everything else is the real path. The owner key is a throwaway testnet key
 * read from a file; nothing here prints it.
 *
 *   FAR_E2E_KEY_FILE=/path/to/key npx ts-node --transpile-only src/e2e/far-testnet.ts
 */
import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  hashTypedData,
  http,
  maxUint256,
  pad,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_NETWORKS } from '../arc/network';
import { circleAccount, replaySafeTypedData, wrapOwnerSignature } from '../far/circle-account';
import { FAR_NETWORKS, FORWARD_HOOK, permitAbi, tokenMessengerAbi } from '../far/far-chains';
import { Bundler, chainClient, draftUserOp } from '../far/user-ops';

const ARC = ARC_NETWORKS.testnet;
const FAR = FAR_NETWORKS.testnet;
const BASE = FAR.chains.base;
const AMOUNT = 3_000_000n;
const PERMIT = 10_000_000n;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 10 * 60_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v !== null) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(4000);
  }
}

async function fees(from: number, to: number) {
  const rows = (await (await fetch(`${FAR.irisUrl}/v2/burn/USDC/fees/${from}/${to}?forward=true`)).json()) as Array<{
    finalityThreshold: number;
    minimumFee: number;
    forwardFee: { med: number; high: number };
  }>;
  const fast = rows.find((r) => r.finalityThreshold === 1000) ?? rows[0]!;
  return { bps: fast.minimumFee, high: BigInt(Math.ceil(fast.forwardFee.high)) };
}

const maxFeeFor = (amount: bigint, f: { bps: number; high: bigint }) => (amount * BigInt(Math.ceil(f.bps * 100))) / 1_000_000n + (f.high * 12n) / 10n;

async function forwardTx(domain: number, hash: Hex): Promise<Hex | null> {
  const r = (await (await fetch(`${FAR.irisUrl}/v2/messages/${domain}?transactionHash=${hash}`)).json()) as {
    messages?: Array<{ forwardTxHash?: Hex; status?: string }>;
  };
  return r.messages?.[0]?.forwardTxHash ?? null;
}

async function main() {
  const file = process.env.FAR_E2E_KEY_FILE;
  if (!file) throw new Error('set FAR_E2E_KEY_FILE');
  const owner = privateKeyToAccount(readFileSync(file, 'utf8').trim() as Hex);
  const account = circleAccount(owner.address).address;
  console.log(`owner ${owner.address}\naccount ${account} (Base Sepolia)`);

  const arcChain = defineChain({
    id: ARC.chainId,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [ARC.rpcUrl] } },
  });
  const arc = createPublicClient({ chain: arcChain, transport: http(ARC.rpcUrl) });
  const arcWallet = createWalletClient({ account: owner, chain: arcChain, transport: http(ARC.rpcUrl) });
  const base = chainClient(BASE);
  const bundler = new Bundler(BASE.bundlerUrl);
  const arcUsdc = ARC.usdc.address as Hex;
  const usdcOnArc = () => arc.readContract({ address: arcUsdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] });
  const usdcInAccount = () => base.readContract({ address: BASE.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account] });

  const before = await usdcOnArc();
  console.log(`Arc USDC ${Number(before) / 1e6}`);
  if (before < AMOUNT + 500_000n) throw new Error('fund the owner on Arc testnet first (faucet.circle.com)');

  // 1. Arc: approve and burn toward the account, with forwarding.
  const toBase = await fees(26, BASE.cctpDomain);
  const approve = await arcWallet.sendTransaction({
    to: arcUsdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [FAR.arcTokenMessenger, AMOUNT] }),
  });
  await arc.waitForTransactionReceipt({ hash: approve });
  const burn = await arcWallet.sendTransaction({
    to: FAR.arcTokenMessenger,
    data: encodeFunctionData({
      abi: tokenMessengerAbi,
      functionName: 'depositForBurnWithHook',
      args: [AMOUNT, BASE.cctpDomain, pad(account, { size: 32 }), arcUsdc, pad('0x', { size: 32 }), maxFeeFor(AMOUNT, toBase), 1000, FORWARD_HOOK],
    }),
  });
  const burnReceipt = await arc.waitForTransactionReceipt({ hash: burn });
  console.log(`1. burned on Arc: ${burn} (${burnReceipt.status})`);

  // 2. Circle mints it on Base Sepolia.
  const minted = await waitFor('forwarding to Base', () => forwardTx(26, burn));
  const arrived = await waitFor('USDC in the account', async () => {
    const b = await usdcInAccount();
    return b > 0n ? b : null;
  });
  console.log(`2. Circle minted on Base Sepolia: ${minted}; account holds ${Number(arrived) / 1e6} USDC`);

  // 3. First operation: permit (typed data) + a small transfer, signed like a browser wallet would.
  const [name, version, nonce] = await Promise.all([
    base.readContract({ address: BASE.usdc, abi: permitAbi, functionName: 'name' }),
    base.readContract({ address: BASE.usdc, abi: permitAbi, functionName: 'version' }),
    base.readContract({ address: BASE.usdc, abi: permitAbi, functionName: 'nonces', args: [account] }),
  ]);
  const digest = hashTypedData({
    domain: { name, version, chainId: BASE.chainId, verifyingContract: BASE.usdc },
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
    message: { owner: account, spender: BASE.paymaster, value: PERMIT, nonce, deadline: maxUint256 },
  });
  const safe = replaySafeTypedData(account, BASE.chainId, digest);
  const { EIP712Domain: _domain, ...safeTypes } = safe.types;
  const permitSig = await owner.signTypedData({ domain: safe.domain, types: safeTypes, primaryType: safe.primaryType, message: safe.message });
  const first = await draftUserOp({
    chain: BASE,
    owner: owner.address,
    calls: [{ to: BASE.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [owner.address, 100_000n] }) }],
    permit: { amount: PERMIT, signature: wrapOwnerSignature(permitSig, 'typed') },
    bundler,
    client: base,
  });
  const firstSig = await owner.signMessage({ message: { raw: first.hash } });
  const firstHash = await bundler.send({ ...first.op, signature: wrapOwnerSignature(firstSig, 'personal') });
  const firstReceipt = await waitFor('the first operation', () => bundler.receipt(firstHash));
  console.log(`3. first operation (deploy + permit + transfer): ${firstReceipt.receipt.transactionHash} success=${firstReceipt.success}`);
  if (!firstReceipt.success) throw new Error('first operation reverted');

  // 4. Second operation, no permit: burn what is left (less a reserve for gas) back to Arc, for the owner.
  const left = await usdcInAccount();
  const back = left - 400_000n;
  const toArc = await fees(BASE.cctpDomain, 26);
  const second = await draftUserOp({
    chain: BASE,
    owner: owner.address,
    calls: [
      { to: BASE.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [BASE.tokenMessenger, back] }) },
      {
        to: BASE.tokenMessenger,
        data: encodeFunctionData({
          abi: tokenMessengerAbi,
          functionName: 'depositForBurnWithHook',
          args: [back, 26, pad(owner.address, { size: 32 }), BASE.usdc, pad('0x', { size: 32 }), maxFeeFor(back, toArc), 1000, FORWARD_HOOK],
        }),
      },
    ],
    permit: null,
    bundler,
    client: base,
  });
  const secondSig = await owner.signMessage({ message: { raw: second.hash } });
  const secondHash = await bundler.send({ ...second.op, signature: wrapOwnerSignature(secondSig, 'personal') });
  const secondReceipt = await waitFor('the second operation', () => bundler.receipt(secondHash));
  console.log(`4. second operation (burn back to Arc, no permit): ${secondReceipt.receipt.transactionHash} success=${secondReceipt.success}`);
  if (!secondReceipt.success) throw new Error('second operation reverted');

  // 5. Circle mints it on Arc, in the owner's wallet.
  const home = await waitFor('forwarding to Arc', () => forwardTx(BASE.cctpDomain, secondReceipt.receipt.transactionHash));
  const after = await usdcOnArc();
  console.log(`5. Circle minted on Arc: ${home}; Arc USDC ${Number(after) / 1e6} (was ${Number(before) / 1e6})`);
  process.exit(0);
}

main().catch((e) => {
  console.error('far e2e failed:', (e as Error)?.message ?? e);
  process.exit(1);
});
