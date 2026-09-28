import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE WIRE, HELD AGAINST THE SERVER THAT DEFINES IT.
 *
 * This file exists because of one specific failure and guards against its
 * return: the transport subscribed to three events while the gateway emitted
 * four, and nothing anywhere said so. A missing listener is the quietest bug
 * in a socket client — no error, no warning, just a fact that never arrives —
 * and it is invisible in a diff of this file alone, because the defect lives
 * in the gap BETWEEN two files.
 *
 * So the assertions below read the gateway. Not a copied list of event names,
 * which is the same drift one indirection further out; the actual `.emit(`
 * sites. The day somebody adds a fifth event, this fails with its name in the
 * message rather than the feature quietly half-working.
 *
 * A source-reading spec, in the idiom the rest of the tree uses
 * (views/live-chat.spec.ts, helpers/siteChatGate.spec.ts). The properties here
 * — "there is a listener for every event", "this client cannot write presence"
 * — are properties of the CODE. A runtime test would need a socket.io server
 * and would still only prove the one path it bothered to set up.
 */

const HELPERS = __dirname
const SRC = join(HELPERS, "..")
const REPO = join(SRC, "..", "..")
const SITE_CHAT = join(REPO, "apps", "backend", "src", "site-chat")

const read = (p: string) => readFileSync(p, "utf8")

