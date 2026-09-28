import { describe, expect, it } from "vitest"
import { fractionRaw, viewTradeSheet, type Reader, type SheetState } from "./tradeSheetModel"

/**
 * The rulebook three surfaces read. Everything here was learned the expensive
 * way on one of them, and the point of the module is that the other two
 * cannot now disagree with it.
 */

const AT_142: Reader = {
  cashUsd: 432.1,
  uiAmount: 61.4082,
  raw: "61408200",
  entryMcapUsd: 2_900_000,
}
const AT_220: Reader = { ...AT_142, entryMcapUsd: 4_100_000 }
const NO_BASIS: Reader = { ...AT_142, entryMcapUsd: null }
const NOTHING: Reader = { cashUsd: 432.1, uiAmount: 0, raw: "0", entryMcapUsd: null }
const BROKE: Reader = { cashUsd: 9, uiAmount: 0, raw: "0", entryMcapUsd: null }

const state = (o: Partial<SheetState> = {}): SheetState => ({
  side: "buy",
  kind: "limit",
  priceText: "",
  usd: 25,
  pct: 50,
  ...o,
})

const view = (o: {
  marketUsd?: number | null
  reader?: Reader | null
  state?: Partial<SheetState>
}) =>
  viewTradeSheet({
    ticker: "WIF",
    marketUsd: o.marketUsd === undefined ? 178.34 : o.marketUsd,
    reader: o.reader === undefined ? AT_142 : o.reader,
    state: state(o.state),
  })

/**
 * The percentage quick-picks are gone. They filled the price field on one
 * tap — -5/-10/-20 to buy, +10/+25/+50 to sell — and they were mine, not the
 * product's. A limit order asks one question, at what price, and answering it
 * with a percentage of something else makes the reader translate twice.
 *
 * The arithmetic they were built on did not go anywhere: it is the READING
 * now, pointed the other way. Type a price and the sheet says what it means,
 * measured from the entry on a sell and the tape on a buy.
 */
describe("the sheet offers no percentages to tap", () => {
  it("has no offsets to render", () => {
    expect("offsets" in view({})).toBe(false)
    expect("offsets" in view({ state: { side: "sell" } })).toBe(false)
  })

  it("still asks for the price, plainly, on each side", () => {
    expect(view({}).priceLabel).toBe("Buy $WIF when it drops to")
    expect(view({ state: { side: "sell" } }).priceLabel).toBe("Sell $WIF at")
  })
})

describe("what a typed price MEANS is not whether it is allowed", () => {
  /**
   * THE SELL USED TO BE READ AGAINST "THE ENTRY", and the entry was
   * netInvestedUsd / uiAmount — net cash out over units still held. That is
   * a cost basis only for a position never sold; it drifts on the first
   * partial sell and goes negative after a profitable round trip. So the
   * one number a reader used to place a take-profit was anchored on a
   * figure the product could not compute.
   *
   * Both sides are read against the TAPE now: "how far is my trigger from
   * the price right now" is provable, and it is the question a limit order
   * is actually placed against. The profit reading returns when the ledger
   * can answer it honestly.
   */
  it("reads a sell price as distance from the tape", () => {
    // $160 against the $178.34 tape
    const v = view({ state: { side: "sell", priceText: "160" } })
    expect(v.reading).toMatchObject({ text: "-10.3% vs now", tone: "bad", word: "vs now" })
    // ...and it is still not a valid trigger, which the note says separately
    expect(v.action.armed).toBe(false)
    expect(v.note).toBe("Already above that — use Sell")
    expect(v.intent).toBeNull()
  })

  it("reads a sell above the tape as the direction the reader wants", () => {
    const v = view({ state: { side: "sell", priceText: "200" } })
    expect(v.reading).toMatchObject({ text: "+12.1% vs now", tone: "good", word: "vs now" })
    expect(v.action.armed).toBe(true)
    expect(v.note).toBeNull()
  })

  it("reads a buy against the tape, where below is the good direction", () => {
    expect(view({ state: { priceText: "160.51" } }).reading).toMatchObject({
      text: "-10.0% vs now",
      tone: "good",
    })
    expect(view({ state: { priceText: "200" } }).reading?.tone).toBe("bad")
  })

  it("says the anchor is missing rather than inventing one", () => {
    // One anchor for both sides now, so one way to be missing it.
    expect(view({ marketUsd: null, state: { priceText: "160" } }).reading)
      .toMatchObject({ text: "no live price", tone: "muted" })
    expect(view({ marketUsd: null, state: { side: "sell", priceText: "200" } }).reading)
      .toMatchObject({ text: "no live price", tone: "muted" })
  })

  it("treats an empty field as a starting state, not a fault", () => {
    const v = view({})
    // an empty field names its anchor rather than instructing
    expect(v.reading).toMatchObject({ text: "vs now", tone: "muted" })
    expect(v.note).toBeNull()
    expect(v.action.armed).toBe(false)
  })
})

