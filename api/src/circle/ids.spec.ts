import { stableUuid } from './ids';

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
