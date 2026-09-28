import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const routes = stripComments(read("entries/popup/App.tsx"))
const routePaths = [...routes.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1])

/**
 * THE PANEL HAD NINETEEN ROOMS AND SIX OF THEM HAD NEVER BEEN OPENED.
 * These pin the four the audit closed, each for a reason the code can
 * still be checked against — not for being unpopular.
 */
describe("the routes the audit closed", () => {
  it("has no social inbox, because no money event can reach one", () => {
    // apps/rabbit writes follow / comment / reply / mention / share /
    // post_deleted_by_admin / stream_created. A filled order, a ringing
    // alert and a followed trade travel by other surfaces entirely.
    expect(routePaths).not.toContain("notifications")
    expect(existsSync(join(SRC, "views/notifications.tsx"))).toBe(false)
    const header = stripComments(read("components/Header.tsx"))
    expect(header).not.toMatch(/useNotificationsCount|navigate\("\/notifications"\)/)
  })

  it("has no tasks room, because its reward could not be spent", () => {
    expect(routePaths).not.toContain("tasks")
    expect(existsSync(join(SRC, "views/tasks.tsx"))).toBe(false)
    // And nothing marks a task any more — the panel used to fetch and
    // write them on every open for a count nothing rendered.
    for (const f of ["components/Header.tsx", "components/Layout.tsx"]) {
      expect(stripComments(read(f))).not.toMatch(/useTasks|CompletePinTask|CompleteTimelineTask/)
    }
    expect(stripComments(read("entries/background/main.ts"))).not.toMatch(/COMPLETE_TASK/)
  })

  it("has no standalone post route, because that route drew nothing", () => {
    // PostDetailView returns null unless location.state.to says so, which a
    // plain navigate never does. It stays an overlay inside the feed.
    expect(routePaths.some((p) => p.startsWith("post/"))).toBe(false)
    const post = stripComments(read("views/PostDetailView.tsx"))
    expect(post).toMatch(/to !== "PostDetailView"/)
    expect(stripComments(read("views/comment.tsx"))).toMatch(/<PostDetailView \/>/)
  })

  it("gives the book one address, not two", () => {
    expect(routePaths).not.toContain("positions")
    expect(routes).toMatch(/<Route path="\/" element=\{<SpotPositions \/>\} \/>/)
  })
})

/**
 * CLOSING A ROUTE IS NOT ENOUGH ON ITS OWN. Layout restores the panel to
 * the path it was last on, and that path is persisted across sessions, so
 * a reader whose last screen was one of the four closed here would have
 * reopened the panel into a matched-nothing route: chrome, and nothing
 * under it. The blank screen the audit was fixing, reintroduced by the fix.
 */
describe("a route that no longer exists lands somewhere", () => {
  it("catches everything unmatched and sends it to the front door", () => {
    expect(routes).toMatch(/<Route path="\*" element=\{<Navigate to="\/" replace \/>\} \/>/)
  })

  it("is the last route, so it cannot shadow a real one", () => {
    const star = routes.indexOf('<Route path="*"')
    const last = routes.lastIndexOf("<Route path=")
    expect(star).toBe(last)
  })

  it("still restores the path it was last on", () => {
    expect(stripComments(read("components/Layout.tsx"))).toMatch(/navigate\(currentPath\)/)
  })
})

/**
 * A room nobody can reach must not still be paid for. Each closure above
 * also took the poll, the mutation or the import that fed it.
 */
describe("the closures took their traffic with them", () => {
  it("leaves no orphaned hook or service behind", () => {
    for (const f of [
      "hooks/useNotifications.ts",
      "hooks/useNotificationsCount.ts",
      "hooks/useTasks.ts",
      "services/TaskService.ts",
      "store/useTaskStore.ts",
    ]) {
      expect(existsSync(join(SRC, f)), f).toBe(false)
    }
  })
})
