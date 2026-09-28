import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * FILL MEANS COMMITMENT, HUE MEANS DIRECTION — and the enforcement is on
 * the FILL, because that is the half a cascade can quietly take back.
 *
 * This replaces an older rule that kept direction colour off the resting
 * keys entirely. That rule was solving a real problem the wrong way round:
 * it made hue carry "is this a fact or a control", which is not something
 * hue is good at, and it left the one control that moves money wearing a
 * filled brand blue — the same blue as Reddit's Join and X's Follow, on
 * the two surfaces this chip lives on. The key read as a feature of
 * whichever page it had landed on.
 *
 * So the keys speak direction now, as ink and as a hairline, and the rule
 * that stayed is the one that still means something: nothing on the
 * resting row is FILLED, because nothing has been chosen. The fill arrives
 * with the decision, in the sheet.
 *
 * The old rule's hard-won lesson is kept whole and is the reason this is
 * enforced at all. It was broken twice within an hour of being made, both
 * times the same way: the resting rule was changed and the :hover and
 * :active rules were not, they sat LATER in the stylesheet, won the
 * cascade and repainted the key the moment a pointer touched it. Neither
 * was visible in a screenshot, because a screenshot has no pointer. A
 * colour change is not finished when the resting state looks right.
 *
 * Scoped deliberately to the RESTING ROW's controls. The sheet's confirm
 * (.place) is a commitment and owns the only filled direction on the
 * surface; juice.spec.ts enforces that separately and this must not
 * contradict it.
 */
const CSS = readFileSync(join(__dirname, "xStrip.ts"), "utf8")

/**
 * Every rule whose selector list mentions one of these classes.
 *
 * The body scan SKIPS `${...}` interpolations. A plain search for the next
 * "}" reads correct code and returns a truncated body — the first brace
 * after `.place {` belongs to `${JUICE.buyGlow}` — so the assertion runs
 * against half a rule and passes for the wrong reason. juice.spec.ts wrote
 * this lesson down and I still had to learn it twice, which is the case
 * for the comment rather than against it.
 */
function rulesFor(classes: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const matches = classes.map((c) => new RegExp(`(?:^|[,\\s])\\${c}(?:[:.\\s,{]|$)`))
  for (let at = CSS.indexOf("{"); at > -1; at = CSS.indexOf("{", at + 1)) {
    const lineStart = CSS.lastIndexOf("\n", at) + 1
    const sel = CSS.slice(lineStart, at).trim()
    if (!sel.startsWith(".")) continue
    if (!matches.some((re) => re.test(sel + " "))) continue
    let i = at + 1
    for (; i < CSS.length; i++) {
      if (CSS[i] === "$" && CSS[i + 1] === "{") {
        i = CSS.indexOf("}", i)
        continue
      }
      if (CSS[i] === "}" || CSS[i] === "{") break
    }
    if (CSS[i] !== "}") continue
    out.push([sel, CSS.slice(at + 1, i)])
  }
  return out
}

/** The two direction hues, in every form this stylesheet writes them. */
/**
 * A FILL, as opposed to a wash or an ink. Gradients and the named fill
 * tokens are the shapes that say "chosen", and none of them belongs on a
 * key nobody has pressed yet.
 */
const FILLS = [
  /JUICE_BUY_FILL|JUICE_SELL_FILL|JUICE_GRADIENT/,
  /background(?:-color)?:[^;]*linear-gradient/,
  /background(?:-color)?:\s*#[0-9a-f]{3,8}/i,
]

/**
 * background-COLOR is scanned too, and that is not tidiness.
 *
 * The light-page floor below is written with the longhand for a real
 * reason (.buy.holding paints its sweep with background-image and these
 * selectors outrank it, so the shorthand would erase the sweep). The
 * moment the longhand became a thing this stylesheet writes, it also
 * became a way to paint a fill that a scan for "background:" would never
 * see. So the scan reads both, and the light-page rules earn their hex
 * through the composite check further down rather than by being invisible
 * here.
 */

/** JUICE.ground, #0E1420 — the floor every wash on this row assumes. */
const GROUND = [0x0e, 0x14, 0x20]

/** A wash laid over that floor, which is what the reader actually sees. */
function composited(wash: [number, number, number], alpha: number): string {
  const hex = wash
    .map((c, i) => Math.round(alpha * c + (1 - alpha) * GROUND[i]))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")
  return `#${hex}`.toUpperCase()
}

const BUY_WASH: [number, number, number] = [74, 222, 128]
const SELL_WASH: [number, number, number] = [255, 122, 112]

