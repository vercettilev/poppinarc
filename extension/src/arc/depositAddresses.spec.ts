import { beforeEach, describe, expect, it, vi } from "vitest"

const sendApiRequest = vi.fn()
vi.mock("~/lib/fetchService", () => ({ sendApiRequest: (...a: unknown[]) => sendApiRequest(...a) }))

import {
  DEPOSIT_ADDRESSES_ROUTE,
  depositCardView,
  fetchDepositAddresses,
  networksSentence,
  OTHERS_NOTE,
  OTHERS_NOTE_SWEPT,
  parseDepositAddresses,
  pillAddress,
  usdcFromRaw,
} from "./depositAddresses"

const ARC = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"
const BASE = "0x1111111111111111111111111111111111111111"
const SOL = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"

beforeEach(() => {
  sendApiRequest.mockReset()
})

describe("parseDepositAddresses", () => {
  it("reads arc-api's 'connect a wallet' answer as a screen with no address yet", () => {
    expect(parseDepositAddresses({ others: [], connectWallet: true })).toEqual({
      arc: { network: "Arc", address: "" },
      others: [],
      connectWallet: true,
    })
  })

  it("keeps Arc first and every other network named, EVM addresses lowercase", () => {
    const got = parseDepositAddresses({
      arc: { network: "Arc", address: ARC },
      others: [
        { network: "Base", address: BASE },
        { network: "Solana", address: SOL },
      ],
    })
    expect(got).toEqual({
      arc: { network: "Arc", address: ARC.toLowerCase() },
      others: [
        { network: "Base", address: BASE },
        // Base58 is case-exact: lowercasing it would be a different address.
        { network: "Solana", address: SOL },
      ],
    })
  })

  it("reads the Nest-wrapped shape too", () => {
    const got = parseDepositAddresses({ data: { arc: { network: "Arc", address: ARC }, others: [] } })
    expect(got?.arc.address).toBe(ARC.toLowerCase())
  })

  it("drops a row it cannot stand behind rather than show it", () => {
    const got = parseDepositAddresses({
      arc: { network: "Arc", address: ARC },
      others: [
        { network: "", address: BASE },
        { network: "Base", address: "not an address" },
        { network: "Ethereum", address: 42 },
        { network: "Arc", address: BASE },
        { network: "Base", address: BASE },
        { network: "Base", address: BASE.toUpperCase().replace("0X", "0x") },
        null,
      ],
    })
    expect(got?.others).toEqual([{ network: "Base", address: BASE }])
  })

  it("is no answer at all without a real Arc address", () => {
    expect(parseDepositAddresses(null)).toBeNull()
    expect(parseDepositAddresses({ others: [] })).toBeNull()
    expect(parseDepositAddresses({ arc: { address: SOL }, others: [] })).toBeNull()
    expect(parseDepositAddresses({ arc: { address: "0x12" } })).toBeNull()
  })

  it("treats a missing list as Arc alone", () => {
    expect(parseDepositAddresses({ arc: { address: ARC } })?.others).toEqual([])
  })

  it("carries each row's floor when the server states one, and none it cannot read", () => {
    const got = parseDepositAddresses({
      arc: { network: "Arc", address: ARC },
      others: [
        { network: "Solana", address: SOL, minUsdcRaw: "5000000" },
        { network: "Base", address: BASE, minUsdcRaw: 1 },
        { network: "Ethereum", address: "0x2222222222222222222222222222222222222222", minUsdcRaw: "-1" },
      ],
    })
    expect(got?.others).toEqual([
      { network: "Solana", address: SOL, minUsdc: "5" },
      { network: "Base", address: BASE },
      { network: "Ethereum", address: "0x2222222222222222222222222222222222222222" },
    ])
    expect(got?.others[1]).not.toHaveProperty("minUsdc")
  })
})

