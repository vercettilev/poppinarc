import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { topUpAmount } from "~/helpers/topUpAmount"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * A wallet account's "Deposit USDC" has exactly one destination: the panel's
 * address screen, which names the wallet its trades come from. Measured on
 * 2026-09-18 before this: the chip's door called Phantom's connect() and
 * showed nothing, and the "You" screen opened an amount picker that promised
 * "Straight to your Poppin balance".
 */
describe("a wallet account's deposit doors", () => {
  it("the chip's top-up routes to that screen, never a conversion and never a silent connect", () => {
    const cs = stripComments(read("entries/contentScript/primary/main.tsx"))
    /**
     * 2026-09-22. Between 1.0.322 and today this branch signed a SOL → USDC
     * conversion instead, so a door pressed with no amount behind it opened
     * Phantom on "+10.15 USDC, -0.088 SOL": the reader's own SOL being sold,
     * at topUpAmount's fallback figure, under a button that said Deposit.
     * The branch routes now — remember the intent, open /receive — and
     * answers false, because nothing has landed.
     */
    expect(cs).toMatch(
      /route: "external", usd \}\)\s*openTopUp\(\s*typeof usd === "number" && usd > 0 \? topUpAmount\(usd, mode \?\? "cover"\) : undefined,\s*ctx,\s*\)\s*return false/,
    )
    expect(cs).not.toMatch(/connectPageWallet\(\)\.catch/)
    expect(cs).toMatch(/fundRoute: async \(\) =>/)
  })

  it("the chip's money door asks the route before showing an amount picker", () => {
    const strip = stripComments(read("entries/contentScript/x/xStrip.ts"))
    expect(strip).toMatch(/fundRoute\?\(\): Promise<"external" \| "custodial">/)
    expect(strip).toMatch(/if \(route === "external"\) void deps\.topUp\?\.\(\)\s*else showFund\(showYou\)/)
  })

  it("the Settings card offers both wallets whichever one is current", () => {
    const card = stripComments(read("components/TradingWalletCard.tsx"))
    expect(card).toMatch(/Phantom · \{short\(own\)\}/)
    expect(card).toMatch(/Trading from this/)
    expect(card).toMatch(/choose\(own\)/)
    expect(card).toMatch(/choose\(null\)/)
  })
})

/**
 * The deposit funnel, end to end: the door remembers the amount and the
 * moment, the address screen says the amount and counts itself, the
 * landing carries the minutes since the door.
 */
