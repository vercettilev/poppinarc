/**
 * Flattening for text the card did not write.
 *
 * ITS OWN MODULE ON PURPOSE. This is a pure string function with no
 * dependencies, and it lived next to the network calls until a test importing
 * it dragged in the post service, then fetchService, then Firebase, which threw
 * on a missing API key in the test environment. A security primitive that
 * cannot be tested without booting an auth SDK will eventually stop being
 * tested.
 *
 * ── WHY ANY OF THIS ─────────────────────────────────────────────────────────
 * The card renders text written by strangers, inside a closed shadow root, on
 * somebody ELSE'S domain. That inverts the card's usual threat model: until
 * posts arrived, nothing from outside ever came in.
 *
 *   - Preact sets text through `textContent`, so markup cannot execute. That is
 *     the real defence and it is structural — nothing below is load-bearing for
 *     script injection, and none of it pretends to parse HTML.
 *   - URLs are reduced to a bare host. A live link inside a card sitting on
 *     nytimes.com borrows that page's credibility for wherever a stranger wants
 *     to point — phishing with our surface as the disguise. Nothing in the card
 *     is clickable; following a link means opening the post in the panel, where
 *     a link looks like a link.
 *   - Invisible characters go, and the bidi range is the one worth naming:
 *     U+202E reverses the visual order of the text after it, so a post can
 *     render as something other than what it says. The rest (zero-width, word
 *     joiners, BOM, C0/C1 controls) are layout and hiding problems rather than
 *     deception ones.
 *   - Whitespace runs collapse, so a post cannot stretch the card or push its
 *     own content out of view.
 */

/** C0/C1 controls, zero-width and word-joiner families, bidi overrides, BOM.
 *
 *  Written as ESCAPES, never as the characters themselves: an earlier version
 *  of this file carried the literal code points, which are invisible in a diff
 *  and unreviewable — and one of them silently fell out of the class during an
 *  edit, leaving a gap nobody could see. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = new RegExp(
  "[" +
    "\\u0000-\\u001F\\u007F-\\u009F" + // C0 / C1 controls
    "\\u200B-\\u200F" + // zero-width space .. RTL mark
    "\\u2028\\u2029" + // line / paragraph separators
    "\\u202A-\\u202E" + // bidi embedding and OVERRIDE
    "\\u2060-\\u2064\\uFEFF" + // word joiner family, BOM
    "]",
  "g",
)

const URL_ANYWHERE = /https?:\/\/(\S+)/gi

export function sanitisePostText(raw: string): string {
  return (raw ?? "")
    .replace(URL_ANYWHERE, (_m, rest: string) => {
      const host = String(rest).split(/[/?#]/)[0] ?? ""
      return host ? `[${host}]` : "[link]"
    })
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim()
}
