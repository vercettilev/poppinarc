import { Box, IconButton, Typography } from "@mui/material"
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew"
import { ReactNode } from "react"

/**
 * The onboarding frame: FOMO's anatomy, re-proportioned for a browser tab.
 *
 * What we took from their screens:
 *   - ONE idea per screen: a title, one muted line, a single glowing hero,
 *     one decision. The empty space is the design.
 *   - A quiet text escape above the primary, never a second loud button.
 *   - No step dots. Progress is felt, not counted.
 *
 * What we DELIBERATELY did not take, and why — this is the whole reason the
 * first pass looked wrong:
 *
 *   NOT bottom-pinned. FOMO pins actions to the bottom because on a phone
 *   that is the thumb, and the column IS the screen. Ported literally to a
 *   2000px-wide tab it put the title at the top of the viewport and the
 *   button 800px below it, with two-thirds of the width empty on either
 *   side — a phone screenshot stranded in a monitor. So the block sizes to
 *   its content and CENTERS, both axes. Same reading order, same air,
 *   composed for the surface it actually renders on.
 *
 *   NOT left-aligned. Left-aligned display type is right when the column is
 *   the screen. In a centered 460px column inside a wide dark canvas it
 *   fought everything else: the hero centered, the trust line centered, the
 *   button full-width — four elements on three different axes. Everything
 *   is centered now, on one axis, including the mark.
 *
 * The welcome tab's root (App.tsx) paints the aurora background, so this
 * frame stays transparent. OnboardingShell still backs the legacy card
 * screens; anything on the FOMO anatomy mounts this instead.
 */
