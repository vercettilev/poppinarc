import { beforeEach, describe, expect, it } from "vitest"
import { JUP_TICKERS } from "./tickerMap.generated"
import { matchTweet, resetXMatchIndex, resolveCashtag } from "./xMatch"

/**
 * The tweet matcher, tested against the REAL catalog — a catalog change that
 * breaks an assumption here should break loudly, not rot quietly.
 *
 * Every negative case is a measured hazard, not a hypothetical: the catalog
 * was counted (127 rows) and dozens of its tickers are ordinary words.
 */

beforeEach(() => resetXMatchIndex())

describe("tier 1 — cashtags", () => {
  it("resolves a linkified cashtag to its row", () => {
    const m = matchTweet("wif season", ["$WIF"])
    expect(m?.row.name).toBe("dogwifhat")
    expect(m?.tier).toBe("cashtag")
  })

  it("reaches a wrapped equity by the ticker people actually type", () => {
    // Nobody tweets $TSLAx; the x is the catalog's wrapper naming.
    expect(matchTweet("", ["$TSLA"])?.row.ticker).toBe("TSLAx")
    expect(matchTweet("", ["$NVDA"])?.row.ticker).toBe("NVDAx")
  })

  it("lets an EXACT ticker outrank a derived underlying", () => {
    // META is MetaDAO's real ticker; Meta Platforms' xStock must not steal
    // the cashtag from a row that owns it outright.
    expect(matchTweet("", ["$META"])?.row.name).toBe("MetaDAO")
  })

  it("maps the synonyms wrapped assets are known by", () => {
    expect(matchTweet("", ["$BTC"])?.row.ticker).toBe("WBTC")
    expect(matchTweet("", ["$XRP"])?.row.ticker).toBe("wXRP")
  })

  it("ignores cashtags that are not ours", () => {
    expect(matchTweet("some coin", ["$NOTREAL9"])).toBeNull()
  })
})

describe("tier 2 — dollar text", () => {
  it("catches a $TICKER the client never linkified", () => {
    const m = matchTweet('he said "$WIF to a dollar" and logged off', [])
    expect(m?.row.name).toBe("dogwifhat")
    expect(m?.tier).toBe("dollar")
  })

  it("does not read a price as a ticker", () => {
    // $5 and $100 are amounts; the ticker shape requires a letter first.
    expect(matchTweet("sold it all for $5 total", [])).toBeNull()
  })
})

describe("tier 3 — curated names", () => {
  it("matches the unambiguous crypto-native names", () => {
    expect(matchTweet("dogwifhat is inevitable", [])?.row.ticker).toBe("$WIF")
    expect(matchTweet("solana feels fast today", [])?.row.ticker).toBe("SOL")
  })

  it("matches brand-name equities in running text", () => {
    expect(matchTweet("Tesla earnings tomorrow", [])?.row.ticker).toBe("TSLAx")
    expect(matchTweet("SpaceX just landed another one", [])?.row.ticker).toBe("SPCX")
  })

  it("NEVER matches political names in plain text", () => {
    // The catalog holds TRUMP and MELANIA rows. Plain text must not reach
    // them — half of political X would grow a Buy button.
    expect(matchTweet("Trump said something again", [])).toBeNull()
    expect(matchTweet("Melania was there too", [])).toBeNull()
    // The author's own $ mark is different: that is tier 1/2 intent.
    expect(matchTweet("", ["$TRUMP"])?.row.name).toBe("OFFICIAL TRUMP")
  })

  it("never matches the ordinary-word tickers bare", () => {
    for (const text of [
      "I would never",         // WOULD
      "the grass is wet",      // GRASS, WET
      "cloud cover all day",   // CLOUD
      "sol şeritten devam et", // SOL is a Turkish word
      "goat of the game",      // GOAT
      "nice nest you built",   // NEST
    ]) {
      expect(matchTweet(text, []), text).toBeNull()
    }
  })

  it("respects case where case is the curation", () => {
    expect(matchTweet("an apple a day", [])).toBeNull()
    expect(matchTweet("Apple shipped it", [])?.row.ticker).toBe("AAPLx")
    expect(matchTweet("gathering intel on this", [])).toBeNull()
    expect(matchTweet("Intel is fabbing again", [])?.row.ticker).toBe("INTC")
  })

  it("does not match inside a longer word", () => {
    expect(matchTweet("Teslacoil experiments", [])).toBeNull()
    expect(matchTweet("nonvidia whatever", [])).toBeNull()
  })

  it("handles the punctuation-bearing aliases", () => {
    expect(matchTweet("the S&P 500 closed green", [])?.row.ticker).toBe("SPYx")
    expect(matchTweet("io.net capacity doubled", [])?.row.ticker).toBe("IO")
  })
})

