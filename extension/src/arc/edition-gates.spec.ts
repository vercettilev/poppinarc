import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE SWITCH-OFF POINTS, pinned where they live.
 *
 * The background worker and the content script run chrome.* at import, so
 * their gates are pinned the way the rest of this repo pins those files: as
 * text. Each line below is one route arc-api does not serve, and the
 * capability that keeps the Arc edition from asking it. The capabilities
 * themselves are proven in both editions by config/edition.spec.ts.
 */
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
const bodyOf = (text: string, head: string) => {
  const at = text.indexOf(head)
  expect(at, head).toBeGreaterThan(-1)
  return text.slice(at, at + 600)
}

describe("the background worker asks nothing arc-api does not serve", () => {
  const bg = src("entries/background/main.ts")

  it("imports the capabilities", () => {
    expect(bg).toMatch(/import \{ (ARC_EDITION, )?CAP \} from "~\/config\/edition"/)
  })

  it.each([
    ["function deliverTelemetry(", "if (!CAP.telemetry) return"],
    ["async function beatSitePresence(", "if (!CAP.sitePresence) return"],
    ["async function checkOrderFills(", "if (!CAP.orderWatch) return"],
    ["async function checkInAlerts(", "if (!CAP.alertsMirror) return"],
    ["async function syncFiredFromServer(", "if (!CAP.alertsMirror) return"],
    ["async function checkFollowTrades(", "if (!CAP.social) return"],
    ["async function checkExternalTransfers(", "if (!CAP.depositWatch) return"],
    ["const ensureTicksSocket = (", "if (!CAP.ticks) return null"],
    ['if (alarm.name === "checkNotifications") {', "if (!CAP.gamification) return"],
  ])("%s is gated", (head, gate) => {
    expect(bodyOf(bg, head)).toContain(gate)
  })

  it("creates the rank and presence alarms only where they are served", () => {
    expect(bg).toMatch(/if \(CAP\.gamification\) \{\s*chrome\.alarms\.create\("checkNotifications"/)
    expect(bg).toMatch(/if \(CAP\.sitePresence\) \{\s*chrome\.alarms\.create\(SITE_PRESENCE_ALARM/)
  })

  it("tells the server about a fired alert, and shares a fill, only where it listens", () => {
    expect(bg).toMatch(/if \(CAP\.alertsMirror && auth\.currentUser\) \{\s*for \(const a of due\)/)
    expect(bg).toMatch(/fills\.length > 0 && CAP\.autoPost && \(await mayShare\("fills"\)\)/)
  })

  it("names a mintless transfer by the edition's native money", () => {
    expect(bg).toMatch(/t\.mint === null \? NATIVE_SYMBOL :/)
  })
})

describe("the chip leaves out the deps arc-api cannot answer", () => {
  const cs = src("entries/contentScript/primary/main.tsx")

  it.each([
    ["myRank", "gamification"],
    ["callerFor", "social"],
    ["listNotifications", "social"],
    ["postTrade", "autoPost"],
    ["invite", "gamification"],
    ["points", "gamification"],
    ["listOrders", "orderWatch"],
    ["cancelOrder", "orderWatch"],
  ])("%s rides CAP.%s", (dep, cap) => {
    expect(cs).toMatch(new RegExp(`\\n\\s+${dep}: !CAP\\.${cap} \\? undefined :`))
  })

  it("keeps the server copy of alerts behind its own switch", () => {
    expect(cs).toMatch(/if \(added && CAP\.alertsMirror\) void syncAlerts/)
    expect(cs).toMatch(/if \(CAP\.alertsMirror\) void removeAlertRemote/)
  })

  /**
   * THE PAGE-WALLET RAIL IS SOLANA'S. Left live, a reader with Phantom on
   * the page read "Paid from the wallet on this page. You stay here.", got
   * a Phantom connect popup, and landed on the funding screen with Nest's
   * "Cannot POST /api/v1/fund/wallet-deposit-tx" as the reason. Every door
   * into it answers "no" in the Arc edition, and the address screen is the
   * one door left.
   */
  it("opens no Phantom rail from the chip or the panel", () => {
    expect(cs).toMatch(/canFundHere: async \(\) => \{\s*if \(!CAP\.solanaRails\) return false/)
    expect(cs).toMatch(
      /hasWallet: async \(\) => \{\s*if \(\(await tradingWalletOf\(\)\)\.external\) return false\s*if \(!CAP\.solanaRails\) return false/,
    )
    // topUp goes to the address screen before it reads the account or the page.
    const topUp = cs.slice(cs.indexOf("    topUp: async ("), cs.indexOf("return topUpFromPage(usd,"))
    expect(topUp).toMatch(/if \(!CAP\.solanaRails\) \{\s*openTopUp\([\s\S]*?\)\s*return false\s*\}\s*const tw = await tradingWalletOf\(\)/)
    // The panel's probe hears "no wallet" without the bridge being loaded.
    expect(cs).toMatch(
      /if \(ask\.kind === "probe"\) \{[\s\S]{0,200}?if \(!CAP\.solanaRails\) \{\s*sendResponse\(\{ ok: true, result: \{ present: false \} \}\)\s*return\s*\}\s*const \{ hasPageWallet \}/,
    )
  })
})

describe("the chip's own deposit row", () => {
  const chip = src("entries/contentScript/x/xStrip.ts")

  it("names the network the address is for, in both editions", () => {
    expect(chip).toMatch(/lbl\.textContent = `Send USDC on \$\{CHAIN\.networkName\} to`/)
    expect(chip).toMatch(
      /addr\.title = ARC_EDITION\s*\? `\$\{a\}\\nYour own Poppin address, for USDC on \$\{CHAIN\.networkName\}\.`\s*: `\$\{a\}\\nYour own Poppin address\.`/,
    )
  })

  it("promises a ping only where the deposit watcher runs", () => {
    expect(chip).toMatch(/if \(CAP\.depositWatch\) note\.textContent = "You'll get a ping when it lands\."/)
  })
})

describe("the panel routes and doors", () => {
  it("routes only the rooms that are served", () => {
    const app = src("entries/popup/App.tsx")
    expect(app).toMatch(/\{CAP\.sitePresence && <Route path="live-chat"/)
    expect(app).toMatch(/\{CAP\.gamification && <Route path="flywheel"/)
    expect(app).toMatch(/\{CAP\.social && <Route path="callers"/)
    expect(app).toMatch(/\{CAP\.discover && <Route path="discover"/)
    expect(app).toMatch(/\{CAP\.gamification && <Route path="referral"/)
    expect(app).toMatch(/<Route path="\*" element=\{<Navigate to="\/" replace \/>\} \/>/)
  })

  it("hides the doors into them", () => {
    expect(src("components/Header.tsx")).toMatch(/\.\.\.\(CAP\.gamification\s*\?\s*\[\s*\{\s*label: "Leaderboard"/)
    const front = src("views/SpotPositions.tsx")
    expect(front).toMatch(/\{CAP\.discover && \(/)
    expect(front).toMatch(/\{CAP\.gamification && <InviteRow \/>\}/)
    expect(front).toMatch(/\{CAP\.orderWatch && <OpenOrders/)
    expect(src("views/comment.tsx")).toMatch(/\{CAP\.social && <WinsRail \/>\}/)
    expect(src("views/profile.tsx")).toMatch(/\{CAP\.social && <BestTrades/)
    expect(src("components/PostFooter.tsx")).toMatch(/\{CAP\.autoPost && \(\s*<Box\s+component="button"\s+aria-label="Share this post"/)
    expect(src("hooks/useStreaks.ts")).toMatch(/enabled: CAP\.gamification && enabled && userIds\.length > 0/)
  })

  it("offers no standing order where none can be placed", () => {
    const chip = src("entries/contentScript/x/xStrip.ts")
    expect(chip).toMatch(/\.\.\.\(CAP\.orderWatch \? \[mkTab\("orders", "Orders"\)\] : \[\]\)/)
    expect(chip).toMatch(/head\.append\(tabs, \.\.\.\(CAP\.orderWatch \? \[kindSwitch\] : \[\]\)\)/)
    expect(src("components/TradeSheet.tsx")).toMatch(/\{CAP\.orderWatch && \(\s*<Box[^>]*>\s*\{\(\["now", "trigger"\] as const\)/)
    expect(src("components/PageAssetStrip.tsx")).toMatch(/\{CAP\.orderWatch && <OpenOrders/)
  })

  it("shows no fee sentence and no Solana rail on the Arc money screens", () => {
    const receive = src("views/receive.tsx")
    expect(receive).toMatch(/\{CAP\.feeLines && \(!external \? " Network fees are on us\." : ""\)\}/)
    expect(receive).toMatch(/if \(!CAP\.solanaRails\) return\s+let alive = true\s+void probePageWallet/)
    expect(receive).toMatch(/\) : ARC_EDITION \? \(\s*\/\*[\s\S]*?\*\/\s*<ArcDepositCard/)
    expect(src("components/TradeHistory.tsx")).toMatch(/const fee = CAP\.feeLines &&/)
    expect(src("components/FundDoor.tsx")).toMatch(/\{CAP\.solanaRails && \(\s*<>\s*\{!external && \(\s*<Box\s+component="button"\s+onClick=\{\(\) => void connect\(\)\}/)
    expect(src("components/BlinkFund.tsx")).toMatch(/if \(!CAP\.solanaRails\) return\s+let alive = true/)
    expect(src("views/wallet-ui.tsx")).toMatch(/\{CAP\.keyExport && \(\s*<IconButton\s+aria-label="Export private key"/)
  })
})