describe("the address screen knows what it is for", () => {
  it("the page door remembers the cover amount; the panel link carries the shortfall", () => {
    const page = stripComments(read("components/SpotCard/pagePosts.ts"))
    expect(page).toMatch(/export function openTopUp\(needUsd\?: number, ctx\?: TopUpContext, note\?: string \| null\): void \{\s*rememberTopUpIntent\(needUsd, ctx, note\)/)
    expect(page).toMatch(/openTopUp\(typeof needUsd === "number" && needUsd > 0 \? topUpAmount\(needUsd, mode\) : undefined, ctx\)/)
    const sheet = stripComments(read("components/TradeSheet.tsx"))
    expect(sheet).toMatch(/const need = topUpAmount\(Math\.max\(0, usdNum - \(reader\?\.cashUsd \?\? 0\)\), "cover"\)/)
    expect(sheet).toMatch(/rememberTopUpIntent\(need, \{\s*mint: asset\.mint,\s*buyUsd: usdNum,/)
    expect(sheet).toMatch(/navigate\("\/receive", \{ state: \{ need \} \}\)/)
  })

  it("the screen says the amount for a Poppin wallet and counts open and copy", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).toMatch(/Send at least \$\$\{need\} USDC to cover your buy\./)
    // The store build's line, and the Arc edition's picker in its place.
    expect(rcv).toMatch(/!external &&\s*need !== null && \(/)
    expect(rcv).toMatch(/ARC_EDITION && !external \? \(/)
    expect(rcv).toMatch(/<AmountPicker/)
    expect(rcv).toMatch(/count\("receive_opened"/)
    expect(rcv).toMatch(/count\("receive_copy_address"/)
  })

  it("the landing carries the minutes since the door, and the map knows the new events", () => {
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/sinceDoorMin: minutesSince\(intent\)/)
    expect(bg).toMatch(/receive_opened: "panel_view"/)
    expect(bg).toMatch(/receive_copy_address: "card_interacted"/)
  })
})

/**
 * SUPER SMOOTH, Lev's word: three rails on one screen, a watch that says it
 * is watching, and a return to the very Buy the money was for.
 */
describe("the address screen: rails, the watch, the return", () => {
  it("one card: the address, then OR, then Blink above Phantom, all with the amount", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).toMatch(/<BlinkFund\s+variant="row"\s+amountUsd=\{need\}/)
    expect(rcv).toMatch(/Deposit \$\$\{need \?\? 25\} in one tap, on this page/)
    expect(rcv).toMatch(/probePageWallet\(\)/)
    expect(rcv).toMatch(/topUpViaPage\(usd\)/)
    // Lev, 18 Eyl: QR, another chain, Phantom, stacked. And the number is
    // said once, in the sentence above the card: the card's "Minimum
    // deposit $25" was the buy's cover amount wearing Blink's label.
    expect(rcv.indexOf("<BlinkFund")).toBeLessThan(rcv.indexOf('title="Phantom"'))
    expect(rcv).not.toMatch(/Minimum deposit/)
    // Poppin wallets only: a wallet account's money is in its own wallet.
    // Blink deposits to a wallet account's own address too; Phantom's transfer row is the embedded wallet's alone.
    expect(rcv).toMatch(/\{\(blinkOn \|\| \(!external && phantomHere\)\) && \(/)
    expect(rcv).toMatch(/\{!external && phantomHere && \(\s*<RailRow/)
  })

  it("watches every ten seconds for ten minutes and says so", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).toMatch(/Watching for your USDC\. Usually 1-3 minutes from an exchange\./)
    expect(rcv).toMatch(/const late = Date\.now\(\) - t0 > 10 \* 60_000/)
    expect(rcv).toMatch(/\}, 10_000\)/)
  })

  it("on landing it tells the page's chips and returns to the Buy the money was for", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).toMatch(/type: "BOOK_CHANGED_NOW"/)
    expect(rcv).toMatch(/setLaunchMint\(intent\.mint, "buy", intent\.buyUsd \?\? undefined\)\s*navigate\(`\/token\/\$\{intent\.mint\}`\)/)
    const room = stripComments(read("views/TokenView.tsx"))
    expect(room).toMatch(/initialUsd=\{sheetUsd \?\? undefined\}/)
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/request\.type === "BOOK_CHANGED_NOW"/)
    expect(bg).toMatch(/deposit:\$\{t\.signature\}:\$\{Math\.max\(0, Math\.ceil\(ready\.buyUsd \?\? 0\)\)\}:\$\{ready\.mint\}/)
    expect(bg).toMatch(/\(usd > 0 \? "&usd=" \+ usd : ""\)/)
    const strip = stripComments(read("components/PageAssetStrip.tsx"))
    expect(strip).toMatch(/initialUsd=\{sheetUsd \?\? undefined\}/)
    const sheet = stripComments(read("components/TradeSheet.tsx"))
    expect(sheet).toMatch(/if \(typeof initialUsd === "number" && initialUsd > 0\) setAmountAndQuote\(initialUsd, "buy"\)/)
    const chip = stripComments(read("entries/contentScript/x/xStrip.ts"))
    expect(chip).toMatch(/if \(walUsd !== null && r\.cashUsd > walUsd \+ 0\.5\) \{\s*chip\.classList\.add\("glow-ok"\)/)
  })

  it("the doors carry the buy: coin, dollars, ticker, page", () => {
    const chip = stripComments(read("entries/contentScript/x/xStrip.ts"))
    expect(chip).toMatch(/deps\.topUp\(spend, undefined, \{\s*mint: row\.mint,\s*buyUsd: st\.usd,\s*ticker: row\.ticker,\s*sourceUrl: tweetUrl,/)
    const note = stripComments(read("helpers/depositWatch.ts"))
    expect(note).toMatch(/Your \$\{tick\} buy is ready\./)
  })
})

/**
 * The Blink door asks for the sheet in the panel first and falls to a tab
 * (app.poppin.so/fund, with what the screen was for) when the frame stays
 * silent; the screen it left keeps watching. The SDK presents the sheet as
 * a modal over a panel narrower than 640px (measured 2026-09-18).
 */
describe("Blink from the panel: embedded when Blink lets us, a tab when not", () => {
  it("is the door to another chain, wears Blink's mark, opens dark, and retries once per version", () => {
    const blink = stripComments(read("components/BlinkFund.tsx"))
    expect(blink).toMatch(/BLINK_ROW_TITLE = "Deposit from another chain"/)
    expect(blink).toMatch(/BLINK_ROW_SUB = "USDC or USDT on Ethereum, Base, Arbitrum, Polygon, BNB"/)
    expect(blink).toMatch(/src=\{BLINK_LOGO_URI\}/)
    expect(blink).toMatch(/appearance: \{ theme: "dark" \}/)
    expect(blink).toMatch(/version: buildVersion\(\)/)
    expect(blink).toMatch(/v\.version === buildVersion\(\)/)
    expect(blink).toMatch(/deposit\.on\("resize"/)
    /* NO SECOND ENTRY SCREEN. Blink's full widget is its own deposit page:
       the same wallet's QR and address, a "Minimum deposit" that is really
       the buy's cover amount, and the other-chain flow one tap further
       down. The row is named for that one job, so it opens on it. */
    expect(blink).toMatch(/enableFullWidget: false/)
    /* AND NO EMBED IN A PANEL THAT CANNOT HOLD ONE. At or below the SDK's
       own 640px threshold "embedded" becomes a full-viewport overlay, so
       the inline card cannot happen and the refused frame fills the panel
       with a broken page until the handshake times out. Reported from the
       panel, 2026-09-19. */
    expect(blink).toMatch(/EMBED_MIN_VIEWPORT_PX = 640/)
    expect(blink).toMatch(/const tooNarrow = \(window\.visualViewport\?\.width \?\? window\.innerWidth\) <= EMBED_MIN_VIEWPORT_PX/)
    expect(blink).toMatch(/!slot \|\| tooNarrow \|\|/)
  })

  it("tries the embedded sheet first and listens for Blink's own postMessage", () => {
    const blink = stripComments(read("components/BlinkFund.tsx"))
    expect(blink).toMatch(/presentation: "embedded"/)
    expect(blink).toMatch(/e\.origin === BLINK_ORIGIN\) heard = true/)
    expect(blink).toMatch(/HANDSHAKE_MS = 4000/)
  })

  it("falls back to the tab on silence, and does not try again for a day", () => {
    const blink = stripComments(read("components/BlinkFund.tsx"))
    expect(blink).toMatch(/if \(heard\) return[\s\S]*?rememberEmbedBlocked\(\)[\s\S]*?openTab\(\)/)
    expect(blink).toMatch(/BLOCKED_TTL_MS = 24 \* 60 \* 60_000/)
    expect(blink).toMatch(/window\.open\(blinkUrl\(amountUsd\), "_blank", "noopener"\)/)
    expect(blink).toMatch(/\?rail=blink\$\{a \? `&amount=\$\{a\}` : ""\}/)
  })

  it("the address screen says one thing at the top and nothing legacy at the bottom", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    expect(rcv).not.toMatch(/Deposit from a wallet|No wallet\? Send USDC/)
    expect(rcv).toMatch(/\{\(external \|\| need === null\) && \(/)
    expect(rcv).toMatch(/spendable !== null && spendable\.usdc > 0 && \(/)
    expect(rcv).toMatch(/address=\{walletAddress\}/)
  })
})

/**
 * The end-to-end audit of 2026-09-18, pinned: the panel is short before the
 * press, Max sells all, the bell is drawn at birth, a door keeps its buy on
 * failure, the toast says "ready" only when it is, one token signs in once.
 */
describe("the audit's fixes hold", () => {
  it("the panel sheet waits and shows Top up when the cash cannot cover the buy", () => {
    const sheet = stripComments(read("components/TradeSheet.tsx"))
    expect(sheet).toMatch(/const short = !external && mode === "buy" && !outcome && view\.action\?\.tone === "fund"/)
    expect(sheet).toMatch(/\{\(insufficient \|\| short\) && \(/)
    expect(sheet).toMatch(/\(when === "trigger" \? !orderReady : !canConfirm\) \|\|\s*short \|\|/)
    expect(sheet).toMatch(/\(external \|\| \/insufficient\|enough\/i\.test\(said\)\)/)
  })

  it("Max sells the whole position's raw, never a cents-derived fraction", () => {
    const sheet = stripComments(read("components/TradeSheet.tsx"))
    expect(sheet).toMatch(/usd >= holdingUsd - 0\.005\) return balance\.raw/)
    expect(sheet).not.toMatch(/usdToRawOfHolding\(usd, balance, asset\.priceUsd\)\s*\n\s*const raw/)
    expect((sheet.match(/rawFor\(usd\)/g) ?? []).length).toBe(3)
  })

  it("the sheet's bell wears its glyph before any click", () => {
    const chip = stripComments(read("entries/contentScript/x/xStrip.ts"))
    const create = chip.indexOf('const bell = btn("bell", "", () => {')
    const glyph = chip.indexOf("bell.innerHTML = BELL_GLYPH", create)
    const append = chip.indexOf("field.append(bell)", create)
    const handlerEnd = chip.indexOf("bell.title = \"Alert me at this price, no order needed\"", create)
    expect(create).toBeGreaterThan(0)
    expect(glyph).toBeGreaterThan(create)
    expect(glyph).toBeLessThan(append)
    expect(glyph).toBeLessThan(handlerEnd)
    // the glyph comes AFTER the handler body, not inside it
    expect(glyph).toBeGreaterThan(chip.indexOf(".then((added)", create))
  })

  it("a door that fails keeps the buy it was pressed for, and says why", () => {
    const page = stripComments(read("components/SpotCard/pagePosts.ts"))
    expect(page).not.toMatch(/openTopUp\(\)/)
    // Two in topUpFromPage (no transaction, unsigned) and four in convertFromPage
    // (no wallet, not connected, no transaction, unsigned). topUpFromPage's
    // not-connected door sizes itself from needUsd, like its no-wallet door.
    expect((page.match(/openTopUp\(amountUsd, ctx\)/g) ?? []).length).toBe(6)
    // The server's refusal (no USDC, no SOL) rides with the intent to the address screen.
    expect(page).toMatch(/openTopUp\(amountUsd, ctx, typeof said === "string" && said\.length < 160 \? said : null\)/)
    const rcv = stripComments(read("views/receive.tsx"))
    // ONE SENTENCE. It used to fork on `external` and offer "Phantom could
    // not convert it", which is now a sentence about an act that happens on
    // no path — and a note no wallet account can be handed, because its
    // doors reach this screen with nothing signed on the way.
    expect(rcv).toMatch(/`Phantom could not send it: \$\{intent\.note\}`/)
    expect(rcv).not.toMatch(/could not convert/)
    const intent = stripComments(read("helpers/topUpIntent.ts"))
    expect(intent).toMatch(/note: typeof note === "string" && note\.length > 0 && note\.length < 160 \? note : null/)
  })

  it("the toast says ready only for enough USDC within the hour, and only USDC clears the intent", () => {
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/t\.amountUi >= \(intent\.usd \?\? 0\)/)
    expect(bg).toMatch(/Date\.now\(\) - intent\.at <= 60 \* 60_000/)
    expect(bg).toMatch(/if \(intent && t\.mint === USDC_MINT\) void chrome\.storage\.local\.remove\(TOP_UP_INTENT_KEY\)/)
    expect(bg).toMatch(/initialRoute: `\/token\/\$\{mint\}`/)
  })

  it("one token signs in once, and the chip forgets its wallet mode on sign-in and on a switch", () => {
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/lastSigninToken\.token === token && Date\.now\(\) - lastSigninToken\.at < 15_000/)
    const cs = stripComments(read("entries/contentScript/primary/main.tsx"))
    expect((cs.match(/tradingWalletMemo = null/g) ?? []).length).toBeGreaterThanOrEqual(2)
    const card = stripComments(read("components/TradingWalletCard.tsx"))
    expect(card).toMatch(/type: "BOOK_CHANGED_NOW"/)
  })
})

/**
 * ── THE WALLET ACCOUNT'S DEPOSIT IS NOT A CONVERSION (2026-09-22) ───────────
 *
 * It used to be: its SOL became USDC with one Phantom signature on the page,
 * and the panel's address screen offered the same rail as a card. Lev pressed
 * "Deposit USDC" in the chip's "You" room on a wallet account and Phantom
 * opened on "+10.15 USDC, -0.088 SOL" — an amount he never chose, for a
 * deposit that deposited nothing, selling his own SOL.
 *
 * Three faults at once: the word "Deposit" was the opposite of what happened,
 * the figure was invented (the door passes no amount, so topUpAmount fell
 * back to $10), and the same button asked a custodial account how much it
 * wanted while walking a wallet account straight into a signature.
 *
 * His decision, not to be re-litigated here: "Convert SOL to USDC" exists as
 * a product concept in no app on earth — Jupiter, Phantom and Uniswap all
 * route from whatever you hold — so shipping it as a button or an offer would
 * be inventing a concept nobody recognises. Simplicity wins. For a wallet
 * account there is no conversion anywhere; the answer is "Add USDC to your
 * wallet" and the address.
 *
 * (Why a wallet trade needs USDC at all, so this is not "simplified" back:
 * the server proves an external trade's SIZE from the USDC leg of the
 * transaction — apps/backend/src/spot/external-proof.util.ts, `executedUsd` —
 * and a trade with no USDC leg is refuted and never settles.)
 */
describe("a wallet account is sent to its own address, and signs nothing", () => {
  const cs = stripComments(read("entries/contentScript/primary/main.tsx"))
  const chip = stripComments(read("entries/contentScript/x/xStrip.ts"))

  it("has ONE guard, and every money door passes through it", () => {
    /**
     * THE GUARD IS STRUCTURAL ON PURPOSE. Three doors reached the
     * conversion; fixing three call sites would leave the fourth to be
     * written the same way. All of them call deps.topUp, and the account's
     * kind is read once, there.
     */
    const guardAt = cs.indexOf("const tw = await tradingWalletOf()\n      if (tw.external) {")
    expect(guardAt).toBeGreaterThan(0)
    const branch = cs.slice(guardAt, cs.indexOf("return topUpFromPage(", guardAt))
    expect(branch).toMatch(/openTopUp\(/)
    expect(branch).toMatch(/return false/)
    // The whole point, in one assertion: this branch signs nothing.
    expect(branch).not.toMatch(/convertFromPage|signWithPageWallet|connectPageWallet/)
  })

  it("cannot invent the amount, and the figure it would have invented is still live", () => {
    // NOT VACUOUS: the fallback is real and still reachable by every caller
    // that legitimately has no figure and wants one. $10 became "+10.15
    // USDC" in Phantom. The guard is what keeps the wallet path away from it.
    expect(topUpAmount(undefined, "cover")).toBe(10)
    expect(cs).toMatch(/typeof usd === "number" && usd > 0 \? topUpAmount\(usd, mode \?\? "cover"\) : undefined/)
  })

  it("carries only what the reader's own buy implies, from each of the three doors", () => {
    // 1. The "You" room's door: nobody typed a figure, so none travels.
    expect(chip).toMatch(/if \(route === "external"\) void deps\.topUp\?\.\(\)/)
    // 2. The sheet's shortfall, and 3. the failed buy's "Add USDC": both
    // carry the amount the reader was already spending, and the coin, so the
    // address screen can say what the buy needs and return to it.
    expect(chip).toMatch(/const spend = latest\.action\.fundUsd\s*void Promise\.resolve\(\s*deps\.topUp\(spend, undefined, \{/)
    expect(chip).toMatch(/btn\("act", ARC_EDITION \? "Add money" : "Add USDC", \(\) =>\s*void deps\.topUp\?\.\(busyUsd, undefined, \{/)
    // And no door on the chip reaches a conversion of its own.
    expect(chip).not.toMatch(/convertFromPage|convertViaPage|of SOL to USDC/)
  })

  it("stops promising a wallet popup that will not open", () => {
    // hasWallet decides one thing: whether the funding button says "Deposit
    // from wallet" (a popup is coming) or "Deposit $X USDC" (the address
    // screen is coming). Phantom IS injected for a wallet account, which is
    // exactly how that button came to promise a popup it no longer opens.
    expect(cs).toMatch(
      /hasWallet: async \(\) => \{\s*if \(\(await tradingWalletOf\(\)\)\.external\) return false/,
    )
    const model = stripComments(read("helpers/tradeSheetModel.ts"))
    expect(model).toMatch(/walletOnPage\s*\?\s*"Deposit from wallet"/)
  })

  it("lands on the screen that already knew how to answer this", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    // The destination existed all along; only the routing was wrong.
    expect(rcv).toMatch(/const external = me\?\.wallet_mode === "external" && !!me\.external_address/)
    /* The wallet account's own address is still what this screen shows —
       behind the gate that waits for the account to be READ at all, because
       an unread one used to fall through to the custodial wallet (see
       views/receive-address-account.spec.ts). */
    expect(rcv).toMatch(/const walletAddress = accountUnread\s*\?\s*""\s*: external\s*\? String\(me\?\.external_address\)/)
    expect(rcv).toMatch(/\{external \? "Add USDC to your wallet" : ARC_EDITION \? "Add money" : "Deposit USDC"\}/)
    // Its watch and its return to the buy are untouched.
    expect(rcv).toMatch(/url: "\/fund\/wallet-usdc"/)
    expect(rcv).toMatch(/const extWatching = external && \(need !== null \|\| intent !== null\) && landedUsd === null/)
    expect(rcv).toMatch(/USDC landed in Phantom/)
  })

  it("does not keep the conversion on that screen as a remedy", () => {
    const rcv = stripComments(read("views/receive.tsx"))
    // Lev: not relabelled, and not offered as a remedy. The card that read
    // the wallet's SOL and the button under it are both gone.
    expect(rcv).not.toMatch(/Convert|convertViaPage|convert\/wallet|spendableSol/)
    // The address, the QR and the other-chain rail are what remain.
    expect(rcv).toMatch(/<QrCode/)
    expect(rcv).toMatch(/<BlinkFund/)
  })

  /**
   * THE DEAD CODE, NAMED RATHER THAN SWEPT UP. convertFromPage is not
   * deleted: whoever generalises the server's proof decides its fate, and a
   * tidy-up now would erase why it is here. What this pins is that no money
   * door routes to it — its one remaining reference is a relay branch
   * nothing asks for, since the panel card that asked is gone.
   */
  it("leaves convertFromPage standing with exactly one caller, which nothing asks", () => {
    const page = stripComments(read("components/SpotCard/pagePosts.ts"))
    expect(page).toMatch(/export async function convertFromPage\(/)
    const calls = [...cs.matchAll(/convertFromPage\(/g)].map((m) => m.index!)
    expect(calls.length).toBe(1)
    const relayAt = cs.indexOf('if (ask.kind === "convert") {')
    const nextAt = cs.indexOf('if (ask.kind === "topup") {')
    expect(relayAt).toBeGreaterThan(0)
    expect(calls[0]).toBeGreaterThan(relayAt)
    expect(calls[0]).toBeLessThan(nextAt)
    // And the panel's end of that relay has no caller left at all.
    const relay = stripComments(read("helpers/panelExternalTrade.ts"))
    expect(relay).toMatch(/export function convertViaPage\(/)
    for (const f of ["views/receive.tsx", "components/TradeSheet.tsx", "views/SpotPositions.tsx"]) {
      expect(stripComments(read(f)), f).not.toMatch(/convertViaPage/)
    }
  })
})

