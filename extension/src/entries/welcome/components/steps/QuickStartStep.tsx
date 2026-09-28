import { Alert, Box, Button } from "@mui/material"
import { useState } from "react"
import { useNavigate } from "react-router"
import welcomeHero from "~/assets/poppinwelcome.png"
import { requestPermissions } from "~/helpers/permissionHelper"
import { StepFrame } from "../StepFrame"

/**
 * Onboarding V2's install screen — and ONLY the install screen. One job:
 * welcome + the required permission. Granting flows straight into sign-in,
 * and the celebration lives at the END of the flow in YoureInStep.
 * An already-granted profile never sees this screen at all (App.tsx routes
 * straight to /signup).
 *
 * FOMO anatomy (StepFrame): title, ONE muted line, the smiling mark in the
 * middle with a glow, one button. An earlier pass stacked five blocks of
 * copy on a card and read as a form rather than a welcome; what survived is
 * three lines and a face.
 *
 *   subtitle  the whole pitch, three words
 *   note      what the permission actually does, above the ask it explains
 *   button    the ask itself, in the same words Chrome's dialog will use
 *
 * THE NOTE USED TO SAY "Zero tracking. Not even we know where you browse."
 * That was false, and not in a gray-area way. attachSpotCard.harvest() sends
 * the full url, title, h1, meta description and 20,000 characters of body
 * text to /embed/asset/match on every page over 400 chars; axios.ts attaches
 * the reader's Firebase ID token when they are signed in; joinChatRoom
 * streams the hostname over a websocket besides. The servers know where you
 * browse by NECESSITY — the product cannot match a market to a page without
 * reading the page. A privacy claim the code contradicts is a Chrome Web
 * Store user-data-policy problem before it is a copy problem, so the line
 * now states what happens instead of denying it.
 *
 * WHAT THE CURRENT LINE RESTS ON, both halves checked in code:
 *   never store   AssetMatchController.match is stateless — findAssetForPage
 *                 is a pure function over CURATED_CATALOG, no DB write, no
 *                 payload logging. Sentry runs sendDefaultPii:false with a
 *                 beforeSend that scrubs request.data.
 *   never tie     lib/axios.ts used to attach a Firebase bearer token to
 *                 /embed/asset/match, making every page read a named-account
 *                 event. Those routes now bypass identity entirely.
 *
 * STILL UNVERIFIED, and the one thing that could falsify the first half:
 * request-body logging at the proxy/APM layer (Railway, Cloudflare). Access
 * logs normally record the URL and not the body, but nobody has confirmed it
 * for this deployment. Confirm before this line goes anywhere with more
 * weight than an onboarding screen — a privacy policy, a store listing.
 *
 * Do NOT promise encryption. The server has to read the text to score
 * keywords against the catalog, so it has to be able to decrypt it; that
 * claim would protect a stolen disk and nothing a reader actually fears.
 *
 * The claim that WOULD be unimpeachable is on-device matching: CURATED_CATALOG
 * is 134 assets / 76KB and findAssetForPage already lives in shared
 * @repo/spot-core, so the page need never leave the browser at all.
 *
 * The sign-in journey from the card does NOT pass through here: the card's
 * "Sign in to trade" opens the welcome tab at ?flow=signin, which routes
 * straight to the sign-in flow.
 */

const welcomeHeroUrl = new URL(welcomeHero, import.meta.url).href

export function QuickStartStep() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const grant = async () => {
    setBusy(true)
    setError(null)
    try {
      const ok = await requestPermissions()
      if (ok) navigate("/signup")
      else setError("Permission was declined. Poppin can't appear on pages without it.")
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepFrame
      markInHero
      title="Welcome to Poppin"
      subtitle="Trade the internet."
      hero={
        /* The welcoming face, doing the talking the paragraphs used to do.
           Soft blue bloom behind it, a slight tilt so it reads as a
           character, not an app icon. */
        <Box sx={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Box
            sx={{
              position: "absolute",
              width: 320,
              height: 320,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(104,198,255,0.28) 0%, rgba(104,198,255,0) 65%)",
            }}
          />
          <Box
            component="img"
            src={welcomeHeroUrl}
            alt=""
            sx={{
              position: "relative",
              width: 176,
              height: 176,
              borderRadius: "50%",
              transform: "rotate(-6deg)",
            }}
          />
        </Box>
      }
      banner={
        error && (
          <Alert
            severity="error"
            sx={{
              borderRadius: 2,
              backgroundColor: "rgba(211, 47, 47, 0.1)",
              color: "#ffcdd2",
              "& .MuiAlert-icon": { color: "#FF453A" },
            }}
          >
            {error}
          </Alert>
        )
      }
      // Positive form, per the product's own copy law (no "we never..."
      // frames), and it claims only what the code above verifies: the match
      // is stateless and the read carries no identity. The strong denial
      // waits for the proxy-layer confirmation the comment block demands.
      note="Pages are matched to markets in the moment, with no name attached."
      actions={
        <Button
          variant="contained"
          disabled={busy}
          sx={{
            width: "100%",
            height: 52,
            backgroundColor: "#68C6FF",
            color: "#001018",
            textTransform: "none",
            fontWeight: 700,
            fontSize: "16px",
            fontFamily: "PoppinSans, sans-serif",
            borderRadius: "14px",
            "&:hover": { backgroundColor: "#5AB8F5" },
            "&:disabled": {
              backgroundColor: "rgba(104,198,255,0.25)",
              color: "rgba(255,255,255,0.5)",
            },
          }}
          onClick={() => void grant()}
        >
          {busy ? "Asking…" : "Enable on all sites"}
        </Button>
      }
    />
  )
}
