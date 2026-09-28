import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const src = readFileSync(join(__dirname, "receive.tsx"), "utf8")

/**
 * THE ADDRESS MAY NOT BE GUESSED, AND THE GUESS WAS CUSTODIAL.
 *
 * Two reads answer "where should this money go", and they land in whatever
 * order the network gives them:
 *
 *   • GET /users/me  → `me`, which says wallet_mode and external_address;
 *   • GET /wallets/me → the EMBEDDED wallet's public key.
 *
 * `external` is a read of `me`, so it is false while `me` is undefined, and
 * the loading gate used to watch only useMyWallet:
 *
 *     const walletAddress = external ? String(me?.external_address)
 *       : walletAddressProp || walletInfo?.wallet?.public_key || ""
 *     const isLoading = walletAddressProp ? false : isLoadingFallback
 *
 * So on a cold panel boot straight into /receive — exactly what the chip's
 * and the panel's funding doors do — /wallets/me answering first paints the
 * QR, the copy pill and the card for the embedded wallet, to a reader whose
 * account trades from Phantom. USDC sent there is invisible to every surface
 * they have: no balance, no arrival toast, no Buy. Nothing on this screen
 * brings it back.
 *
 * The file already had the right guard one screen up — receive_opened waits
 * on `me === undefined` before it claims to know which visit this is. The
 * address now waits on the same fact, and an unread account renders as
 * loading rather than as custodial.
 *
 * SOURCE-SCANNED, like views/receive-structure.spec.ts beside it: jsdom plus
 * @mui cannot render these views at all (components/panel-fit-320.spec.ts),
 * and the thing under test is which fact a value is allowed to be computed
 * from — which the source answers exactly. Every anchor is asserted to exist
 * before anything is concluded from it, so a rename is red and not a vacuum.
 */

/** The single statement that assigns `walletAddress`, up to the next const. */
function statement(name: string): string {
  const at = src.indexOf(`const ${name} =`)
  expect(at, `${name} is gone from views/receive.tsx`).toBeGreaterThan(-1)
  const next = src.indexOf("\n  const ", at + 1)
  return src.slice(at, next > at ? next : at + 400)
}

describe("the address on /receive waits for the account", () => {
  const address = statement("walletAddress")
  const loading = statement("isLoading")

  it("knows which account it is from the same read the counter waits on", () => {
    // One fact, one name, one hook. `me === undefined` is what the
    // receive_opened effect above already refuses to guess past.
    expect(src).toMatch(/const \{ data: me, isError: meUnreadable \} = useCurrentUser\(\)/)
    expect(src).toMatch(/const accountUnread = me === undefined/)
    expect(src).toMatch(/if \(counted\.current \|\| me === undefined\) return/)
  })

  it("renders nothing as the address until the account is read", () => {
    // The gate is FIRST in the chain: anything before it would be a branch
    // taken while the account is still unknown.
    expect(address).toMatch(/const walletAddress = accountUnread\s*\?\s*""/)
    // …and the embedded wallet is only reachable after it.
    const gate = address.indexOf("accountUnread")
    const custodial = address.indexOf("walletInfo?.wallet?.public_key")
    expect(custodial, "the embedded wallet is no longer read here at all").toBeGreaterThan(-1)
    expect(custodial).toBeGreaterThan(gate)
    // The prop is the custodial address too (views/wallet-ui.tsx reads it off
    // useMyWallet), so it does not get to skip the gate either.
    expect(address.indexOf("walletAddressProp")).toBeGreaterThan(gate)
  })

  it("an unknown account is LOADING, never the custodial wallet", () => {
    expect(loading).toMatch(/const isLoading = accountUnread/)
    // The old gate, which is the bug in one line: a prop, or a finished
    // /wallets/me, was enough to call the screen ready.
    expect(loading).not.toMatch(/const isLoading = walletAddressProp \? false/)
  })

  it("a read that FAILED ends on the screen's own sentence, not a spinner forever", () => {
    // useCurrentUser is retry:false with no refetch on focus: after an error
    // no second answer is coming, so spinning would be a lie of its own. The
    // address is still "" — the screen says it could not be read.
    expect(loading).toMatch(/accountUnread\s*\?\s*!meUnreadable/)
    expect(src).toMatch(/Your wallet address could not be read/)
  })

  it("every surface that spends this address is behind that gate", () => {
    /* The QR, the copy pill and Blink's rail all take `walletAddress`, and
       all three sit inside the branch `isLoading` guards — so there is one
       decision, not four. */
    const gate = src.indexOf("{isLoading ? (")
    expect(gate).toBeGreaterThan(-1)
    for (const surface of [
      "value={`solana:${walletAddress}?spl-token=${USDC_MINT}`}",
      "${walletAddress.slice(0, 18)}…${walletAddress.slice(-6)}",
      "address={walletAddress}",
    ]) {
      const at = src.indexOf(surface)
      expect(at, `${surface} is gone from views/receive.tsx`).toBeGreaterThan(-1)
      expect(at).toBeGreaterThan(gate)
    }
  })
})
