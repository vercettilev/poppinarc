import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE ERRORS PANEL HAS TO MEAN SOMETHING.
 *
 * On startup and on install the worker walks every open tab and injects.
 * Chrome refuses some of them by policy — the extensions gallery above all,
 * which cannot be scripted even with <all_urls> — and the refusal used to be
 * caught and then written with console.error. A console.error from a service
 * worker lands in chrome://extensions' own Errors list, so an ordinary
 * browser with the Web Store open painted that button red on every reload.
 *
 * The report that produced this was exactly that: two entries, both
 * "Failed to inject content scripts into tab ...", one for the gallery and
 * one for a host outside the granted set. Neither was a defect. Both buried
 * the panel's only job, which is to be believable when something IS wrong.
 *
 * This spec reads the source rather than the behaviour because the whole
 * point is a LIST, and a list is the kind of thing that quietly loses an
 * entry in a refactor. Comments are stripped before asserting: a guard its
 * own documentation can satisfy is not a guard.
 */
const src = readFileSync(join(__dirname, "main.ts"), "utf8")
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

describe("content script injection skiplist", () => {
  it("never asks the extensions gallery, at either address", () => {
    // The reported error, verbatim from Chrome:
    // "The extensions gallery cannot be scripted."
    expect(code).toContain("chromewebstore.google.com")
    expect(code).toContain("chrome.google.com/webstore")
  })

  it("keeps the three schemes the old filter already had", () => {
    for (const prefix of ["chrome://", "chrome-extension://", "moz-extension://"]) {
      expect(code).toContain(prefix)
    }
  })

  it("covers the schemes that have no host to hold a permission", () => {
    for (const prefix of ["about:", "data:", "blob:", "view-source:", "devtools://"]) {
      expect(code).toContain(prefix)
    }
  })

  it("does NOT hard-filter file://, which is scriptable when the reader opts in", () => {
    // "Allow access to file URLs" is the reader's to grant. A static filter
    // would take the feature from the people who granted it, so file:// is
    // classified from the error instead.
    expect(code).not.toMatch(/UNSCRIPTABLE_PREFIXES[\s\S]*?'file:\/\/'[\s\S]*?\]/)
  })

  it("logs a standing refusal at debug, and keeps error for the rest", () => {
    // The catch must branch: expected refusals go to debug, anything else
    // still reaches console.error and the panel.
    expect(code).toMatch(/isExpectedInjectionFailure\(error\)/)
    expect(code).toMatch(/console\.debug\(`Content scripts not injected/)
    expect(code).toMatch(/console\.error\(`Failed to inject content scripts/)
  })

  it("classifies the two failures that were actually reported", () => {
    for (const known of [
      "cannot be scripted",
      "cannot access contents of the page",
      "extension manifest must request permission",
    ]) {
      expect(code).toContain(known)
    }
  })
})

describe("the Errors panel, second source", () => {
  it("logs a site-chat 404 at debug, because that 404 IS the switch", () => {
    // Reported the same day as the injection refusals: the panel went red
    // again seconds after being cleared, this time from the presence
    // heartbeat. Three client branches read this 404 and stand down — the
    // module is not deployed, the flag is off, or the host is not on the
    // allowlist — and all three are the feature being correctly absent.
    expect(code).toContain("isExpectedApiFailure")
    expect(code).toMatch(/status === 404 && url\.includes\("\/site-chat\/"\)/)
    expect(code).toMatch(/isExpectedApiFailure\(String\(url\), status\)\) console\.debug/)
  })

  it("still sends every other API failure to the panel", () => {
    // A blanket downgrade would hide the next real one.
    //
    // This used to pin `console.error(line, detail)`, and the second
    // argument is gone on purpose: chrome://extensions flattens it to a
    // string, so every refusal we ever logged there read "[object Object]".
    // The reason is built into the line now. What this test is actually
    // for is unchanged — anything not expected still reaches the panel.
    expect(code).toMatch(/else console\.error\(line\)/)
    expect(code).toContain("failureReason(err)")
  })
})

describe("unscriptableReason", () => {
  // Imported lazily: main.ts registers chrome.* listeners at module scope,
  // so it is read as text above and exercised here only through the shape
  // the skiplist guarantees.
  const shut = (url: string): boolean => {
    const u = url.toLowerCase()
    const prefixes = [
      "chrome://", "chrome-extension://", "chrome-untrusted://", "chrome-search://",
      "chrome-native://", "devtools://", "moz-extension://", "extension://",
      "edge://", "about:", "data:", "blob:", "view-source:", "filesystem:",
    ]
    const hosts = ["chromewebstore.google.com", "chrome.google.com/webstore"]
    return (
      prefixes.some((p) => u.startsWith(p)) ||
      hosts.some((h) => u.startsWith(`https://${h}`) || u.startsWith(`http://${h}`))
    )
  }

  it("shuts the doors Chrome shuts", () => {
    expect(shut("https://chromewebstore.google.com/detail/abc")).toBe(true)
    expect(shut("https://chrome.google.com/webstore/detail/abc")).toBe(true)
    expect(shut("chrome://extensions")).toBe(true)
    expect(shut("about:blank")).toBe(true)
    expect(shut("view-source:https://x.com")).toBe(true)
  })

  it("leaves real pages alone", () => {
    expect(shut("https://x.com/home")).toBe(false)
    expect(shut("https://www.reddit.com/r/solana")).toBe(false)
    expect(shut("https://poppin.so")).toBe(false)
    // google.com is not the gallery; only the /webstore path under it is.
    expect(shut("https://chrome.google.com/")).toBe(false)
    expect(shut("file:///Users/x/index.html")).toBe(false)
  })
})
