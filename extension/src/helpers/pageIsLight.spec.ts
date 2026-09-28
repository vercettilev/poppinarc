import { describe, expect, it } from "vitest"
import { pageIsLight } from "./pageIsLight"

/**
 * Measured on a CNBC article: a white page, near-white ink, a price nobody
 * could read and buttons that looked bleached. The chip paints no ground
 * of its own because borrowing the host's is what makes it read as part of
 * X and Reddit — both dark. The instinct was right; the default was wrong.
 */
const on = (css: string): Element => {
  document.body.innerHTML = `<div id="page" style="${css}"><p id="anchor">x</p></div>`
  return document.querySelector("#anchor")!
}

describe("what colour the page is under us", () => {
  it("sees a white page", () => {
    expect(pageIsLight(on("background-color: #ffffff"))).toBe(true)
  })

  it("sees a dark one", () => {
    // X's Dim and Reddit's night, near enough.
    expect(pageIsLight(on("background-color: #15202B"))).toBe(false)
    expect(pageIsLight(on("background-color: #0e1113"))).toBe(false)
  })

  it("walks past ancestors that paint nothing", () => {
    document.body.innerHTML =
      '<div style="background-color:#101010"><div><span id="a">x</span></div></div>'
    expect(pageIsLight(document.querySelector("#a"))).toBe(false)
  })

  it("ignores a wash it can see through, and takes the ground beneath", () => {
    document.body.innerHTML =
      '<div style="background-color:#ffffff">' +
      '<div style="background-color:rgba(0,0,0,.04)"><span id="a">x</span></div></div>'
    expect(pageIsLight(document.querySelector("#a"))).toBe(true)
  })

  /**
   * The two failures are not symmetric. Guessing light on a dark page
   * paints a dark ground on a dark page, which is close to invisible.
   * Guessing dark on a light page is the bug this exists to fix.
   */
  it("calls an unknown page light, because a browser's own canvas is white", () => {
    document.body.innerHTML = '<div><span id="a">x</span></div>'
    expect(pageIsLight(document.querySelector("#a"))).toBe(true)
    expect(pageIsLight(null)).toBe(true)
  })
})
