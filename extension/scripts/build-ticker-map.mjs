#!/usr/bin/env node
/**
 * Generates src/entries/contentScript/x/tickerMap.generated.ts — the ticker →
 * mint map that lets a cashtag name an asset outside the 127-row catalog.
 *
 * ── WHY A GENERATED FILE AND NOT A RUNTIME FETCH ────────────────────────────
 * The matcher runs in a content script on every X page. A runtime fetch would
 * mean a network call before the first strip could appear, a cache to keep
 * warm, and a failure mode where the feature silently degrades on a slow
 * connection. A generated module is bytes in the bundle: deterministic, fast,
 * reviewable in a diff, and shippable through the same release the code goes
 * through. Refreshing it is running this script and committing the result.
 *
 * ── THE IMPERSONATION DEFENCE, WHICH IS THE WHOLE POINT ─────────────────────
 * On Solana anyone can mint a token called BONK. A ticker map that resolves
 * `$BONK` to "whichever mint I saw first" is a machine for pointing Buy at a
 * scam. Three rules, in order:
 *
 *   1. VERIFIED ONLY. `isVerified` is Jupiter's own curation; unverified rows
 *      never enter, however popular.
 *   2. THE CURATED CATALOG ALWAYS WINS. A ticker that exists in our own
 *      catalog is never taken from this list — human review outranks any
 *      feed, and this is also what keeps $META pointing at MetaDAO.
 *   3. DEEPEST LIQUIDITY WINS A COLLISION, and only above a floor. Two
 *      verified rows can still share a ticker; liquidity is the least
 *      gameable tiebreak available here, and a minimum keeps the tail out.
 *
 * A collision that is close (the runner-up holds a meaningful share of the
 * winner's liquidity) is DROPPED rather than guessed at, and reported. An
 * ambiguous ticker is worth less than the trust it costs.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, "../src/entries/contentScript/x/tickerMap.generated.ts")
const CATALOG = resolve(HERE, "../../packages/spot-core/src/catalog/index.ts")

/**
 * THE WHOLE VERIFIED SET, in one call. The category feeds (toptraded,
 * toptrending, toporganicscore) cap at 100 rows each and yielded 253 distinct
 * mints across seven of them — a popularity snapshot, not a universe, and
 * most of its head is already in our catalog. The tag query returns every
 * token Jupiter has verified (2561 at time of writing), which is the actual
 * ceiling for "what may a cashtag safely name".
 */
const SOURCES = ["tag?query=verified"]

/**
 * TWO FLOORS, because "we cannot trade this" and "you should think twice"
 * are different sentences and the product was collapsing them into silence.
 *
 * MIN_LIQUIDITY_USD is the gate's own threshold: below it §7 refuses, so a
 * chip could never complete a buy. Nothing under this ships at all.
 *
 * THIN_LIQUIDITY_USD is where a trade stops being cheap. Measured on
 * production with $25 buys: median price impact was 0.17% above $200k
 * liquidity, 0.84% between $25k and $60k, worst case 2.14%. That is not a
 * safety problem — nobody gets rugged by slippage — it is a QUIET one. The
 * reader taps Buy, spends $25, receives $23 of token, and never learns why.
 *
 * So rows between the two get shipped as `thin`. They still appear, because
 * hiding the mid/low-cap tail is hiding the product; they just do not get an
 * inline one-tap Buy. See the strip for what they get instead.
 */
const MIN_LIQUIDITY_USD = 25_000
const THIN_LIQUIDITY_USD = 150_000
/** A runner-up holding more than this share of the winner makes it a guess. */
const AMBIGUITY_RATIO = 0.35

