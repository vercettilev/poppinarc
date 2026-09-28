/**
 * MOVEMENT IS THE EVENT. A RANK IS NOT.
 *
 * A badge showing your place is wallpaper: it is true all day, so it says
 * nothing on any particular day. What a person actually reacts to is
 * having PASSED somebody — a change, with a direction, that happened while
 * they were not looking.
 *
 * So this is deliberately not "you are #7". It is "you passed 3 people",
 * and only when that is true.
 *
 * ── THE RULES, WHICH ARE MOSTLY ABOUT STAYING QUIET ─────────────────────
 *
 * UP ONLY. Being told you dropped four places is a punishment for opening
 * an app, and it is the note most likely to make somebody close it for
 * good. The board still shows the truth in both directions; only the
 * interruption is one-way.
 *
 * A FIRST SIGHTING IS NOT A CLIMB. With nothing stored, we do not know
 * whether #7 is a rise or a fall, and "you passed 6 people" to somebody
 * who has always been seventh is a lie that flatters. The first read seeds
 * and says nothing.
 *
 * ONE A DAY AT MOST. Ranks jitter as other people trade; a notification
 * per jitter is the orbiting attention-grab this product removed once.
 *
 * AND NOT FOR A SINGLE PLACE. Passing one person is noise on a board that
 * moves on its own. Two is the floor for a sentence worth reading.
 */
export interface RankMemory {
  /** The last rank we told them about, or seeded silently. */
  rank: number
  /** When we last SPOKE, not when we last looked. */
  spokeAt: number
}

export const RANK_MEMORY_KEY = "poppin_rank_memory"
const MIN_CLIMB = 2
const QUIET_MS = 24 * 60 * 60 * 1000

export interface RankVerdict {
  /** What to store, always — silence still updates what we know. */
  memory: RankMemory
  /** The line to show, or null to stay quiet. */
  say: string | null
}

export function rankMove(
  now: number,
  rank: number | null,
  prev: RankMemory | null,
): RankVerdict | null {
  // No rank is not a rank of nothing: an unranked reader has nothing to
  // have moved.
  if (rank === null || !Number.isFinite(rank) || rank < 1) return null;

  if (!prev) {
    // Seed and say nothing — see "a first sighting is not a climb".
    return { memory: { rank, spokeAt: 0 }, say: null }
  }

  const climbed = prev.rank - rank
  const quiet = now - prev.spokeAt < QUIET_MS

  if (climbed < MIN_CLIMB || quiet) {
    // Remember the new position either way. A drop that goes unspoken must
    // still move the baseline, or the next small climb gets measured
    // against a place they no longer hold and reads as bigger than it was.
    return { memory: { rank, spokeAt: prev.spokeAt }, say: null }
  }

  const people = climbed === 1 ? "1 person" : `${climbed} people`
  return {
    memory: { rank, spokeAt: now },
    say: `You passed ${people} — now #${rank}`,
  }
}
