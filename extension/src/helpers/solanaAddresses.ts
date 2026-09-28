/**
 * SOLANA ADDRESSES IN A TWEET, the way memecoins are actually shared.
 *
 * A launch is posted as "CA: 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"
 * far more often than as a cashtag, and a cashtag is a name anybody can
 * take while an address is the token itself. The chip read cashtags, dollar
 * tickers, handles, names and context, and never the address (checked
 * 2026-09-27), so a tweet made of nothing but a CA got no chip.
 *
 * This only FINDS candidates. A wallet, a pool and a mint are the same 32
 * bytes in the same alphabet, so nothing here can tell them apart; the
 * server's by-mint gate does, and anything it declines leaves the tweet on
 * the path it had before.
 *
 * A run of 32 to 44 base58 characters, bounded by characters outside the
 * alphabet (so a path segment like pump.fun/coin/<mint> counts, and an 88
 * character signature does not). It must mix digits, capitals and small
 * letters: a random address of this length lacks one of them with odds
 * well under one in a thousand, while a long word or tag lacks them all.
 */
const RUN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g

export function solanaAddressesIn(text: string, max = 2): string[] {
  const out: string[] = []
  for (const m of text.matchAll(RUN)) {
    const s = m[0]
    if (!/[0-9]/.test(s) || !/[A-Z]/.test(s) || !/[a-z]/.test(s)) continue
    if (!out.includes(s)) out.push(s)
    if (out.length >= max) break
  }
  return out
}
