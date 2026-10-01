import { Logger } from '@nestjs/common';
import { RemoteTokens, RemoteTokensWarming } from './remote-tokens';

beforeAll(() => Logger.overrideLogger(false));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PEPE_ETH = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
const PEPE_ARB = '0x25d887ce7a35172c62febfd67a1856f20faebb00';
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const PENGU = '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv';
const PURR_ID = '0xc1fb593aeffbeb02f85e0308e9956a90';
const PENGU_ID = '0x' + 'a'.repeat(32);
const BIGSOL = 'BiGSo1111111111111111111111111111111111111pump'.slice(0, 44);

const coin = (id: string, symbol: string, name: string, mcap: number, price = 0.1) => ({
  id,
  symbol,
  name,
  image: `https://coin-images.coingecko.com/coins/images/1/small/${id}.png`,
  current_price: price,
  market_cap: mcap,
});

/** CoinGecko, DexScreener, Jupiter and Hyperliquid, answering the way they did on 2026-09-30. */
function upstream(over: { markets?: unknown; limited?: number; arbitrumLiquidity?: number } = {}) {
  let limited = over.limited ?? 0;
  return jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.coingecko.com')) {
      if (limited > 0) {
        limited--;
        return json({ status: { error_code: 429 } }, 429);
      }
      if (url.includes('/coins/markets')) {
        if (!url.includes('page=1&') && !url.endsWith('page=1')) return json([]);
        return json(
          over.markets ?? [
            coin('tether', 'usdt', 'Tether', 180e9, 1),
            coin('ripple', 'xrp', 'XRP', 120e9, 2.1),
            coin('pepe', 'pepe', 'Pepe', 1.8e9, 0.0000042),
            coin('pudgy-penguins', 'pengu', 'Pudgy Penguins', 600e6),
            coin('spx6900', 'spx', 'SPX6900', 390e6),
            coin('dogwifcoin', 'wif', 'dogwifhat', 240e6, 0.24),
            coin('purr-2', 'purr', 'Purr', 81e6, 0.137),
            coin('pepe-copy', 'pepe', 'Pepe Copy', 5e6),
          ],
        );
      }
      if (url.includes('/coins/list')) {
        return json([
          { id: 'tether', symbol: 'usdt', platforms: { ethereum: '0xdac17f958d2ee523a2206206994597c13d831ec7' } },
          { id: 'ripple', symbol: 'xrp', platforms: {} },
          { id: 'pepe', symbol: 'pepe', platforms: { ethereum: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 'arbitrum-one': PEPE_ARB } },
          { id: 'pudgy-penguins', symbol: 'pengu', platforms: { solana: PENGU, hyperliquid: PENGU_ID } },
          { id: 'spx6900', symbol: 'spx', platforms: { ethereum: '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c' } },
          { id: 'dogwifcoin', symbol: 'wif', platforms: { solana: WIF } },
          { id: 'purr-2', symbol: 'purr', platforms: { hyperliquid: PURR_ID, hyperevm: '0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e' } },
          { id: 'pepe-copy', symbol: 'pepe', platforms: { base: '0x1111111111111111111111111111111111111111' } },
          { id: 'not-in-top', symbol: 'nope', platforms: { base: '0x2222222222222222222222222222222222222222' } },
        ]);
      }
    }
    if (url.includes('api.dexscreener.com/tokens/v1/ethereum/')) {
      return json([{ baseToken: { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933' }, liquidity: { usd: 31_000_000 } }]);
    }
    if (url.includes('api.dexscreener.com/tokens/v1/arbitrum/')) {
      return json([{ baseToken: { address: PEPE_ARB }, liquidity: { usd: over.arbitrumLiquidity ?? 90_000 } }]);
    }
    if (url.includes('lite-api.jup.ag/tokens/v2/search')) {
      const q = decodeURIComponent(url.split('query=')[1] ?? '');
      const rows = [
        { id: WIF, symbol: 'WIF', name: 'dogwifhat', decimals: 6, isVerified: true, mcap: 240e6 },
        { id: PENGU, symbol: 'PENGU', name: 'Pudgy Penguins', decimals: 6, isVerified: true, mcap: 600e6 },
        { id: BIGSOL, symbol: 'BIGSOL', name: 'Big Sol', decimals: 9, isVerified: true, mcap: 20e6, icon: 'https://arweave.net/big.png' },
        { id: 'Sma11111111111111111111111111111111111111111', symbol: 'SMALL', name: 'Small', decimals: 6, isVerified: true, mcap: 2e6 },
        { id: 'Fake1111111111111111111111111111111111111111', symbol: 'BIGSOL', name: 'Big Sol', decimals: 6, isVerified: false, mcap: 90e6 },
      ];
      return json(rows.filter((r) => r.id === q || r.symbol === q));
    }
    if (url.includes('api.hyperliquid.xyz/info')) {
      expect(JSON.parse(String(init?.body))).toEqual({ type: 'spotMeta' });
      return json({
        tokens: [
          { name: 'USDC', index: 0, tokenId: '0x6d1e7cde53ba9467b783cb7c530ce054', szDecimals: 8 },
          { name: 'PURR', index: 1, tokenId: PURR_ID, szDecimals: 0 },
          { name: 'PENGU', index: 2, tokenId: PENGU_ID, szDecimals: 2 },
        ],
        universe: [
          { tokens: [1, 0], name: 'PURR/USDC', index: 0 },
          { tokens: [2, 0], name: '@184', index: 184 },
        ],
      });
    }
    if (url.includes('coin-images.coingecko.com')) {
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
}

function setup(fetchFn = upstream()) {
  const t = new RemoteTokens();
  t.fetchFn = fetchFn;
  t.sleep = async () => undefined;
  t.minCoins = 1;
  t.evmDecimals = jest.fn(async () => 18);
  return t;
}

describe('RemoteTokens', () => {
  it('says it is still loading before the first snapshot, but names the hand-kept assets at once', async () => {
    const t = setup();
    await expect(t.byTicker('PEPE')).rejects.toBeInstanceOf(RemoteTokensWarming);
    expect((await t.assetOf('remote:sol'))?.asset.chain).toBe('solana');
    expect(await t.assetOf('0x6982508145454ce325ddbe47a25d4ec3d2311933')).toBeUndefined();
  });

  it("names a cashtag's largest coin, on a chain the reader can buy on when its pools there are deep enough", async () => {
    const t = setup();
    await t.refresh();
    const pepe = await t.byTicker('$pepe');
    expect(pepe?.mint).toBe(`remote:arbitrum:${PEPE_ARB}`);
    expect(pepe?.asset).toMatchObject({ ticker: 'PEPE', name: 'Pepe', chain: 'arbitrum', venue: 'kyber', decimals: 18 });
    expect(pepe?.mcapUsd).toBe(1.8e9);
    const wif = await t.byTicker('WIF');
    expect(wif?.asset).toMatchObject({ chain: 'solana', venue: 'jupiter', address: WIF, decimals: 6 });
  });

  it('keeps the deepest pool when the buyable chain holds too little', async () => {
    const t = setup(upstream({ arbitrumLiquidity: 10_000 }));
    await t.refresh();
    expect((await t.byTicker('PEPE'))?.mint).toBe(`remote:ethereum:${PEPE_ETH}`);
  });

  it("answers a stock's ticker with its hand-kept tokenized share on Base, even before the snapshot", async () => {
    const t = setup();
    const nvda = await t.byTicker('$NVDA');
    expect(nvda?.mint).toBe('remote:base:0xb20000000000000000000078ee7ce2fe4908108c');
    expect(nvda?.asset).toMatchObject({ ticker: 'NVDA', name: 'NVIDIA', chain: 'base', venue: 'kyber', decimals: 18 });
    expect(nvda?.icon).toBe('https://assets.coingecko.com/coins/images/102175596/small/nvda_200x200.png');
    await t.refresh();
    expect((await t.assetOf('remote:base:0xB20000000000000000000078EE7CE2FE4908108C'))?.asset.ticker).toBe('NVDA');
  });

  it("uses Hyperliquid's book only for a coin that lives nowhere else Arc reaches", async () => {
    const t = setup();
    await t.refresh();
    expect((await t.byTicker('PURR'))?.asset).toMatchObject({ chain: 'hyperliquid', venue: 'hyperliquid', address: 'PURR/USDC', decimals: 0 });
    expect((await t.byTicker('PENGU'))?.asset).toMatchObject({ chain: 'solana', address: PENGU });
  });

  it('gives no chip to stablecoins, coins on other chains, index tickers and unknowns', async () => {
    const t = setup();
    await t.refresh();
    expect(await t.byTicker('USDT')).toBeNull();
    expect(await t.byTicker('XRP')).toBeNull();
    expect(await t.byTicker('SPX')).toBeNull();
    expect(await t.byTicker('NOPE')).toBeNull();
    expect(await t.byTicker('SMALL')).toBeNull();
  });

  it('finds verified Solana tokens past the snapshot through Jupiter, never an unverified twin', async () => {
    const t = setup();
    await t.refresh();
    const big = await t.byTicker('BIGSOL');
    expect(big?.asset).toMatchObject({ chain: 'solana', address: BIGSOL, decimals: 9, name: 'Big Sol' });
    expect(big?.mcapUsd).toBe(20e6);
  });

  it('reads an any-token mint back after a restart, but only for a contract the snapshot lists', async () => {
    const t = setup();
    await t.refresh();
    const back = await t.assetOf('remote:ethereum:0x6982508145454Ce325dDbE47a25d4ec3d2311933');
    expect(back?.mint).toBe(`remote:ethereum:${PEPE_ETH}`);
    expect((await t.assetOf(`remote:arbitrum:${PEPE_ARB}`))?.asset.chain).toBe('arbitrum');
    expect((await t.assetOf('remote:hyperliquid:PURR/USDC'))?.asset.ticker).toBe('PURR');
    expect(await t.assetOf('remote:base:0x2222222222222222222222222222222222222222')).toBeNull();
    expect(await t.assetOf('remote:ethereum:0x000000000000000000000000000000000000dead')).toBeNull();
    expect(await t.assetOf('remote:ethereum:not-an-address')).toBeNull();
    expect(await t.assetOf('remote:dogechain:0x6982508145454ce325ddbe47a25d4ec3d2311933')).toBeNull();
  });

  it('waits out a CoinGecko refusal instead of failing the snapshot', async () => {
    const fetchFn = upstream({ limited: 2 });
    const t = setup(fetchFn);
    await t.refresh();
    expect(t.ready).toBe(true);
    const cg = (fetchFn as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('coingecko'));
    expect(cg.length).toBeGreaterThanOrEqual(9);
  });

  it("keeps the last snapshot when CoinGecko's answer is broken", async () => {
    const t = setup();
    await t.refresh();
    t.fetchFn = upstream({ markets: [] });
    t.minCoins = 5;
    await expect(t.refresh()).rejects.toThrow('only 0 coins');
    expect((await t.byTicker('WIF'))?.asset.chain).toBe('solana');
  });

  it("fetches a token's logo from CoinGecko's CDN through the icon allow-list", async () => {
    const t = setup();
    await t.refresh();
    await t.byTicker('PEPE');
    const icon = await t.icon(`remote:ethereum:${PEPE_ETH}`);
    expect(icon?.contentType).toBe('image/png');
    // Jupiter's icon lives on a host we do not fetch from: the chip loads that one itself.
    await t.byTicker('BIGSOL');
    expect(await t.icon(`remote:solana:${BIGSOL}`)).toBeNull();
  });
});
