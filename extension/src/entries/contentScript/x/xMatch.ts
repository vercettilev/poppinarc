import { CURATED_CATALOG as SOLANA_CATALOG } from "@spot-catalog"
import { JUP_TICKERS as SOLANA_JUP_TICKERS } from "./tickerMap.generated"
import { ARC_EDITION, ARC_NETWORK } from "~/config/edition"
import { ARC_CIRCLE_ASSETS, ARC_USDC } from "~/arc/chain"

/**
 * THE OFFLINE LISTS ARE SOLANA MINTS. In the Arc edition a local hit would
 * name a mint arc-api has never heard of, by-mint would answer null and the
 * chip would take itself down, even for a ticker that exists on Arc ($EURC
 * is on both lists). So the Arc edition starts from empty lists and every
 * cashtag goes to the server's by-ticker lane, which knows Arc's tokens.
 */
const CURATED_CATALOG: typeof SOLANA_CATALOG = ARC_EDITION ? [] : SOLANA_CATALOG
const JUP_TICKERS: typeof SOLANA_JUP_TICKERS = ARC_EDITION ? [] : SOLANA_JUP_TICKERS

/**
 * THE ARC EDITION'S OWN NAMES, so a headline can carry a chip.
 *
 * With the lists above empty, only a typed $BTC ever reached the server,
 * and a news page writes "Bitcoin", never "$BTC": measured 2026-09-29,
 * not one headline on the news hosts produced a chip in this edition. These
 * two rows feed the NAME tier alone. They go into rowByRawTicker and never
 * into byTicker, so a cashtag still takes the server's by-ticker lane and the
 * note above stays true. Nothing in TICKER_SYNONYMS, HANDLE_ALIASES or
 * CONTEXT_ALIASES names "BTC" or "EURC" as a target; one that did would leak
 * these rows into those tiers.
 *
 * "BTC" is the row's ticker because the chip prints it (displayTicker), and
 * the server lane labels a typed $BTC the same way. "EURC" only as the
 * ticker, never "euro": that word is the currency in every ECB and FX
 * headline, and buying a stablecoin under it would be a substitution.
 */
const ARC_NAME_ROWS: readonly XMatchRow[] = ARC_EDITION
  ? [
      {
        mint: ARC_CIRCLE_ASSETS[ARC_NETWORK].cirbtc,
        ticker: "BTC",
        name: "Circle Wrapped Bitcoin",
        displayName: "Bitcoin",
      },
      { mint: ARC_CIRCLE_ASSETS[ARC_NETWORK].eurc, ticker: "EURC", name: "EURC", displayName: "EURC" },
    ]
  : []
/** Case-sensitive, like every name alias: "bitcoins" and "BITCOIN" stay quiet. */
const ARC_NAME_ALIASES: ReadonlyArray<readonly [string, string]> = ARC_EDITION
  ? [
      ["Bitcoin", "BTC"],
      ["bitcoin", "BTC"],
      ["BTC", "BTC"],
      ["EURC", "EURC"],
    ]
  : []

/**
 * Which asset is this tweet about? — answered ON DEVICE.
 *
 * The strip under a tweet exists only if this module says so, and this module
 * never talks to a server: the catalog ships in the bundle (127 rows, a few
 * KB), so the tweet's text is read where it already is — in the reader's DOM.
 * Nothing about what anyone reads leaves the machine unless they tap Buy.
 * That is the privacy posture the panel is still working toward; this feature
 * starts there instead of retrofitting it.
 *
 * ── THREE TIERS, BECAUSE PRECISION IS THE PRODUCT ───────────────────────────
 * A wrong strip is not a neutral miss: a Buy button under an unrelated tweet
 * reads as spam at best and as a sick joke at worst. So the signal is tiered
 * by how much intent it carries:
 *
 *   1. CASHTAG — the author typed `$WIF` and X linkified it. The author
 *      opted the tweet into ticker semantics; highest precision.
 *   2. DOLLAR TEXT — `$WIF` written plain (quotes, screenshots-of-text,
 *      clients that did not linkify). Same authorial mark, no anchor.
 *   3. CURATED NAME — "dogwifhat", "Tesla", "SpaceX" in running text. No
 *      authorial mark, so ONLY names on a hand-kept allowlist qualify.
 *
 * ── WHY THE NAME TIER IS AN ALLOWLIST AND NOT A RULE ────────────────────────
 * The catalog was counted, not guessed at: of 127 rows, dozens have names or
 * tickers that are ordinary words — WOULD, WET, NEST, CLOUD, GRASS, DRIFT,
 * ME, W, IO, ORE, GOAT, TROLL, BEER, PUMP, HYPE. And the worst are not funny:
 * plain "Trump" or "Melania" would put a Buy button under half of political
 * X. No heuristic separates those from "Fartcoin" (unambiguous); a person
 * does, once, below. `sol` is also a Turkish word, which is not hypothetical
 * for this product's first users.
 *
 * ── ONE ANSWER PER TWEET ────────────────────────────────────────────────────
 * "ETH vs SOL" mentions two assets; a strip that picks one is half-wrong
 * either way. The rule: the FIRST cashtag wins (the author's own emphasis
 * order), then the first dollar-text hit, then the first allowlisted name.
 * Deterministic, explainable, and it never shows two strips under one tweet.
 */

