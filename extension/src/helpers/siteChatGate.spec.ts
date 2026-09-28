import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  initialSiteChatGate,
  siteChatGateReduceAll,
  siteChatGateReducer,
  siteChatGateView,
  SITE_CHAT_MIN_POPULATION,
  SITE_PRESENCE_COUNT_STALE_MS,
  SITE_PRESENCE_TTL_SECONDS,
  type SiteChatGateEvent,
  type SiteChatGateState,
} from "./siteChatGate"

/**
 * R5 IS A SEQUENCE, SO IT IS TESTED AS ONE.
 *
 * "You may ENTER only when more than 1 person is live. Once inside you are
 * NEVER kicked out — even alone — until YOU leave. After leaving you cannot
 * re-enter until the count is again > 1."
 *
 * Every clause of that is a transition below, and the long walk in the first
 * block is the whole requirement read end to end: alone → a second arrives →
 * enter → the others leave → still a member → leave → locked out → the room
 * fills again. The rest of the file is the awkward paths: a reload, a dropped
 * socket, two tabs, signing out, and Redis refusing to answer.
 *
 * The reducer is pure, so all of this runs with no socket, no browser, no
 * clock and no database — `at` and `now` are parameters. That is the point of
 * having a reducer at all.
 */

const T = 1_700_000_000_000
const HOST = "x.com"

const walk = (events: SiteChatGateEvent[], from?: SiteChatGateState) =>
  siteChatGateReduceAll(from ?? initialSiteChatGate(), events)

const onHost = (at = T): SiteChatGateEvent[] => [
  { type: "host", host: HOST, at },
  { type: "signed-in", signedIn: true, at },
]

describe("the whole of R5, in order", () => {
  it("walks a reader in, keeps them in when the room empties, and locks them out only when they leave", () => {
    let s = walk(onHost())
    // No answer yet. UNKNOWN renders NOTHING — never 0, which would tell every
    // reader the place is dead.
    expect(siteChatGateView(s, T).state).toBe("UNKNOWN")
    expect(siteChatGateView(s, T).visible).toBe(false)
    expect(siteChatGateView(s, T).count).toBeNull()

    // Just the reader. A count of 1 is themselves, so there is no pill.
    s = siteChatGateReducer(s, { type: "presence", host: HOST, count: 1, at: T })
    expect(siteChatGateView(s, T).state).toBe("ALONE")
    expect(siteChatGateView(s, T).visible).toBe(false)

    // Somebody else arrives. Now the door exists.
    s = siteChatGateReducer(s, {
      type: "presence",
      host: HOST,
      count: 2,
      at: T + 1_000,
    })
    let v = siteChatGateView(s, T + 1_000)
    expect(v.state).toBe("OPEN")
    expect(v.visible).toBe(true)
    expect(v.pressable).toBe(true)
    expect(v.showCount).toBe(true)
    expect(v.count).toBe(2)

    // They press it and the server admits them.
    s = siteChatGateReducer(s, {
      type: "join-ok",
      host: HOST,
      count: 2,
      at: T + 2_000,
    })
    expect(siteChatGateView(s, T + 2_000).state).toBe("MEMBER")

    // THE OTHERS LEAVE. This is the clause the deleted chat could not honour:
    // the count falls back to 1 and the reader is STILL in the room.
    s = siteChatGateReducer(s, {
      type: "presence",
      host: HOST,
      count: 1,
      at: T + 3_000,
    })
    v = siteChatGateView(s, T + 3_000)
    expect(v.state).toBe("MEMBER")
    expect(v.visible).toBe(true)
    expect(v.pressable).toBe(true)
    // …and the pill stops claiming a size, because "1 live" would be the
    // reader announcing themselves.
    expect(v.showCount).toBe(false)

    // Only leaving leaves.
    s = siteChatGateReducer(s, { type: "left", host: HOST, at: T + 4_000 })
    v = siteChatGateView(s, T + 4_000)
    expect(v.state).toBe("ALONE")
    expect(v.visible).toBe(false)

    // Locked out: the server refuses the way it refuses any stranger.
    s = siteChatGateReducer(s, {
      type: "join-refused",
      host: HOST,
      error: "gate_closed",
      count: 1,
      at: T + 5_000,
    })
    expect(siteChatGateView(s, T + 5_000).state).toBe("ALONE")

    // The room fills again and the door comes back.
    s = siteChatGateReducer(s, {
      type: "presence",
      host: HOST,
      count: 3,
      at: T + 6_000,
    })
    expect(siteChatGateView(s, T + 6_000).state).toBe("OPEN")
  })

  it("does not change the count when the reader leaves the chat", () => {
    // I1, client half: PRESENCE and MEMBERSHIP are different things. Leaving
    // the conversation does not take you off the page, so the number everyone
    // else is gated on must not move. This is the property that makes the gate
    // free of feedback: your own arrival and departure cannot move the count
    // that admitted you.
    const before = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 4, at: T },
      { type: "join-ok", host: HOST, count: 4, at: T },
    ])
    const after = siteChatGateReducer(before, {
      type: "left",
      host: HOST,
      at: T + 1,
    })
    expect(after.count).toBe(before.count)
    expect(after.countAt).toBe(before.countAt)
    expect(after.member).toBe(false)
  })

  it("never lets the count evict a member, however it falls", () => {
    const member = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 2, at: T },
      { type: "join-ok", host: HOST, count: 2, at: T },
    ])
    for (const count of [1, 0]) {
      const s = siteChatGateReducer(member, {
        type: "presence",
        host: HOST,
        count,
        at: T + 1,
      })
      expect(s.member).toBe(true)
      expect(siteChatGateView(s, T + 1).state).toBe("MEMBER")
    }
    // Even a refusal that arrives late cannot revoke it: only `left` and
    // `not-a-member` do, and both of those are the server saying so.
    const late = siteChatGateReducer(member, {
      type: "join-refused",
      host: HOST,
      error: "gate_closed",
      count: 1,
      at: T + 2,
    })
    expect(siteChatGateView(late, T + 2).state).toBe("MEMBER")
  })
})

