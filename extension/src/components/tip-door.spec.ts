import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The fake tip flow shipped a green success toast over money that never
 * moved, while the real, money-carrying TipDialog sat unreachable behind a
 * button nobody rendered. These are source guards: cheap, but they pin the
 * two facts that made the incident possible.
 */
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

describe("the tip door", () => {
  it("the fake tip pages are gone, routes included", () => {
    expect(() => src("views/tip.tsx")).toThrow()
    expect(() => src("views/tip-details.tsx")).toThrow()
    expect(() => src("views/TipDetailView.tsx")).toThrow()
    const app = src("entries/popup/App.tsx")
    expect(app).not.toMatch(/path="tip/)
    expect(src("components/Layout.tsx")).not.toMatch(/\/tip/)
  })

  it("PostFooter actually renders the door it always imported", () => {
    const footer = src("components/PostFooter.tsx")
    // The dead import is gone...
    expect(footer).not.toMatch(/TipButton/)
    // ...and the live control exists, calls the threaded handler, and is
    // gated to other people's posts.
    expect(footer).toMatch(/GLYPH_TIP/)
    expect(footer).toMatch(/onTip\(\{/)
    expect(footer).toMatch(/user\.id !== currentUser\.id/)
  })

  it("the door leads to the dialog that moves real money", () => {
    const room = src("views/comment.tsx")
    expect(room).toMatch(/handleOpenTip/)
    expect(room).toMatch(/<TipDialog/)
    const dialog = src("views/wallet/TipDialog.tsx")
    // The real dialog calls the wallet service; the fake pages never did.
    expect(dialog).toMatch(/transferSOL|transferToken|WalletService/)
  })
})
