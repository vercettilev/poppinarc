/**
 * SOCIAL PROOF, COUNTED FROM RECEIPTS.
 *
 * The card under a tweet has always said how many people are TALKING and
 * never how many people BOUGHT — on a trading product, the one number that
 * actually moves a reader. The data was already on the client: every trade
 * share is a page post flagged `on_chain`, with the author and the side
 * parsed out. Nothing new is fetched for this; it is a count over what the
 * surfaces load anyway.
 *
 * Distinct AUTHORS, not posts: one person sharing three buys is one person,
 * and "3 bought" over one enthusiast is the kind of inflation a reader
 * eventually catches — after which no number on the surface is believed.
 *
 * The surfaces show buyers: "12 bought from this tweet" is a true, checkable
 * sentence — the receipts are in the conversation right below it.
 */

export interface ProofPost {
  authorId: string
  isTrade?: boolean
  side?: "buy" | "sell" | null
}

export function countTradeProof(posts: readonly ProofPost[]): { buyers: number } {
  const buyers = new Set<string>()
  for (const p of posts) {
    if (!p.isTrade) continue
    if (p.side === "buy") buyers.add(p.authorId)
  }
  return { buyers: buyers.size }
}

/** The sentence. Empty when there is nothing true to say. */
export function proofText(buyers: number): string {
  if (buyers <= 0) return ""
  return `${buyers} bought from this tweet`
}