describe("coming back", () => {
  it("re-admits a member on reload, alone, without the count mattering", () => {
    // Membership is durable server-side (per user, 30 days) and is checked
    // BEFORE the population, so a reader who reopens the panel alone in an
    // empty room is admitted having never faced the gate. The client's job is
    // only not to contradict that.
    const fresh = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 1, at: T },
    ])
    expect(siteChatGateView(fresh, T).state).toBe("ALONE")

    // The server answers `count: 0` when Redis could not fill the reply — the
    // decision was already made, so it cannot re-gate anyone.
    const back = siteChatGateReducer(fresh, {
      type: "join-ok",
      host: HOST,
      count: 0,
      at: T + 10,
    })
    const v = siteChatGateView(back, T + 10)
    expect(v.state).toBe("MEMBER")
    expect(v.visible).toBe(true)
    expect(v.showCount).toBe(false)
  })

  it("treats a second tab exactly like the first", () => {
    // Membership is per USER, not per socket, so both tabs are told `ok` and
    // both render MEMBER. A second admission is not news and not a change.
    const one = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 2, at: T },
      { type: "join-ok", host: HOST, count: 2, at: T },
    ])
    const two = siteChatGateReducer(one, {
      type: "join-ok",
      host: HOST,
      count: 2,
      at: T,
    })
    expect(two.member).toBe(true)
    expect(siteChatGateView(two, T).state).toBe("MEMBER")
  })

  it("corrects a client that believes it is inside when the server says otherwise", () => {
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 3, at: T },
      { type: "join-ok", host: HOST, count: 3, at: T },
      { type: "not-a-member", host: HOST, at: T + 1 },
    ])
    expect(s.member).toBe(false)
    // Back to being a stranger at an open door, not stranded.
    expect(siteChatGateView(s, T + 1).state).toBe("OPEN")
  })
})

