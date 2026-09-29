import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ONBOARDING_V2, ONBOARDING_X_URL } from "~/config/onboarding"

/**
 * THE EVENT THAT COUNTS THE HANDOFF MUST LIVE ON THE HANDOFF.
 *
 * onboarding_handoff is the corridor's last step: the moment the flow stops
 * being screens and puts the reader on a real page, carrying the host it
 * sent them to. Whether a card_shown ever follows it is the only evidence
 * that onboarding connected to reality at all.
 *
 * Production held ZERO rows of it, ever. Not a delivery bug and not a
 * mapping bug — the event was attached to FinalStep, V1's closing screen,
 * and ONBOARDING_V2 routes /final out of the flow entirely. The counter sat
 * on a screen the shipped product never opens.
 *
 * So the fix is not "fire it somewhere". It is: find the ACTION the event
 * names — hand the reader to a real page — and count it where that action
 * actually happens, with the same payload. The live flow's ending is
 * ShowMeStep.handoff(). FinalStep keeps its copy, because V1 is one env
 * flag away and both paths must report the same fact.
 *
 * Source-scanned: these are MUI screens, which this repo cannot render in
 * jsdom. Everything the source cannot decide — the flag's default, the host
 * the payload will actually carry — is executed instead of matched.
 */

const STEPS = join(__dirname, "components", "steps")
const showMe = readFileSync(join(STEPS, "ShowMeStep.tsx"), "utf8")
const finalStep = readFileSync(join(STEPS, "FinalStep.tsx"), "utf8")
const app = readFileSync(join(__dirname, "App.tsx"), "utf8")
const background = readFileSync(
  join(__dirname, "..", "background", "main.ts"),
  "utf8",
)

/** The text of `const <name> = ... => { ... }`, braces matched. */
function arrowBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = `)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const open = src.indexOf("{", src.indexOf("=>", start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const handoff = arrowBody(showMe, "handoff")

describe("why the event had to move", () => {
  it("ships with the V2 flow on, which is the flow that has to be counted", () => {
    // Executed, not matched: this is the default the build takes.
    expect(ONBOARDING_V2).toBe(true)
  })

  it("never visits /final in that flow — sign-in's own exit is redirected", () => {
    const at = app.indexOf('path === "/final"')
    expect(
      at,
      "App.tsx no longer redirects V1's closing screen; if /final is live again " +
        "this spec's whole premise needs rechecking.",
    ).toBeGreaterThan(-1)
    expect(app.slice(at, at + 160)).toContain('navigate("/show-me")')
  })

  it("lands on /show-me from every V2 door", () => {
    expect(app).toContain('navigate(ONBOARDING_V2 ? "/show-me" : "/final")')
    expect(app).toContain('navigate(user ? "/show-me" : "/signup")')
  })
})

describe("the live flow's handoff", () => {
  it("was found, and is the step that puts the reader on a real page", () => {
    expect(handoff.length).toBeGreaterThan(200)
    expect(handoff).toContain("window.location.href = to")
    // X stays the default; the Arc edition's "Try Poppin" passes the page chosen.
    expect(showMe).toContain("const handoff = async (to: string = ONBOARDING_X_URL) =>")
  })

  it("counts itself, by the name the corridor already uses", () => {
    expect(
      handoff,
      "the last step of onboarding is uncounted again: no row means no way to " +
        "tell a flow that ends on X from one nobody finished.",
    ).toContain('event: "onboarding_handoff"')
  })

  it("carries the same payload shape FinalStep has always sent", () => {
    expect(handoff).toContain("payload: { host }")
    expect(finalStep).toContain("payload: { host }")
  })

  it("names the page it actually opens, rather than a copy of it", () => {
    // A literal here would keep reporting x.com the day the destination
    // moves, which is the one thing this event exists to know.
    expect(handoff).toContain("new URL(to).hostname")
    // And what that resolves to today, executed.
    expect(new URL(ONBOARDING_X_URL).hostname).toBe("x.com")
  })

  it("sends BEFORE it replaces its own page", () => {
    // Same-tab navigation: after the assignment there is no context left to
    // send from. Ordering is the whole difference between a row and none.
    const sent = handoff.indexOf('event: "onboarding_handoff"')
    const gone = handoff.indexOf("window.location.href = to")
    expect(sent).toBeGreaterThan(-1)
    expect(gone).toBeGreaterThan(-1)
    expect(sent).toBeLessThan(gone)
  })

  it("cannot take the handoff down with it", () => {
    // The promise FinalStep's comment made — counting never blocks the
    // handoff — survives the await this one needs.
    const at = handoff.indexOf('event: "onboarding_handoff"')
    expect(handoff.slice(at)).toMatch(/\}\s*catch\s*\{/)
  })
})

describe("the V1 closing screen", () => {
  it("is still reachable with the flag off, so it keeps its own firing", () => {
    expect(app).toContain('<Route')
    expect(app).toContain('path="/final"')
    // The false arm of that ternary IS /final's remaining life.
    expect(app).toContain('navigate(ONBOARDING_V2 ? "/show-me" : "/final")')
    expect(finalStep).toContain('event: "onboarding_handoff"')
  })
})

describe("the event survives the trip", () => {
  it("is a name the background translates instead of dropping", () => {
    // Unmapped events are discarded without a word, which would look
    // exactly like the bug this file is about.
    const map = background.slice(
      background.indexOf("const TELEMETRY_MAP"),
      background.indexOf("}", background.indexOf("const TELEMETRY_MAP")),
    )
    expect(map).toContain("onboarding_handoff:")
  })

  it("is sent on the channel the background listens on", () => {
    expect(handoff).toContain('type: "SPOT_TELEMETRY"')
    expect(background).toContain('request.type === "SPOT_TELEMETRY"')
  })
})
