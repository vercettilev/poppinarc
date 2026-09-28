/**
 * THE KILL SWITCH'S LAST KNOWN GOOD ANSWER.
 *
 * `initXStrip` used to treat an unreachable config endpoint as "carry on",
 * with the reasoning that the switch exists for the day X breaks us and on
 * that day it will be reachable. That reasoning is backwards. The day the
 * backend is down or blocked is EXACTLY the day the strip cannot price a
 * mint, cannot validate an asset and cannot complete a trade — and it is also
 * a plausible day for the operator to be reaching for the switch. A control
 * that is guaranteed to be unavailable when it is needed is not a control.
 *
 * So the fetch fails CLOSED now. The obvious cost of that alone would be
 * unacceptable: x.com is an SPA, the strip boots on every page load, and a
 * single 200ms blip would cost a reader the feature for the rest of the
 * session over nothing.
 *
 * This is what makes failing closed affordable. The last successful answer is
 * kept, and it is consulted ONLY when the live fetch throws. The live fetch
 * always wins when it returns. The hard "off" is reserved for the case where
 * there is no cached answer at all — a first run that cannot reach the
 * backend, where "off" is the honest default anyway.
 *
 * The cache deliberately has NO expiry. An expiring cache would re-introduce
 * exactly the failure it exists to prevent: a long backend outage would age
 * the entry out and silently disable the strip for everyone. A stale "on" from
 * a reachable backend is the state we were already in a minute ago; a stale
 * "off" is what the operator asked for and has not yet been able to revoke.
 */

export interface XStripConfig {
  enabled: boolean
  disabledMints: string[]
}

export const X_STRIP_CONFIG_CACHE_KEY = "poppin_x_strip_config"

/**
 * The answer used when the config has never once been fetched successfully.
 * OFF, on purpose — see the header.
 */
export const X_STRIP_FAIL_CLOSED: XStripConfig = {
  enabled: false,
  disabledMints: [],
}

/** Narrow an untrusted stored blob to the shape we rely on. */
export function isXStripConfig(value: unknown): value is XStripConfig {
  if (!value || typeof value !== "object") return false
  const v = value as Partial<XStripConfig>
  return (
    typeof v.enabled === "boolean" &&
    Array.isArray(v.disabledMints) &&
    v.disabledMints.every((m) => typeof m === "string")
  )
}

export async function readXStripConfigCache(): Promise<XStripConfig | null> {
  try {
    if (!chrome?.storage?.local) return null
    const stored = await chrome.storage.local.get(X_STRIP_CONFIG_CACHE_KEY)
    const hit = stored?.[X_STRIP_CONFIG_CACHE_KEY]
    return isXStripConfig(hit) ? hit : null
  } catch {
    return null
  }
}

export async function writeXStripConfigCache(cfg: XStripConfig): Promise<void> {
  try {
    if (!chrome?.storage?.local) return
    await chrome.storage.local.set({
      [X_STRIP_CONFIG_CACHE_KEY]: {
        enabled: cfg.enabled,
        disabledMints: cfg.disabledMints,
      },
    })
  } catch {
    // A cache that failed to write costs the NEXT boot its warm answer, which
    // degrades to fail-closed. Never worth throwing over.
  }
}
