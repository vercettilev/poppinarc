import { Box } from "@mui/material"
import { POPPIN_LOGO_URI } from "~/assets/poppinLogoDataUri"

/**
 * THE GHOST, MOVING: the mark a screen shows in place of the still logo when
 * something has just happened (it puts its glasses on at "You're in", it
 * pops into view at "Your first pop awaits"). Someone who asked their system
 * for less motion gets the still mark instead, the same choice YoureInStep
 * makes.
 */
export function GhostMark({ src }: { src: string }) {
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  return (
    <Box
      component="img"
      src={still ? POPPIN_LOGO_URI : src}
      alt=""
      sx={{
        width: 112,
        height: 112,
        borderRadius: "50%",
        objectFit: "cover",
        display: "block",
        boxShadow: "0 10px 34px -8px rgba(104,198,255,.55)",
        animation: "ghost-pop 520ms cubic-bezier(.2,1.35,.35,1) both",
        "@keyframes ghost-pop": { from: { opacity: 0, transform: "scale(.6)" }, to: { opacity: 1, transform: "none" } },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    />
  )
}