export interface XMatchRow {
  mint: string
  ticker: string
  name: string
  displayName: string
  /**
   * Liquidity thin enough that a preset buy costs real money in slippage —
   * measured, not assumed. The chip still appears; the one-tap Buy does not.
   * Curated rows never carry this: they are reviewed by a person.
   */
  thin?: boolean
}

/** "address": the tweet printed the token's contract address and the
 *  server's by-mint gate described it (xStrip's address lane). The most
 *  exact tier there is, and the only one decided off the device. */
/** "ai": no rule placed the post, and the AI reader did (arc/readerClient.ts). */
export type XMatchTier = "cashtag" | "dollar" | "handle" | "name" | "context" | "address" | "ai"

export interface XMatch {
  row: XMatchRow
  tier: XMatchTier
  /** The AI reader's one line on why this post is about this asset; tier "ai" only. */
  reason?: string
}

/**
 * The name-tier allowlist: alias → ticker, matched CASE-SENSITIVELY on word
 * boundaries. Case is part of the curation: "Apple" is a company and "apple"
 * is a fruit; "Intel" is a company and "intel" is what soldiers gather;
 * "nvidia" survives lowercase because it means nothing else.
 *
 * Deliberately ABSENT, with reasons, so nobody "fixes" them back in:
 *   Trump, Melania    political names; the tweet is about the person
 *   Meta              collides with MetaDAO's exact ticker AND the adjective
 *   Gold, Silver      commodities' names are just words
 *   Jupiter           more planet than DEX outside crypto-X
 *   Orca, Grass, Cloud, Nest, Drift, Wormhole… ordinary nouns
 *   Bonk, Gigachad    live as slang far more than as assets
 */
