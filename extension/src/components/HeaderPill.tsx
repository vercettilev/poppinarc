import { JUICE } from "~/theme/juice"
import { Box, BoxProps, Typography, TypographyProps } from "@mui/material"
import React, { useEffect, useState } from "react"
import { siteFaviconUrl } from "~/helpers/siteMark"

/**
 * The single visual contract for every "header label" pill in the app —
 * the small rounded chip that sits at the top of a screen and tells the
 * user where they are (e.g. "Tasks", the current URL).
 *
 * THE SURFACE, NAMED BY ITS TOKENS: `JUICE.well` over a one-pixel
 * `JUICE.border` hairline, pill-shaped at borderRadius 40, padded 4px×10px.
 * Both tokens are blue-cast, which is juice rule "grays are blue" — the
 * header of this file used to describe a white-alpha gradient borrowed from
 * a wallet-ui chain pill, spelling the colours out inline to do it. Neither
 * the gradient nor those literals have been in the code below for a long
 * time; the tokens are, so the tokens are what this says.
 *
 * Why centralize this instead of letting each view roll its own:
 *   1. Cross-screen navigation looked janky because the Tasks pill, the
 *      Notifications pill, the Leaderboard pill etc. each had subtly
 *      different heights / padding / borders. With a single source the
 *      header always sits at the same y-coordinate as you switch tabs.
 *   2. Several screens still used solid lighten() borders, each a slightly
 *      different mix. One named token closes that drift by construction.
 *
 * `HeaderPill` is the container (Box). `HeaderPillText` matches the
 * canonical typography. Compose them — most usages need an icon too,
 * which goes as a child Box with `display: flex; align-items: center`.
 */
export interface HeaderPillProps extends Omit<BoxProps, "children"> {
  children: React.ReactNode
  /**
   * Optional override for the inner background color. Defaults to `JUICE.well`
   * — read the default off the signature below rather than restating it here,
   * which is how this doc came to name a colour the component had stopped
   * painting. Override only when the screen lives on a non-standard surface:
   * nothing does, and the two call sites that did painted opaque #000 holes in
   * a lit canvas, which components/header-pill-surface.spec.ts now sweeps for.
   */
  bg?: string
}

export const HeaderPill = React.forwardRef<HTMLDivElement, HeaderPillProps>(
  ({ children, sx, bg = JUICE.well, ...props }, ref) => {
    return (
      <Box
        ref={ref}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          border: `1px solid ${JUICE.border}`,
          background: `${bg}`,
          borderRadius: 40,
          color: "#FFFFFF",
          fontFamily: "PoppinSans",
          lineHeight: 1.5,
          fontSize: "12px",
          fontWeight: 300,
          /**
           * 13/3, AND THESE ARE THE CANONICAL NUMBERS BECAUSE THE CALL SITES
           * ALREADY AGREED ON THEM.
           *
           * The default was 10/4, and BOTH pills a reader can actually reach
           * overrode it. The feed's label and the Tasks title each passed
           * paddingLeft/Right 13px at their call site without saying why, and
           * the feed also trimmed paddingY to 3px on the owner's instruction
           * ("cok az ust alttan esit sekilde"). So the shared contract was
           * the one shape nothing on screen wore — and the two that did wear
           * something still disagreed with each other, 26px against 30px,
           * because Tasks put a 20px bell inside an 18px line box. (Two further call
           * sites, PageInfoBar and PageTitle, would have been a third and a
           * fourth height the day anyone mounted them. Neither ever was —
           * both have since been deleted as dead code.) That is the drift the
           * header of this file says the component exists to prevent,
           * arriving through the override door rather than by copy-paste.
           *
           * Moving the agreement into the default and deleting the overrides
           * makes every header label 1 + 3 + 18 + 3 + 1 = 26px tall — the
           * 18px is HeaderPillText's line box, 12px at line-height 1.5 below
           * — so the label does not jump as the reader crosses screens.
           * Anything that overrides these again is reopening the drift; there
           * is a spec (components/header-pill-one-height.spec.ts) that says
           * so.
           */
          paddingLeft: "13px",
          paddingRight: "13px",
          paddingY: "3px",
          ...sx,
        }}
        {...props}
      >
        {children}
      </Box>
    )
  },
)
HeaderPill.displayName = "HeaderPill"

