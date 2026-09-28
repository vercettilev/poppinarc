import { defineConfig } from "vitest/config"
import path from "path"

/**
 * The card renders into a shadow root on a page it does not control, so its
 * tests need a DOM. jsdom implements shadow attachment and scoping, which is
 * exactly the boundary under test — it does not implement cascade or layout,
 * and the isolation spec is written to assert only what jsdom can actually
 * decide. See the note at the top of spot-card.isolation.spec.tsx.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
  },
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  resolve: {
    alias: {
      "@spot-catalog": path.resolve(__dirname, "../packages/spot-core/src/catalog/index.ts"),
      "~": path.resolve(__dirname, "./src"),
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  },
})
