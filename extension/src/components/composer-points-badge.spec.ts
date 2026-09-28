import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE COMPOSER PROMISES NO POINTS.
 *
 * The composer's action row used to carry a diamond badge: a per-keystroke
 * query that asked the backend what a draft was worth, wrapped in a tooltip
 * promising "up to 10 points per post". Reported by the owner: we no longer
 * award points per post, so the badge was quoting a price list that no
 * longer exists — the worst kind of UI, one that is confidently wrong.
 *
 * Removing the badge alone would have left the machine that fed it running:
 * a debounced copy of the draft, a React Query subscription keyed on every
 * debounced edit, and an HTTP round trip per pause in typing, all to compute
 * a number nobody renders. So the whole chain came out, hook included.
 *
 * WHY A SOURCE GUARD. jsdom implements no cascade and no layout (see the
 * note in vitest.config.ts), so it cannot be asked what this row measures.
 * What it can be asked is whether the badge, its query, and its copy are
 * still written down — and that is exactly what came back last time a
 * scoreboard was "removed" from a surface. This spec pins the absence.
 */
const SRC = join(__dirname, "..")

const src = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * The file with its comments removed. Every guard below would otherwise be
 * trippable by documentation: a comment explaining why the diamond left is
 * not the diamond coming back.
 *
 * A block comment only opens after a delimiter or at a line's start. Without
 * that guard the `/*` inside `accept="image/*"` opens a comment that runs to
 * the end of the file and swallows the submit button.
 */
const code = (p: string) =>
  src(p)
    .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//g, "$1")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

const COMPOSER = "components/CreatePost.tsx"
const POST_HOOKS = "hooks/useWebsitePosts.ts"

/** Every .ts/.tsx under src/, except the specs — this file names the very
 *  symbols it is asserting are gone, and so does any future spec. */
const sources = (dir = SRC, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name))
      out.push(full)
  }
  return out
}

describe("the post composer", () => {
  it("shows no points badge, and none of the copy that priced a post", () => {
    const composer = code(COMPOSER)
    // The badge itself: DittoBadge is the chip the composer borrowed from
    // the post header. The `diamond` guard is the wider net — the glyph is
    // assets/diamond.png, so an inline re-draw would have to name it.
    expect(composer).not.toMatch(/DittoBadge/)
    expect(composer).not.toMatch(/diamond/i)
    expect(composer).not.toMatch(/\bditto\b/i)
    // The copy. "10 points per post" is a promise the product stopped keeping.
    expect(composer).not.toMatch(/\bpoints?\b/i)
    // NOT a blanket ban on Tooltip. The first version of this line was
    // `not.toMatch(/Tooltip/)`, which outlaws the component from the entire
    // composer forever — and the composer has other controls that may
    // perfectly well want one some day. The Tooltip was never the defect;
    // the SENTENCE inside it was, and the four guards above already pin
    // every trace of the badge itself. So this keeps only the promise.
    expect(composer).not.toMatch(/Earn up to/i)
    expect(composer).not.toMatch(/per post/i)
  })

  it("no longer queries the backend for a draft's score", () => {
    const composer = code(COMPOSER)
    expect(composer).not.toMatch(/useCalculatePoints/)
    expect(composer).not.toMatch(/pointsData|isLoadingPoints/)
    // The second debounce existed only to feed that query. The mention
    // lookup's debounce is a different one and must survive.
    expect(composer).not.toMatch(/debouncedContent/)
    expect(composer).toMatch(/debouncedMentionQuery/)
  })

  it("leaves no orphaned hook behind anywhere in the extension", () => {
    expect(code(POST_HOOKS)).not.toMatch(/useCalculatePoints/)
    const survivors = sources().filter((f) =>
      readFileSync(f, "utf8").includes("useCalculatePoints"),
    )
    expect(survivors, "useCalculatePoints came back").toEqual([])
  })

  it("still draws the controls that belong in the action row", () => {
    const composer = code(COMPOSER)
    // Deleting the badge must not be confused with gutting the row: the
    // counter, the two media doors and the submit are the row's real job.
    expect(composer).toMatch(/<CharacterCounter/)
    expect(composer).toMatch(/<EmojiGifWrapper/)
    expect(composer).toMatch(/PhotoCameraOutlinedIcon/)
    expect(composer).toMatch(/"Pop it"/)
  })

  it("left no empty wrapper where the badge used to sit", () => {
    // The badge was the first child of the right-hand group, inside its own
    // <Box>. A wrapper kept after its contents leave is still a flex item
    // and still earns the group's gap: the emoji door must now open the row.
    expect(code(COMPOSER)).toMatch(/spacing=\{0\.625\}[\s\S]{0,200}?>\s*<EmojiGifWrapper/)
  })
})
