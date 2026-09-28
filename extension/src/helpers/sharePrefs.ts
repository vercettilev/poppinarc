/**
 * WHAT POPPIN POSTS ON THE READER'S BEHALF.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────
 * A standing order fills while the reader is asleep. Every other trade in
 * this product reaches the feed through a Share button pressed by a person
 * who just watched their money move; a filled order has no such moment —
 * by the time anybody sees it, it is hours old and the button is gone. So
 * the one trade that CANNOT be shared by hand is the one this decides.
 *
 * ── WHY IT DEFAULTS **ON** ──────────────────────────────────────────────
 * The first version shipped this off, behind a switch in Settings, and the
 * owner was right to throw it out: "anlaşılması bulması zor bir setting
 * gibi. Biz ürünü hypercasual yönünde değiştirmek istiyoruz." A default
 * that only the people who go hunting through Settings ever get is not a
 * feature, it is a footnote — and in a product whose entire feed IS
 * people's trades, the trade that filled overnight is exactly the content
 * the feed exists for.
 *
 * The safety is not the default, it is the SHAPE: the fill's own
 * notification says the post went out, tapping it lands on the post with
 * an Undo that deletes it, and the switch below turns it off forever in
 * one press. Act, say so, offer the reversal — rather than ask first and
 * bury the question where nobody looks.
 */

export interface SharePrefs {
  /** Post a standing order to the feed when it fills. */
  fills: boolean
}

export const SHARE_PREFS_KEY = "poppin_share_prefs"

export const SHARE_DEFAULTS: SharePrefs = {
  // ON. See the header: a default nobody finds is not a feature.
  fills: true,
}

/**
 * Stored preferences are a partial from an older build or nothing at all.
 * A missing key falls back to the DEFAULT, so a reader who has never
 * touched this shares — and a reader who turned it OFF stays off, because
 * only a real boolean false can have come from them pressing it.
 */
export function readSharePrefs(stored: unknown): SharePrefs {
  const raw = (stored ?? {}) as Partial<Record<keyof SharePrefs, unknown>>
  return {
    fills: typeof raw.fills === "boolean" ? raw.fills : SHARE_DEFAULTS.fills,
  }
}

/** The switch, in the reader's words. */
export const SHARE_ROWS: Array<{
  kind: keyof SharePrefs
  title: string
  description: string
}> = [
  {
    kind: "fills",
    title: "Post my filled orders",
    description:
      "When a standing order fills, it goes to your feed automatically. You can undo any of them from the fill itself.",
  },
]
