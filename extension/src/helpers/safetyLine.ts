/**
 * A WRAPPED TOKEN'S MARKET CAP IS NOT ITS MARKET CAP.
 *
 * Reported from the field on WBTC, which showed "$196.1M MC" beside a
 * Bitcoin price. Nothing was computed wrong: Jupiter reports the cap of
 * the SOLANA mint, and that is genuinely the value of the wrapped supply
 * on this chain. It just is not the number the words "market cap" promise
 * a reader, and sitting next to the risk facts it read as "small, be
 * careful" about wrapped Bitcoin.
 *
 * The catalog already knows which tokens these are — issuer 'wormhole' is
 * documented there as "Portal-wrapped collateral (WBTC, ETH), the reader's
 * real counterparty is the bridge holding the underlying". For those, the
 * figure is suppressed rather than relabelled: we do not hold the
 * underlying asset's cap, and inventing a qualifier for a number nobody
 * asked for is the info dump this line is being cut down for.
 */
/**
 * A MINT THAT IS A CLAIM ON SOMETHING HELD ELSEWHERE.
 *
 * These issuers do not create the asset, they wrap it: xStocks and Backpack
 * mint against custodied shares, Ondo and Tether against metal, wormhole
 * and bridged against a token on another chain. For all of them the mint's
 * own numbers describe the WRAPPER and not the thing a reader is buying,
 * and that makes two of the chip's lines actively misleading:
 *
 *  · MARKET CAP. Apple is worth three trillion dollars. The AAPLx mint
 *    holds fifty million dollars of it. Printing "$51M MC" under the word
 *    Apple is a true number answering a question nobody asked, in a place
 *    where every reader will take it as Apple's size.
 *
 *  · MINT AND FREEZE AUTHORITY. On a memecoin, a retained mint authority
 *    is the single most useful warning there is: the person who made it can
 *    still print more. On a tokenized share it is how the instrument WORKS
 *    — the issuer mints when it takes custody of a share and must be able
 *    to freeze for compliance. Measured on the live AAPLx mint: both
 *    retained, both expected, and the chip rendered them as "mint open ·
 *    can freeze" next to an Apple headline, which reads as a rug warning.
 *
 * A true fact rendered as a false signal is worse than no fact. So for
 * these issuers the chip says neither, and the memecoin case, where both
 * genuinely protect the reader, is untouched.
 */
const WRAPPED_ISSUERS: ReadonlySet<string> = new Set([
  "xstocks",
  "backpack-securities",
  "prestocks",
  "ondo",
  "tether",
  "wormhole",
  "bridged",
])

export const wrapsSomethingElse = (issuer: string | null | undefined): boolean =>
  typeof issuer === "string" && WRAPPED_ISSUERS.has(issuer)

export const capIsMeaningful = (issuer: string | null | undefined): boolean =>
  !wrapsSomethingElse(issuer)

/**
 * THE GATE'S EVIDENCE, SAID OUT LOUD — one small line under the amount.
 *
 * Every open mint that reaches a sheet already passed the trade gate, which
 * read the pool's liquidity, its age, the holder count and the mint's
 * authorities — and then told the reader none of it. A degen deciding size
 * asks exactly these three numbers first ("LP ne kadar, kaç günlük, kaç
 * holder"), and today they alt-tab to a screener to learn what our own
 * server already knew.
 *
 * The words are the degen's own vocabulary on purpose — "LP", "holders",
 * "mint open" — because this row's readers taught them to us, and a gentler
 * paraphrase would read as marketing where a number was expected.
 *
 * RULES OF HONESTY, same family as the rest of the surface:
 * · A null field says NOTHING. Absent evidence is not "0 holders" and it is
 *   not "locked" — silence over either lie.
 * · All fields null → no line at all (`null`), never an empty shell.
 * · `warn` is true only for a fact that changes the risk NOW: a retained
 *   mint authority (the issuer can print) or a retained freeze authority
 *   (the issuer can take). Thin liquidity and young pools stay neutral ink —
 *   the gate already enforced the floors, and a second verdict in colour
 *   would be two governors for one door.
 * · "mint locked" is only said when Ultra POSITIVELY answered false; a
 *   reassurance derived from a missing field would be the exact lie the
 *   ticker cache used to tell about failures.
 */
export interface SafetyFacts {
  liquidityUsd?: number | null
  poolCreatedAtMs?: number | null
  mintAuthorityRetained?: boolean | null
  freezeAuthorityRetained?: boolean | null
}

/** $1,234,567 → "$1.2M" — one decimal under ten, none above. */
export const compactMoney = (usd: number): string => {
  const abs = Math.abs(usd)
  const one = (v: number) => (v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v).toString())
  if (abs >= 1_000_000_000) return `$${one(usd / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `$${one(usd / 1_000_000)}M`
  if (abs >= 1_000) return `$${one(usd / 1_000)}K`
  return `$${Math.round(usd)}`
}

/** 1.2M / 340K / 87 — the way every count on these surfaces is said. */
export const compactCount = (n: number): string => {
  const one = (v: number) => (v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v).toString())
  if (n >= 1_000_000) return `${one(n / 1_000_000)}M`
  if (n >= 1_000) return `${one(n / 1_000)}K`
  return String(n)
}

/**
 * Pool age, SAID rather than abbreviated. "3d" is a column header's unit;
 * "3 days old" is what a person asking "how new is this?" gets back. Clock
 * skew clamps to "brand new".
 */
const ageText = (createdAtMs: number, nowMs: number): string => {
  const h = Math.floor((nowMs - createdAtMs) / 3_600_000)
  if (h < 1) return "brand new"
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} old`
  const d = Math.floor(h / 24)
  if (d < 365) return `${d} day${d === 1 ? "" : "s"} old`
  const y = Math.floor(d / 365)
  return `${y} year${y === 1 ? "" : "s"} old`
}

export function safetyLine(
  facts: SafetyFacts | null | undefined,
  holderCount?: number | null,
  now: number = Date.now(),
): { text: string; warn: boolean } | null {
  if (!facts) return null
  const parts: string[] = []
  let warn = false
  /**
   * FOUR FACTS BECAME ONE WARNING.
   *
   * This line said liquidity AND age AND holders AND mint status, in the
   * degen's own vocabulary, all in orange, under the amount. Read back
   * from the field: an info dump, a long way from the rest of the surface.
   * Every number in it was true and the whole was still wrong — a reader
   * sizing a $25 buy is not auditing a pool.
   *
   * What SURVIVES is the part that is not information. A retained mint
   * authority means the issuer can print more; a retained freeze authority
   * means the issuer can take yours. Those are the two facts that change
   * what a press does, and they were the only ones that ever set `warn`.
   * The gate already enforced floors on liquidity and age, so those three
   * were a second opinion nobody asked for — which is precisely what the
   * rule at the top of this file says colour is not for.
   *
   * They are not deleted, they are unspoken here: same enrich, same
   * fields, still on the token's own room where somebody who wants to
   * audit a pool has gone looking for exactly that.
   */
  if (facts.mintAuthorityRetained === true) {
    parts.push("mint open")
    warn = true
  }
  // "mint locked" is a reassurance, not a warning, and a reassurance is
  // information. It goes with the rest of the dump.
  if (facts.freezeAuthorityRetained === true) {
    parts.push("can freeze")
    warn = true
  }
  if (parts.length === 0) return null
  return { text: parts.join(" · "), warn }
}