describe("who the reader is", () => {
  it("shows the pill to a signed-out reader and sends the press somewhere else", () => {
    const s = walk([
      { type: "host", host: HOST, at: T },
      { type: "presence", host: HOST, count: 5, at: T },
    ])
    const v = siteChatGateView(s, T)
    expect(v.state).toBe("SIGNED_OUT")
    // The count is public — presence counts signed-out readers, and hiding the
    // number from them would make the room look emptier than it is.
    expect(v.visible).toBe(true)
    expect(v.pressable).toBe(true)
    expect(v.showCount).toBe(true)
  })

  it("hides it from a signed-out reader who is alone, like everyone else", () => {
    const s = walk([
      { type: "host", host: HOST, at: T },
      { type: "presence", host: HOST, count: 1, at: T },
    ])
    expect(siteChatGateView(s, T).state).toBe("ALONE")
  })

  it("drops membership when the reader signs out, and keeps the count", () => {
    // The durable record on the server is untouched — signing back in walks
    // straight in. This browser simply can no longer prove it is that user.
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 4, at: T },
      { type: "join-ok", host: HOST, count: 4, at: T },
      { type: "signed-in", signedIn: false, at: T + 1 },
    ])
    expect(s.member).toBe(false)
    expect(s.count).toBe(4)
    expect(siteChatGateView(s, T + 1).state).toBe("SIGNED_OUT")
  })

  it("signs out on the server's word, not on a guess", () => {
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 2, at: T },
      { type: "join-refused", host: HOST, error: "signed_out", at: T },
    ])
    expect(s.signedIn).toBe(false)
    expect(siteChatGateView(s, T).state).toBe("SIGNED_OUT")
  })
})

describe("when the server cannot answer", () => {
  it("renders a fact with no door when Redis is down", () => {
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 3, at: T },
      { type: "join-refused", host: HOST, error: "unavailable", at: T + 1 },
    ])
    const v = siteChatGateView(s, T + 1)
    expect(v.state).toBe("UNAVAILABLE")
    expect(v.reason).toBe("error")
    // The count itself came from presence and is still true, so the pill keeps
    // saying it — it just stops being a control. That is exactly how the
    // product renders this pill today.
    expect(v.visible).toBe(true)
    expect(v.pressable).toBe(false)
    expect(v.count).toBe(3)
  })

  it("never turns a missing count into 0", () => {
    // The gateway answers `{ ok: true, count: null }` when it could not ask
    // Redis, and the transport dispatches NOTHING for it. There is deliberately
    // no event carrying a null count, because such an event is an invitation to
    // render zero.
    const s = walk(onHost())
    expect(s.count).toBeNull()
    expect(siteChatGateView(s, T).count).toBeNull()
    expect(siteChatGateView(s, T).state).toBe("UNKNOWN")
  })

  it("goes quiet rather than lying once a count has expired", () => {
    // A presence entry the server has already pruned is not a stale number, it
    // is a wrong one. A panel reopened after ten minutes shows nothing until
    // its first hello answers.
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 9, at: T },
    ])
    expect(siteChatGateView(s, T + SITE_PRESENCE_COUNT_STALE_MS - 1).count).toBe(9)
    const dead = siteChatGateView(s, T + SITE_PRESENCE_COUNT_STALE_MS)
    expect(dead.count).toBeNull()
    expect(dead.state).toBe("UNKNOWN")
    expect(dead.visible).toBe(false)
  })

  it("keeps a member visible after their count expires, with no number", () => {
    // R5 outlives the count: the reader is still in the room, we just no
    // longer know how many people are with them.
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 6, at: T },
      { type: "join-ok", host: HOST, count: 6, at: T },
    ])
    const v = siteChatGateView(s, T + SITE_PRESENCE_COUNT_STALE_MS + 1)
    expect(v.state).toBe("MEMBER")
    expect(v.visible).toBe(true)
    expect(v.showCount).toBe(false)
    expect(v.count).toBeNull()
  })
})

describe("O3 — the kill switch, seen from the client", () => {
  it("renders as the product does today when the feature is dark", () => {
    const s = walk([
      ...onHost(),
      { type: "join-refused", host: HOST, error: "disabled", at: T },
    ])
    const v = siteChatGateView(s, T)
    expect(v.state).toBe("UNAVAILABLE")
    expect(v.reason).toBe("disabled")
    expect(v.pressable).toBe(false)
  })

  it("closes the door even for someone who was inside", () => {
    // `disabled` is the one verdict that outranks MEMBER: while the flag is
    // off the door does not exist for anyone, and the server refuses every
    // verb the same way.
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 5, at: T },
      { type: "join-ok", host: HOST, count: 5, at: T },
      { type: "join-refused", host: HOST, error: "disabled", at: T + 1 },
    ])
    expect(siteChatGateView(s, T + 1).state).toBe("UNAVAILABLE")
    expect(siteChatGateView(s, T + 1).pressable).toBe(false)
  })

  it("treats a host the server will not fold as no chat at all", () => {
    const s = walk([
      ...onHost(),
      { type: "join-refused", host: HOST, error: "bad_host", at: T },
    ])
    expect(siteChatGateView(s, T).reason).toBe("bad_host")
    expect(siteChatGateView(s, T).pressable).toBe(false)
  })
})

