/** @jsxImportSource preact */
/*
 * THE PRAGMA ABOVE IS LOAD-BEARING — TradePanel is rendered by PREACT, and a
 * spec compiled against React's runtime would exercise a different tree than
 * the one that ships.
 */
import { render } from "preact"
import { act } from "preact/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TradePanel } from "./TradePanel"
import type { Reader } from "~/helpers/tradeSheetModel"

const ASSET = {
  mint: "MINT1",
  symbol: "$WIF",
  name: "dogwifhat",
  usdPrice: 178.34,
  change24hPct: -1.3,
  balance: { uiAmount: 61.4082, raw: "61408200", decimals: 6 },
  restrictions: [],
} as unknown as Parameters<typeof TradePanel>[0]["asset"]

/** Bought at $142, so the tape is 25.6% above the entry. */
const UP: Reader = { cashUsd: 432.1, uiAmount: 61.4082, raw: "61408200", entryMcapUsd: 142 }
/** Bought at $220, so the position is under water. */
const DOWN: Reader = { cashUsd: 432.1, uiAmount: 61.4082, raw: "61408200", entryMcapUsd: 220 }

function mount(o: {
  reader?: Reader
  onConfirm?: () => void
  onPlaceOrder?: (i: unknown) => Promise<void>
  onListOrders?: () => Promise<unknown[]>
  onCancelOrder?: (k: string) => Promise<void>
} = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const onGate = vi.fn()
  const handlers = {
    onExpand: vi.fn(),
    onAmount: vi.fn(),
    onConfirm: o.onConfirm ?? vi.fn(),
    onDismiss: vi.fn(),
    onGate,
    onPlaceOrder: o.onPlaceOrder ?? vi.fn(async () => {}),
    onListOrders: o.onListOrders ?? vi.fn(async () => []),
    onCancelOrder: o.onCancelOrder ?? vi.fn(async () => {}),
  } as never
  // Inside act(), or Preact never flushes the component's EFFECTS — which is
  // invisible while every test passes its data in as a prop, and the reason
  // the orders list looked dead while the product rendered it fine.
  act(() => {
    render(
      <TradePanel asset={ASSET} handlers={handlers} quote="" canConfirm reader={o.reader ?? UP} />,
      host,
    )
  })
  const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)
  const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
  /**
   * Preact batches state into a microtask, so a click and the DOM read that
   * follows it are two different frames. `act` flushes the queue, which is
   * the difference between testing the tree and testing the tree's past.
   */
  const tapKind = (label: string) =>
    act(() => {
      all(".kind-btn").find((b) => b.textContent === label)!.click()
    })
  const tap = (sel: string, label: string) =>
    act(() => {
      all(sel).find((b) => b.textContent === label)!.click()
    })
  const type = (v: string) =>
    act(() => {
      const el = q<HTMLInputElement>(".order-price")!
      el.value = v
      el.dispatchEvent(new Event("input", { bubbles: true }))
    })
  /** A limit needs a SIZE as well as a price — the same as a market trade. */
  const amount = (v: string) =>
    act(() => {
      const el = q<HTMLInputElement>("[data-amount]")!
      el.value = v
      el.dispatchEvent(new Event("input", { bubbles: true }))
    })
  const press = (sel: string) =>
    act(() => {
      q<HTMLButtonElement>(sel)!.click()
    })
  return { host, handlers, onGate, q, all, tapKind, tap, type, press, amount }
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("the card grows the order it used to send away", () => {
  it("starts on Market, with no price leg to answer", () => {
    const { q } = mount()
    expect(q(".order-leg")).toBeNull()
    // and the door it replaced is gone
    expect(q("[data-order-door]")).toBeNull()
  })

  it("opens the price leg on Limit", () => {
    const { q, tapKind } = mount()
    tapKind("When it hits")
    expect(q(".order-leg")).not.toBeNull()
    expect(q(".order-lbl")!.textContent).toBe("Buy $WIF when it drops to")
    expect(q(".order-price")).not.toBeNull()
  })

  it("reads a profit and a refusal as two separate answers", () => {
    const { q, tapKind, type, amount } = mount({ reader: DOWN })
    tapKind("When it hits")
    amount("25")
    // a buy trigger ABOVE the tape is not an order, whatever the reading says
    type("200")
    expect(q(".order-read")!.className).toContain("bad") // above the tape
    expect(q(".order-note")!.textContent).toBe("Already below that — use Buy")
  })

  it("sends a limit down the order rail, never through Confirm", async () => {
    const onConfirm = vi.fn()
    const onPlaceOrder = vi.fn(async () => {})
    const { tapKind, type, press, amount } = mount({ onConfirm, onPlaceOrder })
    tapKind("When it hits")
    amount("25")
    type("160.51")
    press('[data-act="confirm"]')
    expect(onPlaceOrder).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "limit-buy", triggerPriceUsd: 160.51 }),
    )
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("keeps Confirm on the market rail", () => {
    const onConfirm = vi.fn()
    const onPlaceOrder = vi.fn(async () => {})
    const { press } = mount({ onConfirm, onPlaceOrder })
    press('[data-act="confirm"]')
    expect(onConfirm).toHaveBeenCalled()
    expect(onPlaceOrder).not.toHaveBeenCalled()
  })

  it("will not send a limit the rulebook refuses", () => {
    const onPlaceOrder = vi.fn(async () => {})
    const { q, tapKind, type, press, amount } = mount({ onPlaceOrder })
    tapKind("When it hits")
    amount("25")
    type("200") // above the tape on a BUY — not an order
    expect(q<HTMLButtonElement>('[data-act="confirm"]')!.disabled).toBe(true)
    press('[data-act="confirm"]')
    expect(onPlaceOrder).not.toHaveBeenCalled()
  })

  it("shows cash on a buy and the position on a sell", () => {
    const { q, all } = mount()
    expect(q("[data-order-bal]")!.textContent).toBe("USDC balance $432.10")

    act(() => {
      all("[aria-selected]").find((b) => b.textContent?.includes("Sell"))?.click()
    })
    // The line says what the panel can prove: how much is held and what it
    // is worth now. It used to add "entry $142 +25.6%", computed as
    // netInvestedUsd / uiAmount — net cash out over units still held, which
    // is a cost basis only for a position that has never been sold. See
    // helpers/tradeSheetModel for the full account.
    expect(q("[data-order-bal]")!.textContent).toContain("You hold")
    expect(q("[data-order-bal]")!.textContent).not.toContain("entry")
  })
})

