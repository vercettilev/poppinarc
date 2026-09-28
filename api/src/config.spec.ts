import { loadConfig, real } from './config';

describe('config', () => {
  it('treats placeholder-shaped values as unset', () => {
    for (const v of ['', '  ', '<Circle API key>', 'changeme', 'your-key', 'TODO', 'xxxx']) {
      expect(real(v)).toBeNull();
    }
    expect(real(' TEST_API_KEY:abc ')).toBe('TEST_API_KEY:abc');
  });

  it('defaults to testnet and refuses a key from the other environment', () => {
    expect(loadConfig({}).network.chainId).toBe(5042002);
    expect(() => loadConfig({ ARC_NETWORK: 'mainnet', CIRCLE_API_KEY: 'TEST_API_KEY:a:b' })).toThrow(/LIVE_API_KEY/);
    expect(() => loadConfig({ ARC_NETWORK: 'testnet', CIRCLE_API_KEY: 'LIVE_API_KEY:a:b' })).toThrow(/TEST_API_KEY/);
    expect(loadConfig({ ARC_NETWORK: 'mainnet', CIRCLE_API_KEY: 'LIVE_API_KEY:a:b' }).network.chainId).toBe(5042);
  });

  it('bounds the fee and validates the fee recipient', () => {
    expect(loadConfig({ SPOT_FEE_BPS: '100' }).feeBps).toBe(100);
    expect(() => loadConfig({ SPOT_FEE_BPS: '5000' })).toThrow();
    expect(() => loadConfig({ FEE_RECIPIENT: 'not-an-address' })).toThrow(/FEE_RECIPIENT/);
  });
});
