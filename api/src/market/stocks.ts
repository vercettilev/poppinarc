import type { ArcNetworkName } from '../arc/network';
import type { Address, ArcToken } from '../trade/types';

/**
 * Tokenized stocks we list on Arc, by hand.
 *
 * WHY A HAND-KEPT LIST. Stock tickers are the easiest names on Arc to fake:
 * on 2026-09-28 CRCL alone had six contracts, one of them named "Circle
 * Internet Group • Arc Token" with 5 holders, and AMC, HOOD, TTWO and SPYX
 * all had lookalikes. A reader who taps $TSLA expects Tesla exposure from a
 * real issuer, not the deepest pool that happens to use the letters. So a
 * stock is tradeable only when it is on this list, a famous stock ticker that
 * is not on it resolves to nothing, and a token calling itself by one of
 * these tickers from any other address fails the gate. "Calling itself" takes
 * in the issuers' spellings (TSLAx, TSLAon, bTSLA) and names such as
 * "NVIDIA xStock": see `stockShaped` and `namesAStock` below.
 *
 * An entry is our decision to list the stock: it resolves before the long
 * tail, passes the gate like the Circle assets, and shows in `pinned()`.
 * Removing the entry is how a listing is stopped.
 *
 * EMPTY ON PURPOSE. A separate research pass fills this in, one checked
 * contract at a time. An entry looks like this (illustrative, not a real
 * contract):
 *
 *   {
 *     network: 'mainnet',
 *     address: '0x…',            // lowercase, checked on chain
 *     symbol: 'TSLAx',           // as the issuer writes it
 *     name: 'Tesla xStock',
 *     decimals: 18,              // read from decimals() on chain, never assumed
 *     kind: 'stock',
 *     icon: null,                // or an https URL on a host in ICON_HOSTS
 *     restrictions: ['us-persons'],
 *     aliases: ['TSLA'],         // extra cashtags that mean this stock
 *     issuer: 'xstocks',
 *     source: 'https://… (issuer page and explorer link, date checked)',
 *   }
 */
export interface StockListing extends ArcToken {
  kind: 'stock';
  network: ArcNetworkName;
  /** Extra cashtags, e.g. 'TSLA' for 'TSLAx'. The symbol itself always matches. */
  aliases: string[];
  /** Who issues and redeems it, e.g. 'xstocks' or 'backpack-securities'. */
  issuer: string;
  /** Where the entry was checked, so the next person can check it again. */
  source: string;
}

export const ARC_STOCKS: readonly StockListing[] = [];

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/**
 * The listings for one network, checked. A malformed entry throws at boot:
 * a typo in an address here would otherwise list the wrong contract, which is
 * worse than not starting.
 */
export function stocksOn(network: ArcNetworkName, list: readonly StockListing[] = ARC_STOCKS): StockListing[] {
  const seen = new Set<Address>();
  const out: StockListing[] = [];
  for (const s of list) {
    if (s.network !== network) continue;
    const where = `stock listing ${s.symbol || '(no symbol)'} on ${network}`;
    if (!ADDRESS_RE.test(s.address)) throw new Error(`${where}: address must be lowercase 0x + 40 hex`);
    if (s.kind !== 'stock') throw new Error(`${where}: kind must be 'stock'`);
    if (!s.symbol.trim() || !s.name.trim()) throw new Error(`${where}: symbol and name are required`);
    if (!Number.isInteger(s.decimals) || s.decimals < 0 || s.decimals > 36) {
      throw new Error(`${where}: decimals must be an integer from 0 to 36`);
    }
    if (!Array.isArray(s.restrictions) || !Array.isArray(s.aliases)) {
      throw new Error(`${where}: restrictions and aliases must be arrays`);
    }
    if (s.icon !== null && !s.icon.startsWith('https://')) throw new Error(`${where}: icon must be https or null`);
    if (seen.has(s.address)) throw new Error(`${where}: listed twice`);
    seen.add(s.address);
    out.push(s);
  }
  return out;
}

/**
 * Famous stock and fund tickers. A token using one of these is a stock
 * lookalike unless it is the listed contract above; see the comment at the
 * top. Kept short on purpose: the point is the names people actually tweet.
 */
export const STOCK_TICKERS: ReadonlySet<string> = new Set([
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOG', 'GOOGL', 'META', 'NFLX', 'AMD', 'INTC', 'AVGO', 'ORCL',
  'TSM', 'BABA', 'PLTR', 'COIN', 'HOOD', 'CRCL', 'MSTR', 'GME', 'AMC', 'JPM', 'BAC', 'DIS', 'UBER',
  'SPY', 'QQQ', 'IVV', 'VOO', 'VTI', 'SPYX', 'TTWO', 'RDDT', 'SNAP', 'SHOP', 'PYPL', 'SQ', 'ARM',
]);

/**
 * How issuers spell a tokenized stock around the ticker. xStocks writes NVDAx
 * and Ondo writes CRCLon; both were live on Arc on 2026-09-28, next to six
 * unlisted "NVDAx" contracts, two of them holding $13k and $16k of USDC.
 * Backed's older tokens were bNVDA, Dinari's are TSLA.d, and a trailing B is
 * cheap to cover. The cost is that a meme called METAX or BCOIN is refused
 * too, which is the right side to err on.
 */
const STOCK_PREFIXES = ['B'] as const;
const STOCK_SUFFIXES = ['X', 'ON', 'D', 'B'] as const;

const STOCK_SHAPES: ReadonlySet<string> = new Set(
  [...STOCK_TICKERS].flatMap((t) => [t, ...STOCK_PREFIXES.map((p) => p + t), ...STOCK_SUFFIXES.map((s) => t + s)]),
);

/** True when a symbol key (uppercase letters and digits) is a famous stock ticker in any issuer's spelling. */
export function stockShaped(key: string): boolean {
  return STOCK_SHAPES.has(key);
}

/**
 * Names issuers give tokenized stocks: "NVIDIA xStock", "Circle Internet
 * Group (Ondo Tokenized)", Dinari's "dShares". Whole words only, so
 * "ArcStocks" (ASTOCK, a CoinGecko-listed Arc token) is not caught.
 */
const STOCK_NAME_RE = /\bx?stocks?\b|\btokeni[sz]ed\b|\bdshares?\b/i;

/** True when a token's display name says it is a tokenized stock. */
export function namesAStock(name: string | null | undefined): boolean {
  return typeof name === 'string' && STOCK_NAME_RE.test(name);
}
