/**
 * "Is this profile finished?" — asked in ONE place.
 *
 * ── THE LOOP THIS ENDS ──────────────────────────────────────────────────────
 * Reported as the panel flickering between "Pick a username" and the feed,
 * many times a second. Two screens answered this question differently and
 * each acted on its own answer:
 *
 *   App.tsx      : incomplete when display_name OR username is missing
 *                  → navigate("/create-profile")
 *   CreateProfile: nothing left to ask once username exists
 *                  → navigate("/")
 *
 * Both are reasonable in isolation. Together, an account with a username and
 * no display name is pushed to the form and bounced off it forever, at render
 * speed.
 *
 * ── WHY USERNAME IS THE WHOLE ANSWER ────────────────────────────────────────
 * Because it is the whole ASK. CreateProfileStep stopped asking for a display
 * name deliberately: its regex is Latin-only (/^[a-zA-Z0-9_\s]*$/), so
 * demanding one rejects exactly the people whose names carry diacritics
 * ("Uğur"). It is optional server-side and editable in settings. A gate that
 * blocks on a field no screen offers to fill is a gate with no key.
 *
 * So: the gate matches the form, and both import this. If the form ever asks
 * for more, this function changes and every caller follows.
 */
export interface GateableUser {
  username?: string | null
  display_name?: string | null
}

/** True when there is a signed-in user who still owes us a username. */
export function needsProfileSetup(user: GateableUser | null | undefined): boolean {
  return Boolean(user) && !user?.username
}

/** True when the profile is finished enough to act as an identity. */
export function hasUsableProfile(user: GateableUser | null | undefined): boolean {
  return Boolean(user?.username)
}
