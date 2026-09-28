import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { hasNoCash, knownCashUsd } from "~/helpers/readerCash"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * THE FUNDING DOOR ON THE PANEL'S FRONT DOOR, AND THE GUARD UNDER IT.
 *
 * Measured 2026-09-21: seven strangers have ever signed in; six opened the
 * panel, none opened the funding screen, none traded, no deposit has ever
 * landed. The ask was moved out of onboarding to "the first trade", which
 * needs a trade attempt nobody makes. It now stands on the screen they do
 * open, on one condition: a balance the server has STATED as nothing.
 *
 * THE ASSERTION THAT MATTERS is the second one. `?? 0` over an unknown
 * balance is how a funding prompt reaches the reader who has just funded —
 * the single person this feature exists to stop bothering. Every way the
 * balance can be unknown is listed below, and each one must answer "do not
 * ask".
 *
 * TWO HALVES, BECAUSE HALF OF THIS CANNOT BE RENDERED. jsdom + @mui throws
 * on these views (see the note in components/panel-fit-320.spec.ts: no
 * cascade, no layout), so the decision itself lives in a pure helper and is
 * executed here, and the WIRING that consumes it is pinned by reading the
 * view's source. A source guard alone would certify a condition nobody
 * runs; a helper test alone would not notice the view calling `?? 0`.
 */
describe("who gets asked to fund", () => {
  it("asks a loaded zero", () => {
    expect(hasNoCash({ cashUsd: 0 })).toBe(true)
    // Negative zero is a zero, and a negative balance is not a reason to
    // stay quiet either: neither buys anything.
    expect(hasNoCash({ cashUsd: -0 })).toBe(true)
    expect(hasNoCash({ cashUsd: -1 })).toBe(true)
    expect(knownCashUsd({ cashUsd: 0 })).toBe(0)
  })

  it("does not ask an unknown or not-yet-loaded balance", () => {
    // No book at all: the read is in the air, or it failed.
    expect(hasNoCash(null)).toBe(false)
    expect(hasNoCash(undefined)).toBe(false)
    // A book whose cash field the server never sent (an older server), or
    // sent as null.
    expect(hasNoCash({})).toBe(false)
    expect(hasNoCash({ cashUsd: undefined })).toBe(false)
    expect(hasNoCash({ cashUsd: null })).toBe(false)
    // NaN PASSES A NULL CHECK — `NaN == null` is false — so a balance that
    // arrived as 0/0 would sail through a `!= null` guard and be treated as
    // a loaded zero. It is unknown, not nothing.
    expect(hasNoCash({ cashUsd: Number.NaN })).toBe(false)
    expect(hasNoCash({ cashUsd: Number.POSITIVE_INFINITY })).toBe(false)
    for (const unknown of [null, undefined, {}, { cashUsd: Number.NaN }]) {
      expect(knownCashUsd(unknown)).toBeNull()
    }
  })

  it("does not ask a reader who has money", () => {
    expect(hasNoCash({ cashUsd: 0.01 })).toBe(false)
    expect(hasNoCash({ cashUsd: 250 })).toBe(false)
    // The sign-in method is not the condition: a wallet account holding
    // USDC and a custodial account that deposited are the same answer.
    expect(knownCashUsd({ cashUsd: 250 })).toBe(250)
  })
})

