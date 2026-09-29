import type { ArcNetwork } from '../arc/network';

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
];

export const READER_KEYS = READER_ASSETS.map((a) => a.key);

export function readerAsset(key: string): ReaderAsset | null {
  return READER_ASSETS.find((a) => a.key === key) ?? null;
}

/**
 * THE RULES, the reader's first pass and the baseline it is measured against:
 * a name that on its own means one asset (the chip's own name tier works the
 * same way). The first asset named wins; nothing named is null.
 */
export function rulesMatch(text: string): ReaderAsset | null {
  let best: { at: number; asset: ReaderAsset } | null = null;
  for (const asset of READER_ASSETS) {
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
  /\b\d+(\.\d+)?\s?(%|bps|bp)\b/i,
  /\b(price|prices|market|markets|stock|stocks|shares|crypto|coin|coins|token|tokens|etf|etfs|fund|funds|rate|rates|yield|yields|bond|bonds|inflation|cpi|fed|ecb|central bank|currency|currencies|dollar|dollars|euro|euros|forex|fx|rally|rallies|dip|dips|crash|pump|dump|bull|bullish|bear|bearish|buy|buying|bought|sell|selling|sold|trade|trading|invest|investing|investor|investors|treasury|treasuries|halving|miners|mining|ath|all-time high)\b/i,
];

export function looksLikeMoney(text: string): boolean {
  return MONEY.some((re) => re.test(text));
}