describe("field lessons — each of these shipped wrong once", () => {
  it("an @handle is not a name mention", () => {
    // Live catch: "@solana Summit Serbia" put a $SOL strip under somebody's
    // conference plans. Tagging the account is talking TO it.
    expect(matchTweet("next week i'll be at @solana Summit Serbia", [])).toBeNull()
    // ...but prose alongside a handle still counts.
    expect(matchTweet("solana szn, cc @solana", [])?.row.ticker).toBe("SOL")
  })

  it("Backpack reaches BP — the alias the catalog never got", () => {
    // Live miss, verbatim: a tweet about opening a position on Backpack,
    // closing it at dinner and paying with the Backpack card. BP was in the
    // catalog the whole time; nothing could reach it by name.
    const tweet =
      "I opened a position on @Backpack . I went to a restaurant with a " +
      "friend. During dinner, I closed my position and sent the profit to " +
      "my Backpack credit card. I paid the entire bill."
    expect(matchTweet(tweet, [])?.row.ticker).toBe("BP")
    // @Backpack counts NOW — see the handle tier for why that is a per-account
    // decision and not a reversal of the @solana fix.
    expect(matchTweet("gm @Backpack", [])?.row.ticker).toBe("BP")
    // And the bag stays a bag: lowercase, no handle, no trading context.
    expect(matchTweet("forgot my backpack at the gate", [])).toBeNull()
  })

  it("keeps out the words that only LOOK like the assets they name", () => {
    // Each of these is a catalog row with no alias, on purpose.
    for (const text of [
      "Render the scene again",   // RENDER
      "swarms of people outside", // swarms
      "Alon called me back",      // ALON — an ordinary given name
      "Huma was there too",       // HUMA
    ]) {
      expect(matchTweet(text, []), text).toBeNull()
    }
  })

  it("SPX reaches the S&P row, in capitals only", () => {
    // Live miss: "#SPX Support at 7,630" — a futures habit, pure trading
    // context, zero strip.
    expect(matchTweet("#SPX Support at 7,630", [])?.row.ticker).toBe("SPYx")
    expect(matchTweet("SPX looks heavy", [])?.row.ticker).toBe("SPYx")
    expect(matchTweet("the spx of it all", [])).toBeNull()
  })
})

describe("tier 3 — a project's own account", () => {
  it("an opted-in handle names the project", () => {
    expect(matchTweet("@backpack is very innovative", [])?.row.ticker).toBe("BP")
    expect(matchTweet("gm @Backpack", [])?.tier).toBe("handle")
    // Case does not matter: X handles are case-insensitive.
    expect(matchTweet("shoutout @BACKPACK", [])?.row.ticker).toBe("BP")
  })

  it("AMBIENT handles stay out — the original bug, still fixed", () => {
    // @solana is tagged by every event and every builder. Opting it in would
    // put a chip under conference plans again.
    expect(matchTweet("next week i'll be at @solana Summit Serbia", [])).toBeNull()
    expect(matchTweet("built on @solana", [])).toBeNull()
  })

  it("a handle nobody opted in is just text", () => {
    expect(matchTweet("thanks @randomperson", [])).toBeNull()
  })
})