describe("the front door's funding ask", () => {
  const v = stripComments(read("views/SpotPositions.tsx"))

  it("is drawn only from the helper, and only inside the loaded state", () => {
    // The whole ready block is behind state === "ready" && data, so a
    // loading, signed-out or failed read renders the panel as it was.
    expect(v).toMatch(/\{state === "ready" && data && \(/)
    expect(v).toMatch(/\{cashIsLive && hasNoCash\(data\) && <FundDoor onConnected=\{refresh\} \/>\}/)
    // And the decision is never re-typed as a comparison on this screen.
    expect(v).not.toMatch(/cashUsd\s*(?:===|==|<=|<)\s*0/)
  })

  it("waits for the live read, because a cached zero is yesterday's", () => {
    // helpers/bookCache.ts paints the last known book instantly and moves
    // `state` to "ready" while the real read is still in the air; only the
    // live answer flips this flag.
    expect(v).toMatch(/const \[cashIsLive, setCashIsLive\] = useState\(false\)/)
    const then = v.indexOf("positionsAsset()")
    const flips = v.indexOf("setCashIsLive(true)")
    expect(flips).toBeGreaterThan(then)
    // Never off the cache path.
    const cachePaint = v.indexOf("readBookCache()")
    expect(v.slice(cachePaint)).not.toMatch(/setCashIsLive/)
  })

  it("hands the empty book the balance the server sent, not a zero for it", () => {
    expect(v).toMatch(/<FrontDoorEmpty cashUsd=\{data\.cashUsd\} \/>/)
    expect(v).not.toMatch(/cashUsd=\{data\.cashUsd \?\? 0\}/)
    const empty = stripComments(read("components/PopDoors.tsx"))
    expect(empty).toMatch(/knownCashUsd\(\{ cashUsd \}\)/)
    // An unknown balance prints no cash line rather than claiming $0.00.
    expect(empty).toMatch(/\{cash !== undefined && \(/)
  })
})

describe("the funding door reuses the one mechanism", () => {
  const door = stripComments(read("components/FundDoor.tsx"))
  const sheet = stripComments(read("components/TradeSheet.tsx"))

  it("remembers the intent and navigates, exactly as the trade sheet does", () => {
    // The trade sheet's door, minus a shortfall nobody typed. The intent is
    // what the deposit watcher times (entries/background/main.ts reads it
    // for "minutes since a Deposit door was pressed").
    for (const f of [door, sheet]) expect(f).toMatch(/rememberTopUpIntent(IfNone)?\(/)
    /* IF NONE, because an empty intent is still an intent: written flat, it
       erased the `{usd, mint}` a chip's Deposit door had left minutes earlier
       and the address screen stopped knowing which buy the money was for
       (helpers/topUpIntent.ts, and the trap spec beside it). */
    expect(door).toMatch(/void rememberTopUpIntentIfNone\(\)/)
    expect(door).toMatch(/navigate\("\/receive", \{ state: \{ from: "panel" \} \}\)/)
    // No second rail: this door does not open a tab, a window or the page.
    expect(door).not.toMatch(/chrome\.tabs\.create|window\.open|openPanelAt/)
  })

  it("asks for no amount, because no amount was typed", () => {
    // A cover figure here would be a number the reader never chose; the
    // address screen says "send at least $X" off exactly that.
    expect(door).not.toMatch(/topUpAmount\(/)
    expect(door).not.toMatch(/state: \{ need/)
  })

  it("is counted as the panel door it is", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).toMatch(/stateFrom === "panel" \|\| typeof stateNeed === "number" \? "panel" : "page"/)
  })

  it("says it in the product's voice: the verb, the payoff, the fee fact", () => {
    expect(door).toMatch(/Deposit USDC/)
    expect(door).toMatch(/Every chip becomes a Buy button\. Network fees are on us\./)
    // The room's own sentence, not a second wording of it.
    expect(stripComments(read("views/receive.tsx"))).toMatch(/Network fees are on us\./)
  })
})

/**
 * AND THE SAME CARD ON AN ACCOUNT THAT TRADES FROM ITS OWN WALLET.
 *
 * This card stands on the panel's front door for anyone the server has said
 * has no cash, wallet accounts included — and for them "Deposit USDC" is the
 * same lie the chip's door was telling on 2026-09-22: there is no balance
 * here to deposit into, the USDC has to arrive in their own wallet, and
 * nothing about a deposit is on us there. Lev's own wording is the headline.
 *
 * ONE READ FOR ONE FACT: the hook and the two fields views/receive.tsx and
 * components/TradingWalletCard.tsx already use, and the same react-query
 * cache this card writes to itself when a connect lands.
 */
describe("the funding door on a wallet account", () => {
  const door = stripComments(read("components/FundDoor.tsx"))

  it("knows the mode from the read that already answers it", () => {
    expect(door).toMatch(/const \{ data: me \} = useCurrentUser\(\)/)
    expect(door).toMatch(/const external = me\?\.wallet_mode === "external" && !!me\.external_address/)
    // Not a second source for one fact: the same key this card invalidates.
    expect(door).toMatch(/queryKey: \["current-user"\]/)
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).toMatch(/const external = me\?\.wallet_mode === "external" && !!me\.external_address/)
  })

  it("wears Lev's wording, and the room it opens wears the same one", () => {
    expect(door).toMatch(/\{external \? "Add USDC to your wallet" : "Deposit USDC"\}/)
    // The door and the room say one thing, as they do on the custodial side.
    expect(stripComments(read("views/receive.tsx"))).toMatch(
      /\{external \? "Add USDC to your wallet" : "Deposit USDC"\}/,
    )
  })

  it("swaps the fee fact for the one that is true here", () => {
    // "Network fees are on us" is the custodial rail's promise; a wallet
    // account pays its own and signs each trade. Same shape, same payoff
    // word, the second sentence replaced — and it is the sentence the
    // Settings card and the door below already use.
    expect(door).toMatch(/"Every chip becomes a Buy button\. Each trade signs in Phantom\."/)
    const feeAt = door.indexOf("Network fees are on us")
    expect(feeAt).toBeGreaterThan(0)
    expect(door.slice(0, feeAt)).toMatch(/external\s*\?/)
  })

  it("does not offer to connect a wallet to somebody already trading from one", () => {
    const second = door.indexOf("or connect a wallet you already have")
    expect(second).toBeGreaterThan(0)
    // The whole second door is behind the gate, not just its label.
    expect(door).toMatch(/\{!external && \(\s*<Box\s*component="button"\s*onClick=\{\(\) => void connect\(\)\}/)
    expect(door.indexOf("{!external && (")).toBeLessThan(second)
  })
})