describe("the resting row's keys are never filled", () => {
  const rules = rulesFor([".buy", ".sell", ".go"])
  /**
   * A light page lends no ground, so on one the key carries its own —
   * its own wash, already composited over JUICE.ground, so the pixels do
   * not move. Those rules are opaque BY CONSTRUCTION and would read as
   * fills to the scans below, which is why they are partitioned out here
   * and pinned to the arithmetic in the next describe instead. Nothing is
   * exempt: they are checked harder, against an exact value.
   */
  const dark = rules.filter(([sel]) => !sel.includes("on-light"))

  it("finds the rules at all, so a rename cannot make this pass vacuously", () => {
    expect(rules.length).toBeGreaterThanOrEqual(4)
    expect(rules.some(([sel]) => sel.includes(":hover"))).toBe(true)
    expect(rules.some(([sel]) => sel.includes(":active"))).toBe(true)
  })

  it("is clean in every state, not just at rest", () => {
    for (const [sel, body] of dark) {
      for (const fill of FILLS) {
        expect(
          fill.test(body),
          `${sel} fills a resting key — the cascade bug again`,
        ).toBe(false)
      }
    }
  })

  // A wash is not a fill: it lets the ground through, which is the whole
  // difference between "you could choose this" and "you chose it".
  it("keeps every ground it does declare translucent", () => {
    for (const [sel, body] of dark) {
      for (const [, alpha] of body.matchAll(/background:\s*rgba\([^)]*?,\s*\.(\d+)\)/g)) {
        expect(Number(`0.${alpha}`), `${sel} paints an all but opaque ground`).toBeLessThan(0.3)
      }
    }
  })

  // The point of spending the hue here is that it says which way. A key
  // that lost its direction ink would be back to reading as the host's.
  it("still says which way it goes", () => {
    const buy = rules.filter(([sel]) => /\.buy|\.go/.test(sel)).map(([, b]) => b).join("")
    const sell = rules.filter(([sel]) => /\.sell/.test(sel)).map(([, b]) => b).join("")
    expect(/74,222,128|buyFillHi|buyInk/.test(buy), "buy lost its green").toBe(true)
    expect(/255,122,112|sellInk/.test(sell), "sell lost its red").toBe(true)
  })
})

/**
 * THE LIGHT-PAGE FLOOR IS THE SAME KEY, NOT A NEW ONE.
 *
 * Reported against the Reddit row side by side: on a news page the whole
 * chip wore one filled capsule and read as a single control, where every
 * other surface shows four separate keys. The ground moved off the chip
 * and onto the keys, which is the only place the unreadability ever was.
 *
 * What keeps that from becoming a second, drifting palette is this: each
 * light-page value IS its dark-page wash laid over JUICE.ground, computed
 * here rather than copied. Change a wash and this names the hex that
 * stopped matching it; change a hex by hand and it names that too.
 */
