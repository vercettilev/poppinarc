/**
 * R1 — SITE CHAT IS KEYED BY WEBSITE, NOT BY PAGE. Every subpage of x.com
 * counts toward x.com.
 *
 * ── THIS FILE IS A MIRROR, NOT A SOURCE ─────────────────────────────────────
 * The authority is apps/backend/src/site-chat/canonical-host.ts:56, which runs
 * on EVERY entry point (ping, hello, join, post, history, the HTTP presence
 * read) before anything touches Redis or Postgres. A client that skips its own
 * copy, or gets it wrong, cannot split a room — the server never trusts the
 * string it was handed.
 *
 * So what is this for? Three things, none of them authority:
 *   1. Rendering the room's TITLE before the server has answered.
 *   2. Refusing to open a socket for a page that can never have a room
 *      (chrome://, an IP, a bare "localhost"), so we do not connect on every
 *      new tab just to be told `bad_host`.
 *   3. Keying client state per host, so a reply that arrives after the reader
 *      has moved to another site is dropped instead of rendered.
 *
 * DRIFT IS THE ONLY REAL RISK, and siteChatHost.spec.ts guards it by READING
 * the backend file and asserting our folding rules are the same text — the way
 * this repo already hand-syncs components/chipActStyle.ts against
 * components/SpotCard/style.ts. If you change a rule here, change it there in
 * the same edit, or the spec fails.
 *
 * WHAT IT FOLDS
 *  - lowercase, one optional trailing root dot removed ("x.com." = "x.com").
 *  - a leading "www.", "m." or "mobile." is stripped, repeatedly, so
 *    "www.m.x.com", "m.x.com" and "X.COM" are all one room.
 *  - a strip that would leave a SINGLE label is refused, so the real site
 *    m.com stays m.com instead of collapsing to the meaningless "com".
 *  - NO public-suffix-list registrable-domain folding. github.io, blogspot.com
 *    and every SaaS subdomain would collapse into ONE chat room. Subdomains
 *    stay separate rooms on purpose. (psl IS a dependency of this extension —
 *    do not reach for it here.)
 *
 * WHAT IT REJECTS (returns null — the server would answer "bad_host"):
 * non-strings, empty, over 253 chars, anything that is not a plain ASCII
 * hostname (a URL, a port, a path, whitespace, an underscore, a non-ASCII IDN
 * — Chrome's location.hostname already hands us punycode), single-label hosts
 * ("localhost"), and bare IP literals.
 *
 * THERE IS DELIBERATELY NO ROOM-KEY HELPER HERE. The backend builds
 * "site:<host>" itself (canonical-host.ts:93) because chat_rooms.room_url is
 * shared with two other key shapes. A client has no business computing a
 * storage key, so it cannot ask for the wrong one.
 */

/** DNS limit. Checked on the input, before folding, so a 4KB string is
 *  rejected rather than trimmed into something that looks legitimate. */
const MAX_HOST_LENGTH = 253

/** One DNS label: ASCII letters/digits/hyphens, no leading or trailing
 *  hyphen, at most 63 chars. Already-lowercased input only. */
const LABEL_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Prefixes folded away so a mobile or www variant is the SAME website. */
const FOLDED_PREFIXES = ["www.", "m.", "mobile."] as const

/** Bounded so a pathological "www.www.www.…" input cannot spin. Three is
 *  more nesting than any real host uses. */
const MAX_PREFIX_STRIPS = 3

/**
 * The canonical room host for `raw`, or null when `raw` is not a hostname we
 * will open a room for. Pure: no env, no clock, no I/O, no browser.
 */
export function canonicalSiteHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null

  let host = raw.trim().toLowerCase()
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return null

  // A single trailing dot is the DNS root and means the same website.
  if (host.endsWith(".")) host = host.slice(0, -1)

  for (let i = 0; i < MAX_PREFIX_STRIPS; i++) {
    const prefix = FOLDED_PREFIXES.find((p) => host.startsWith(p))
    if (!prefix) break
    const rest = host.slice(prefix.length)
    // Never fold a real two-label site down to a bare TLD: "m.com" is a
    // website, "com" is not.
    if (rest.split(".").length < 2) break
    host = rest
  }

  const labels = host.split(".")
  // Single-label hosts ("localhost", "intranet") are not websites in the
  // sense R1 means, and would collide across every private network.
  if (labels.length < 2) return null
  if (!labels.every((label) => LABEL_SHAPE.test(label))) return null
  // An all-numeric last label means an IPv4 literal (1.2.3.4) or nonsense;
  // no TLD is numeric. IPv6 and bracketed forms already failed LABEL_SHAPE
  // on the colons.
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return null

  return host
}

/**
 * The canonical room host for a full page address, or null.
 *
 * The panel and the content script both hold a URL, not a hostname, and both
 * used to do `new URL(x).hostname` inline inside a try/catch —
 * components/Header.tsx still does exactly that for the OLD presence pill.
 * One helper means "chrome://extensions", "about:blank", "" and a genuine
 * https page all get the same answer here rather than three answers in three
 * call sites.
 *
 * Only http(s) pages get a room: a file:// or chrome:// address is private to
 * one machine and its "hostname" is not a website anybody else can be on.
 */
export function siteChatHostFromUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  return canonicalSiteHost(parsed.hostname)
}

/**
 * What the reader is told they are in. The canonical host IS the readable
 * name — "x.com" — because the folding already removed the parts a person
 * would not say out loud. Kept as its own function so the two UI surfaces
 * cannot each invent a different title for the same room.
 */
export function siteChatRoomTitle(host: string | null): string | null {
  return canonicalSiteHost(host)
}
