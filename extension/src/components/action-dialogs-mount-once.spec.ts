import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ONE PRESS, ONE DIALOG.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The Delete and Report confirmations were rendered TWICE, off the same
 * `useActionMenuDialogStore.dialogMode`: once in components/Layout.tsx and
 * once in entries/popup/App.tsx, directly above the <Routes> that Layout is
 * the layout route of. Both `open` props read the same field, so choosing
 * "Delete" on any post opened both — two MUI Modals, two backdrops, two
 * stacked Papers, and two Cancel buttons for one decision.
 *
 * The two copies had also drifted. Layout's carries the admin "reason for
 * deletion" field and the guard that keeps Delete disabled until a reason is
 * typed; App's did not. So the dialog a moderator saw depended on which of the
 * two stacked Papers happened to be on top.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A dialog bound to a global store field may be rendered from exactly ONE
 * place, and that place is the layout every screen already renders inside.
 * Two components reading one boolean is not "a fallback"; it is two dialogs.
 *
 * ── WHY THE ROUTE CHECK ─────────────────────────────────────────────────────
 * Keeping only Layout's copy is safe precisely because every route is a child
 * of `<Route element={<Layout />}>`. A route added OUTSIDE that block would
 * render with no action dialogs at all — a Delete menu item that opens
 * nothing. That is not a hypothetical the next reader can see from Layout.tsx,
 * so it is pinned here.
 *
 * ── WHY A SOURCE GUARD ──────────────────────────────────────────────────────
 * The failure is "two components each render one dialog". Mounting either one
 * alone passes; the bug only exists in the pair, and reproducing the pair means
 * booting the whole panel. What is checkable is what the two files contain.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * Comments out. This repo explains a fix by quoting the code it deleted, so a
 * raw grep for `<CDialog` matches the paragraph about the removal. The
 * `[^:]` guard keeps `https://` out of the line-comment rule.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

const APP = "entries/popup/App.tsx"
const LAYOUT = "components/Layout.tsx"

describe("the action-menu dialogs are rendered once", () => {
  it("Layout is the one that renders them", () => {
    const layout = code(LAYOUT)
    expect(layout, "Layout stopped reading the action-menu store").toMatch(
      /useActionMenuDialogStore\(\)/,
    )
    expect(layout).toMatch(/open=\{actionDialogMode === "delete"\}/)
    expect(layout).toMatch(/open=\{actionDialogMode === "report"\}/)
  })

  it("Layout kept the richer copy, not the thinner one", () => {
    const layout = code(LAYOUT)
    // The admin path is the whole reason App's copy was the one deleted: only
    // this one can collect a reason, and only this one blocks Delete without
    // it. If these go, the surviving dialog is the one we chose to drop.
    expect(layout, "the admin deletion-reason field is gone").toMatch(
      /label="Reason for deletion \(required\)"/,
    )
    expect(layout, "Delete no longer waits for the admin's reason").toMatch(
      /disabled=\{[\s\S]*?!deleteReason\.trim\(\)[\s\S]*?\}/,
    )
  })

  it("App renders no second copy", () => {
    const app = code(APP)
    expect(app, "App is reading the action-menu dialog store again").not.toMatch(
      /useActionMenuDialogStore/,
    )
    expect(app, "a CDialog is back in App.tsx — Layout already renders it")
      .not.toMatch(/<CDialog/)
  })

  it("the report reasons are declared once, in the file that renders them", () => {
    expect(code(LAYOUT)).toMatch(/const REPORT_TYPES/)
    expect(code(APP), "REPORT_TYPES is duplicated in App.tsx again").not.toMatch(
      /REPORT_TYPES/,
    )
  })
})

describe("every route renders inside the layout that owns the dialogs", () => {
  it("no <Route> escapes <Route element={<Layout />}>", () => {
    const app = code(APP)
    const open = app.indexOf("<Route element={<Layout />}>")
    expect(open, "the layout route is gone or was rewritten").toBeGreaterThan(-1)
    const close = app.indexOf("</Route>", open)
    expect(close, "the layout route never closes").toBeGreaterThan(open)

    const all = [...app.matchAll(/<Route\b/g)].map((m) => m.index!)
    const outside = all.filter((i) => i !== open && (i < open || i > close))
    expect(
      outside.length,
      "a <Route> is declared outside the layout route. It will render with " +
        "NO Delete/Report dialogs, because components/Layout.tsx is the only " +
        "place that renders them. Nest it, or move the dialogs up to App.",
    ).toBe(0)
  })
})
