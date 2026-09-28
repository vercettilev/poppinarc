import { describe, expect, it } from "vitest"
import {
  readSharePrefs,
  SHARE_DEFAULTS,
  SHARE_PREFS_KEY,
  SHARE_ROWS,
} from "./sharePrefs"

/**
 * The switch that lets the product speak AS the reader. It acts first,
 * says so, and offers the reversal — these pin exactly that shape.
 */
describe("what Poppin may post on the reader's behalf", () => {
  it("shares by default, because a default nobody finds is a footnote", () => {
    // The first version shipped this OFF behind a Settings switch and the
    // owner threw it out: "anlaşılması bulması zor bir setting gibi". In a
    // product whose feed IS people's trades, the trade that filled
    // overnight is the content the feed exists for.
    expect(SHARE_DEFAULTS.fills).toBe(true)
    expect(readSharePrefs(undefined).fills).toBe(true)
    expect(readSharePrefs(null).fills).toBe(true)
    expect(readSharePrefs({}).fills).toBe(true)
  })

  it("keeps a NO that somebody actually pressed", () => {
    // The one thing the default must never do is talk over a reader who
    // said stop.
    expect(readSharePrefs({ fills: false }).fills).toBe(false)
  })

  it("reads only a real boolean, never a truthy shape", () => {
    // A hand-edited value or an older build's shape is not a person
    // pressing a switch — in either direction it falls back to the default.
    expect(readSharePrefs({ fills: "false" }).fills).toBe(true)
    expect(readSharePrefs({ fills: 0 }).fills).toBe(true)
    expect(readSharePrefs("nonsense").fills).toBe(true)
  })

  it("offers a row for every switch, in the reader's own words", () => {
    // A preference with no row is a thing that happens to somebody with no
    // way to stop it — the rule notifyPrefs already keeps.
    expect(SHARE_ROWS.map((r) => r.kind).sort()).toEqual(
      Object.keys(SHARE_DEFAULTS).sort(),
    )
    for (const r of SHARE_ROWS) {
      expect(r.title.length).toBeGreaterThan(3)
      expect(r.description.length).toBeGreaterThan(20)
      // The switch must say that it acts automatically AND that the act
      // is reversible — those two facts together are what make an
      // on-by-default publish honest.
      expect(r.description.toLowerCase()).toContain("automatically")
      expect(r.description.toLowerCase()).toContain("undo")
    }
  })

  it("keeps its own key, apart from the notification prefs", () => {
    // Separate promises, separate storage: flipping a notification switch
    // must never be able to start publishing.
    expect(SHARE_PREFS_KEY).toBe("poppin_share_prefs")
  })
})
