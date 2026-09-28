/**
 * ROUTES THAT ARE NOT ABOUT THE PAGE.
 *
 * The header carries the feed's doors: the Global Feed button, the
 * "Feed" pill with the page's post count, the site's live pill. They
 * belong over the front door and the feed, where the page is the
 * subject. Over Settings, the leaderboard or a token room they were
 * still there, so the word "Feed" sat in the middle of a screen titled
 * Settings and read as its title. On these routes the header offers
 * the way back instead and leaves the screen's own title alone.
 */
const QUIET = [
  "/settings",
  "/flywheel",
  "/referral",
  "/callers",
  "/discover",
  "/wallet-ui",
  "/edit-profile",
  "/profile",
  "/token",
  "/receive",
] as const

export function isQuietRoute(pathname: string): boolean {
  return QUIET.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
