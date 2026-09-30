import {
  createPublicClient,
  encodePacked,
  http,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  entryPoint07Abi,
  formatUserOperationGas,
  formatUserOperationReceipt,
  formatUserOperationRequest,
  getUserOperationHash,
  type UserOperation,
  type UserOperationReceipt,
} from 'viem/account-abstraction';
import { CIRCLE_ACCOUNT, STUB_SIGNATURE, circleAccount, encodeAccountCalls, type AccountCall } from './circle-account';
import type { FarChain } from './far-chains';

/**
 * ONE USER OPERATION FROM A READER'S CIRCLE ACCOUNT, PAID IN USDC.
 *
 * Built here, signed by the reader's wallet on the confirm page, sent by a
 * bundler (Pimlico's public endpoint, the one Circle's Paymaster quickstart
 * uses; no key). Gas is paid by Circle Paymaster out of the account's own
 * USDC: the paymaster takes a prefund while validating and refunds the rest
 * after, so the account must hold a little USDC beyond what the calls spend.
 *
 * The paymaster needs an allowance. The first operation carries a signed
 * EIP-2612 permit in its paymaster data; later ones carry none and use what
 * is left of it (Circle's TokenPaymasterV07 skips the permit when the data
 * stops at the paymaster's gas limits).
 */

/** Circle's Paymaster quickstart values, measured against its own postOp. */
const PAYMASTER_VERIFICATION_GAS = 200_000n;
const PAYMASTER_POST_OP_GAS = 35_000n;
/** Circle's SDK floors: deploying the account costs verification gas the estimate can miss. */
const VERIFICATION_FLOOR = { deployed: 100_000n, undeployed: 1_500_000n };

export interface Permit {
  amount: bigint;
  /** The account's signature, as the plugin wants it (wrapOwnerSignature, 'typed'). */
  signature: Hex;
}

export type Op = UserOperation<'0.7'>;

type Fetch = typeof fetch;

export class Bundler {
  constructor(
    readonly url: string,
    private readonly fetchFn: Fetch = (...a) => fetch(...a),
  ) {}

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
    if (!res.ok || !body || body.error || body.result === undefined) {
      throw new BundlerError(body?.error?.message ?? `HTTP ${res.status}`);
    }
    return body.result;
  }

  async gasPrice(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const r = await this.request<{ standard: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } }>('pimlico_getUserOperationGasPrice', []);
    return { maxFeePerGas: BigInt(r.standard.maxFeePerGas), maxPriorityFeePerGas: BigInt(r.standard.maxPriorityFeePerGas) };
  }

  async estimate(op: Op): Promise<ReturnType<typeof formatUserOperationGas>> {
    const r = await this.request<Record<string, Hex>>('eth_estimateUserOperationGas', [
      formatUserOperationRequest(op),
      CIRCLE_ACCOUNT.entryPoint,
    ]);
    return formatUserOperationGas(r as never);
  }

  send(op: Op): Promise<Hex> {
    return this.request<Hex>('eth_sendUserOperation', [formatUserOperationRequest(op), CIRCLE_ACCOUNT.entryPoint]);
  }

  /** The receipt once the operation is in a block; null before. */
  async receipt(hash: Hex): Promise<UserOperationReceipt | null> {
    const r = await this.request<unknown>('eth_getUserOperationReceipt', [hash]).catch((e: unknown) => {
      if (e instanceof BundlerError) return null;
      throw e;
    });
    return r ? formatUserOperationReceipt(r as never) : null;
  }
}

export class BundlerError extends Error {}

const clients = new Map<number, PublicClient>();

export function chainClient(chain: FarChain): PublicClient {
  let c = clients.get(chain.chainId);
  if (!c) {
    c = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 10_000 }) });
    clients.set(chain.chainId, c);
  }
  return c;
}

/** Paymaster data: nothing when the allowance stands, or mode 0 with a permit. */
export function paymasterData(chain: FarChain, permit: Permit | null): Hex {
  if (!permit) return '0x';
  return encodePacked(['uint8', 'address', 'uint256', 'bytes'], [0, chain.usdc, permit.amount, permit.signature]);
}

/**
 * The operation for these calls, priced and estimated, with its hash: the
 * hash is what the owner signs (personal_sign), and the operation goes to the
 * bundler with that signature in place of the stub.
 */
export async function draftUserOp(args: {
  chain: FarChain;
  owner: Hex;
  calls: AccountCall[];
  permit: Permit | null;
  bundler: Bundler;
  client?: PublicClient;
}): Promise<{ op: Op; hash: Hex }> {
  const { chain, owner, calls, permit, bundler } = args;
  const client = args.client ?? chainClient(chain);
  const account = circleAccount(owner);
  const [code, nonce, fees] = await Promise.all([
    client.getCode({ address: account.address }),
    client.readContract({
      address: CIRCLE_ACCOUNT.entryPoint,
      abi: entryPoint07Abi,
      functionName: 'getNonce',
      args: [account.address, 0n],
    }),
    bundler.gasPrice(),
  ]);
  const deployed = Boolean(code && code !== '0x');
  const op: Op = {
    sender: account.address,
    nonce,
    ...(deployed ? {} : { factory: account.factory, factoryData: account.factoryData }),
    callData: encodeAccountCalls(calls),
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    paymaster: chain.paymaster,
    paymasterVerificationGasLimit: PAYMASTER_VERIFICATION_GAS,
    paymasterPostOpGasLimit: PAYMASTER_POST_OP_GAS,
    paymasterData: paymasterData(chain, permit),
    signature: STUB_SIGNATURE,
  };
  const gas = await bundler.estimate(op);
  const floor = deployed ? VERIFICATION_FLOOR.deployed : VERIFICATION_FLOOR.undeployed;
  op.callGasLimit = (gas.callGasLimit * 12n) / 10n;
  op.verificationGasLimit = max(gas.verificationGasLimit, floor);
  op.preVerificationGas = (gas.preVerificationGas * 11n) / 10n;
  op.paymasterVerificationGasLimit = max(gas.paymasterVerificationGasLimit ?? 0n, PAYMASTER_VERIFICATION_GAS);
  op.paymasterPostOpGasLimit = max(gas.paymasterPostOpGasLimit ?? 0n, PAYMASTER_POST_OP_GAS);
  const hash = getUserOperationHash({
    chainId: chain.chainId,
    entryPointAddress: CIRCLE_ACCOUNT.entryPoint,
    entryPointVersion: '0.7',
    userOperation: op,
  });
  return { op, hash };
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
