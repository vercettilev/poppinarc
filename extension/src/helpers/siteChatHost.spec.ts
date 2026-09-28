import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  canonicalSiteHost,
  siteChatHostFromUrl,
  siteChatRoomTitle,
} from "./siteChatHost"

/**
 * R1 — every subpage of x.com counts toward x.com — and the one way this can
 * go wrong that nobody would notice: the extension folding a host DIFFERENTLY
 * from the server. The server wins in every case, so a disagreement never
 * produces an error; it produces a reader who is told the room is quiet while
 * everybody else is in a room called something else.
 *
 * The last block therefore READS apps/backend/src/site-chat/canonical-host.ts
 * and asserts our folding rules are the same text, the way this repo already
 * hand-syncs components/chipActStyle.ts against components/SpotCard/style.ts.
 */

const REPO = join(__dirname, "..", "..", "..")
const BACKEND_HOST_FILE = join(
  REPO,
  "apps",
  "backend",
  "src",
  "site-chat",
  "canonical-host.ts",
)

describe("one website, one room", () => {
  it.each([
    ["x.com", "x.com"],
    ["www.x.com", "x.com"],
    ["m.x.com", "x.com"],
    ["mobile.x.com", "x.com"],
    ["X.COM", "x.com"],
    ["  WWW.X.com  ", "x.com"],
    // A trailing dot is the DNS root and means the same website.
    ["x.com.", "x.com"],
    // Repeated folding, bounded at three strips.
    ["www.m.x.com", "x.com"],
  ])("folds %s to %s", (input, expected) => {
    expect(canonicalSiteHost(input)).toBe(expected)
  })

  it("keeps subdomains apart", () => {
    // The whole reason there is no public-suffix-list folding here: doing that
    // would put every github.io page, every blogspot.com blog and every SaaS
    // subdomain into ONE chat room.
    expect(canonicalSiteHost("sub.example.com")).toBe("sub.example.com")
    expect(canonicalSiteHost("sub.example.com")).not.toBe("example.com")
    expect(canonicalSiteHost("someone.github.io")).toBe("someone.github.io")
    expect(canonicalSiteHost("other.github.io")).not.toBe(
      canonicalSiteHost("someone.github.io"),
    )
  })

  it("never folds a two-label site down to a bare TLD", () => {
    // "m.com" is a website. "com" is not, and would be a room every site with
    // an m. prefix fell into.
    expect(canonicalSiteHost("m.com")).toBe("m.com")
    expect(canonicalSiteHost("www.com")).toBe("www.com")
    expect(canonicalSiteHost("mobile.com")).toBe("mobile.com")
  })
})

describe("what is not a website", () => {
  it.each([
    ["", "empty"],
    ["localhost", "a single label"],
    ["intranet", "a single label"],
    ["127.0.0.1", "an IPv4 literal"],
    ["1.2.3.4", "an IPv4 literal"],
    ["[::1]", "an IPv6 literal"],
    ["::1", "an IPv6 literal"],
    ["x.com:443", "a port"],
    ["https://x.com", "a URL"],
    ["x.com/feed", "a path"],
    ["two words.com", "whitespace"],
    ["under_score.com", "an underscore"],
    ["tr.wiki\npedia.org", "a newline inside a label"],
    ["-lead.com", "a leading hyphen"],
    ["trail-.com", "a trailing hyphen"],
    ["ünicode.com", "a non-ASCII IDN (Chrome hands us punycode)"],
    ["x..com", "an empty label"],
  ])("rejects %j — %s", (input) => {
    expect(canonicalSiteHost(input)).toBeNull()
  })

  it("rejects anything longer than the DNS limit", () => {
    const label = "a".repeat(60)
    // Checked on the INPUT, before folding, so a huge string is refused
    // rather than trimmed into something that looks legitimate.
    const long = `${[label, label, label, label, label].join(".")}.com`
    expect(long.length).toBeGreaterThan(253)
    expect(canonicalSiteHost(long)).toBeNull()
    expect(canonicalSiteHost(`www.${long}`)).toBeNull()
  })

  it.each([[null], [undefined], [42], [{}], [["x.com"]]])(
    "rejects the non-string %p",
    (input) => {
      expect(canonicalSiteHost(input)).toBeNull()
    },
  )

  it("cannot be spun by a pathological prefix chain", () => {
    // Bounded at MAX_PREFIX_STRIPS; after three strips whatever is left is
    // judged on its own merits rather than looping.
    const nested = `${"www.".repeat(50)}x.com`
    expect(canonicalSiteHost(nested)).toBe(`${"www.".repeat(47)}x.com`)
  })
})

