import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { siteLivePillLabel } from "~/helpers/presence"
import {
  initialSiteChatGate,
  siteChatGateView,
  SITE_CHAT_MIN_POPULATION,
  type SiteChatGateState,
} from "~/helpers/siteChatGate"

/**
 * THE HEADER'S LIVE PILL, AND THE HEARTBEAT THAT FEEDS IT.
 *
 * Three halves, and the last two are why this file exists at all.
 *
 * THE WORD. The panel header and the trade card draw the same kind of number
 * — how many people are here — and for a long time one said "online" and the
 * other said "online" too, which was fine. The pill has now become the door to
 * the site's live chat, so it says "live"; if the card had kept "online" the
 * product would be speaking two words for one fact, which is precisely what
 * helpers/presence.ts was written to stop. Both call sites are swept below.
 *
 * THE TIMER. Presence used to exist only where a price card had mounted:
 * background/main.ts's watchPriceMint returns early when the page matched no
 * mint and the `watch-page` emit that puts a browser in a room is nested
 * INSIDE that guard, so on an ordinary website nobody was ever in the room and
 * a gate reading that count could never open. The fix is a heartbeat — and
 * WHERE it lives is the whole decision: Chrome evicts an MV3 service worker on
 * idle and every setInterval in it dies silently, freezing the one number the
 * pill, the gate and R5 all consume. A frozen count is worse than no count,
 * because it looks like an answer. So the beat lives in real documents and the
 * worker gets an ALARM, which Chrome wakes the worker to deliver. This file
 * fails if it moves back.
 *
 * THE MEMBER ID. One install is one member of the pool, and the pool is what
 * admits people. Two documents creating two ids for one install is therefore
 * not an untidiness — it is a second person at the door who does not exist,
 * and it opens a gate whose entire meaning is "you plus at least one other".
 * The last describe below runs that race for real, in two module instances
 * over one fake storage.
 *
 * WHY SOURCE GUARDS FOR THE REST: jsdom has no cascade and no layout, so it
 * cannot be asked what a pill measures or whether a timer survived an
 * eviction. What CAN be pinned is the declaration, and the declaration is
 * where each of those defects was written.
 */