describe("tier 5 — ordinary words inside a sentence about a trade", () => {
  it("the reported pair, both directions", () => {
    // Lev's own examples, verbatim in spirit.
    expect(matchTweet("I'm packing my backpack", [])).toBeNull()
    const m = matchTweet("I'm holding backpack and I'm bullish because...", [])
    expect(m?.row.ticker).toBe("BP")
    expect(m?.tier).toBe("context")
  })

  it("needs BOTH the word and the trading frame", () => {
    expect(matchTweet("the grass is wet today", [])).toBeNull()
    expect(matchTweet("grass at ath", [])?.row.ticker).toBe("GRASS")

    expect(matchTweet("render the scene again", [])).toBeNull()
    expect(matchTweet("bullish on render", [])?.row.ticker).toBe("RENDER")
  })

  /**
   * THE DELIBERATE COST. "bought grass at the bottom" is a trade and "bought
   * a new backpack" is shopping, and they are the same sentence — verb, then
   * the noun. No word list separates them, so the frame no longer accepts
   * bare buy/sell/hold verbs at all, and BOTH go unmatched.
   *
   * That is the trade this file already says it wants to make: a miss is
   * quiet, and a Buy button under someone's shopping is not. The real trade
   * stays reachable three other ways — the author's $, a market word, or the
   * account it came from.
   */
  it("gives up the sentences that shopping also writes", () => {
    expect(matchTweet("bought grass at the bottom", [])).toBeNull()
    expect(matchTweet("bought a new backpack for the trip", [])).toBeNull()

    expect(matchTweet("bought grass at the bottom", ["$GRASS"])?.row.ticker).toBe("GRASS")
    expect(matchTweet("bought grass at the bottom, huge liquidity", [])?.row.ticker).toBe("GRASS")
    expect(matchTweet("bought grass at the bottom", [], undefined, "grass_daily")?.row.ticker).toBe(
      "GRASS",
    )
  })

  /**
   * ── THE PROBE THAT REBUILT THIS TIER ──────────────────────────────────────
   * Every sentence below produced a Buy button before the frame was split
   * into market-only words and trading constructions. Fourteen of the
   * twenty-one shipped aliases fired on ordinary English, and every single
   * failure traced to one of five words that had been sitting in the list
   * since the beginning: long, short, hold, position, chart.
   *
   * This is the test that holds the line. It is not a list of edge cases; it
   * is what the tier looked like in production.
   */
  it("reads none of ordinary English as a position", () => {
    for (const tweet of [
      "bought a new backpack for the trip",
      "packing my bags and my backpack",
      "the grass is long and needs cutting",
      "cut the grass short before it rains",
      "hold the backpack for me a second",
      "orca whales hold their breath a long time",
      "render times are long on this machine",
      "helium is short in supply at the party store",
      "the seeker of truth holds no position",
      "pumping iron at the gym with my backpack on",
      "pump the brakes, the circle is not finished",
      "over the moon about the grass finally coming in",
      "doodles all over my chart notebook",
      "the flow chart for render is done",
      "no entry through the wormhole exhibit today",
      "his conviction was overturned, a circle of lawyers cheered",
      "dump truck blocked the drift track",
      "season ticket holders get grass level seats",
      "my design portfolio is mostly doodles",
      "snow accumulating on the grass overnight",
      "sold my old backpack at the car boot sale",
      "selling raffle tickets, useless turnout",
      "he is such a troll, bought himself a crown",
      "jupiter is the largest planet, a short read",
      "the drift of the conversation was long and useless",
    ]) {
      expect(matchTweet(tweet, []), tweet).toBeNull()
    }
  })

  it("still reads the sentences that are actually about assets", () => {
    const cases: Array<[string, string]> = [
      ["ORE Liquidity\n\nhow liquidity should be solved", "ORE"],
      ["grass tvl just crossed a new high", "GRASS"],
      ["the drift airdrop is live", "DRIFT"],
      ["jito staking keeps growing", "JTO"],
      ["bullish on backpack", "BP"],
      ["orca floor price is holding", "ORCA"],
      ["going long circle here", "CRCLx"],
      ["im long grass", "GRASS"],
      ["shorting jupiter into the event", "JUP"],
      ["opened a position in helium", "HNT"],
    ]
    for (const [tweet, ticker] of cases) {
      expect(matchTweet(tweet, [])?.row.ticker, tweet).toBe(ticker)
    }
  })

  /**
   * A $ anywhere is a declaration that the tweet is about markets, even when
   * the ticker typed is not the asset the sentence is about. Nobody writes a
   * $ while shopping.
   */
  it("takes any cashtag in the tweet as a frame", () => {
    const t = "quiet week, grass is where the volume went"
    expect(matchTweet(t, [])).toBeNull()
    expect(matchTweet(t, ["$NOTATHING"])?.row.ticker).toBe("GRASS")
  })

  it("context does NOT unlock the political names", () => {
    // The one place a trading word must not be enough: these are sentences
    // about people far more often than about coins.
    expect(matchTweet("bullish on Trump this cycle", [])).toBeNull()
    expect(matchTweet("holding Melania bags", [])).toBeNull()
    // The author's own $ mark still works, and still means the asset.
    expect(matchTweet("", ["$TRUMP"])?.row.name).toBe("OFFICIAL TRUMP")
  })

  it("sentiment alone is not trading context", () => {
    // "love", "great", "amazing" describe everything on X.
    expect(matchTweet("I love a good backpack", [])).toBeNull()
    expect(matchTweet("orca show was amazing", [])).toBeNull()
  })

  it("Turkish 'sol' survives every tier", () => {
    expect(matchTweet("sol şeritten devam et", [])).toBeNull()
    expect(matchTweet("soldan devam, sonra sağa", [])).toBeNull()
  })
})