const NAME_ALIASES: ReadonlyArray<readonly [string, string]> = [
  // crypto-native, unambiguous in any case
  ["dogwifhat", "$WIF"],
  ["Dogwifhat", "$WIF"],
  ["Fartcoin", "Fartcoin"],
  ["fartcoin", "Fartcoin"],
  ["Popcat", "POPCAT"],
  ["Pudgy Penguins", "PENGU"],
  ["Moo Deng", "MOODENG"],
  ["Peanut the Squirrel", "Pnut"],
  ["Goatseus", "GOAT"],
  ["Book of Meme", "BOME"],
  ["Hyperliquid", "HYPE"],
  ["Raydium", "RAY"],
  ["raydium", "RAY"],
  ["Bittensor", "TAO"],
  ["Pyth", "PYTH"],
  ["Solana", "SOL"],
  ["solana", "SOL"],
  ["Bitcoin", "WBTC"],
  ["bitcoin", "WBTC"],
  ["Ethereum", "ETH"],
  ["ethereum", "ETH"],
  /**
   * BARE TICKERS, uppercase only, and only where the letters are not a word.
   *
   * Caught in the field: "BTC looked dead just a few days ago. Now it's above
   * $75K…" matched nothing. `$BTC` resolves (TICKER_SYNONYMS), "Bitcoin"
   * resolves, but the form people actually type most — the bare ticker — did
   * not. The context tier could not save it either: that tweet has no CONTEXT
   * WORD in it ("shorts" is not "short" under \b).
   *
   * The bar for adding to this list is unchanged and deliberately high: the
   * letters must mean the asset and nothing else. BTC and ETH clear it. SOL
   * does not (Turkish for "left", Spanish for "sun") and is why that rule
   * exists; ADA, GOAT, WOULD and CLOUD do not clear it either. Anything
   * ambiguous still reaches an asset only through the author's own `$`.
   */
  ["BTC", "WBTC"],
  ["ETH", "ETH"],
  // Found by the same audit that caught ORE: XRP was reachable ONLY by the
  // author's $, and three capitals that mean one asset and nothing else are
  // exactly what this list is for. It is also among the most-typed tickers
  // on finance X, so the miss was large and quiet.
  ["XRP", "wXRP"],
  ["Zcash", "ZEC"],
  ["Meteora", "MET"],
  ["MetaDAO", "META"],
  ["Audius", "AUDIO"],
  ["SwissBorg", "BORG"],
  ["DoubleZero", "2Z"],
  ["io.net", "IO"],
  ["deBridge", "DBR"],
  ["Kamino", "KMNO"],
  ["Metaplex", "MPLX"],
  ["Sanctum", "CLOUD"],
  ["Magic Eden", "ME"],
  ["Nosana", "NOS"],
  ["Zerebro", "ZEREBRO"],
  ["Pump.fun", "PUMP"],
  ["pump.fun", "PUMP"],
  ["Pumpfun", "PUMP"],
  // the pre-IPO and equity names people actually type
  ["SpaceX", "SPCX"],
  ["Anthropic", "ANTHROPIC"],
  ["OpenAI", "OPENAI"],
  ["Anduril", "ANDURIL"],
  ["Neuralink", "NEURALINK"],
  ["NVIDIA", "NVDAx"],
  ["Nvidia", "NVDAx"],
  ["nvidia", "NVDAx"],
  ["Tesla", "TSLAx"],
  ["MicroStrategy", "MSTRx"],
  ["Robinhood", "HOODx"],
  ["robinhood", "HOODx"],
  ["Coinbase", "COINx"],
  ["coinbase", "COINx"],
  ["Palantir", "PLTRx"],
  ["palantir", "PLTRx"],
  ["Broadcom", "AVGOx"],
  ["GameStop", "GMEx"],
  ["Gamestop", "GMEx"],
  ["Berkshire Hathaway", "BRK.Bx"],
  ["Micron Technology", "MU"],
  ["SK Hynix", "SKHY"],
  ["SanDisk", "SNDK"],
  ["Nebius", "NBIS"],
  ["Take-Two", "TTWO"],
  ["McDonald's", "MCDx"],
  // capital-only: the lowercase form is a common word or a verb
  ["Apple", "AAPLx"],
  ["Google", "GOOGLx"],
  ["Alphabet", "GOOGLx"],
  ["Microsoft", "MSFTx"],
  ["Amazon", "AMZNx"],
  ["Intel", "INTC"],
  ["S&P 500", "SPYx"],
  // Finance X writes the index as SPX / #SPX (futures habit). Uppercase
  // only — three capitals are a ticker, "spx" in prose is nothing.
  ["SPX", "SPYx"],
  ["Nasdaq 100", "QQQx"],

  // ── SECOND PASS ───────────────────────────────────────────────────────────
  // Found in the field: a tweet about opening a position on Backpack, closing
  // it at dinner and paying the bill with the Backpack card — the exact
  // reader this feature is for — and no chip, because BP sat in the catalog
  // with no name to reach it by. An audit then showed 68 catalog rows with no
  // alias at all. Most of those absences are correct (see the list above);
  // these are the ones that were simply missed.
  //
  // The test for adding one is unchanged: would this word appear in an
  // ordinary sentence meaning something else? "Render", "Swarms", "Alon" and
  // "Huma" all would, so they stay out. Capital-only where the lowercase form
  // is a common noun.
  ["Backpack", "BP"],
  ["Jito", "JTO"],
  ["jito", "JTO"],
  ["TRON", "TRX"],
  ["Wormhole", "W"],
  ["Moonbirds", "BIRB"],
  ["Ansem", "ANSEM"],
  ["Circle", "CRCLx"],
  ["Helium", "HNT"],
  ["Umbra", "UMBRA"],
  ["Doodles", "DOOD"],
  ["Solana Seeker", "SKR"],
  ["AI Rig Complex", "arc"],
  ["Collector Crypt", "CARDS"],
  ["Alchemist AI", "ALCH"],
  ["DefiTuna", "TUNA"],
  ["Omnipair", "OMFG"],
  ["Kled AI", "KLED"],
  ["Pythia", "PYTHIA"],
  ["Unicorn Fart Dust", "UFD"],
  ["Useless Coin", "USELESS"],
  ["Buttcoin", "Buttcoin"],
  ["Vine Coin", "VINE"],
  ["Ponke", "PONKE"],
  ["Maneki", "MANEKI"],
  ["Pippin", "pippin"],
  ["Jellyjelly", "jellyjelly"],
  ["Griffain", "GRIFFAIN"],
  ["Cupsey", "Cupsey"],
  ["Nubcat", "nub"],
  ["Michi", "$michi"],
  ["Bertram", "Bert"],
]

/**
 * Project accounts whose @mention reliably means "this tweet is about that
 * project" — handle (lowercase) → ticker.
 *
 * ── WHY THIS IS AN OPT-IN LIST AND NOT A RULE ───────────────────────────────
 * Handles were excluded from matching outright after "@solana Summit Serbia"
 * put a $SOL chip under somebody's conference plans. That fix was right about
 * @solana and wrong as a general law: a tweet saying "I opened a position on
 * @Backpack" is exactly the reader this feature is for, and it got nothing.
 *
 * The difference is not the syntax, it is the ACCOUNT. Big-L1 handles are
 * ambient — @solana is tagged by every event, every builder, every hackathon,
 * and the tag says nothing about the asset. A project account like @Backpack
 * is tagged when the tweet is about that project. So precision is a property
 * of the handle, and the only honest way to encode that is one row at a time.
 *
 * DELIBERATELY ABSENT: @solana, @ethereum, @jupiterexchange and every other
 * account that gets tagged for ecosystem reasons. Adding one of those brings
 * the original bug back wholesale.
 *
 * A WRONG HANDLE POINTS BUY AT THE WRONG TWEET — if the account does not
 * belong to the project, this silently matches somebody else's audience.
 * Review additions the way the generated ticker map is reviewed.
 */
