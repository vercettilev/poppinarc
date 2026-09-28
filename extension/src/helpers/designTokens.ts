// Centralized design tokens for the new Poppin design language.
//
// The leaderboard screen is the visual reference: pure-black canvas
// (#000), brand-blue accent sourced from theme.palette.primary.main,
// 10px page gutters, hairline scrollbars, and frosted-glass overlays
// pinned to specific surfaces (sticky bottom bars, drawer, toasts).
//
// Anything that needs to look part of the system should pull its
// numbers from here rather than re-deriving them locally — that's how
// the screens stay pixel-aligned as the user navigates between them.

import { alpha } from "@mui/material"

export const colors = {
  // Page surface — every full-screen view sits on this.
  pageBg: "#000",
  // Streak orange, used wherever the standard flame asset shows up.
  fire: "#FF8A3D",
  // Notification badge red.
  badge: "#FF0000",
  // Destructive / error tint (inline form warnings, error banners).
  error: "#FF6B6B",
} as const

export const radii = {
  card: "16px",
  list: "14px",
  tile: "12px",
  pillSmall: "10px",
  pillLarge: "999px",
} as const

export const gutters = {
  // Side padding for any full-width content (lists, cards, panels).
  page: "10px",
} as const

// Reusable webkit + firefox hairline scrollbar.
export const thinScrollbar = {
  scrollbarWidth: "thin",
  scrollbarColor: `${alpha("#FFFFFF", 0.18)} transparent`,
  "&::-webkit-scrollbar": { width: 2 },
  "&::-webkit-scrollbar-track": { backgroundColor: "transparent" },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: alpha("#FFFFFF", 0.18),
    borderRadius: 2,
  },
} as const

// Frosted-glass treatment for sticky overlays (bottom action panels,
// drawer chrome, floating toasts). Always paired with a translucent
// black backdrop so the layer underneath stays partially visible.
export const liquidGlass = {
  backgroundColor: alpha("#000", 0.68),
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  borderTop: `1px solid ${alpha("#FFFFFF", 0.06)}`,
} as const

// Hairline 0.5px divider used for sub-rows inside lists.
export const hairline = `0.5px solid ${alpha("#FFFFFF", 0.06)}`

// 1px outline for tiles + cards that need a quiet edge on #000.
export const subtleBorder = `1px solid ${alpha("#FFFFFF", 0.08)}`

// Convenience accent helpers (callsites still own the ACCENT value via
// theme.palette.primary.main — these just standardize the alpha steps).
export const accentAlphas = {
  // Background tints, lightest → strongest.
  bgFaint: 0.04,
  bgSoft: 0.1,
  bgMedium: 0.14,
  // Borders + glow.
  borderSoft: 0.4,
  borderMedium: 0.55,
  // Gradient stops for hero cards.
  gradTop: 0.12,
  gradBottom: 0.04,
  // Shadows.
  glow: 0.22,
} as const

// Common text alphas on top of the #000 surface.
export const textAlphas = {
  // Primary heading already sits at full opacity (#FFFFFF).
  body: 0.85,
  muted: 0.55,
  faint: 0.45,
  ghost: 0.3,
} as const
