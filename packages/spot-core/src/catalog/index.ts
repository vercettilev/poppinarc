import type { AssetCategory, Chain, Journey } from '../telemetry/events';

/**
 * The CURATED regime — P1 step one: tokenized equities.
 *
 * Two regimes now exist and they are not variations on each other. They answer
 * the same question ("may this mint be routed?") from opposite directions, and
 * the whole reason this file exists is to keep that boundary visible:
 *
 *   OPEN-MINT (§7, `safety/open-mint-gate.ts`)
 *     Anything may arrive. A mint earns its way through six measured criteria,
 *     and anything unknown counts against it. Trust is DERIVED, per mint, at
 *     request time, from what the chain and Jupiter report.
 *
 *   CURATED (this file)
 *     Nothing arrives on its own. A mint is here because a person put it here
 *     against a named issuer. Trust is DECLARED, in advance, and the review is
 *     the commit that added the row.
 *
 * Tokenized equities cannot pass the open-mint gate and never will, by
 * construction rather than by accident. Calibration on 2026-08-11/12 measured
 * it directly: SPCX, SPYx, CRCLx, NVDAx and MU ALL fail on
 * `mint_authority_retained` and `freeze_authority_retained`. That is not a
 * defect in them — an issuer of a security-backed token keeps those authorities
 * on purpose, because it has to be able to honour a corporate action, a
 * regulator, or a court. §7's criteria read a retained authority as "someone
 * can still rug you", which is the correct reading for an anonymous memecoin
 * and the wrong one here.
 *
 * So routing these through §7 would not be strict, it would be WRONG: it would
 * silently delete the entire category while reporting `failed_safety`, and the
 * telemetry would show a product that mysteriously never renders equities.
 *
 * What the curated regime is NOT:
 *
 *   Not a bypass with extra steps. Membership is the check. A mint that is not
 *   in this list gets nothing from this file — `CatalogPolicy` rejects it
 *   rather than falling through to a softer rule.
 *   Not an endorsement. These are third-party issuances with real issuer
 *   powers over holders' balances. That is disclosed, not defended.
 *   Not open to growth by inference. Nothing is added by a heuristic, a tag, or
 *   a name resembling one of these. Rows are added by hand, with the routability
 *   probe below run first.
 *
 * ADDING A ROW — the probe is not optional:
 *   1. Resolve the mint through Jupiter Ultra by SYMBOL and read what comes
 *      back. Do not type a mint address from memory or from a chat message.
 *      Symbol collision on Solana is not a corner case: on 2026-08-12 the query
 *      `SPCX` returned EIGHT exact-symbol matches and `SPYx` returned fifteen,
 *      nearly all impostors carrying the same ticker and, in several cases, the
 *      same display name. The verified flag and the liquidity are what separate
 *      them.
 *   2. Quote it both ways against USDC. An asset that can be entered and not
 *      exited is worse in this catalog than absent from it.
 *   3. Record the date and the observed numbers in the commit. Every mint below
 *      was probed on 2026-08-12; see PORTING.md for the table.
 */

/**
 * Who issued the token and is therefore the party with the retained
 * authorities. Recorded per row because "tokenized equity" is not one thing:
 * these are separate issuers, separate programmes, separate terms, and a reader
 * deciding whether to touch one is entitled to know which.
 *
 * The two non-equity values follow the same principle applied to tokens:
 *   'native-spl'  a plain SPL token minted on Solana itself — the "issuer" is
 *                 the project's own mint, with no wrapping counterparty
 *   'wormhole'    Portal-wrapped collateral (WBTC, ETH) — the reader's real
 *                 counterparty is the Wormhole bridge holding the underlying
 */
export type CuratedIssuer =
  | 'backpack-securities'
  | 'xstocks'
  | 'prestocks'
  | 'ondo'
  | 'tether'
  | 'native-spl'
  | 'wormhole'
  | 'bridged';

/**
 * A restriction the ISSUER places on who may hold the token.
 *
 * SOFT-APPLIED, NOT ENFORCED. The card still renders for a reader in a
 * restricted jurisdiction; the panel carries one line saying the issuer
 * restricts them and the swap may fail. §8's geofence still enforces OFAC only
 * and deliberately does NOT enforce counterparty ToU country lists — this is
 * not a second geofence, it is a disclosure plus a measurement.
 *
 * WHAT THE MEASUREMENT IS FOR. Nobody here knows whether these restrictions are
 * enforced at the mint — Token-2022 gives an issuer transfer hooks and a
 * permanent delegate, so they COULD be, and the terms say they are, but terms
 * and bytecode are different artefacts. A hard block guessed at from the terms
 * would refuse readers who would have transacted fine. Soft-applying answers
 * the question with data: if every restricted attempt fails on chain, the
 * restriction is real and the block should be hard. If none do, the line is
 * disclosure and nothing more.
 */
export type IssuerRestriction = 'us-persons';

/**
 * Which countries a restriction covers, ISO 3166-1 alpha-2.
 *
 * THIS IS A PROXY AND IT IS A LOOSE ONE. "US person" is a legal status —
 * citizenship, residency, entity domicile — and what we observe is the country
 * an IP resolved to. It over-includes (a German on holiday in Boston) and
 * under-includes (a US citizen in Berlin, anyone on a VPN), in both cases
 * silently. That is tolerable for a warning line and would NOT be tolerable for
 * a hard block, which is worth remembering if this measurement ever leads to
 * one: the same proxy that is fine for a disclosure would then be refusing
 * people on the strength of an IP lookup.
 */
const RESTRICTION_COUNTRIES: Readonly<Record<IssuerRestriction, readonly string[]>> = {
  'us-persons': ['US'],
};

/**
 * The restrictions that apply to THIS reader — empty for almost everyone.
 *
 * An unresolved country yields none, which follows from §8's fail-open posture
 * and is a real limit on the data: a VPN reader in a restricted jurisdiction
 * sees no line and is counted in no funnel. The denominator here is readers
 * whose country RESOLVED to a restricted one, not readers who are in one.
 */
export function restrictionsFor(
  asset: CuratedAsset | undefined,
  country: string | undefined,
): readonly IssuerRestriction[] {
  if (!asset || !country) return [];
  const c = country.trim().toUpperCase();
  return asset.issuerRestrictions.filter((r) =>
    RESTRICTION_COUNTRIES[r].includes(c),
  );
}

export interface CuratedAsset {
  /** The one field nothing is inferred from. Probed, never typed from memory. */
  mint: string;
  /** On-chain symbol, as Jupiter reports it. NOT the underlying's ticker. */
  ticker: string;
  /** Full name, as the issuer registers it ("Circle Internet Group"). */
  name: string;
  /**
   * What a CARD calls it — the name a person would say out loud. Curated, not
   * derived: deriving it from the ticker gives "SPCX" and deriving it from
   * `name` gives "Circle Internet Group" on a surface with room for one word.
   */
  displayName: string;
  issuer: CuratedIssuer;
  chain: Chain;
  journey: Journey;
  category: AssetCategory;
  /** Issuer-declared holder restrictions. Recorded, not enforced — see above. */
  issuerRestrictions: readonly IssuerRestriction[];
  /**
   * §6 path C vocabulary: the phrases on a page that mean THIS asset.
   *
   * A closed list, and the closedness is the feature. There is no entity
   * linker, no model, no fuzzy match — "Nvidia" reaches NVDAx because the word
   * is written here, and a company absent from this file is unreachable by
   * name no matter how prominently a page discusses it.
   *
   * Terms are chosen to be USELESS AS ENGLISH. `Circle` is a common noun and
   * would fire on "circle back to this later"; the row carries
   * "Circle Internet Group" instead and is simply not reachable from the bare
   * word. A term that costs a real match is better than one that produces
   * confident nonsense, which §1 names as the thing that turns this product
   * into adware.
   */
  terms: readonly string[];
  /**
   * CORROBORATING vocabulary. The subject matter that surrounds an asset
   * without naming it: "orbital launch", "reusable rocket", "Cape Canaveral".
   *
   * These can only ever ADD to the score of an asset the page already names.
   * They can never produce a match on their own, and that asymmetry is the
   * whole point of keeping them in a separate field rather than appending them
   * to `terms`. Individually they are worth almost nothing — "launch" is in
   * every product announcement ever written — and a tier that could match on
   * its own would be the fuzzy entity linking `terms` exists to avoid.
   *
   * `Elon Musk` sits here rather than in `terms` for exactly this reason: he is
   * attached to Tesla, X and Neuralink too, so on his own he is not evidence a
   * page is about SpaceX.
   */
  thematic?: readonly string[];
}

/**
 * Probed against Jupiter on 2026-08-12; every row was buy- AND sell-routable
 * against USDC at the time, with the liquidity noted.
 *
 * On the issuers: the brief called this the Sunrise/Backpack set, and two rows
 * are Backpack Securities. The other three are xStocks (Backed Finance) — a
 * different issuer whose tokens carry the same `x` suffix convention. Nothing
 * was dropped for it; the `issuer` field just records what is actually true.
 */