describe("usdcFromRaw", () => {
  it("reads a 6-decimal raw string the way a person does", () => {
    expect(usdcFromRaw("5000000")).toBe("5")
    expect(usdcFromRaw("2500000")).toBe("2.5")
    expect(usdcFromRaw("1")).toBe("0.000001")
    expect(usdcFromRaw("12345678")).toBe("12.345678")
  })

  it("is no figure at all for anything else", () => {
    for (const bad of [undefined, null, 5, "0", "", "1.5", "-5", "5e6", "0x10", "1".repeat(31)]) {
      expect(usdcFromRaw(bad), String(bad)).toBeNull()
    }
  })
})

describe("fetchDepositAddresses", () => {
  it("asks the Arc route with a GET and parses the answer", async () => {
    sendApiRequest.mockResolvedValue({ arc: { network: "Arc", address: ARC }, others: [] })
    const got = await fetchDepositAddresses()
    expect(sendApiRequest).toHaveBeenCalledWith({ url: DEPOSIT_ADDRESSES_ROUTE, method: "GET" })
    expect(DEPOSIT_ADDRESSES_ROUTE).toBe("/arc/deposit-addresses")
    expect(got?.arc.address).toBe(ARC.toLowerCase())
  })

  it("lets a refusal through for the query to hold", async () => {
    sendApiRequest.mockImplementation(async () => {
      throw Object.assign(new Error("Deposit addresses are being set up."), { status: 503 })
    })
    let caught: unknown = null
    try {
      await fetchDepositAddresses()
    } catch (e) {
      caught = e
    }
    expect(caught).toMatchObject({ status: 503 })
  })
})

describe("the card's view", () => {
  it("shows the server's Arc address, and the wallet's own until it answers", () => {
    expect(depositCardView(null, ARC)).toEqual({
      arcAddress: ARC.toLowerCase(),
      others: [],
      othersSummary: "",
      othersNote: OTHERS_NOTE,
    })
    const data = { arc: { address: BASE }, others: [{ network: "Solana", address: SOL }] }
    expect(depositCardView(data, ARC)).toEqual({
      arcAddress: BASE,
      others: [{ network: "Solana", address: SOL }],
      othersSummary: "Solana",
      othersNote: OTHERS_NOTE,
    })
    expect(depositCardView(null, "").arcAddress).toBe("")
  })

  /**
   * THE SWEEP HAS A FLOOR. arc-api leaves a balance under DEPOSIT_MIN_USDC
   * (DEPOSIT_MIN_USDC_SOL on Solana) where it is, so "it moves on its own"
   * is only true above a figure the reader can see. No floor on a row, no
   * promise on the card.
   */
  it("promises the money moves on its own only when every row names its floor", () => {
    const sol = { network: "Solana", address: SOL, minUsdc: "5" }
    const base = { network: "Base", address: BASE, minUsdc: "1" }
    const bare = { network: "Base", address: BASE }
    expect(depositCardView({ arc: { address: ARC }, others: [sol, base] }, "").othersNote).toBe(OTHERS_NOTE_SWEPT)
    expect(depositCardView({ arc: { address: ARC }, others: [sol, bare] }, "").othersNote).toBe(OTHERS_NOTE)
    expect(OTHERS_NOTE).toBe("Send USDC on the network named beside the address.")
    expect(OTHERS_NOTE_SWEPT).toBe(
      "Send USDC on the network named beside the address. It moves to your balance on its own.",
    )
  })

  it("names the other networks in one line, each once", () => {
    expect(networksSentence([])).toBe("")
    expect(networksSentence(["Base"])).toBe("Base")
    expect(networksSentence(["Base", "Solana"])).toBe("Base and Solana")
    expect(networksSentence(["Base", "Ethereum", "Base", "Solana"])).toBe("Base, Ethereum and Solana")
  })

  it("prints an address the way the store card does", () => {
    expect(pillAddress(ARC.toLowerCase())).toBe("0xabcdef0123456789…cdef01")
    expect(pillAddress("short")).toBe("short")
  })
})
