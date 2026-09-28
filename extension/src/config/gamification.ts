/**
 * The farm era's furniture, behind one switch.
 *
 * WHAT THIS GATES: the ditto (diamond) badge and the streak (fire) badge on
 * every post header. Both are scoreboards from the tasks/streaks/referral
 * system — the one the owner put in FLYWHEEL RESERVE: not ported to v2, not
 * deleted, and redesigned when trading goes public. They kept rendering in
 * the feed anyway, because the badges live in the post header rather than in
 * the tasks view that was set aside.
 *
 * WHY IT MATTERS BEYOND TIDINESS: poppin.so's language is calm and
 * typographic with exactly one accent. A feed where every author carries a
 * diamond count and a fire streak is speaking the opposite dialect — it is
 * the single loudest FOMO-era survivor in the panel, and no colour token
 * could quiet it.
 *
 * NOT GATED: the X badge. That is identity (a linked account), not a score,
 * and X is a flywheel channel we actively want visible.
 *
 * THE REVERT IS THIS FLAG:
 *
 *     NEXT_PUBLIC_FEED_GAMIFICATION=true  →  rebuild  →  badges are back
 *
 * Nothing was deleted: DittoBadge, StreakBadge and their queries are intact,
 * which is what makes the reserve a reserve.
 */
const flagOn = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined ? dflt : v === "true"

export const FEED_GAMIFICATION: boolean = flagOn(
  process.env.NEXT_PUBLIC_FEED_GAMIFICATION,
  false,
)