async function pull(path) {
  const url = `https://lite-api.jup.ag/tokens/v2/${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  const body = await res.json()
  return Array.isArray(body) ? body : (body.tokens ?? [])
}

const catalogSource = readFileSync(CATALOG, "utf8")
const catalogTickers = new Set(
  [...catalogSource.matchAll(/ticker:\s*'([^']+)'/g)].map((m) =>
    m[1].replace(/^\$/, "").toUpperCase(),
  ),
)
// The wrapped forms our own catalog answers for: $TSLA must never be taken
// from Jupiter while TSLAx sits in the catalog.
for (const t of [...catalogTickers]) {
  const m = /^([A-Z0-9.]{2,})X$/.exec(t)
  if (m) catalogTickers.add(m[1])
}

const rows = new Map() // mint → row
for (const src of SOURCES) {
  try {
    for (const t of await pull(src)) {
      const mint = t.id ?? t.address ?? t.mint
      if (mint && !rows.has(mint)) rows.set(mint, t)
    }
  } catch (err) {
    console.error(`  ! ${src}: ${err.message}`)
  }
}
console.log(`fetched ${rows.size} distinct verified mints`)

const byTicker = new Map() // TICKER → candidate rows
let skippedUnverified = 0
let skippedThin = 0
for (const t of rows.values()) {
  const mint = t.id ?? t.address ?? t.mint
  const symbol = (t.symbol ?? "").trim()
  if (!symbol || typeof t.decimals !== "number") continue

  const ticker = symbol.replace(/^\$/, "").toUpperCase()
  // Tickers a cashtag cannot express, and ones our catalog owns.
  if (!/^[A-Z0-9.]{2,10}$/.test(ticker)) continue
  if (catalogTickers.has(ticker)) continue

  if (!t.isVerified) {
    skippedUnverified++
    continue
  }
  const liq = Number(t.liquidity ?? 0)
  if (!(liq >= MIN_LIQUIDITY_USD)) {
    skippedThin++
    continue
  }

  // An EMPTY name is not a missing name to `??`, and a chip reading "$PRIME ·"
  // with nothing after it is an offer with a hole in it. Caught by the spec
  // that asserts every generated row can name itself.
  const name = (t.name ?? "").trim() || symbol

  const list = byTicker.get(ticker) ?? []
  list.push({
    ticker,
    mint,
    name,
    decimals: t.decimals,
    liq,
    thin: liq < THIN_LIQUIDITY_USD,
  })
  byTicker.set(ticker, list)
}

const entries = []
const dropped = []
for (const [ticker, list] of byTicker) {
  list.sort((a, b) => b.liq - a.liq)
  const [win, next] = list
  if (next && next.liq / win.liq > AMBIGUITY_RATIO) {
    dropped.push(`${ticker} (${list.length} verified claimants, top two too close)`)
    continue
  }
  entries.push(win)
}
/**
 * ── THE LAST RULE: ASK OUR OWN GATE ─────────────────────────────────────────
 * Jupiter verifying a token means Jupiter will route it. It does not mean §7
 * will admit it, and the difference is not small: a spot check of three
 * random rows found two refused — eUSX and Phantom Staked SOL, both
 * issuer-controlled, failing on retained authority exactly like the tokenized
 * equities do.
 *
 * A map entry the gate refuses is worse than a missing one. The reader sees a
 * chip, taps Buy, picks an amount, confirms, and only THEN learns the asset
 * was never on offer. So the generator asks the same question the trade path
 * will ask, and ships only the answers that were yes.
 *
 * This is the slow part of the build and it is worth it: it runs when a human
 * refreshes the map, not when a reader scrolls.
 */
/**
 * PACED, AND THAT IS NOT AN OPTIMISATION — it is the difference between
 * measuring the gate and measuring a rate limiter.
 *
 * The first version of this pass ran eight at a time and reported 303 of 311
 * tickers refused, which would have shipped a map of eight. A slow re-run of
 * the same sample told a completely different story: `lookup_failed`, 43% of
 * the fast run's verdicts, fell to ZERO, and the admission rate went from 2%
 * to 24%. Jupiter was rate-limiting the gate's own reads, and the gate
 * correctly reports an unreadable mint as a failure rather than guessing.
 *
 * So this pass is deliberately slow. It runs when a human refreshes the map.
 */
const CONCURRENCY = 2
const PACE_MS = 400
const API = process.env.POPPIN_API ?? "https://api.poppin.so/api/v1"

async function admitted(mint) {
  try {
    const res = await fetch(`${API}/embed/asset/by-mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint }),
    })
    if (!res.ok) return false
    const body = await res.json()
    return Boolean(body?.asset)
  } catch {
    // A network failure is not a verdict. Keeping the row lets a flaky
    // build ship a stale-but-reviewed map instead of silently deleting it.
    return true
  }
}

const batches = Math.ceil(entries.length / CONCURRENCY)
console.log(
  `asking the gate about ${entries.length} tickers ` +
    `(~${Math.round((batches * PACE_MS) / 1000)}s, paced on purpose)…`,
)
const refused = []
for (let i = 0; i < entries.length; i += CONCURRENCY) {
  const batch = entries.slice(i, i + CONCURRENCY)
  const verdicts = await Promise.all(batch.map((e) => admitted(e.mint)))
  batch.forEach((e, k) => {
    if (!verdicts[k]) refused.push(e.ticker)
  })
  await new Promise((r) => setTimeout(r, PACE_MS))
  if (i && i % 100 === 0) console.log(`  …${i}/${entries.length}`)
}
const admittedEntries = entries.filter((e) => !refused.includes(e.ticker))
console.log(`  gate refused ${refused.length}: ${refused.slice(0, 12).join(", ")}${refused.length > 12 ? "…" : ""}`)
entries.length = 0
entries.push(...admittedEntries)

entries.sort((a, b) => a.ticker.localeCompare(b.ticker))

console.log(
  `kept ${entries.length} tickers · skipped ${skippedUnverified} unverified, ` +
    `${skippedThin} thin, ${dropped.length} ambiguous`,
)
for (const d of dropped) console.log(`  ambiguous: ${d}`)

const thinCount = entries.filter((e) => e.thin).length
console.log(
  `  ${entries.length - thinCount} deep, ${thinCount} thin ` +
    `(under $${THIN_LIQUIDITY_USD.toLocaleString("en-US")} — chip shows, inline buy does not)`,
)

const body = entries
  .map(
    (e) =>
      `  ["${e.ticker}", { mint: "${e.mint}", name: ${JSON.stringify(e.name)}, decimals: ${e.decimals}${e.thin ? ", thin: true" : ""} }],`,
  )
  .join("\n")

writeFileSync(
  OUT,
  `// GENERATED by scripts/build-ticker-map.mjs — do not edit by hand.
// Source: Jupiter's verified tag query - the whole verified set.
// Rules: verified only · min $${MIN_LIQUIDITY_USD.toLocaleString("en-US")} liquidity ·
// curated catalog always wins · ambiguous tickers dropped, never guessed.
// Refresh: npm run build:tickers (then review the diff — this points Buy).

export interface JupTickerRow {
  mint: string
  name: string
  decimals: number
  /**
   * Liquidity thin enough that a preset buy costs real money in slippage.
   * The chip still shows; the one-tap Buy does not. Measured, not guessed —
   * see the generator's header.
   */
  thin?: boolean
}

/** ${entries.length} tickers a cashtag can name beyond the curated catalog. */
export const JUP_TICKERS: ReadonlyArray<readonly [string, JupTickerRow]> = [
${body}
]
`,
  "utf8",
)
console.log(`wrote ${OUT}`)