describe("a page address, not a hostname", () => {
  it("takes the host out of a real page", () => {
    expect(siteChatHostFromUrl("https://www.x.com/poppin/status/1?ref=2")).toBe(
      "x.com",
    )
    expect(siteChatHostFromUrl("http://m.x.com/")).toBe("x.com")
  })

  it("refuses addresses that are not websites anybody else can be on", () => {
    // A file:// or chrome:// page is private to one machine, and its
    // "hostname" is not a place two readers can meet.
    expect(siteChatHostFromUrl("chrome://extensions")).toBeNull()
    expect(siteChatHostFromUrl("file:///C:/notes.html")).toBeNull()
    expect(siteChatHostFromUrl("about:blank")).toBeNull()
    expect(siteChatHostFromUrl("")).toBeNull()
    expect(siteChatHostFromUrl("not a url")).toBeNull()
    expect(siteChatHostFromUrl(null)).toBeNull()
    expect(siteChatHostFromUrl("http://localhost:3000/")).toBeNull()
  })

  it("titles the room with the folded host and nothing else", () => {
    expect(siteChatRoomTitle("WWW.X.com")).toBe("x.com")
    expect(siteChatRoomTitle("localhost")).toBeNull()
    expect(siteChatRoomTitle(null)).toBeNull()
  })
})

describe("the client copy cannot drift from the server's", () => {
  /**
   * apps/backend/src/site-chat/canonical-host.ts is the authority: it runs on
   * every entry point, so a client that folds differently does not cause an
   * error — it causes two rooms with one name. These assertions compare the
   * actual rule text, quote style normalised, because the two packages have
   * different lint settings and identical rules.
   */
  const normalise = (s: string) => s.replace(/'/g, '"')

  it("the backend file is where we think it is", () => {
    expect(
      existsSync(BACKEND_HOST_FILE),
      `${BACKEND_HOST_FILE} is missing. If canonical-host.ts moved, update ` +
        "this path — do not delete this spec: it is the only thing stopping " +
        "the two canonicalisers from drifting apart in silence.",
    ).toBe(true)
  })

  const backend = existsSync(BACKEND_HOST_FILE)
    ? normalise(readFileSync(BACKEND_HOST_FILE, "utf8"))
    : ""
  const mine = normalise(readFileSync(join(__dirname, "siteChatHost.ts"), "utf8"))

  const rule = (name: string, re: RegExp) => {
    it(`agrees on ${name}`, () => {
      const theirs = backend.match(re)
      const ours = mine.match(re)
      expect(theirs, `backend has no ${name}`).not.toBeNull()
      expect(ours, `siteChatHost.ts has no ${name}`).not.toBeNull()
      expect(ours![0]).toBe(theirs![0])
    })
  }

  rule("the DNS length limit", /MAX_HOST_LENGTH = \d+/)
  rule("the label shape", /LABEL_SHAPE = \/[^\n]+\//)
  rule("the folded prefixes", /FOLDED_PREFIXES = \[[^\]]*\]/)
  rule("the strip bound", /MAX_PREFIX_STRIPS = \d+/)
  rule("the bare-TLD guard", /rest\.split\("\."\)\.length < 2/)
  rule("the single-label guard", /labels\.length < 2/)
  rule("the numeric-TLD rejection", /\/\^\[0-9\]\+\$\/\.test\(labels\[labels\.length - 1\]\)/)

  it("does NOT fold registrable domains, on either side", () => {
    // `psl` is a dependency of this extension (package.json), which makes
    // reaching for it here a one-line mistake anybody could make. It would
    // merge every github.io blog, every blogspot.com blog and every SaaS
    // subdomain into a single room. Both files SAY so in their headers; this
    // checks that neither has quietly started doing it.
    expect(mine).not.toMatch(/from "psl"/)
    expect(backend).not.toMatch(/from "psl"/)
    expect(mine).not.toMatch(/getDomain|registrableDomain/)
    expect(backend).not.toMatch(/getDomain|registrableDomain/)
  })

  it("leaves the room KEY to the server", () => {
    // chat_rooms.room_url is shared with a literal page URL and with the
    // embed's "embed:<poppinId>:<url>". The client has no business computing
    // a storage key, so it cannot ask for the wrong one.
    expect(backend).toMatch(/SITE_ROOM_PREFIX = "site:"/)
    expect(mine).not.toMatch(/siteRoomKey/)
  })
})
