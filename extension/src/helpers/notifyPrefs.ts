/**
 * WHICH NOTIFICATIONS A READER ACTUALLY WANTS.
 *
 * Five kinds now leave this extension — an order filled, a price you asked
 * about, your own position moving, somebody you follow trading, the morning
 * digest — and until this file there was no way to turn any of them off. A
 * product that can only be silenced by uninstalling it gets uninstalled, and
 * a store reviewer reads an ungovernable notification permission the same
 * way.
 *
 * ── DEFAULT ON, AND WHY THAT IS NOT A TRICK ─────────────────────────────────
 * Every kind here was designed to be rare: fills speak once per fill, alerts
 * once per alert, moves once per ±10% with a re-anchor, the digest once a
 * morning. Something that rare is worth arriving by default, and each of them
 * is one switch away from silence. The honest test is whether a person who
 * turns one off stays turned off — which is why the CHECK lives at the moment
 * of sending, not at the moment of scheduling: a preference read once at
 * startup is a preference that ignores the switch somebody just flipped.
 *
 * ── `social` WAS THE ONE EXCEPTION, AND ITS CONDITION IS MET ────────────────
 * "People you follow" shipped DEFAULT OFF because social proof needs proof:
 * with the user base of the day, a reader who turned it on subscribed to an
 * empty room, and shipping it ON would have spent a permission warning to
 * deliver nothing. That was written down with an END CONDITION rather than
 * as a permanent cut — "turn it on when there is real activity to reflect" —
 * and the owner called it (2026-08-31). It is ON now, like every other kind.
 *
 * What keeps it from being noise is not the switch, it is followTrades'
 * rulebook: a $10 dust floor, one ping per asset per hour, and sells that
 * only speak to somebody who HOLDS the thing. Those are the reason this can
 * be on by default at all.
 */

export type NotifyKind = "move" | "social" | "digest"

export interface NotifyPrefs {
  move: boolean
  social: boolean
  digest: boolean
}

export const NOTIFY_PREFS_KEY = "poppin_notify_prefs"

export const NOTIFY_DEFAULTS: NotifyPrefs = {
  move: true,
  // ON since 2026-08-31 — the end condition in the header was met. The dust
  // floor, the per-asset cooldown and the holds-it rule are what make this
  // safe to arrive uninvited.
  social: true,
  digest: true,
}

export function readNotifyPrefs(stored: unknown): NotifyPrefs {
  const raw = (stored ?? {}) as Partial<Record<NotifyKind, unknown>>
  const of = (k: NotifyKind) =>
    typeof raw[k] === "boolean" ? (raw[k] as boolean) : NOTIFY_DEFAULTS[k]
  return {
    move: of("move"),
    social: of("social"),
    digest: of("digest"),
  }
}

export function shouldNotify(prefs: NotifyPrefs, kind: NotifyKind): boolean {
  return prefs[kind] === true
}

/**
 * THE SWITCHES: only the three kinds the product decided to send on its own.
 * Each is something a reasonable reader might say no to, which is the one
 * test a switch has to pass. Named for what happens, not for a category.
 */
export const NOTIFY_ROWS: Array<{
  kind: NotifyKind
  title: string
  description: string
}> = [
  {
    kind: "move",
    title: "Something I hold moves",
    // Watched assets ride this kind too (background injects the watchlist
    // into the same check), so the sentence says so rather than hiding it.
    // "Watch" is the word the chip and the strip use; the star was the
    // page card's, and the page card is off.
    description: "A 10% move on something you hold or watch.",
  },
  {
    kind: "social",
    title: "Someone I follow trades",
    description: "One ping per asset an hour, and never for pocket change.",
  },
  {
    kind: "digest",
    title: "Morning summary",
    description: "One line a day about your book.",
  },
]
