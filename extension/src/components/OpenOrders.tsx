import { cancelOrderViaPage } from "~/helpers/panelExternalTrade"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { JUICE } from "~/theme/juice"
import { alpha, Box, CircularProgress, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import {
  cancelOrderAsset,
  listOrdersAsset,
  type TriggerOrderRow,
} from "~/services/SpotAssetService"
import { DIM, GREEN, PANEL_ROW, RED } from "~/helpers/panelSurface"
import { formatTriggerPrice, orderDistanceLabel } from "~/helpers/orderMath"
import { reasonOf } from "~/helpers/tradeMath"
import { ordersFor, ordersRender } from "~/helpers/openOrdersView"
import { qtyText } from "~/helpers/qtyText"

/**
 * The reader's standing orders, as rows they can close.
 *
 * SILENT WHEN EMPTY WHERE IT IS PASSING THROUGH, by design: most readers
 * will never place one, and a permanent "Open orders (0)" header on a feed
 * would charge everybody rent for a feature a few use.
 *
 * ON THE READER'S OWN PROFILE that reasoning inverts. Someone who goes
 * looking for their orders and finds nothing at all cannot tell "you have
 * none" from "this product does not do that" — which is exactly the report
 * that put this component on the profile in the first place. `showEmpty`
 * says one quiet line there, and nowhere else.
 *
 * The `gated` badge is the rule the backend enforces on its side of the seam:
 * §7's verdict moves, and a mint that has since fallen out of the gate closes
 * the ENTRANCE, not the EXIT. The order stays listed, the reason is stated,
 * and Cancel keeps working — never auto-cancelled, never hidden.
 *
 * Cancel is an ON-CHAIN act (the escrow returns to the wallet), so it gets
 * the same two-beat treatment as a trade: an inline "Cancel?" confirm, then
 * a pending spinner until the transaction is sent. No modal — a modal for a
 * row-level action is a dialog tax the panel does not charge anywhere else.
 */
export function OpenOrders({
  showEmpty = false,
  mint,
  reloadKey,
  onCancelled,
}: {
  showEmpty?: boolean
  /** Narrow to ONE asset, for a surface that is already about that asset. */
  mint?: string
  /** Changes when something happened that this list should re-read. */
  reloadKey?: number
  /**
   * Told when an order LEAVES this list, so the surface around it can
   * re-read its own money. The wallet prints "+$X in open orders" from its
   * own listOrders effect, keyed on a nonce nothing here touched - so
   * cancelling a buy returned the escrow, removed the row, and left that
   * pill claiming money that was already back in the balance until the
   * reader refreshed by hand.
   */
  onCancelled?: () => void
} = {}) {
  // A wallet account's cancel signs in Phantom on the page beside the panel.
  const { data: me } = useCurrentUser()
  const external = me?.wallet_mode === "external"
  const [orders, setOrders] = useState<TriggerOrderRow[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [note, setNote] = useState<{ orderKey: string; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    listOrdersAsset("active")
      .then((r) => {
        if (!alive) return
        // Filtered client-side on purpose: the list is short, the endpoint
        // is one call either way, and a surface showing a subset must not
        // make a second request to do it. WHICH ones belong here is decided
        // by helpers/openOrdersView, where it is tested.
        setOrders(ordersFor(r.orders, mint))
      })
      .catch(() => {
        // Signed out or unreachable — either way this section has nothing to
        // say. The page-level states already narrate auth and errors.
        if (alive) setOrders(null)
      })
    return () => {
      alive = false
    }
  }, [mint, reloadKey])

  const render = ordersRender(orders, showEmpty)
  if (render.kind === "nothing") return null
  if (render.kind === "empty-line") {
    return (
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography sx={{ fontSize: 12, color: JUICE.text3 }}>
          {/* "When it hits" is the control's actual name on every surface;
              "Limit order" existed nowhere a reader could find. */}
          No standing orders. Pick When it hits on any asset to set one.
        </Typography>
      </Box>
    )
  }

  const cancel = async (orderKey: string) => {
    setConfirming(null)
    setCancelling(orderKey)
    setNote(null)
    try {
      const r = external ? await cancelOrderViaPage(orderKey) : await cancelOrderAsset(orderKey)
      if (r.dryRun) {
        setNote({ orderKey, text: "Dry run · cancel built and verified" })
        return
      }
      // Gone. The escrow is on its way back; the row has nothing left to say.
      setOrders((prev) => prev?.filter((o) => o.orderKey !== orderKey) ?? null)
      onCancelled?.()
    } catch (e) {
      setNote({ orderKey, text: reasonOf(e, "Couldn't cancel. Try again.") })
    } finally {
      setCancelling(null)
    }
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: 12, color: DIM, mb: 1 }}>
        Open orders
      </Typography>
      {(orders ?? []).map((o) => {
        const away = orderDistanceLabel(o.triggerPriceUsd, o.currentPriceUsd, o.side)
        const isConfirming = confirming === o.orderKey
        const isCancelling = cancelling === o.orderKey
        const symbol = (o.symbol ?? o.mint.slice(0, 4)).replace(/^\$/, "")
        return (
          <Box
            key={o.orderKey}
            sx={{ ...PANEL_ROW, p: 1.5, mb: 1 }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
                  <Box
                    component="span"
                    sx={{ color: o.side === "buy" ? GREEN : RED }}
                  >
                    {o.side === "buy" ? "Buy" : "Sell"}
                  </Box>{" "}
                  {o.side === "buy"
                    ? `$${(o.amountUsd ?? 0).toFixed(2)} of ${symbol}`
                    : `${qtyText(o.amountUi)} ${symbol}`}
                </Typography>
                <Typography
                  sx={{ fontSize: 11.5, color: DIM, fontVariantNumeric: "tabular-nums" }}
                >
                  at {formatTriggerPrice(o.triggerPriceUsd)}
                  {away && ` · ${away}`}
                </Typography>
                {o.gated && (
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: "#F5A524", mt: 0.25 }}>
                    No longer offered — consider cancelling
                  </Typography>
                )}
                {note?.orderKey === o.orderKey && (
                  <Typography sx={{ fontSize: 11, color: DIM, mt: 0.25 }}>
                    {note.text}
                  </Typography>
                )}
              </Box>

              {isCancelling ? (
                <CircularProgress size={14} sx={{ color: JUICE.text2 }} />
              ) : isConfirming ? (
                <Box sx={{ display: "flex", gap: 0.75 }}>
                  <Box
                    component="button"
                    onClick={() => void cancel(o.orderKey)}
                    className="click-animation"
                    sx={smallBtnSx(true)}
                  >
                    Cancel it
                  </Box>
                  <Box
                    component="button"
                    onClick={() => setConfirming(null)}
                    className="click-animation"
                    sx={smallBtnSx(false)}
                  >
                    Keep
                  </Box>
                </Box>
              ) : (
                <Box
                  component="button"
                  onClick={() => {
                    setConfirming(o.orderKey)
                    setNote(null)
                  }}
                  className="click-animation"
                  sx={smallBtnSx(false)}
                >
                  Cancel
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

const smallBtnSx = (danger: boolean) => ({
  border: "none",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
  fontWeight: 700,
  px: 1.25,
  py: "5px",
  borderRadius: "999px",
  flexShrink: 0,
  color: danger ? "#FFFFFF" : JUICE.text2,
  backgroundColor: danger ? RED : alpha("#FFFFFF", 0.08),
  "&:hover": { backgroundColor: danger ? "#FF6961" : alpha("#FFFFFF", 0.14) },
})
