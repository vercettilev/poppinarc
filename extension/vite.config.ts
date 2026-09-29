import webExtension from "@ugurkellecioglu/vite-plugin-web-extension"
import react from "@vitejs/plugin-react"
import path from "path"
import modify from "rollup-plugin-modify"
import { defineConfig, loadEnv } from "vite"
import svgr from "vite-plugin-svgr"
import { getManifest } from "./src/manifest"

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  // Local testing only. See getManifest's grantUpFront: without this a
  // `Load unpacked` build has no permissions and no content script ever runs.
  const testBuild = env.POPPIN_TEST_BUILD === "true"
  // The Arc edition (mode "arc", .env.arc): its own name, its own id, its own
  // backend. See getManifest's arcEdition.
  const edition = env.NEXT_PUBLIC_ARC_EDITION === "true" ? "arc" : "solana"
  // Mode "arc-mainnet" (.env.arc-mainnet) is the same edition on Arc mainnet.
  const arcNetwork = env.NEXT_PUBLIC_ARC_NETWORK === "mainnet" ? "mainnet" : "testnet"
  const prodLike = mode === "production" || mode === "arc" || mode === "arc-mainnet"
  if (testBuild) {
    console.log(
      "\n  ⚠  TEST BUILD — scripting/tabs/<all_urls> are REQUIRED in this " +
        "manifest.\n     Do not ship this to the store.\n",
    )
  }

  // WHAT GETS BAKED INTO THE SHIPPED BUNDLE — READ BEFORE CHANGING.
  //
  // `define` is a compile-time TEXT SUBSTITUTION: every key of this object is
  // written verbatim into the JavaScript that goes to the Chrome Web Store.
  //
  // This used to be `Object.entries(env)` — every key `loadEnv(mode, cwd, "")`
  // returns. An empty prefix means "return everything", and that is not just
  // the .env files: it is the PACKAGING MACHINE'S ENTIRE ENVIRONMENT. Verified
  // in a real build of dist/: the service worker contained COMMONPROGRAMFILES,
  // OneDrive, USERNAME, NUMBER_OF_PROCESSORS and PROMPT. Any secret exported in
  // the shell that ran `npm run build` — an AWS key, a DATABASE_URL, a
  // GITHUB_TOKEN — shipped to every user in plaintext, extractable by
  // unzipping the CRX. Releases are packaged on a developer laptop
  // (scripts/package.sh), so there is not even a build log to audit afterwards.
  //
  // The rule now: an ALLOWLIST, never a spread. `NEXT_PUBLIC_*` is the public
  // namespace by convention, plus exactly two build-time switches that the
  // source reads through `process.env`. Anything else stays out of the bundle.
  //
  // Adding a variable? It must be NEXT_PUBLIC_-prefixed, or added to
  // EXTRA_INLINED_KEYS below with a reason. Never widen this back to a spread.
  const EXTRA_INLINED_KEYS = [
    // read by src/components/SpotCard/* to gate [poppin-spot] debug logging
    "POPPIN_TEST_BUILD",
    // read across src for dev-only branches; vite would otherwise inline it
    // itself, but `define: {"process.env": ...}` replaces the whole object.
    "NODE_ENV",
  ]

  const inlinedEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        key.startsWith("NEXT_PUBLIC_") || EXTRA_INLINED_KEYS.includes(key),
    ),
  )

  const processEnvValues = { "process.env": inlinedEnv }
  return {
    define: processEnvValues,
    plugins: [
      react(),
      webExtension({
        manifest: getManifest(Number(env.MANIFEST_VERSION), {
          externally_connectable: {
            matches:
              processEnvValues[
                "process.env"
              ].NEXT_PUBLIC_HOST_PERMISSIONS!.split(","),
          },
          "commands": {
            "open-side-panel": {
              "suggested_key": {
                "default": 'Ctrl+Period'
              },
              "description": "Open the side panel"
            }
          },
          // The oauth2 block retired with chrome.identity: sign-in is one
          // web-redirect flow in every browser now, and a manifest key that
          // names an OAuth client nothing calls is only a question for the
          // next reviewer.
          ...(process.env.NODE_ENV === "development" && {
            content_scripts: [
              {
                js: ["src/entries/contentScript/primary/main.tsx"],
                matches: ["*://*/*"],
              },
            ],
          }),
        }, testBuild, edition, arcNetwork),
        additionalInputs: { html: ["src/entries/welcome/index.html"],scripts: ["src/entries/contentScript/primary/main.tsx", "src/entries/contentScript/urlListener.ts", "src/entries/contentScript/pageWallet.ts", "src/entries/contentScript/previewImg.ts"] },
      }),
      svgr(),
    ],
    esbuild: {
      pure: prodLike ? ["console.log", "console.debug", "console.trace", "console.warn"] : [],
    },
    build: {
      assetsInlineLimit: 0,
      /**
       * MINIFIED IN PRODUCTION, READABLE IN DEV.
       *
       * This was `false` unconditionally, which is a bigger deal than it
       * looks: the content script is injected into EVERY page the reader
       * visits, and it was measured pulling 4.77 MB of JavaScript with it.
       * Minifying takes the same graph to 2.46 MB — 48% off, for one line
       * and no behaviour change.
       *
       * It also makes the `esbuild.pure` list above do its job for the first
       * time. Those annotations only take effect when minification runs, so
       * until now 33 console.log/warn/debug calls shipped in every build
       * despite the config asking for them to be stripped.
       *
       * Dev stays unminified, because a readable content script in the page
       * inspector is worth more than kilobytes on a machine that is building
       * the thing.
       */
      minify: prodLike ? "esbuild" : false,
      rollupOptions: {
        plugins: [
          /**
           * DEAD, and kept only until somebody decides to delete it.
           *
           * The intent is right — Firebase Auth's `_loadJS` injects a remote
           * script, which MV3's CSP forbids — but the regex matches nothing.
           * Verified by building both minified and not: `_loadJS` appears
           * nowhere in the output, because the file that defines it
           * (firebase-auth-web-extension.js) is a standalone UMD bundle that
           * never enters this graph. The plugin is a no-op today, so it is
           * also not what to reach for if remote-script loading ever does
           * appear.
           */
          modify({
            find: /function\s+_loadJS\(url\)\s*\{/,
            replace:
              'function _loadJS(url) {return new Promise(res => res("")); ',
          }),
        ],
      },
    },
    resolve: {
      alias: {
        // The curated catalog, straight from source. The package root would
        // drag @solana/web3.js into the content script; the catalog module
        // imports only types and costs a few KB. On-device tweet matching
        // depends on this staying true.
        "@spot-catalog": path.resolve(__dirname, "../packages/spot-core/src/catalog/index.ts"),
        "~": path.resolve(__dirname, "./src"),
      },
    },
  }
})
