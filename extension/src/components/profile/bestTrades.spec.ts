import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { assetName, money, moneyExact, pctText, showVitrine, winCard } from "./bestTradesText"

/**
 * THE VITRINE'S RULES, pinned where they can be. MUI views are not rendered
 * in this harness (no spec in the tree does), so the card's WORDS are tested
 * as functions and the view's SHAPE is read from source — the same split
 * views/settings-report-placement.spec.ts uses.
 */
const SRC = join(__dirname, "..", "..")
const read = (p: string) => readFileSync(join(SRC, p), "utf8")

describe("what a win card says", () => {
  it("makes the figure the hero: exact on the wide headline card, rounded on the small ones", () => {
    // The #1 card takes the whole row and can carry every digit, which is
    // what Fomo's "+$11,479.66" does; the two-up cards round the way the
    // wins rail already rounds at the panel's 320px floor.
    expect(moneyExact(11479.66)).toBe("$11,479.66")
    expect(winCard({ mint: "M", symbol: "GRAMS", realizedUsd: 11479.66, pct: 231.2 }, true).figure).toBe("+$11,479.66")
    expect(money(11479.66)).toBe("$11K")
    expect(money(8319.88)).toBe("$8.3K")
    expect(money(123456)).toBe("$123K")
    expect(money(12)).toBe("$12.00")
    expect(money(345.18)).toBe("$345")
  })

  it("names the asset ONCE: a cashtag when known, the front of the address when not", () => {
    expect(assetName({ mint: "M1", symbol: "GRAMS" })).toBe("$GRAMS")
    expect(assetName({ mint: "zj1jpp7QMveWHLs61vL9KMZf254KvW7j4AAmBF8ry2k", symbol: null })).toBe("zj1j…")
  })

  it("shows the return only when the ledger could compute it", () => {
    expect(pctText(231.2)).toBe("▲ 231%")
    expect(pctText(45.1)).toBe("▲ 45.1%")
    expect(pctText(1314.16)).toBe("▲ 1314%")
    // A null is a missing number: never "▲ null", never an invented zero.
    expect(pctText(null)).toBeNull()
    expect(winCard({ mint: "M", symbol: "X", realizedUsd: 12, pct: null }).pct).toBeNull()
  })

  it("is silent when there is nothing to show, for both readers identically", () => {
    // Someone who has not published and someone with nothing to publish must
    // look the same from the outside: no heading, no empty state.
    expect(showVitrine([])).toBe(false)
    expect(showVitrine(null)).toBe(false)
    expect(showVitrine(undefined)).toBe(false)
    expect(showVitrine([{ mint: "M", symbol: null, realizedUsd: 5, pct: null }])).toBe(true)
  })
})

describe("the vitrine's shape, read from source", () => {
  const view = read("components/profile/BestTrades.tsx")
  const profile = read("views/profile.tsx")

  it("asks for your OWN lots on your own profile and someone else's by id", () => {
    // Your own are yours to see whether or not you publish them; the route
    // without the public_wins filter is the one that says so. Someone
    // else's go through the filtered route, and the SERVER decides.
    expect(view).toMatch(/own \? myWins\(5\) : winsFor\(userId, 5\)/)
  })

  it("renders on every profile, and the book folds only on your own", () => {
    expect(profile).toMatch(/<BestTrades userId=\{user\.id\} own=\{isOwnProfile\} \/>/)
    expect(profile).toMatch(/\{isOwnProfile && <YourBook \/>\}/)
    // The four open lists are gone from the page itself.
    for (const gone of ["<OpenOrders showEmpty />", "<Watchlist />", "<PriceAlerts />", "<LinkedWallets />"]) {
      expect(profile).not.toContain(gone)
    }
  })

  it("keeps every drawer, closed by default, one open at a time", () => {
    const book = read("components/profile/YourBook.tsx")
    for (const list of ["OpenOrders", "Watchlist", "PriceAlerts", "LinkedWallets"]) {
      expect(book).toContain(`<${list}`)
    }
    expect(book).toMatch(/useState<Drawer \| null>\(null\)/)
    // Tapping the open drawer closes it; tapping another swaps. Two open
    // drawers is the screen this replaced.
    expect(book).toMatch(/setOpen\(\(o\) => \(o === key \? null : key\)\)/)
    // The book's own room is the panel's front door, "/" — /positions
    // was a second name for it and closed on 2026-09-20.
    expect(book).toMatch(/navigate\("\/"\)/)
  })
})
