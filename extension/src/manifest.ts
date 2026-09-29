import pkg from "../package.json"

const sharedManifest: Partial<chrome.runtime.ManifestBase> = {
  // NO default_locale, and no _locales/: the 54 message files there existed
  // only to give the Chrome Web Store a localised listing name, and every
  // one of them still said "Poppin - Social Browsing / Comment anywhere,
  // connect everywhere" — the retired product, shipped in 54 languages.
  // chrome.i18n is never called, so the manifest's own name and description
  // are now the single source. Re-add both together when there is somebody
  // to write real translations of the current ones.
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAgBdE0vDa6bMAuC+xnF8VN+smQDFaynTvDDL0MQ9mK7gM2+3YIcWb0xvFnFKpUdlBc1Zlq2N8NB0wwFaX4x8a0u+Tag1oD2wyIYjruqudoFSimVmAhrPwbObUMC77s3XGxoezuSnhL4Y7XQu5PXcwQjvRZzl1f6ScNIC8ZB0f8hrqlPKwdWUe06ICCquhDjFIkhPnAOhGjCEe/vtpfftTbO/n47c703qVE7u8qC43S8M64LV8Q+E73d+EpXVG31RGewgshtMWvURlpEU5cMtMHTytGOXbBBGiDbCUvNStEpSg6FLe9nhG2zWOmC1dIwPS5QVQtXZ4lYrhfLDeuM3z1wIDAQAB",
  icons: {
    16: "icons/logo.png",
    32: "icons/logo.png",
    48: "icons/logo.png",
    128: "icons/logo.png",
  },
  // "tabs" is deliberately ABSENT — dropped as dead weight, NOT to shrink the
  // install prompt. Read both halves before adding it back:
  //
  // WHY IT IS SAFE TO DROP. Per Chrome's tabs docs, the four sensitive Tab
  // properties (url, pendingUrl, title, favIconUrl) unlock via EITHER "tabs"
  // OR a host permission matching that tab. We request <all_urls> in the same
  // call (permissionHelper.requestPermissions), so every real read is already
  // covered: tab.url across background injection + joinChatRoom +
  // GET_CURRENT_URL, and tab.title in pageContentHelper.extractPageContext.
  // The only reads "tabs" additionally enabled were on chrome:// and
  // chrome-extension:// tabs, which <all_urls> does not match — and every one
  // of those call sites already skips non-http(s) URLs by design. The
  // GET_PAGE_CANDIDATES comment in background/main.ts is the same lesson
  // learned in production: it is the HOST grant that fills tab.url.
  //
  // WHY IT DOES NOT MAKE THE PROMPT SMALLER. Chrome's permission-warning docs:
  // "the 'tabs' warning won't show if the extension also requests
  // '<all_urls>'." Since the two are always requested together here, the
  // "Read your browsing history" line was ALREADY suppressed — the user sees
  // the same single all-sites warning either way. Removing "tabs" buys least
  // privilege and a smaller blast radius if <all_urls> is ever narrowed (a
  // reader who sets Site access to "on specific sites" keeps API permissions
  // but loses host ones), not a friendlier dialog. The only lever that would
  // genuinely change that dialog is dropping <all_urls> itself for activeTab
  // — which ends the pop-up-anywhere product.
  optional_permissions: ["scripting"],
  /**
   * THERE IS NO `host_permissions` KEY HERE, AND THAT IS THE POINT.
   *
   * WHY OUR OWN ORIGIN IS NEEDED AT ALL. Brave does not inject
   * `chrome.runtime` into externally_connectable pages (a deliberate
   * fingerprinting stance), so the auth page cannot hand its token to the
   * extension directly there. The fallback is helpers/signinRelay, which
   * rides the primary CONTENT SCRIPT, and a content script only runs where
   * the extension has host access. With every origin optional and none
   * granted, that relay does not exist: on Brave the reader finished
   * sign-in on the web, saw "You're in", and the extension never heard a
   * word. That reasoning is still true and is why any of this exists.
   *
   * WHY IT IS NOT REQUIRED. For one day it was: `host_permissions:
   * ["https://*.poppin.so/*"]`, one origin, ours, the narrowest possible
   * repair. It is also the one shape that cannot ship as an UPDATE. The
   * store build everybody currently runs (1.0.329) declares no required
   * host permission at all, and Chrome DISABLES an extension whose update
   * adds a required permission the user has not already granted, until
   * they go and re-enable it by hand. Measured: 22 installs in 30 days,
   * most of which never finished onboarding and so never granted
   * `<all_urls>`. Roughly half the install base would have gone dark,
   * silently, to repair sign-in for a Brave population we have never
   * counted.
   *
   * WHAT REPLACES IT. The origin is optional, and helpers/openAuthTab asks
   * for it at the moment the reader presses "Sign in", which is a real
   * user gesture and therefore allowed to prompt. The grant lands BEFORE
   * the auth tab is created, so the relay is in place by the time the
   * token comes back. A refusal is not a dead end: in Chrome the direct
   * `chrome.runtime` channel needs no host permission, and the relay is
   * only ever the Brave fallback, so sign-in opens either way.
   *
   * Anything added to the list below is a permission the reader chooses.
   * Anything added ABOVE it, in a `host_permissions` key, is an update
   * that turns the extension off for people who are not reading this.
   */
  optional_host_permissions: ["<all_urls>", "https://*.poppin.so/*"],
  // "identity" left with the Chrome-only native sign-in it existed for:
  // chrome.identity.getAuthToken is CHROME's account plumbing, every other
  // Chromium shims or stubs it (Brave ends on a Google 400 page), and the
  // product now runs ONE web-redirect sign-in flow in every browser. One
  // fewer permission for the Web Store review to weigh.
  // "notifications" carries a Chrome install warning ("Display
  // notifications") and earns it: a standing order that fills while the
  // reader is away has exactly one honest channel to them, and this is it.
  /**
   * AUDITED 2026-08-24 — call sites counted, and each line names the FEATURE
   * a store reviewer would be told about, not the API. See SCOPE.md for what
   * is in the product and what is deliberately not.
   *
   *   storage (63 sites)
   *     Everything the extension remembers on this machine: the reader's
   *     watchlist, their price alerts, which notification kinds they left
   *     on, the cached session, and the watermarks that stop a filled order
   *     being announced twice. None of it is sent to us.
   *
   *   sidePanel (13 sites)
   *     The trading panel itself — balance, holdings, open orders, buy and
   *     sell. The chip under a tweet and the card on a page are doors into
   *     it; it is where the product lives.
   *
   *   alarms (3 sites)
   *     Runs the periodic check that makes standing orders and alerts
   *     meaningful: has a limit order filled or been cancelled on chain,
   *     has a price the reader asked about been reached, has something they
   *     hold moved 10%. A limit order nobody watches is a promise the
   *     product cannot keep, and this is what watches it while no page of
   *     ours is open.
   *
   *   notifications (7 sites)
   *     How those answers reach a reader who is not looking: your order
   *     filled, the price you asked about, your position moved. Each kind
   *     has its own switch in Settings, checked at the moment of sending.
   *
   *   scripting + <all_urls> (optional, requested during onboarding)
   *     Draws the price chip under tradeable tweets and the card on a page
   *     that is about an asset. Optional on purpose: the extension installs
   *     silent and asks when the reader chooses to turn matching on.
   *
   * REMOVED in this audit: contextMenus (0 call sites — the prediction
   * era's right-click entry died with the widget popup) and, earlier the
   * same day, identity (the Chrome-only sign-in path was deleted).
   */
  permissions: ["storage", "sidePanel", "alarms", "notifications"],
  // There is no `oauth2` block. It retired together with the `identity`
  // permission above: sign-in is one web-redirect flow in every browser now,
  // so a manifest key naming an OAuth client that nothing calls would only be
  // a question for the next reviewer. vite.config.ts says the same at its
  // manifest-injection site — and no longer injects it. Nothing reads
  // NEXT_PUBLIC_GOOGLE_EXTENSION_CLIENT_ID; it was dropped from .env on
  // 2026-09-04.
  side_panel: {
    default_path: "src/entries/side_panel/index.html",
  },
  web_accessible_resources: [
    {
      resources: [
        "fonts/Poppins-Bold.ttf",
        "fonts/Poppins-Light.ttf",
        "fonts/Poppins-Medium.ttf",
        "fonts/Poppins-Regular.ttf",
        "fonts/Poppins-SemiBold.ttf",
        "fonts/Poppins-Thin.ttf",
        /* THE REWARD, 34KB, fetched the first time a trade lands and never
           on a page that has none. The source gif is 1080px, five seconds
           and 3.4MB — fine on the onboarding page it was drawn for, and
           impossible here: the content script is 399KB after the shell
           surgery that took it down from 2.2MB, and baking this in as a
           data URI would have put 46KB of base64 on every page load for a
           moment most page loads never reach. */
        "pop-reward.webp",
        /* The onboarding coach's face, 17KB, fetched once on the first
           chip after install and never again. The data-URI copy the
           welcome page uses is the dark-disc rendering; the brand mark is
           the blue-ring one, and this is the only place the blue-ring
           file already lives. */
        "icons/logo.png",
      ],
      matches: ["<all_urls>"],
    },
  ],
}