describe("one host at a time", () => {
  it("drops a reply that arrives after the reader has moved on", () => {
    // Socket replies are asynchronous. A `join` answered for the previous tab
    // must never tell the reader they are a member of the site they just left.
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 2, at: T },
      { type: "host", host: "example.com", at: T + 1 },
      { type: "join-ok", host: HOST, count: 9, at: T + 2 },
      { type: "presence", host: HOST, count: 9, at: T + 2 },
    ])
    expect(s.host).toBe("example.com")
    expect(s.member).toBe(false)
    expect(s.count).toBeNull()
    expect(siteChatGateView(s, T + 2).state).toBe("UNKNOWN")
  })

  it("forgets the room but not the reader when the page changes", () => {
    const s = walk([
      ...onHost(),
      { type: "presence", host: HOST, count: 3, at: T },
      { type: "join-ok", host: HOST, count: 3, at: T },
      { type: "host", host: "example.com", at: T + 1 },
    ])
    // Membership is per host, so it does not travel.
    expect(s.member).toBe(false)
    // Being signed in is a fact about the person, not the page.
    expect(s.signedIn).toBe(true)
  })

  it("says nothing at all on a page with no room", () => {
    const s = walk([...onHost(), { type: "host", host: null, at: T + 1 }])
    expect(siteChatGateView(s, T + 1).state).toBe("UNKNOWN")
    expect(siteChatGateView(s, T + 1).visible).toBe(false)
  })
})

