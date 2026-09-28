/**
 * WHICH TERMINAL FACT A TRADE EVENT ALSO IS.
 *
 * The chip's three trade events (x_inline_buy, x_inline_sell,
 * x_inline_order) map to swap_submitted, and for as long as that was the
 * whole mapping the funnel read "26 trades sent, 0 landed, 0 failed" on a
 * day whose receipts were on screen. Nothing in the extension had ever
 * emitted swap_confirmed or swap_failed. The outcome was in the payload the
 * entire time — the chip sends `kind` with every one of them — and the map
 * threw it away.
 *
 * This is the one place that reads it. It answers with the ADDITIONAL stage
 * to record, never a replacement: a funnel's stages nest, a trade that
 * landed was also sent, and a "landed" count that excluded itself from
 * "sent" would make the conversion between them meaningless.
 *
 *   done    -> swap_confirmed   the chain confirmed it
 *   error   -> swap_failed      it was refused, before or on chain
 *   pending -> nothing          still in the air; neither claim is honest yet
 *   info    -> nothing          a dry run, which bought nothing
 */
export function terminalStage(
  mapped: string | undefined,
  payload: unknown,
): "swap_confirmed" | "swap_failed" | undefined {
  if (mapped !== "swap_submitted") return undefined
  const kind = (payload as { kind?: unknown } | null | undefined)?.kind
  if (kind === "done") return "swap_confirmed"
  if (kind === "error") return "swap_failed"
  return undefined
}