/**
 * HANDLES WHOSE AUTHOR IS NOT THE SUBJECT.
 *
 * The author-first rule below is right for accounts that ARE the asset —
 * @wenwencoin announcing anything is announcing WEN — and wrong for a
 * PERSON who happens to have a creator coin. Measured live, twice in one
 * evening: @blknoiz06 wrote "solana has not looked this good since october
 * of 2023" and the chip said ANSEM instead of SOL; then "pump is so
 * hilariously strong" and the chip said ANSEM again. A person tweets about
 * the whole market; stamping their coin on every take is exactly the
 * "algoritma yeterince akıllı değil" verdict it earned.
 *
 * Handles in this set still resolve from TEXT mentions — a tweet ABOUT
 * @blknoiz06 is genuinely about Ansem — but being the AUTHOR claims
 * nothing. Project and org accounts stay author-first: @tesla's tweets are
 * about Tesla.
 */
const PERSON_HANDLES: ReadonlySet<string> = new Set(["blknoiz06"])

const HANDLE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  /**
   * THE ACCOUNT IS THE ASSET, and this tier runs BEFORE names for exactly
   * the case that put it here: @wenwencoin announcing its own airdrop "on
   * Solana" matched SOL, because "Solana" is a name alias and WEN was in
   * nobody's list. A token's own account tweeting about itself is the least
   * ambiguous evidence this file will ever see; a chain named in passing is
   * among the weakest.
   */
  ["wenwencoin", "WEN"],
  ["pumpfun", "PUMP"],
  /**
   * @ORE, live: "HighORE for longORE." — the pun IS the tweet, so there is
   * no bare "ORE" for the name tier (and "ore" is an English word, which is
   * why that tier would refuse it anyway). ORE has been in the catalog since
   * the 2026-08-14 expansion; only its account was missing.
   */
  ["ore", "ORE"],
  ["backpack", "BP"],
  ["wormhole", "W"],
  ["blknoiz06", "ANSEM"],
  ["circle", "CRCLx"],
  ["helium", "HNT"],
  ["doodles", "DOOD"],
  ["pudgypenguins", "PENGU"],
  ["hyperliquidx", "HYPE"],
  ["openai", "OPENAI"],
  ["anthropicai", "ANTHROPIC"],
  ["neuralink", "NEURALINK"],
  ["spacex", "SPCX"],
  ["tesla", "TSLAx"],
  ["nvidia", "NVDAx"],
  ["coinbase", "COINx"],
  ["robinhoodapp", "HOODx"],
  ["palantirtech", "PLTRx"],
  ["gamestop", "GMEx"],
  ["apple", "AAPLx"],
  ["microsoft", "MSFTx"],
  ["google", "GOOGLx"],
  ["amazon", "AMZNx"],
  ["meta", "METAx"],
  ["broadcom", "AVGOx"],
  ["mcdonalds", "MCDx"],
  ["microstrategy", "MSTRx"],
  ["strategy", "MSTRx"],
]

/**
 * Names that are ordinary words on their own and unmistakable next to a
 * TRADE. "I'm packing my backpack" is luggage; "holding backpack, bullish" is
 * a position. Same word, and the sentence around it decides.
 *
 * This is how the ambiguous half of the catalog becomes reachable without
 * reopening the door that "Trump" and "sol" walk through: these aliases match
 * ONLY when the tweet also carries a word from CONTEXT_WORDS below. Political
 * names stay out regardless — "bullish on Trump" is a sentence about a
 * politician far more often than about a coin, and the author's own $ mark
 * remains the only way to mean the asset.
 */
/**
 * TICKERS THAT ARE ALSO WORDS, admitted only in uppercase AND only framed.
 *
 * SOL is the reason this list exists: three capitals that mean Solana on
 * finance X and "left" in Turkish, "sun" in Spanish everywhere else. The
 * bare-ticker list rightly refuses it — but "believes SOL will hit $500"
 * was drawing no chip, and that tweet is not ambiguous to anyone. Two gates
 * stacked make it safe where one could not: the letters must be EXACTLY
 * uppercase (case-sensitive regex, unlike CONTEXT_ALIASES below), and the
 * tweet must already be framed as markets (context word, cashtag, or a
 * dollar amount). "sol tarafta" fails the case; "SOL yesterday" fails the
 * frame; the price-target tweet passes both.
 */
const CONTEXT_TICKERS: ReadonlyArray<readonly [string, string]> = [
  ["SOL", "SOL"],
  // Three capitals that mean the metal and nothing else. Unlike SOL the
  // letters are not a word anywhere, but the framed gate costs nothing and
  // keeps the lane's rule uniform: bare tickers enter framed tweets only.
  ["XAU", "XAUt0"],

  /**
   * THE WAY PEOPLE ACTUALLY WRITE A STOCK.
   *
   * Field case: an r/stockstobuytoday thread titled "Is NVDA a good buy
   * right now or do you see it dropping even more soon?" got nothing. The
   * cashtag tier answers $NVDA and the name tier answers "Nvidia", and a
   * room full of people discussing stocks writes neither — it writes the
   * bare symbol, in capitals, every time.
   *
   * These belong in THIS lane rather than the name lane because the
   * capitals alone are not enough: four letters can be an acronym, and the
   * sentence has to be about a trade before they are worth reading as a
   * ticker. That is exactly the gate this lane is.
   *
   * COIN IS DELIBERATELY ABSENT. "which COIN should I buy" is a sentence
   * this lane would accept and Coinbase is not what it means; the word is
   * too common in the rooms where a trade frame is always present. $COIN
   * still answers, because a cashtag is a person naming an asset on
   * purpose.
   */
  ["AAPL", "AAPLx"],
  ["AMZN", "AMZNx"],
  ["AVGO", "AVGOx"],
  ["CRCL", "CRCLx"],
  ["GLD", "GLDx"],
  ["GME", "GMEx"],
  ["GOOGL", "GOOGLx"],
  ["HOOD", "HOODx"],
  ["MCD", "MCDx"],
  ["META", "METAx"],
  ["MSFT", "MSFTx"],
  ["MSTR", "MSTRx"],
  ["NVDA", "NVDAx"],
  ["PLTR", "PLTRx"],
  ["QQQ", "QQQx"],
  ["SPY", "SPYx"],
  ["TSLA", "TSLAx"],
]

