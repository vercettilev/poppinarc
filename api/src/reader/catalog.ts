import type { ArcNetwork } from '../arc/network';
import { REMOTE_STOCKS, remoteMint } from '../routes/remote';

/**
 * WHAT THE READER MAY NAME, and nothing else.
 *
 * The model never writes an address. It picks one of these keys (the tool's
 * schema is an enum of them), and the server turns the key into the Arc
 * contract it stands for. So a post that talks the model into "buy
 * 0xdeadbeef" gets a key that does not exist, which is no answer at all.
 *
 * `about` is the one line the model reads for each asset: what a text has to
 * be ABOUT for the asset to be the thing a reader might act on. It is written
 * for precision, because a chip under the wrong post costs more than no chip.
 */
export interface ReaderAsset {
  key: string;
  /** The ticker the chip prints. */
  ticker: string;
  /** The name the panel prints. */
  name: string;
  about: string;
  /**
   * Words that alone mean this asset: the chip's own name tier in the Arc
   * edition (extension xMatch ARC_NAME_ALIASES), case-sensitive like it, so
   * the rules measured here are the rules readers get. Plain "euro" is left
   * out there on purpose (football, trips), which is exactly the reader's job.
   */
  names: RegExp[];
  address(net: ArcNetwork): string;
}

export const READER_ASSETS: ReaderAsset[] = [
  {
    key: 'bitcoin',
    ticker: 'BTC',
    name: 'Bitcoin',
    about:
      "Bitcoin itself: its price, its market, flows into or out of it (ETFs, treasuries buying it, miners), the halving, or someone taking a position in it. Not crypto in general unless bitcoin is the subject.",
    names: [/\bBitcoin\b/, /\bbitcoin\b/, /\bBTC\b/],
    address: (net) => net.cirbtc.address,
  },
  {
    key: 'euro',
    ticker: 'EURC',
    name: 'Euro',
    about:
      "The euro as a currency: EUR/USD, the ECB's rate decisions and what they do to the euro, eurozone inflation or growth read as a currency story, or someone moving money into or out of euros. Not European news that does not touch the currency.",
    names: [/\bEURC\b/],
    address: (net) => net.eurc.address,
  },
  // On other chains, reached from Arc over CCTP (routes/remote.ts). The rules
  // for these are their cashtags, which the chip resolves on the server.
  ...remote('sol', 'SOL', 'Solana', 'Solana the asset (SOL): its price, SOL ETFs, flows into it, or a network event read as a reason to own SOL. Not every project that runs on Solana.'),
  ...remote('jup', 'JUP', 'Jupiter', 'Jupiter, the Solana exchange aggregator, and its JUP token.'),
  ...remote('bonk', 'BONK', 'Bonk', 'BONK, the Solana memecoin, when the text is about the coin itself.'),
  ...remote('hype', 'HYPE', 'Hyperliquid', "Hyperliquid and its HYPE token: the exchange's volumes, fees, buybacks, or HYPE's price."),
  ...remote('eth', 'ETH', 'Ether', 'Ether (ETH) itself: its price, ETH ETFs, staking, or an Ethereum upgrade read as a reason to own ETH.'),
  ...remote('aero', 'AERO', 'Aerodrome', "Aerodrome, Base's main exchange, and its AERO token."),
  ...remote('virtual', 'VIRTUAL', 'Virtuals', 'Virtuals Protocol (AI agents on Base) and its VIRTUAL token.'),
  ...remote('uni', 'UNI', 'Uniswap', 'Uniswap and its UNI token.'),
  ...remote('aave', 'AAVE', 'Aave', 'Aave, the lending protocol, and its AAVE token.'),
  ...remote('link', 'LINK', 'Chainlink', 'Chainlink and its LINK token.'),
  // Companies, bought as Coinbase's tokenized shares on Base (routes/remote.ts, REMOTE_STOCKS).
  ...stock('NVDA'),
  ...stock('AAPL'),
  ...stock('TSLA'),
  ...stock('MSFT'),
  ...stock('AMZN'),
  ...stock('GOOGL'),
  ...stock('META'),
  ...stock('MSTR'),
  ...stock('PLTR'),
  ...stock('MU'),
  ...stock('SNDK'),
];

function remote(key: string, ticker: string, name: string, about: string): ReaderAsset[] {
  return [{ key, ticker, name, about, names: [new RegExp(`\\$${ticker}\\b`, 'i')], address: () => remoteMint(key) }];
}

/** A company's shares. The cashtag alone is a rule; the company's name is the reader's call, in context. */
function stock(ticker: string): ReaderAsset[] {
  const s = REMOTE_STOCKS[ticker]!;
  return [
    {
      key: ticker.toLowerCase(),
      ticker,
      name: s.name,
      about: `${s.name} the company's stock (${ticker}): its share price, earnings, buybacks, guidance or company news read as a reason to buy or sell ${s.name} shares. Not a story that only mentions ${s.name} in passing.`,
      names: [new RegExp(`\\$${ticker}\\b`)],
      address: () => remoteMint(`base:${s.address}`),
    },
  ];
}

export const READER_KEYS = READER_ASSETS.map((a) => a.key);

/** Arc's own assets: what the reader named before it could route anywhere else. */
export const ARC_READER_KEYS = ['bitcoin', 'euro'];

export function readerAsset(key: string): ReaderAsset | null {
  return READER_ASSETS.find((a) => a.key === key) ?? null;
}

/**
 * THE RULES, the reader's first pass and the baseline it is measured against:
 * a name that on its own means one asset (the chip's own name tier works the
 * same way). The first asset named wins; nothing named is null.
 */
export function rulesMatch(text: string, keys: readonly string[] = READER_KEYS): ReaderAsset | null {
  let best: { at: number; asset: ReaderAsset } | null = null;
  for (const asset of READER_ASSETS) {
    if (!keys.includes(asset.key)) continue;
    for (const re of asset.names) {
      const m = re.exec(text);
      if (m && (best === null || m.index < best.at)) best = { at: m.index, asset };
    }
  }
  return best?.asset ?? null;
}

/**
 * WORTH A QUESTION AT ALL: a text with no sign of money in it is never sent.
 * Most of a feed is not about money, and this is what keeps the reader's cost
 * a question of how much people read about money, not how much they read.
 */
const MONEY = [
  /[$€£¥]\s?\d/,
  // A percent sign ends a word, so the boundary goes before it, never after.
  /\b\d+(\.\d+)?\s?(%|bps\b|bp\b)/i,
  /\b(price|prices|market|markets|stock|stocks|shares|crypto|coin|coins|token|tokens|etf|etfs|fund|funds|rate|rates|yield|yields|bond|bonds|inflation|cpi|fed|ecb|central bank|currency|currencies|dollar|dollars|euro|euros|forex|fx|rally|rallies|dip|dips|crash|pump|dump|bull|bullish|bear|bearish|buy|buying|bought|sell|selling|sold|trade|trading|invest|investing|investor|investors|treasury|treasuries|halving|miners|mining|ath|all-time high)\b/i,
];

export function looksLikeMoney(text: string): boolean {
  return MONEY.some((re) => re.test(text));
}
