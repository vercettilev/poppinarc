import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * TWO MENU ROWS, ONE SCREEN.
 *
 * The avatar dropdown carried "Settings" (→ /settings) and, directly beneath
 * it, "Report a bug" (→ /settings?report=1). Same destination, twice, so the
 * menu claimed the panel had two places where it had one. The only thing
 * that distinguished them was a scroll-and-focus effect in the Settings view
 * reading that query param.
 *
 * The row is gone and the bug box moved to the BOTTOM of Settings, which is
 * where a reader ends up after the preferences failed to fix what they came
 * in for. The ?report=1 machinery went with it: one producer
 * (components/Header.tsx), one consumer (views/Settings.tsx), and no other
 * door in the extension can emit that URL — the card's `openPanelRoom`
 * allowlists /token, /profile and /feed, and the background's
 * `open-panel-route` handler allowlists /receive, /wallet-ui, /positions and
 * /.
 *
 * These are source guards, in the house's grep idiom, on comment-stripped
 * text: the fix's own comments quote "Report a bug" and "/settings?report=1"
 * to record why they went, and that prose must not read as a live call site.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("bug reporting has one home", () => {
  it("the avatar dropdown has no second row pointing at Settings", () => {
    const header = stripComments(read("components/Header.tsx"))
    expect(header).not.toMatch(/report=1/)
    expect(header).not.toMatch(/Report a bug/)
    expect(header).not.toMatch(/BugReportOutlinedIcon/)
  })

  it("Settings no longer carries the deep-link's scroll machinery", () => {
    const settings = stripComments(read("views/Settings.tsx"))
    expect(settings).not.toMatch(/useLocation/)
    expect(settings).not.toMatch(/reportRef/)
    expect(settings).not.toMatch(/scrollIntoView/)
  })

  it("the bug box is the last open card, and Advanced folds after it", () => {
    const settings = stripComments(read("views/Settings.tsx"))
    // The report box stays open and stays last among the cards a reader
    // sees without asking: a person who scrolled this far is usually here
    // to report something. The shortcut card and the diagnostics switch —
    // two things a support thread sometimes needs and a reader almost never
    // does — fold behind one word AFTER it, so they cost nothing until
    // asked for. Expressed as order rather than line numbers so a refactor
    // cannot quietly float the box back to the top or unfold the rest.
    const report = settings.indexOf("Report a bug")
    const advanced = settings.indexOf('"Advanced ▾"')
    const shortcut = settings.indexOf("shortcutInfo.title")
    const debug = settings.indexOf("Explain what the chip is doing")
    expect(report).toBeGreaterThan(-1)
    expect(advanced).toBeGreaterThan(report)
    expect(shortcut).toBeGreaterThan(advanced)
    expect(debug).toBeGreaterThan(advanced)
    // And the fold is closed by default: nothing behind it is a card the
    // screen pays for on every visit.
    expect(settings).toMatch(/useState\(false\)[\s\S]*setAdvanced|const \[advanced, setAdvanced\] = useState\(false\)/)
    expect(settings.indexOf("</Stack>")).toBeGreaterThan(debug)
  })
})