const CONTEXT_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["backpack", "BP"],
  ["wormhole", "W"],
  ["render", "RENDER"],
  ["drift", "DRIFT"],
  ["grass", "GRASS"],
  ["orca", "ORCA"],
  ["jupiter", "JUP"],
  ["bonk", "Bonk"],
  ["jito", "JTO"],
  ["circle", "CRCLx"],
  ["helium", "HNT"],
  ["doodles", "DOOD"],
  ["swarms", "swarms"],
  ["useless", "USELESS"],
  ["gigachad", "GIGA"],
  ["moonbirds", "BIRB"],
  ["seeker", "SKR"],
  ["troll", "TROLL"],
  ["fartcoin", "Fartcoin"],
  ["popcat", "POPCAT"],
  /**
   * ORE is a mineral before it is a token, so it can only live here — the
   * name tier does not take words (the same rule that keeps out WOULD,
   * CLOUD, GOAT and sol). Caught in the field: a whole thread headed "ORE
   * Liquidity", by @ORE_bull, about ORE's treasury, matched nothing at all.
   */
  ["ore", "ORE"],
  /**
   * ── THE SECOND PASS, AND THE EIGHT THAT DID NOT SURVIVE IT ────────────────
   * These reach the context tier because the letters mean the asset and
   * nothing else in English. Probed first, like everything else here.
   *
   * REJECTED, and why, so nobody adds them back by feel:
   *   mew     a Pokémon, and Pokémon cards are traded in market language
   *   yzy     Yeezy — sneaker resale talks about floors and buying too
   *   stonk   slang for stocks in general, not for this token
   *   alon    a person crypto X tweets about constantly
   *   neet    an ordinary acronym with its own discourse
   *   ava     a top-20 given name
   *   huma    a given name
   *   cred    slang, as in street cred
   * Each of those is reachable by the author's own $ and by their handle,
   * which is the right amount of reach for a word that means something else.
   */
  ["fwog", "FWOG"],
  ["jlp", "JLP"],
  ["jimothy", "Jimothy"],
  ["avici", "AVICI"],
  ["chillguy", "CHILLGUY"],
  ["gohome", "GOHOME"],
]

/**
 * The words that turn a noun into a position. Deliberately about TRADING and
 * not about sentiment in general: "love", "great" and "amazing" describe
 * everything on X, while "holding", "bought" and "bullish" describe holding
 * something. Kept tight on purpose — every word here widens what an ordinary
 * noun can trigger.
 *
 * ── MEASURED, AFTER SHIPPING THE WRONG VERSION ──────────────────────────────
 * This list used to hold the bare words `long`, `short`, `hold`, `position`
 * and `chart`, and they were quietly catastrophic. Probed against ordinary
 * English, 14 of the 21 shipped context aliases produced a Buy button:
 *
 *   "the grass is long and needs cutting"        -> GRASS
 *   "hold the backpack for me a second"          -> Backpack
 *   "orca whales hold their breath a long time"  -> ORCA
 *   "render times are long on this machine"      -> Render
 *   "helium is short in supply at the party"     -> Helium
 *
 * Widening the list only made it worse, because the next probe reached the
 * verbs: `bought`, `sold`, `bags`, `pump`, `moon`, `entry`, `portfolio`,
 * `chart` and `accumulating` each caught a sentence with no asset in it.
 * "bought a new backpack" is the whole problem in four words.
 *
 * Not one failure came from a word that only exists in markets. So the rule
 * this list now follows is not a matter of taste: a standalone frame word
 * must have NO ordinary-English use at all. Everything else has to earn its
 * meaning from a construction (CONTEXT_PHRASES) or from the author's own $.
 *
 * The cost is real and accepted: "bought grass at the bottom" no longer
 * matches on its own. A miss is quiet; a Buy button under someone's shopping
 * is not. The full probe lives in the spec and is the guard on this list.
 */
const CONTEXT_WORDS =
  /\b(bullish|bearish|hodl\w*|dca|mcap|market ?cap|all.?time high|ath|liquidity|tvl|fdv|pnl|apy|airdrop\w*|defi|on-?chain|staking|staked|restaking|buybacks?|slippage|presale|vesting|unstake\w*|market maker|floor price|memecoins?|altcoins?|shitcoins?|tokenomics|degen|dex|cex|price action|take ?profit|stop ?loss|bagholders?)\b/i