describe("the reducer is a reducer", () => {
  it("does not mutate what it is given", () => {
    const before = walk([...onHost(), { type: "presence", host: HOST, count: 2, at: T }])
    const snapshot = JSON.stringify(before)
    siteChatGateReducer(before, { type: "join-ok", host: HOST, count: 2, at: T })
    siteChatGateReducer(before, { type: "left", host: HOST, at: T })
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it("is the same answer every time for the same input", () => {
    const start = walk(onHost())
    const e: SiteChatGateEvent = { type: "presence", host: HOST, count: 2, at: T }
    expect(siteChatGateReducer(start, e)).toEqual(siteChatGateReducer(start, e))
  })

  it("touches nothing the panel does not have", () => {
    // The gate has to be testable with no socket, no chrome and no store, so
    // it may not import any of them. If this ever fails, the rule moved into
    // something that can only be exercised through a browser.
    const src = readFileSync(join(__dirname, "siteChatGate.ts"), "utf8")
    expect(src).not.toMatch(/from "socket\.io-client"/)
    expect(src).not.toMatch(/from "zustand"/)
    expect(src).not.toMatch(/\bchrome\./)
    expect(src).not.toMatch(/\bfetch\(/)
    expect(src).not.toMatch(/Date\.now\(\)/)
  })
})

describe("the client's numbers are the server's numbers", () => {
  /**
   * The server decides admission; these constants only decide what to draw.
   * A client that offers a door the server will refuse — or hides one it would
   * open — is worse than a client with no door, so the two files are compared
   * rather than trusted.
   */
  const REPO = join(__dirname, "..", "..", "..")
  const CONFIG = join(REPO, "apps", "backend", "src", "site-chat", "site-chat.config.ts")
  const DTO = join(
    REPO,
    "apps",
    "backend",
    "src",
    "site-chat",
    "dto",
    "site-chat-events.dto.ts",
  )

  it("the backend config is where we think it is", () => {
    expect(
      existsSync(CONFIG),
      `${CONFIG} is missing — update this path rather than deleting the check.`,
    ).toBe(true)
  })

  const config = existsSync(CONFIG) ? readFileSync(CONFIG, "utf8") : ""

  const num = (name: string) => {
    const m = config.match(new RegExp(`${name} = ([0-9]+)`))
    return m ? Number(m[1]) : NaN
  }

  it("uses the server's gate threshold", () => {
    expect(SITE_CHAT_MIN_POPULATION).toBe(num("SITE_CHAT_MIN_POPULATION"))
  })

  it("uses the server's presence TTL", () => {
    expect(SITE_PRESENCE_TTL_SECONDS).toBe(num("SITE_PRESENCE_TTL_SECONDS"))
    // The stale bound is the TTL, not a number of its own: past it, the
    // server has already pruned the people the count describes.
    expect(SITE_PRESENCE_COUNT_STALE_MS).toBe(SITE_PRESENCE_TTL_SECONDS * 1000)
  })

  it("beats at the cadence the server asks for", () => {
    // The heartbeat itself lives in helpers/presence.ts, so the number that
    // matters is THAT one — a client beating slower than the server's refresh
    // drops readers out of the pool between beats, and the pool is what the
    // gate reads.
    const beats = readFileSync(join(__dirname, "presence.ts"), "utf8")
    const ms = Number(beats.match(/SITE_PRESENCE_REFRESH_MS = ([0-9_]+)/)?.[1]?.replace(/_/g, ""))
    expect(ms).toBe(num("SITE_PRESENCE_REFRESH_SECONDS") * 1000)
    // …and it has to survive a missed beat inside the TTL.
    expect(ms * 2).toBeLessThan(SITE_PRESENCE_TTL_SECONDS * 1000)
  })

  it("knows every refusal `join` can answer with", () => {
    // A refusal the client does not recognise falls through the reducer's
    // switch and leaves the pill claiming the door still works.
    const dto = existsSync(DTO) ? readFileSync(DTO, "utf8") : ""
    const declared = dto
      .split("export type SiteChatJoinError =")[1]
      ?.split(";")[0]
      ?.match(/'([a-z_]+)'/g)
      ?.map((s) => s.replace(/'/g, ""))
    expect(declared, "could not read SiteChatJoinError from the backend DTO").toBeTruthy()
    const gate = readFileSync(join(__dirname, "siteChatGate.ts"), "utf8")
    const handled = gate
      .split("export type SiteChatJoinRefusal =")[1]
      ?.split("\n\n")[0] ?? ""
    for (const code of declared!) {
      expect(handled, `siteChatGate.ts does not know the refusal "${code}"`).toContain(
        `"${code}"`,
      )
    }
  })
})

describe("I1 — nothing that writes PRESENCE may write MEMBERSHIP, or the reverse", () => {
  const transport = readFileSync(join(__dirname, "siteChatTransport.ts"), "utf8")
  const code = transport
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("never sends `hello`, so the socket cannot enter the pool", () => {
    // The gateway counts an AUTHENTICATED socket as "u:<userId>"
    // (site-chat.gateway.ts:304) while every heartbeat this extension sends is
    // anonymous — one shared per-install id, from helpers/presence.ts. A hello
    // from here would therefore add a SECOND member for one reader, and two
    // members is exactly the question the gate asks: "more than 1 person live"
    // would come true for somebody sitting alone.
    expect(code).not.toMatch(/"hello"/)
  })

  it("sends no anonId in the handshake, so it could not be counted anyway", () => {
    // The field exists only to de-duplicate a presence member for `hello`.
    // Leaving it out is what makes "this socket cannot write presence" a
    // property of the code rather than a promise in a comment.
    expect(code).not.toMatch(/anonId/)
  })

  it("keeps the heartbeat out of this file entirely", () => {
    // One implementation of the ping route, in helpers/presence.ts, with the
    // surfaces that already call it. Two would be two answers to "who is
    // here".
    expect(code).not.toMatch(/presence\/ping/)
  })

  it("does not delete membership on a disconnect", () => {
    // A dropped socket is not a leave: membership is per user and durable
    // across tabs, devices and reconnects, and the server does not revoke on
    // disconnect either (site-chat.gateway.ts:261-263). Only an explicit
    // `leave` clears it, and `leave` is the only place that may.
    const disconnectHandler = code.match(/"disconnect",[\s\S]{0,120}/)?.[0] ?? ""
    expect(disconnectHandler).not.toMatch(/joined = false/)

    /**
     * EVERY CLEAR IS ONE OF FOUR KINDS, AND THIS CHECKS THE KIND RATHER THAN
     * THE COUNT.
     *
     * This used to assert `clears.length === 5` and name the five in prose. It
     * went red the moment `delete` and `report` were added — two verbs that
     * clear for the SAME reason `post` and `history` already did, so the
     * invariant was untouched and only the tally was wrong. A count is the
     * wrong shape for this rule: it fails on every correct addition and it
     * would pass a WRONG clear that arrived while a right one left.
     *
     * The rule is not "there are five". It is: membership is client state
     * mirroring the server's, so it may only be cleared when the server has
     * said so, when the reader has left this website, or when the transport is
     * being thrown away — and NEVER by a socket event, because a dropped
     * socket is not a leave. That is R5.
     */
    const ALLOWED = [
      // The server just refused a verb with `not_member`: our mirror is stale
      // and this is the correction. Every authenticated verb may do this.
      /error === "not_member"\) joined = false/,
      // A leave the server CONFIRMED. Believing we left when we did not would
      // strand the reader outside a room the server still holds them in.
      /if \(reply\?\.ok\) \{\s*joined = false/,
      // The reader moved to another website. Membership is per host, so this
      // is the client forgetting where it is — the server's record is untouched.
      /host = canonical;?\s*joined = false/,
      // The transport is being destroyed.
      /destroyed = true[\s\S]{0,80}joined = false/,
    ]
    const clears = code.match(/(?<!let\s)joined = false/g) ?? []
    expect(clears.length, "the transport stopped tracking membership").toBeGreaterThan(0)
    const accounted = ALLOWED.reduce(
      (n, re) => n + (code.match(new RegExp(re, "g")) ?? []).length,
      0,
    )
    expect(
      accounted,
      `${clears.length} clears of \`joined\`, only ${accounted} of them one of ` +
        `the four allowed kinds. An unaccounted clear is membership being ` +
        `dropped for a reason R5 does not permit — most likely a socket event.`,
    ).toBe(clears.length)
  })
})

describe("I3 — identity is never in a frame", () => {
  it("sends no userId on any client→server verb", () => {
    // The deleted gateway did `payload.userId || socketToUser.get(client.id)`
    // and let anyone address a message as anyone. The replacement takes
    // identity from the ticket verified at the handshake, so no outbound frame
    // in this extension may carry one — not even helpfully.
    const transport = readFileSync(join(__dirname, "siteChatTransport.ts"), "utf8")
    const emits = transport.match(/ask<[^>]*>\(s, "[a-z]+", \{[^}]*\}/g) ?? []
    expect(emits.length).toBeGreaterThan(0)
    for (const frame of emits) {
      expect(frame, `${frame} carries an identity`).not.toMatch(/userId/)
    }
  })
})

describe("R5 survives the DOCUMENT dying, not only the socket", () => {
  /**
   * The reducer, the transport's re-join and the server's 30-day record all
   * survive a dropped CONNECTION. None of them survives a closed side panel:
   * the document is destroyed, the store is constructed fresh with
   * `member: false`, and Layout navigates straight back into the chat route
   * (components/Layout.tsx restores the persisted path on mount). Without a
   * durable hint, a member reopened the panel to "one more person needs to be
   * here" — locked out of a room they never left.
   *
   * The protocol has no verb that asks "am I already a member?" — the gateway
   * exposes hello / join / post / history / leave / reauth — so the client
   * remembers WHERE it was admitted and re-sends `join`. These tests pin the
   * two properties that make that safe rather than a client-side gate.
   */
  const store = readFileSync(
    join(__dirname, "..", "store", "useSiteChatStore.ts"),
    "utf8",
  )
  const storeCode = store
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

  const resumeBody =
    storeCode.match(/const resumeMembership = async[\s\S]*?\n  \}\n/)?.[0] ?? ""

  it("remembers where it was admitted, past the life of the document", () => {
    // chrome.storage.local, so it outlives the panel exactly the way the
    // server's record outlives the socket.
    expect(storeCode).toMatch(/chrome\.storage\.local/)
    expect(storeCode).toMatch(/writeMemberHint/)
    // Written on an admission, erased on every proof of non-membership.
    expect(storeCode).toMatch(/clearMemberHint/)
  })

  it("re-asks the server when the panel reopens on a remembered host", () => {
    expect(resumeBody, "resumeMembership is gone or was renamed").toBeTruthy()
    expect(resumeBody).toMatch(/hasMemberHint/)
    expect(resumeBody).toMatch(/\.join\(\)/)
    // setPage is the reopen path: the panel points the feature at a page on
    // mount, so that is where a remembered member gets to walk back in.
    expect(storeCode).toMatch(/resumeMembership\(host\)/)
  })

  it("I2 — the resume never reads the population", () => {
    // The count is read in exactly ONE function and that function is the
    // server's (decideAdmission checks membership BEFORE the population). A
    // resume that consulted `count` would be a second gate, on the client,
    // deciding the very thing R5 says nothing may decide.
    expect(resumeBody).not.toMatch(/SITE_CHAT_MIN_POPULATION/)
    expect(resumeBody).not.toMatch(/gate\.count/)
    expect(resumeBody).not.toMatch(/count\s*[<>]/)
  })

  it("changes nothing when a resume cannot reach the server", () => {
    // Nobody pressed anything, so a catch-all `unavailable` must not put the
    // gate into "try again" — a state that outlives the failure and hides a
    // door the heartbeat still says is open.
    expect(resumeBody.replace(/\s+/g, " ")).toMatch(
      /error === "unavailable"\) \{ return/,
    )
  })

  it("asks for a credential before it opens a socket", () => {
    // A reader we cannot authenticate must not cost a connection, and a mint
    // that fails here says nothing on screen — the transport is the only thing
    // allowed to report identity, and it does that when somebody presses.
    expect(resumeBody).toMatch(/getSiteChatTicket\(\)/)
    expect(resumeBody).not.toMatch(/onAuth/)
  })

  it("keeps the rendered conversation bounded, and de-dupes without rescanning it", () => {
    // A panel left open on a busy room used to accumulate every message for
    // the life of the document and rebuild a Set of every id on every frame.
    expect(storeCode).toMatch(/MAX_LIVE_MESSAGES/)
    expect(storeCode).not.toMatch(/new Set\(s\.messages/)
  })
})

describe("a failure is reported as the kind of failure it is", () => {
  /**
   * onAuth(false) clears `member` in the reducer (the `signed-in` case). So
   * calling it for a reason the SERVER never gave — a wifi hop, a laptop
   * waking mid-request, one 500 from the mint route — ejects a reader from a
   * room the server still has them in, and does it as a sign-in prompt shown
   * to somebody who is signed in. That is the eviction R5 forbids, arriving
   * through the back door.
   */
  const transport = readFileSync(join(__dirname, "siteChatTransport.ts"), "utf8")
  const code = transport
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
  const mapping =
    code.match(/function reportMintFailure[\s\S]*?\n  \}\n/)?.[0] ?? ""

  it("routes every mint failure through one mapping", () => {
    expect(mapping, "reportMintFailure is gone or was renamed").toBeTruthy()
    // Both call sites — the handshake and the pre-verb refresh — go through it
    // rather than deciding for themselves.
    expect(code).toMatch(/!ticket\.ok\)\s*\{\s*reportMintFailure/)
    expect(code).toMatch(/!minted\.ok\)\s*\{\s*reportMintFailure/)
  })

  it("only calls it identity when the server judged the identity", () => {
    expect(mapping).toMatch(/signed_out/)
    expect(mapping).toMatch(/suspended/)
    expect(mapping).toMatch(/onAuth\(false\)/)
  })

  it("renders a 404 as no-chat-here, which is the shipped pill", () => {
    expect(mapping).toMatch(/no_chat/)
    expect(mapping).toMatch(/onDisabled/)
  })

  it("says nothing at all when the request simply failed", () => {
    // "error" is network / 5xx: the server said nothing, so neither do we.
    // Reporting it as a dropped socket would be a second lie — the socket may
    // be up, and its own connect events already carry that fact.
    expect(mapping).not.toMatch(/onConnection/)
    // Two reports of "no identity" in the whole file: this mapping, and the
    // `reauth` refusal, which is the server rejecting a ticket to our face.
    expect((code.match(/onAuth\(false\)/g) ?? []).length).toBe(2)
  })

  it("has no gate event a connection failure could dispatch", () => {
    // The reducer deliberately owns no notion of a socket. A dropped
    // connection is `connected: false` in the store and nothing else, so no
    // future edit can wire one into the gate by reflex.
    const gate = readFileSync(join(__dirname, "siteChatGate.ts"), "utf8")
    const events =
      gate.split("export type SiteChatGateEvent =")[1]?.split("\n\n")[0] ?? ""
    expect(events).toBeTruthy()
    expect(events).not.toMatch(/"connect/)
    expect(events).not.toMatch(/"disconnect/)
  })
})
