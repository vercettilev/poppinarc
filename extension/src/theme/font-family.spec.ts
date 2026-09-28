import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { describe, expect, it } from "vitest"

/**
 * THE FONT THE PRODUCT ASKS FOR MUST BE A FONT THE PRODUCT LOADS.
 *
 * Fifteen live controls declared `fontFamily: "Poppins, sans-serif"` — the
 * wallet's Send/Open buttons, both Swap sheets, the welcome tab's sign-in
 * spinner. The .ttf files really are named Poppins-*.ttf, but the FAMILY
 * every surface registers is `PoppinSans` (helpers/brandFont.ts, and any
 * @font-face block in the shipped stylesheets). Nothing anywhere registers
 * `Poppins`. So each of those controls silently fell back
 * to the system stack while every control beside it drew the brand face —
 * the kind of defect that never throws, never logs, and is invisible to
 * anyone who has Poppins installed locally.
 *
 * CSS makes this failure silent by design: an unknown family is not an
 * error, it is the next entry in the stack. This test is the error.
 *
 * WHAT IT CHECKS: the FIRST family of every font stack in the source — the
 * one the author actually meant. Everything after it is a fallback, which is
 * by definition whatever the reader's OS happens to have, so a stack like
 * `PoppinSans, Inter, -apple-system, sans-serif` is fine.
 *
 * Note for anyone tempted to grep instead: /Poppins/ also matches
 * `PoppinSans`, which is the correct name. That near-miss is the whole
 * reason this reads registered families out of the source rather than
 * hard-coding a forbidden string.
 */

const ROOT = "src"

/** Families the product itself loads, read out of the shipped registrations. */
function registeredFamilies(files: string[]): Set<string> {
  const found = new Set<string>()
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    // helpers/brandFont.ts: new FontFace("PoppinSans", …)
    for (const m of src.matchAll(/new FontFace\(\s*["']([^"']+)["']/g)) found.add(m[1])
    // any stylesheet: @font-face { font-family: 'X'; … }
    for (const m of src.matchAll(/@font-face\s*\{[^}]*?font-family:\s*["']?([^"';]+)["']?\s*;/g))
      found.add(m[1].trim())
  }
  return found
}

/**
 * Faces the HOST page supplies, which we deliberately wear rather than load.
 * The resting row on x.com is the documented exemption to rule 6 — see
 * theme/juice.spec.ts, "the RESTING row is exempt, because it lives on X's
 * page" — and Chirp is X's own face, present in X's document.
 */
const HOST_FACES = new Set(["TwitterChirp"])

/** CSS's own keywords: never registered, always legal. */
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|css)$/.test(p)) out.push(p)
  }
  return out
}

/**
 * Comments are stripped before scanning. The first version of the sibling
 * reduced-motion guard failed against the correct fix because the comment
 * explaining the old value contained the old value — "a guard its own
 * documentation can trip teaches people not to document"
 * (helpers/accessibility.spec.ts). Same lesson, applied up front.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")
}

/** Every font stack declared in a file, JSX/sx and CSS alike. */
function declaredStacks(src: string): string[] {
  const body = stripComments(src)
  const stacks: string[] = []
  // sx / style objects: fontFamily: "…". A token reference (fontFamily: FONT,
  // fontFamily: JUICE.mono) carries no quotes and is not a literal to check.
  for (const m of body.matchAll(/fontFamily\s*:\s*(["'])([^"']+)\1/g)) stacks.push(m[2])
  // Template-literal CSS and .css files: font-family: …;
  for (const m of body.matchAll(/font-family\s*:\s*([^;{}\n]+)/g)) stacks.push(m[1])
  return stacks
}

/** The family the author meant: the first entry of the stack. */
function primaryFamily(stack: string): string | null {
  const first = stack.split(",")[0].trim().replace(/!important$/, "").trim()
  // `font-family: ${JUICE.mono}` resolves at build time to a stack of its
  // own, and the CSS scan stops at the interpolation's brace, so the capture
  // is a bare "$". Anything carrying a template hole is not a literal.
  if (!first || first.includes("$")) return null
  return first.replace(/^["']|["']$/g, "").trim()
}

describe("every font the source asks for is a font the product loads", () => {
  const all = walk(ROOT)
  const sources = all.filter((f) => !/\.spec\.(ts|tsx)$/.test(f))
  const registered = registeredFamilies(all)

  it("the brand face is registered under exactly one name", () => {
    // If this ever fails, the allow-list below moved and every assertion
    // under it is measuring the wrong thing.
    expect(registered.has("PoppinSans")).toBe(true)
    expect(registered.has("Poppins")).toBe(false)
  })

  it("no source file names a family nothing registers", () => {
    const offenders: string[] = []
    for (const file of sources) {
      for (const stack of declaredStacks(readFileSync(file, "utf8"))) {
        const family = primaryFamily(stack)
        if (!family) continue
        if (GENERIC.has(family) || HOST_FACES.has(family) || registered.has(family)) continue
        offenders.push(`${file}: "${stack.trim()}" — nothing registers "${family}"`)
      }
    }
    expect(
      offenders,
      `A font family the product never loads falls back silently.\n` +
        `Registered: ${[...registered].join(", ")}\n` +
        offenders.join("\n"),
    ).toEqual([])
  })

  it("the sweep is actually reading the tree", () => {
    // A walk that finds nothing passes every assertion above it.
    expect(sources.length).toBeGreaterThan(100)
    expect(sources.some((f) => f.includes("themeHelper"))).toBe(true)
  })
})