/**
 * Source with comments removed. The `[^:]` guard keeps `https://` out of the
 * line-comment rule.
 *
 * Stripping is load-bearing here rather than tidy: the gateway's own header
 * contains `socket.emit('join', { host }, (reply) => …)` as an EXAMPLE of how
 * a client calls a verb. Scanning the raw file would read that as a
 * server→client event named `join` and demand a listener for something the
 * server never sends.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const GATEWAY_PATH = join(SITE_CHAT, "site-chat.gateway.ts")
const CONFIG_PATH = join(SITE_CHAT, "site-chat.config.ts")
const TRANSPORT_SRC = read(join(HELPERS, "siteChatTransport.ts"))
const TRANSPORT = stripComments(TRANSPORT_SRC)

/** Everything the gateway can push, taken from where it actually pushes. */
function emittedEvents(): string[] {
  const gateway = stripComments(read(GATEWAY_PATH))
  const names = new Set<string>()
  for (const m of gateway.matchAll(/\.emit\('([a-z-]+)'/g)) names.add(m[1])
  return [...names].sort()
}

/**
 * The one event this client is allowed not to listen for, and the reason is
 * not preference — it is unreachable. `presence` is emitted only to the room
 * `presence:<host>`, which is joined only inside the gateway's `hello`
 * handler, and this client structurally never sends `hello` (it would add a
 * second presence member for one reader and open the gate for somebody sitting
 * alone). A listener would be a subscription to an event nobody addresses to
 * us — worse than none, because the next reader would believe the count is
 * pushed and stop looking for the poll that actually feeds it.
 *
 * If this set ever grows, the entry needs the same two things `presence` has:
 * a paragraph in the transport's header, and a reason that is about
 * reachability rather than about effort.
 */
const DELIBERATELY_IGNORED = new Set(["presence"])

describe("the gateway and this client agree about what can arrive", () => {
  it("finds the gateway where it expects it", () => {
    expect(
      existsSync(GATEWAY_PATH),
      "the gateway moved — re-point this drift guard rather than deleting it",
    ).toBe(true)
    // A regex that silently matched nothing would make every test below pass
    // by vacuum, which is the failure mode of every source-reading spec.
    expect(emittedEvents().length).toBeGreaterThanOrEqual(4)
  })

  it("has a listener for every event the server can push", () => {
    const missing = emittedEvents().filter(
      (name) =>
        !DELIBERATELY_IGNORED.has(name) &&
        !TRANSPORT.includes(`s.on("${name}"`),
    )
    expect(
      missing,
      `the gateway emits ${missing.join(", ")} and nothing here listens`,
    ).toEqual([])
  })

  it("wires the four that reach a member, by name", () => {
    // Named individually as well as swept, so a regression fails with the
    // event's own name rather than as an empty-array diff.
    for (const name of [
      "message",
      "member-joined",
      "member-left",
      "message-deleted",
    ]) {
      expect(TRANSPORT, `no listener for ${name}`).toMatch(
        new RegExp(`s\\.on\\("${name}"`),
      )
    }
  })

  it("declares the one it ignores, in the header, with its reason", () => {
    // The escape hatch is a paragraph, not a silence. Comments are NOT
    // stripped for this one assertion — the declaration is the point.
    expect(TRANSPORT_SRC).toMatch(/NOT WIRED/)
    expect(TRANSPORT_SRC).toMatch(/DELIBERATELY IGNORES/)
    // And the reason has to be the reachability one, not "we did not get to
    // it": the room is joined only by `hello`, which this client never sends.
    expect(TRANSPORT_SRC).toMatch(/handleHello/)
    expect(TRANSPORT_SRC).toMatch(/presence:<host>/)
  })

  it("still cannot write presence, which is what makes ignoring it correct", () => {
    /**
     * The whole argument collapses if this client ever says `hello`: it would
     * be counted as "u:<userId>" while the same reader's HTTP beat counts as
     * "a:<anonId>", and one person would fill both of the two seats the gate
     * is asking about. So the verb is absent, and so is the `anonId` the
     * handshake would need to carry to send it — the absence is structural,
     * not a promise.
     */
    expect(TRANSPORT).not.toMatch(/"hello"/)
    expect(TRANSPORT).not.toMatch(/anonId/)
  })
})

describe("the frames this client sends", () => {
  it("names the message and never the author, on both moderation verbs", () => {
    /**
     * I3. `delete` is author-only and `report` refuses `own_message`, and BOTH
     * rules are decided from the connection's verified ticket. A frame with a
     * userId in it would be a claim the server must then be careful to ignore;
     * there is simply no field.
     */
    for (const verb of ["delete", "report"]) {
      const frame = new RegExp(`ask<[^>]*>\\(s, "${verb}", \\{[^}]*`)
      const found = TRANSPORT.match(frame)?.[0] ?? ""
      expect(found, `no ${verb} frame`).not.toBe("")
      expect(found, `${found} carries an identity`).not.toMatch(/userId/)
      expect(found).toMatch(/messageId/)
    }
  })

  it("clips a report reason to the length the server will accept", () => {
    /**
     * The server's schema REFUSES a longer reason rather than truncating it
     * (dto/site-chat-events.dto.ts, `SiteChatReportSchema`), so an over-long
     * one is a round trip spent earning a refusal the reader did nothing to
     * deserve. Read from the backend rather than trusted, so the two cannot
     * drift apart quietly.
     */
    expect(
      existsSync(CONFIG_PATH),
      "site-chat.config.ts moved — re-point this drift guard rather than deleting it",
    ).toBe(true)
    const server = /SITE_CHAT_MAX_REPORT_REASON_CHARS\s*=\s*(\d+)/.exec(
      read(CONFIG_PATH),
    )
    expect(server?.[1]).toBeTruthy()
    const client = /SITE_CHAT_MAX_REPORT_REASON_CHARS\s*=\s*(\d+)/.exec(
      TRANSPORT,
    )
    expect(client?.[1]).toBe(server![1])
    expect(TRANSPORT).toMatch(/slice\(0, SITE_CHAT_MAX_REPORT_REASON_CHARS\)/)
    // An empty reason would be refused too — the field is optional and
    // `min(1)` — so it is omitted rather than sent blank.
    expect(TRANSPORT).toMatch(/trimmed \? \{ reason: trimmed \} : \{\}/)
  })

  it("removes nothing locally when a delete is acknowledged", () => {
    /**
     * The transport hands the answer back and the store drops the row — from
     * the ack AND from the `message-deleted` broadcast, through one idempotent
     * function. Neither is optimistic; both are the server confirming. A
     * transport that also mutated a list would be a third opinion.
     */
    const at = TRANSPORT.indexOf("async function deleteMessage")
    expect(at, "deleteMessage moved").toBeGreaterThan(-1)
    const body = TRANSPORT.slice(at, TRANSPORT.indexOf("\n  }", at))
    expect(body).toMatch(/ask<SiteChatDeleteReply>/)
    expect(body).not.toMatch(/messages/)
  })

  it("corrects the re-join flag on every verb the server answers not_member to", () => {
    /**
     * `joined` is what re-sends `join` after a reconnect. Leaving it true
     * after the server has told us we are not a member would re-enter a room
     * on the reader's behalf, facing the gate, with nobody having pressed
     * anything. Every verb that can hear `not_member` has to correct it —
     * post, history, delete and report all can.
     */
    for (const verb of ["post", "history", "deleteMessage", "report"]) {
      const at = TRANSPORT.indexOf(`async function ${verb}(`)
      expect(at, `${verb} moved`).toBeGreaterThan(-1)
      const body = TRANSPORT.slice(at, TRANSPORT.indexOf("\n  }", at))
      expect(body, `${verb} ignores not_member`).toMatch(
        /error === "not_member"\) joined = false/,
      )
    }
  })
})