export const CURATED_CATALOG: readonly CuratedAsset[] = [
  {
    // $619k liquidity, 11,277 holders, verified. Backpack's own issuance.
    mint: 'SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb',
    ticker: 'SPCX',
    name: 'SpaceX',
    displayName: 'SpaceX',
    issuer: 'backpack-securities',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    // Not "Space": the company name is distinctive as one word and the split
    // form is not.
    terms: ['SpaceX', 'Space X', 'SPCX', 'Starship', 'Falcon 9', 'Falcon Heavy', 'Starlink', 'Crew Dragon', 'Raptor engine'],
    thematic: [
      'Elon Musk',
      'orbital launch',
      'commercial spaceflight',
      'satellite internet',
      'reusable rocket',
      'launch pad',
      'Cape Canaveral',
      'Kennedy Space Center',
      'Boca Chica',
      'NASA contract',
      'Artemis program',
      'space tourism',
      'payload to orbit',
      'static fire test',
    ],
  },
  {
    // $2.6M liquidity, 27,618 holders, verified. The deepest row here.
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    ticker: 'SPYx',
    name: 'S&P 500',
    displayName: 'S&P 500',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['S&P 500', 'S&P500', 'SP500', 'Standard & Poor', 'SPDR S&P 500'],
    thematic: ['index fund', 'passive investing', 'benchmark index', 'stock market index', 'large-cap'],
  },
  {
    // $2.6M liquidity, 13,120 holders, verified.
    mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1',
    ticker: 'CRCLx',
    name: 'Circle Internet Group',
    displayName: 'Circle',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    // Deliberately NOT `Circle`. See the note on `terms`: the bare word is
    // ordinary English and would match constantly. This row is reachable by
    // $CRCLx and by its mint; by name it is reachable only when a page names
    // the company in full.
    terms: ['Circle Internet Group', 'Circle Internet Financial', 'CRCL'],
    thematic: ['USDC', 'stablecoin issuer', 'stablecoin reserves', 'Jeremy Allaire'],
  },
  {
    // $1.88M liquidity, 63,834 holders — the widest held row here.
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    ticker: 'NVDAx',
    name: 'NVIDIA',
    displayName: 'NVIDIA',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    // One spelling only: matching is case-insensitive, so a cased variant is
    // dead weight that also decides which spelling gets reported as the hit.
    terms: ['NVIDIA'],
    thematic: ['Jensen Huang', 'GPU', 'data center chip', 'AI accelerator', 'CUDA', 'Blackwell', 'H100', 'graphics card'],
  },
  {
    // $1.54M liquidity, 1,407 holders, verified. Backpack's issuance; note the
    // on-chain symbol is the bare `MU`, unlike xStocks' suffixed tickers.
    mint: 'MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1',
    ticker: 'MU',
    name: 'Micron Technology',
    displayName: 'Micron',
    issuer: 'backpack-securities',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    // "Micron" only. The bare ticker MU is two letters and would be noise.
    terms: ['Micron Technology', 'Micron'],
    thematic: ['memory chip', 'DRAM', 'NAND flash', 'HBM', 'high bandwidth memory', 'semiconductor memory'],
  },
  // ── EXPANSION, probed 2026-08-14 (see scripts note in commit) ─────────────
  // Every row below was resolved from Jupiter's verified list by (symbol,
  // name) — mints copied programmatically, never typed. Inclusion bars:
  //   equities/commodity  liquidity >= $25k (the open gate's own floor)
  //   majors (token)      canonical mint, verified, deep history
  //   memecoins           liquidity ~>= $1M AND holders >= 50k AND both
  //                       authorities burned (Bonk passes on 1.0M holders)
  // RENDER / HNT / HYPE retain a mint authority by design (governance mints)
  // — the same deliberate-authority exemption the equities already carry.
  // Terms follow the CRCLx rule: useless as English. The bare words Apple,
  // Amazon, Meta, Gold, Trump, GOAT, Jupiter, Helium, SOL, Render, Pump and
  // HYPE are all absent on purpose — each would card a page about fruit,
  // rainforests, medals, politics, sports, planets, balloons, sunshine,
  // graphics, exercise or excitement.
  {
    // $2,311,685 liquidity, 10,448 holders, verified (probed 2026-08-14).
    mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
    ticker: 'QQQx',
    name: 'Nasdaq xStock',
    displayName: 'Nasdaq 100',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Nasdaq', 'Nasdaq 100', 'Nasdaq-100', 'QQQ'],
    thematic: ['tech stocks', 'stock index', 'composite', 'tech rally', 'Wall Street'],
  },
  {
    // $2,058,005 liquidity, 994 holders, verified (probed 2026-08-14).
    mint: 'SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3',
    ticker: 'SKHY',
    name: 'SK Hynix - Backpack Securities',
    displayName: 'SK Hynix',
    issuer: 'backpack-securities',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['SK Hynix', 'Hynix'],
    thematic: ['HBM', 'memory chip', 'DRAM', 'high bandwidth memory', 'semiconductor'],
  },
  {
    // $881,206 liquidity, 28,407 holders, verified (probed 2026-08-14).
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    ticker: 'TSLAx',
    name: 'Tesla xStock',
    displayName: 'Tesla',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Tesla', 'TSLA', 'Cybertruck', 'Gigafactory'],
    thematic: ['Elon Musk', 'electric vehicle', 'EV maker', 'Autopilot', 'robotaxi', 'Optimus', 'Model 3', 'Model Y'],
  },
  {
    // $450,550 liquidity, 745 holders, verified (probed 2026-08-14).
    mint: 'SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH',
    ticker: 'SNDK',
    name: 'Sandisk - Backpack Securities',
    displayName: 'SanDisk',
    issuer: 'backpack-securities',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['SanDisk'],
    thematic: ['flash storage', 'NAND', 'memory card', 'SSD', 'flash memory'],
  },
  {
    // $359,132 liquidity, 9,364 holders, verified (probed 2026-08-14).
    mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ',
    ticker: 'MSTRx',
    name: 'MicroStrategy xStock',
    displayName: 'MicroStrategy',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['MicroStrategy', 'MSTR', 'Michael Saylor'],
    thematic: ['bitcoin treasury', 'BTC holdings', 'corporate bitcoin', 'bitcoin per share'],
  },
  {
    // $354,889 liquidity, 4,554 holders, verified (probed 2026-08-14).
    mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg',
    ticker: 'HOODx',
    name: 'Robinhood xStock',
    displayName: 'Robinhood',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Robinhood', 'Vlad Tenev'],
    thematic: ['retail trading', 'commission-free', 'brokerage', 'options trading', 'meme stock'],
  },
  {
    // $323,271 liquidity, 4,400 holders, verified (probed 2026-08-14).
    mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu',
    ticker: 'COINx',
    name: 'Coinbase xStock',
    displayName: 'Coinbase',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Coinbase', 'Brian Armstrong'],
    thematic: ['crypto exchange', 'custody', 'listing', 'stablecoin', 'Base network'],
  },
  {
    // $313,331 liquidity, 16,008 holders, verified (probed 2026-08-14).
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    ticker: 'AAPLx',
    name: 'Apple xStock',
    displayName: 'Apple',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    // PRODUCTS ARE THEMATIC, NOT DIRECT. iPhone/MacBook/iPad moved out of
    // `terms` on 2026-08-19: a direct term is one whose presence NAMES the
    // company, and an iPhone review names a phone. Measured before the move,
    // "iPhone 17 review: the best one yet" matched AAPLx at score 28 with
    // `confident` — a trading card on a gadget review. TSLAx already drew
    // this line correctly (Model 3 and Autopilot are thematic); these rows
    // simply had not. Thematic still counts: a page about Apple the company
    // that also says iPhone scores HIGHER, which is the actual job.
    terms: ['Apple Inc', 'AAPL', 'Tim Cook'],
    thematic: ['iPhone', 'MacBook', 'iPad', 'App Store', 'iOS', 'Cupertino', 'Apple Silicon', 'Vision Pro', 'services revenue'],
  },
  {
    // $234,843 liquidity, 18,660 holders, verified (probed 2026-08-14).
    mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
    ticker: 'GOOGLx',
    name: 'Alphabet xStock',
    displayName: 'Google',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Google', 'Alphabet Inc', 'GOOGL', 'Sundar Pichai'],
    thematic: ['YouTube', 'search engine', 'Android', 'DeepMind', 'Gemini', 'ad revenue', 'antitrust'],
  },
  {
    // $201,603 liquidity, 4,929 holders, verified (probed 2026-08-14).
    mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX',
    ticker: 'MSFTx',
    name: 'Microsoft xStock',
    displayName: 'Microsoft',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Microsoft', 'MSFT', 'Satya Nadella'],
    thematic: ['Azure', 'Windows', 'Xbox', 'Copilot', 'OpenAI', 'enterprise software'],
  },
  {
    // $177,273 liquidity, 6,656 holders, verified (probed 2026-08-14).
    mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg',
    ticker: 'AMZNx',
    name: 'Amazon xStock',
    displayName: 'Amazon',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Amazon.com', 'AMZN', 'Jeff Bezos', 'Andy Jassy'],
    thematic: ['AWS', 'Amazon Web Services', 'e-commerce', 'Prime', 'fulfillment', 'cloud computing', 'marketplace'],
  },
  {
    // $142,228 liquidity, 786 holders, verified (probed 2026-08-14).
    mint: 'NBiSF3UaVUFtRzHwAfxyHsBCAZWGEKnMpewAE4oh7BG',
    ticker: 'NBIS',
    name: 'Nebius Group N.V. - Backpack Securities',
    displayName: 'Nebius',
    issuer: 'backpack-securities',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Nebius', 'NBIS'],
    thematic: ['AI infrastructure', 'GPU cloud', 'data center', 'AI compute'],
  },
  {
    // $114,125 liquidity, 167 holders, verified (probed 2026-08-14).
    mint: 'iNTCy1qTsUEZQe3DSocLz1ZXXai34Gdw8THQh5rxFaF',
    ticker: 'INTC',
    name: 'Intel - Backpack Securities',
    displayName: 'Intel',
    issuer: 'backpack-securities',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Intel', 'INTC'],
    thematic: ['foundry', 'x86', 'chipmaker', 'CHIPS Act', 'fab', 'process node'],
  },
  {
    // $112,997 liquidity, 3,645 holders, verified (probed 2026-08-14).
    mint: 'TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo',
    ticker: 'TTWO',
    name: 'Take-Two Interactive Software - Backpack Securities',
    displayName: 'Take-Two',
    issuer: 'backpack-securities',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Take-Two', 'Take Two Interactive', 'Rockstar Games', 'Grand Theft Auto', 'GTA 6', 'GTA VI'],
    thematic: ['video game publisher', '2K Games', 'NBA 2K', 'game release'],
  },
  {
    // $85,669 liquidity, 1,475 holders, verified (probed 2026-08-14).
    mint: 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4',
    ticker: 'PLTRx',
    name: 'Palantir xStock',
    displayName: 'Palantir',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Palantir', 'PLTR', 'Alex Karp'],
    thematic: ['data analytics', 'defense contract', 'Gotham', 'Foundry', 'AIP', 'government contract'],
  },
  {
    // $70,738 liquidity, 503 holders, verified (probed 2026-08-14).
    mint: 'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo',
    ticker: 'AVGOx',
    name: 'Broadcom xStock',
    displayName: 'Broadcom',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Broadcom', 'AVGO', 'Hock Tan'],
    thematic: ['semiconductor', 'custom silicon', 'networking chip', 'VMware', 'AI chip'],
  },
  {
    // $62,295 liquidity, 4,536 holders, verified (probed 2026-08-14).
    mint: 'XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2',
    ticker: 'MCDx',
    name: 'McDonald\'s xStock',
    displayName: 'McDonald\'s',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['McDonald', 'Big Mac', 'Happy Meal'],
    thematic: ['fast food', 'franchise', 'drive-thru', 'burger', 'same-store sales'],
  },
  {
    // $50,623 liquidity, 5,936 holders, verified (probed 2026-08-14).
    mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu',
    ticker: 'METAx',
    name: 'Meta xStock',
    displayName: 'Meta',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Meta Platforms', 'Mark Zuckerberg', 'Zuckerberg'],
    thematic: ['Facebook', 'Instagram', 'WhatsApp', 'Reality Labs', 'social media', 'ad targeting', 'Llama', 'metaverse'],
  },
  {
    // $38,766 liquidity, 4,794 holders, verified (probed 2026-08-14).
    mint: 'Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc',
    ticker: 'GMEx',
    name: 'Gamestop xStock',
    displayName: 'GameStop',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['GameStop', 'GME', 'Ryan Cohen'],
    thematic: ['meme stock', 'short squeeze', 'Roaring Kitty', 'video game retailer'],
  },
  {
    // $34,882 liquidity, 1,005 holders, verified (probed 2026-08-14).
    mint: 'Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x',
    ticker: 'BRK.Bx',
    name: 'Berkshire Hathaway xStock',
    displayName: 'Berkshire',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Berkshire Hathaway', 'Warren Buffett', 'BRK.B'],
    thematic: ['Omaha', 'value investing', 'Charlie Munger', 'GEICO', 'annual letter'],
  },
  {
    // $153,243 liquidity, 6,899 holders, verified (probed 2026-08-14).
    mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re',
    ticker: 'GLDx',
    name: 'Gold xStock',
    displayName: 'SPDR Gold',
    issuer: 'xstocks',
    chain: 'solana',
    journey: 'A',
    category: 'commodity',
    issuerRestrictions: ['us-persons'],
    terms: ['GLD ETF', 'SPDR Gold'],
    thematic: ['bullion', 'safe haven', 'troy ounce', 'precious metal', 'central bank buying', 'inflation hedge'],
  },
  {
    // $667,011,559 liquidity, 3,820,662 holders, verified (probed 2026-08-14).
    mint: 'So11111111111111111111111111111111111111112',
    ticker: 'SOL',
    name: 'Wrapped SOL',
    displayName: 'Solana',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Solana'],
    thematic: ['SOL token', 'validator', 'memecoin', 'DeFi', 'staking', 'Solana Foundation', 'network activity'],
  },
  {
    // $28,423,007 liquidity, 80,272 holders, verified (probed 2026-08-14).
    mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    ticker: 'WBTC',
    name: 'Wrapped BTC (Portal)',
    displayName: 'Bitcoin',
    issuer: 'wormhole',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Bitcoin', 'BTC'],
    thematic: ['halving', 'Satoshi', 'digital gold', 'mining', 'spot ETF', 'crypto market'],
  },  {
    // $25,922,821 liquidity, 130,652 holders, verified (probed 2026-08-14).
    mint: 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn',
    ticker: 'PUMP',
    name: 'Pump',
    displayName: 'Pump.fun',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Pump.fun', 'pumpfun'],
    thematic: ['memecoin launchpad', 'token launch', 'bonding curve', 'Solana'],
  },
  {
    // $13,616,510 liquidity, 110,786 holders, verified (probed 2026-08-14).
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    ticker: 'ETH',
    name: 'Ether (Portal)',
    displayName: 'Ethereum',
    issuer: 'wormhole',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Ethereum', 'Ether'],
    thematic: ['Vitalik', 'smart contract', 'layer 2', 'gas fees', 'rollup', 'staking'],
  },
  {
    // $8,564,374 liquidity, 255,229 holders, verified (probed 2026-08-14).
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    ticker: 'RAY',
    name: 'Raydium',
    displayName: 'Raydium',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Raydium'],
    thematic: ['AMM', 'liquidity pool', 'Solana DeFi', 'launchpad', 'trading fees'],
  },
  {
    // $2,603,171 liquidity, 21,072 holders, verified (probed 2026-08-14).
    mint: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
    ticker: 'HYPE',
    name: 'HYPE',
    displayName: 'Hyperliquid',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Hyperliquid'],
    thematic: ['perp DEX', 'on-chain trading', 'HYPE token', 'order book'],
  },
  {
    // $2,290,724 liquidity, 836,424 holders, verified (probed 2026-08-14).
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    ticker: 'JUP',
    name: 'Jupiter',
    displayName: 'Jupiter',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Jupiter Exchange', 'Jupiter DEX', 'JUP'],
    thematic: ['aggregator', 'Solana DeFi', 'perps', 'swap', 'governance'],
  },
  {
    // $478,427 liquidity, 85,135 holders, verified (probed 2026-08-14).
    mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    ticker: 'JTO',
    name: 'JITO',
    displayName: 'Jito',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Jito', 'JTO'],
    thematic: ['MEV', 'staking', 'validator', 'tips', 'liquid staking'],
  },
  {
    // $225,486 liquidity, 536,713 holders, verified (probed 2026-08-14).
    mint: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',
    ticker: 'HNT',
    name: 'Helium Network Token',
    displayName: 'Helium',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Helium Network', 'HNT', 'Helium Mobile'],
    thematic: ['hotspot', 'IoT', 'DePIN', 'wireless network', 'coverage'],
  },
  {
    // $122,807 liquidity, 306,370 holders, verified (probed 2026-08-14).
    mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    ticker: 'PYTH',
    name: 'Pyth Network',
    displayName: 'Pyth',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Pyth', 'Pyth Network'],
    thematic: ['oracle', 'price feed', 'market data', 'real-time data'],
  },
  {
    // $110,670 liquidity, 124,300 holders, verified (probed 2026-08-14).
    mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
    ticker: 'RENDER',
    name: 'Render Token',
    displayName: 'Render',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Render Network', 'RNDR'],
    thematic: ['GPU rendering', 'decentralized compute', 'OTOY', '3D graphics'],
  },
  {
    /**
     * $140,930 liquidity, 209,984 holders, organic score 94 (probed
     * 2026-08-24 via Jupiter's token search, which is also how this mint
     * was READ rather than typed: five other tokens answer to "WEN",
     * including a "Wendy's Co" and three "Wen Lambo"s. The one with the
     * airdrop's history is the one whose mint starts with its own name.
     */
    mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
    ticker: 'WEN',
    name: 'Wen',
    displayName: 'Wen',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['WEN token', 'WEN coin', 'wen airdrop'],
    thematic: ['Solana memecoin', 'airdrop', 'Jupiter ecosystem'],
  },
  {
    // $30,874,745 liquidity, 651,139 holders, verified (probed 2026-08-14).
    mint: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',
    ticker: 'TRUMP',
    name: 'OFFICIAL TRUMP',
    displayName: 'Trump Coin',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['OFFICIAL TRUMP', 'TRUMP coin', 'Trump memecoin', 'TRUMP token'],
    thematic: ['Solana memecoin', 'crypto venture', 'token launch'],
  },
  {
    // $12,040,291 liquidity, 90,757 holders, verified (probed 2026-08-14).
    mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
    ticker: 'BOME',
    name: 'BOOK OF MEME',
    displayName: 'Book of Meme',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Book of Meme', 'BOME'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $6,597,764 liquidity, 158,774 holders, verified (probed 2026-08-14).
    mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',
    ticker: 'MEW',
    name: 'cat in a dogs world',
    displayName: 'MEW',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['cat in a dogs world'],
    thematic: ['Solana memecoin', 'cat coin'],
  },
  {
    // $5,138,472 liquidity, 167,732 holders, verified (probed 2026-08-14).
    mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    ticker: 'Fartcoin',
    name: 'Fartcoin',
    displayName: 'Fartcoin',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Fartcoin'],
    thematic: ['Solana memecoin', 'AI memecoin'],
  },
  {
    // $4,146,205 liquidity, 255,776 holders, verified (probed 2026-08-14).
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    ticker: '$WIF',
    name: 'dogwifhat',
    displayName: 'dogwifhat',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['dogwifhat', 'WIF'],
    thematic: ['Solana memecoin', 'dog coin', 'hat'],
  },
  {
    // $3,501,071 liquidity, 140,664 holders, verified (probed 2026-08-14).
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    ticker: 'POPCAT',
    name: 'Popcat',
    displayName: 'Popcat',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Popcat'],
    thematic: ['Solana memecoin', 'cat coin', 'meme'],
  },
  {
    // $2,550,141 liquidity, 87,190 holders, verified (probed 2026-08-14).
    mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
    ticker: 'Pnut',
    name: 'Peanut the Squirrel',
    displayName: 'Peanut',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Peanut the Squirrel', 'PNUT'],
    thematic: ['Solana memecoin', 'squirrel', 'meme'],
  },
  {
    // $2,042,593 liquidity, 222,675 holders, verified (probed 2026-08-14).
    mint: 'FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P',
    ticker: 'MELANIA',
    name: 'Melania Meme',
    displayName: 'Melania Coin',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Melania Meme', 'MELANIA coin', 'MELANIA token'],
    thematic: ['Solana memecoin', 'token launch'],
  },
  {
    // $2,030,175 liquidity, 539,160 holders, verified (probed 2026-08-14).
    mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
    ticker: 'PENGU',
    name: 'Pudgy Penguins',
    displayName: 'Pudgy Penguins',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Pudgy Penguins', 'PENGU'],
    thematic: ['NFT', 'memecoin', 'collectibles', 'penguin'],
  },
  {
    // $1,188,944 liquidity, 88,136 holders, verified (probed 2026-08-14).
    mint: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump',
    ticker: 'GOAT',
    name: 'Goatseus Maximus',
    displayName: 'Goatseus',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Goatseus Maximus'],
    thematic: ['AI memecoin', 'Solana memecoin', 'truth terminal'],
  },
  {
    // $1,055,060 liquidity, 93,450 holders, verified (probed 2026-08-14).
    mint: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY',
    ticker: 'MOODENG',
    name: 'Moo Deng',
    displayName: 'Moo Deng',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Moo Deng', 'MOODENG'],
    thematic: ['hippo', 'Solana memecoin', 'viral meme'],
  },
  {
    // $695,709 liquidity, 1,008,257 holders, verified (probed 2026-08-14).
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    ticker: 'Bonk',
    name: 'Bonk',
    displayName: 'Bonk',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Bonk'],
    thematic: ['Solana memecoin', 'dog coin', 'community token'],
  },
  // ── EXPANSION 2, probed 2026-08-14 — the tier the first pass left out ─────
  // PreStocks (pre-IPO exposure: Anthropic, OpenAI, Anduril, Polymarket,
  // Neuralink, Kalshi — the SPACEX PreStock is deliberately absent: a second
  // SpaceX row would dominance-kill every SpaceX page). Silver via the one
  // liquid tokenization of it (Ondo's SLVon; the xStock is dead at $1).
  // Majors/DeFi tier 2, and memecoins down to ~$400k/15k-holders — still
  // burned-authorities-only, still named to be useless as English: bare
  // Orca, Cloud, Grass, Drift, TROLL, NEET, USELESS, Ava, GIGA, Vine, YZY
  // and Silver are all absent on purpose.

  {
    // $593,793 liquidity, 8,769 holders, verified (probed 2026-08-14).
    mint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
    ticker: 'ANTHROPIC',
    name: 'Anthropic PreStocks',
    displayName: 'Anthropic',
    issuer: 'prestocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Anthropic'],
    thematic: ['Claude', 'Dario Amodei', 'AI safety', 'frontier model', 'AI lab', 'chatbot'],
  },
  {
    // $263,793 liquidity, 5,175 holders, verified (probed 2026-08-14).
    mint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
    ticker: 'OPENAI',
    name: 'OpenAI PreStocks',
    displayName: 'OpenAI',
    issuer: 'prestocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['OpenAI'],
    thematic: ['ChatGPT', 'Sam Altman', 'GPT-5', 'AI lab', 'frontier model', 'chatbot', 'AGI'],
  },
  {
    // $146,226 liquidity, 2,527 holders, verified (probed 2026-08-14).
    mint: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
    ticker: 'ANDURIL',
    name: 'Anduril PreStocks',
    displayName: 'Anduril',
    issuer: 'prestocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Anduril'],
    thematic: ['Palmer Luckey', 'defense tech', 'autonomous weapons', 'drones', 'defense contract'],
  },
  {
    // $77,021 liquidity, 1,002 holders, verified (probed 2026-08-14).
    mint: 'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S',
    ticker: 'NEURALINK',
    name: 'Neuralink PreStocks',
    displayName: 'Neuralink',
    issuer: 'prestocks',
    chain: 'solana',
    journey: 'A',
    category: 'equity',
    issuerRestrictions: ['us-persons'],
    terms: ['Neuralink'],
    thematic: ['brain implant', 'brain-computer interface', 'Elon Musk', 'neurotechnology', 'clinical trial'],
  },
  {
    // $44,201 liquidity, 897 holders, verified (probed 2026-08-14).
    mint: 'iy11ytbSGcUnrjE6Lfv78TFqxKyUESfku1FugS9ondo',
    ticker: 'SLVon',
    name: 'iShares Silver Trust (Ondo Tokenized)',
    displayName: 'Silver',
    issuer: 'ondo',
    chain: 'solana',
    journey: 'A',
    category: 'commodity',
    issuerRestrictions: ['us-persons'],
    terms: ['silver price', 'spot silver', 'iShares Silver', 'silver futures', 'XAG'],
    thematic: ['precious metal', 'troy ounce', 'bullion', 'safe haven', 'industrial metal'],
  },
  {
    // $2,694,620 liquidity, 84,076 holders, verified (probed 2026-08-14).
    mint: 'DBRiDgJAMsM95moTzJs7M9LnkGErpbv9v6CUR1DXnUu5',
    ticker: 'DBR',
    name: 'deBridge',
    displayName: 'deBridge',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['deBridge'],
    thematic: ['bridge', 'cross-chain', 'interoperability'],
  },
  {
    // $1,440,780 liquidity, 53,745 holders, verified (probed 2026-08-14).
    mint: 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS',
    ticker: 'KMNO',
    name: 'Kamino',
    displayName: 'Kamino',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Kamino'],
    thematic: ['lending', 'Solana DeFi', 'yield', 'borrow'],
  },
  {
    // $749,363 liquidity, 24,035 holders, verified (probed 2026-08-14).
    mint: 'METAewgxyPbgwsseH8T16a39CQ5VyVxZi9zXiDPY18m',
    ticker: 'MPLX',
    name: 'Metaplex Token',
    displayName: 'Metaplex',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Metaplex', 'MPLX'],
    thematic: ['NFT standard', 'Solana NFT', 'minting', 'digital assets'],
  },
  {
    // $382,488 liquidity, 78,933 holders, verified (probed 2026-08-14).
    mint: 'CLoUDKc4Ane7HeQcPpE3YHnznRxhMimJ4MyaUqyHFzAu',
    ticker: 'CLOUD',
    name: 'Cloud',
    displayName: 'Sanctum',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Sanctum'],
    thematic: ['liquid staking', 'LST', 'Solana staking', 'validator'],
  },
  {
    // $375,015 liquidity, 22,047 holders, verified (probed 2026-08-14).
    mint: 'HUMA1821qVDKta3u2ovmfDQeW2fSQouSKE8fkF44wvGw',
    ticker: 'HUMA',
    name: 'Huma Finance',
    displayName: 'Huma',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Huma Finance'],
    thematic: ['PayFi', 'payment financing', 'RWA', 'lending'],
  },
  {
    // $326,013 liquidity, 150,898 holders, verified (probed 2026-08-14).
    mint: 'MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u',
    ticker: 'ME',
    name: 'Magic Eden',
    displayName: 'Magic Eden',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Magic Eden'],
    thematic: ['NFT marketplace', 'digital collectibles', 'Solana NFT', 'trading platform'],
  },
  {
    // $278,138 liquidity, 49,218 holders, verified (probed 2026-08-14).
    mint: 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7',
    ticker: 'NOS',
    name: 'Nosana',
    displayName: 'Nosana',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Nosana'],
    thematic: ['GPU network', 'decentralized compute', 'DePIN', 'AI inference'],
  },
  {
    // $144,450 liquidity, 90,030 holders, verified (probed 2026-08-14).
    mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    ticker: 'ORCA',
    name: 'Orca',
    displayName: 'Orca',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Orca DEX', 'ORCA token'],
    thematic: ['AMM', 'Solana DeFi', 'liquidity pool', 'swap'],
  },
  {
    // $136,492 liquidity, 1,960 holders, verified (probed 2026-08-14).
    mint: 'taoC6xyv2v8tDLcev4uaGUgV4vdQsWJrGft2kcBRrBY',
    ticker: 'TAO',
    name: 'Bittensor',
    displayName: 'Bittensor',
    issuer: 'bridged',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Bittensor'],
    thematic: ['decentralized AI', 'machine learning', 'subnet', 'AI network'],
  },
  {
    // $109,708 liquidity, 97,703 holders, verified (probed 2026-08-14).
    mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ',
    ticker: 'W',
    name: 'Wormhole Token',
    displayName: 'Wormhole',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Wormhole'],
    thematic: ['bridge', 'cross-chain', 'interoperability', 'message passing'],
  },
  {
    // $64,927 liquidity, 382,591 holders, verified (probed 2026-08-14).
    mint: 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs',
    ticker: 'GRASS',
    name: 'Grass',
    displayName: 'Grass',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Grass Network', 'GRASS token'],
    thematic: ['DePIN', 'bandwidth', 'data scraping', 'AI data'],
  },
  {
    // $62,519 liquidity, 28,009 holders, verified (probed 2026-08-14).
    mint: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7',
    ticker: 'DRIFT',
    name: 'Drift',
    displayName: 'Drift',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Drift Protocol'],
    thematic: ['perps', 'Solana DeFi', 'on-chain trading', 'order book'],
  },
  {
    // $39,556 liquidity, 85,702 holders, verified (probed 2026-08-14).
    mint: 'BZLbGTNCSFfoth2GYDtwr7e4imWzpR5jqcUuGEwr646K',
    ticker: 'IO',
    name: 'IO',
    displayName: 'io.net',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['io.net'],
    thematic: ['GPU network', 'decentralized compute', 'DePIN', 'AI compute'],
  },
  {
    // $2,566,776 liquidity, 142,493 holders, verified (probed 2026-08-14).
    mint: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
    ticker: 'ANSEM',
    name: 'The Black Bull',
    displayName: 'Ansem',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Ansem'],
    thematic: ['Solana memecoin', 'crypto trader', 'meme'],
  },
  {
    // $2,211,174 liquidity, 33,459 holders, verified (probed 2026-08-14).
    mint: 'FeR8VBqNRSUD5NtXAj2n3j1dAHkZHfyDktKuLXD4pump',
    ticker: 'jellyjelly',
    name: 'jelly-my-jelly',
    displayName: 'Jellyjelly',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['jellyjelly', 'jelly-my-jelly'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $1,918,863 liquidity, 63,445 holders, verified (probed 2026-08-14).
    mint: '25hAyBQfoDhfWx9ay6rarbgvWGwDdNqcHsXS3jQ3mTDJ',
    ticker: 'MANEKI',
    name: 'MANEKI',
    displayName: 'Maneki',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['MANEKI'],
    thematic: ['Solana memecoin', 'cat coin', 'lucky cat'],
  },
  {
    // $1,590,092 liquidity, 48,519 holders, verified (probed 2026-08-14).
    mint: 'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump',
    ticker: 'pippin',
    name: 'Pippin',
    displayName: 'Pippin',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Pippin'],
    thematic: ['AI agent', 'Solana memecoin', 'meme'],
  },
  {
    // $1,566,317 liquidity, 18,409 holders, verified (probed 2026-08-14).
    mint: 'DrZ26cKJDksVRWib3DVVsjo9eeXccc7hKhDJviiYEEZY',
    ticker: 'YZY',
    name: 'YZY',
    displayName: 'YZY',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['YZY coin', 'YZY token', 'YZY Money'],
    thematic: ['Kanye West', 'Solana memecoin', 'celebrity coin'],
  },
  {
    // $1,400,574 liquidity, 51,619 holders, verified (probed 2026-08-14).
    mint: '8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn',
    ticker: 'ZEREBRO',
    name: 'zerebro',
    displayName: 'Zerebro',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['zerebro'],
    thematic: ['AI agent', 'Solana memecoin', 'AI memecoin'],
  },
  {
    // $1,282,298 liquidity, 64,033 holders, verified (probed 2026-08-14).
    mint: '5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2',
    ticker: 'TROLL',
    name: 'TROLL',
    displayName: 'Troll',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['TROLL coin', 'TROLL token', '$TROLL'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $1,208,123 liquidity, 15,232 holders, verified (probed 2026-08-14).
    mint: 'G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG',
    ticker: 'BIRB',
    name: 'Moonbirds',
    displayName: 'Moonbirds',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Moonbirds', 'BIRB'],
    thematic: ['NFT', 'collectibles', 'meme'],
  },
  {
    // $1,014,725 liquidity, 20,226 holders, verified (probed 2026-08-14).
    mint: 'Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump',
    ticker: 'neet',
    name: 'NotInEmploymentEducationTraining',
    displayName: 'NEET',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['NEET coin', '$NEET'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $931,117 liquidity, 37,992 holders, verified (probed 2026-08-14).
    mint: 'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk',
    ticker: 'USELESS',
    name: 'USELESS COIN',
    displayName: 'Useless Coin',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['USELESS coin', '$USELESS'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $710,752 liquidity, 51,480 holders, verified (probed 2026-08-14).
    mint: 'KENJSUYLASHUMfHyy5o4Hp2FdNqZg1AsUPhfH2kYvEP',
    ticker: 'GRIFFAIN',
    name: 'test griffain.com',
    displayName: 'Griffain',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Griffain'],
    thematic: ['AI agent', 'Solana memecoin'],
  },
  {
    // $678,584 liquidity, 47,844 holders, verified (probed 2026-08-14).
    mint: 'DKu9kykSfbN5LBfFXtNNDPaX35o4Fv6vJ9FKk7pZpump',
    ticker: 'AVA',
    name: 'Ava AI',
    displayName: 'Ava AI',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Ava AI', '$AVA'],
    thematic: ['AI agent', 'Solana memecoin'],
  },
  {
    // $671,737 liquidity, 83,687 holders, verified (probed 2026-08-14).
    mint: '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9',
    ticker: 'GIGA',
    name: 'GIGACHAD',
    displayName: 'Gigachad',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['GIGACHAD'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $659,023 liquidity, 30,526 holders, verified (probed 2026-08-14).
    mint: 'Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump',
    ticker: 'Jimothy',
    name: 'Jimothy The Raccoon',
    displayName: 'Jimothy',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Jimothy'],
    thematic: ['raccoon', 'Solana memecoin', 'meme'],
  },
  {
    // $604,783 liquidity, 92,859 holders, verified (probed 2026-08-14).
    mint: '6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump',
    ticker: 'VINE',
    name: 'Vine Coin',
    displayName: 'Vine Coin',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Vine Coin', '$VINE'],
    thematic: ['Rus Yusupov', 'Solana memecoin', 'viral video'],
  },
  {
    // $574,165 liquidity, 17,496 holders, verified (probed 2026-08-14).
    mint: 'J8PSdNP3QewKq2Z1JJJFDMaqF7KcaiJhR7gbr5KZpump',
    ticker: 'TripleT',
    name: 'Tung Tung Tung Sahur',
    displayName: 'Tung Tung Sahur',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Tung Tung Tung Sahur'],
    thematic: ['brainrot', 'viral meme', 'Solana memecoin'],
  },
  {
    // $570,743 liquidity, 71,412 holders, verified (probed 2026-08-14).
    mint: 'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump',
    ticker: 'FWOG',
    name: 'FWOG',
    displayName: 'FWOG',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['FWOG'],
    thematic: ['frog', 'Solana memecoin', 'meme'],
  },
  {
    // $560,578 liquidity, 19,150 holders, verified (probed 2026-08-14).
    mint: 'Cm6fNnMk7NfzStP9CZpsQA2v3jjzbcYGAxdJySmHpump',
    ticker: 'Buttcoin',
    name: 'Buttcoin',
    displayName: 'Buttcoin',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Buttcoin'],
    thematic: ['Solana memecoin', 'meme', 'parody'],
  },
  {
    // $544,983 liquidity, 116,506 holders, verified (probed 2026-08-14).
    mint: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',
    ticker: 'CHILLGUY',
    name: 'Just a chill guy',
    displayName: 'Chill Guy',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['CHILLGUY', 'Just a Chill Guy'],
    thematic: ['viral meme', 'Solana memecoin', 'cartoon dog'],
  },
  {
    // $543,631 liquidity, 34,778 holders, verified (probed 2026-08-14).
    mint: 'eL5fUxj2J4CiQsmW85k5FG9DvuQjjUoBHoQBi2Kpump',
    ticker: 'UFD',
    name: 'Unicorn Fart Dust',
    displayName: 'Unicorn Fart Dust',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Unicorn Fart Dust', 'UFD'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $504,375 liquidity, 69,456 holders, verified (probed 2026-08-14).
    mint: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC',
    ticker: 'PONKE',
    name: 'PONKE',
    displayName: 'Ponke',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['PONKE'],
    thematic: ['monkey', 'Solana memecoin', 'meme'],
  },
  // ── EXPANSION 3, probed 2026-08-14 — the $300k/1k-holder tier ─────────────
  // Gold moves to its deepest tokenization (Tether Gold, $498k vs GLDx's
  // $153k) — GLDx below is narrowed to ETF-specific terms so the two gold
  // rows never compete for the same page. Wrapped assets whose bridge could
  // not be verified carry the honest generic issuer 'bridged' rather than a
  // guessed brand. Excluded and why: cbBTC/xBTC (a second Bitcoin row would
  // dominance-kill every Bitcoin page), GOLD & Dominion Silver (same, for
  // the metals), ANTFUN/XST/CATE (identity unclear — cannot curate what
  // cannot be identified), METAVERSE/SOLO/Momota (no term that is not
  // ordinary English or someone's actual name), BC.Game (editorial).

  {
    // $497,941 liquidity, 5,519 holders, verified (probed 2026-08-14).
    mint: 'AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P',
    ticker: 'XAUt0',
    name: 'Tether Gold',
    displayName: 'Gold',
    issuer: 'tether',
    chain: 'solana',
    journey: 'A',
    category: 'commodity',
    issuerRestrictions: ['us-persons'],
    terms: ['gold price', 'spot gold', 'gold futures', 'price of gold', 'XAU', 'Tether Gold'],
    thematic: ['bullion', 'safe haven', 'troy ounce', 'precious metal', 'central bank buying', 'inflation hedge'],
  },
  {
    // $5,263,908 liquidity, 89,892 holders, verified (probed 2026-08-14).
    mint: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
    ticker: 'JLP',
    name: 'Jupiter Perps',
    displayName: 'JLP',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['JLP'],
    thematic: ['Jupiter Perps', 'liquidity pool', 'perps', 'yield'],
  },
  {
    // $4,251,677 liquidity, 7,121 holders, verified (probed 2026-08-14).
    mint: 'GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc',
    ticker: 'TRX',
    name: 'TRON',
    displayName: 'TRON',
    issuer: 'bridged',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['TRX', 'TRON blockchain'],
    thematic: ['Justin Sun', 'stablecoin transfers', 'USDT'],
  },
  {
    // $4,218,248 liquidity, 45,851 holders, verified (probed 2026-08-14).
    mint: '61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump',
    ticker: 'arc',
    name: 'AI Rig Complex',
    displayName: 'AI Rig Complex',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['AI Rig Complex', '$ARC'],
    thematic: ['AI agent', 'Solana AI', 'agent framework'],
  },
  {
    // $2,752,527 liquidity, 17,321 holders, verified (probed 2026-08-14).
    mint: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
    ticker: 'ZEC',
    name: 'Zcash',
    displayName: 'Zcash',
    issuer: 'bridged',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Zcash', 'ZEC'],
    thematic: ['privacy coin', 'shielded transactions', 'zero-knowledge'],
  },
  {
    // $1,778,757 liquidity, 36,436 holders, verified (probed 2026-08-14).
    mint: 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL',
    ticker: 'MET',
    name: 'Meteora',
    displayName: 'Meteora',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Meteora DLMM', 'MET token', '$MET'],
    thematic: ['DLMM', 'liquidity pool', 'Solana DeFi', 'AMM'],
  },
  {
    // $1,601,026 liquidity, 6,073 holders, verified (probed 2026-08-14).
    mint: 'METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta',
    ticker: 'META',
    name: 'MetaDAO',
    displayName: 'MetaDAO',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['MetaDAO'],
    thematic: ['governance', 'DAO', 'treasury'],
  },
  {
    // $1,442,356 liquidity, 18,884 holders, verified (probed 2026-08-14).
    mint: 'CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp',
    ticker: 'CARDS',
    name: 'Collector Crypt',
    displayName: 'Collector Crypt',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Collector Crypt'],
    thematic: ['trading cards', 'collectibles', 'RWA', 'Pokemon cards'],
  },
  {
    // $1,057,647 liquidity, 2,263 holders, verified (probed 2026-08-14).
    mint: 'CREDBHvVqREBCAxMihzr8D1nepHMr2gmQoZWpmgGmeta',
    ticker: 'CRED',
    name: 'Credible Finance',
    displayName: 'Credible',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Credible Finance'],
    thematic: ['lending', 'credit', 'RWA', 'DeFi'],
  },
  {
    // $1,012,859 liquidity, 26,887 holders, verified (probed 2026-08-14).
    mint: 'HNg5PYJmtqcmzXrv6S9zP1CDKk5BgDuyFBxbvNApump',
    ticker: 'ALCH',
    name: 'Alchemist AI',
    displayName: 'Alchemist AI',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Alchemist AI', '$ALCH'],
    thematic: ['AI agent', 'no-code', 'Solana AI'],
  },
  {
    // $864,439 liquidity, 12,643 holders, verified (probed 2026-08-14).
    mint: 'BANKJmvhT8tiJRsBSS1n2HryMBPvT5Ze4HU95DUAmeta',
    ticker: 'AVICI',
    name: 'Avici',
    displayName: 'Avici',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Avici'],
    thematic: ['DeFi', 'Solana'],
  },
  {
    // $678,352 liquidity, 9,399 holders, verified (probed 2026-08-14).
    mint: '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx',
    ticker: 'STONK',
    name: 'STONK',
    displayName: 'Stonk',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['STONK', '$STONK'],
    thematic: ['meme', 'Solana', 'trading'],
  },
  {
    // $662,357 liquidity, 6,282 holders, verified (probed 2026-08-14).
    mint: 'PRVT6TB7uss3FrUd2D9xs2zqDBsa3GbMJMwCQsgmeta',
    ticker: 'UMBRA',
    name: 'Umbra',
    displayName: 'Umbra',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Umbra Protocol', '$UMBRA'],
    thematic: ['privacy', 'Solana DeFi'],
  },
  {
    // $655,244 liquidity, 39,557 holders, verified (probed 2026-08-14).
    mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
    ticker: 'SKR',
    name: 'Seeker',
    displayName: 'Solana Seeker',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Solana Seeker', 'SKR'],
    thematic: ['Solana phone', 'mobile', 'hardware', 'dApp store'],
  },
  {
    // $638,712 liquidity, 3,529 holders, verified (probed 2026-08-14).
    mint: '3dQTr7ror2QPKQ3GbBCokJUmjErGg8kTJzdnYjNfvi3Z',
    ticker: 'BORG',
    name: 'SwissBorg Token',
    displayName: 'SwissBorg',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['SwissBorg'],
    thematic: ['wealth app', 'crypto exchange', 'staking'],
  },
  {
    // $636,398 liquidity, 29,396 holders, verified (probed 2026-08-14).
    mint: '74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump',
    ticker: 'swarms',
    name: 'swarms',
    displayName: 'Swarms',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['$SWARMS'],
    thematic: ['AI agent', 'agent framework', 'Solana AI'],
  },
  {
    // $578,676 liquidity, 1,857 holders, verified (probed 2026-08-14).
    mint: 'TUNAfXDZEdQizTMTh3uEvNvYqJmqFHZbEJt8joP4cyx',
    ticker: 'TUNA',
    name: 'DefiTuna',
    displayName: 'DefiTuna',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['DefiTuna'],
    thematic: ['Solana DeFi', 'liquidity', 'leverage'],
  },
  {
    // $554,785 liquidity, 5,476 holders, verified (probed 2026-08-14).
    mint: 'WETZjtprkDMCcUxPi9PfWnowMRZkiGGHDb9rABuRZ2U',
    ticker: 'WET',
    name: 'HumidiFi Token',
    displayName: 'HumidiFi',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['HumidiFi'],
    thematic: ['Solana DeFi', 'AMM'],
  },
  {
    // $511,041 liquidity, 27,884 holders, verified (probed 2026-08-14).
    mint: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
    ticker: 'ORE',
    name: 'ORE',
    displayName: 'ORE',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['$ORE', 'ORE token'],
    thematic: ['proof of work', 'Solana mining', 'miner'],
  },
  {
    // $427,012 liquidity, 2,561 holders, verified (probed 2026-08-14).
    mint: '6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2',
    ticker: 'wXRP',
    name: 'Wrapped XRP',
    displayName: 'XRP',
    issuer: 'bridged',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['XRP'],
    thematic: ['Ripple', 'payments', 'SEC lawsuit', 'cross-border', 'XRP Ledger'],
  },
  {
    // $417,654 liquidity, 4,791 holders, verified (probed 2026-08-14).
    mint: '9LzCMqDgTKYz9Drzqnpgee3SGa89up3a247ypMj2xrqM',
    ticker: 'AUDIO',
    name: 'Audius (Portal)',
    displayName: 'Audius',
    issuer: 'wormhole',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Audius'],
    thematic: ['music streaming', 'artists', 'decentralized music'],
  },
  {
    // $367,028 liquidity, 4,947 holders, verified (probed 2026-08-14).
    mint: 'BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy',
    ticker: 'BP',
    name: 'Backpack',
    displayName: 'Backpack',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Backpack Exchange', 'Backpack wallet'],
    thematic: ['crypto exchange', 'Solana wallet', 'Mad Lads'],
  },
  {
    // $335,905 liquidity, 7,087 holders, verified (probed 2026-08-14).
    mint: 'J6pQQ3FAcJQeWPPGppWRb4nM8jU3wLyYbRrLh7feMfvd',
    ticker: '2Z',
    name: 'DoubleZero',
    displayName: 'DoubleZero',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['DoubleZero', '2Z'],
    thematic: ['fiber network', 'bandwidth', 'Solana infrastructure', 'DePIN'],
  },
  {
    // $309,192 liquidity, 1,725 holders, verified (probed 2026-08-14).
    mint: 'omfgRBnxHsNJh6YeGbGAmWenNkenzsXyBXm3WDhmeta',
    ticker: 'OMFG',
    name: 'Omnipair',
    displayName: 'Omnipair',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Omnipair'],
    thematic: ['Solana DeFi', 'lending', 'pairs'],
  },
  {
    // $608,890 liquidity, 6,596 holders, verified (probed 2026-08-14).
    mint: 'J1Wpmugrooj1yMyQKrdZ2vwRXG5rhfx3vTnYE39gpump',
    ticker: 'WOULD',
    name: 'would',
    displayName: 'WOULD',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['$WOULD', 'WOULD coin'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $438,030 liquidity, 13,217 holders, verified (probed 2026-08-14).
    mint: '6NwarBvDkXhByqVp2Qkq5i9XbtA2B3Bwe8SWGu9vpump',
    ticker: 'Cupsey',
    name: 'Cupsey',
    displayName: 'Cupsey',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Cupsey'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $391,428 liquidity, 37,847 holders, verified (probed 2026-08-14).
    mint: 'CreiuhfwdWCN5mJbMJtA9bBpYQrQF2tCBuZwSPWfpump',
    ticker: 'PYTHIA',
    name: 'PYTHIA',
    displayName: 'Pythia',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['$PYTHIA', 'PYTHIA coin', 'PYTHIA token'],
    thematic: ['AI memecoin', 'Solana memecoin'],
  },
  {
    // $386,979 liquidity, 25,809 holders, verified (probed 2026-08-14).
    mint: 'HgBRWfYxEfvPhtqkaeymCQtHCrKE46qQ43pKe8HCpump',
    ticker: 'Bert',
    name: 'Bertram The Pomeranian',
    displayName: 'Bertram',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['Bertram The Pomeranian', '$BERT'],
    thematic: ['dog coin', 'Solana memecoin', 'meme'],
  },
  {
    // $336,307 liquidity, 18,296 holders, verified (probed 2026-08-14).
    mint: '8XtRWb4uAAJFMP4QQhoYYCWR6XXb7ybcCdiqPwz9s5WS',
    ticker: 'ALON',
    name: 'alon',
    displayName: 'Alon',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['$ALON'],
    thematic: ['pump.fun', 'Solana memecoin', 'meme'],
  },
  // ── EXPANSION 4, probed 2026-08-14 — the $250k/500-holder tier ────────────
  // The floor of the feasible: below this sits nothing verified with both a
  // safe English identity and an exit. Excluded here: P2P/LOYAL/FOGO
  // (retained authorities on unestablished projects), The Doge NFT (bridge
  // artifact authority, unverifiable).

  {
    // $268,735 liquidity, 112,563 holders, verified (probed 2026-08-14).
    mint: 'DvjbEsdca43oQcw2h3HW1CT7N3x5vRcr3QrvTUHnXvgV',
    ticker: 'DOOD',
    name: 'Doodles',
    displayName: 'Doodles',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['Doodles NFT', 'DOOD'],
    thematic: ['NFT', 'collectibles', 'web3 brand'],
  },
  {
    // $262,924 liquidity, 13,329 holders, verified (probed 2026-08-14).
    mint: '1zJX5gRnjLgmTpq5sVwkq69mNDQkCemqoasyjaPW6jm',
    ticker: 'KLED',
    name: 'KLEDAI',
    displayName: 'Kled AI',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['KLED', 'KLEDAI'],
    thematic: ['AI agent', 'Solana AI'],
  },
  {
    // $260,339 liquidity, 2,712 holders, verified (probed 2026-08-14).
    mint: '68Nq68CrtLVpyvK5Un7UADiNczaGf39hBbj3diRsYj6D',
    ticker: 'NEST',
    name: 'Nest',
    displayName: 'Nest',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'token',
    issuerRestrictions: [],
    terms: ['$NEST'],
    thematic: ['RWA', 'yield', 'staking'],
  },
  {
    // $298,505 liquidity, 27,091 holders, verified (probed 2026-08-14).
    mint: '2Wu1g2ft7qZHfTpfzP3wLdfPeV1is4EwQ3CXBfRYAciD',
    ticker: 'GOHOME',
    name: 'GOHOME',
    displayName: 'GOHOME',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['GOHOME', '$GOHOME'],
    thematic: ['Solana memecoin', 'meme'],
  },
  {
    // $293,832 liquidity, 46,272 holders, verified (probed 2026-08-14).
    mint: '5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp',
    ticker: '$michi',
    name: 'michi',
    displayName: 'Michi',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['$MICHI'],
    thematic: ['cat coin', 'Solana memecoin', 'meme'],
  },
  {
    // $289,718 liquidity, 23,492 holders, verified (probed 2026-08-14).
    mint: 'GtDZKAqvMZMnti46ZewMiXCa4oXF4bZxwQPoKzXPFxZn',
    ticker: 'nub',
    name: 'nubcat',
    displayName: 'Nubcat',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['nubcat'],
    thematic: ['cat coin', 'Solana memecoin', 'meme'],
  },
  {
    // $274,737 liquidity, 10,985 holders, verified (probed 2026-08-14).
    mint: '8SkfuQkYNTskoQUbbjr2JbZQeqQV9egnJXgfMXf5bonk',
    ticker: 'fih',
    name: 'fih',
    displayName: 'fih',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['$FIH'],
    thematic: ['fish', 'Solana memecoin', 'meme'],
  },
  {
    // $259,390 liquidity, 29,036 holders, verified (probed 2026-08-14).
    mint: 'AujTJJ7aMS8LDo3bFzoyXDwT3jBALUbu4VZhzZdTZLmG',
    ticker: '$BEER',
    name: 'BEER',
    displayName: 'BEER',
    issuer: 'native-spl',
    chain: 'solana',
    journey: 'A',
    category: 'memecoin',
    issuerRestrictions: [],
    terms: ['$BEER', 'BEER coin'],
    thematic: ['Solana memecoin', 'meme'],
  },
];

// ── lookups ─────────────────────────────────────────────────────────────────

const BY_MINT = new Map(CURATED_CATALOG.map((a) => [a.mint, a]));
// Keys are normalized exactly the way curatedByTicker normalizes queries —
// dogwifhat's on-chain symbol is literally `$WIF`, and an unstripped key
// would make it unreachable by the very lookup built for it.
const BY_TICKER = new Map(
  CURATED_CATALOG.map((a) => [
    a.ticker.replace(/^\$/, '').trim().toLowerCase(),
    a,
  ]),
);

/**
 * THE TICKER PEOPLE WRITE, NOT THE ONE THE MINT CARRIES.
 *
 * BY_TICKER is keyed on `a.ticker`, which is the on-chain symbol. Nobody
 * types the on-chain symbol. Bitcoin is in this catalog as WBTC, so a
 * `$BTC` cashtag missed it entirely and fell through to open search, where
 * a memecoin squatting the ticker won — reported on 2026-09-11 as a chip
 * reading "BTC $0.01540 +81.7%" under a tweet about Bitcoin. Every
 * tokenized equity had the same hole: TSLAx, NVDAx, SPYx, QQQx and thirteen
 * more are unreachable by the four letters a reader actually writes.
 *
 * Two rules build the alias table, and both are deliberately narrow:
 *
 *   1. The xStocks suffix. `TSLAx` → `TSLA`. A strict naming convention, so
 *      this is structural and needs no per-entry curation.
 *   2. A term the ticker CONTAINS. `WBTC` lists 'BTC', `wXRP` lists 'XRP' —
 *      the wrapper conventions, caught without hardcoding a prefix. The
 *      containment test is what makes it safe: it admits 'BTC' for WBTC and
 *      refuses 'Starship' for SPCX, 'Tesla' for TSLAx and 'Nasdaq' for QQQx,
 *      which are brand names and belong to path C's entity matching, not to
 *      the cashtag door. Aliasing those would resolve `$STARSHIP` — a real
 *      and unrelated memecoin — to SpaceX.
 *
 * A REAL TICKER ALWAYS WINS. `$META` is MetaDAO, whose on-chain symbol is
 * literally META; the Meta xStock's derived `META` is dropped rather than
 * allowed to shadow it. And an alias claimed by two entries is dropped too,
 * which is the same rule the resolver already applies upstream: two
 * candidates is silence, not a coin flip.
 */
const ALIAS_TO_TICKER: Map<string, CuratedAsset> = (() => {
  const claims = new Map<string, Set<CuratedAsset>>();
  for (const a of CURATED_CATALOG) {
    const ticker = a.ticker.replace(/^\$/, '').trim();
    const found = new Set<string>();

    const suffix = /^([A-Za-z0-9]{2,9})x$/.exec(ticker);
    const base = suffix?.[1];
    if (base) found.add(base.toUpperCase());

    for (const term of a.terms ?? []) {
      const t = term.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,10}$/.test(t)) continue;
      if (t === ticker.toUpperCase()) continue;
      if (!ticker.toUpperCase().includes(t)) continue;
      found.add(t);
    }

    for (const alias of found) {
      const owners = claims.get(alias) ?? new Set<CuratedAsset>();
      owners.add(a);
      claims.set(alias, owners);
    }
  }

  const table = new Map<string, CuratedAsset>();
  for (const [alias, owners] of claims) {
    // A real ticker is never shadowed, and two owners is silence.
    if (BY_TICKER.has(alias.toLowerCase())) continue;
    if (owners.size !== 1) continue;
    const only = [...owners][0];
    if (only) table.set(alias.toLowerCase(), only);
  }
  return table;
})();

/** What `$BTC` resolves to, and why. Exported for the specs and for logs. */
export function curatedTickerAliases(): ReadonlyMap<string, CuratedAsset> {
  return ALIAS_TO_TICKER;
}

/** Exact mint match. The only identity lookup that cannot be ambiguous. */
export function curatedByMint(mint: string): CuratedAsset | undefined {
  return BY_MINT.get(mint.trim());
}

/**
 * Exact ticker match, case-insensitive.
 *
 * §6 path B consults this BEFORE Jupiter for catalog tickers, and that ordering
 * is deliberate. Ultra's own answer for `SPCX` is eight tokens, separated only
 * by a `verified` flag that is Jupiter's editorial call and can change without
 * us knowing. For an asset we have curated, the mint is already decided and
 * there is no reason to re-derive it per request from a third party's metadata.
 */
/**
 * REMOVING AN ENTRY FROM THIS TABLE DOES NOT PRODUCE SILENCE.
 *
 * Measured 2026-09-23, the day WBTC and ETH were briefly taken out. A
 * ticker with no catalog row falls through to OPEN SEARCH, and whoever
 * else carries the symbol wins it:
 *
 *    $WBTC  ->  the real Portal wrapper   ->  the gate decides
 *    $ETH   ->  the real Portal Ether     ->  the gate decides
 *    $BTC   ->  "Buy The Cat", $184k      ->  clears every criterion
 *
 * The asymmetry is ALIASES. $WBTC and $ETH are defended in the search by
 * the very token the row names; $BTC is a name this catalog invented, so
 * nothing stands in that contest but impostors. The same sweep found the
 * $BTC symbol swarming with them — Bounce The Cat, Better Than Crack,
 * Behind The Curtain in triplicate — each carrying ~$2.5M of liquidity
 * against ONE holder, which is wash liquidity wearing a ticker. Only the
 * holder floor stops them.
 *
 * This is the 2026-09-11 bug's own shape ("BTC $0.01540 ▲81.7%" under a
 * tweet about Bitcoin). So: a row here may be replaced, but a row whose
 * ticker has aliases must not simply be deleted.
 */

export function curatedByTicker(ticker: string): CuratedAsset | undefined {
  const key = ticker.replace(/^\$/, '').trim().toLowerCase();
  // The on-chain symbol first, then the ticker a reader would write. See
  // ALIAS_TO_TICKER: the second lookup cannot shadow the first.
  return BY_TICKER.get(key) ?? ALIAS_TO_TICKER.get(key);
}

// ── §6 path C: entity term → asset ──────────────────────────────────────────

export interface EntityCandidate {
  /** The catalog mint this term resolved to. */
  mint: string;
  /** The catalog term that matched, for logging and for tests. */
  term: string;
  count: number;
  /** Appeared in the title or a heading — the page is ABOUT this. */
  prominent: boolean;
  /** Occurrences in the headline alone. */
  headlineCount: number;
  /** Occurrences in the body alone. */
  bodyCount: number;
}

/**
 * Terms are matched with word boundaries and case-insensitively, longest first
 * so that "Micron Technology" is not also counted as a bare "Micron" hit on the
 * same words.
 */
const TERM_INDEX: ReadonlyArray<{ term: string; mint: string; re: RegExp }> =
  CURATED_CATALOG.flatMap((a) => a.terms.map((term) => ({ term, mint: a.mint })))
    .sort((x, y) => y.term.length - x.term.length)
    .map(({ term, mint }) => ({
      term,
      mint,
      // `\b` is wrong at a non-word edge: "S&P 500" ends in a digit but begins
      // with `S`, and a term like "Space X" contains a space. Anchoring on
      // non-word characters either side handles both, and escaping is required
      // because the terms contain `&` and `.`.
      re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'gi'),
    }));

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
}

/**
 * The corroborating terms, indexed SEPARATELY from TERM_INDEX and never merged
 * into it.
 *
 * Merging them would silently turn every thematic phrase into something that
 * can produce an entity candidate on its own — a page about "index funds"
 * would resolve to SPYx without ever naming it. Keeping two indices makes the
 * asymmetry structural: matchCatalogTerms answers "does this page NAME the
 * asset", matchCatalogThematic only answers "how much surrounding subject
 * matter is there", and only the first can start a match.
 */
const THEMATIC_INDEX: ReadonlyArray<{ mint: string; re: RegExp }> =
  CURATED_CATALOG.flatMap((a) =>
    (a.thematic ?? []).map((term) => ({
      mint: a.mint,
      re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'gi'),
    })),
  );

