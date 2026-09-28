/**
 * DIAGNOSTICS THAT SURVIVE THE PRODUCTION BUILD, AND A SWITCH A READER CAN
 * REACH.
 *
 * vite.config.ts lists console.log, console.debug, console.trace and
 * console.warn in esbuild's `pure` array, and production minifies, so every
 * one of those calls is DELETED from the shipped bundle. That is the right
 * default — a trading chip should not narrate itself into a stranger's
 * console on every page — but it also means the debug lines this codebase
 * writes to explain a silent failure have never once been readable in a real
 * browser. They appear in vitest output, which is not where a field report
 * comes from. Two investigations were planned around lines that could not
 * exist.
 *
 * console.info is deliberately not on that list, so it is what a diagnostic
 * that must survive uses, and it stays silent until somebody asks.
 *
 * THE ASKING IS A SWITCH IN SETTINGS, not a line typed into DevTools. The
 * first version of this said "run localStorage.setItem(...) in the console",
 * which is a developer's instruction handed to whoever is holding the bug —
 * and it was pasted straight into a shell, where it meant nothing. A person
 * reporting that a chip did not appear should be able to turn the
 * explanation on from the panel they already have open.
 *
 * chrome.storage.local, because Settings and the page are different worlds
 * and only extension storage is shared between them. Read once and then kept
 * current by the change listener, so flipping the switch takes effect on the
 * next chip rather than the next reload. localStorage stays as a developer's
 * escape hatch for a page where the extension context is gone.
 */
export const DEBUG_KEY = "poppin_debug"

let armed = false
let asked = false
/**
 * THE ESCAPE HATCH, AND WHY IT IS STICKY.
 *
 * The storage read lands a few hundred milliseconds after the page starts
 * and used to assign `armed` outright, which quietly switched the hatch
 * back OFF: a reader who set localStorage got diagnostics for a moment and
 * then silence, with nothing to explain it. The hatch exists precisely for
 * the case where the toggle is unreachable — a freshly loaded unpacked
 * build carries an EMPTY chrome.storage, so its panel switch is off even
 * though the same reader had it on a minute ago in another install — so it
 * has to outrank what storage says rather than lose to it.
 */
let hatch = false

/**
 * WHAT WAS SAID BEFORE ANYONE WAS LISTENING.
 *
 * The flag lives in chrome.storage and arrives on a promise, so for the
 * first few hundred milliseconds of a page this module is switched off no
 * matter what the reader set. That window is exactly when the interesting
 * lines happen: a strip reports which site it decided it was on, and then
 * whether it found anything, and both were being dropped on the floor.
 *
 * Measured: a reader with diagnostics ON watched a Reddit page produce no
 * poppin line at all, which reads as "the strip never ran" and was not
 * true. So early lines are kept, and if the flag turns out to be on they
 * are printed in order the moment it lands.
 *
 * Capped, because this must never become a leak on a page that sits open
 * for hours with diagnostics off.
 */
const EARLY_MAX = 60
let early: unknown[][] | null = []
const flushEarly = (): void => {
  const held = early
  early = null
  if (!armed || !held) return
  for (const parts of held) console.info("[poppin]", ...parts)
}

const ask = (): void => {
  if (asked) return
  asked = true
  try {
    void chrome.storage.local.get(DEBUG_KEY).then((got) => {
      armed = hatch || got?.[DEBUG_KEY] === true
      flushEarly()
    })
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[DEBUG_KEY]) return
      armed = hatch || changes[DEBUG_KEY].newValue === true
      flushEarly()
    })
  } catch {
    // No extension context (an orphaned page, or a document with no
    // chrome.* at all). The escape hatch below still works.
  }
  try {
    if (localStorage.getItem("poppin:debug") === "1") {
      hatch = true
      armed = true
      flushEarly()
    }
  } catch {
    // A content script shares the page's storage and some sites forbid it.
    // A diagnostic may never be the thing that breaks a chip.
  }
}

export const debugOn = (): boolean => {
  ask()
  return armed
}

export const dbg = (...parts: unknown[]): void => {
  const on = debugOn()
  if (!on && early !== null) {
    // The flag has not landed yet, so this may still turn out to be wanted.
    if (early.length < EARLY_MAX) early.push(parts)
    return
  }
  if (!on) return
  console.info("[poppin]", ...parts)
}