export const HeaderPillText = React.forwardRef<
  HTMLSpanElement,
  Omit<TypographyProps, "children"> & { children: React.ReactNode }
>(({ children, sx, ...props }, ref) => {
  return (
    <Typography
      ref={ref}
      sx={{
        fontSize: "12px",
        fontWeight: 500,
        lineHeight: 1.5,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...sx,
      }}
      {...props}
    >
      {children}
    </Typography>
  )
})
HeaderPillText.displayName = "HeaderPillText"

/**
 * THE SITE'S OWN MARK, IN FRONT OF ITS NAME.
 *
 * A pill that names a page or a whole site leads with that site's favicon,
 * round — the same identification components/Post/WebsiteFavicon.tsx has
 * always given a post in the feed. The rule for WHERE the icon comes from is
 * shared rather than copied: helpers/siteMark's `siteFaviconUrl`, including
 * its poppin.so special case.
 *
 * WHAT THIS DELIBERATELY IS NOT IS WebsiteFavicon. That component is a
 * CONTROL: it carries a click handler that either moves the tab or opens the
 * leaving-warning dialog (WebsiteFavicon.tsx:95-149), a Tooltip, and a hover
 * brightness. Under a post the mark is the only thing pointing at the origin,
 * so all of that is earned. In a header label the mark sits one 6px gap from
 * the site's name in plain readable text, so a second, clickable copy of that
 * name would be a control nobody asked for on a row whose whole job is to say
 * quietly where you are. No pointer, no tooltip, no hover: the mark is
 * decoration for a label, which is why it is also `alt=""`.
 *
 * IT DIVERGES ON FAILURE TOO, on purpose. WebsiteFavicon falls back to the
 * domain's first letter in a disc (WebsiteFavicon.tsx:186-196) — right when
 * the mark is the only identifier. Here the full name is already printed
 * beside it, so a letter would be the same information twice. A favicon that
 * will not load takes the WHOLE element with it: no box, no letter, no
 * reserved gap, and the label reads exactly as it did before there was a
 * mark. A broken-image square inside a header pill is worse than no mark.
 *
 * SIZE IS CAPPED BY THE LINE BOX, NOT BY TASTE. HeaderPillText is 12px at
 * line-height 1.5 (above) — an 18px line box, and that is what sets a pill's
 * height. 16px sits inside it and costs the pill nothing. A mark above 18px
 * would BECOME the pill's height, and every row whose arithmetic is measured
 * against that pill would grow with it.
 */
export interface HeaderPillFaviconProps {
  /** The page or site the pill is naming. Anything unparseable renders nothing. */
  url: string
  /** Rendered px. Keep at or under the 18px line box — see above. */
  size?: number
  /**
   * poppin.so's own logo. Passed in rather than imported, exactly as
   * `siteFaviconUrl` takes it, so a bundle that never names a Poppin URL
   * never pulls the asset through its build path.
   */
  logo?: string
}

export const HeaderPillFavicon = ({
  url,
  size = 16,
  logo,
}: HeaderPillFaviconProps) => {
  /**
   * Asked for at 2× so the mark is not soft on a retina panel; siteFaviconUrl
   * clamps what it forwards to Google's service (siteMark.ts:39).
   */
  const src = siteFaviconUrl(url, size * 2, logo)
  const [failed, setFailed] = useState(false)

  /**
   * A new page is a new mark. Without this reset one dead favicon would
   * suppress the mark for every site the reader visited afterwards, because
   * `failed` outlives the URL that set it.
   */
  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) return null

  return (
    <Box
      component="img"
      src={src}
      alt=""
      onError={() => setFailed(true)}
      sx={{
        width: `${size}px`,
        height: `${size}px`,
        /**
         * A fixed width does not stop a flex item shrinking, and a squeezed
         * circle is an ellipse. The label beside it is the elastic half.
         */
        flexShrink: 0,
        borderRadius: "50%",
        /**
         * The disc behind the mark. Favicons ship dark ink on a transparent
         * ground often enough that WebsiteFavicon carries the same fill
         * (WebsiteFavicon.tsx:172); without it those sites read as a hole in
         * the pill rather than as their logo.
         */
        backgroundColor: JUICE.wellSolid,
        objectFit: "contain",
        display: "block",
      }}
    />
  )
}
HeaderPillFavicon.displayName = "HeaderPillFavicon"
