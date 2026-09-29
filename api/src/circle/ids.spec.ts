import { circleRef, stableUuid } from './ids';

describe('stableUuid', () => {
  it('is the same for the same inputs and different otherwise', () => {
    expect(stableUuid('arc-wallet', 'testnet', 'u1')).toBe(stableUuid('arc-wallet', 'testnet', 'u1'));
    expect(stableUuid('arc-wallet', 'testnet', 'u1')).not.toBe(stableUuid('arc-wallet', 'mainnet', 'u1'));
    // Parts are joined with a separator, so shifting text between parts changes the key.
    expect(stableUuid('ab', 'c')).not.toBe(stableUuid('a', 'bc'));
  });

  it('is shaped like a v4 UUID', () => {
    expect(stableUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('circleRef', () => {
  it('keeps a Firebase uid as it is, so wallets made so far keep their label and key', () => {
    expect(circleRef('Xb3k9QmZt7VwP2rN8sLd4Hc1Ay0E')).toBe('Xb3k9QmZt7VwP2rN8sLd4Hc1Ay0E');
  });

  it("turns a wallet sign-in's evm:<address> into a short plain label, the same every time", () => {
    const uid = 'evm:0x78e07df0e361ddae634515334cc4a16acdcc1e36';
    const ref = circleRef(uid);
    expect(ref).toMatch(/^h[0-9a-f]{23}$/);
    expect(circleRef(uid)).toBe(ref);
    expect(circleRef('evm:0x0000000000000000000000000000000000000001')).not.toBe(ref);
    // Every name this service writes stays short, deposit networks included.
    for (const name of [`poppin:${ref}`, `poppin:${ref}:ETH-SEPOLIA`, `poppin:${ref}:sol`]) {
      expect(name.length).toBeLessThanOrEqual(44);
    }
  });
});
