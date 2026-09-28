import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  TOP_UP_INTENT_KEY,
  readTopUpIntent,
  rememberTopUpIntent,
  rememberTopUpIntentIfNone,
} from "~/helpers/topUpIntent"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const REPO = join(__dirname, "..", "..", "..")
const BACKEND_EVENTS_FILE = join(
  REPO,
  "apps",
  "backend",
  "src",
  "user-events",
  "user-events.controller.ts",
)

/**
 * THE ONE NEW ACTIVATION LEVER, MEASURED AS NOTHING.
 *
 * components/FundDoor.tsx shipped 2026-09-22 with no telemetry of any kind:
 * not the impression, not the press on "Deposit USDC", and nothing at all on
 * the connect — not the press, not the success, not the refusals it prints.
 * The week's whole problem is that eight signed-in strangers have produced no
 * funding screen, no deposit and no trade, and nobody can say where they
 * stop; a door built to answer that, which counts nothing, leaves the answer
 * exactly where it was.
 *
 * TWO WAYS A COUNT SILENTLY BECOMES A ZERO, and both are held here:
 *   • an event name with no home in TELEMETRY_MAP is DROPPED by the
 *     background ("an event with no home here is dropped, never guessed at"),
 *     which has already happened to real funnel steps twice;
 *   • a type the backend's TRACKABLE_EVENTS does not list is refused at the
 *     route, so the row is never written at all.
 *
 * The door itself is read as source — jsdom plus @mui cannot render these
 * views (components/panel-fit-320.spec.ts) — but the two maps are PARSED, so
 * a name added to the door with no map entry fails here rather than in a
 * dashboard three weeks later.
 */

/** The event names this surface actually emits. */
const emitted = (src: string): string[] =>
  [...src.matchAll(/\bcount\("([a-z0-9_]+)"/g)].map((m) => m[1])

/** name → backend event_type, as the background's own table has it. */
function telemetryMap(): Record<string, string> {
  const bg = read("entries/background/main.ts")
  const at = bg.indexOf("const TELEMETRY_MAP: Record<string, string> = {")
  expect(at, "TELEMETRY_MAP is gone from entries/background/main.ts").toBeGreaterThan(-1)
  const end = bg.indexOf("\n}", at)
  const body = stripComments(bg.slice(at, end))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/^\s*([a-z0-9_]+):\s*"([a-z0-9_]+)",/gim)) out[m[1]] = m[2]
  expect(Object.keys(out).length).toBeGreaterThan(20)
  return out
}