export const StepFrame = ({
  title,
  subtitle,
  onBack,
  children,
  hero,
  banner,
  note,
  actions,
  markInHero = false,
}: {
  title: string
  subtitle?: string
  /** Floats at the viewport's top-right, outside the centered column so it
   *  can never tug the composition off-axis. */
  onBack?: () => void
  /** Directly under the subtitle: forms, inputs. */
  children?: ReactNode
  /** The screen's single visual, in the middle, with room to breathe. */
  hero?: ReactNode
  /** Error/alert slot, just above the actions. */
  banner?: ReactNode
  /** One small muted line above the actions (trust copy). */
  note?: string
  /** Quiet secondary above, primary last. */
  actions?: ReactNode
  /**
   * Set when the HERO is the Poppin mark itself. The small mark at the top
   * exists to say whose screen this is on screens whose hero is something
   * else (the provider tiles on sign-in). When the hero is already the logo,
   * printing it twice is the same brand said twice, and the big one loses by
   * being the echo rather than the statement.
   */
  markInHero?: boolean
}) => (
  <Box
    sx={{
      minHeight: "100vh",
      width: "100%",
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      px: { xs: 3, sm: 4 },
      py: { xs: 5, sm: 7 },
      /**
       * ONE MOVEMENT, ONE TIMING - here too.
       *
       * The four onboarding screens are hard route swaps: the whole page
       * was replaced in a single frame while the chip two clicks later
       * preaches that nothing appears without arriving. This is the
       * product's first impression, and it was the one surface with no
       * motion vocabulary at all.
       *
       * The step now ASSEMBLES rather than fading in as one slab: the mark
       * pops, then the title, subtitle, body and actions rise in turn (the
       * youre-* beats in welcome.css, which its reduced-motion blanket
       * flattens to their resting state). The choreography is on the
       * children below, not on this frame, so nothing double-fades.
       */
    }}
  >
    {/* AMBIENT ENERGY. A game screen is never a flat wall; this is the soft
        brand-blue bloom every hypercasual title screen sits on. Static, so
        the reduced-motion blanket has nothing to strip - it just breathes
        colour into the ground. */}
    <Box
      aria-hidden="true"
      sx={{
        position: "absolute",
        top: "-10%",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(760px, 130%)",
        height: "60%",
        pointerEvents: "none",
        background:
          "radial-gradient(60% 60% at 50% 40%, rgba(104,198,255,.18), rgba(104,198,255,.05) 45%, transparent 72%)",
        filter: "blur(6px)",
      }}
    />
    {onBack && (
      <IconButton
        onClick={onBack}
        aria-label="Back"
        sx={{
          position: "absolute",
          top: { xs: 20, sm: 28 },
          right: { xs: 20, sm: 28 },
          width: 40,
          height: 40,
          color: "rgba(255,255,255,0.6)",
          "&:hover": { color: "#FFFFFF", backgroundColor: "rgba(255,255,255,0.06)" },
        }}
      >
        <ArrowBackIosNewIcon sx={{ fontSize: 16 }} />
      </IconButton>
    )}

    <Box
      sx={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        maxWidth: 460,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      {!markInHero && (
        <Box
          sx={{
            position: "relative",
            mb: { xs: 3, sm: 4 },
            // The mark lands with a spring - a title screen's logo arrives,
            // it does not just exist. Reduced motion (App/welcome.css) drops
            // the animation to nothing.
            animation: "welcome-logo-pop 460ms cubic-bezier(.2,1.3,.35,1)",
            "@keyframes welcome-logo-pop": {
              from: { opacity: 0, transform: "scale(.6)" },
              to: { opacity: 1, transform: "scale(1)" },
            },
          }}
        >
          {/* The glow the mark sits in - the disc reads as lit, not printed. */}
          <Box
            aria-hidden="true"
            sx={{
              position: "absolute",
              inset: -10,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(104,198,255,.55), transparent 68%)",
              filter: "blur(10px)",
            }}
          />
          <Box
            component="img"
            src="/icons/logo.png"
            alt=""
            sx={{
              position: "relative",
              width: 72,
              height: 72,
              borderRadius: "50%",
              display: "block",
              boxShadow: "0 8px 28px -6px rgba(104,198,255,.5)",
            }}
          />
        </Box>
      )}

      <Typography
        component="h1"
        sx={{
          color: "#FFFFFF",
          fontWeight: 800,
          fontSize: { xs: "36px", sm: "44px" },
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
          fontFamily: "PoppinSans, sans-serif",
          animation: "youre-rise 480ms cubic-bezier(.16,1,.3,1) .1s both",
        }}
      >
        {title}
      </Typography>

      {subtitle && (
        <Typography
          sx={{
            mt: 1.25,
            color: "rgba(255,255,255,0.55)",
            fontSize: "16px",
            lineHeight: 1.55,
            fontFamily: "PoppinSans, sans-serif",
            animation: "youre-rise 440ms cubic-bezier(.16,1,.3,1) .18s both",
          }}
        >
          {subtitle}
        </Typography>
      )}

      {children && (
        <Box
          sx={{
            width: "100%",
            mt: { xs: 3, sm: 4 },
            animation: "youre-rise 460ms cubic-bezier(.16,1,.3,1) .26s both",
          }}
        >
          {children}
        </Box>
      )}

      {/* The hero's margins ARE the vertical rhythm — the block has no
          stretch left to distribute now that it sizes to its content. */}
      {hero && (
        <Box
          sx={{
            my: { xs: 5, sm: 6 },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hero}
        </Box>
      )}

      {banner && <Box sx={{ width: "100%", mt: hero ? 0 : 4, mb: 2 }}>{banner}</Box>}

      {note && (
        <Typography
          sx={{
            mt: hero || banner ? 0 : 4,
            mb: 1.75,
            color: "rgba(255,255,255,0.4)",
            fontSize: "13px",
            lineHeight: 1.5,
            fontFamily: "PoppinSans, sans-serif",
          }}
        >
          {note}
        </Typography>
      )}

      {actions && (
        <Box
          sx={{
            width: "100%",
            mt: hero || banner || note ? 0 : 4,
            display: "flex",
            flexDirection: "column",
            gap: 1.25,
            animation: "youre-rise 460ms cubic-bezier(.16,1,.3,1) .34s both",
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  </Box>
)

/** FOMO's quiet escape: plain text, above the primary. */
export const QuietAction = ({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) => (
  <Box
    component="button"
    type="button"
    onClick={onClick}
    disabled={disabled}
    sx={{
      background: "none",
      border: 0,
      p: 1,
      cursor: "pointer",
      color: "rgba(255,255,255,0.55)",
      fontSize: "15px",
      fontWeight: 600,
      fontFamily: "PoppinSans, sans-serif",
      textAlign: "center",
      "&:hover": { color: "#FFFFFF" },
      "&:disabled": { color: "rgba(255,255,255,0.25)", cursor: "default" },
    }}
  >
    {label}
  </Box>
)