/**
 * The same meaning, but only inside a construction. "long", "short", "hold"
 * and "position" are ordinary English standing alone — grass is long, you
 * hold a door, you are not in a position to help — and unmistakable the
 * moment they are conjugated or paired. That difference is the whole guard.
 */
/**
 * THE SAME IDEA, IN THE ROOMS WHERE STOCKS ARE DISCUSSED.
 *
 * Every frame above is crypto vocabulary — hodl, dca, tvl, apy, degen,
 * dex. A subreddit full of people arguing about Nvidia speaks none of it,
 * and the one measured in the field spoke plain English: "Is NVDA a good
 * buy right now or do you see it dropping even more soon?" That sentence
 * is unmistakably about a trade and this file could not see it, so the
 * bare ticker behind it stayed shut.
 *
 * Constructions, not words, for the reason the list below already uses
 * them: "buy" alone is what you do with coffee. "a good buy", "should I
 * buy", "price target" and "earnings call" are not things anyone says
 * about coffee.
 */
const STOCK_PHRASES =
  /\b(?:good|solid|strong|bad|screaming)\s+buy\b|\bis\s+(?:\w+\s+){0,2}a\s+buy\b|\bshould\s+i\s+(?:buy|sell)\b|\bbuy(?:ing)?\s+(?:the\s+)?dip\b|\bprice\s+targets?\b|\bearnings\s+(?:call|report|season|beat|miss|play|tomorrow|today)\b|\b(?:52.?week|all.?time)\s+(?:high|low)\b/i

