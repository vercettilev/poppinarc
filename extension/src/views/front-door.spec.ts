import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the front door", () => {
  const v = stripComments(read("views/SpotPositions.tsx"))

  it("shows the doors and no headline when there is no book", () => {
    expect(v).toMatch(/\{positions\.length === 0 \? \(\s*<FrontDoorEmpty/)
    expect(v).toMatch(/\{positions\.length === 0 && <PopDoors \/>\}/)
  })

  it("asks the page for its asset only where a page can answer", () => {
    expect(v).toMatch(/\{pageCanCarryAsset\(currentUrl\) && <PageAssetStrip currentUrl=\{currentUrl\} \/>\}/)
  })

  it("keeps the book once there is one", () => {
    expect(v).toMatch(/\{PORTFOLIO_CAPTION\}/)
  })
})

/**
 * ONE TOTAL. The product carried two "my money" headlines over two
 * different sums, and they could disagree at the same instant: the front
 * door's "Portfolio value · positions + cash" over the server's positions
 * fold, and the wallet's "TOTAL BALANCE" over a fold of its own rows plus
 * native SOL at a second price source. A reader who saw both learned the
 * money was unreliable. Both screens now read one helper.
 */
describe("the two money screens cannot disagree", () => {
  const door = stripComments(read("views/SpotPositions.tsx"))
  const wallet = stripComments(read("views/wallet-ui.tsx"))
  const helper = read("helpers/portfolioTotal.ts")

  it("states the caption once, in the helper", () => {
    expect(helper).toMatch(/PORTFOLIO_CAPTION = "Portfolio value · positions \+ cash"/)
    for (const v of [door, wallet]) expect(v).toMatch(/\{PORTFOLIO_CAPTION\}/)
    // And neither screen re-types it.
    for (const v of [door, wallet]) expect(v).not.toMatch(/"Portfolio value/)
    expect(wallet).not.toMatch(/TOTAL BALANCE/)
  })

  it("folds the same response the same way on both screens", () => {
    for (const v of [door, wallet]) expect(v).toMatch(/portfolioTotalUsd\(/)
    // The wallet's old headline summed its own rows; nothing may again.
    expect(wallet).not.toMatch(/tokens\.reduce\(/)
    expect(door).not.toMatch(/totalUsd \+ \(data\.cashUsd/)
  })

  it("reads the book from the one endpoint that scans the chain", () => {
    for (const v of [door, wallet]) expect(v).toMatch(/positionsAsset\(\)/)
  })
})
