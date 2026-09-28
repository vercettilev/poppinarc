// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fenceKeys, normalizeDecimal } from "./decimalInput"

describe("normalizeDecimal", () => {
  it("keeps US input untouched", () => {
    expect(normalizeDecimal("0.004945")).toBe("0.004945")
    expect(normalizeDecimal("25")).toBe("25")
    expect(normalizeDecimal("")).toBe("")
  })

  it("turns a comma into the dot the product speaks", () => {
    // The Turkish keyboard's decimal key. The field must not care which
    // separator the OS prefers — the product formats US everywhere.
    expect(normalizeDecimal("0,0049")).toBe("0.0049")
    expect(normalizeDecimal("1,5")).toBe("1.5")
  })

  it("keeps only the first dot — later ones are typos, not syntax", () => {
    expect(normalizeDecimal("1.2.3")).toBe("1.23")
    expect(normalizeDecimal("1,2,3")).toBe("1.23")
    expect(normalizeDecimal("..5")).toBe(".5")
  })

  it("drops everything that is not a number", () => {
    expect(normalizeDecimal("$25")).toBe("25")
    expect(normalizeDecimal("12abc")).toBe("12")
    expect(normalizeDecimal("-5")).toBe("5")
  })
})

describe("fenceKeys", () => {
  it("keeps a keystroke inside — the page under the card never hears it", () => {
    const page = vi.fn()
    document.addEventListener("keydown", page)

    const host = document.createElement("div")
    const input = document.createElement("input")
    host.appendChild(input)
    document.body.appendChild(host)
    const off = fenceKeys(host)

    // "." in our field is X's shortcut on the page — the exact event that
    // closed the sheet. It must reach the input and die at the host.
    const inside = vi.fn()
    input.addEventListener("keydown", inside)
    input.dispatchEvent(new KeyboardEvent("keydown", { key: ".", bubbles: true }))
    expect(inside).toHaveBeenCalledTimes(1)
    expect(page).not.toHaveBeenCalled()

    // Unfenced, the same key escapes — proving the fence is what stops it.
    off()
    input.dispatchEvent(new KeyboardEvent("keydown", { key: ".", bubbles: true }))
    expect(page).toHaveBeenCalledTimes(1)

    document.removeEventListener("keydown", page)
    host.remove()
  })
})
