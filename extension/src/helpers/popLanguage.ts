/**
 * WHAT THE PRODUCT CALLS THINGS WHEN MONEY IS MOVING.
 *
 * The rule, in one line: JARGON WHEN IT GOES WELL, LITERAL WHEN MONEY MOVES
 * OR SOMETHING BREAKS.
 *
 * So the controls stay "Buy" and "Sell" (never "Pop", never "Swap") because
 * a control is a promise about money and a promise wants no personality,
 * while the moment AFTER the press is ours: "Popping…", "Popped." A reader
 * who already committed does not need to be told again what a swap is.
 *
 * The vocabulary lives here rather than inline at each call site, because
 * every previous attempt to keep a tone consistent across a sheet, a card
 * and a history screen was a set of string literals that drifted apart
 * within weeks.
 *
 * TONE, and these are constraints rather than preferences:
 *  - No exclamation marks, no emoji. The one brand mark is the ghost, and
 *    the ghost is not in this file because the ghost is not language.
 *  - Sentence case for MESSAGES. Controls are labels, not sentences, so
 *    "Buy", "Sell" and "Deposit USDC" keep their capitals; a blanket
 *    sentence-case rule would rewrite every button for nothing.
 *  - Never a code, never a stack trace, never "error".
 */

/**
 * THE ERROR SENTENCE THIS FILE EXISTS TO GET RIGHT.
 *
 * "Didn't go through. Nothing was charged." is the right words and the
 * wrong promise in two of the four ways a trade can end, because settlement
 * has THREE outcomes and not two. `confirmAsset` answers
 * `confirmed | unknown | failed`, and its own contract says: "`unknown`
 * means we stopped waiting, NOT that it failed."
 *
 * So a swap can be in the air when we give up watching it, and if we tell
 * somebody nothing was charged while the transaction is still landing, we
 * have told them a lie about their money. That is the one lie a product
 * like this cannot afford, and it is not hypothetical: the panel already
 * distinguishes the case, which is why it used to say "settlement pending".
 *
 * The sentence is therefore earned rather than default. It is said ONLY
 * with positive evidence that nothing moved:
 *
 *   · the failure happened before a signature existed (nothing was ever
 *     broadcast), or
 *   · the chain itself reported the transaction failed.
 *
 * Every other ending gets a sentence that admits what we do not know.
 */
export type PopEnding =
  /** No signature was ever produced. Nothing left the building. */
  | "not-sent"
  /** The chain reported failure. Nothing settled. */
  | "chain-failed"
  /** Broadcast, and we stopped waiting for the answer. */
  | "pending"
  /** Broadcast, then we lost the thread. We do not know the outcome. */
  | "lost"

export const popCopy = {
  /** While it is in the air. */
  working: "Popping…",

  /** Done, and the amount belongs beside it. `Popped.` on its own is a
   *  mood; with the amount it is a receipt. */
  done: (amount: string) => `Popped ${amount}`,

  /** The dry run says so out loud rather than dressing up as a fill. */
  dryRun: "Dry run. Built and verified, nothing sent.",

  ending: (ending: PopEnding): string => {
    switch (ending) {
      case "not-sent":
      case "chain-failed":
        // The only two endings where "nothing was charged" is a fact.
        return "Didn't go through. Nothing was charged."
      case "pending":
        // True and useful: it is out of our hands, not out of existence.
        return "Still settling. Your history will show it when it lands."
      case "lost":
        /* The honest sentence nobody wants to write. Retrying blind is how
           somebody buys twice, so the copy points at the one place that
           can answer instead of inviting a second press. */
        return "Sent, but we lost track of it. Check your history before trying again."
    }
  },

  /** Empty balance. "Deposit USDC" and not "Add funds": USDC is the unit
   *  everywhere in this product, and the panel's own empty state already
   *  says deposit. Two names for one act is how a surface stops being
   *  trusted. */
  noBalance: "No balance yet.",
  noBalanceAction: "Deposit USDC",

  /** History. Every pop knows the post it came from, which no other
   *  trading app can say, so the screen is named after them.
   *
   *  This is also the wallet's third tab (views/wallet-ui.tsx), which
   *  used to type the two words inline while this constant sat unread —
   *  the precise drift the header of this file was written to prevent.
   *  Two words, and they must not be shortened to make a row fit: that
   *  rail takes a second line instead (wallet-ui.tsx sets flexWrap:"wrap"
   *  on it, and wallet-tabs.spec.ts forbids scrolling it). */
  historyTitle: "Your pops",
  from: (handle: string) => `Popped from @${handle.replace(/^@/, "")}`,
} as const

/**
 * The @handle inside a stored source_url, or null.
 *
 * Null is a real answer: a trade made from the panel rather than from a
 * post has no author, and inventing one would attribute somebody's own
 * decision to a stranger.
 */
export const handleOfSource = (sourceUrl: string | null | undefined): string | null => {
  if (!sourceUrl) return null
  const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\//i.exec(sourceUrl)
  const handle = m?.[1]
  if (!handle) return null
  // "i" and "home" are X's own paths, not people.
  if (/^(i|home|search|explore|notifications)$/i.test(handle)) return null
  return handle
}
