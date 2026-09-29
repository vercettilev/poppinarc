import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendApiRequest = vi.fn()
vi.mock("~/lib/fetchService", () => ({ sendApiRequest: (...a: unknown[]) => sendApiRequest(...a) }))

import { looksLikeMoney, readText, resetReaderClient } from "./readerClient"

/**
 * One request for the posts seen together, none for a post with no sign of
 * money, one per post per page, and a failure that is not remembered.
 */
const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1"

describe("the reader client", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetReaderClient()
    sendApiRequest.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it("asks about the posts of one moment together, and each post once", async () => {
    sendApiRequest.mockImplementation(async ({ data }: { data: { items: Array<{ id: string }> } }) => ({
      items: data.items.map((i) =>
        i.id === "a"
          ? { id: "a", asset: { mint: EURC, ticker: "EURC", name: "Euro", displayName: "Euro" }, reason: "ECB held rates." }
          : { id: i.id, asset: null, reason: "Not about an asset." },
      ),
    }))
    const a = readText("a", "ECB holds rates at 2%")
    const b = readText("b", "Stocks rally on earnings")
    await vi.advanceTimersByTimeAsync(400)
    expect(await a).toEqual({ row: { mint: EURC, ticker: "EURC", name: "Euro", displayName: "Euro" }, reason: "ECB held rates." })
    expect(await b).toBeNull()
    expect(sendApiRequest).toHaveBeenCalledTimes(1)
    expect(sendApiRequest.mock.calls[0]![0]).toMatchObject({ url: "/embed/asset/read", method: "POST" })

    await readText("a", "ECB holds rates at 2%")
    expect(sendApiRequest).toHaveBeenCalledTimes(1)
  })

  it("sends nothing for a post with no sign of money", async () => {
    expect(await readText("c", "lovely weather in Lisbon")).toBeNull()
    expect(looksLikeMoney("ECB cuts rates by 25bp")).toBe(true)
    expect(looksLikeMoney("Analyst predicts 35% upside for Strategy")).toBe(true)
    expect(sendApiRequest).not.toHaveBeenCalled()
  })

  it("does not remember a failed ask as an answer", async () => {
    sendApiRequest.mockRejectedValueOnce(new Error("401"))
    const first = readText("d", "Bitcoin ETF inflows hit a record")
    await vi.advanceTimersByTimeAsync(400)
    expect(await first).toBeNull()
    sendApiRequest.mockResolvedValueOnce({ items: [{ id: "d", asset: null, reason: "x" }] })
    const again = readText("d", "Bitcoin ETF inflows hit a record")
    await vi.advanceTimersByTimeAsync(400)
    await again
    expect(sendApiRequest).toHaveBeenCalledTimes(2)
  })
})