describe("what the button will actually do", () => {
  it("names the market trade it is about to make", () => {
    expect(view({ state: { kind: "market" } }).action).toEqual({
      label: "Buy $25",
      tone: "buy",
      armed: true,
    })
    expect(view({ state: { kind: "market", side: "sell" } }).action).toEqual({
      label: "Sell $25",
      tone: "sell",
      armed: true,
    })
  })

  it("carries the exact intent, sized in raw units on a sell", () => {
    expect(view({ state: { kind: "market", side: "sell", pct: 50 } }).intent).toEqual({
      kind: "market-sell",
      pct: 50,
      amountRaw: "30704100",
    })
    expect(view({ state: { side: "sell", priceText: "200", pct: 25 } }).intent).toEqual({
      kind: "limit-sell",
      pct: 25,
      amountRaw: "15352050",
      triggerPriceUsd: 200,
    })
    expect(view({ state: { priceText: "160" } }).intent).toEqual({
      kind: "limit-buy",
      usd: 25,
      triggerPriceUsd: 160,
    })
  })

  /**
   * A trigger order escrows its funds when it is CREATED, so a buy above the
   * balance is a round trip to a refusal. The button stops pretending and
   * becomes the door that fixes it.
   */
  it("becomes the funding door when the cash cannot cover the size", () => {
    const v = view({ reader: BROKE, state: { kind: "market", usd: 25 } })
    expect(v.action.tone).toBe("fund")
    expect(v.action.armed).toBe(true)
    // The label names the gap as well as the currency; see the model.
    expect(v.action.label).toMatch(/^Deposit \$[\d.,]+ USDC$/)
    expect(v.intent).toBeNull()
    expect(v.balance).toEqual({ text: "USDC balance $9.00", low: true })
  })

  /**
   * MONEY IN AN ORDER IS NOT MONEY LOST.
   *
   * A standing buy escrows its USDC the moment it is placed, so this line
   * correctly drops by that much — and a reader who had parked $300
   * against a $321 wallet read the drop as their money going missing
   * ("bakiyemin 321 olması lazım 21 yerine": 21.37 spendable plus a $300
   * order, to the cent). The number was right and the screen was silent,
   * which is the worse half of that pair.
   */
  it("says what is parked in orders beside what is spendable", () => {
    const v = view({
      reader: BROKE,
      state: { kind: "market", usd: 25, committedUsd: 300 },
    })
    expect(v.balance?.text).toBe("USDC balance $9.00 · $300.00 in orders")
  })

  it("says nothing about orders when there are none", () => {
    // Absent and zero both stay quiet: a "$0.00 in orders" footnote is
    // noise on every sheet a reader will ever open.
    expect(
      view({ reader: BROKE, state: { kind: "market", usd: 25 } }).balance?.text,
    ).toBe("USDC balance $9.00")
    expect(
      view({
        reader: BROKE,
        state: { kind: "market", usd: 25, committedUsd: 0 },
      }).balance?.text,
    ).toBe("USDC balance $9.00")
  })

  it("offers no sell at all with nothing held", () => {
    const v = view({ reader: NOTHING, state: { side: "sell", kind: "market" } })
    expect(v.action).toEqual({ label: "Nothing to sell", tone: "wait", armed: false })
    expect(v.intent).toBeNull()
  })

  /**
   * An unread balance must never refuse an order the server would accept.
   */
  it("stays out of the way while the reader is unknown", () => {
    const v = view({ reader: null, state: { kind: "market", usd: 100 } })
    expect(v.action.armed).toBe(true)
    expect(v.balance).toBeNull()
  })
})

/**
 * An emptied amount field is 0 in the state. A zero buy is never short of
 * cash, so it used to arm as "Buy $0" and go to the server to be refused:
 * a new reader's first two presses, 2026-09-26.
 */
