import CloseIcon from "@mui/icons-material/Close"
import { alpha, Box, Drawer, Typography } from "@mui/material"
import { BRAND_GROUND } from "~/helpers/brandGround"
import { DIM, PANEL_PILL } from "~/helpers/panelSurface"
import { FollowersTab } from "./FollowersTab"
import { FollowingTab } from "./FollowingTab"

/**
 * Followers and Following, as a sheet.
 *
 * They used to be two of five tabs in a bar that otherwise switched between
 * lists of posts, so tapping "Followers" replaced the whole page with people
 * and there was no way back except another tab. A list of people is a lookup,
 * not a place — it belongs over the profile, not instead of it.
 *
 * The sheet paints BRAND_GROUND because it is its own surface: it covers the
 * panel's ground rather than sitting on it, and a transparent sheet over a
 * gradient reads as a smudge. One painter per surface still holds — this is
 * a different surface.
 */
export function PeopleSheet({
  open,
  which,
  userId,
  onClose,
}: {
  open: boolean
  which: "followers" | "following"
  userId: string
  onClose: () => void
}) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          ...BRAND_GROUND,
          height: "82vh",
          display: "flex",
          flexDirection: "column",
          borderTopLeftRadius: "18px",
          borderTopRightRadius: "18px",
          borderTop: `1px solid ${alpha("#FFFFFF", 0.1)}`,
          color: "#FFFFFF",
          overflow: "hidden",
        },
      }}
    >
      {/* The grab handle, then the title row. */}
      <Box
        sx={{
          width: 36,
          height: 4,
          borderRadius: "999px",
          backgroundColor: alpha("#FFFFFF", 0.18),
          mx: "auto",
          mt: 1,
        }}
      />
      <Box sx={{ display: "flex", alignItems: "center", px: 2, pt: 1.25, pb: 1 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, textTransform: "capitalize" }}>
          {which}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          onClick={onClose}
          aria-label="Close"
          className="click-animation"
          sx={{
            ...PANEL_PILL,
            width: 30,
            height: 30,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            color: DIM,
            p: 0,
            "&:hover": { color: "#FFFFFF" },
          }}
        >
          <CloseIcon sx={{ fontSize: 15 }} />
        </Box>
      </Box>

      {/* The list owns its own scrolling (CustomInfiniteScroll watches that
          container's ref), so this only gives it a box to fill. */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {which === "followers" ? (
          <FollowersTab userId={userId} />
        ) : (
          <FollowingTab userId={userId} />
        )}
      </Box>
    </Drawer>
  )
}