describe("bare tickers — the form people actually type", () => {
  /**
   * Caught in the field: "BTC looked dead just a few days ago. Now it's above
   * $75K and billions of shorts have been liquidated." matched nothing. `$BTC`
   * resolved, "Bitcoin" resolved, and the most common form of all did not.
   *
   * The context tier could not have saved it either — that tweet carries no
   * CONTEXT WORD ("shorts" is not "short" under a word boundary).
   */
  it("reads a bare BTC as Bitcoin", () => {
    const m = matchTweet("BTC looked dead just a few days ago. Now it's above $75K", [])
    expect(m?.tier).toBe("name")
    expect(m?.row.ticker).toBe("WBTC")
  })

  it("reads a bare ETH as Ethereum", () => {
    expect(matchTweet("ETH finally moving", [])?.row.ticker).toBe("ETH")
  })

  /**
   * The bar stays high. These letters are words before they are assets, and
   * they still reach one only through the author's own `$`.
   */
  it("leaves the ambiguous ones alone", () => {
    expect(matchTweet("sol yolda ilerledim", [])).toBeNull()
    expect(matchTweet("ADA replied to my post", [])).toBeNull()
  })
})

describe("the frame vocabulary stays out of ordinary sentences", () => {
  /**
   * Markets have nouns, not just verbs — "liquidity", "TVL", "airdrop",
   * "staking" — and a frame list made only of verbs missed most of a thread
   * that was plainly about an asset. But every word added here widens what
   * an ordinary noun can trigger, so the list was probed against ordinary
   * English before it shipped rather than reasoned about.
   *
   * That probe paid immediately. Two candidates were cut by it:
   *   "lp"       a vinyl record — "my favourite LP is a perfect circle"
   *              put a Buy button on Circle.
   *   "on chain" spaced — "the render depends on chain reactions" put one
   *              on Render. Only the crypto spellings survive: onchain,
   *              on-chain.
   */
  it("reads none of these as a position", () => {
    for (const tweet of [
      "the render depends on chain reactions in the engine",
      "my favourite LP is a perfect circle of vinyl",
      "the grass needs water, the sprinkler is on",
      "shareholders approved the treasury report",
      "drift racing was incredible this weekend",
      "we saw an orca off the coast",
      "jupiter is the largest planet",
      "the circle of life continues",
      "helium balloons for the party",
      "he is such a troll online",
      "wet floor, be careful",
      "nice backpack, where did you get it",
    ]) {
      expect(matchTweet(tweet, []), tweet).toBeNull()
    }
  })

  it("still reads the market nouns that made this necessary", () => {
    expect(matchTweet("grass tvl just crossed a new high", [])?.row.ticker).toBe("GRASS")
    expect(matchTweet("the drift airdrop is live", [])?.row.ticker).toBe("DRIFT")
    expect(matchTweet("jito staking keeps growing", [])?.row.ticker).toBe("JTO")
    expect(matchTweet("onchain volume for orca is up", [])?.row.ticker).toBe("ORCA")
  })
})

describe("the account is a frame too", () => {
  /**
   * The tweet that started this: @ORE_bull, "ORE Liquidity", no cashtag
   * anywhere in the thread. Before the account was read, the ONLY thing
   * standing between this reader and a Buy button was whether one specific
   * noun happened to be in a list of frame words.
   */
  it("reads an author whose handle names the asset", () => {
    const bare = "ORE is the most interesting thing being built right now"
    expect(matchTweet(bare, [])).toBeNull()
    const m = matchTweet(bare, [], undefined, "ORE_bull")
    expect(m?.tier).toBe("context")
    expect(m?.row.ticker).toBe("ORE")
  })

  it("splits camel case as well as separators", () => {
    const t = "grass nodes are live"
    expect(matchTweet(t, [], undefined, "GrassFoundation")?.row.ticker).toBe("GRASS")
    expect(matchTweet(t, [], undefined, "grass_daily")?.row.ticker).toBe("GRASS")
  })

  /**
   * The safety property. A handle only ever vouches for WHOLE segments of
   * itself, so letters buried inside a longer word reach nothing, and an
   * author vouches for their own asset and no one else's.
   */
  it("never lets a handle vouch for letters inside a word", () => {
    const t = "ore is everywhere"
    for (const h of ["moreno", "storefront", "explorer", "sophomore"]) {
      expect(matchTweet(t, [], undefined, h), h).toBeNull()
    }
  })

  it("vouches for its own asset only", () => {
    // the handle says ORE, so it cannot unlock a different context alias
    expect(matchTweet("grass is growing", [], undefined, "ORE_bull")).toBeNull()
  })

  it("is permission to read a tweet, not a reason to chip an empty one", () => {
    expect(matchTweet("good morning everyone", [], undefined, "ORE_bull")).toBeNull()
  })
})