describe("a trade of nothing asks for an amount", () => {
  const asks = { label: "Type an amount", tone: "wait", armed: false }

  it("a market buy of $0 is not armed", () => {
    for (const reader of [AT_142, BROKE, { ...BROKE, cashUsd: 0 }, null]) {
      const v = view({ reader, state: { kind: "market", usd: 0 } })
      expect(v.action).toEqual(asks)
      expect(v.intent).toBeNull()
    }
  })

  it("NaN is nothing too", () => {
    const v = view({ state: { kind: "market", usd: Number.NaN } })
    expect(v.action).toEqual(asks)
    expect(v.intent).toBeNull()
  })

  it("a limit buy with its price typed still needs the amount", () => {
    const v = view({ state: { usd: 0, priceText: "160" } })
    expect(v.action).toEqual(asks)
    expect(v.intent).toBeNull()
  })

  it("a sell of 0% is not armed either", () => {
    const v = view({ state: { kind: "market", side: "sell", usd: 0, pct: 0 } })
    expect(v.action).toEqual(asks)
    expect(v.intent).toBeNull()
  })

  it("nothing held still says so first", () => {
    const v = view({ reader: NOTHING, state: { side: "sell", kind: "market", usd: 0, pct: 0 } })
    expect(v.action.label).toBe("Nothing to sell")
  })

  it("the smallest real amount still arms", () => {
    const v = view({ state: { kind: "market", usd: 0.01 } })
    expect(v.action).toEqual({ label: "Buy $0.01", tone: "buy", armed: true })
    expect(v.intent).toEqual({ kind: "market-buy", usd: 0.01 })
  })
})

describe("a market sell with no tape disarms instead of refusing later", () => {
  const TINY: Reader = { cashUsd: 10, uiAmount: 30, raw: "30000000", entryMcapUsd: null }

  it("holds the button until a price exists", () => {
    const v = view({
      reader: TINY,
      marketUsd: null,
      state: { side: "sell", kind: "market", usd: 25, pct: 0 },
    })
    expect(v.action.armed).toBe(false)
    expect(v.action.label).toBe("Waiting for a price…")
  })

  it("an empty holding still answers with the balance sentence", () => {
    const v = view({
      reader: { ...TINY, uiAmount: 0, raw: "0" },
      marketUsd: null,
      state: { side: "sell", kind: "market", usd: 25, pct: 0 },
    })
    expect(v.action.label).toBe("Nothing to sell")
  })

  it("a market BUY is untouched by the price guard", () => {
    const v = view({
      reader: TINY,
      marketUsd: null,
      state: { side: "buy", kind: "market", usd: 5, pct: 50 },
    })
    expect(v.action.armed).toBe(true)
  })
})

describe("a sell for more than the holding says its own name", () => {
  // A $3 position, priced live: uiAmount * marketUsd = 3.
  const TINY: Reader = { cashUsd: 10, uiAmount: 30, raw: "30000000", entryMcapUsd: null }

  it("the silent clamp is gone: the button says Sell all, with the real figure", () => {
    const v = view({
      reader: TINY,
      marketUsd: 0.1,
      state: { side: "sell", kind: "market", usd: 25, pct: 100 },
    })
    expect(v.action.label).toBe("Sell all ($3)")
    expect(v.action.armed).toBe(true)
    // And the sentence is information, not an error.
    expect(v.note).toBe("That's your whole position")
    expect(v.noteTone).toBe("info")
  })

  it("the worth to the cent is the whole position, and goes out as exactly 100%", () => {
    // Worth is $3.00. The sheet seeds the field to the worth rounded to
    // cents, and a tick up since then leaves the figure a hair under it;
    // both used to send 99.9x% and leave dust.
    const v = view({
      reader: TINY,
      marketUsd: 0.1,
      state: { side: "sell", kind: "market", usd: 2.996, pct: 99.87 },
    })
    expect(v.action.label).toBe("Sell all ($3)")
    expect(v.intent).toEqual({ kind: "market-sell", pct: 100, amountRaw: "30000000" })
  })

  it("a share the sheet has pinned at 100 is the whole position whatever the dollars say", () => {
    const v = view({
      reader: TINY,
      marketUsd: 0.1,
      state: { side: "sell", kind: "market", usd: 2.9, pct: 100 },
    })
    expect(v.action.label).toBe("Sell all ($3)")
    expect(v.note).toBe("That's your whole position")
    expect(v.intent).toEqual({ kind: "market-sell", pct: 100, amountRaw: "30000000" })
  })

  it("a sell inside the holding keeps the typed figure", () => {
    const v = view({
      reader: TINY,
      marketUsd: 0.1,
      state: { side: "sell", kind: "market", usd: 2, pct: 66.7 },
    })
    expect(v.action.label).toBe("Sell $2")
    expect(v.note).toBeNull()
  })

  it("with no live price nothing is claimed about the whole position", () => {
    const v = view({
      reader: TINY,
      marketUsd: null,
      state: { side: "sell", kind: "market", usd: 25, pct: 0 },
    })
    // The label keeps the typed figure; inventing a worth would be worse.
    expect(v.note).toBeNull()
  })

  it("a market BUY above the balance is not this rule's business", () => {
    const v = view({
      reader: TINY,
      marketUsd: 0.1,
      state: { side: "buy", kind: "market", usd: 25, pct: 50 },
    })
    // cannotPay owns that case and answers with the funding door.
    expect(v.action.label).toMatch(/^Deposit .*USDC$/)
  })
})

