import { BRAND_GROUND } from "~/helpers/brandGround"
import { Box, IconButton } from "@mui/material"
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew"
import { ReactNode } from "react"

/**
 * Shared chrome for every post-profile onboarding step. Faithful to the
 * VC-demo mock's design language:
 *   - radial near-black background (#0D0F15 → #070709) so the canvas reads
 *     darker towards the edges
 *   - TWO ambient blue auroras bleeding in from opposite edges (suggests
 *     light coming from BEHIND the card) — stronger than a single one so
 *     a wide screen (1440–2540 px) doesn't read as a sea of dead black
 *     around a tiny centred card
 *   - frosted-glass container: backdrop-blur, near-transparent white at
 *     ~3%, ~30px corner radius. Width follows `clamp(680px, 62vw, 1080px)`
 *     on glass cards so the card scales with the viewport on big monitors
 *     instead of looking lost in the middle of a 2500-px canvas.
 *   - gradient hairline border: brighter at the top, fading to
 *     near-transparent at the bottom (overhead-light illusion)
 *   - soft outer blue glow around the card edges
 *   - portrait `variant="portrait"` switches to a narrower card with a
 *     flatter dark surface (Notifications + Kalshi-connect screens which
 *     the mock renders without the glass treatment)
 *
 * The shell powers BOTH the post-profile onboarding screens AND the
 * /create-profile screen.
 *
 * Pass `onBack` to render a small chevron at the top-left of the card.
 * Steps that have no meaningful previous (Intro, CreateProfile) should
 * leave it undefined.
 */
export const OnboardingShell = ({
  step,
  totalSteps = 5,
  children,
  footer,
  maxWidth,
  variant = "glass",
  onBack,
}: {
  step?: number
  totalSteps?: number
  children: ReactNode
  footer?: ReactNode
  maxWidth?: number
  variant?: "glass" | "portrait"
  onBack?: () => void
}) => {
  const isPortrait = variant === "portrait"
  // Defaults: portrait cards stay compact (single button column, short
  // copy); glass cards breathe wider with a responsive ceiling via the
  // `clamp()` so they scale with the viewport on big monitors.
  const effectiveMaxWidth = maxWidth ?? (isPortrait ? 560 : 880)
  const glassResponsiveWidth = "clamp(680px, 62vw, 1080px)"

  return (
    <Box
      sx={{
        minHeight: "100vh",
        width: "100%",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        py: { xs: 3, sm: 6 },
        px: { xs: 2, sm: 3 },
        // The card's ground, from the one shared source — an older aurora
        // variant lived here before the panel/card/welcome unification.
        ...BRAND_GROUND,
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: isPortrait
            ? `${effectiveMaxWidth}px`
            : { xs: "100%", md: glassResponsiveWidth },
          position: "relative",
          borderRadius: { xs: "20px", sm: "30px" },
          backgroundColor: isPortrait
            ? "rgba(10, 12, 17, 0.85)"
            : "rgba(255, 255, 255, 0.025)",
          backdropFilter: isPortrait ? "none" : "blur(32px)",
          WebkitBackdropFilter: isPortrait ? "none" : "blur(32px)",
          p: { xs: 3, sm: 5 },
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          boxShadow: isPortrait
            ? "0 24px 60px rgba(0, 0, 0, 0.55)"
            : `
                0 0 0 1px rgba(255, 255, 255, 0.04),
                0 24px 60px rgba(0, 0, 0, 0.55),
                0 0 100px rgba(104, 198, 255, 0.12),
                0 0 200px rgba(104, 198, 255, 0.06)
              `,
          "&::before": isPortrait
            ? {
                content: '""',
                position: "absolute",
                inset: 0,
                borderRadius: "inherit",
                padding: "1px",
                background:
                  "linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.04) 100%)",
                WebkitMask:
                  "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
                WebkitMaskComposite: "xor",
                maskComposite: "exclude",
                pointerEvents: "none",
              }
            : {
                content: '""',
                position: "absolute",
                inset: 0,
                borderRadius: "inherit",
                padding: "1px",
                background: `linear-gradient(
                  180deg,
                  rgba(255, 255, 255, 0.20) 0%,
                  rgba(255, 255, 255, 0.10) 22%,
                  rgba(255, 255, 255, 0.04) 100%
                )`,
                WebkitMask:
                  "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
                WebkitMaskComposite: "xor",
                maskComposite: "exclude",
                pointerEvents: "none",
              },
        }}
      >
        {/* Back chevron — only rendered when the parent supplies onBack.
            Sits absolute so it doesn't push the content downward. */}
        {onBack && (
          <IconButton
            onClick={onBack}
            aria-label="Back"
            sx={{
              position: "absolute",
              top: { xs: 16, sm: 22 },
              left: { xs: 16, sm: 22 },
              width: 36,
              height: 36,
              color: "rgba(255, 255, 255, 0.7)",
              backgroundColor: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              transition: "all 0.18s ease",
              zIndex: 2,
              "&:hover": {
                color: "#FFFFFF",
                backgroundColor: "rgba(255, 255, 255, 0.08)",
                borderColor: "rgba(255, 255, 255, 0.16)",
              },
            }}
          >
            <ArrowBackIosNewIcon sx={{ fontSize: 14 }} />
          </IconButton>
        )}

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
          }}
        >
          {children}
        </Box>

        {footer && (
          <Box
            sx={{
              mt: { xs: 3, sm: 4 },
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 2,
            }}
          >
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  )
}
