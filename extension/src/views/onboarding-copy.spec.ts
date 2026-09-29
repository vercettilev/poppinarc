import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

/**
 * The audit's onboarding copy tour, pinned. Each of these is a sentence a
 * regression could quietly bring back.
 */
describe("onboarding speaks the product's language", () => {
  it("the install screen's trust line is positive form, not a denial", () => {
    const q = src("entries/welcome/components/steps/QuickStartStep.tsx")
    expect(q).not.toMatch(/note="We never/)
    expect(q).toMatch(/matched to markets in the moment/)
  })

  it("the payoff screen still promises something concrete", () => {
    /**
     * The hero card's explainer ("Live price chips under tweets, and your
     * own position under every tweet about a coin you hold") was removed on
     * the owner's call — a door does not need a paragraph, and the card is
     * a door. The promise did not go with it: the line under the card is
     * now the concrete one, because it names a place the reader can go and
     * see the thing work within a second.
     */
    const y = src("entries/welcome/components/steps/YoureInStep.tsx")
    expect(y).toMatch(/carry a live chip/)
    expect(y).toMatch(/x\.com\/search\?q=%24SOL/)
    // The explainer stays gone; the card is title + arrow.
    expect(y).not.toMatch(/your own position under every/)
  })

  it("the deposit screen names the exchange route in plain words", () => {
    /**
     * The sentence moved from a paragraph under the address to the rail
     * that actually does it (BlinkFund, at the top); the address card
     * still names the network. Lev, 2026-09-18: "biraz karışık geldi".
     */
    const r = src("views/receive.tsx")
    expect(r).toMatch(/Send USDC on Solana, from Coinbase, Binance or any wallet\./)
  })

  it("the panel's sign-in gates open the one full-page flow", () => {
    const l = src("components/Layout.tsx")
    expect(l).not.toMatch(/<SignInModal/)
    expect(l).toMatch(/<SignInRedirect/)
    const rdir = src("components/SignInRedirect.tsx")
    expect(rdir).toMatch(/flow=signin/)
  })

  it("empty positions point at the chip, where the thesis lives", () => {
    // The empty book is the doors now (components/PopDoors.tsx), not a sentence.
    expect(src("views/SpotPositions.tsx")).toMatch(/<PopDoors \/>/)
    expect(src("components/profile/ProfilePortfolio.tsx")).toMatch(
      /chip under any tweet/,
    )
  })

  it("the token room lists the mint's own orders and alerts", () => {
    const t = src("views/TokenView.tsx")
    expect(t).toMatch(/<OpenOrders mint=\{asset\.mint\}/)
    expect(t).toMatch(/<PriceAlerts mint=\{asset\.mint\}/)
  })
})

describe("the welcome headline is our angle, and the demo wears WIF's face", () => {
  it("leads with the in-feed trade, keeps the category in the subtitle", () => {
    const step = src("entries/welcome/components/steps/SignInStep.tsx")
    expect(step).toMatch(/title=\{ARC_EDITION \? "See it\. Tap it\. It's yours\." : "Trade from the tweet\."\}/)
    expect(step).toMatch(/ARC_EDITION \? "Right where you read\. Powered by Circle\."/)
    expect(step).toMatch(/Tokens and tokenized stocks\. On X, Reddit, and everywhere else you scroll\./)
    expect(step).not.toMatch(/title="Buy tokens and tokenized stocks\."/)
  })
  it("draws WIF's face from a baked asset, so the first screen waits on nothing", () => {
    const demo = src("entries/welcome/components/ChipDemo.tsx")
    expect(demo).toMatch(/src=\{WIF_LOGO_URI\}/)
    expect(demo).not.toMatch(/embed\/asset\/icon/)
    expect(src("assets/wifLogoDataUri.ts")).toMatch(/data:image\/jpeg;base64,/)
  })
  it("the Phantom button wears Phantom's mark, as Google's wears Google's", () => {
    const step = src("entries/welcome/components/steps/SignInStep.tsx")
    expect(step).toMatch(/src=\{PHANTOM_LOGO_URI\}/)
  })

  it("nothing sits under the Google button", () => {
    /**
     * Lev, 2026-09-18, after seeing it live: "gereksiz dikkat dağıtıyor".
     * The fee fact lives on the payoff and deposit screens, where money is.
     */
    const step = src("entries/welcome/components/steps/SignInStep.tsx")
    expect(step).not.toMatch(/No gas fees|Network fees are on us|your keys|approve each trade/)
  })
})
