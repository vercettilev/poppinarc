import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * TAPPING A PERSON OPENS THAT PERSON.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Two of the commonest taps in the panel did nothing at all. The avatar and
 * the name in a followers/following row (components/FollowerItem.tsx) and the
 * avatar in a comment thread (components/Post/Comments/CommentSection.tsx)
 * both called `navigate()` from a helper, helpers/navigation.ts, which held
 * its own module-level `navigateFunction` and used it only if something had
 * called the module's `setNavigateFunction` first.
 *
 * Nothing ever did. `setNavigateFunction` had exactly ONE occurrence in the
 * whole tree — its own declaration — so the handle stayed null for the life
 * of the panel and every call took the helper's fallback: a `NAVIGATE`
 * message to the service worker, which answered by broadcasting a
 * `"route-store"` state update. The panel's store map (store/index.ts) has no
 * key by that name, so the broadcast landed on `undefined.setState` and threw.
 * Nothing synced a route back into react-router either — the panel routes
 * through MemoryRouter (providers/RouterWrapper.tsx), which the route store
 * does not drive — so even a repaired broadcast could not have moved it.
 *
 * Net effect for a reader: a dead tap, and a TypeError in a console they
 * never open.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * There is ONE navigation channel in the panel and it is react-router's own
 * `useNavigate`. A second, invisible one — a module-scope handle filled by a
 * registration call somewhere else — is what let this rot for as long as it
 * did: nothing type-checks a null that is only read at click time, and
 * nothing renders it either.
 *
 * The repair therefore deleted the helper rather than registering it from
 * App.tsx. Registering would have kept the second channel alive and working,
 * which is worse than a dead one: the next handler to reach for it would have
 * no way to tell that it was the wrong door.
 *
 * ── WHY A SOURCE GUARD ──────────────────────────────────────────────────────
 * jsdom has no layout and mounting these two rows through a MemoryRouter
 * would test react-router, not this. What rotted is a call site pointing at a
 * channel that cannot carry it, and the call site is where it was written.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * Source with comments removed. This repo explains a fix by quoting the line
 * it replaced, so a naive `not.toMatch` over the raw file matches the
 * paragraph about the removal. The `[^:]` guard keeps `https://` out of the
 * line-comment rule.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

/** The two rows whose profile taps were dead. */
const TAP_SITES = [
  "components/FollowerItem.tsx",
  "components/Post/Comments/CommentSection.tsx",
]

describe("the panel has one navigation channel", () => {
  it("the second one is gone, not merely unused", () => {
    expect(
      existsSync(join(SRC, "helpers/navigation.ts")),
      "helpers/navigation.ts is back. It exported a `navigate` that could " +
        "only work if `setNavigateFunction` was called first, and a `goBack` " +
        "with no importer at all. A module-scope navigate handle is a second " +
        "channel nothing renders and nothing type-checks; use react-router's " +
        "useNavigate.",
    ).toBe(false)
  })

  it("nothing imports it", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(p)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        const rel = p.slice(SRC.length + 1).split("\\").join("/")
        if (rel === "components/profile-tap-navigates.spec.ts") continue
        if (/from\s+["'][^"']*helpers\/navigation["']/.test(readFileSync(p, "utf8"))) {
          offenders.push(rel)
        }
      }
    }
    walk(SRC)
    expect(offenders, offenders.join("\n")).toEqual([])
  })
})

describe("both dead taps navigate for real now", () => {
  for (const file of TAP_SITES) {
    it(`${file} uses react-router's hook`, () => {
      const src = code(file)
      expect(src, `${file} lost its useNavigate import`).toMatch(
        /import\s*\{[^}]*\buseNavigate\b[^}]*\}\s*from\s*["']react-router["']/,
      )
      expect(src, `${file} imports the hook but never calls it`).toMatch(
        /const\s+navigate\s*=\s*useNavigate\(\)/,
      )
    })

    it(`${file} still points at a route that exists`, () => {
      // `profile/:userId` — entries/popup/App.tsx declares it. A tap that
      // resolves to no route is the same dead tap wearing a working channel.
      expect(code(file)).toMatch(/navigate\(\s*`\/profile\/\$\{/)
      expect(code("entries/popup/App.tsx")).toMatch(
        /<Route\s+path="profile\/:userId"/,
      )
    })
  }
})

/**
 * THE COMPOSER'S ACTION ROW DOES NOT COLLAPSE WHEN YOU SEND.
 *
 * Sending a reply swapped the row holding the emoji button and the submit
 * button for a 2px progress bar, so the row lost its height and the thread
 * below jumped up while the reader's finger was still on the glass.
 *
 * 24px is arithmetic, not taste: MUI's IconButton at `size="small"` carries
 * `padding: 5`, and the svg inside it is pinned to 14px — 5 + 14 + 5. The
 * `display: "flex"` passed alongside is what makes that arithmetic hold: as
 * MUI ships it the button is `inline-flex`, and an inline-flex box sits in a
 * LINE box, whose height picks up the inherited strut's half-leading below
 * the baseline — a fraction of a pixel that cannot be written down. Any of
 * those three numbers changing without the floor changing brings the jump
 * back, so all four are pinned together.
 */
describe("the reply composer's action row keeps its height", () => {
  const composer = code("components/Post/Comments/CommentSection.tsx")

  it("declares the floor", () => {
    expect(composer, "the action row lost its minHeight").toMatch(
      /minHeight:\s*"24px"/,
    )
  })

  it("the floor still matches what the row contains", () => {
    const sx = /<EmojiGifWrapper[\s\S]*?\/>/.exec(composer)
    expect(sx, "EmojiGifWrapper is gone or renamed").not.toBeNull()
    expect(sx![0], "the emoji button is inline again, so 24px is now a guess")
      .toMatch(/display:\s*"flex"/)
    expect(sx![0], "the svg is no longer 14px, so 5 + 14 + 5 is now wrong")
      .toMatch(/width:\s*"14px"[\s\S]*?height:\s*"14px"/)
  })
})
