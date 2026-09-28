import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * TWO WAYS A RECEIPT USED TO GO QUIET, both of them type-correct.
 *
 * 1. The API sends `post_transaction`; three callers hand it to <Post/>
 *    under the name `transaction` by writing that mapping out themselves.
 *    A fourth - the parent post above a reply on a profile - spread the row
 *    and never wrote the line, so a trade receipt there lost its coin, its
 *    buy door and its re-said sentence. Both ends type-checked.
 *
 * 2. An upload that resolved WITHOUT a url fell back to the old photo
 *    (`res.url || photoUrl`), and the save reported success. The person's
 *    new picture never landed and nothing on screen said so.
 *
 * Source guards, because both bugs live in a line's absence rather than in
 * behaviour a render test would reach.
 */
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

/**
 * The file with its comments removed. The first version of these guards
 * failed against a correct fix: the comment explaining what the old line
 * used to be contains the old line, so a `not.toMatch` on the raw file
 * matched the explanation. A guard that the fix's own documentation can
 * trip is a guard that teaches people not to document.
 */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("the receipt's wiring", () => {
  it("<Post/> falls back to the wire's own field name", () => {
    const post = src("components/Post.tsx")
    expect(post).toMatch(/transaction:\s*transactionProp/)
    expect(post).toMatch(/const transaction = transactionProp \?\? post_transaction/)
  })

  it("the receipt asks the ledger for its market cap", () => {
    // The words are frozen on the post; the cap is read back out of
    // spot_trades and passed in beside them.
    expect(src("components/Post.tsx")).toMatch(/transaction\?\.mcap_usd/)
    expect(src("components/SpotCard/pagePosts.ts")).toMatch(
      /mcapUsd: p\.post_transaction\?\.mcap_usd/,
    )
  })

  it("the card's Activity band re-says a receipt like every other surface", () => {
    const pagePosts = code("components/SpotCard/pagePosts.ts")
    expect(pagePosts).toMatch(/receiptText\(/)
    // ...and not the raw stored sentence it used to print.
    expect(pagePosts).not.toMatch(/text: sanitisePostText\(p\.content\)[,\s]*\n\s*createdAt: p\.created_at,\n\s*avatarUrl/)
  })
})

describe("a photo upload that produced no address", () => {
  it("edit-profile refuses to report success", () => {
    const edit = code("views/edit-profile.tsx")
    expect(edit).not.toMatch(/response\.url \|\| undefined/)
    expect(edit).toMatch(/if \(!response\.url\)/)
  })

  it("the welcome step refuses to keep the old one silently", () => {
    const claim = code(
      "entries/welcome/components/steps/ClaimIdentityStep.tsx",
    )
    expect(claim).not.toMatch(/res\.url \|\| photoUrl/)
    expect(claim).toMatch(/if \(!res\.url\)/)
    expect(claim).toMatch(/Couldn't upload your photo/)
  })
})
