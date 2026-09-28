import { Alert, alpha, Box, Button, Typography } from "@mui/material"
import { useState } from "react"
import { requestPermissions } from "~/helpers/permissionHelper"
import { LogoBlackIcon } from "../icons"
import { StepProps } from "../types"


// Brand blue used across the new onboarding. Re-defined locally so this
// step doesn't depend on theme.palette.primary (which an organisation
// override could repaint to a light color and break the dark canvas).
const BRAND_BLUE = "#68C6FF"

export const PermissionsStep: React.FC<StepProps> = ({ onNext }) => {

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRequestPermissions = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const result = await requestPermissions()

      if (result) {
        // Trigger content script injection after permissions are granted
        try {
          chrome.runtime.sendMessage({ type: "INJECT_CONTENT_SCRIPTS" })
        } catch (err) {
          console.error("Failed to inject content scripts", err)
          // Don't set error here as this is not critical for the flow
        }

        onNext()
      } else {
        setError("Please allow permissions to continue using Poppin")
      }
    } catch (err) {
      setError("Failed to request permissions. Please try again.")
      console.error("Permission request failed", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box
      sx={{
        backgroundColor: "#FFFFFF05",
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "auto",
        minHeight: "400px",
        width: "100%",
        maxWidth: "500px",
        mx: "auto",
        p: 4,
      }}
    >
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              backgroundColor: BRAND_BLUE,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mb: 3, // 24px gap between logo and title
              boxShadow: `0 12px 32px ${alpha(BRAND_BLUE, 0.35)}`,
            }}
          >
            <LogoBlackIcon width={40} height={40} />
          </Box>

          <Typography
            variant="h4"
            component="h1"
            sx={{
              color: "white",
              fontWeight: 700,
              fontSize: { xs: "24px", sm: "28px", md: "30px" },
              mb: 6, // 48px gap between title and description
              textAlign: "center",
            }}
          >
            Trade on what you're reading.
          </Typography>

          <Typography
            sx={{
              color: "#ADADAD",
              fontSize: "24px",
              lineHeight: 1.5,
              fontWeight: 400,
              mb: 9, // 72px gap between description and button
              textAlign: "center",
            }}
          >
          {/* V2 copy. "See the odds, take a side" was the prediction era's
              promise, and predictions left the product — a first screen must
              not describe a feature that does not exist. The same rule
              retired "join the conversation": site chat is switched off in
              production (its presence route answers "Cannot POST this
              route"), so the middle of three promises named the one thing a
              new reader could not do. */}
          Read the page, trade the asset, without leaving it.

          </Typography>

          {error && (
            <Alert severity="error" sx={{ width: "100%", mb: 2 }}>
              {error}
            </Alert>
          )}

          <Button
            variant="contained"
            fullWidth
            onClick={handleRequestPermissions}
            disabled={loading}
            sx={{
              borderRadius: "18px",
              py: 2,
              fontSize: { xs: "12px", sm: "13px", md: "14px" },
              fontWeight: 700,
              backgroundColor: BRAND_BLUE,
              color: "#001018 !important",
              textTransform: "none",
              mb: 3,
              boxShadow: `0 12px 32px ${alpha(BRAND_BLUE, 0.35)}`,
              "&:hover": {
                backgroundColor: "#5AB8F5",
              },
            }}
          >
            {loading ? "Requesting Permissions..." : "Get started"}
          </Button>

          <Typography
            sx={{
              color: "#ADADAD",
              fontSize: { xs: "10px", sm: "11px", md: "12px" },
              fontWeight: 400,
              textAlign: "center",
            }}
          >
            {/*
              THE SAME CORRECTION QuickStartStep already made, which this
              screen missed because the two onboardings were fixed apart.
              See the header of QuickStartStep.tsx for the full audit; the
              short version is that the old line — "Zero tracking. Not even
              we know where you browse." — was false, and not in a grey-area
              way. attachSpotCard.harvest() sends the url, title, h1, meta
              description and 20,000 characters of body text to
              /embed/asset/match on every page over 400 characters. The
              servers know where you browse BY NECESSITY: the product cannot
              match a market to a page without reading the page.

              A privacy claim the code contradicts is a Chrome Web Store
              user-data-policy problem before it is a copy problem, which is
              exactly why it cannot ship on the screen that ASKS for the
              permission. Both halves of what replaces it are checked in
              code: the match route is stateless and logs no payload, and it
              carries no identity since the Firebase bearer token was taken
              off it.
            */}
            Pages are matched to markets in the moment, with no name attached.
          </Typography>

          <Typography
            component="a"
            href="https://poppin.so"
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: "#AAAAAA",
              fontSize: { xs: "10px", sm: "11px", md: "12px" },
              fontWeight: 500,
              textDecoration: "none",
              textAlign: "center",
              "&:hover": {
                textDecoration: "underline",
              },
            }}
          >
            poppin.so
          </Typography>
    </Box>
  )
}
