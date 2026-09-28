import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Measured in the field on x.com: "Denying load of
 * chrome-extension://…/fonts/Poppins-SemiBold.ttf. Resources must be listed
 * in the web_accessible_resources manifest key."
 *
 * The file shipped. The loader asked for it. The manifest just never named
 * it, so Chrome refused every page outside the extension's own — which is
 * exactly the pages the chip lives on. Nothing broke visibly: the browser
 * synthesized 600 out of 400, so the chip wore a faked weight for as long
 * as the face was listed in brandFont.
 *
 * A font a content script asks for and the manifest does not expose is a
 * silent downgrade, so read both ends and hold them together.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8")
const faces = (src: string) => new Set(src.match(/fonts\/[\w-]+\.ttf/g) ?? [])

describe("fonts a page can actually load", () => {
  it("covers every face the injected loaders ask for", () => {
    const exposed = faces(read("../manifest.ts"))
    for (const src of ["./brandFont.ts", "./fontHelper.ts"]) {
      for (const face of faces(read(src))) {
        expect(exposed, `${face} requested by ${src}`).toContain(face)
      }
    }
  })
})
