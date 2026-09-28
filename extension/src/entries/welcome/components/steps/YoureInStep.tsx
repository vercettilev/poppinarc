import { alpha, Box, Typography } from "@mui/material"
import { XIcon } from "~/components/icons"
import { CAP } from "~/config/edition"
import youreInGif from "~/assets/poppin-thuglife.gif"
import { POPPIN_LOGO_URI } from "~/assets/poppinLogoDataUri"

import { useCurrentUser } from "~/hooks/useCurrentUser"
/**
 * The LAST screen of onboarding V2 — the payoff, third cut.
 *
 * The second cut led with a picture: a mock tweet wearing the chip, then a
 * CTA, then footnote links. Verdict from live use: "çok kötü... screenshottan
 * daha kolay anlaşılır olabilir" — the picture made the reader STUDY when
 * the screen's one job is to make them GO. Lev's own sketch of the fix is
 * this screen: two big doors, no homework.
 *
 *   1. You're in!                          (the celebration)
 *   2. TRADE ON YOUR X FEED  →             (the hero door, X-bound)
 *   3. Or trade on any site  →             (CoinGecko / TradingView / Yahoo)
 *   4. or just start browsing              (the quiet exit)
 *
 * The three demo links keep their history: each was run through the real
 * matcher and then LOOKED at in a real browser before earning its place
 * (CoinMarketCap and Google Finance matched fine and were rejected on
 * sight — their own sidebars live in the exact corner our card claims).
 *
 *     coingecko.com/en/coins/dogwifhat  →  $WIF    (clean)
 *     tradingview.com/symbols/SOLUSD    →  SOL     score 28  (clean)
 *     finance.yahoo.com/quote/TSLA      →  TSLAx   score 32  (kept)
 */
const ALSO_ON = [
  {
    // Icon domain is the site, not the asset: coins have no favicon of
    // their own, and here the site IS the point. Apex domains on purpose —
    // measured, the www/subdomain hosts publish smaller favicons.
    iconDomain: "coingecko.com",
    site: "CoinGecko",
    url: "https://www.coingecko.com/en/coins/dogwifhat",
  },
  {
    iconDomain: "tradingview.com",
    site: "TradingView",
    url: "https://www.tradingview.com/symbols/SOLUSD/",
  },
  {
    iconDomain: "yahoo.com",
    site: "Yahoo Finance",
    url: "https://finance.yahoo.com/quote/TSLA/",
  },
]

/**
 * Google's favicon service serves a fixed ladder — 16, 32, 64, 128 — and
 * rounds anything else DOWN. Always ask for a real rung above render size.
 */
const faviconUrl = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

const FONT = "PoppinSans, sans-serif"

