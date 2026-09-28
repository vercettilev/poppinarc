/**
 * WHAT AN OPEN-ORDERS LIST SHOWS, decided once.
 *
 * The component that draws standing orders is mounted on three surfaces with
 * three different jobs, and each of them got the same two questions wrong at
 * least once: which orders belong here, and what to draw before the answer
 * arrives. Both live here now, where they can be checked without a browser.
 *
 * THE DISTINCTION THAT MATTERS: `null` is "still asking" and `[]` is "there
 * are none". Collapsing them prints "No standing orders" over an order that
 * exists and is about to appear — which reads as the order having failed,
 * on the one screen where a reader went looking to be reassured.
 */

export interface OrderLike {
  mint: string
}

/** Narrow to one asset where the surface is already about that asset. */
export function ordersFor<T extends OrderLike>(
  orders: readonly T[] | null,
  mint?: string,
): T[] | null {
  if (orders === null) return null
  return mint ? orders.filter((o) => o.mint === mint) : [...orders]
}

export type OrdersRender =
  | { kind: "list" }
  | { kind: "nothing" }
  | { kind: "empty-line" }

/**
 * Silent when empty where it is PASSING THROUGH: most readers never place a
 * standing order, and a permanent "Open orders (0)" charges everybody rent
 * for a feature a few use. On the reader's OWN profile it inverts — somebody
 * who goes looking and finds nothing cannot tell "you have none" from "this
 * product does not do that".
 */
export function ordersRender(
  orders: readonly OrderLike[] | null,
  showEmpty: boolean,
): OrdersRender {
  if (orders === null) return { kind: "nothing" }
  if (orders.length > 0) return { kind: "list" }
  return showEmpty ? { kind: "empty-line" } : { kind: "nothing" }
}
