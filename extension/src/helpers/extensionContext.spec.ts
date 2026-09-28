import { afterEach, describe, expect, it, vi } from "vitest"
import { addCustomFonts } from "./fontHelper"
import { extensionAlive } from "./extensionContext"

/**
 * THE PAGE THAT OUTLIVED ITS EXTENSION.
 *
 * Reported from the Errors panel as two entries that arrive together after an
 * extension reload with X still open: "Uncaught Error: Extension context
 * invalidated." and its in-promise twin. Both are Chrome's own error, raised
 * by a `chrome.*` call on an orphaned page, and neither is a fault the reader
 * can act on beyond reloading the tab.
 *
 * The synchronous half is the one these tests pin, because it is the one that
 * breaks something real: `chrome.runtime.getURL` throws WHERE IT STANDS, and
 * it stands inside a React mount. X keeps mounting cells on a dead page, so
 * the throw repeats for as long as the reader keeps scrolling.
 */

type Testable = { chrome?: { runtime?: { id?: string; getURL?: (p: string) => string } } }
const g = globalThis as unknown as Testable

/** The real thing: Chrome clears runtime.id and leaves the API object behind,
 *  with every method still callable and every call throwing. */
const orphanThePage = () => {
  g.chrome = {
    runtime: {
      id: undefined,
      getURL: () => {
        throw new Error("Extension context invalidated.")
      },
    },
  }
}

const liveExtension = () => {
  g.chrome = { runtime: { id: "abc", getURL: (p: string) => `chrome-extension://abc${p}` } }
}

afterEach(() => {
  delete g.chrome
  document.head.innerHTML = ""
  vi.restoreAllMocks()
})

describe("extensionAlive", () => {
  it("says yes while the extension is behind the page", () => {
    liveExtension()
    expect(extensionAlive()).toBe(true)
  })

  it("says no once the id is cleared", () => {
    orphanThePage()
    expect(extensionAlive()).toBe(false)
  })

  it("says no where there is no chrome at all, without throwing", () => {
    // Reading an undeclared global is a ReferenceError, not undefined. This
    // module loads in contexts that have no extension APIs.
    delete g.chrome
    expect(() => extensionAlive()).not.toThrow()
    expect(extensionAlive()).toBe(false)
  })
})

describe("font injection on a page whose extension is gone", () => {
  it("injects the faces while the extension is alive", () => {
    liveExtension()
    addCustomFonts()
    const style = document.head.querySelector("style[data-poppin-fonts]")
    expect(style).not.toBeNull()
    expect(style!.textContent).toContain("chrome-extension://abc/fonts/Poppins-Bold.ttf")
  })

  it("does not throw on an orphaned page", () => {
    orphanThePage()
    // The failure this replaces: an uncaught error thrown out of a component
    // mount, repeated on every cell X rendered afterwards.
    expect(() => addCustomFonts()).not.toThrow()
  })

  it("leaves no half-built style tag behind when it bails", () => {
    orphanThePage()
    addCustomFonts()
    // Bailing at the top matters: a <style> appended with a thrown-through
    // body would be a font-face block declaring nothing, and the idempotence
    // marker would then stop the real injection after a reload.
    expect(document.head.querySelector("style[data-poppin-fonts]")).toBeNull()
  })

  it("still injects for a live extension after a dead one bailed", () => {
    orphanThePage()
    addCustomFonts()
    liveExtension()
    addCustomFonts()
    expect(document.head.querySelector("style[data-poppin-fonts]")).not.toBeNull()
  })
})
