// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { composeWithCard } from "./composer"

/**
 * This drives markup that is NOT ours, so the tests that matter most are
 * the ones where X has changed something. Every failure has to return
 * false, because false is what puts the caller back on the intent URL with
 * the clipboard already loaded; a thrown error would strand the reader
 * with no post and no card.
 */
function fakeX(
  opts: { button?: boolean; editor?: boolean; fileInput?: boolean; deaf?: boolean } = {},
) {
  const { button = true, editor = true, fileInput = true, deaf = false } = opts
  document.body.innerHTML = ""
  if (button) {
    const a = document.createElement("a")
    a.setAttribute("data-testid", "SideNav_NewTweet_Button")
    a.addEventListener("click", () => {
      // X mounts the modal a tick later, client-side.
      setTimeout(() => {
        if (editor) {
          const ed = document.createElement("div")
          ed.setAttribute("data-testid", "tweetTextarea_0")
          ed.setAttribute("contenteditable", "true")
          document.body.appendChild(ed)
        }
        if (fileInput) {
          const inp = document.createElement("input")
          inp.type = "file"
          inp.setAttribute("data-testid", "fileInput")
          // X shows a preview once it accepts the file; that preview is the
          // only thing composeWithCard is allowed to trust.
          // `deaf` models the real failure: the input is present, the
          // assignment succeeds, and X attaches nothing.
          if (!deaf) {
            inp.addEventListener("change", () => {
              const box = document.createElement("div")
              box.setAttribute("data-testid", "attachments")
              box.appendChild(document.createElement("img"))
              document.body.appendChild(box)
            })
          }
          document.body.appendChild(inp)
        }
      }, 20)
    })
    document.body.appendChild(a)
  }
}

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })

beforeEach(() => {
  /* jsdom ships no usable DataTransfer, and a FileList cannot be built any
     other way. This stands in for the browser's so the choreography under
     test is ours rather than jsdom's gaps. */
  class FakeDataTransfer {
    private _files: File[] = []
    items = { add: (f: File) => this._files.push(f) }
    setData() {}
    get files() {
      const list = this._files as unknown as FileList & File[]
      ;(list as unknown as { item: (i: number) => File }).item = (i: number) => this._files[i]
      return list
    }
  }
  ;(globalThis as unknown as { DataTransfer: unknown }).DataTransfer = FakeDataTransfer
  // The real input refuses an assignment it cannot validate; ours records it.
  Object.defineProperty(HTMLInputElement.prototype, "files", {
    configurable: true,
    get() {
      return this.__files ?? null
    },
    set(v) {
      this.__files = v
    },
  })

  // jsdom has no execCommand; make it behave like a real editor.
  ;(document as unknown as { execCommand: unknown }).execCommand = vi.fn(
    (_c: string, _u: boolean, text: string) => {
      const ed = document.querySelector('[data-testid="tweetTextarea_0"]')
      if (!ed) return false
      ed.textContent = (ed.textContent ?? "") + text
      return true
    },
  )
})

describe("driving X's own composer", () => {
  it("types the sentence and attaches the card", async () => {
    fakeX()
    const ok = await composeWithCard("Popped $1 of $ANSEM under a tweet. @poppin_so", png())
    expect(ok).toBe(true)
    expect(document.querySelector('[data-testid="tweetTextarea_0"]')!.textContent).toContain(
      "@poppin_so",
    )
    const input = document.querySelector<HTMLInputElement>('[data-testid="fileInput"]')!
    expect(input.files?.length).toBe(1)
    expect(input.files?.[0]?.type).toBe("image/png")
  })

  it("returns false, never throws, when X has renamed the compose button", async () => {
    fakeX({ button: false })
    await expect(composeWithCard("x", png())).resolves.toBe(false)
  })

  it("returns false when the modal never mounts an editor", async () => {
    fakeX({ editor: false })
    await expect(composeWithCard("x", png(), { timeoutMs: 300 })).resolves.toBe(false)
  })

  it("returns false when the file input is gone, rather than posting textless", async () => {
    // Half a post is worse than the old path: the caller must be able to
    // fall back with the clipboard still loaded.
    fakeX({ fileInput: false })
    await expect(composeWithCard("x", png(), { timeoutMs: 300 })).resolves.toBe(false)
  })

  it("refuses to claim success when X silently ignores the file", async () => {
    // The bug this test exists for: the DOM work all succeeded, X attached
    // nothing, and the receipt still said "Composer ready with your card".
    // Only X's own preview counts as evidence.
    fakeX({ deaf: true })
    await expect(composeWithCard("x", png(), { timeoutMs: 900 })).resolves.toBe(false)
  })

  it("counts a missing card as success, because the sentence still stands", async () => {
    fakeX()
    await expect(composeWithCard("Popped $1", null)).resolves.toBe(true)
  })
})
