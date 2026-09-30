import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  pad,
  parseSignature,
  type Hex,
} from 'viem';

/**
 * CIRCLE'S SMART ACCOUNT, OWNED BY THE READER'S OWN WALLET.
 *
 * On Base and Arbitrum a reader's tokens live in a Circle Modular Wallet
 * account (MSCA v1, ERC-6900, EntryPoint v0.7) whose only owner is the
 * wallet they signed in with. The account is what lets gas be paid in USDC
 * through Circle Paymaster, so nobody needs ETH there. Its address follows
 * from the owner alone (CREATE2 from Circle's factory), so it is the same
 * on every chain and USDC can be sent to it before it exists; the first
 * user operation deploys it.
 *
 * WHY NOT CIRCLE'S SDK (@circle-fin/modular-wallets-core). It pins its own
 * viem and pulls in web3.js, and it signs typed data with a raw eth_sign,
 * which MetaMask no longer offers. The account's plugin verifies an EIP-712
 * digest, so the same signature can be asked for with eth_signTypedData_v4
 * (measured 2026-09-30: byte for byte the SDK's signature, and accepted by
 * USDC's permit on Base and Arbitrum through an ERC-6492 eth_call). The
 * constants and encodings below are Circle's, from that SDK (Apache-2.0,
 * v1.0.16), and the spec checks our addresses against it.
 */

export const CIRCLE_ACCOUNT = {
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  factory: '0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD',
  implementation: '0xA70F1296869DA9D7CB69578123F21888E6dB2B62',
  plugin: '0x0000000C984AFf541D6cE86Bb697e68ec57873C8',
  pluginManifestHash: '0xa043327d77a74c1c55cfa799284b831fe09535a88b9f5fa4173d334e5ba0fd91',
} as const;

/** ERC-1967 proxy creation code, Circle's; the account is this proxy over the implementation. */
const PROXY_CREATION_CODE: Hex =
  '0x' +
  '60806040526102d38038038061001481610194565b92833981019060408183031261018f5780516001600160a01b03811680' +
  '820361018f5760208381015190936001600160401b03821161018f570184601f8201121561018f5780519061006d61006883' +
  '6101cf565b610194565b9582875285838301011161018f57849060005b83811061017b57505060009186010152813b156101' +
  '63577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790' +
  '55604051907fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b600080a28351156101455750' +
  '600080848461012c96519101845af4903d1561013c573d61011c610068826101cf565b908152600081943d92013e6101ea56' +
  '5b505b6040516085908161024e8239f35b606092506101ea565b9250505034610154575061012e565b63b398979f60e01b81' +
  '52600490fd5b60249060405190634c9c8ce360e01b82526004820152fd5b818101830151888201840152869201610080565b' +
  '600080fd5b6040519190601f01601f191682016001600160401b038111838210176101b957604052565b634e487b7160e01b' +
  '600052604160045260246000fd5b6001600160401b0381116101b957601f01601f191660200190565b906102115750805115' +
  '6101ff57805190602001fd5b604051630a12f52160e11b8152600490fd5b81511580610244575b610222575090565b604051' +
  '639996b31560e01b81526001600160a01b039091166004820152602490fd5b50803b1561021a56fe60806040527f360894a1' +
  '3ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc54600090819081906001600160a01b03163682803781' +
  '36915af43d82803e15604b573d90f35b3d90fdfea26469706673582212204c5a8d3706486893377786ce0546dcd68cc8da5f' +
  '34f8cc074c787db78fc29df764736f6c63430008180033' as Hex;

/**
 * A signature the account accepts the shape of while the bundler estimates
 * gas. It is a passkey signature, dearer to verify than an EOA's, so the
 * estimate errs high. Circle's.
 */
export const STUB_SIGNATURE: Hex =
  '0x' +
  '0000be58786f7ae825e097256fc83a4749b95189e03e9963348373e9c595b152000000000000000000000000000000000000' +
  '0000000000000000000000000041220000000000000000000000000000000000000000000000000000000000000240000000' +
  '0000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000' +
  '000000000000000000006091077742edaf8be2fa866827236532ec2a5547fe2721e606ba591d1ffae7a15c022e5f8fe5614b' +
  'bf65ea23ad3781910eb04a1a60fae88190001ecf46e5f5680a00000000000000000000000000000000000000000000000000' +
  '000000000000a000000000000000000000000000000000000000000000000000000000000001000000000000000000000000' +
  '0000000000000000000000000000000000000000170000000000000000000000000000000000000000000000000000000000' +
  '0000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000' +
  '000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d976305' +
  '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
  '000000000000000000000000867b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a224b' +
  '6d62474d316a4d554b57794d6352414c6774553953537144384841744867486178564b6547516b503541222c226f72696769' +
  '6e223a22687474703a2f2f6c6f63616c686f73743a35313733222c2263726f73734f726967696e223a66616c73657d000000' +
  '0000000000000000000000000000000000000000000000' as Hex;

const SALT: Hex = pad('0x', { size: 32 });