const CONTEXT_PHRASES =
  /\b(?:going|went|go|am|i'?m|stay(?:ing)?)\s+(?:long|short)\b|\blong(?:ing)\b|\bshort(?:ing|ed)\b|\b(?:long|short|open(?:ed)?|clos(?:e|ed)|my|full|entire)\s+(?:a\s+)?positions?\b|\bbought\s+(?:the\s+)?(?:dip|top|bottom)\b|\b(?:buy|sell|market|limit)\s+orders?\b/i

/**
 * Any frame is permission enough, and a cashtag ANYWHERE in the tweet is one.
 *
 * This is the cheapest strong signal on the page and it was going unused. An
 * author who typed a $ has declared the tweet is about markets, even when the
 * ticker they typed is not the asset the sentence is about — "$SOL is quiet,
 * grass is where the volume went" names one asset with a sigil and another
 * without. Nobody writes a $ while shopping for a backpack.
 */
function isFramed(text: string, cashtags: string[]): boolean {
  return (
    cashtags.length > 0 ||
    CONTEXT_WORDS.test(text) ||
    CONTEXT_PHRASES.test(text) ||
    STOCK_PHRASES.test(text) ||
    // A written dollar figure ("will hit $500", "sold at $1.2k") is market
    // framing as surely as any vocabulary word — nobody prices a backpack
    // debate. Kept NARROW: sigil then digit, so cashtags ($SOL) do not
    // double-count and lone "$" decorations do not fire.
    /\$\s?\d/.test(text)
  )
}

/**
 * Cashtags people type for assets whose catalog ticker is the WRAPPED form.
 * `$TSLA` means the Tesla xStock here; nobody tweets `$TSLAx`.
 */
const TICKER_SYNONYMS: ReadonlyArray<readonly [string, string]> = [
  ["BTC", "WBTC"],
  ["XRP", "wXRP"],
  /**
   * GOLD, the way people actually write it. The catalog has carried Tether
   * Gold as XAUt0 all along — and a field screenshot ("$XAUUSD Oh boy")
   * showed no chip, because nobody on earth types $XAUt0. The forex pair,
   * the metal's symbol, the plain word: all one asset here. PAXG is NOT
   * mapped — that is Paxos's product, and answering somebody's $PAXG with
   * Tether's gold would be a substitution, not a synonym.
   */
  ["XAU", "XAUt0"],
  ["XAUUSD", "XAUt0"],
  ["XAUT", "XAUt0"],
  ["GOLD", "XAUt0"],
]

interface Index {
  byTicker: Map<string, XMatchRow>
  aliases: Array<{ alias: string; re: RegExp; row: XMatchRow }>
  handles: Map<string, XMatchRow>
  /** The subset whose AUTHORSHIP is evidence — token and org accounts. */
  authorHandles: Map<string, XMatchRow>
  context: Array<{ alias: string; re: RegExp; row: XMatchRow }>
}

/**
 * Tickers the CATALOG does not own, from Jupiter's verified set.
 *
 * ── WHY THE UNIVERSE GREW, AND ONLY HERE ────────────────────────────────────
 * The catalog is 127 rows of human review. That is the right size for a list
 * that decides what we ENDORSE, and the wrong size for a list that decides
 * what a cashtag may NAME: someone tweeting $PENGU is talking about an asset
 * whether or not a person has reviewed it, and answering with silence is a
 * miss, not a safeguard. The routing gate already decides tradeability per
 * mint at request time (§7), and a live probe confirmed it admits open mints
 * end to end — so naming can widen without endorsement widening.
 *
 * These rows are admitted to the CASHTAG and DOLLAR tiers ONLY. The name tier
 * stays curated, because "$PENGU" is a claim about a ticker while "penguins"
 * is a word in a sentence.
 *
 * Every safety rule that makes this defensible lives in the generator, where
 * it can be re-run and diffed: verified only, deepest liquidity wins a
 * ticker, ambiguous claims dropped, catalog always outranks. See
 * scripts/build-ticker-map.mjs.
 */
function jupRows(): Array<[string, XMatchRow]> {
  return JUP_TICKERS.map(([ticker, r]) => [
    ticker,
    {
      mint: r.mint,
      ticker,
      name: r.name,
      displayName: r.name,
      ...(r.thin ? { thin: true as const } : {}),
    },
  ])
}

let index: Index | null = null

function buildIndex(): Index {
  const byTicker = new Map<string, XMatchRow>()
  const rowByRawTicker = new Map<string, XMatchRow>()

  for (const r of CURATED_CATALOG) {
    const row: XMatchRow = {
      mint: r.mint,
      ticker: r.ticker,
      name: r.name,
      displayName: r.displayName,
    }
    rowByRawTicker.set(r.ticker, row)
    // `$WIF` the ticker is typed as `$WIF` the cashtag: strip the sigil.
    byTicker.set(r.ticker.replace(/^\$/, "").toUpperCase(), row)
  }
  // Name tier only: see ARC_NAME_ROWS for why these never reach byTicker.
  for (const row of ARC_NAME_ROWS) rowByRawTicker.set(row.ticker, row)

  // Wrapped equities: `TSLAx` is the catalog's name for the thing a tweet
  // calls `$TSLA`. Lowercase-x suffix only — SPCX's X is part of the name.
  // An EXACT ticker always outranks a derived one (META the DAO keeps $META;
  // Meta Platforms' xStock does not steal it).
  for (const r of CURATED_CATALOG) {
    const m = /^([A-Z0-9.]{2,})x$/.exec(r.ticker)
    if (!m) continue
    const base = m[1].toUpperCase()
    if (!byTicker.has(base)) byTicker.set(base, rowByRawTicker.get(r.ticker)!)
  }

  for (const [from, to] of TICKER_SYNONYMS) {
    const row = rowByRawTicker.get(to)
    if (row && !byTicker.has(from)) byTicker.set(from, row)
  }

  // Jupiter's verified tickers fill what the catalog leaves empty. Last, and
  // never overwriting: a curated row is a decision, and a feed does not get
  // to overrule one.
  for (const [ticker, row] of jupRows()) {
    if (!byTicker.has(ticker)) byTicker.set(ticker, row)
  }

  const aliases: Index["aliases"] = []
  for (const [alias, ticker] of [...NAME_ALIASES, ...ARC_NAME_ALIASES]) {
    const row = rowByRawTicker.get(ticker)
    // A row can leave the catalog; its alias must die with it, silently.
    if (!row) continue
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // Word boundaries by hand: \b misbehaves around & and . — "S&P 500"
    // and "io.net" are real aliases here, not edge cases. The @ in the
    // class is a field lesson: "@solana Summit Serbia" put a $SOL strip
    // under somebody's conference plans. Tagging an ACCOUNT is talking to
    // it, not about the asset — a handle never counts as a name mention.
    aliases.push({
      alias,
      re: new RegExp(`(^|[^\\w$@])${escaped}(?![\\w])`),
      row,
    })
  }
  const handles = new Map<string, XMatchRow>()
  const authorHandles = new Map<string, XMatchRow>()
  for (const [handle, ticker] of HANDLE_ALIASES) {
    const row = rowByRawTicker.get(ticker)
    if (!row) continue
    handles.set(handle.toLowerCase(), row)
    // A person's coin never claims their tweets; see PERSON_HANDLES.
    if (!PERSON_HANDLES.has(handle.toLowerCase())) {
      authorHandles.set(handle.toLowerCase(), row)
    }
  }

  const context: Index["context"] = []
  for (const [alias, ticker] of CONTEXT_ALIASES) {
    const row = rowByRawTicker.get(ticker)
    if (!row) continue
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // Case-INSENSITIVE here: the context word is what disambiguates, so the
    // capital letter no longer has to carry that weight on its own.
    context.push({ alias: alias.toLowerCase(), re: new RegExp(`(^|[^\\w$@])${escaped}(?![\\w])`, "i"), row })
  }
  for (const [alias, ticker] of CONTEXT_TICKERS) {
    const row = rowByRawTicker.get(ticker)
    if (!row) continue
    // Case-SENSITIVE on purpose — the capitals are half the evidence.
    context.push({ alias: alias.toLowerCase(), re: new RegExp(`(^|[^\\w$@])${alias}(?![\\w])`), row })
  }

  return { byTicker, aliases, handles, authorHandles, context }
}

/** `$WIF`, `$TSLA`, `$BRK.B` — the sigil plus a plausible ticker. */
const DOLLAR_RE = /\$([A-Za-z][A-Za-z0-9.]{1,9})/g

export function resolveCashtag(tag: string): XMatchRow | null {
  index ??= buildIndex()
  return index.byTicker.get(tag.replace(/^\$/, "").toUpperCase()) ?? null
}

/**
 * A handle, cut into the words it is made of: ORE_bull → ore, bull.
 *
 * Only whole segments count. "moreno" and "storefront" are one segment each
 * and match nothing, which is the entire safety property: an asset name has
 * to be a word the author chose, not letters that happen to sit inside one.
 */
function handleSegments(handle: string): string[] {
  return handle
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean)
}