export function YoureInStep() {
  // Whose wallet: the sentence about money must be true for a wallet
  // account too, and "fees are on us" is not.
  const { data: me } = useCurrentUser()
  const external = me?.wallet_mode === "external"
  return (
    <Box sx={{ position: "relative", isolation: "isolate", maxWidth: 520, width: "100%", textAlign: "center", px: 3 }}>
      {/* Ambient energy — the soft brand bloom a title screen sits on,
          behind everything, static so reduced motion has nothing to strip. */}
      <Box
        aria-hidden="true"
        sx={{
          position: "absolute",
          top: -60,
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(620px, 130%)",
          height: 320,
          pointerEvents: "none",
          zIndex: -1,
          background:
            "radial-gradient(52% 55% at 50% 32%, rgba(104,198,255,.22), rgba(104,198,255,.05) 46%, transparent 72%)",
          filter: "blur(10px)",
        }}
      />
      {/* The thug-life ghost: the one screen that earns motion. Its solid
          brand-blue background plus the circle mask turns the square gif
          into the same blue disc every other screen wears.

          A GIF cannot be paused by the CSS reduced-motion blanket (the
          chip makes the same argument for its JS animations), so a reader
          who asked their OS for stillness gets the wordmark disc instead -
          "no matchMedia reads as reduced", the chip's own rule. */}
      {typeof matchMedia === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches ? (
        <Box
          component="img"
          src={youreInGif}
          alt=""
          sx={{
            width: 120, height: 120, mb: 2.5, borderRadius: "50%",
            animation: "youre-pop 520ms cubic-bezier(.2,1.35,.35,1) both",
          }}
        />
      ) : (
        <Box
          component="img"
          src={POPPIN_LOGO_URI}
          alt=""
          sx={{
            width: 120,
            height: 120,
            mb: 2.5,
            borderRadius: "50%",
            objectFit: "cover",
            animation: "youre-pop 520ms cubic-bezier(.2,1.35,.35,1) both",
          }}
        />
      )}

      {/* Box, NOT Typography, for the headline: the theme pins
          MuiTypography-body1 through @container queries that outrank sx. */}
      <Box
        component="h1"
        sx={{
          fontSize: "44px",
          fontWeight: 800,
          color: "#FFFFFF",
          m: 0,
          mb: 3,
          lineHeight: 1.02,
          letterSpacing: "-0.03em",
          fontFamily: FONT,
          animation: "youre-rise 480ms cubic-bezier(.16,1,.3,1) .1s both",
        }}
      >
        You&apos;re in!
      </Box>

      {/*
        THE PRODUCT NAMES ITS OWN MONEY, once, before a refusal has to.
        Onboarding never said the word: the first time a reader met "USDC"
        was inside "Deposit USDC" on a Buy they had just been denied. One
        short line, and it carries the gasless promise too — which is true
        on every money path now that the terminal swap tops up from the gas
        tank like the rest.
      */}
      <Typography
        sx={{
          fontSize: "14px",
          fontWeight: 600,
          color: alpha("#FFFFFF", 0.5),
          fontFamily: FONT,
          mt: -1.5,
          mb: 3,
          animation: "youre-rise 440ms cubic-bezier(.16,1,.3,1) .16s both",
        }}
      >
        {external
          ? "You trade from your own wallet, in USDC. Fees are yours, as always."
          : !CAP.feeLines
            ? "Your balance is USDC."
            : "Your balance is USDC. Network fees are on us."}
      </Typography>

      {/* ── THE HERO DOOR ─────────────────────────────────────────────
          One big filled card that says where the product is best and
          why in one breath. It is a door, not a description: the whole
          card presses. */}
      <Box
        component="button"
        onClick={() => {
          window.location.href = "https://x.com/home"
        }}
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 2,
          textAlign: "left",
          px: 3,
          py: 2.5,
          mb: 1.5,
          borderRadius: "18px",
          border: 0,
          cursor: "pointer",
          background: "linear-gradient(180deg, #8AD4FF, #5EC1FF)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,.35), 0 8px 28px -8px rgba(104,198,255,.65)",
          transition: "filter 160ms ease-out, transform 80ms ease",
          "&:hover": { filter: "brightness(1.05)" },
          "&:active": { transform: "scale(.985)" },
          position: "relative",
          overflow: "hidden",
          animation: "youre-rise 520ms cubic-bezier(.16,1,.3,1) .2s both",
          // One light sweep as it lands, then still. A looping shimmer is
          // the AI-generated tell we are avoiding.
          "&::after": {
            content: '""',
            position: "absolute",
            top: 0,
            left: "-70%",
            width: "45%",
            height: "100%",
            background:
              "linear-gradient(105deg, transparent, rgba(255,255,255,.5), transparent)",
            transform: "skewX(-18deg)",
            animation: "youre-shine 620ms ease-out .7s both",
            pointerEvents: "none",
          },
        }}
      >
        <Box
          sx={{
            width: 46,
            height: 46,
            borderRadius: "14px",
            backgroundColor: "rgba(6,32,46,.14)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <XIcon sx={{ fontSize: 22, color: "#06202e" }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontSize: "18px",
              fontWeight: 800,
              color: "#06202e",
              fontFamily: FONT,
              lineHeight: 1.2,
            }}
          >
            Trade on your X feed
          </Typography>
        </Box>
        <Box
          component="span"
          sx={{ fontSize: "22px", color: "#06202e", flexShrink: 0 }}
        >
          →
        </Box>
      </Box>

      {/*
        THE GUARANTEED FIRST CHIP.

        The door above says "your X feed" and must keep meaning it - so the
        destination does not change. But whether a chip appears in the first
        screenful depends entirely on the reader's own timeline carrying a
        tweet the matcher admits, and the promise one line above is written
        as a certainty. Somebody who follows nobody in crypto lands on a
        feed with nothing lit and concludes it does not work.
        
        So the certainty gets a place to be true: a live cashtag timeline,
        every tweet on it about the same asset, one tap away. Outside the
        hero button because a button cannot contain another button.
      */}
      <Typography
        sx={{
          fontSize: "13px",
          fontWeight: 600,
          color: alpha("#FFFFFF", 0.55),
          fontFamily: FONT,
          mb: 2.5,
          textAlign: "center",
          animation: "youre-rise 420ms cubic-bezier(.16,1,.3,1) .3s both",
        }}
      >
        Tweets with a cashtag carry a live chip. See it on{" "}
        <Box
          component="a"
          href="https://x.com/search?q=%24SOL&f=live"
          sx={{
            color: "#5EC1FF",
            fontWeight: 800,
            textDecoration: "none",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          $SOL
        </Box>
      </Typography>

      {/* ── THE OTHER DOOR ────────────────────────────────────────────
          Same shape, quiet clothes: the alternative reads as a peer
          choice, not a footnote — Lev's sketch says it in one line:
          "or trade on any site", and the three names ARE the buttons. */}
      <Box
        sx={{
          width: "100%",
          textAlign: "center",
          px: 3,
          py: 2.25,
          mb: 3,
          borderRadius: "18px",
          backgroundColor: "rgba(255,255,255,.045)",
          border: "1px solid rgba(255,255,255,.09)",
          animation: "youre-rise 480ms cubic-bezier(.16,1,.3,1) .36s both",
        }}
      >
        <Typography
          sx={{
            fontSize: "15px",
            fontWeight: 700,
            color: "#FFFFFF",
            fontFamily: FONT,
            mb: 1.5,
          }}
        >
          Or trade on any site
        </Typography>
        {/* Three peers, stacked and centred — a short menu, not a wrapping
            tag cloud. Each is a full-width row so the eye reads them as
            equal choices, with the site's own mark leading. */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "stretch" }}>
          {ALSO_ON.map((d, i) => (
            <Box
              key={d.site}
              onClick={() => {
                // Same tab: this tab has done its job.
                window.location.href = d.url
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                px: 2,
                py: 1.25,
                borderRadius: "14px",
                cursor: "pointer",
                backgroundColor: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.12)",
                transition:
                  "background-color 160ms ease-out, border-color 160ms ease-out",
                animation: `youre-rise 440ms cubic-bezier(.16,1,.3,1) ${0.44 + i * 0.06}s both`,
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,.1)",
                  borderColor: "rgba(255,255,255,.25)",
                },
              }}
            >
              <Box
                component="img"
                src={faviconUrl(d.iconDomain)}
                alt=""
                sx={{ width: 22, height: 22, borderRadius: "6px" }}
              />
              <Typography
                sx={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "rgba(255,255,255,.85)",
                  fontFamily: FONT,
                  whiteSpace: "nowrap",
                }}
              >
                {d.site}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Typography
        onClick={() => window.close()}
        sx={{
          fontSize: "13px",
          fontWeight: 400,
          color: "rgba(255,255,255,.4)",
          cursor: "pointer",
          fontFamily: FONT,
          "&:hover": { color: "rgba(255,255,255,.75)" },
        }}
      >
        or just start browsing
      </Typography>
    </Box>
  )
}
