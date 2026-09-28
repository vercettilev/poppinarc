/**
 * "Is this account brand new?", asked by the ONE screen that only new
 * accounts should ever see (the identity step after first sign-in).
 *
 * Why age and not the backend's `isNewUser` flag: login-or-create does
 * return it, but the extension signs in through the app.poppin.so/auth
 * bridge, and the bridge carries exactly one thing — the custom token.
 * The flag dies in the auth tab. Threading it through would couple an
 * extension release to a web deploy; the account's own birth timestamp
 * is already in every /users/me answer and says the same thing.
 *
 * The window is generous because the cost of each miss is asymmetric: a
 * new account judged old just skips one optional screen, while an old
 * account judged new gets a screen it was never meant to see. Sign-in to
 * routing is seconds; fifteen minutes absorbs any clock skew and the
 * slowest OAuth round trip without coming near "existing".
 */
export const NEWBORN_WINDOW_MS = 15 * 60 * 1000

export function isNewbornAccount(
  createdAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!createdAt) return false
  const born = Date.parse(createdAt)
  // Unparseable birthdate reads as existing: the safe miss (see above).
  if (Number.isNaN(born)) return false
  return now - born < NEWBORN_WINDOW_MS
}
