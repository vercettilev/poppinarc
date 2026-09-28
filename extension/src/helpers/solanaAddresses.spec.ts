import { describe, expect, it } from "vitest"
import { solanaAddressesIn } from "./solanaAddresses"

const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"
const PUMP = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"

describe("finding the addresses a tweet shares", () => {
  it("reads the CA the way launches are posted", () => {
    expect(solanaAddressesIn(`new one just dropped\nCA: ${PUMP}\nsend it`)).toEqual([PUMP])
  })

  it("reads an address inside a token link", () => {
    expect(solanaAddressesIn(`chart https://pump.fun/coin/${PUMP} go`)).toEqual([PUMP])
    expect(solanaAddressesIn(`solscan.io/token/${WIF}`)).toEqual([WIF])
  })

  it("keeps the order and the first two, once each", () => {
    expect(solanaAddressesIn(`${WIF} ${PUMP} ${WIF} ${PUMP}`)).toEqual([WIF, PUMP])
    expect(solanaAddressesIn(`${WIF} ${PUMP}`, 1)).toEqual([WIF])
  })

  it("does not read a transaction signature as an address", () => {
    const sig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW"
    expect(solanaAddressesIn(`tx ${sig}`)).toEqual([])
  })

  it("leaves words, tags and short strings alone", () => {
    expect(solanaAddressesIn("#ThisIsAVeryLongHashtagWithoutAnyDigitsAtAll ok")).toEqual([])
    expect(solanaAddressesIn("$WIF to the moon 100x 2026")).toEqual([])
    // 0, O, I and l are not base58, so a run containing them breaks there.
    expect(solanaAddressesIn("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")).toEqual([])
  })
})
