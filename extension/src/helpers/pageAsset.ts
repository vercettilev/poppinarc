/**
 * WHICH PAGES CAN ANSWER "WHAT IS THIS PAGE ABOUT?".
 *
 * The panel's front door asks the page for its asset and holds a skeleton
 * in the top slot until it answers. Measured, x.com never answers: the
 * home feed is not about one asset and a tweet's asset arrives from the
 * chip that opened the panel, not from the page. So on X the slot is not
 * asked for at all, and the skeleton that greeted every fresh account
 * over "Positions" is gone. Everywhere else the question stands.
 */
const NEVER = [/(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i]

export function pageCanCarryAsset(url: string | null | undefined): boolean {
  if (!url) return false
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  return !NEVER.some((re) => re.test(host))
}
