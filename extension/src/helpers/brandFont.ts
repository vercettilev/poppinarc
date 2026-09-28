/**
 * PoppinSans, loaded the one way that works on EVERY surface this extension
 * draws on.
 *
 * ── WHY THE FontFace API AND NOT @font-face ────────────────────────────────
 * Chrome resolves @font-face at document scope only, so a rule inside a
 * shadow root is silently ignored — the card learned this the hard way (see
 * the history in SpotCard/mount.tsx). The in-page panel popup and the edge
 * button live in shadow roots too, so they have the same constraint. And the
 * extension's own documents (side panel, welcome) simply never loaded the
 * font at all: the MUI theme said "PoppinSans" and every panel surface
 * quietly fell back to the browser's default sans. That fallback is most of
 * why the panel and the card read as written by two different pens.
 *
 * One loader, imported by every entry, so the answer to "which font is this
 * surface actually rendering" stops depending on which entry you are in.
 *
 * ── NOT THE THING WE REFUSED ────────────────────────────────────────────────
 * chrome.runtime.getURL resolves to a resource shipped inside the extension:
 * no network, no third party, nothing observable to the page. Loading a
 * Google Font from inside a reader's page remains refused; this is local.
 *
 * Failure is silent and survivable: a host page with a strict font-src CSP
 * can refuse an extension font, and typography degrades to the system stack.
 */
let fontPromise: Promise<void> | null = null

export function ensureBrandFont(): void {
  if (fontPromise) return
  fontPromise = (async () => {
    try {
      const faces: Array<[string, string]> = [
        ["fonts/Poppins-Regular.ttf", "400"],
        ["fonts/Poppins-Medium.ttf", "500"],
        // SemiBold is real, not synthesized: stylesheets lean on 600 for
        // labels and chips, and without this face Chrome resolves 600 to
        // the Bold file — every quiet label shouting one step louder than
        // drawn.
        ["fonts/Poppins-SemiBold.ttf", "600"],
        ["fonts/Poppins-Bold.ttf", "700"],
      ]
      await Promise.all(
        faces.map(async ([file, weight]) => {
          const face = new FontFace(
            "PoppinSans",
            `url(${chrome.runtime.getURL(file)})`,
            { weight, style: "normal" },
          )
          await face.load()
          ;(document as unknown as { fonts: FontFaceSet }).fonts.add(face)
        }),
      )
    } catch {
      // See above: the surface falls back to the system stack.
    }
  })()
}
