import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = join(__dirname, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

/**
 * MEASURED 2026-09-18 on x.com: no __poppin marker in the MAIN world at all.
 * The bridge's built file was a loader (`import(chrome.runtime.getURL(...))`),
 * which cannot run where there is no chrome.runtime, so no Phantom door ever
 * worked in a built extension. The bridge is built whole, as an IIFE, by a
 * second vite config that the build script always runs.
 */
describe("the page wallet bridge is built whole", () => {
  it("the build runs the bridge config after the main build", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).toMatch(/vite build && vite build -c vite\.bridge\.config\.ts/)
  })

  it("the bridge config emits one self-contained IIFE at the injected path", () => {
    const cfg = read("vite.bridge.config.ts")
    expect(cfg).toMatch(/formats: \["iife"\]/)
    expect(cfg).toMatch(/inlineDynamicImports: true/)
    expect(cfg).toMatch(/fileName: \(\) => "src\/entries\/contentScript\/pageWallet\.js"/)
    expect(cfg).toMatch(/emptyOutDir: false/)
  })

  it("the proactive injection is scoped to the hosts where the chip trades", () => {
    const bg = read("src/entries/background/main.ts")
    expect(bg).toMatch(/\(x\\\.com\|twitter\\\.com\|reddit\\\.com\)\\\/\/\.test\(url\)\) \{\s*await ensurePageWallet\(tabId\)/)
  })
})
