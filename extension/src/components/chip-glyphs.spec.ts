import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CHIP_GLYPH_SIZE,
  CHIP_STROKE_PX,
  ChipGlyph,
  GLYPH_LIKE_FILLED,
  GLYPH_LIKE_OUTLINE,
  GLYPH_REPLY,
  GLYPH_SHARE,
  GLYPH_TIP,
  glyphMarkup,
  glyphStroke,
} from "./chipGlyphs"

/**
 * FOUR ICONS FROM FOUR DIFFERENT DRAWINGS, MADE INTO ONE SET.
 *
 * The owner handed over four SVGs — like, comment, share and the Solana mark
 * for tip — and asked for them in the post row: "bu postlardaki alttaki like
 * comment tip ve share iconlarini verdigim iconlarla degistir", plus "like ve
 * liked bos dolu olarak", plus a complaint that the row's icon sizes and
 * alignment were wrong.
 *
 * The files were drawn to four unrelated conventions: a 1025-unit box with
 * the art running edge to edge, two 24-unit boxes whose art fills 75% and 58%
 * of them, and a 25-unit box at 80%. Dropped into equal squares that is four
 * different-looking icons, which is the defect being fixed, not a fix. So
 * chipGlyphs.ts declares each glyph's INK BOX and re-frames it.
 *
 * That makes the ink boxes load-bearing numbers that were read off path data
 * by a human, and a wrong one produces an icon that is off-centre or the
 * wrong size with nothing failing. `hull` below is the check: it walks the
 * path and takes the extent of every point in it. Because Bezier control
 * points can sit outside the curve they steer, the hull is a SUPERSET of the
 * true ink — so it can prove a declared box is not too big, and it bounds how
 * far off a too-small one can be. It is a guard against a typo, not a
 * rasteriser.
 */