describe("XRP — three capitals that mean one thing", () => {
  it("reads the bare ticker the way people type it", () => {
    const m = matchTweet("XRP is finally waking up", [])
    expect(m?.tier).toBe("name")
    expect(m?.row.ticker).toBe("wXRP")
  })

  it("stays case-strict like every other bare ticker", () => {
    expect(matchTweet("xrp", [])).toBeNull()
  })
})

describe("ORE — an ordinary word that is also an asset", () => {
  /**
   * Caught in the field: a tweet headed "ORE Liquidity", by @ORE_bull, about
   * ORE's treasury and whether ORE should become DeFi — and nothing matched.
   * "ORE" was in no table at all: not a cashtag, and correctly absent from
   * NAME_ALIASES, because ore is a word in English before it is a token
   * (iron ore) and the name tier does not take words.
   *
   * The context tier is exactly the tool for that: ordinary noun + a word
   * that turns it into a position. The missing half was the frame word —
   * "liquidity" is unambiguously a market term and was not in the list.
   */
  it("reads ORE inside a sentence about liquidity", () => {
    const m = matchTweet(
      "ORE Liquidity\n\nThere's currently an ongoing discussion about how liquidity should be solved going forward.",
      [],
    )
    expect(m?.tier).toBe("context")
    expect(m?.row.ticker).toBe("ORE")
  })

  it("leaves the mineral alone when nothing frames it as a trade", () => {
    expect(matchTweet("iron ore prices surge on shipping delays", [])).toBeNull()
    expect(matchTweet("they found ore in the riverbed", [])).toBeNull()
  })

  /**
   * ORE is the most substring-dangerous alias in either table: "ore" hides
   * inside more, before, therefore, store, core, ignore — and "buying more"
   * is one of the most common sentences on finance X. If this alias were ever
   * matched loosely, a Buy button would appear under a large share of the
   * timeline pointing at an asset nobody mentioned. These cases all carry a
   * real CONTEXT WORD, so the ONLY thing standing between them and a wrong
   * chip is the word boundary.
   */
  it("never reads ore out of the middle of another word", () => {
    for (const tweet of [
      "buying more of this",
      "I'm bullish, therefore I'm holding",
      "accumulating more before the run",
      "my conviction is stronger than before",
      "bought more at the store",
      "the core position is intact",
      "ignore the chart, I'm long",
    ]) {
      expect(matchTweet(tweet, []), tweet).toBeNull()
    }
  })

  /**
   * Read off @ORE_bull's live timeline, full text as X puts it in the DOM.
   * Three are about the asset and one only shares the frame word, which is
   * the distinction the context tier has to get right.
   */
  it("agrees with the author's real timeline", () => {
    expect(
      matchTweet(
        "Current ORE Motherlode nearing $50k\n\nCurrently liquidity SOL/USDC ~$500k",
        [],
      )?.row.ticker,
    ).toBe("ORE")
    expect(
      matchTweet(
        "Still feel like liquidity is the least of the issues in front of ORE.",
        [],
      )?.row.ticker,
    ).toBe("ORE")
    // same author, same thread, but this one never names the asset
    expect(
      matchTweet(
        "There are a lot but having a serious liquidity buffer is a big one.",
        [],
      ),
    ).toBeNull()
  })

  it("still answers the author's own $ mark first", () => {
    const m = matchTweet("the $ORE discourse is back", ["$ORE"])
    expect(m?.tier).toBe("cashtag")
  })
})

