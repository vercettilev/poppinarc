// ESLint flat config for extension-new.
//
// WHY THIS FILE EXISTS: extension-new has been on ESLint 9 (see
// package-lock.json → node_modules/eslint = 9.39.4) since the dependency was
// added, and ESLint 9 reads ONLY `eslint.config.*`. There has never been an
// `.eslintrc` here — `git log --diff-filter=D -- 'extension-new/.eslintrc*'`
// returns nothing — so `npm run lint` exited 2 ("could not find a config
// file") on every run since the bump. Lint has never once executed against
// this package's source.
//
// The rule set is reconstructed from what package.json already installs and
// therefore intends: @eslint/js, typescript-eslint, eslint-plugin-react,
// eslint-plugin-react-hooks, globals. Nothing is disabled wholesale to make
// the run green — the honest error count is the point. Turning this into a
// blocking CI gate is a separate, deliberate step that comes after the
// existing violations are burned down.
//
// Type-aware rules (`recommendedTypeChecked`) are deliberately NOT enabled:
// they need a full program per run and this package already has
// `npm run typecheck` (tsc --noEmit, strict:true) covering type correctness.

import js from "@eslint/js"
import react from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    // Build output and static assets are not source. `dist/` is the packaged
    // extension, `public/` and `src/assets/` are copied verbatim.
    ignores: ["dist/**", "public/**", "src/assets/**", "node_modules/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        // MV3 surfaces: content scripts and side panel run in a page context,
        // the background entry runs as a service worker, and every entry sees
        // the `chrome` namespace.
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      // vite/tsconfig use the automatic runtime (jsx: "react-jsx"), so `React`
      // is never in scope and must not be required to be.
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
)