/** The only event_types the backend will store, from the backend itself. */
function trackableEvents(): string[] {
  const src = readFileSync(BACKEND_EVENTS_FILE, "utf8")
  const at = src.indexOf("const TRACKABLE_EVENTS = [")
  expect(at, "TRACKABLE_EVENTS is gone from the user-events controller").toBeGreaterThan(-1)
  const end = src.indexOf("] as const", at)
  return [...src.slice(at, end).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
}

describe("the funding door counts itself", () => {
  const door = stripComments(read("components/FundDoor.tsx"))

  it("takes the road every other surface takes", () => {
    // Not a second telemetry client: the same message the chip, the panel and
    // the address screen already send, which is what the background listens
    // for and what carries the install id and the 401 fallback.
    expect(door).toMatch(/type: "SPOT_TELEMETRY", event, payload/)
    expect(door).not.toMatch(/backendApi|fetch\(|sendApiRequest/)
  })

  it("counts the impression, the press, and all three endings of the connect", () => {
    const names = emitted(door)
    for (const moment of [
      // it was drawn at all — the denominator nothing else can supply
      "panel_fund_shown",
      // "Deposit USDC"
      "panel_fund_press",
      // "or connect a wallet you already have"
      "panel_fund_connect",
      // the wallet is now the account's — the activation itself
      "panel_fund_connected",
      // and the refusals, which are three different next moves
      "panel_fund_connect_refused",
    ]) {
      expect(names, `${moment} is not counted anywhere in the door`).toContain(moment)
    }
  })

  it("waits for the account before claiming which door was shown", () => {
    /* `external` decides which of the two doors this is, and it is a read of
       /users/me. Counting before that answers would file the wallet door as
       the custodial one — a measurement of our own loading state. Same fact
       views/receive.tsx waits on for receive_opened. */
    expect(door).toMatch(/if \(seen\.current \|\| me === undefined\) return/)
    expect(door).toMatch(/count\("panel_fund_shown", \{ external \}\)/)
    expect(door).toMatch(/\}, \[me === undefined\]\)/)
  })

  it("says WHICH refusal, because each one is a different next move", () => {
    // An address another account owns, a Poppin wallet that still holds
    // money, an account already trading from a wallet, a closed window. One
    // number for all four would say people stop here and nothing about why.
    expect(door).toMatch(/count\("panel_fund_connect_refused", \{\s*reason:/)
    expect(door).toMatch(/m\.slice\(0, 120\)/)
  })

  it("counts the press BEFORE the thing that can hang, so the denominator survives", () => {
    const press = door.indexOf('count("panel_fund_connect"')
    const ask = door.indexOf("await connectWalletViaPage()")
    expect(press).toBeGreaterThan(-1)
    expect(ask).toBeGreaterThan(press)
  })
})

describe("every name the door emits can actually be stored", () => {
  const door = stripComments(read("components/FundDoor.tsx"))
  const map = telemetryMap()

  it("has a home in the background's map — an unmapped event is dropped in silence", () => {
    for (const name of emitted(door)) {
      expect(map[name], `${name} has no TELEMETRY_MAP entry: the background drops it`).toBeTruthy()
    }
  })

  it("the backend's own list is where this repo keeps it", () => {
    expect(
      existsSync(BACKEND_EVENTS_FILE),
      `${BACKEND_EVENTS_FILE} is missing. If the controller moved, update this ` +
        "path — do not delete this spec: it is the only thing that catches an " +
        "event_type the route will refuse.",
    ).toBe(true)
  })

  it("maps to a type the route will accept, never to a new one", () => {
    const allowed = trackableEvents()
    expect(allowed).toContain("card_shown")
    for (const name of emitted(door)) {
      expect(
        allowed,
        `${name} maps to "${map[name]}", which the backend's TRACKABLE_EVENTS does not list: ` +
          "the POST is refused and the row is never written.",
      ).toContain(map[name])
    }
  })

  it("keeps the detail in metadata, where a new fact needs no backend deploy", () => {
    // deliverTelemetry writes metadata: { event, ...payload } on every row, so
    // the door's own five names survive inside an accepted type.
    const bg = stripComments(read("entries/background/main.ts"))
    expect(bg).toMatch(/metadata: \{ event, \.\.\.\(\(payload as Record<string, unknown>\) \?\? \{\}\) \}/)
  })
})

/**
 * AND THE ONE-LINE BUG BESIDE IT. The door called rememberTopUpIntent() with
 * no arguments — deliberately, because no amount was typed at it — and an
 * empty intent is still an intent: it overwrote the {usd, mint} a chip's
 * Deposit door had written minutes earlier. The address screen then had
 * nothing to say the buy was for, and the arrival toast returned the reader
 * nowhere.
 */
describe("the door with no buy behind it does not erase one", () => {
  const store = new Map<string, unknown>()
  const fakeChrome = {
    storage: {
      local: {
        set: async (o: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(o)) store.set(k, v)
        },
        get: async (k: string) => ({ [k]: store.get(k) }),
      },
    },
  }

  afterEach(() => {
    store.clear()
    vi.unstubAllGlobals()
  })

  it("keeps a live buy's amount and coin", async () => {
    vi.stubGlobal("chrome", fakeChrome)
    // A chip's Deposit door, three minutes ago: $25 towards $WIF.
    rememberTopUpIntent(25, { mint: "WIF", buyUsd: 25, ticker: "$WIF" }, null, 1_000_000)
    await rememberTopUpIntentIfNone(1_000_000 + 3 * 60_000)
    expect(await readTopUpIntent(undefined, 1_000_000 + 3 * 60_000)).toMatchObject({
      usd: 25,
      mint: "WIF",
      at: 1_000_000,
    })
  })

  it("still marks the moment when there is nothing to lose", async () => {
    vi.stubGlobal("chrome", fakeChrome)
    await rememberTopUpIntentIfNone(2_000_000)
    // The timestamp is the point: the deposit watcher times "minutes since a
    // Deposit door was pressed" off exactly this.
    expect(store.get(TOP_UP_INTENT_KEY)).toMatchObject({ usd: null, at: 2_000_000, mint: null })
  })

  it("writes over one the screen would no longer read anyway", async () => {
    vi.stubGlobal("chrome", fakeChrome)
    rememberTopUpIntent(25, { mint: "WIF" }, null, 1_000_000)
    // Sixteen minutes later that intent is past the screen's window; the
    // reader is starting again, and this door is the start.
    await rememberTopUpIntentIfNone(1_000_000 + 16 * 60_000)
    expect(store.get(TOP_UP_INTENT_KEY)).toMatchObject({
      usd: null,
      mint: null,
      at: 1_000_000 + 16 * 60_000,
    })
  })

  it("is what the door calls", () => {
    const door = stripComments(read("components/FundDoor.tsx"))
    expect(door).toMatch(/void rememberTopUpIntentIfNone\(\)/)
    expect(door).not.toMatch(/rememberTopUpIntent\(\)/)
  })
})