describe("the widened universe — Jupiter's verified tickers", () => {
  it("reaches assets the curated catalog never held", () => {
    // The point of the widening: someone tweeting a verified ticker gets an
    // answer whether or not a human reviewed that row.
    const m = matchTweet("", ["$PENGU"])
    expect(m?.tier).toBe("cashtag")
    expect(m?.row.mint).toBeTruthy()
  })

  it("the CATALOG still wins every ticker it owns", () => {
    // A feed does not get to overrule human review. MetaDAO keeps $META,
    // and the wrapped equities keep the underlying tickers people type.
    expect(matchTweet("", ["$META"])?.row.name).toBe("MetaDAO")
    expect(matchTweet("", ["$WIF"])?.row.name).toBe("dogwifhat")
    expect(matchTweet("", ["$TSLA"])?.row.ticker).toBe("TSLAx")
  })

  it("does NOT widen the name tier", () => {
    // A cashtag is a claim about a ticker; a word is a word. Jupiter rows
    // are reachable by $TICKER only — never by prose.
    const viaCashtag = matchTweet("", ["$PENGU"])
    expect(viaCashtag).not.toBeNull()
    const viaProse = matchTweet("pengu is everywhere", [])
    expect(viaProse?.row.mint).not.toBe(viaCashtag!.row.mint)
  })

  it("every generated row carries what a trade needs", () => {
    // A row that cannot name or size an asset must not be offered at all.
    for (const [ticker, r] of JUP_TICKERS) {
      expect(ticker, "ticker shape").toMatch(/^[A-Z0-9.]{2,10}$/)
      expect(r.mint.length, `${ticker} mint`).toBeGreaterThan(31)
      expect(r.name.length, `${ticker} name`).toBeGreaterThan(0)
      expect(Number.isInteger(r.decimals), `${ticker} decimals`).toBe(true)
    }
  })

  it("never lets two tickers claim one meaning", () => {
    const seen = new Set<string>()
    for (const [ticker] of JUP_TICKERS) {
      expect(seen.has(ticker), `${ticker} duplicated`).toBe(false)
      seen.add(ticker)
    }
  })
})

describe("one answer per tweet", () => {
  it("first cashtag wins over everything", () => {
    const m = matchTweet("Tesla vs the rest. $WIF $BONK", ["$WIF", "$BONK"])
    expect(m?.row.name).toBe("dogwifhat")
    expect(m?.tier).toBe("cashtag")
  })

  it("earliest name wins within the name tier", () => {
    expect(matchTweet("SpaceX and Tesla both fly", [])?.row.ticker).toBe("SPCX")
  })
})

describe("the remote blocklist", () => {
  it("a disabled mint stops matching at every tier", () => {
    const wif = resolveCashtag("$WIF")!
    const dead = new Set([wif.mint])
    expect(matchTweet("dogwifhat", [], dead)).toBeNull()
    expect(matchTweet("", ["$WIF"], dead)).toBeNull()
    // and the tweet falls through to its next-best answer
    expect(matchTweet("dogwifhat vs Tesla", [], dead)?.row.ticker).toBe("TSLAx")
  })
})

/**
 * THE MISSES FROM ONE SCROLL OF A REAL FEED (2026-08-24), each pinned with
 * the exact sentence that failed. Two upgrades came out of them: a written
 * dollar figure frames a tweet, and SOL — refused by the bare-ticker list
 * because it is a word in two languages — is admitted when BOTH gates hold:
 * exact uppercase and an already-framed tweet.
 */
describe("framed bare SOL, and the dollar-figure frame", () => {
  it("matches the price-target tweet that started this", () => {
    // No cashtag, no context word — the $500 IS the frame.
    const m = matchTweet(
      "Please show this to everyone who believes SOL will hit $500.",
      [],
    )
    expect(m?.row.ticker).toBe("SOL")
    expect(m?.tier).toBe("context")
  })

  it("still refuses lowercase sol, framed or not", () => {
    expect(matchTweet("sol tarafta $500 yazıyor", [])).toBeNull()
    expect(matchTweet("el sol brilla for $9.99", [])).toBeNull()
  })

  it("still refuses uppercase SOL with no frame at all", () => {
    expect(matchTweet("SOL yesterday was wild", [])).toBeNull()
  })

  it("keeps the quoted-tweet case working through joined text", () => {
    // The extractor now joins main + quoted text; the matcher sees one
    // string. BTC lives in the quote, the frame lives in both halves.
    const joined =
      "The weekly chart now also looks very similar to the 2023 bull run's starting breakout.\n" +
      "I think BTC is behaving very similarly to the early 2023 bull run."
    expect(matchTweet(joined, [])?.row.ticker).toBe("WBTC")
  })
})

