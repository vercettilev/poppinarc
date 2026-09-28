import { JUICE } from "~/theme/juice"
import CheckIcon from "@mui/icons-material/Check"
import FilterListIcon from "@mui/icons-material/FilterList"
import {
  alpha,
  Box,
  Divider,
  IconButton,
  MenuItem,
  Popover,
  styled,
  Switch,
  Typography,
  useTheme,
} from "@mui/material"
import { useState } from "react"
import { useFilterStore, type FeedKind } from "~/store/useFilterStore"
import { useUIStore } from "~/store/useUIStore"

/**
 * The feed's ONE control, on the feed's own label row.
 *
 * ── WHY IT LIVES ON THAT ROW AND NOT IN THE HEADER ──────────────────────────
 * This used to be mounted in Header's right-hand group, and the comment here
 * argued that as a saving: the feed had spent a whole row on a URL/domain
 * Select plus a funnel, the Select's entire job was one boolean ("this page"
 * vs "all posts on this site") wearing a dropdown's clothes, so the boolean
 * became the toggle at the bottom of this popover and the row went away.
 *
 * The boolean part still holds. The location did not. Layout gives a header
 * to nearly every route, so a control that only drives useFilterStore and
 * useUIStore — read by the feed and nothing else — rode along over Positions,
 * Wallet, Tasks and Notifications, where pressing it changed nothing anyone
 * could see. It now sits at the far right of the feed's label row
 * (components/ActionBar.tsx), beside the pill naming the feed it filters, on
 * the owner's call.
 *
 * ── AND WHY IT IS 26px, NOT 36px ────────────────────────────────────────────
 * It arrived here still wearing the header's chrome size. Header.tsx:623-627
 * states that contract — "every chrome element in this row is exactly 36×36"
 * — and it is a contract about THE HEADER ROW, which this control left. Worn
 * on the label row it did two visible kinds of damage. It made the row TALLER
 * (6 + 36 + 6 = 48px) at the exact moment the owner had asked for the row to
 * shrink ("çok az üstten alttan eşit şekilde büzelim"), so the 2px the pill's
 * trim bought was swallowed by 8px the row gained. And it put a 36px circle
 * beside a 26px pill on one row, which made a height mismatch the loudest
 * thing on a row whose whole job is to say quietly where you are.
 *
 * 26px is the label pill's own height, derived not guessed: 1px border +
 * 3px padY + an 18px line box (12px × 1.5) + 3px padY + 1px border
 * (components/HeaderPill.tsx:51,57-58,88-90 and the call site's paddingY in
 * ActionBar.tsx). The two controls on the row now measure the same, and the
 * row is 6 + 26 + 6 = 38px — 2px under the 40px it was before any of this,
 * and well under the header's own 10 + 36 + 10 = 56px.
 *
 * `padding: 0` is load-bearing: IconButton ships 8px of it, which at 36px
 * happened to add up (8 + 18 + 8 + 2 border = 36) and at 26px would not.
 * The glyph is centred by flex, and its 16px in a 24px content box leaves
 * 4px of air on every side.
 *
 * ── WHAT'S DELIBERATELY NOT HERE ────────────────────────────────────────────
 * "Less liked" — a sort nobody asks for by name; three sorts cover the real
 * questions. The "All Posts" scores toggle — a debug lens (show sub-quality
 * posts) that shipped as a user control; the feed keeps its default behavior
 * and the lens can come back as a dev tool if it is ever missed.
 */

const FilterMenuItem = styled(MenuItem)<{ active?: boolean }>(
  ({ theme, active }) => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "8px 16px",
    backgroundColor: active
      ? alpha(theme.palette.primary.main, 0.1)
      : "transparent",
    "&:hover": {
      backgroundColor: active
        ? alpha(theme.palette.primary.main, 0.16)
        : alpha("#FFFFFF", 0.05),
    },
  }),
)

const SORTS = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["most_liked", "Most liked"],
] as const

const KINDS: ReadonlyArray<readonly [FeedKind, string]> = [
  ["all", "Posts & Trades"],
  ["posts", "Posts only"],
  ["trades", "Trades only"],
]

export function FeedFilterButton() {
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const { orderBy, setOrderBy, feedKind, setFeedKind } = useFilterStore()
  const { isDomainPost, setIsDomainPost } = useUIStore()

  const close = () => setAnchorEl(null)

  return (
    <>
      <IconButton
        id="feed-filter"
        className="click-animation"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          // 26px = the label pill's height, so the row reads as one line of
          // controls rather than a chip next to a chrome circle. See the
          // derivation in this file's header.
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: "999px",
          // The one fixed width on the row. The pill beside it is the elastic
          // half — it carries maxWidth: calc(100% - 34px) (= this 26px plus
          // the row's 8px gap) and ellipsises its own text — so nothing here
          // ever slides out of a 320px panel and nothing is hidden off-edge.
          // This is not the ProfileFeed case: that row had five equal pills
          // each refusing to shrink, and had to wrap; this row has one label
          // that shrinks and one control that must stay round.
          flexShrink: 0,
          color: "#FFFFFF",
          backgroundColor: alpha("#FFFFFF", 0.06),
          border: `1px solid ${alpha("#FFFFFF", 0.1)}`,
          "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
        }}
      >
        <FilterListIcon sx={{ fontSize: 16 }} />
      </IconButton>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            backgroundColor: JUICE.ground,
            border: `1px solid ${alpha("#FFFFFF", 0.08)}`,
            borderRadius: "12px",
            marginTop: "6px",
            width: "200px",
            boxShadow: `0 12px 32px ${alpha("#000", 0.5)}`,
          },
        }}
      >
        <Box sx={{ py: "3px" }}>
          {SORTS.map(([value, label]) => (
            <FilterMenuItem
              key={value}
              active={orderBy === value}
              onClick={() => {
                setOrderBy(value)
                close()
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: orderBy === value ? 500 : 400 }}>
                {label}
              </Typography>
              {orderBy === value && (
                <CheckIcon sx={{ width: 16, height: 16, color: theme.palette.primary.main }} />
              )}
            </FilterMenuItem>
          ))}

          <Divider sx={{ my: 1, borderColor: alpha("#FFFFFF", 0.08) }} />

          {KINDS.map(([kind, label]) => (
            <FilterMenuItem
              key={kind}
              active={feedKind === kind}
              onClick={() => {
                setFeedKind(kind)
                close()
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: feedKind === kind ? 500 : 400 }}>
                {label}
              </Typography>
              {feedKind === kind && (
                <CheckIcon sx={{ width: 16, height: 16, color: theme.palette.primary.main }} />
              )}
            </FilterMenuItem>
          ))}

          <Divider sx={{ my: 1, borderColor: alpha("#FFFFFF", 0.08) }} />

          {/* The old URL/domain Select, reduced to what it always was: one
              boolean. Widens the feed from this page to the whole site. */}
          <Box
            onClick={() => setIsDomainPost(!isDomainPost)}
            sx={{
              px: 2,
              py: 1,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 2,
              cursor: "pointer",
              "&:hover": { backgroundColor: alpha("#FFFFFF", 0.05) },
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: isDomainPost ? 500 : 400 }}>
              All posts in this site
            </Typography>
            <Switch
              checked={isDomainPost}
              size="small"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setIsDomainPost(e.target.checked)}
            />
          </Box>
        </Box>
      </Popover>
    </>
  )
}
