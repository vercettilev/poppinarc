import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { JUICE } from "./juice"
import { aaThreshold, contrastRatio } from "../helpers/contrast"

/**
 * THE PANEL'S QUIET TEXT, MEASURED ON THE GROUND IT IS ACTUALLY PAINTED ON.
 *
 * helpers/accessibility.spec.ts measures the chip and the card, because those
 * are the two surfaces with stylesheets it can read. The panel had no such
 * file and therefore no coverage — and that is exactly where the worst pair
 * in the product was hiding: helpers/panelSurface.ts declared
 * `FAINT = rgba(255,255,255,.28)`, which composites on BRAND_GROUND to
 * 2.45:1. Below AA (4.5), below even the 3:1 large-text bar, and used on
 * real prose including the deposit warning that names the network and the
 * token — the one sentence on that screen where being wrong costs money.
 *
 * Two habits from the sibling suite are kept deliberately:
 *
 *   1. THE VALUES COME FROM THE SOURCE. A contrast test that restates its
 *      palette is decorative — change the code, forget the test, stay green.
 *      Both the tokens and the ground stops are parsed out of the shipped
 *      files, so re-pointing DIM at a white-alpha again fails here.
 *   2. THE GROUND IS THE REAL ONE. Not JUICE.ground: the panel paints
 *      BRAND_GROUND, a three-stop blue-cast sweep whose lightest stop is
 *      #101B2C, and a token that clears AA on the darkest stop can still
 *      fail on the lightest. Every stop is checked, and so is each of the
 *      three white-alpha fills a surface can stack on top of it.
 */

const PANEL_SURFACE = readFileSync("src/helpers/panelSurface.ts", "utf8")
const BRAND_GROUND_SRC = readFileSync("src/helpers/brandGround.ts", "utf8")

/** The smallest text either token is drawn at today, so the bar is 4.5. */
const SMALLEST_PX = 10.5

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) h = [...h].map((c) => c + c).join("")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
}

function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
}

/** Composite a colour over an opaque background. contrast.ts speaks hex only,
 *  and every fill on this surface is an alpha, so this is the missing step. */
function flatten(color: string, bg: string): string {
  const rgba = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(color)
  if (!rgba) return color // already a hex
  const fg: Rgb = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])]
  const a = rgba[4] === undefined ? 1 : Number(rgba[4])
  const back = parseHex(bg)
  return toHex(fg.map((c, i) => c * a + back[i] * (1 - a)) as Rgb)
}

/**
 * A token's shipped value, read out of panelSurface.ts. It may be a JUICE
 * reference (`export const DIM = JUICE.text2`) or a literal — both forms are
 * resolved, so the guard survives either style of edit.
 */
function shippedToken(name: string): string {
  const m = new RegExp(`export const ${name}\\s*=\\s*([^\\n]+)`).exec(PANEL_SURFACE)
  if (!m) throw new Error(`panelSurface.ts no longer exports ${name}`)
  const value = m[1].trim().replace(/,$/, "")
  const juice = /^JUICE\.(\w+)$/.exec(value)
  if (juice) {
    const v = (JUICE as Record<string, unknown>)[juice[1]]
    if (typeof v !== "string") throw new Error(`JUICE.${juice[1]} is not a colour`)
    return v
  }
  return value.replace(/^["']|["']$/g, "")
}

/** Every opaque stop BRAND_GROUND paints, read out of its declaration. */
function groundStops(): string[] {
  const stops = [...BRAND_GROUND_SRC.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0])
  expect(stops.length, "brandGround.ts declares no hex stops").toBeGreaterThan(2)
  return [...new Set(stops)]
}

/** The white-alpha fills a panel surface can stack on the ground. */
function surfaceFills(): Array<[string, string]> {
  const fills: Array<[string, string]> = [["bare ground", "rgba(255,255,255,0)"]]
  for (const block of ["PANEL_CARD", "PANEL_ROW", "PANEL_PILL"]) {
    const m = new RegExp(
      `export const ${block}[\\s\\S]*?backgroundColor:\\s*"([^"]+)"`,
    ).exec(PANEL_SURFACE)
    expect(m, `panelSurface.ts no longer declares ${block}`).not.toBeNull()
    fills.push([block, m![1]])
  }
  return fills
}

describe("the panel's own text tiers clear AA on the panel's own ground", () => {
  const stops = groundStops()
  const fills = surfaceFills()

  for (const token of ["DIM", "FAINT"]) {
    it(`${token} clears AA on every ground stop and every surface fill`, () => {
      const fg = shippedToken(token)
      const need = aaThreshold(SMALLEST_PX)
      const failures: string[] = []
      for (const stop of stops) {
        for (const [where, fill] of fills) {
          const bg = flatten(fill, stop)
          // A token may itself be a white-alpha; measure what lands on screen.
          const ink = flatten(fg, bg)
          const ratio = contrastRatio(ink, bg)
          if (ratio < need)
            failures.push(
              `${token} (${fg}) on ${where} over ${stop} → ${bg}: ${ratio.toFixed(2)}:1, needs ${need}:1 at ${SMALLEST_PX}px`,
            )
        }
      }
      expect(failures, failures.join("\n")).toEqual([])
    })

    it(`${token} is a BLUE gray, not a neutral one`, () => {
      // Rule 2 of the design language: "There is no neutral gray in this
      // product; every secondary text color carries the brand's temperature."
      // Both tokens were rgba(255,255,255,…) — perfectly neutral — before the
      // contrast pass above moved them onto JUICE.
      const [r, , b] = parseHex(flatten(shippedToken(token), "#000000"))
      expect(b, `${token} has no blue cast`).toBeGreaterThan(r)
    })
  }

  it("still reports the pair this pass replaced, so nobody restores it", () => {
    // The exact values panelSurface.ts shipped, on the panel's own base stop.
    expect(contrastRatio(flatten("rgba(255,255,255,.28)", "#0A0D14"), "#0A0D14")).toBeLessThan(3)
    expect(contrastRatio(flatten("rgba(255,255,255,.45)", "#101B2C"), "#101B2C")).toBeLessThan(4.5)
  })
})
