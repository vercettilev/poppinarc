import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE LIVE CHAT SCREEN, GUARDED AT THE SOURCE.
 *
 * This is a source-reading spec, which is the idiom every other panel screen
 * in this repo is held to (views/panel-shell.spec.ts, views/wallet-tabs.spec.ts,
 * views/notifications-arrival-tally.spec.ts). The reason it is not a render
 * test is specific rather than lazy: the screen's whole job is to paint a
 * model somebody else computes, and the properties worth defending here —
 * "the gate is not on the client", "content is a text node", "hover does not
 * move" — are properties of the CODE, visible in a diff, and invisible in a
 * single rendered frame. A jsdom render would assert the one state the test
 * bothered to set up and stay silent about the other eight.
 *
 * Comments are stripped before every assertion. The house comment style
 * quotes the shape it forbids in order to explain why it went — this file's
 * subject does exactly that about `overflowX` and about `reverse` — so a
 * naive grep would keep finding the defect inside the paragraph explaining
 * the fix.
 */

const VIEWS = __dirname
const SRC = join(VIEWS, "..")
const REPO = join(SRC, "..", "..")

const read = (p: string) => readFileSync(p, "utf8")

/** Source with comments removed. The `[^:]` guard keeps `https://` and
 *  `chrome://` out of the line-comment rule. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const VIEW_SRC = read(join(VIEWS, "live-chat.tsx"))
const VIEW = stripComments(VIEW_SRC)
const APP = stripComments(read(join(SRC, "entries", "popup", "App.tsx")))

describe("the transcript renders a stranger's words as text", () => {
  it("never hands typed content to an HTML parser", () => {
    // A stranger typed this on an arbitrary website. There is no markup path
    // into this screen and there must never be one.
    expect(VIEW).not.toMatch(/dangerouslySetInnerHTML/)
    expect(VIEW).not.toMatch(/innerHTML/)
  })

  it("puts the content in a JSX expression, not a prop", () => {
    expect(VIEW).toMatch(/\{m\.content\}/)
  })
})

describe("the gate is the server's, and this screen only paints it", () => {
  it("opens no socket of its own", () => {
    // The transport owns the connection. Two sockets for one room is two
    // presence members for one reader, which inflates the number that gates
    // everybody else.
    expect(VIEW).not.toMatch(/socket\.io/)
    expect(VIEW).not.toMatch(/\bio\(/)
    expect(VIEW).not.toMatch(/new WebSocket/)
  })

  it("never decides admission from a count", () => {
    /**
     * The only two places this file compares the population against 2 are
     * LABELS — `liveCountLabel` and `alone`. Neither admits anybody: the
     * screen renders whatever `model.screen` says, and `model.screen` comes
     * from the reducer, which reads the server's answer.
     *
     * This matters beyond principle. components/Layout.tsx navigates the
     * panel back to the persisted currentPath on mount, so a reader who was
     * in the chat REOPENS INTO this route with no press at all — a gate that
     * lived in the header pill's onClick would never run.
     */
    const comparisons = VIEW.match(/count[^\n]*[<>]=?\s*2/g) ?? []
    expect(comparisons.length).toBeGreaterThan(0)
    // Every one of them must be inside a label or a "you are alone" flag,
    // never inside a branch that sets membership.
    expect(VIEW).not.toMatch(/setScreen/)
    expect(VIEW).not.toMatch(/useState<LiveChatScreen>/)
  })

  it("hands joining to the model rather than performing it", () => {
    expect(VIEW).toMatch(/model\.enter/)
    expect(VIEW).toMatch(/model\.leave/)
  })
})