/**
 * How many DISTINCT corroborating terms each asset has on the page.
 *
 * Distinct terms rather than total occurrences on purpose: an article that says
 * "GPU" forty times is one piece of evidence repeated, while one that says
 * "GPU", "Jensen Huang" and "data center chip" once each is three independent
 * ones. Counting occurrences would let a single repeated word impersonate
 * breadth.
 */
export function matchCatalogThematic(input: {
  text: string;
  headline?: string | undefined;
}): Map<string, number> {
  const haystack = `${input.headline ?? ''}\n${input.text ?? ''}`;
  const byMint = new Map<string, number>();
  for (const { mint, re } of THEMATIC_INDEX) {
    re.lastIndex = 0;
    if (re.test(haystack)) byMint.set(mint, (byMint.get(mint) ?? 0) + 1);
  }
  return byMint;
}

/**
 * §6 path C — the ONLY entity→asset resolution in the product, and it is closed
 * over the catalog by construction.
 *
 * Open-world entity linking is not a smaller version of this and is not on the
 * roadmap this implements: it would mean deciding that a page mentioning a
 * company implies a tradable asset, which is the assumption §1 warns produces
 * adware as coverage grows. Here the vocabulary is a few dozen strings that a
 * person wrote down.
 *
 * Occurrences are counted in body text and marked prominent from the headline,
 * matching how `$TICKER` candidates are scored so that §5's corroboration rule
 * can be applied to both without a second set of thresholds.
 */