describe("gold, the way people write it", () => {
  it("answers $XAUUSD — the field screenshot — with Tether Gold", () => {
    expect(matchTweet("Oh boy", ["$XAUUSD"])?.row.ticker).toBe("XAUt0")
  })

  it("answers the shorter spellings too", () => {
    expect(matchTweet("", ["$XAU"])?.row.ticker).toBe("XAUt0")
    expect(matchTweet("", ["$GOLD"])?.row.ticker).toBe("XAUt0")
    expect(matchTweet("", ["$XAUT"])?.row.ticker).toBe("XAUt0")
  })

  it("reads bare XAU in a framed tweet, and only there", () => {
    expect(matchTweet("XAU breaking out above $4,600", [])?.row.ticker).toBe("XAUt0")
    expect(matchTweet("XAU is interesting lately", [])).toBeNull()
  })

  it("never answers $PAXG with somebody else's gold", () => {
    // Paxos's product is not Tether's; a synonym that substitutes issuers
    // is a lie with a ticker on it.
    expect(matchTweet("", ["$PAXG"])).toBeNull()
  })
})

/**
 * Reported live, verbatim: @wenwencoin announcing its own airdrop, and the
 * chip offered $SOL. The tweet says "Solana" once, as the CHAIN it happened
 * on; the subject is the account's own token, which was in nobody's list.
 */
describe("the account is the asset", () => {
  const tweet =
    "Wen is still to this day, the fairest large-scale airdrop ever on " +
    "Solana 🪂\n\nNo insiders, no paid KOLs, nothing.\n\n1 Million+ wallets " +
    "all received the exact same allocation.\n\nWen is for the people 🐱"

  it("offers the author's own token, not the chain it runs on", () => {
    const m = matchTweet(tweet, [], undefined, "wenwencoin")
    expect(m?.row.ticker).toBe("WEN")
    expect(m?.tier).toBe("handle")
  })

  it("still reads Solana as the subject when nobody's account claims it", () => {
    // The other live tweet, kept: "Gold on Solana / Silver on Solana / … /
    // The everything chain" IS about the chain, and $SOL is the right chip.
    const chainTweet =
      "Gold on Solana\nSilver on Solana\nBitcoin on Solana\nThe everything chain"
    expect(matchTweet(chainTweet, [], undefined, "tukytuky_")?.row.ticker).toBe("SOL")
  })

  it("reads @ORE's own pun, which no other tier can", () => {
    // Live: "HighORE for longORE." — no cashtag, no bare word, no @mention.
    // The account is the only evidence in the tweet, and it is enough.
    expect(matchTweet("HighORE for longORE.", [], undefined, "ORE")?.row.ticker).toBe("ORE")
    // A fan account is not the project: whole handles only, no segmenting
    // on the author path.
    expect(matchTweet("HighORE for longORE.", [], undefined, "ORE_bull")).toBeNull()
  })

  it("a person's coin never claims their own tweets", () => {
    // Live, twice in one evening: @blknoiz06 on Solana wore an ANSEM chip,
    // then @blknoiz06 on pump wore ANSEM again. The person tweets about
    // the whole market; authorship claims nothing for a creator coin.
    const m = matchTweet(
      "solana has not looked this good since october of 2023.",
      [],
      undefined,
      "blknoiz06",
    )
    expect(m?.row.ticker).toBe("SOL")
    expect(m?.tier).toBe("name")
    // And where the text names nothing we can safely resolve, the honest
    // answer is silence, not the author's coin. ("pump" is a verb here and
    // the most dangerous bare word in crypto; it stays out of every list.)
    expect(
      matchTweet("pump is so hilariously strong", [], undefined, "blknoiz06"),
    ).toBeNull()
  })

  it("a tweet ABOUT the person still reaches their coin", () => {
    // The text-mention tier is untouched: @blknoiz06 in someone else's
    // tweet is genuinely about Ansem.
    const m = matchTweet("@blknoiz06 was right again", [], undefined, "someoneelse")
    expect(m?.row.ticker).toBe("ANSEM")
    expect(m?.tier).toBe("handle")
  })

  it("resolves $WEN to the real mint, not one of its five impostors", () => {
    // Jupiter answers five tokens to "WEN" — a Wendy's Co and three Wen
    // Lambos among them. The catalog carries the one with the airdrop.
    expect(resolveCashtag("$WEN")?.mint).toBe(
      "WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk",
    )
  })
})

