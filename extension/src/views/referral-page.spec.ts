import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")
/** Comments are where the history lives; the words readers see are the rest. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the invite page", () => {
  const r = stripComments(read("views/referral-program.tsx"))

  it("hands out the join link, not a bare code", () => {
    expect(r).toMatch(/inviteLink\(/)
    expect(r).not.toMatch(/poppin\.gg/)
  })

  it("claims no sign-up field that the live sign-in never shows", () => {
    expect(r).not.toMatch(/enters it when they sign up/)
  })

  it("opens with what it earned, then the rule in percentages, and says payout is by hand", () => {
    // Lev, 2026-09-19: the percentage, not a worked dollar example. The
    // chip's receipt line and the leaderboard card say 20% too.
    const heroAt = r.indexOf("earned from ${joined}")
    const ruleAt = r.indexOf("Of your friends' trading fees")
    expect(heroAt).toBeGreaterThan(0)
    expect(ruleAt).toBeGreaterThan(heroAt)
    expect(r).toMatch(/\{ k: "Of your friends' trading fees", v: "20%" \}/)
    expect(r).toMatch(/\{ k: "Of their friends' fees too", v: "5%" \}/)
    expect(r).toMatch(/by hand for now/)
  })

  it("counts friends once", () => {
    expect(r).not.toMatch(/Friends Joined/)
    expect(r).not.toMatch(/useRedeemedInvitationCodes/)
  })
})

/**
 * THE DOOR IS ON THE FRONT DOOR NOW. Measured 2026-09-19: 2,532 accounts,
 * zero arrived through a link, zero links copied, because every invite
 * surface stood behind a landed trade and one account has ever traded.
 */
describe("the invite door", () => {
  const row = stripComments(read("components/InviteRow.tsx"))
  const front = stripComments(read("views/SpotPositions.tsx"))
  const chip = stripComments(read("entries/contentScript/x/xStrip.ts"))

  it("sits on the front door, before any trade", () => {
    expect(front).toMatch(/<InviteRow \/>/)
    expect(row).not.toMatch(/FIRST_TRADE_KEY|hasTraded|landed\(/)
  })

  it("states the rule until somebody joins, then becomes a meter", () => {
    expect(row).toMatch(/const meter = joined > 0/)
    expect(row).toMatch(/"You earn 20% of their trading fees"/)
    expect(row).toMatch(/\$\{joined\} \$\{joined === 1 \? "friend" : "friends"\} trading/)
    expect(row).toMatch(/earned from their trades/)
  })

  it("rides every receipt on the chip, not only the first", () => {
    expect(chip).toMatch(/await deps\.invite\.landed\(\)/)
    const fn = chip.slice(chip.indexOf("const inviteLineAfterLanding"))
    expect(fn.slice(0, 600)).not.toMatch(/if \(!first\) return/)
    expect(chip).toMatch(/You earn 20% of their fees\./)
  })
})

