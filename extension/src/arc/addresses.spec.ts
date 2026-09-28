import { describe, expect, it } from "vitest"
import { solanaAddressesIn } from "~/helpers/solanaAddresses"
import { contractAddressesIn, evmAddressesIn } from "./addresses"

const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
const CIRBTC = "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf"
const PUMP = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"

describe("evmAddressesIn", () => {
  it("reads a CA the way it is posted, lowercased", () => {
    expect(evmAddressesIn(`new on Arc\nCA: ${EURC}\nsend it`)).toEqual([EURC.toLowerCase()])
    expect(evmAddressesIn(`https://explorer.arc.io/token/${CIRBTC}`)).toEqual([CIRBTC])
  })

  it("asks once for one address, however it is cased, and at most twice per tweet", () => {
    expect(evmAddressesIn(`${EURC} ${EURC.toLowerCase()} ${CIRBTC}`)).toEqual([EURC.toLowerCase(), CIRBTC])
    expect(evmAddressesIn(`${EURC} ${CIRBTC} 0x${"1".repeat(40)}`)).toEqual([EURC.toLowerCase(), CIRBTC])
    expect(evmAddressesIn(`${EURC} ${CIRBTC}`, 1)).toEqual([EURC.toLowerCase()])
  })

  it("never cuts an address out of a transaction hash or a longer hex run", () => {
    expect(evmAddressesIn(`tx 0x${"ab".repeat(32)}`)).toEqual([])
    expect(evmAddressesIn(`${EURC}ff`)).toEqual([])
    expect(evmAddressesIn(`a${EURC}`)).toEqual([])
    expect(evmAddressesIn("0x1234")).toEqual([])
  })

  it("does not read base58", () => {
    expect(evmAddressesIn(`CA: ${PUMP}`)).toEqual([])
  })
})

describe("contractAddressesIn", () => {
  const text = `CA: ${PUMP} or ${EURC}`
  it("is the Solana reader in the store build", () => {
    expect(contractAddressesIn(text, false)).toEqual(solanaAddressesIn(text))
    expect(contractAddressesIn(text, false)).toEqual([PUMP])
  })

  it("is the 0x reader, alone, in the Arc edition", () => {
    expect(contractAddressesIn(text, true)).toEqual([EURC.toLowerCase()])
  })

  it("defaults to the store reader when the flag is off", () => {
    expect(contractAddressesIn(text)).toEqual([PUMP])
  })
})