// Measured in the field: SolanaFloor posted "🚨JUST IN: @Pumpfun is replacing
// Cashback Mode with Holder Rewards." and got no chip, even though PUMP is a
// tradeable catalog row. The name allowlist spelled it with the dot in both
// entries — "Pump.fun", "pump.fun" — and X's account is dotless. The account
// that IS the asset was the most obvious evidence on the screen and the
// matcher could not read it.
describe("the pump.fun account", () => {
  it("is read from its @mention, however it is capitalised", () => {
    resetXMatchIndex()
    for (const mention of ["@Pumpfun", "@pumpfun", "@PumpFun"]) {
      const m = matchTweet(`JUST IN: ${mention} is replacing Cashback Mode`, [], undefined, "solanafloor")
      expect(m?.row.ticker, mention).toBe("PUMP")
      expect(m?.tier, mention).toBe("handle")
    }
  })

  it("is read when it posts about itself", () => {
    resetXMatchIndex()
    expect(matchTweet("Holder Rewards are live", [], undefined, "pumpfun")?.row.ticker).toBe("PUMP")
  })

  it("is still read spelled out, dot or no dot", () => {
    resetXMatchIndex()
    expect(matchTweet("Pump.fun ships Holder Rewards", [], undefined, "someone")?.row.ticker).toBe("PUMP")
    expect(matchTweet("Pumpfun ships Holder Rewards", [], undefined, "someone")?.row.ticker).toBe("PUMP")
  })
})

// The catalog carries eighteen tokenized equities and the handle list named
// seven of them, so @Apple posting about Apple produced nothing while @tesla
// produced TSLAx. An account that IS a listed company is the same evidence
// in both cases. The rest are wired now.
describe("the listed companies", () => {
  it("are read from their own account", () => {
    resetXMatchIndex()
    const expected: ReadonlyArray<readonly [string, string]> = [
      ["apple", "AAPLx"],
      ["microsoft", "MSFTx"],
      ["google", "GOOGLx"],
      ["amazon", "AMZNx"],
      ["meta", "METAx"],
      ["broadcom", "AVGOx"],
      ["mcdonalds", "MCDx"],
      ["strategy", "MSTRx"],
    ]
    for (const [handle, ticker] of expected) {
      const m = matchTweet("big news today", [], undefined, handle)
      expect(m?.row.ticker, `@${handle}`).toBe(ticker)
      expect(m?.tier, `@${handle}`).toBe("handle")
    }
  })

  it("are read from the cashtag people actually type, without the x", () => {
    resetXMatchIndex()
    for (const [tag, ticker] of [["$NVDA", "NVDAx"], ["$TSLA", "TSLAx"], ["$SPY", "SPYx"]] as const) {
      expect(resolveCashtag(tag)?.ticker, tag).toBe(ticker)
    }
  })
})

// Field case: r/stockstobuytoday, "Is NVDA a good buy right now or do you
// see it dropping even more soon?" — no chip. The cashtag tier answers
// $NVDA and the name tier answers "Nvidia", and a room full of people
// discussing stocks writes neither. It writes the bare symbol in capitals,
// inside plain English that none of the crypto frames could see.
describe("the way a stock is actually discussed", () => {
  const read = (text: string) => matchTweet(text, [], undefined, "someone")

  it("reads the bare symbol once the sentence is about a trade", () => {
    resetXMatchIndex()
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["Is NVDA a good buy right now or do you see it dropping even more soon?", "NVDAx"],
      ["should I buy TSLA here", "TSLAx"],
      ["AAPL earnings call tomorrow", "AAPLx"],
      ["what is your price target for PLTR", "PLTRx"],
      ["MSFT at a 52 week high", "MSFTx"],
    ]
    for (const [text, ticker] of cases) {
      const m = read(text)
      expect(m?.row.ticker, text).toBe(ticker)
      expect(m?.tier, text).toBe("context")
    }
  })

  it("stays shut when the capitals are not inside a trade", () => {
    resetXMatchIndex()
    for (const text of [
      "NVDA announced a new chip today",
      "going to buy a coffee and read about META later",
      "GME is the airport code I always mix up",
    ]) {
      expect(read(text), text).toBeNull()
    }
  })

  // "which COIN should I buy" is a sentence this lane accepts and Coinbase
  // is not what it means. The word is too common in the rooms where a trade
  // frame is always present, so the bare form is deliberately absent.
  it("never reads COIN as Coinbase without a cashtag", () => {
    resetXMatchIndex()
    expect(read("which COIN should I buy")).toBeNull()
    expect(read("COIN is up today")).toBeNull()
    expect(resolveCashtag("$COIN")?.ticker).toBe("COINx")
  })
})
