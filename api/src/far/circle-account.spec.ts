import { hashTypedData, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { circleAccount, encodeAccountCalls, replaySafeTypedData, wrapOwnerSignature } from './circle-account';

/**
 * Reference values from Circle's own SDK (@circle-fin/modular-wallets-core
 * 1.0.16, toCircleSmartAccount on Base), produced 2026-09-30 for two owners
 * whose keys are keccak256("poppin-a") and keccak256("poppin-b").
 */
const SDK = [
  {
    seed: 'poppin-a',
    address: '0x31cc01221ec9493AD647d538B3B8731f43Dd9537',
    factoryDataHash: '0xc72f26549d476ddb651c0ea1be19d1d65d34b2e09d586f02d84a0d69a10e61b8',
    typedSig:
      '0x6b3f70722b48d63eaae894d120f3091fbfb5b07b89f4c11647c284ab814e990a16e4ea6f850a2d7db58568243080b5e16151f789ee45b889c3a3a9bf71c22d8e1b',
  },
  {
    seed: 'poppin-b',
    address: '0xaE7876AD750B2791f403c4d732479F3E03ccCefd',
    factoryDataHash: '0x7b72dfe9f7957982fad13b816481e299dd7caca809269cf433e5169e23c3892f',
    typedSig:
      '0x2df65f79a91ad24e6220abc052adea0e11c6734ac1a74d0e9434b59c3a931b28717023265a18a47a66a2dd4ab6cc78558c4295ae834339d7f69241d4e466028e1c',
  },
] as const;

/** The digest of { name: "X", version: "1", chainId: 8453, verifyingContract: 0x33..33 } M(uint256 a = 1). */
const TYPED_DIGEST = '0xd45829262086d03f587f5c49a6178c699b28a1a07789a5f015fb897209402b36';

describe('circleAccount', () => {
  it.each(SDK)("derives $seed's account and its deployment exactly as Circle's SDK does", ({ seed, address, factoryDataHash }) => {
    const owner = privateKeyToAccount(keccak256(toHex(seed)));
    const a = circleAccount(owner.address);
    expect(a.address).toBe(address);
    expect(a.factory).toBe('0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD');
    expect(keccak256(a.factoryData)).toBe(factoryDataHash);
  });

  it('encodes one call as execute and several as executeBatch, as the SDK does', () => {
    const one = encodeAccountCalls([{ to: '0x1111111111111111111111111111111111111111', data: '0xabcdef' }]);
    expect(one.slice(0, 10)).toBe('0xb61d27f6');
    const two = encodeAccountCalls([
      { to: '0x1111111111111111111111111111111111111111', data: '0xabcdef' },
      { to: '0x2222222222222222222222222222222222222222', data: '0x', value: 5n },
    ]);
    expect(two.slice(0, 10)).toBe('0x34fcd5be');
    expect(keccak256(two)).toBe(
      keccak256(
        '0x34fcd5be00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000003abcdef00000000000000000000000000000000000000000000000000000000000000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
      ),
    );
  });

  it.each(SDK)("lets $seed's wallet vouch for typed data with eth_signTypedData_v4, matching the SDK's raw signature", async ({ seed, address, typedSig }) => {
    const owner = privateKeyToAccount(keccak256(toHex(seed)));
    const typed = replaySafeTypedData(address, 8453, TYPED_DIGEST);
    // What a browser wallet signs: the JSON of this, EIP712Domain included.
    const { EIP712Domain: _domain, ...types } = typed.types;
    const signature = await owner.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
    expect(wrapOwnerSignature(signature, 'typed')).toBe(typedSig);
    expect(hashTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message })).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('marks a personal_sign over a user operation with v + 32', async () => {
    const owner = privateKeyToAccount(keccak256(toHex('poppin-a')));
    const hash = keccak256(toHex('a user operation'));
    const signature = await owner.signMessage({ message: { raw: hash } });
    const wrapped = wrapOwnerSignature(signature, 'personal');
    expect(wrapped.length).toBe(132);
    expect(parseInt(wrapped.slice(-2), 16)).toBe(parseInt(signature.slice(-2), 16) + 32);
  });
});
