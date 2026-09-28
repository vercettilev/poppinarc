/**
 * WHOSE PROFILE IS THIS — asked once, because the answer is what decides
 * whether the page is allowed a back arrow.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Your own profile drew a back arrow, and that arrow reserved a 32px band
 * above the avatar in order to point at nothing: you arrive at your own page
 * from the header's identity row (Header.tsx:838-844), and the header is
 * still on screen above it — that same row, and the Feed pill that is one tap
 * back to the feed (Header.tsx:717-724). Reported as the empty gutter above
 * the avatar, with "Edit profile" floating a line above the person it edits.
 *
 * ── THE RULE THIS FILE USED TO HOLD, AND WHY IT WAS WRONG ───────────────────
 * The first repair asked "was this screen PUSHED?" instead of "is this ME?",
 * on the theory that tapping your own face in the feed opens an overlay whose
 * only exit is the arrow. The predicate therefore answered "pushed" for every
 * entry that named an id — and your own id is named on the two commonest
 * doors in the product: PostHeader.tsx:105-111 (tapping an avatar) and
 * UserPopover.tsx:80-86 (tapping a name) both navigate with
 * `to: "ProfileDetailView"` and no self-check. Tap your own face on your own
 * post and the arrow and the 32px band came straight back on your own
 * profile. The reported defect survived its own fix, which is the whole
 * reason this file was rewritten rather than tuned.
 *
 * ── THE RULE NOW ────────────────────────────────────────────────────────────
 * The arrow is governed by WHOSE page is on screen, compared against the
 * signed-in reader. Your own profile never carries one, however you reached
 * it. Somebody else's always does, because that really is a pushed screen:
 * the ProfileDetailView overlay leaves the pathname at `/feed` while covering
 * the feed, so the arrow is the one control on it that plainly reads as the
 * way out.
 *
 * ── AND THE OVERLAY IS NOT A TRAP, BECAUSE IT NO LONGER OPENS ON YOU ────────
 * The exit worry behind the old rule was real, so it is answered at the door
 * rather than by leaving an arrow on your own page: views/ProfileDetailView
 * sends a reader whose overlay names themselves to the `/profile` tab
 * instead of drawing their own profile in a sheet over the hidden feed. Your
 * profile is only ever a destination. From it the header's Feed pill
 * (Header.tsx:717-724 → handleChange, Header.tsx:258-277) is one tap back to
 * the page feed — and it reads as a way out there, because that pill only
 * paints itself active on `/feed` (Header.tsx:601), which is exactly what an
 * own-profile overlay inside `/feed` used to make it lie about.
 */

/**
 * The two facts the answer needs. Kept as a named shape rather than two loose
 * arguments so a call site cannot silently pass them in the wrong order —
 * both are strings that look alike.
 */
export interface ProfileViewer {
  /**
   * Who the page resolved to show: the `targetId` chain in views/profile.tsx
   * (props → route param → username lookup → navigation state). Null or blank
   * on the bare `/profile` tab, which names nobody and therefore means you.
   */
  targetId?: string | null
  /** The signed-in reader — `useCurrentUser().data?.id`, absent when signed out. */
  currentUserId?: string | null
}

/**
 * True when the profile on screen belongs to the signed-in reader: no back
 * arrow, no reserved gutter, and "Edit profile" flush right on the username's
 * row.
 *
 * Two edges are deliberate, not accidents:
 *  - a blank `targetId` is nobody, and nobody means you — the bare `/profile`
 *    tab, plus the `location.state?.userId` that can arrive as `""`;
 *  - signed out, a NAMED profile is somebody else's. Without the
 *    `currentUserId` guard, `undefined === undefined` would call every
 *    stranger's page your own and take away the only way off it.
 */
export function isOwnProfileView({ targetId, currentUserId }: ProfileViewer): boolean {
  if (!targetId) return true
  return Boolean(currentUserId) && targetId === currentUserId
}