describe("every state is designed, not left to fall through", () => {
  /**
   * The brief named these. A screen that renders nothing for one of them is
   * a blank panel with no way out, which is how "loading forever" ships.
   */
  const STATES = [
    "UNKNOWN",
    "SIGNED_OUT",
    "ALONE",
    "OPEN",
    "MEMBER",
    "UNAVAILABLE",
    "BAD_HOST",
    "DISABLED",
    "NO_PERMISSION",
  ] as const

  it("has a branch for each named state", () => {
    for (const s of STATES) {
      expect(VIEW, `no branch renders ${s}`).toMatch(
        new RegExp(`screen === "${s}"`),
      )
    }
  })

  it("chooses the state in one pure function, so every branch is reachable", () => {
    /**
     * Six of the names are the reducer's, re-used rather than re-invented
     * (helpers/siteChatGate.ts, `SiteChatGateName`). The other three refine the
     * reducer's UNAVAILABLE, which carries its cause in `reason` because the
     * PILL renders all three the same way and only a full screen has room to
     * tell them apart.
     */
    expect(VIEW).toMatch(/export function liveChatScreen/)
    expect(VIEW).toMatch(/SiteChatGateName/)
    for (const s of ["NO_PERMISSION", "BAD_HOST", "DISABLED", "UNAVAILABLE"]) {
      expect(VIEW, `liveChatScreen never returns ${s}`).toMatch(
        new RegExp(`return "${s}"`),
      )
    }
    // The six the reducer already decided pass straight through.
    expect(VIEW).toMatch(/return m\.gate/)
  })

  it("uses the product's own sign-in gate rather than a second one", () => {
    // views/edit-profile.tsx does the same, for the same reason: the
    // panel has ONE auth path and a screen does not get to invent another.
    expect(VIEW).toMatch(/<SignInPrompt/)
    expect(VIEW).toMatch(/from "~\/components\/SignInPrompt"/)
  })

  it("says 'one more person', never a number and never 'dead'", () => {
    expect(VIEW).toMatch(/One more person needs to be here/)
    expect(VIEW).not.toMatch(/\bdead\b/i)
    // "0 live" and "0 online" are the failures this replaces. helpers/
    // presence.ts records the same ruling for the count this feature
    // inherited, above `fetchPagePresence`.
    expect(VIEW).not.toMatch(/0 (live|online|here)/)
  })

  it("leaves a way back into a room the reader never left (R5)", () => {
    /**
     * THE OTHER HALF OF R5, and the half a client can lose on its own.
     *
     * Client membership is one flag — the gate reducer's `member`, written by
     * `join-ok` and nothing else — and it dies with the panel document: the
     * store has no persistence and the transport only re-sends `join` while
     * its own in-memory `joined` flag is alive. So a member who closes the
     * panel while the room is quiet reopens into ALONE believing they are
     * outside, with the header pill hidden in that state and RoomHead's Leave
     * button rendered only for a member. Without a control on THIS card there
     * is no path back until a stranger arrives — which is the eviction R5
     * exists to forbid, arriving by the back door.
     *
     * The server still has the seat: `join` checks membership BEFORE the
     * population and admits without reading it. One press is the whole fix,
     * and it stays a PRESS — "never joins on mount" below still holds.
     */
    const at = VIEW.indexOf('screen === "ALONE"')
    const next = VIEW.indexOf('screen === "OPEN"', at)
    expect(at, "the ALONE branch moved").toBeGreaterThan(-1)
    expect(next, "the OPEN branch moved").toBeGreaterThan(at)
    const branch = VIEW.slice(at, next)
    expect(branch, "the ALONE card has no action").toMatch(/action=\{\{/)
    expect(branch).toMatch(/onClick: model\.enter/)
    // Addressed to the person it is for, so a reader who was never in does
    // not press it expecting a door.
    expect(VIEW).toMatch(/I was in this room/)
  })

  it("keeps a lone MEMBER in the room instead of reporting a failure (R5)", () => {
    // Once inside you are never kicked out — even alone — until YOU leave.
    // The transcript and the composer both survive `alone`.
    expect(VIEW).toMatch(/const alone = /)
    expect(VIEW).toMatch(/only one here right now/)
    // `alone` decorates the transcript; it must not gate the composer.
    expect(VIEW).not.toMatch(/alone\s*&&[^\n]*Composer/)
    expect(VIEW).not.toMatch(/!alone[^\n]*Composer/)
  })

  it("distinguishes a dropped socket from a lost seat", () => {
    // The server never revokes membership on disconnect —
    // apps/backend/src/site-chat/site-chat.gateway.ts, `handleDisconnect`,
    // which enforces that by doing nothing — so the reader is reconnecting,
    // not evicted.
    expect(VIEW).toMatch(/model\.connected/)
    expect(VIEW).toMatch(/Reconnecting/)
  })

  it("names a failed write in words the reader can act on", () => {
    expect(VIEW).toMatch(/export function noticeText/)
    for (const code of [
      "rate_limited",
      "too_long",
      "not_member",
      "signed_out",
      "suspended",
      "bad_cursor",
      "gate_closed",
      "unavailable",
    ]) {
      expect(VIEW, `noticeText has no branch for ${code}`).toMatch(
        new RegExp(`case "${code}"`),
      )
    }
  })

  it("does not say the same refusal twice in two moods", () => {
    /**
     * A join refusal already IS the screen — `gate_closed` renders "one more
     * person needs to be here". A red bar under that card would repeat it in
     * the wrong mood: being early is not an error.
     */
    expect(VIEW).toMatch(/export function noticeStrip/)
    expect(VIEW).toMatch(/n\.verb === "join" \? null : n/)
  })

  it("quotes the server's own retry window rather than guessing one", () => {
    // The limiter's window belongs to the server (site-chat.config.ts).
    expect(VIEW).toMatch(/n\.retryAfterSeconds/)
  })
})

describe("the count never lies", () => {
  it("prints a number only from two up", () => {
    // The same threshold and the same reasoning as the header's own pill
    // (components/Header.tsx — "a count of 1 is the reader themselves").
    // Below it, the label carries no number at all.
    expect(VIEW).toMatch(/count >= 2 \? `\$\{count\} live` : "Live chat"/)
  })

  it("treats an unknown count as unknown, not as zero", () => {
    // `count: number | null` — null is "nobody has told us yet".
    expect(VIEW).toMatch(/count: number \| null/)
    expect(VIEW).toMatch(/typeof count === "number"/)
  })
})

describe("the row fits at 320px; it does not slide", () => {
  /**
   * The house ruled on this twice — components/profile/ProfileFeed.tsx, under
   * its "THE ROW FITS; IT DOES NOT SLIDE" note, and views/wallet-ui.tsx — and
   * profile-filter-fit.spec.ts enforces it there. A hidden scrollbar is not a
   * fit; it is a clip nobody can see.
   */
  it("has no horizontal scroller and no hidden scrollbar", () => {
    expect(VIEW).not.toMatch(/overflowX:\s*["']auto["']/)
    expect(VIEW).not.toMatch(/webkit-scrollbar/)
  })

  it("lets the flexible children actually shrink", () => {
    // Without minWidth:0 a flex child refuses to go below its content width,
    // and a long hostname or a long word pushes the pill off the panel.
    const minWidthZero = VIEW.match(/minWidth:\s*0/g) ?? []
    expect(minWidthZero.length).toBeGreaterThanOrEqual(5)
  })

  it("ellipsizes the two labels that must not wrap", () => {
    // A hostname broken mid-label reads as two sites; a name broken across
    // two lines stops reading as a name. Both clip instead.
    const ellipsis = VIEW.match(/textOverflow:\s*["']ellipsis["']/g) ?? []
    expect(ellipsis.length).toBeGreaterThanOrEqual(2)
  })

  it("wraps a long message instead of widening the panel", () => {
    // A pasted 400-character URL has no space to break at.
    expect(VIEW).toMatch(/overflowWrap:\s*["']anywhere["']/)
    expect(VIEW).toMatch(/whiteSpace:\s*["']pre-wrap["']/)
  })
})

describe("the panel shell's one rule", () => {
  it("takes what is left rather than guessing at it", () => {
    expect(VIEW).toMatch(/flex:\s*1/)
    expect(VIEW).toMatch(/minHeight:\s*0/)
  })

  it("never subtracts from the viewport and never claims the whole column", () => {
    // Both shapes are swept tree-wide by views/panel-shell.spec.ts; asserted
    // here too so a regression fails with this screen's name on it.
    expect(VIEW).not.toMatch(/(height|maxHeight|minHeight):\s*["'`]calc\(100[sd]?vh\s*-/)
    expect(VIEW).not.toMatch(/height:\s*["']100%["']/)
  })
})

describe("hover paints; hover never moves", () => {
  it("changes no geometry in any hover block", () => {
    /**
     * A press that nudges the row under the pointer is how a list becomes
     * unclickable. Paint is allowed — colour, fill, shadow, opacity. Anything
     * that changes the box is not.
     */
    const FORBIDDEN =
      /\b(transform|padding|paddingX|paddingY|margin|gap|fontWeight|fontSize|borderWidth|width|height|top|left|right|bottom|letterSpacing)\b/
    const blocks = VIEW.match(/"&:hover":\s*\{[^}]*\}/g) ?? []
    expect(blocks.length).toBeGreaterThan(0)
    const offenders = blocks.filter((b) => FORBIDDEN.test(b))
    expect(offenders, offenders.join("\n")).toEqual([])
  })
})

describe("nothing reserves space for an element that renders empty", () => {
  it("guards the whole element, not just its text", () => {
    // The counter, the unread pill, the error strip and the reconnect strip
    // are each wrapped in their own condition — the ELEMENT disappears, not
    // its contents, so none of them leaves a blank band behind.
    expect(VIEW).toMatch(/\{remaining <= 50 && \(/)
    expect(VIEW).toMatch(/\{unread > 0 && \(/)
    expect(VIEW).toMatch(/\{strip && \(/)
    expect(VIEW).toMatch(/\{!model\.connected && \(/)
  })

  it("guards the timestamp element, not only the timestamp", () => {
    /**
     * `compactAge` returns "" for a missing or unparseable value AND for any
     * negative age (utils/dateUtils.ts, `compactAge`) — which a message
     * posted while the API's clock leads this browser's produces. Rendered
     * unconditionally it paints the row's gap either side of an empty box.
     */
    expect(VIEW).toMatch(/const age = compactAge\(m\.createdAt\)/)
    expect(VIEW).toMatch(/\{age && \(/)
    expect(VIEW).not.toMatch(/\{compactAge\(/)
  })
})

describe("the wiring is confined, and does not overreach", () => {
  it("keeps the store in one hook", () => {
    /**
     * Everything else in the file renders from `RoomModel`, so there is one
     * place to follow if the store moves. The only mentions outside
     * `useRoomModel` are the import statement's own two — the binding and
     * the module path — and the count is asserted rather than eyeballed so a
     * component reaching for the store directly fails here.
     */
    const hookAt = VIEW.indexOf("function useRoomModel")
    expect(hookAt).toBeGreaterThan(-1)
    const before = VIEW.slice(0, hookAt).match(/useSiteChatStore/g) ?? []
    expect(before.length, before.join(" ")).toBe(2)
    expect(VIEW.slice(0, hookAt)).toMatch(
      /import \{\s*useSiteChatStore,[\s\S]*?\} from "~\/store\/useSiteChatStore"/,
    )
  })

  it("never tears down the transport the header pill is also reading", () => {
    /**
     * `stop()` destroys the ONE transport for the whole document
     * (store/useSiteChatStore.ts, `stop()`). Calling it when this route
     * unmounts would silence the pill everywhere else in the panel. The
     * panel's lifecycle owns that call; a route does not.
     */
    expect(VIEW).not.toMatch(/\.stop\(\)/)
    expect(VIEW).not.toMatch(/\bstop\b\s*[,:]/)
  })

  it("never joins on mount", () => {
    /**
     * Layout navigates back to the persisted currentPath on mount, so a
     * reader who was in the chat lands here without asking. Joining on mount
     * would make that a silent re-admission — the client-side gate this
     * design refuses. `enter` is only ever an onClick.
     */
    expect(VIEW).not.toMatch(/useEffect\([^)]*enter/)
    const autos = VIEW.match(/\benterRoom\(\)/g) ?? []
    expect(autos.length).toBe(1)
    expect(VIEW).toMatch(/enter: \(\) => void enterRoom\(\)/)
  })

  it("latches the end of the history instead of asking forever", () => {
    /**
     * The store's `nextCursor` is null BOTH before the first history call and
     * after the last one (store/useSiteChatStore.ts, `loadMore`), so it cannot answer
     * "is there more". Without a latch the top-of-list observer would ask
     * again every time the reader sits at the top of an exhausted room.
     */
    expect(VIEW).toMatch(/setExhausted\(true\)/)
    expect(VIEW).toMatch(
      /after\.messages\.length === before && after\.nextCursor === null/,
    )
    // Cleared on a new website, or the second room would never page back.
    expect(VIEW).toMatch(/setExhausted\(false\), \[host\]/)
  })
})

describe("the scroll rule is written down and implemented", () => {
  /**
   * STICK TO THE BOTTOM ONLY IF ALREADY AT THE BOTTOM. A new message must
   * never yank the view out from under someone reading history.
   */
  it("decides stickiness from where the reader is, measured on scroll", () => {
    expect(VIEW).toMatch(/function isAtBottom/)
    expect(VIEW).toMatch(/stickRef/)
    expect(VIEW).toMatch(/onScroll/)
  })

  it("raises a pill instead of moving the view when the reader is scrolled up", () => {
    expect(VIEW).toMatch(/setUnread\(\(n\) => n \+ grew\)/)
    expect(VIEW).toMatch(/new ↓/)
  })

  it("keys the anchor on the OLDEST ROW'S ID, not on how long the list is", () => {
    /**
     * Two different things grow this list while a history request is in
     * flight, and only one of them may move the view:
     *
     *   an older page   rows appear ABOVE the reader; messages[0] changes.
     *                   Compensate.
     *   a live message  one row appears BELOW; messages[0] is untouched.
     *                   Compensating here drags a reader who is scrolled up
     *                   DOWN by a line, skips the unread pill for that
     *                   message, and SPENDS the anchor — so the real page,
     *                   up to one ack timeout later, lands with no
     *                   compensation and jumps by its whole height.
     *
     * Keyed on length, "messages.length > anchor.count" cannot tell those
     * apart, because both are growth. Identity can. A history call that
     * returns nothing new — the very first `loadMore()` re-reads the newest
     * page just to learn a cursor (store/useSiteChatStore.ts, `enter()`) —
     * also leaves messages[0] alone, so the same test refuses it and the
     * passive effect disarms it.
     */
    expect(VIEW).toMatch(
      /preserveRef = useRef<\{ height: number; firstId: string \| null \} \| null>/,
    )
    expect(VIEW).toMatch(/const firstId = messages\[0\]\?\.id \?\? null/)
    // The compensation is gated on identity, and the length comparison that
    // could not tell an append from a prepend is gone.
    expect(VIEW).toMatch(
      /anchor &&\s*anchor\.firstId !== null &&\s*firstId !== anchor\.firstId/,
    )
    expect(VIEW).not.toMatch(/messages\.length > anchor\.count/)
    /**
     * IDENTITY SAYS WHICH END CHANGED; LENGTH SAYS WHICH DIRECTION, and the
     * anchor needs both now that a row can LEAVE. `message-deleted` for the
     * topmost message changes `firstId` while removing height — the exact
     * opposite of a prepend — so compensating for it would scroll up by the
     * deleted row AND spend the anchor the real page still needs.
     */
    expect(VIEW).toMatch(/grew > 0\n\s*\) \{/)
    // Disarmed when the load finished without prepending anything.
    expect(VIEW).toMatch(/anchor\.firstId === null \|\| firstId === anchor\.firstId/)
  })

  it("re-takes the baseline when the list grows below the reader", () => {
    /**
     * A live message that lands mid-flight is not compensated, but it DOES
     * move the height the compensation will be measured against. Left alone,
     * the older page would then give back the prepended height plus that
     * row's, overshooting by one line.
     */
    expect(VIEW).toMatch(
      /preserveRef\.current = \{ \.\.\.anchor, height: el\.scrollHeight \}/,
    )
  })

  it("does not lose a hide to a second press in the same tick", () => {
    // The state variable is one render behind; the ref is current the
    // instant it is assigned. The storage write also stays OUT of the state
    // updater, which React may call twice.
    expect(VIEW).toMatch(/mutesRef = useRef<LocalMutes>/)
    expect(VIEW).toMatch(/next\(mutesRef\.current\)/)
  })

  it("holds the anchor when an older page is prepended, before paint", () => {
    /**
     * Prepending puts every pixel of the older page ABOVE the reader; the
     * browser leaves scrollTop alone, so the content under their eyes jumps
     * down by exactly the height that arrived. The compensation has to run
     * before the browser paints or the jump is visible for a frame — which
     * is what useLayoutEffect is and useEffect is not.
     */
    expect(VIEW).toMatch(/useLayoutEffect/)
    expect(VIEW).toMatch(/scrollTop \+= el\.scrollHeight - anchor\.height/)
  })

  it("puts the older-page sentinel at the TOP, which is the half `reverse` does not do", () => {
    /**
     * components/CustomInfiniteScroll.tsx has a `reverse` prop left from the
     * deleted chat. Both of its branches (:63-84 and :86-104) put the
     * sentinel AFTER the children — `reverse` only moves the spinner above
     * them — so with that component the fetch for OLDER messages would fire
     * at the NEWEST end. It also has no anchor compensation. Hence this
     * observer, and hence this test naming the reason.
     */
    expect(VIEW).not.toMatch(/CustomInfiniteScroll/)
    expect(VIEW).toMatch(/topSentinelRef/)
    expect(VIEW).toMatch(/new IntersectionObserver/)
    const sentinel = VIEW.indexOf("ref={topSentinelRef}")
    const firstRow = VIEW.indexOf("messages.map((m) =>")
    expect(sentinel).toBeGreaterThan(-1)
    expect(firstRow).toBeGreaterThan(-1)
    expect(sentinel).toBeLessThan(firstRow)
  })
})

describe("no two rows can share a React key", () => {
  it("de-duplicates on the server's id at the render boundary", () => {
    /**
     * The store is what collapses the sender's double delivery — the `post`
     * ack and the `message` broadcast both carry the new line, because the
     * protocol pushes to the room INCLUDING the author
     * (apps/backend/src/site-chat/dto/site-chat-events.dto.ts,
     * `SiteChatMessageEvent`) — and the store's `remember()` filters incoming
     * ids by message id.
     *
     * This pass is the guard on being wrong about that. Two rows with the
     * same `key` make React reconcile the wrong element, which in a
     * transcript means a message rendering under somebody else's name.
     */
    expect(VIEW).toMatch(/function dedupeById/)
    expect(VIEW).toMatch(/dedupeById\(/)
    expect(VIEW).toMatch(/key=\{m\.id\}/)
  })
})

describe("moderation: two private controls and two real ones", () => {
  /**
   * The four controls in `MessageMenu` are two different KINDS, and the
   * distinction is the thing worth guarding:
   *
   *   PRIVATE  Hide / Mute — chrome.storage.local, this install only. The
   *            message is still on every other screen in the room.
   *   REAL     Delete / Report — verbs on the wire, judged by the server.
   *
   * A screen that blurred those two would let a reader believe a local hide
   * had removed something for everybody.
   */
  it("offers all four, and keeps the private pair local", () => {
    expect(VIEW).toMatch(/Hide this message/)
    expect(VIEW).toMatch(/Mute this person here/)
    expect(VIEW).toMatch(/Report to Poppin/)
    expect(VIEW).toMatch(/Delete for everyone/)
    // The private pair writes to chrome.storage and nowhere else.
    expect(VIEW).toMatch(/MUTES_KEY/)
  })

  it("mirrors the server's author rule instead of learning it from a refusal", () => {
    /**
     * `delete` is AUTHOR-ONLY at the server and `report` refuses
     * `own_message`, so the two controls are exact mirrors: the reader's own
     * row offers Delete and not Report, everyone else's offers Report and not
     * Delete. Rendering a control whose answer is a foregone refusal is not
     * "letting the server decide" — it teaches people the buttons are noise.
     *
     * Read off the gateway rather than asserted from memory, so the day the
     * server's rule changes this test is what notices.
     */
    const gateway = join(
      REPO,
      "apps",
      "backend",
      "src",
      "site-chat",
      "site-chat.gateway.ts",
    )
    expect(
      existsSync(gateway),
      "the gateway moved — re-point this drift guard rather than deleting it",
    ).toBe(true)
    const GATEWAY = read(gateway)
    expect(GATEWAY).toMatch(/@SubscribeMessage\('delete'\)/)
    expect(GATEWAY).toMatch(/@SubscribeMessage\('report'\)/)
    expect(GATEWAY).toMatch(/error: 'own_message'/)

    // The menu takes `mine` and gates on it in both directions.
    expect(VIEW).toMatch(/function MessageMenu\(\{\s*mine,/)
    expect(VIEW).toMatch(/\{!mine && \(/)
    expect(VIEW).toMatch(/\{mine && \(/)
    // Delete sits inside the `mine` branch, Report inside the `!mine` one.
    const del = VIEW.indexOf("Delete for everyone")
    const report = VIEW.indexOf("Report to Poppin")
    expect(del).toBeGreaterThan(-1)
    expect(report).toBeGreaterThan(-1)
    expect(VIEW.lastIndexOf("{mine && (", del)).toBeGreaterThan(
      VIEW.lastIndexOf("{!mine && (", del),
    )
    expect(VIEW.lastIndexOf("{!mine && (", report)).toBeGreaterThan(
      VIEW.lastIndexOf("{mine && (", report),
    )
  })

  it("asks twice before deleting for everyone", () => {
    // The one irreversible control here, and it removes words from every
    // screen in the room. A mis-press in a 320px menu must not be able to.
    expect(VIEW).toMatch(/confirmingDelete/)
    expect(VIEW).toMatch(/Really delete — press again/)
    // Reopening starts from the safe word, or the next first press deletes.
    expect(VIEW).toMatch(/setConfirmingDelete\(false\)/)
  })

  it("removes no row on a press — only on the server's word", () => {
    /**
     * A refused delete that had already blanked the row would look like it
     * worked, on the one screen whose owner most needs to know it did not —
     * and every other panel in the room would still be showing the message.
     * The store drops the row from the ack and from the `message-deleted`
     * broadcast, both of which are the server confirming.
     */
    const at = VIEW.indexOf("const deleteOne = useCallback(")
    expect(at, "deleteOne moved").toBeGreaterThan(-1)
    const body = VIEW.slice(at, VIEW.indexOf("\n\n", at))
    expect(body).toMatch(/model\.deleteMessage\(m\.id\)/)
    expect(body, "deleteOne hides the row itself").not.toMatch(/hide\(/)
  })

  it("reports to the row, not to a free-text inbox", () => {
    /**
     * This used to be UserService.sendFeedback with the ids pasted into a
     * body, because the protocol had no report verb. It has one now
     * (`report { host, messageId, reason? }`), so the report names a message
     * the server can find — and the screen no longer reaches for a service
     * that knows nothing about chat.
     */
    expect(VIEW).toMatch(/model\.report\(m\.id\)/)
    expect(VIEW).not.toMatch(/UserService/)
    // Hidden for the reporter FIRST: that half stops the harm now and must
    // not wait on a round trip, or on a moderator.
    const at = VIEW.indexOf("const report = useCallback(")
    expect(at, "the report callback moved").toBeGreaterThan(-1)
    const body = VIEW.slice(at, at + 400)
    expect(body.indexOf("hide(m.id)")).toBeGreaterThan(-1)
    expect(body.indexOf("hide(m.id)")).toBeLessThan(
      body.indexOf("model.report(m.id)"),
    )
  })

  it("promises exactly what a report does, and no more", () => {
    /**
     * apps/backend/src/site-chat/site-chat-report.service.ts is blunt: a
     * report writes one `feedback` row and sends one email to a shared inbox.
     * It does not hide the message, touch the author, create a case, or reach
     * anybody on call — that file puts the honest latency at DAYS. So the
     * success line may not say "removed", "reviewed" or "handled", and it may
     * not imply speed.
     */
    const at = VIEW.indexOf("export function reportOutcomeText")
    expect(at, "reportOutcomeText moved").toBeGreaterThan(-1)
    const fn = VIEW.slice(at, VIEW.indexOf("\n}\n", at))
    expect(fn).not.toMatch(/\b(removed|taken down|reviewed|handled|flagged)\b/i)
    expect(fn).toMatch(/not instantly/)
    // Every failure still tells the reader the true half.
    for (const code of [
      "own_message",
      "not_found",
      "not_member",
      "signed_out",
      "rate_limited",
    ]) {
      expect(fn, `reportOutcomeText has no branch for ${code}`).toMatch(
        new RegExp(`case "${code}"`),
      )
    }
  })

  it("words a refused delete as the refusal it is", () => {
    // `not_found` means two different things and only the verb separates
    // them: on a delete the row is already gone, which is what the reader
    // wanted, so it is not phrased as a failure.
    expect(VIEW).toMatch(/case "not_author"/)
    expect(VIEW).toMatch(/n\.verb === "delete"/)
    expect(VIEW).toMatch(/That message is already gone/)
  })

  it("bounds what it keeps in chrome.storage", () => {
    // A reader who hides a hundred lines on one host does not get to grow
    // local storage without limit.
    expect(VIEW).toMatch(/MUTES_CAP/)
    expect(VIEW).toMatch(/slice\(-MUTES_CAP\)/)
  })

  it("never mutes the reader out of their own transcript", () => {
    expect(VIEW).toMatch(/m\.userId === meId \|\| !muted\.has\(m\.userId\)/)
  })
})

describe("colour comes from the design system", () => {
  it("carries no hex literal except white through alpha()", () => {
    /**
     * theme/juice.ts is the one source; a hex outside it is a bug waiting to
     * drift. `alpha("#FFFFFF", n)` is the tree's established way to write a
     * neutral veil — components/Header.tsx, views/Callers.tsx and
     * views/comment.tsx all do it — so it is the single carve-out, and it is
     * checked rather than assumed.
     */
    const hexes = VIEW.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    const notWhite = hexes.filter((h) => h.toUpperCase() !== "#FFFFFF")
    expect(notWhite, notWhite.join(" ")).toEqual([])
    for (const m of VIEW.matchAll(/#FFFFFF/g)) {
      const before = VIEW.slice(Math.max(0, m.index - 12), m.index)
      expect(before, `bare #FFFFFF at ${m.index}`).toMatch(/alpha\(\s*"?$/)
    }
  })

  it("draws its surfaces from the shared tokens", () => {
    expect(VIEW).toMatch(/from "~\/theme\/juice"/)
    expect(VIEW).toMatch(/from "~\/helpers\/panelSurface"/)
  })

  it("paints no header pill an opaque colour", () => {
    // components/header-pill-surface.spec.ts sweeps every .tsx for this; the
    // assertion is repeated here so a regression names this screen.
    expect(VIEW).not.toMatch(/\bbg=/)
  })
})

describe("the composer agrees with the server about length", () => {
  it("mirrors SITE_CHAT_MAX_MESSAGE_CHARS exactly", () => {
    /**
     * A client cap LOWER than the server's silently truncates people; HIGHER
     * lets them type a message that can only ever be refused. Read from the
     * backend rather than trusted, so the two cannot drift apart quietly.
     */
    const config = join(
      REPO,
      "apps",
      "backend",
      "src",
      "site-chat",
      "site-chat.config.ts",
    )
    expect(
      existsSync(config),
      "site-chat.config.ts moved — re-point this drift guard rather than deleting it",
    ).toBe(true)
    const server = /SITE_CHAT_MAX_MESSAGE_CHARS\s*=\s*(\d+)/.exec(read(config))
    expect(server?.[1]).toBeTruthy()
    const client = /LIVE_CHAT_MAX_CHARS\s*=\s*(\d+)/.exec(VIEW)
    expect(client?.[1]).toBe(server![1])
  })

  it("sends on Enter and keeps Shift+Enter for a newline", () => {
    expect(VIEW).toMatch(/e\.key === "Enter" && !e\.shiftKey/)
  })
})

describe("the route is registered", () => {
  it("mounts the screen inside the panel shell", () => {
    // Inside <Route element={<Layout />}> — the header, the permission
    // banner and the sign-in redirect all live there, and a screen mounted
    // outside it loses every one of them.
    expect(APP).toMatch(/import LiveChat from "~\/views\/live-chat"/)
    expect(APP).toMatch(/<Route path="live-chat" element=\{<LiveChat \/>\} \/>/)
    const layout = APP.indexOf("<Route element={<Layout />}>")
    const route = APP.indexOf('path="live-chat"')
    const close = APP.indexOf("</Route>", layout)
    expect(layout).toBeGreaterThan(-1)
    expect(route).toBeGreaterThan(layout)
    expect(route).toBeLessThan(close)
  })
})