describe("the market-cap formatter", () => {
  // A cap is quoted at three significant figures and that coarseness is
  // load-bearing: it is what lets this number be honest where a per-unit
  // price cannot be, because it absorbs the gap between a quoted and an
  // executed fill.
  const at = (usd: number) =>
    view({ reader: { ...NOTHING, uiAmount: 1, raw: "1", entryMcapUsd: usd },
           state: { side: "sell" } }).balance?.text ?? ""

  it("speaks in the units traders speak in", () => {
    expect(at(2_900_000)).toContain("$2.9M MC")
    expect(at(340_000)).toContain("$340K MC")
    expect(at(1_200_000_000)).toContain("$1.2B MC")
    expect(at(940)).toContain("$940 MC")
  })

  it("keeps a digit where a digit still means something", () => {
    expect(at(3_040_000)).toContain("$3.04M MC")
    expect(at(41_500_000)).toContain("$41.5M MC")
    expect(at(412_000_000)).toContain("$412M MC")
  })
})

describe("the line about the reader", () => {
  /**
   * THIS TEST USED TO ASSERT A NUMBER THE PRODUCT COULD NOT KNOW.
   *
   * It expected "· entry $142 +25.6%", and it passed by handing the view a
   * hand-written entry price. In production that value was
   * netInvestedUsd / uiAmount — net cash out over units still held — which
   * is a cost basis only for a position never sold, drifts on the first
   * partial sell, and goes negative after a profitable round trip. Every
   * entry test in this file was written the same way: agreeing with the
   * formula rather than exercising it. Not one had a sell in the ledger.
   *
   * The line now says only what the sheet can prove.
   */
  it("says units, what they are worth, and where they got in", () => {
    const v = view({ state: { side: "sell" } })
    expect(v.balance?.text).toBe("You hold 61.4082 · $10,951.54 · in at $2.9M MC")
  })

  it("stays silent about the entry when the ledger never recorded one", () => {
    // Everything bought before the cap was recorded. Nothing is guessed
    // from today's cap — that would be a different number wearing the same
    // sentence.
    const v = view({ reader: NO_BASIS, state: { side: "sell" } })
    expect(v.balance?.text).toBe("You hold 61.4082 · $10,951.54")
  })

  it("leaves out what it cannot know", () => {
    expect(view({ reader: NO_BASIS, state: { side: "sell" } }).balance?.text).toBe(
      "You hold 61.4082 · $10,951.54",
    )
    expect(view({ marketUsd: null, reader: NO_BASIS, state: { side: "sell" } }).balance?.text)
      .toBe("You hold 61.4082")
  })

  it("writes cash with its cents", () => {
    expect(view({ state: { kind: "market" } }).balance).toEqual({
      text: "USDC balance $432.10",
      low: false,
    })
  })
})

describe("a market trade has no price to judge", () => {
  it("hides the whole price leg", () => {
    const v = view({ state: { kind: "market" } })
    expect(v.priceLabel).toBeNull()
    expect(v.reading).toBeNull()
    expect(v.note).toBeNull()
  })

  it("labels the price leg for the side it is on", () => {
    expect(view({}).priceLabel).toBe("Buy $WIF when it drops to")
    expect(view({ state: { side: "sell" } }).priceLabel).toBe("Sell $WIF at")
  })

  it("labels the size for what is being sized", () => {
    expect(view({}).sizeLabel).toBe("Amount")
    expect(view({ state: { side: "sell" } }).sizeLabel).toBe("How much of your position")
    expect(view({}).sizes.map((s) => s.label)).toEqual(["$10", "$25", "$100"])
    expect(view({ state: { side: "sell" } }).sizes.map((s) => s.label)).toEqual([
      "25%",
      "50%",
      "Max",
    ])
  })
})