export function matchCatalogTerms(input: {
  text: string;
  headline?: string | undefined;
}): EntityCandidate[] {
  const text = input.text ?? '';
  const headline = input.headline ?? '';
  if (!text && !headline) return [];

  // Term occurrences are counted across the whole page, but a later term must
  // not re-count characters an earlier, longer term already claimed. Blanking
  // the matched span is the cheapest way to make "Micron Technology" and
  // "Micron" not both fire on the same three words.
  let body = text;
  let head = headline;

  const byMint = new Map<string, EntityCandidate>();
  for (const { term, mint, re } of TERM_INDEX) {
    re.lastIndex = 0;
    const inHead = head.match(re)?.length ?? 0;
    re.lastIndex = 0;
    const inBody = body.match(re)?.length ?? 0;
    const total = inHead + inBody;
    if (total === 0) continue;

    head = head.replace(re, (m) => ' '.repeat(m.length));
    body = body.replace(re, (m) => ' '.repeat(m.length));

    const existing = byMint.get(mint);
    if (existing) {
      existing.count += total;
      existing.headlineCount += inHead;
      existing.bodyCount += inBody;
      existing.prominent = existing.prominent || inHead > 0;
      continue;
    }
    byMint.set(mint, {
      mint,
      term,
      count: total,
      prominent: inHead > 0,
      headlineCount: inHead,
      bodyCount: inBody,
    });
  }

  return [...byMint.values()].sort(
    (a, b) => Number(b.prominent) - Number(a.prominent) || b.count - a.count,
  );
}