/**
 * The card could place an order and then never show it again — the one
 * surface that opened a position it could not see or close. The chip and the
 * panel both list them; measured before building, this one did not.
 */
describe("the card can see and close what it placed", () => {
  const STANDING = [
    {
      orderKey: "K1",
      side: "buy" as const,
      amountUsd: 25,
      amountUi: 0,
      triggerPriceUsd: 160.51,
      gated: false,
    },
  ]

  const settle = () => new Promise((r) => setTimeout(r, 0))

  it("lists what is standing on this asset", async () => {
    const { q } = mount({ onListOrders: async () => STANDING })
    await settle()
    await act(async () => {})
    expect(q("[data-oo-list]")).not.toBeNull()
    expect(q(".oo-row")!.textContent).toContain("$25 at $160.51")
  })

  it("is silent when nothing is standing", async () => {
    const { q } = mount({ onListOrders: async () => [] })
    await settle()
    await act(async () => {})
    expect(q("[data-oo-list]")).toBeNull()
  })

  /**
   * §7 can stop admitting a mint and the row says so, but the EXIT is never
   * gated: a reader must always be able to get out of something they are in.
   */
  it("keeps cancel lit on a paused market", async () => {
    const onCancelOrder = vi.fn(async () => {})
    const { q } = mount({
      onListOrders: async () => [{ ...STANDING[0], gated: true }],
      onCancelOrder,
    })
    await settle()
    await act(async () => {})
    expect(q(".oo-gated")!.textContent).toBe("paused")
    const x = q<HTMLButtonElement>("[data-oo-cancel]")!
    expect(x.disabled).toBe(false)
    act(() => x.click())
    expect(onCancelOrder).toHaveBeenCalledWith("K1")
  })

  it("re-reads the book after a cancel instead of trusting its own state", async () => {
    let calls = 0
    const { q } = mount({
      onListOrders: async () => {
        calls++
        return calls === 1 ? STANDING : []
      },
      onCancelOrder: async () => {},
    })
    await settle()
    await act(async () => {})
    expect(calls).toBe(1)
    act(() => q<HTMLButtonElement>("[data-oo-cancel]")!.click())
    await settle()
    await act(async () => {})
    expect(calls).toBe(2)
    expect(q("[data-oo-list]")).toBeNull()
  })
})

/**
 * THE SILENT PRESS, pinned. A reader with $0 cash (he held $5 of SOL and
 * believed that was buying power) pressed Place order and NOTHING happened:
 * the rulebook had answered "fund" with intent null, and the card drew a
 * disabled button wearing an actionable label. The card now draws what the
 * rulebook said.
 */
describe("when the reader cannot pay", () => {
  const BROKE: Reader = { cashUsd: 0, uiAmount: 0, raw: "0", entryMcapUsd: null }

  it("the limit button IS the funding door, and it opens it", () => {
    const m = mount({ reader: BROKE })
    m.tapKind("When it hits")
    // The size is what makes $0 of cash "cannot pay" — an empty field is a
    // starting state, not a shortfall.
    m.amount("25")
    const door = m.q<HTMLButtonElement>('[data-act="gate-topup"]')!
    expect(door).not.toBeNull()
    // Begins with Deposit and names the currency; the amount between them
    // is the distance the reader has to cover. See tradeSheetModel.
    expect(door.textContent).toMatch(/^Deposit .*USDC$/)
    expect(door.disabled).toBeFalsy()
    act(() => door.click())
    expect(m.onGate).toHaveBeenCalledWith("topup")
  })

  it("says the cash truth next to the order, in amber", () => {
    const m = mount({ reader: BROKE })
    m.tapKind("When it hits")
    m.amount("25")
    const bal = m.q(".order-bal")!
    expect(bal.textContent).toContain("$0.00")
    expect(bal.classList.contains("low")).toBe(true)
  })

  it("a funded reader gets an ARMED key that names the money and the trigger", () => {
    /**
     * The key used to read "Place order" — an exchange's word for the
     * mechanism. What the reader is actually doing is buying an amount if
     * the price gets somewhere, and the market key has named its own money
     * since the day it shipped. Same sentence shape, both kinds.
     */
    const m = mount()
    m.tapKind("When it hits")
    expect(m.q('[data-act="gate-topup"]')).toBeNull()
    const confirm = m.q<HTMLButtonElement>('[data-act="confirm"]')!
    // Empty field: the key asks for the one thing missing.
    expect(confirm.textContent).toBe("Type a price")
    // Priced AND sized — a limit needs both, the same as a market trade.
    m.amount("25")
    m.type("90")
    expect(confirm.textContent).toMatch(/^Buy \$\d/)
    expect(confirm.textContent).toContain(" at $")
  })
})