describe("the light-page floor is the dark-page key, composited", () => {
  const CASES: Array<[string, [number, number, number], number, string]> = [
    [".buy", BUY_WASH, 0.1, ".10"],
    [".buy:hover", BUY_WASH, 0.16, ".16"],
    [".sell", SELL_WASH, 0.08, ".08"],
    [".sell:hover", SELL_WASH, 0.14, ".14"],
  ]

  it("declares exactly the wash it stands for, over the ground", () => {
    for (const [key, wash, alpha] of CASES) {
      const want = `.chip.on-light:not(.open) ${key} { background-color: ${composited(wash, alpha)}; }`
      expect(CSS, `${key} on a light page no longer equals its own wash`).toContain(want)
    }
  })

  it("still finds the wash it was computed from", () => {
    // Without this the pair could drift together and stay self-consistent
    // while matching nothing a reader sees on Reddit.
    for (const [, wash, , written] of CASES) {
      expect(CSS, "a wash moved and the light-page floor did not follow")
        .toContain(`rgba(${wash.join(",")},${written})`)
    }
  })

  it("leaves the opened chip alone", () => {
    // .chip.open brings a real ground on every surface and the tail keys
    // give theirs up to it. A floor under a key already standing on that
    // surface is the nested ring that rule exists to remove.
    for (const [, body] of rulesFor([".buy", ".sell"])) void body
    expect(CSS).toContain(".chip.on-light:not(.open) .buy {")
    expect(CSS).not.toContain(".chip.on-light .buy {")
  })

  /**
   * EVERY CHILD OF THE RESTING TAIL IS ACCOUNTED FOR, and this test exists
   * because one was not.
   *
   * Moving the ground off the chip gave a floor to every key and missed
   * .pmark, which is the only child of the tail that is pure text rather
   * than a control. It kept writing rgba(255,255,255,.52) onto a white
   * article, so hovering a CNBC headline opened a wide gap between Sell
   * and the bell with nothing drawn inside it. Nothing failed; the
   * signature was simply not there.
   *
   * The list is the resting row as it is actually built (read off a
   * mounted chip, not off the stylesheet). Add a child to the tail and
   * this fails until the light page has an answer for it, whether that
   * answer is a floor or an ink.
   */
  it("leaves nothing in the resting row without an answer on white", () => {
    const TAIL = ["lead", "ring", "wal", "buy", "sell", "pmark"]
    const covered = new Set(
      [...CSS.matchAll(/\.chip\.on-light:not\(\.open\)\s+\.([a-z-]+)/g)].map((m) => m[1]!),
    )
    for (const child of TAIL) {
      expect(covered.has(child), `${child} has no light-page treatment`).toBe(true)
    }
    // And nothing beyond it, so a stale rule for a removed child is caught
    // the same way — dead CSS that explains nothing is how .bell survived.
    expect([...covered].sort()).toEqual([...TAIL].sort())
  })

  /**
   * PRESSING IT GROWS IT, MEASURED RATHER THAN ASSERTED.
   *
   * In a 1100px column the row is 333px at rest and 370px with its tail
   * revealed, and the opened sheet was 356px — so opening it shrank the
   * object by 14px under the finger that pressed it. The hug that keeps
   * the chip off an article's full width was following the content down.
   *
   * 370 is the number that matters here and it is the measurement, not a
   * preference: whatever the opened chip is given, it cannot be less than
   * the widest the row reaches, or the press narrows it again.
   */
  it("never opens narrower than the row it grew from", () => {
    const WIDEST_RESTING_PX = 370
    const m = /\.chip\.on-light\.open\s*{\s*width:\s*min\(100%,\s*(\d+)px\)/.exec(CSS)
    expect(m, "the opened chip on a light page declares no width of its own").not.toBeNull()
    expect(Number(m![1]), "opening a chip on an article shrinks it again")
      .toBeGreaterThan(WIDEST_RESTING_PX)
  })

  it("keeps the unread bell's accent, which outranks nothing here", () => {
    // .ring.live carries two classes, these selectors carry four. Without
    // the exclusion the floor wins and the one state the bell exists for
    // goes quiet on every news page.
    expect(CSS).toContain(".chip.on-light:not(.open) .ring:not(.live)")
  })
})

describe("the sheet's confirm keeps its direction", () => {
  it("is untouched by the rule above", () => {
    // .place is a commitment. If this ever goes quiet, the rule was
    // applied too widely and the trade's own moment lost its colour.
    const place = rulesFor([".place"])
    expect(place.some(([, body]) => /JUICE_BUY_FILL|buyGlow/.test(body))).toBe(true)
  })
})

describe("rule 4 reaches the celebration", () => {
  it("colours the sparks by the direction that landed", () => {
    // The burst was green whatever happened, so a SELL confirmed in the
    // colour that means buy — on a surface whose own comments call green
    // "structurally forbidden" from dressing anything but a landed buy.
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(code).toMatch(/\.burst-sell i:nth-child\(odd\)/)
    expect(code).toMatch(/side === "sell" \? "burst burst-sell"/)
  })

  it("gives a placed order neither direction", () => {
    // Placing an order is not a trade landing. It gets the brand.
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(code).toMatch(/"burst burst-neutral"/)
    expect(code).toMatch(/\.burst-neutral i:nth-child\(odd\)/)
  })
})

// Reported from a zoomed screenshot: a blue line still sat under both keys
// after they went green and red. box-shadow does not merge — a second
// declaration later in the same rule REPLACES the first outright — so the
// hairline vanished and the old brand edge survived underneath a green
// key. The pressed state carried it too, which no screenshot would show.
describe("the edge goes with the key", () => {
  const rules = rulesFor([".buy", ".sell", ".go"])

  it("leaves no brand blue anywhere on them, in any state", () => {
    for (const [sel, body] of rules) {
      for (const blue of [/#2E86C9/i, /104,\s*198,\s*255/, /122,\s*183,\s*255/]) {
        expect(blue.test(body), `${sel} still carries the brand edge`).toBe(false)
      }
    }
  })

  it("declares its shadow once, so the hairline cannot be overwritten", () => {
    for (const [sel, body] of rules) {
      const shadows = body.match(/box-shadow:/g)?.length ?? 0
      expect(shadows, `${sel} declares box-shadow ${shadows} times`).toBeLessThan(2)
    }
  })
})
