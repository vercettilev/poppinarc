/**
 * WHICH PRODUCT THIS BUILD IS: the store extension, or the Arc edition.
 *
 * The Arc edition is the same extension pointed at arc-api (.env.arc, built
 * by scripts/build-arc.sh). Its money is USDC on Arc in a Circle wallet, its
 * addresses and transaction hashes are 0x hex, and its backend serves the
 * trading, wallet and discovery routes and nothing else. Everything the store
 * backend answers that arc-api does not (points, referrals, the social board,
 * site presence, telemetry, standing orders) is switched off here rather than
 * left to 404, because a 404 on the document path is a red line in
 * chrome://extensions and, in two places, is not even enough to hide the
 * surface (see contract noise.md: the points dep still prints "+N pts").
 *
 * THE STORE BUILD MUST NOT MOVE. Every value below is exactly what the code
 * did before this file existed when NEXT_PUBLIC_ARC_EDITION is anything but
 * "true", and the store's .env files never set it. vite.config.ts inlines
 * every NEXT_PUBLIC_* key, so no config change is needed to read these.
 *
 * GATES READ CAPABILITIES, NOT THE EDITION NAME. A surface asks "is there a
 * points backend", not "is this Arc", so the day arc-api grows a deposit
 * watcher or a ticks socket the switch is one env line, not a hunt through
 * every call site.
 */

export const ARC_EDITION: boolean = process.env.NEXT_PUBLIC_ARC_EDITION === "true"

export type ArcNetworkName = "mainnet" | "testnet"

/**
 * Which Arc network the edition's links and addresses belong to. Testnet
 * unless the build says mainnet, so a missing line can never send somebody
 * to a mainnet explorer page for a testnet transaction.
 */
export function arcNetworkFrom(v: string | undefined): ArcNetworkName {
  return v === "mainnet" ? "mainnet" : "testnet"
}
export const ARC_NETWORK: ArcNetworkName = arcNetworkFrom(process.env.NEXT_PUBLIC_ARC_NETWORK)

export interface Capabilities {
  /** POST /user-events (and /anon). */
  telemetry: boolean
  /** Site-chat presence beats, the live pill, the chat room, /ticks page counts. */
  sitePresence: boolean
  /** Flywheel board and pool, points, seats, referrals, streaks, ditto, the rank toast. */
  gamification: boolean
  /** Callers, following trades, wins, consensus, the notifications bell. */
  social: boolean
  /** A feed post after a trade or a fill, and the flywheel share link. */
  autoPost: boolean
  /** The /discover token list (the store's Jupiter terminal). */
  discover: boolean
  /** Standing orders: the fill watch, fills/seen, the chip's order list. */
  orderWatch: boolean
  /** The server copy of price alerts. The local alerts keep working either way. */
  alertsMirror: boolean
  /** The public /ticks socket that moves the chip's price. */
  ticks: boolean
  /** GET /wallets/external-transfers, the "Received 25 USDC" toast. */
  depositWatch: boolean
  /** The Solana store's funding rails: Phantom on the page, Blink, the Phantom connect card. */
  solanaRails: boolean
  /** Fee lines and fee sentences ("Network fees are on us"). */
  feeLines: boolean
  /** Exporting the wallet's private key. A Circle wallet has none to export. */
  keyExport: boolean
}

/**
 * The store gets everything, whatever the env says. The Arc edition gets
 * what arc-api serves; the two routes it may grow later (the deposit feed and
 * the ticks socket) are opt-in by env so they switch on without a code change.
 */
export function capabilitiesFor(
  arc: boolean,
  optIn: { ticks?: string; depositWatch?: string } = {},
): Capabilities {
  const store = !arc
  return {
    telemetry: store,
    sitePresence: store,
    gamification: store,
    social: store,
    autoPost: store,
    discover: store,
    orderWatch: store,
    alertsMirror: store,
    ticks: store || optIn.ticks === "true",
    depositWatch: store || optIn.depositWatch === "true",
    solanaRails: store,
    feeLines: store,
    keyExport: store,
  }
}

export const CAP: Readonly<Capabilities> = Object.freeze(
  capabilitiesFor(ARC_EDITION, {
    ticks: process.env.NEXT_PUBLIC_ARC_TICKS,
    depositWatch: process.env.NEXT_PUBLIC_ARC_DEPOSIT_WATCH,
  }),
)