/** Extent of every point in a path, control points included. See above. */
function hull(d: string): { x: number; y: number; w: number; h: number } {
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
  const pts: Array<[number, number]> = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  for (const cmd of d.match(/[a-zA-Z][^a-zA-Z]*/g) ?? []) {
    const op = cmd[0]
    const rel = op === op.toLowerCase()
    const OP = op.toUpperCase()
    const n = arity[OP]
    if (n === undefined) throw new Error(`unknown path command "${op}"`)
    if (n === 0) {
      cx = sx
      cy = sy
      continue
    }
    const args = (cmd.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    for (let i = 0; i < args.length; i += n) {
      const a = args.slice(i, i + n)
      if (OP === "H") {
        cx = rel ? cx + a[0] : a[0]
        pts.push([cx, cy])
        continue
      }
      if (OP === "V") {
        cy = rel ? cy + a[0] : a[0]
        pts.push([cx, cy])
        continue
      }
      if (OP === "A") {
        cx = rel ? cx + a[5] : a[5]
        cy = rel ? cy + a[6] : a[6]
        pts.push([cx, cy])
        continue
      }
      for (let k = 0; k < n; k += 2) {
        const px = rel ? cx + a[k] : a[k]
        const py = rel ? cy + a[k + 1] : a[k + 1]
        pts.push([px, py])
        if (k === n - 2) {
          cx = px
          cy = py
        }
      }
      if (OP === "M") {
        sx = cx
        sy = cy
      }
    }
  }
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
}

/** The union of every subpath's hull — the glyph's whole drawing. */
function glyphHull(g: ChipGlyph) {
  const hs = g.d.map(hull)
  const x = Math.min(...hs.map((h) => h.x))
  const y = Math.min(...hs.map((h) => h.y))
  return {
    x,
    y,
    w: Math.max(...hs.map((h) => h.x + h.w)) - x,
    h: Math.max(...hs.map((h) => h.y + h.h)) - y,
  }
}

const box = (g: ChipGlyph) => g.viewBox.split(" ").map(Number)

const ALL: Array<[string, ChipGlyph]> = [
  ["like (empty)", GLYPH_LIKE_OUTLINE],
  ["like (full)", GLYPH_LIKE_FILLED],
  ["reply", GLYPH_REPLY],
  ["tip", GLYPH_TIP],
  ["share", GLYPH_SHARE],
]

describe("every chip glyph is framed the same way", () => {
  it("draws into a square", () => {
    for (const [name, g] of ALL) {
      const [, , w, h] = box(g)
      expect(w, `${name}: viewBox is not square`).toBeCloseTo(h, 3)
      expect(w, `${name}: viewBox side does not match the declared unit`).toBeCloseTo(g.unit, 3)
    }
  })

  it("centres its ink in that square", () => {
    // Off-centre framing is the failure that looks like "the icons do not sit
    // on the same line" even when every box is the same size.
    for (const [name, g] of ALL) {
      const [bx, by, w, h] = box(g)
      const ink = glyphHull(g)
      const dx = (ink.x + ink.w / 2 - (bx + w / 2)) / w
      const dy = (ink.y + ink.h / 2 - (by + h / 2)) / h
      expect(Math.abs(dx), `${name}: ink sits ${(dx * 100).toFixed(1)}% off centre horizontally`)
        .toBeLessThan(0.03)
      expect(Math.abs(dy), `${name}: ink sits ${(dy * 100).toFixed(1)}% off centre vertically`)
        .toBeLessThan(0.03)
    }
  })

  it("fills the same share of it, so no icon reads bigger than its neighbour", () => {
    // Solid and outline are allowed to differ HERE, because an outline's
    // stroke straddles the path and adds half a stroke on every side. The
    // next test checks that the two land at the same size once drawn.
    const share = (g: ChipGlyph) => {
      const ink = glyphHull(g)
      return Math.max(ink.w, ink.h) / g.unit
    }
    const solid = ALL.filter(([, g]) => g.paint === "fill")
    const outline = ALL.filter(([, g]) => g.paint === "stroke")
    for (const group of [solid, outline]) {
      const shares = group.map(([, g]) => share(g))
      const spread = Math.max(...shares) - Math.min(...shares)
      expect(
        spread,
        `these glyphs fill different shares of their boxes: ` +
          group.map(([n], i) => `${n} ${(shares[i] * 100).toFixed(1)}%`).join(", "),
      ).toBeLessThan(0.03)
    }
  })

  it("comes out the same optical size once the stroke is added", () => {
    // A solid glyph's ink IS its extent; an outline's extent is its ink plus
    // one stroke. Compared at the size the row actually draws.
    const drawn = (g: ChipGlyph) => {
      const ink = glyphHull(g)
      const px = (Math.max(ink.w, ink.h) / g.unit) * CHIP_GLYPH_SIZE
      return g.paint === "stroke" ? px + CHIP_STROKE_PX : px
    }
    const sizes = ALL.map(([, g]) => drawn(g))
    const spread = Math.max(...sizes) - Math.min(...sizes)
    expect(
      spread,
      `the glyphs draw at different sizes: ` +
        ALL.map(([n], i) => `${n} ${sizes[i].toFixed(2)}px`).join(", "),
    ).toBeLessThan(0.6)
  })
})

describe("every outline glyph draws at one weight", () => {
  it("converts CHIP_STROKE_PX into each glyph's own units", () => {
    // The four source files live on 24-, 25- and 1025-unit grids. A stroke
    // width declared in units would therefore be a different weight in each,
    // which is what "the icons do not match" looks like up close.
    for (const [name, g] of ALL) {
      if (g.paint !== "stroke") continue
      const onScreen = (glyphStroke(g, CHIP_GLYPH_SIZE) / g.unit) * CHIP_GLYPH_SIZE
      expect(onScreen, `${name}: draws a ${onScreen.toFixed(2)}px stroke`).toBeCloseTo(
        CHIP_STROKE_PX,
        2,
      )
    }
  })

  it("keeps that weight at any size it is asked for", () => {
    // The notification discs draw these at 12px, the row at CHIP_GLYPH_SIZE.
    for (const size of [10, 12, CHIP_GLYPH_SIZE, 16, 24]) {
      const onScreen = (glyphStroke(GLYPH_REPLY, size) / GLYPH_REPLY.unit) * size
      expect(onScreen).toBeCloseTo(CHIP_STROKE_PX, 2)
    }
  })
})

describe("like is one heart with two states", () => {
  it("empty and full are the SAME contour", () => {
    // Anything else and the glyph changes shape the instant it is pressed.
    expect(GLYPH_LIKE_FILLED.d).toEqual(GLYPH_LIKE_OUTLINE.d)
  })

  it("differs only in whether that contour is filled", () => {
    expect(GLYPH_LIKE_OUTLINE.paint).toBe("stroke")
    expect(GLYPH_LIKE_FILLED.paint).toBe("fill")
  })

  it("is the state the reader is in, on both surfaces", () => {
    // The panel's chip and the card's chip must agree about which heart means
    // "you have liked this" — they are the same control seen twice.
    const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
    for (const p of ["components/UpvoteButton.tsx", "components/SpotCard/Conversation.tsx"]) {
      const s = read(p)
      expect(s, `${p} does not pick between the two like states`).toMatch(
        /\?\s*GLYPH_LIKE_FILLED\s*:\s*GLYPH_LIKE_OUTLINE/,
      )
    }
  })
})

describe("the markup path and the React path cannot drift", () => {
  it("emits stroke settings for an outline and none for a solid", () => {
    const outline = glyphMarkup(GLYPH_REPLY, 12)
    expect(outline).toContain('fill="none"')
    expect(outline).toContain('stroke="currentColor"')
    expect(outline).toContain(`stroke-width="${glyphStroke(GLYPH_REPLY, 12)}"`)
    const solid = glyphMarkup(GLYPH_TIP, 12)
    expect(solid).toContain('fill="currentColor"')
    expect(solid).not.toContain("stroke=")
  })

  it("draws every subpath, not just the first", () => {
    expect((glyphMarkup(GLYPH_TIP, 12).match(/<path/g) ?? []).length).toBe(GLYPH_TIP.d.length)
  })

  it("is asked for the size its consumers actually render at", () => {
    // notificationText hands these strings to the surfaces that draw them,
    // all of which size the svg to 12px in CSS. A mismatch would leave the
    // drawing right and the stroke weight wrong, which is the kind of wrong
    // nobody spots. The panel's social inbox was a third consumer until it
    // closed (panel audit, 2026-09-20).
    const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
    expect(read("helpers/notificationText.ts")).toMatch(/NOTE_GLYPH_PX\s*=\s*12/)
    expect(read("components/SpotCard/style.ts")).toMatch(
      /\.me-act-kind svg \{ width: 12px/,
    )
  })
})

describe("nobody hand-rolls a chip glyph any more", () => {
  it("every surface goes through the renderer", () => {
    // Five call sites used to spell out viewBox / width / height / fill by
    // hand, and one of them had already drifted to a different opacity. Half
    // the set is outlines now, which is six props rather than four.
    const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
    for (const p of [
      "components/PostFooter.tsx",
      "components/UpvoteButton.tsx",
      "components/SpotCard/SpotCard.tsx",
      "components/SpotCard/Conversation.tsx",
    ]) {
      const s = read(p)
      expect(s, `${p} still hand-writes an <svg> around a chip glyph`).not.toMatch(
        /<svg[\s\S]{0,200}GLYPH_/,
      )
      expect(s).toMatch(/<ChipGlyphIcon/)
    }
  })

  it("keeps the glyph module free of anything the shadow root cannot have", () => {
    // The card imports this file from inside a closed shadow root with no MUI
    // and no theme. An import of either would break the card at runtime, not
    // at build time, and only on somebody else's web page.
    // Comments stripped first: this file's own header EXPLAINS the rule, so a
    // guard that its documentation trips is a guard that punishes writing the
    // documentation down.
    const strip = (p: string) =>
      readFileSync(join(__dirname, p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
    for (const p of ["chipGlyphs.ts", "ChipGlyphIcon.tsx"]) {
      expect(strip(p), `${p} imports MUI; the card cannot`).not.toMatch(/from ["']@mui/)
      expect(strip(p), `${p} reaches for the document; the card has none`).not.toMatch(
        /\bdocument\./,
      )
      expect(
        strip(p),
        `${p} reaches for window; the card runs inside someone else's page`,
      ).not.toMatch(/\bwindow\./)
    }
  })
})
