import { ARC_EDITION } from "~/config/edition"

/**
 * Onboarding V2 switch — "önce ürün, sonra hesap, en son para".
 *
 * ON (default): install shows ONE screen (value line + permission grant) and
 * everything else moves to the moment of intent — the card itself walks a
 * reader through sign-in and top-up exactly when a trade needs them.
 *
 * OFF: the original six-screen welcome flow (permissions → sign-in → profile
 * → intro → fund → final) and the card's old behaviour, byte-for-byte — no
 * old code was deleted for V2. THE REVERT IS THIS FLAG:
 *
 *     NEXT_PUBLIC_ONBOARDING_V2=false  →  rebuild  →  old onboarding is back
 *
 * (.env.production line + one build; nothing else to touch.)
 */
const flagOn = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined ? dflt : v === "true"

export const ONBOARDING_V2: boolean = flagOn(
  process.env.NEXT_PUBLIC_ONBOARDING_V2,
  true,
)

/**
 * WHERE ONBOARDING HANDS PEOPLE OFF, and why it is one fixed page.
 *
 * The flow ends on a real X page with a real chip and a two-step coach
 * drawn on top of it. A coach needs a chip to point at, and a random home
 * feed cannot promise one: measured in September, six in ten decided
 * cashtags do not resolve, and plenty of feeds mention nothing tradeable
 * at all. So the handoff is a page we know renders a chip. The live $SOL
 * search does today; Poppin's own pinned $SOL tweet permalink is better
 * (visible logged-out, and the first chip lands under our own post) and
 * replaces this the moment it exists.
 */
export const ONBOARDING_X_URL = ARC_EDITION
  ? "https://x.com/circle/status/2039734602281918874"
  : "https://x.com/solana/status/2100237359380099544"
/* @solana's own post. It carries no $SOL cashtag and does not need one:
   the account is in xMatch's handle aliases and that tier is author-first,
   so the chip resolves to SOL from who wrote it, whatever the text says.
   Verified public via the syndication endpoint on 2026-09-16. Not ours, so
   it can vanish; a Poppin-owned $SOL post replaces it the day one exists.

   THE ARC EDITION cannot land there: @solana resolves to SOL, which is not
   on Arc, so the chip under it would take itself down. It lands on Circle's
   own post announcing Circle Wrapped Bitcoin ("Circle Wrapped Bitcoin is
   coming.", 2026-04-02, public), whose "Bitcoin" the Arc name tier resolves
   to cirBTC: Circle's asset, under Circle's post. Verified 2026-09-29 through
   the syndication endpoint and the matcher (arc/edition-helpers.spec.ts). */

/**
 * WHERE "Try Poppin" OFFERS TO GO, in the Arc edition: one post on each kind
 * of page the chip runs on, each checked 2026-09-29 by fetching the page and
 * running its text through the matcher (arc/edition-helpers.spec.ts), and
 * each on a host a site adapter serves (config/try-places.spec.ts).
 *
 * Calm, reputable and about Circle's own assets on purpose: measured the same
 * day, a Circle and an Arc grant-reviewer panel both said a memecoin or
 * launchpad-token post as a first stop would hurt, and on testnet no long-tail
 * Arc token resolves at all. `what` is the source and the headline as the
 * page itself prints it.
 */
export interface TryPlace {
  id: "x" | "news" | "reddit"
  where: string
  what: string
  url: string
}
export const ARC_TRY_PLACES: readonly TryPlace[] = [
  { id: "x", where: "Start on X", what: "Circle: Circle Wrapped Bitcoin is coming", url: ONBOARDING_X_URL },
  {
    id: "news",
    where: "Start with the news",
    what: "CNBC: Bitcoin hits highest level since January",
    url: "https://www.cnbc.com/2026/09/21/bitcoin-price-crypto-rally.html",
  },
  {
    id: "reddit",
    where: "Start on Reddit",
    what: "r/personalfinance: IRS issues Bitcoin guidance",
    url: "https://www.reddit.com/r/personalfinance/comments/21d0rr/irs_issues_bitcoin_guidance_virtual_currency_is/",
  },
]

/**
 * WRITTEN BY THE COACH ITSELF, THE MOMENT IT IS SHOWN, and read by nothing
 * else. Absent means "this browser has never been shown the coach", which
 * is the only question worth asking.
 *
 * IT USED TO BE `poppin_coach_pending`, SET BY THE WELCOME PAGE. That made
 * the coach a reward for finishing onboarding, and onboarding is where
 * everybody stopped: measured 2026-09-23, 9 people reached /show-me and 9
 * people saw the coach, against 140 who were shown a chip. The other 131
 * met the product with no introduction at all — 94 of every 100 readers
 * looking at a row of controls nobody had named. Owner's call the same
 * day: "koçu herkes görmeli, görmeyen herkes 1 kere görmeli."
 *
 * The flip has one cost, paid once: the ~15 people who already saw the
 * coach have no local trace of it (the old flag was REMOVED on display,
 * which is indistinguishable from never set), so they see it one more
 * time. That is the whole price of reaching the other 131.
 *
 * chrome.storage.local, not sync: one browser, one showing.
 */
export const COACH_SEEN_KEY = "poppin_coach_seen"
