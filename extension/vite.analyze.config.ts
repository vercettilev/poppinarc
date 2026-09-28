import { writeFileSync } from "node:fs"
import base from "./vite.config"

/**
 * The real build config plus ONE plugin: a chunk manifest written into dist.
 *
 * Fingerprinting chunk contents by grepping for identifiers cannot tell a
 * module's DEFINITION from a mere import of its name — measured: "PRESET_USD"
 * matched in two chunks when the module can only live in one. Rollup already
 * knows the exact module list per chunk; this asks it instead of guessing.
 *
 *   npx vite build --config vite.analyze.config.ts --minify false
 *
 * Analysis only. Nothing ships from this config; build.sh does not use it.
 */
export default async (env: { mode: string; command: "build" | "serve" }) => {
  const cfg = await (typeof base === "function" ? base(env as never) : base)
  cfg.plugins = [
    ...(cfg.plugins ?? []),
    {
      name: "chunk-manifest",
      generateBundle(_: unknown, bundle: Record<string, unknown>) {
        const out: Record<string, unknown> = {}
        for (const [file, c] of Object.entries(bundle) as [string, any][]) {
          if (c.type !== "chunk") continue
          out[file] = {
            isEntry: c.isEntry,
            bytes: c.code.length,
            imports: c.imports,
            dynamicImports: c.dynamicImports,
            modules: Object.keys(c.modules ?? {}).map((m) =>
              m.replace(/^.*node_modules\//, "npm:").replace(/^.*extension-new\//, ""),
            ),
          }
        }
        writeFileSync("dist/chunk-manifest.json", JSON.stringify(out, null, 1))
      },
    },
  ]
  return cfg
}
