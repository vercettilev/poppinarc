import { MIN_ORDER_USD } from "./orderMath"
import { PRESET_USD } from "./tradeMath"

/**
 * THE CLIP — the size the reader last actually bought, remembered so the
 * resting chip can say what a press will do BEFORE it is pressed.
 *
 * Today the button says "Buy" and the amount is invisible until a sheet
 * opens, where it silently defaults to PRESET_USD[1] ($25). So the one fact
 * that decides how much money moves is the one fact the reader cannot see
 * from the feed. "Buy $25" on the resting pill is strictly more disclosure
 * than "Buy", and that is the whole reason this exists — the speed is a
 * side effect, not the argument.
 *
 * IT IS A MEMORY, NOT A SETTING. Nothing configures it; whatever a buy last
 * SUCCEEDED with becomes it. A setting is a thing to get wrong in advance;
 * a memory can only ever repeat what somebody already chose to do.
 *
 * CLAMPED, and the clamp is the safety. A fraction pick (25% / 50% / Max of
 * the balance) can be far larger than any preset, and remembering one would
 * turn a one-off decision into a standing default that grows with the
 * account. The ceiling is the largest preset; the floor is the minimum the
 * order engine accepts, so a remembered clip can never arm a button that
 * will be refused.
 */

export const CLIP_KEY = "poppin_clip"

export interface Clip {
  /** Dollars for a buy. */
  usd: number
  /** Percent of the position for a sell. */
  sellPct: number
}

export const DEFAULT_CLIP: Clip = { usd: PRESET_USD[1], sellPct: 100 }

/** The largest a remembered buy may be — the biggest preset, never a Max. */
export const CLIP_MAX_USD = PRESET_USD[PRESET_USD.length - 1]

export function clampClipUsd(usd: number): number {
  if (!Number.isFinite(usd)) return DEFAULT_CLIP.usd
  return Math.min(CLIP_MAX_USD, Math.max(MIN_ORDER_USD, Math.round(usd)))
}

export function clampSellPct(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_CLIP.sellPct
  return Math.min(100, Math.max(1, Math.round(pct)))
}

/** Read a stored value into a clip, filling anything absent or absurd. */
export function readClip(raw: unknown): Clip {
  const o = (raw ?? {}) as Partial<Clip>
  return {
    usd: clampClipUsd(typeof o.usd === "number" ? o.usd : DEFAULT_CLIP.usd),
    sellPct: clampSellPct(
      typeof o.sellPct === "number" ? o.sellPct : DEFAULT_CLIP.sellPct,
    ),
  }
}