const browserAction = {
  default_icon: {
    16: "icons/logo.png",
    32: "icons/logo.png",
  },
}

const ManifestV3 = {
  ...sharedManifest,
  action: browserAction,
  background: {
    service_worker: "src/entries/background/serviceWorker.ts",
  },
}

/**
 * TEST BUILDS ONLY — promote the optional permissions to required.
 *
 * In production `scripting`, `tabs` and `<all_urls>` are optional and are
 * requested by the onboarding flow, and they should stay that way: asking for
 * `<all_urls>` up front is the most scrutinised thing an extension can do in
 * Chrome review, and an extension that reads every page has to justify it at
 * install time rather than when a user first asks for the feature.
 *
 * But it makes a `Load unpacked` build useless. Nothing grants those
 * permissions, so `injectContentScripts` returns early, no content script ever
 * runs, and every feature silently does nothing — with no error anywhere,
 * because a permission that was never granted is not an error. That is a real
 * afternoon lost, and it is lost the same way every time.
 *
 * So this flag exists purely to make a local build behave like an installed,
 * onboarded one. It is off unless POPPIN_TEST_BUILD is set, it never runs in
 * the store build, and the promoted permissions are removed from the optional
 * lists so Chrome does not see the same permission declared twice.
 */
function grantUpFront(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const permissions = [
    ...((manifest.permissions as string[] | undefined) ?? []),
    'scripting',
  ];
  const { optional_permissions: _p, optional_host_permissions: _h, ...rest } = manifest;
  return {
    ...rest,
    permissions,
    // Dev keeps the narrow one too: the store build's shape is what the
    // relay depends on, and a dev build that differs hides the bug.
    host_permissions: ['<all_urls>', 'https://*.poppin.so/*'],
  };
}

