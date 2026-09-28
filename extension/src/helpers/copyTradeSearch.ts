/**
 * Turn a prediction-market question/title into a query the catalog search
 * APIs (Polymarket Gamma, Kalshi/dFlow, Jupiter) actually match.
 *
 * A full question like "Will Donald Trump visit Iran?" returns nothing on a
 * keyword search — the lead-in verb, the trailing date qualifier and the "?"
 * are all noise. Strip them down to the topical core ("Donald Trump visit
 * Iran") so the copy-trade hand-off can find the market.
 */
export function cleanCopySearchQuery(raw?: string | null): string {
  if (!raw) return ""
  const original = String(raw).trim()
  let s = original
  // Drop a leading interrogative / auxiliary so we search the subject.
  s = s.replace(
    /^(will|who|whom|what|whats|what's|which|whose|does|do|did|is|are|was|were|should|can|could|would|has|have|had)\s+/i,
    "",
  )
  // Drop a trailing date / deadline qualifier: "by June 30", "before 2027",
  // "in 2026", "after the election", "this month", etc.
  s = s.replace(/\s+(by|before|in|after|on)\s+\S.*$/i, "")
  s = s.replace(/\s+(this|next|by)\s+(month|week|year|quarter)\b.*$/i, "")
  // Drop trailing punctuation.
  s = s.replace(/[?.!,;:]+\s*$/g, "").trim()
  // If we over-stripped, fall back to the original minus the trailing "?".
  if (s.length < 3) return original.replace(/[?]+\s*$/, "").trim()
  return s
}