/**
 * The tweet, reduced to one tradeable asset or none.
 *
 * `cashtags` are the anchor texts X linkified (DOM order); `text` is the
 * tweet's full visible text. Mints in `disabled` never match — that list is
 * the remote kill switch's fine-grained half. `author` is the handle the
 * tweet was posted from, which vouches for its own asset and nothing else.
 */
/**
 * Is this mint one a person reviewed and wrote down? The chip shows an
 * "Unverified token" line for everything else — the open-regime mints the
 * server's gate admits on numbers alone. Local and instant: the catalog
 * already ships in this bundle.
 */
// On Arc the reviewed list is Circle's own assets, so EURC never reads "Unverified".
const curatedMints: Set<string> = ARC_EDITION
  ? new Set([ARC_USDC, ...Object.values(ARC_CIRCLE_ASSETS[ARC_NETWORK])])
  : new Set(CURATED_CATALOG.map((a) => a.mint))
export function isCuratedMint(mint: string): boolean {
  return curatedMints.has(mint)
}

export function matchTweet(
  text: string,
  cashtags: string[],
  disabled?: ReadonlySet<string>,
  author?: string,
): XMatch | null {
  index ??= buildIndex()
  const dead = (row: XMatchRow) => disabled?.has(row.mint) ?? false

  for (const tag of cashtags) {
    const row = resolveCashtag(tag)
    if (row && !dead(row)) return { row, tier: "cashtag" }
  }

  for (const m of text.matchAll(DOLLAR_RE)) {
    const row = index.byTicker.get(m[1].toUpperCase())
    if (row && !dead(row)) return { row, tier: "dollar" }
  }

  // TIER 3 — a project's own account, for the handles where that is a signal
  // rather than ecosystem noise. See HANDLE_ALIASES for why it is a list.
  //
  // THE AUTHOR COUNTS FIRST, and until this line it counted for nothing: the
  // parameter was plumbed in and never read, so only @mentions INSIDE the
  // text could reach this tier. A token's own account announcing its own
  // airdrop — @wenwencoin, live — mentions itself nowhere in the body, fell
  // through to the name tier, and the chip offered $SOL because the tweet
  // said "on Solana". An account that IS an asset is the least ambiguous
  // evidence here; a chain named in passing is among the weakest.
  if (author) {
    const row = index.authorHandles.get(author.toLowerCase())
    if (row && !dead(row)) return { row, tier: "handle" }
  }
  for (const m of text.matchAll(/@(\w{1,15})/g)) {
    const row = index.handles.get(m[1].toLowerCase())
    if (row && !dead(row)) return { row, tier: "handle" }
  }

  // TIER 4 — curated names, matched on their own.
  let best: { at: number; row: XMatchRow } | null = null
  for (const { re, row } of index.aliases) {
    if (dead(row)) continue
    const m = re.exec(text)
    if (m && (best === null || m.index < best.at)) best = { at: m.index, row }
  }
  if (best) return { row: best.row, tier: "name" }

  // TIER 5 — ordinary words, but only inside a sentence about a TRADE.
  // "I'm packing my backpack" is luggage; "holding backpack, bullish" is a
  // position. The frame is the whole permission.
  //
  // ── THE ACCOUNT IS ALSO A FRAME ─────────────────────────────────────────
  // Caught in the field: @ORE_bull posted a thread headed "ORE Liquidity"
  // and got nothing, because the frame had to be a WORD IN THE TEXT and the
  // most obvious evidence on the screen was being thrown away — the account
  // it came from. An author whose handle names an asset is telling you what
  // their timeline is about, more reliably than any single sentence does.
  //
  // It vouches NARROWLY, and that is what makes it safe: @ORE_bull unlocks
  // ORE alone, never GRASS or CIRCLE. A frame word unlocks the whole list,
  // an author unlocks only their own name. And the word must still appear
  // in the text, so the account is permission to read a tweet, never a
  // reason to put a chip under one that says nothing.
  const vouched = new Set(author ? handleSegments(author) : [])
  const framed = isFramed(text, cashtags)
  if (!framed && vouched.size === 0) return null
  let ctx: { at: number; row: XMatchRow } | null = null
  for (const { alias, re, row } of index.context) {
    if (dead(row)) continue
    if (!framed && !vouched.has(alias)) continue
    const m = re.exec(text)
    if (m && (ctx === null || m.index < ctx.at)) ctx = { at: m.index, row }
  }
  return ctx ? { row: ctx.row, tier: "context" } : null
}

/** Test seam: the index caches for the page's lifetime; specs reset it. */
export function resetXMatchIndex(): void {
  index = null
}
