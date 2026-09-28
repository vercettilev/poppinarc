import { gasUsdcRaw } from './chain';

describe('gasUsdcRaw', () => {
  it('turns 18-decimal native gas into 6-decimal USDC, rounding up', () => {
    // 21,000 gas at 20 gwei = 0.00042 USDC, measured on Arc mainnet 2026-09-27.
    expect(gasUsdcRaw({ gasUsed: 21_000n, effectiveGasPrice: 20_000_000_000n })).toBe(420n);
    // A cost smaller than one micro-USDC still reports as one, never zero.
    expect(gasUsdcRaw({ gasUsed: 1n, effectiveGasPrice: 1n })).toBe(1n);
  });
});
