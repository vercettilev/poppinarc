import { WIF_LOGO_URI } from "~/assets/wifLogoDataUri"
import { ARC_EDITION } from "~/config/edition"
import { Box } from "@mui/material"

/**
 * THE CHIP, EXACTLY AS THE PRODUCT DRAWS IT, under a tweet that never said
 * a cashtag.
 *
 * Every earlier onboarding described the chip; none of them showed it, and
 * the one mockup that tried drew a chip of its own with different shapes
 * and colours. A person who has just installed should meet the real thing
 * before they meet it on X, so the rules below are transcribed from
 * xStrip.ts (the .row / .lead / .end anatomy, the 24px disc, the sym/px
 * pair, the wash-not-fill keys) rather than approximated.
 *
 * THE TWEET SAYS "dogwifhat", NOT "$WIF". The matcher resolves names,
 * handles and cashtags, and a demo that only ever showed a $-prefixed
 * ticker would teach people the product is a cashtag detector. The chip
 * appearing under a plain mention is the whole point, made in one glance
 * with no sentence spent on it.
 *
 * Static on purpose: no price ticking, no cursor. A demo that animates
 * reads as a video; a chip that simply sits there reads as the product.
 */
const FONT = "PoppinSans, -apple-system, 'Segoe UI', Roboto, sans-serif"
const TWEET_FONT = "TwitterChirp, -apple-system, 'Segoe UI', Roboto, sans-serif"

const Key = ({ tone, children }: { tone: "buy" | "sell"; children: string }) => (
  <Box
    component="span"
    sx={{
      fontFamily: FONT,
      fontSize: 14,
      fontWeight: 700,
      lineHeight: "16px",
      letterSpacing: "-.01em",
      padding: "7px 15px",
      borderRadius: "999px",
      flexShrink: 0,
      background: tone === "buy" ? "rgba(74,222,128,.10)" : "rgba(255,122,112,.08)",
      color: tone === "buy" ? "#5BE58F" : "#FF7A70",
    }}
  >
    {children}
  </Box>
)

const Disc = ({ children }: { children: React.ReactNode }) => (
  <Box
    component="span"
    sx={{
      display: "grid",
      placeItems: "center",
      width: 30,
      height: 30,
      borderRadius: "50%",
      color: "#8CA3BD",
      background: "rgba(122,183,255,.06)",
      boxShadow: "inset 0 0 0 1px rgba(122,183,255,.14)",
      flexShrink: 0,
      "& svg": { width: 15, height: 15, display: "block" },
    }}
  >
    {children}
  </Box>
)

/** WIF's own face, baked in (assets/wifLogoDataUri.ts): the first screen waits on nothing. */
/**
 * THE ARC EDITION SHOWS EUROS, a plan rather than a punt: a person putting
 * money aside for a trip, and the chip under it buying Circle's euro (EURC)
 * in one tap. $EUR resolves to EURC on arc-api's by-ticker lane, so this is
 * the chip the reader will really meet. Drawn, not fetched: the welcome page
 * loads no remote images, the same reason the WIF face is a data URI.
 */
const DEMO = ARC_EDITION
  ? {
      name: "maya",
      handle: "@mayalaurent \u00B7 1h",
      avatar: "linear-gradient(140deg,#E0A6C8,#7A4C9A)",
      text: "Lisbon in June. Putting a little $EUR aside for it.",
      ticker: "EUR",
      price: "$1.1368",
      change: "+0.2%",
    }
  : {
      name: "ada",
      handle: "@adatrades \u00B7 2m",
      avatar: "linear-gradient(135deg,#5B8CFF,#9B5BFF)",
      text: "dogwifhat is waking up again, volume doubled in an hour. finger on the button",
      ticker: "WIF",
      price: "$0.1778",
      change: "+6.2%",
    }