/**
 * A balance is a u64 string for a reason: 1e-9 of a token is a real amount,
 * and a float would round somebody's exit.
 */
describe("fractionRaw", () => {
  it("cuts without touching a float", () => {
    expect(fractionRaw("61408200", 50)).toBe("30704100")
    expect(fractionRaw("61408200", 25)).toBe("15352050")
    expect(fractionRaw("61408200", 100)).toBe("61408200")
    expect(fractionRaw("18446744073709551615", 100)).toBe("18446744073709551615")
    expect(fractionRaw("18446744073709551614", 50)).toBe("9223372036854775807")
  })

  it("is silent rather than wrong when there is no balance", () => {
    expect(fractionRaw(null, 50)).toBe("0")
    expect(fractionRaw("not a number", 50)).toBe("0")
  })
})

/**
 * THE FUNDING BUTTON'S WORDS. The reader is about to see a wallet's approval
 * window, or about to be sent to the panel — and the button they press is
 * the only warning either way. Getting this backwards is a small string and
 * a large surprise.
 */
describe("what an empty balance offers", () => {
  const broke = {
    ticker: "$WIF",
    marketUsd: 0.2,
    reader: { cashUsd: 0, uiAmount: 0, raw: "0", entryUsd: null },
    state: { side: "buy", kind: "market", usd: 25, pct: 0, priceText: "" },
  } as unknown as Parameters<typeof viewTradeSheet>[0]

  it("says Deposit on both rails, and names the currency only where it is the instruction", () => {
    // ONE VERB. The label used to switch between "Top up" and "Deposit" on
    // whether a wallet was on the page, which is a fact the reader cannot
    // see. What still differs is the trailing "USDC": the address screen
    // asks the reader to CHOOSE what to send, the wallet already knows.
    expect(viewTradeSheet({ ...broke, walletOnPage: true }).action.label).toMatch(
      /^Deposit \$\d/,
    )
    expect(viewTradeSheet({ ...broke, walletOnPage: true }).action.label).not.toMatch(
      /USDC/,
    )
    expect(viewTradeSheet({ ...broke, walletOnPage: false }).action.label).toMatch(
      /^Deposit .*USDC$/,
    )
    // Absent means "this surface cannot say", which reads as the panel door.
    expect(viewTradeSheet(broke).action.label).toMatch(/^Deposit .*USDC$/)
  })

  it("stays a funding door, not a trade, either way", () => {
    for (const walletOnPage of [true, false]) {
      const v = viewTradeSheet({ ...broke, walletOnPage })
      expect(v.action.tone).toBe("fund")
      expect(v.intent).toBeNull()
    }
  })
})

describe("one pocket: USDC is the money", () => {
  /**
   * The SOL pocket lived here — a market buy could draw on the reader's
   * SOL when USDC fell short, with a two-currency balance line and a
   * "pays with SOL" footnote. The owner retired it: every complication
   * from the wrap service to the wSOL fee account traced back to that one
   * branch, and the product's money is USDC ("temel ürün USDC").
   *
   * What these lock now: SOL riches change NOTHING. A short USDC balance
   * gates to the deposit door regardless of what else the wallet holds,
   * and the door names the currency.
   */
  const reader = (cashUsd: number, solUsd: number) => ({
    cashUsd,
    solUsd,
    uiAmount: 0,
    raw: "0",
    entryMcapUsd: null,
  })
  const state = (usd: number) =>
    ({ side: "buy", kind: "market", priceText: "", usd, pct: 0 }) as const

  it("a fat SOL pocket buys nothing: short USDC gates to the deposit door", () => {
    const v = viewTradeSheet({
      ticker: "SOL",
      marketUsd: 96,
      reader: reader(1.6, 500),
      state: state(10),
    })
    expect(v.action.tone).toBe("fund")
    expect(v.action.label).toMatch(/^Deposit .*USDC$/)
    expect(v.intent).toBeNull()
  })

  it("the balance line names the one currency", () => {
    const v = viewTradeSheet({
      ticker: "SOL",
      marketUsd: 96,
      reader: reader(30, 500),
      state: state(25),
    })
    // No second pocket, no footnote — and the intent carries no payWith,
    // because there is no pocket to pick.
    expect(v.balance?.text).toBe("USDC balance $30.00")
    expect(v.intent).toEqual({ kind: "market-buy", usd: 25 })
  })

  it("limit buys gate on USDC the same way", () => {
    const v = viewTradeSheet({
      ticker: "SOL",
      marketUsd: 96,
      reader: reader(1.6, 500),
      state: { side: "buy", kind: "limit", priceText: "90", usd: 10, pct: 0 },
    })
    expect(v.action.tone).toBe("fund")
  })

  it("an unknown reader blocks nothing — the server's pre-flight is the authority", () => {
    const v = viewTradeSheet({
      ticker: "SOL",
      marketUsd: 96,
      reader: null,
      state: state(25),
    })
    expect(v.intent).toEqual({ kind: "market-buy", usd: 25 })
  })
})

