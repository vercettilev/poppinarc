import path from "path"
import { defineConfig } from "vite"

/**
 * THE PAGE WALLET BRIDGE, BUILT WHOLE.
 *
 * pageWallet.ts runs in the page's MAIN world (chrome.scripting, world
 * "MAIN"), where there is no chrome.runtime. The main build emits it the
 * way it emits every content script: a one-line loader that does
 * `import(chrome.runtime.getURL(...))`, which throws on the first token in
 * that world, so the bridge never registered and every Phantom door read
 * "Phantom is not on this page" (measured 2026-09-18, window keys on x.com
 * carried no __poppin marker at all). This second build overwrites that
 * loader with a self-contained IIFE, web3.js included, so the injected file
 * is the bridge itself.
 */
export default defineConfig({
  resolve: {
    alias: { "~": path.resolve(__dirname, "./src") },
  },
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
    lib: {
      entry: path.resolve(__dirname, "src/entries/contentScript/pageWallet.ts"),
      name: "PoppinPageWallet",
      formats: ["iife"],
      fileName: () => "src/entries/contentScript/pageWallet.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