const ChipIcon = () =>
  ARC_EDITION ? (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        display: "grid",
        placeItems: "center",
        width: 24,
        height: 24,
        borderRadius: "50%",
        flexShrink: 0,
        background: "linear-gradient(140deg,#5D8BF4,#1F4FC8)",
        color: "#fff",
        fontFamily: FONT,
        fontSize: 13,
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {"\u20AC"}
    </Box>
  ) : (
    <Box
      component="img"
      src={WIF_LOGO_URI}
      alt=""
      sx={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "block", objectFit: "cover" }}
    />
  )

export const ChipDemo = () => (
  <Box
    sx={{
      width: "100%",
      maxWidth: 470,
      mx: "auto",
      textAlign: "left",
      background: "#000",
      border: "1px solid #2f3336",
      borderRadius: "16px",
      padding: "14px 16px 12px",
      fontFamily: TWEET_FONT,
      animation: "youre-rise 440ms cubic-bezier(.16,1,.3,1) .12s both",
    }}
  >
    <Box sx={{ display: "flex", gap: 1.25, alignItems: "center", mb: 0.75 }}>
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: DEMO.avatar,
          flexShrink: 0,
        }}
      />
      <Box>
        <Box sx={{ fontWeight: 700, fontSize: 15, color: "#e7e9ea" }}>{DEMO.name}</Box>
        <Box sx={{ color: "#71767b", fontSize: 14 }}>{DEMO.handle}</Box>
      </Box>
    </Box>
    <Box sx={{ fontSize: 15, lineHeight: 1.5, color: "#e7e9ea" }}>
      {/* A cashtag is X's link blue, as the reader will see it on X. */}
      {DEMO.text.split(/(\$[A-Z]{2,6}\b)/).map((part, i) =>
        i % 2 === 1 ? (
          <Box key={i} component="span" sx={{ color: "#1d9bf0" }}>
            {part}
          </Box>
        ) : (
          part
        ),
      )}
    </Box>

    {/* .chip > .row: the transcription starts here. */}
    <Box
      sx={{
        mt: "10px",
        display: "flex",
        alignItems: "center",
        height: 38,
        animation: "chip-pop 550ms cubic-bezier(.2,.8,.2,1) .5s both",
        "@keyframes chip-pop": {
          "0%": { opacity: 0, transform: "translateY(8px) scale(.94)" },
          "60%": { transform: "translateY(-2px) scale(1.02)" },
          "100%": { opacity: 1, transform: "none" },
        },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      {/* .lead */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          borderRadius: "999px",
          background: "rgba(122,183,255,.06)",
          boxShadow: "inset 0 0 0 1px rgba(122,183,255,.16)",
        }}
      >
        {/* .face */}
        <Box sx={{ display: "flex", alignItems: "center", gap: "7px", padding: "5px 4px 5px 6px" }}>
          <ChipIcon />
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1, gap: "1px" }}>
            <Box component="span" sx={{ fontFamily: FONT, fontWeight: 700, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "#74849A" }}>
              {DEMO.ticker}
            </Box>
            <Box component="span" sx={{ fontFamily: FONT, fontSize: 15, letterSpacing: "-.01em", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#EAF2FB" }}>
              {DEMO.price}
            </Box>
          </Box>
          <Box component="span" sx={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#4ADE80", ml: "2px" }}>
            {DEMO.change}
          </Box>
        </Box>
        {/* .more */}
        <Box
          component="span"
          sx={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: "0 999px 999px 0", color: "rgba(116,132,154,.75)" }}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Box>
      </Box>
      {/* .end */}
      <Box sx={{ display: "flex", alignItems: "center", gap: "7px", pl: "10px", flexShrink: 0 }}>
        <Disc>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10 21a2 2 0 0 0 4 0" />
          </svg>
        </Disc>
        <Disc>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="13" rx="2" />
            <path d="M16 12h5M3 10h18" />
          </svg>
        </Disc>
        <Key tone="buy">Buy</Key>
        <Key tone="sell">Sell</Key>
      </Box>
    </Box>
  </Box>
)
