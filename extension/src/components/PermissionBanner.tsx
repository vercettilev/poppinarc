import { Box, Button, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { checkPermissions, requestPermissions } from "~/helpers/permissionHelper"

/**
 * The way out of the permission trap, visible from inside the panel.
 *
 * `scripting`, `tabs` and `<all_urls>` are OPTIONAL permissions, and the only
 * thing that ever requested them was the onboarding welcome flow. Two groups of
 * users fall through that:
 *
 *   - a returning user whose reinstall skips the welcome tab entirely
 *     (`poppinHasSeenOnboarding` survives in chrome.storage.sync), so nothing
 *     ever asks — and without the grant no content script is EVER injected.
 *     Every page-level feature silently does nothing, forever, with no error
 *     anywhere, because a permission that was never requested is not an error.
 *   - anyone who dismissed or never finished the welcome tab.
 *
 * This banner is the standing recovery path: it renders ONLY while the grant is
 * missing, says plainly what is off, and requests it in one click — a click on
 * an extension page is a user gesture, which is exactly what
 * chrome.permissions.request needs. Once granted it disappears and never
 * renders again, so the cost to everyone else is one permission check per
 * panel open.
 */
export function PermissionBanner() {
  // null = still checking; render nothing rather than flash a warning that a
  // majority of users would only see for a frame.
  const [missing, setMissing] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    checkPermissions()
      .then((ok) => alive && setMissing(!ok))
      .catch(() => alive && setMissing(null))
    return () => {
      alive = false
    }
  }, [])

  if (missing !== true) return null

  const grant = async () => {
    setBusy(true)
    try {
      const ok = await requestPermissions()
      if (ok) setMissing(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1,
        backgroundColor: "#2B1D00",
        borderBottom: "1px solid rgba(255, 193, 7, 0.35)",
      }}
    >
      <Typography sx={{ fontSize: 12, color: "#FFD666", flex: 1 }}>
        Site access is off — Poppin can’t run on pages until it’s granted.
      </Typography>
      <Button
        size="small"
        variant="contained"
        disabled={busy}
        onClick={grant}
        sx={{ fontSize: 12, textTransform: "none", whiteSpace: "nowrap" }}
      >
        {busy ? "Asking…" : "Enable"}
      </Button>
    </Box>
  )
}
