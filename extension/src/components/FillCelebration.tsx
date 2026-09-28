import { JUICE } from "~/theme/juice"
import { alpha, Box, Typography } from "@mui/material"
import { useCallback, useEffect, useState } from "react"
import { WebsitePostService } from "~/services/WebsitePostService"
import {
  fillNotification,
  fillShareText,
  PENDING_FILLS_KEY,
  splitFillsFor,
  type PendingFill,
} from "~/helpers/orderFillWatch"

/**
 * THE FILL, GREETED — the delivery behind the notification's doorbell.
 *
 * The background writes every detected fill into storage; this reads the
 * ones for the asset the panel is looking at and says so once, however the
 * reader got here — notification tap, chip tap, or wandering in on their
 * own an hour later. Seen means deleted: a celebration that replays is a
 * nag wearing a party hat.
 *
 * It renders INSIDE the asset card rather than as its own banner because
 * the fill is a fact about this asset, and the product has one card per
 * asset, not a stack of announcements.
 */
export function FillCelebration({ mint }: { mint: string }) {
  const [fills, setFills] = useState<PendingFill[]>([])
  /**
   * The undo flag lives here, ABOVE the `fills.length === 0` guard below,
   * because a hook declared after an early return is only called on the
   * renders that get past it: the first fill to arrive changed this
   * component's hook count from four to five and React threw "Rendered more
   * hooks than during the previous render", taking the panel down with it.
   * Its meaning is the button's, its position is React's.
   */
  const [undone, setUndone] = useState(false)

  const load = useCallback(() => {
    if (!chrome?.storage?.local) return
    void chrome.storage.local.get(PENDING_FILLS_KEY).then((stored) => {
      const all: PendingFill[] = stored?.[PENDING_FILLS_KEY] ?? []
      setFills(splitFillsFor(all, mint).mine)
    })
  }, [mint])

  useEffect(() => {
    load()
    if (!chrome?.storage?.onChanged) return
    // A fill can land WHILE the panel is open — the watch runs on its own
    // clock. The listener keeps the greeting as fresh as the doorbell.
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[PENDING_FILLS_KEY]) load()
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [load])

  const dismiss = useCallback(() => {
    if (!chrome?.storage?.local) return
    void chrome.storage.local.get(PENDING_FILLS_KEY).then((stored) => {
      const all: PendingFill[] = stored?.[PENDING_FILLS_KEY] ?? []
      // MARKED SEEN, not deleted. The record now feeds three Activity
      // bands and an unread bell; erasing it here would take the news off
      // the other surfaces the moment this one greeted the reader.
      const { mine, rest } = splitFillsFor(all, mint)
      void chrome.storage.local.set({
        [PENDING_FILLS_KEY]: [...rest, ...mine.map((f) => ({ ...f, read: true }))],
      })
      setFills([])
    })
  }, [mint])

  if (fills.length === 0) return null

  const latest = fills[fills.length - 1]
  const { message } = fillNotification(latest)

  /**
   * THE REVERSAL, ONE TAP FROM WHERE IT WAS ANNOUNCED.
   *
   * The product posted this to the reader's feed without being asked —
   * which is right for a product whose feed IS people's trades, and only
   * right if undoing it is easier than finding a settings screen. The
   * notification says it happened and lands here; here is the button.
   */
  const undo = () => {
    const id = latest.postId
    if (!id || undone) return
    setUndone(true)
    void WebsitePostService.delete({ id, reason: "undo_auto_share" }).catch(
      () => {
        // The post stands. Saying so beats a button that lies about a
        // thing on the reader's own feed.
        setUndone(false)
      },
    )
  }

  const share = () => {
    window.open(
      "https://twitter.com/intent/tweet?text=" +
        encodeURIComponent(fillShareText(latest)),
      "_blank",
      "noopener",
    )
    // Sharing IS seeing it. The moment moves on.
    dismiss()
  }

  return (
    <Box
      data-fill-celebration
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        mb: 1.25,
        px: 1.25,
        py: 1,
        borderRadius: "12px",
        backgroundColor: alpha(JUICE.green, 0.1),
        border: `1px solid ${alpha(JUICE.green, 0.3)}`,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: JUICE.green }}>
          {latest.side === "buy" ? "Buy order filled" : "Sell order filled"}
          {fills.length > 1 ? ` · +${fills.length - 1} more` : ""}
        </Typography>
        <Typography
          sx={{
            fontSize: 11.5,
            fontWeight: 600,
            color: JUICE.text2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {message}
        </Typography>
      </Box>
      {latest.postId && (
        <Box
          component="button"
          onClick={undo}
          disabled={undone}
          sx={{
            border: 0,
            background: "none",
            cursor: undone ? "default" : "pointer",
            font: "inherit",
            fontSize: 11.5,
            fontWeight: 700,
            color: undone ? JUICE.text3 : JUICE.text2,
            px: 0.75,
            flexShrink: 0,
            textDecoration: undone ? "none" : "underline",
            /**
             * BOTH WORDS SHARE ONE CELL. "Removed" is narrower than "Undo
             * share", so swapping the text alone re-measured this button on
             * the press and slid the Share pill and the dismiss glyph beside
             * it. The wider label sizes the box once; the press only decides
             * which of the two is painted in it.
             */
            display: "inline-grid",
            justifyItems: "center",
            "& > *": { gridArea: "1 / 1" },
          }}
        >
          <Box component="span" sx={{ visibility: undone ? "hidden" : "visible" }}>
            Undo share
          </Box>
          <Box component="span" sx={{ visibility: undone ? "visible" : "hidden" }}>
            Removed
          </Box>
        </Box>
      )}
      <Box
        component="button"
        onClick={share}
        sx={{
          border: 0,
          cursor: "pointer",
          font: "inherit",
          fontSize: 11.5,
          fontWeight: 700,
          px: 1.25,
          py: "5px",
          borderRadius: "999px",
          color: "#06202e",
          backgroundColor: JUICE.green,
          flexShrink: 0,
        }}
      >
        Share on X
      </Box>
      <Box
        component="button"
        aria-label="Dismiss"
        onClick={dismiss}
        sx={{
          border: 0,
          background: "none",
          cursor: "pointer",
          font: "inherit",
          fontSize: 13,
          color: JUICE.text3,
          px: 0.5,
          flexShrink: 0,
          "&:hover": { color: "rgba(255,255,255,.85)" },
        }}
      >
        ✕
      </Box>
    </Box>
  )
}
