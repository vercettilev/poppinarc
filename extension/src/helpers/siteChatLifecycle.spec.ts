import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * TWO FUNCTIONS THAT HAD NO CALLER, AND THE INVARIANTS THAT COME WITH GIVING
 * THEM ONE.
 *
 * `useSiteChatStore.stop()` and `clearSiteChatTicket()` were both written for
 * a lifecycle nothing was actually driving: the panel document's end. An
 * uncalled teardown is not neutral — it reads as "handled" to the next person
 * and it is the reason a socket outlives the session that opened it, and a
 * ticket naming a users.id outlives the reader it names.
 *
 * A source-reading spec, like its neighbours. `stop()` is one call into
 * chrome-and-socket territory that a unit test cannot exercise honestly; what
 * IS checkable, and is what actually broke, is the wiring: that something
 * calls it, that it is guarded against the one event that looks like a
 * teardown and is not, and that what it clears leaves the store restartable.
 */

const HELPERS = __dirname
const SRC = join(HELPERS, "..")

const read = (p: string) => readFileSync(p, "utf8")

/** The `[^:]` guard keeps `https://` out of the line-comment rule. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const STORE_SRC = read(join(SRC, "store", "useSiteChatStore.ts"))
const STORE = stripComments(STORE_SRC)
const API = stripComments(read(join(HELPERS, "siteChatApi.ts")))

describe("stop() is driven by the lifetime it was written for", () => {
  it("is called by something, and that something is the document ending", () => {
    // The transport's lifetime is the panel DOCUMENT's, stated in the store's
    // own header. `pagehide` is that end.
    expect(STORE).toMatch(/addEventListener\("pagehide"/)
    expect(STORE).toMatch(/get\(\)\.stop\(\)/)
  })

  it("ignores the pagehide that is not a teardown", () => {
    /**
     * `persisted: true` is a document entering the back/forward cache and
     * expecting to come back. Tearing down there would strand a live panel on
     * a stopped store — and `setPage` returns early for a host it already
     * holds, so the room would come back dead rather than rebuild.
     */
    expect(STORE).toMatch(/if \(event\.persisted\) return/)
  })

  it("registers once, not once per transport", () => {
    // `stop()` nulls the transport and the next `setPage` builds another. A
    // listener added on every rebuild would be a leak of its own, and would
    // call stop() N times on the way out.
    expect(STORE).toMatch(/let teardownBound = false/)
    expect(STORE).toMatch(/if \(teardownBound\) return/)
  })

  it("binds only when there is something to release", () => {
    // A panel session that never opens the chat opens no socket and should
    // register no listener. The bind sits inside the transport's creation.
    const at = STORE.indexOf("const ensureTransport =")
    expect(at, "ensureTransport moved").toBeGreaterThan(-1)
    const head = STORE.slice(at, at + 200)
    expect(head).toMatch(/bindDocumentTeardown\(\)/)
  })

  it("survives a context with no window", () => {
    // Specs and any non-document context have no window. The feature must
    // degrade to "no teardown listener", never to a throw at import.
    expect(STORE).toMatch(/typeof window === "undefined"/)
  })
})

describe("what stop() clears leaves the store restartable", () => {
  it("forgets the host, or setPage will refuse to rebuild", () => {
    /**
     * `setPage` returns early when the host has not changed. A stopped store
     * that still remembered where it was would decline to restart on the very
     * host it was stopped on — no transport, no heartbeat, and no way back
     * short of navigating to another site. This is the half that makes a
     * sign-out caller (see below) safe to add.
     */
    const at = STORE.indexOf("    stop() {")
    expect(at, "stop() moved").toBeGreaterThan(-1)
    const body = STORE.slice(at, STORE.indexOf("\n    },", at))
    expect(body).toMatch(/host: null/)
    expect(body).toMatch(/type: "host", host: null/)
  })

  it("empties the transcript alongside the id set that guards it", () => {
    /**
     * `forgetMessages()` clears `seenMessageIds` only. Leaving the array
     * behind would let the same message be appended a second time in the next
     * session and put two rows under one React key — which in a transcript
     * means a message rendering under somebody else's name.
     */
    const at = STORE.indexOf("    stop() {")
    const body = STORE.slice(at, STORE.indexOf("\n    },", at))
    expect(body).toMatch(/forgetMessages\(\)/)
    expect(body).toMatch(/messages: \[\]/)
  })

  it("takes the credential with the socket it authenticated", () => {
    // A ticket names a users.id. A cached one outliving the transport is a
    // credential with no owner.
    const at = STORE.indexOf("    stop() {")
    const body = STORE.slice(at, STORE.indexOf("\n    },", at))
    expect(body).toMatch(/clearSiteChatTicket\(\)/)
    expect(body).toMatch(/transport\?\.destroy\(\)/)
  })

  it("keeps clearSiteChatTicket reachable from exactly one place", () => {
    /**
     * The ticket cache is module-level and dies with the document, so the
     * only window that matters is a session REPLACED inside a document that
     * stays open. `stop()` is where that is handled, and routing every caller
     * through it — rather than through the bare clear — is what keeps the
     * socket's handshake identity and the credential behind it ending
     * together.
     */
    expect(API).toMatch(/export function clearSiteChatTicket/)
    const calls = STORE.match(/clearSiteChatTicket\(\)/g) ?? []
    expect(calls.length, calls.join(" ")).toBe(1)
  })
})

describe("a deleted message stays deleted", () => {
  it("drops the row on the server's word, from either delivery", () => {
    /**
     * A delete arrives TWICE — once as the `delete` ack, once in the
     * `message-deleted` broadcast the gateway sends to the whole room
     * including the deleter. Same double delivery `post` already has, answered
     * the same way: one idempotent function, so whichever lands first acts.
     */
    expect(STORE).toMatch(/onMessageDeleted: \(host, messageId\) =>/)
    expect(STORE).toMatch(/const forget = \(messageId: string\) =>/)
    // Both paths call it.
    const calls = STORE.match(/forget\(/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it("leaves the id in the seen set as a tombstone", () => {
    /**
     * Removing the id would make it fresh again, so any re-delivery of that
     * message — a frame already in flight, a reconnect that re-serves a page —
     * would re-append the row and resurrect something its author took back.
     *
     * The trim in `remember()` is the opposite case and deliberately DOES drop
     * ids: those messages are still real and history may legitimately serve
     * them again. So this asserts the difference rather than the absence.
     */
    const at = STORE.indexOf("const forget = (messageId: string) =>")
    expect(at, "forget moved").toBeGreaterThan(-1)
    const body = STORE.slice(at, STORE.indexOf("\n  }", at))
    expect(body, "forget drops the tombstone").not.toMatch(/seenMessageIds/)
    // The trim still does, so the two have not been accidentally unified.
    expect(STORE).toMatch(/seenMessageIds\.delete\(dropped\.id\)/)
  })

  it("drops a deletion meant for another website", () => {
    // Same host guard as every other frame: the reader can change tabs while
    // a frame is in the air.
    const at = STORE.indexOf("onMessageDeleted: (host, messageId) =>")
    const body = STORE.slice(at, at + 200)
    expect(body).toMatch(/if \(host !== get\(\)\.host\) return/)
  })
})