const SRC = join(__dirname, "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

/**
 * Source with comments removed. This repo explains a fix by quoting what it
 * replaced, so a naive sweep finds the defect in the paragraph about its
 * removal. The `[^:]` guard keeps `https://` and `chrome://` out of the
 * line-comment rule.
 */
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const HEADER = "components/Header.tsx"
const CARD = "components/SpotCard/SpotCard.tsx"
const PRESENCE = "helpers/presence.ts"
const BACKGROUND = "entries/background/main.ts"
const CONTENT = "entries/contentScript/primary/main.tsx"
const MANIFEST = "manifest.ts"

describe("one number, one word", () => {
  it("says 'live' on both surfaces and 'online' on neither", () => {
    for (const file of [HEADER, CARD]) {
      const src = strip(read(file))
      expect(src, `${file}: renders the word "live"`).toMatch(/\blive\b/)
      expect(
        src,
        `${file}: still says "online" — the header pill and the card must ` +
          `use ONE word for one number (helpers/presence.ts)`,
      ).not.toMatch(/\bonline\b/i)
    }
  })

  it("keeps the server's own field name out of the sweep's way", () => {
    // helpers/presence.ts reads `onlineCount` off GET /ticks/pages/:host/
    // presence. That is the BACKEND's field name, not a word this product
    // shows anybody, so it is deliberately not swept — and this assertion
    // exists so a future reader does not "fix" the sweep by renaming it.
    expect(strip(read(PRESENCE))).toMatch(/onlineCount/)
  })
})

describe("the pill is a control only where there is a door", () => {
  const header = strip(read(HEADER))
  /**
   * SiteLivePill's own body. Scoped deliberately: Header.tsx declares four
   * other hover blocks (the home button, the feed pill, two menu rows), and a
   * sweep that took the FIRST one would be testing a different control and
   * passing for a reason that has nothing to do with this pill.
   */
  const pill = header.slice(header.indexOf("function SiteLivePill("))

  it("renders a real button, not a clickable div", () => {
    expect(pill).toMatch(/component:\s*"button"/)
    expect(pill).toMatch(/type:\s*"button"/)
  })

  it("gives that button a focus ring that costs no layout", () => {
    // An outline is painted outside the border box, so tabbing onto the pill
    // cannot shift the four-object header row.
    expect(pill).toMatch(/"&:focus-visible":\s*\{[\s\S]*?outline:/)
  })

  it("hovers by PAINTING and never by moving", () => {
    expect(pill, `${HEADER}: SiteLivePill is gone`).not.toBe("")
    const hover = /"&:hover":\s*\{([\s\S]*?)\n\s*\},/.exec(pill)
    expect(hover, `${HEADER}: SiteLivePill declares no hover block`).not.toBeNull()
    const body = hover![1]
    for (const geometry of [
      "padding",
      "borderWidth",
      "transform",
      "fontWeight",
      "gap",
      "height",
      "width",
      "margin",
    ]) {
      expect(
        body,
        `${HEADER}: hover changes ${geometry} — hover may paint, never move`,
      ).not.toMatch(new RegExp(`\\b${geometry}\\b`))
    }
  })

  it("hands the fact variant no onPress at all", () => {
    // The fallback branch — the feature dark, or a beat that carried no
    // number. Shipping a button to a door that is not there is worse than
    // shipping no button, so this call site passes a label and nothing else.
    expect(header).toMatch(/<SiteLivePill label=\{`\$\{factPresence\} live`\} \/>/)
  })

  it("takes the threshold from the gate rather than retyping a 2", () => {
    expect(header).toMatch(/SITE_CHAT_MIN_POPULATION/)
    expect(
      header,
      `${HEADER}: a bare >= 2 next to the presence count is the threshold ` +
        `drifting away from the server's copy`,
    ).not.toMatch(/pagePresence\s*>=\s*2/)
  })

  it("never turns an unknown count into a zero", () => {
    for (const bad of [/pagePresence\s*\?\?\s*0/, /pagePresence\s*\|\|\s*0/]) {
      expect(
        header,
        `${HEADER}: null is "we could not ask", and it renders as NOTHING. ` +
          `A 0 tells every reader the place is dead.`,
      ).not.toMatch(bad)
    }
    expect(header).toMatch(/typeof pagePresence === "number"/)
  })
})

describe("the pill knows about membership (R5's visible half)", () => {
  const header = strip(read(HEADER))

  it("reads membership from the store instead of pinning it false", () => {
    /**
     * THE DEFECT THIS REPLACES: the gate state was built with a literal
     * `member: false`, so `siteChatGateView` could never return MEMBER for the
     * pill. Walk R5 with that in place — alone, hidden; a second reader
     * arrives, OPEN; you enter and the server writes your membership; everyone
     * else leaves — and the count falls back under the threshold, the reducer
     * takes the ALONE branch and the pill VANISHES for a reader who is still
     * inside the room. That is the exact case R5 exists to name.
     */
    expect(
      header,
      `${HEADER}: membership is pinned false — the pill can never show ` +
        `MEMBER, and R5's visible half is not implemented`,
    ).not.toMatch(/member:\s*false/)
    expect(header).toMatch(/useSiteChatStore\(/)
    expect(header).toMatch(/s\.gate\.member/)
  })

  it("scopes that membership to the host the panel is looking at", () => {
    // The store follows the chat screen's page; this header follows the
    // panel's. Membership of one website must not draw a door over another.
    expect(header).toMatch(/s\.host === siteHost/)
  })

  it("lets a dark feature take the door away from members too", () => {
    // The reducer puts `disabled` above MEMBER on purpose (O3: while site chat
    // is off the extension renders exactly as it does today). That only works
    // if the header actually feeds the 404 in rather than pinning blocked null.
    expect(header).toMatch(/blocked:\s*pool\.available\s*\?\s*null\s*:\s*"disabled"/)
  })
})

describe("a beat that could not answer is not an empty room", () => {
  const header = strip(read(HEADER))

  it("falls back to the page count instead of blanking the pill", () => {
    /**
     * pingSitePresence returns `{ count: null, available: true }` for every
     * non-404 failure — offline, a 500, or a 429 off the per-IP ping limiter,
     * which several readers behind one NAT can genuinely reach. Rendering
     * nothing there throws away a number /ticks has already answered, and that
     * number was this pill's whole content before site chat existed.
     */
    expect(header).toMatch(/pool\.at > 0 && pool\.count === null/)
  })

  it("does not flash that fallback before the first beat lands", () => {
    // `pool.at > 0` is the whole guard: at mount the pool has never answered,
    // and "has not asked yet" must render nothing rather than a number from a
    // different room.
    const fallback = /const factPresence =([\s\S]*?)\n\n/.exec(header)
    expect(fallback, `${HEADER}: the fallback is gone`).not.toBeNull()
    expect(fallback![1]).toMatch(/pool\.at > 0/)
  })
})

describe("the heartbeat lives where timers survive", () => {
  it("beats from the side panel and from the page, in real documents", () => {
    expect(strip(read(HEADER))).toMatch(/startSitePresenceHeartbeat\(/)
    expect(strip(read(CONTENT))).toMatch(/startSitePresenceHeartbeat\(/)
  })

  it("stops beating when the document is hidden", () => {
    const presence = strip(read(PRESENCE))
    expect(presence).toMatch(/visibilitychange/)
    expect(presence).toMatch(/visibilityState === "hidden"/)
  })

  it("never beats for a page that cannot be a room", () => {
    // siteChatHostFromUrl answers null for chrome://, file://, an IP and a
    // single-label host, and the beat is guarded on it in both documents.
    for (const file of [CONTENT, BACKGROUND]) {
      expect(strip(read(file))).toMatch(/siteChatHostFromUrl\(/)
    }
  })

  it("uses an alarm in the service worker, never a timer", () => {
    const bg = strip(read(BACKGROUND))
    expect(bg).toMatch(/chrome\.alarms\.create\(SITE_PRESENCE_ALARM/)
    expect(bg).toMatch(/alarm\.name === SITE_PRESENCE_ALARM/)
    // The defect this guards: a setInterval here dies with the worker and
    // takes the count with it, silently.
    const interval = /set(Interval|Timeout)\([^)]*[Pp]resence/.exec(bg)
    expect(
      interval,
      `${BACKGROUND}: presence is on a timer in the service worker — Chrome ` +
        `evicts the worker on idle and the count freezes on a stale number`,
    ).toBeNull()
  })

  it("stops asking a host that answered 404", () => {
    /**
     * The document heartbeat clears its timer the moment a ping comes back
     * unavailable. Without the same memory in the worker, the alarm would POST
     * the active tab's hostname once a minute forever for a feature that does
     * not exist — and not existing is the shipped default, since
     * SITE_CHAT_ENABLED is off until a human turns it on.
     *
     * PER HOST, not one flag: the server answers the kill switch and an
     * off-allowlist host with the same 404 on purpose, so a single flag would
     * let one disallowed website silence the beat on every allowed one.
     */
    const bg = strip(read(BACKGROUND))
    expect(bg).toMatch(/siteChatDarkHosts/)
    expect(bg).toMatch(/status === 404/)
    expect(bg).toMatch(/siteChatDarkHosts\.has\(host\)/)
  })

  it("asks for no new permission to do it", () => {
    // Every mention of "tabs" in the manifest is prose explaining why it is
    // not there, so with comments stripped the word must not survive at all.
    expect(
      strip(read(MANIFEST)),
      `${MANIFEST}: "tabs" is deliberately absent — tab.url unlocks through ` +
        `the OPTIONAL <all_urls> grant instead, and a reader who withheld it ` +
        `produces no presence and gets no chat, which PermissionBanner is ` +
        `already the visible cure for`,
    ).not.toMatch(/tabs/)
  })
})

describe("the pill's words never claim a number that is not true", () => {
  const at = 1_000_000
  const base = (over: Partial<SiteChatGateState>): SiteChatGateState => ({
    ...initialSiteChatGate(),
    host: "x.com",
    signedIn: true,
    ...over,
  })

  it("says the count while the room is genuinely busy", () => {
    const view = siteChatGateView(
      base({ count: SITE_CHAT_MIN_POPULATION, countAt: at }),
      at,
    )
    expect(view.visible).toBe(true)
    expect(siteLivePillLabel(view)).toBe(`${SITE_CHAT_MIN_POPULATION} live`)
  })

  it("drops the number for a member alone in the room, and keeps the pill", () => {
    // R5's visible half: admitted once, never pushed out — and never told
    // "1 live", which would be the pill counting the reader to themselves.
    const view = siteChatGateView(base({ count: 1, countAt: at, member: true }), at)
    expect(view.visible).toBe(true)
    expect(view.showCount).toBe(false)
    expect(siteLivePillLabel(view)).toBe("Live chat")
  })

  it("says nothing at all before the first answer", () => {
    const view = siteChatGateView(base({}), at)
    expect(view.visible).toBe(false)
    expect(view.count).toBeNull()
  })
})

/**
 * ONE INSTALL, ONE MEMBER — run for real rather than asserted about.
 *
 * Two module instances stand in for two documents (the side panel and the
 * content script) over ONE fake chrome.storage, because that is exactly the
 * shape of the race: both find the key empty on a fresh install and both
 * write. What must come out of it is one id in both contexts — a second id is
 * a second member of the pool, and the pool is the number that decides who may
 * enter the chat.
 */
describe("the install's presence id", () => {
  type Change = { newValue?: unknown }
  type Listener = (changes: Record<string, Change>, area: string) => void

  function fakeStorage() {
    const cell: Record<string, unknown> = {}
    const listeners: Listener[] = []
    let gets = 0
    let sets = 0
    return {
      gets: () => gets,
      sets: () => sets,
      /** Whatever the module stored, without this file having to know the key. */
      stored: () => Object.values(cell)[0],
      chrome: {
        storage: {
          local: {
            get: async (key: string) => {
              gets++
              return key in cell ? { [key]: cell[key] } : {}
            },
            set: async (patch: Record<string, unknown>) => {
              sets++
              const changes: Record<string, Change> = {}
              for (const [k, v] of Object.entries(patch)) {
                cell[k] = v
                changes[k] = { newValue: v }
              }
              // Chrome delivers this to every context INCLUDING the writer.
              for (const l of [...listeners]) l(changes, "local")
            },
          },
          onChanged: {
            addListener: (l: Listener) => {
              listeners.push(l)
            },
          },
        },
      },
    }
  }

  afterEach(() => {
    delete (globalThis as any).chrome
    vi.resetModules()
  })

  it("converges when two documents both create one", async () => {
    /**
     * THE DEFECT THIS REPLACES: siteAnonId cached its answer for the life of
     * the context and never touched storage again, so the loser of this race
     * kept its own id forever. The server then held two ZSET members for one
     * person, ZCARD answered 2, and the gate opened for a reader who was
     * genuinely alone — the one thing "more than 1 person live" means.
     */
    const fake = fakeStorage()
    ;(globalThis as any).chrome = fake.chrome

    vi.resetModules()
    const panel = await import("~/helpers/presence")
    vi.resetModules()
    const page = await import("~/helpers/presence")
    expect(panel.siteAnonId, "two module instances, not one").not.toBe(
      page.siteAnonId,
    )

    const raced = await Promise.all([panel.siteAnonId(), page.siteAnonId()])
    expect(raced[0]).toBeTruthy()
    expect(raced[1]).toBeTruthy()

    // The ids handed out DURING the race may differ — the change events have
    // not been delivered yet. Every call after that agrees, and agrees with
    // what storage actually holds.
    const settled = fake.stored()
    expect(settled).toBeTruthy()
    expect(await panel.siteAnonId()).toBe(settled)
    expect(await page.siteAnonId()).toBe(settled)
  })

  it("creates exactly one id when two beats start together in one document", async () => {
    const fake = fakeStorage()
    ;(globalThis as any).chrome = fake.chrome
    vi.resetModules()
    const presence = await import("~/helpers/presence")

    const [a, b] = await Promise.all([
      presence.siteAnonId(),
      presence.siteAnonId(),
    ])
    expect(a).toBe(b)
    // The second call rode the first one's read instead of starting its own
    // and writing a second id over it.
    expect(fake.gets()).toBe(1)
    expect(fake.sets()).toBe(1)
  })

  it("adopts an id another document wrote after this one had cached its own", async () => {
    const fake = fakeStorage()
    ;(globalThis as any).chrome = fake.chrome
    vi.resetModules()
    const presence = await import("~/helpers/presence")

    const mine = await presence.siteAnonId()
    expect(mine).toBeTruthy()
    // Another context writes. Storage is last-write-wins, so this is now the
    // id every surface will see — including this one, which is the whole
    // point of the change listener.
    await fake.chrome.storage.local.set({ poppin_site_presence_anon: "theirs" })
    expect(await presence.siteAnonId()).toBe("theirs")
  })

  it("reads storage once and then holds the answer", async () => {
    const fake = fakeStorage()
    ;(globalThis as any).chrome = fake.chrome
    vi.resetModules()
    const presence = await import("~/helpers/presence")

    await presence.siteAnonId()
    const after = fake.gets()
    await presence.siteAnonId()
    await presence.siteAnonId()
    expect(fake.gets(), "a beat must not pay a storage round trip").toBe(after)
  })

  it("beats for nobody rather than inventing an id per call", async () => {
    // An orphaned page after an extension reload: chrome.storage is gone. A
    // fresh random id here would add one member to the pool every heartbeat.
    ;(globalThis as any).chrome = {}
    vi.resetModules()
    const presence = await import("~/helpers/presence")
    expect(await presence.siteAnonId()).toBeNull()
  })
})