const REPLAY_SAFE = {
  name: 'Weighted Multisig Webauthn Plugin',
  version: '1.0.0',
  primaryType: 'CircleWeightedWebauthnMultisigMessage',
} as const;

const factoryAbi = [
  {
    type: 'function',
    name: 'createAccount',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_sender', type: 'bytes32' },
      { name: '_salt', type: 'bytes32' },
      { name: '_initializingData', type: 'bytes' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
  },
] as const;

const accountAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'returnData', type: 'bytes' }],
  },
  {
    type: 'function',
    name: 'executeBatch',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'returnData', type: 'bytes[]' }],
  },
  {
    type: 'function',
    name: 'initializeUpgradableMSCA',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plugins', type: 'address[]' },
      { name: 'manifestHashes', type: 'bytes32[]' },
      { name: 'pluginInstallData', type: 'bytes[]' },
    ],
    outputs: [],
  },
] as const;

/** One owner, weight one, threshold one: the wallet alone signs for the account. */
function pluginInstallData(owner: Hex): Hex {
  return encodeAbiParameters(
    [
      { name: 'initialOwners', type: 'address[]' },
      { name: 'ownerWeights', type: 'uint256[]' },
      { name: 'initialPublicKeyOwners', type: 'tuple[]', components: [{ name: 'x', type: 'uint256' }, { name: 'y', type: 'uint256' }] },
      { name: 'publicKeyOwnerWeights', type: 'uint256[]' },
      { name: 'thresholdWeight', type: 'uint256' },
    ],
    [[owner], [1n], [], [], 1n],
  );
}

/** The account a wallet owns: its address and how the first user operation deploys it. */
export function circleAccount(owner: Hex): { address: Hex; factory: Hex; factoryData: Hex } {
  const sender = pad(owner, { size: 32 });
  const install = pluginInstallData(owner);
  const initializing = encodeAbiParameters(
    [
      { name: 'plugins', type: 'address[]' },
      { name: 'manifestHashes', type: 'bytes32[]' },
      { name: 'pluginInstallData', type: 'bytes[]' },
    ],
    [[CIRCLE_ACCOUNT.plugin], [CIRCLE_ACCOUNT.pluginManifestHash], [install]],
  );
  const initCall = encodeFunctionData({
    abi: accountAbi,
    functionName: 'initializeUpgradableMSCA',
    args: [[CIRCLE_ACCOUNT.plugin], [CIRCLE_ACCOUNT.pluginManifestHash], [install]],
  });
  const bytecode = encodePacked(
    ['bytes', 'bytes'],
    [PROXY_CREATION_CODE, encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [CIRCLE_ACCOUNT.implementation, initCall])],
  );
  const address = getContractAddress({
    bytecode,
    from: CIRCLE_ACCOUNT.factory,
    opcode: 'CREATE2',
    salt: keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [sender, SALT])),
  });
  const factoryData = encodeFunctionData({ abi: factoryAbi, functionName: 'createAccount', args: [sender, SALT, initializing] });
  return { address, factory: CIRCLE_ACCOUNT.factory, factoryData };
}

export interface AccountCall {
  to: Hex;
  data: Hex;
  value?: bigint;
}

/** The account's own call: execute for one, executeBatch for several, all or nothing. */
export function encodeAccountCalls(calls: AccountCall[]): Hex {
  if (calls.length === 1) {
    const c = calls[0]!;
    return encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [c.to, c.value ?? 0n, c.data] });
  }
  return encodeFunctionData({
    abi: accountAbi,
    functionName: 'executeBatch',
    args: [calls.map((c) => ({ target: c.to, value: c.value ?? 0n, data: c.data }))],
  });
}

/**
 * What the owner signs, as eth_signTypedData_v4 takes it, for the account to
 * vouch for `hash` (ERC-1271): Circle's replay-safe message, bound to this
 * account and chain. The digest of this is exactly the SDK's toReplaySafeHash.
 */
export function replaySafeTypedData(account: Hex, chainId: number, hash: Hex) {
  return {
    domain: {
      name: REPLAY_SAFE.name,
      version: REPLAY_SAFE.version,
      chainId,
      verifyingContract: CIRCLE_ACCOUNT.plugin,
      salt: pad(account, { dir: 'right', size: 32 }),
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' },
      ],
      [REPLAY_SAFE.primaryType]: [{ name: 'hash', type: 'bytes32' }],
    },
    primaryType: REPLAY_SAFE.primaryType,
    message: { hash },
  } as const;
}

/**
 * An owner's 65-byte signature in the plugin's form: r, s and a type byte.
 * A typed-data signature keeps v; a personal_sign over a user operation's
 * hash is marked by v + 32, which tells the plugin to add the EIP-191 prefix.
 */
export function wrapOwnerSignature(signature: Hex, kind: 'typed' | 'personal'): Hex {
  const { r, s, v, yParity } = parseSignature(signature);
  const base = v !== undefined ? Number(v) : 27 + (yParity ?? 0);
  return encodePacked(['bytes32', 'bytes32', 'uint8'], [r, s, kind === 'personal' ? base + 32 : base]);
}