// A sheet reading $25 over a line reading "USDC balance $9.04" is not a
// lie — it is an intent that needs funding — but the only thing admitting
// the mismatch was a small grey line, beside the loudest number on the
// surface. Clearing the amount was tried first and is worse: it takes the
// funding door away with it, so a reader who is short never learns it.
describe("a buy the balance cannot cover", () => {
  const short = (usd: number, cashUsd: number) =>
    viewTradeSheet({
      ticker: "NVDA",
      marketUsd: 200,
      reader: { cashUsd, uiAmount: 0, raw: "0", decimals: 6 },
      state: { side: "buy", kind: "market", usd, pct: 0, priceText: "" },
      walletOnPage: false,
    } as unknown as Parameters<typeof viewTradeSheet>[0]).action

  it("says how far the reader is from it", () => {
    // The cover amount the address screen asks for: ceil(15.96), one number on both surfaces.
    expect(short(25, 9.04).label).toBe("Deposit $16 USDC")
  })

  it("still names the currency, because the label is also the instruction", () => {
    expect(short(25, 0).label).toContain("USDC")
  })

  it("keeps the door armed, which is the whole reason not to clear the amount", () => {
    expect(short(25, 9.04)).toMatchObject({ tone: "fund", armed: true })
  })

  it("says nothing about a gap when there is none", () => {
    expect(short(5, 9.04).label).not.toContain("Deposit")
  })
})

describe("the fund door names the money it will move", () => {
  const SHORT: Reader = { cashUsd: 8.55, uiAmount: 0, raw: "0", entryMcapUsd: null }

  it("with a page wallet the button says the figure the wallet will be asked for", () => {
    const v = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 1,
      reader: SHORT,
      walletOnPage: true,
      state: { side: "buy", kind: "market", priceText: "", usd: 50, pct: 0 },
    })
    // Short by $41.45; the top-up rounds up past itself to $43, and the
    // button says so instead of promising $41.45 and moving $11.
    expect(v.action.tone).toBe("fund")
    expect(v.action.label).toBe("Deposit $42")
    expect(v.action.fundUsd).toBeCloseTo(41.45, 2)
  })

  it("without a page wallet the door names the shortfall as is", () => {
    const v = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 1,
      reader: SHORT,
      walletOnPage: false,
      state: { side: "buy", kind: "market", priceText: "", usd: 50, pct: 0 },
    })
    expect(v.action.label).toBe("Deposit $42 USDC")
    expect(v.action.fundUsd).toBeCloseTo(41.45, 2)
  })
})

describe("the limit-sell floor is judged on the share that will be sent", () => {
  // 30 units at $0.40 = $12 whole; a quarter of it is $3, under the floor.
  const TINY: Reader = { cashUsd: 10, uiAmount: 30, raw: "30000000", entryMcapUsd: null }
  it("a partial under $5 is refused here, not after a round trip", () => {
    const v = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 0.35,
      reader: TINY,
      state: { side: "sell", kind: "limit", priceText: "0.40", usd: 2.625, pct: 25 },
    })
    expect(v.action.armed).toBe(false)
    expect(v.note).toBe("Worth less than $5 at that price")
  })
  it("the same position sold whole clears the floor", () => {
    const v = viewTradeSheet({
      ticker: "WIF",
      marketUsd: 0.35,
      reader: TINY,
      state: { side: "sell", kind: "limit", priceText: "0.40", usd: 10.5, pct: 100 },
    })
    expect(v.action.armed).toBe(true)
    expect(v.intent).toMatchObject({ kind: "limit-sell", pct: 100, triggerPriceUsd: 0.4 })
  })
})