/**
 * THE ARC EDITION IS A SEPARATE EXTENSION, NOT A MODE OF THIS ONE.
 *
 * It installs next to the store build, so it must not share its id: the `key`
 * above pins every build to chhcknncbbmnmhkaacbkfdmkahaemdkk, and two
 * extensions with one id cannot both be installed. Dropping the key gives the
 * Arc build its own id (Chrome derives one from the unpacked folder's path,
 * stable as long as the folder stays put). Sign-in does not depend on the id:
 * app.poppin.so always announces the token with window.postMessage, and
 * helpers/signinRelay forwards it from whichever extension is listening.
 */
export type Edition = "solana" | "arc"

function arcEdition(manifest: Record<string, unknown>): Record<string, unknown> {
  const { key: _key, ...rest } = manifest
  return {
    ...rest,
    name: "Poppin Arc (demo)",
    short_name: "Poppin Arc",
    description:
      "Buy and sell what you read. A live price under the post, one tap to buy or sell.",
  }
}

export function getManifest(
  manifestVersion: number,
  additionalManifest: Partial<chrome.runtime.ManifestBase>,
  /** Set by vite from POPPIN_TEST_BUILD. Never true in a store build. */
  testBuild = false,
  /** Set by vite from NEXT_PUBLIC_ARC_EDITION. */
  edition: Edition = "solana",
): chrome.runtime.ManifestV3 {
  const manifest = {
    author: pkg.author,
    description: pkg.description,
    name: pkg.displayName ?? pkg.name,
    /**
     * THE NAME IS THE STORE LISTING'S TITLE, and the store gives it 75
     * characters while every cramped surface in Chrome gives it far less.
     * The title is where somebody browsing decides whether this is for
     * them, so it says where you trade rather than just the brand; the
     * side panel's header and the extensions menu take `short_name`
     * instead, which is what it exists for. Lev, 2026-09-19, on dropping
     * the asset from the title: a dozen extensions trade tokens, ours is
     * the one that does it where you are reading.
     */
    short_name: "Poppin",
    version: pkg.version,
    ...additionalManifest
  }

  if (manifestVersion === 3) {
    const v3 = {
      ...manifest,
      ...ManifestV3,
      manifest_version: manifestVersion,
    }
    const granted = testBuild ? grantUpFront(v3) : v3
    return (
      edition === "arc" ? arcEdition(granted) : granted
    ) as chrome.runtime.ManifestV3
  }

  throw new Error(
    `Missing manifest definition for manifestVersion ${manifestVersion}`
  )
}
