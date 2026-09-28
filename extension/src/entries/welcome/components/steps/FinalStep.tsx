import { alpha, Box, Typography } from "@mui/material"
import { useState } from "react"
import WebsiteFavicon from "~/components/Post/WebsiteFavicon"
import { LogoBlackIcon } from "../icons"
import { StepProps } from "../types"

// Brand blue — kept off `theme.palette.primary` so an organisation override
// can't repaint the final-step canvas to a light tint.
const BRAND_BLUE = "#68C6FF"




interface TopWebsite {
  url: string
  website: string
}

export const FinalStep: React.FC<StepProps> = ({ onNext }) => {
  // Curated first-run suggestions — shown to everyone. We intentionally do
  // NOT override these with the dynamic GET_TOP_WEBSITES_BY_ONLINE_COUNT
  // list so the welcome screen always surfaces three recognisable sites.
  const [topWebsites] = useState<TopWebsite[]>([
    { url: "https://www.ft.com/", website: "ft.com" },
    { url: "https://www.espn.com/", website: "espn.com" },
    { url: "https://edition.cnn.com/", website: "cnn.com" },
  ])

  const handleSiteClick = async (url: string) => {
    // Normalize URL to ensure it has a protocol
    let normalizedUrl = url
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      normalizedUrl = `https://${url}`
    }

    /* WHERE ONBOARDING SENT THEM. The whole flow ends by handing the
       person to a real page, and which one they picked is the first fact
       about how they intend to use the product — and whether a card_shown
       ever follows it is whether onboarding connected to reality at all.
       Host only: the path of a tweet is somebody's timeline. */
    try {
      let host = ""
      try {
        host = new URL(normalizedUrl).hostname
      } catch {
        host = "invalid"
      }
      void chrome.runtime.sendMessage({
        type: "SPOT_TELEMETRY",
        event: "onboarding_handoff",
        payload: { host },
      })
    } catch {
      // Counting must never block the handoff itself.
    }

    // Open sidepanel first
    await chrome.runtime.sendMessage({
      action: "TOGGLE_SIDE_PANEL",
      payload: { url: normalizedUrl },
    })

    // Open URL in a new tab
    chrome.tabs.create({ url: normalizedUrl })
  }


  return (
    <Box>
     
      <Box
        sx={{
          backgroundColor: "#FFFFFF05",
          backdropFilter: "blur(35px)",
          WebkitBackdropFilter: "blur(35px)",
          border: `0.7px solid ${alpha(BRAND_BLUE, 0.2)}`,
          borderRadius: 4,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          p: 4,
          gap: 3,
          margin: "0 auto",
        }}
      >
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: 99,
          backgroundColor: BRAND_BLUE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mb: 1,
        }}
      >
        <LogoBlackIcon width={60} height={60} />
      </Box>

      <Typography
        variant="h4"
        component="h1"
        align="center"
        sx={{
          color: "white",
          fontWeight: 700,
          fontSize: "27px",
          mb: 1,
        }}
      >
        Where do you want to start?
      </Typography>


      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          gap: 2,
          width: "100%",
          mb: 3,
          cursor: "pointer",
          flexDirection: "row",
        }}
      >
        {topWebsites.map((site) => {
          // Format URL to show full URL without protocol
          const getDisplayUrl = (url: string) => {
            try {
              const fullUrl = url.replace(/^https?:\/\//, '')
              // Limit to reasonable length
              return fullUrl.length > 25 ? fullUrl.substring(0, 25) + '...' : fullUrl
            } catch {
              const cleaned = url.replace(/^https?:\/\//, '')
              return cleaned.length > 25 ? cleaned.substring(0, 25) + '...' : cleaned
            }
          }

          return (
            <Box
              key={site.url}
              component="div"
              onClick={() => handleSiteClick(site.url)}
              sx={{ cursor: "pointer", display: "inline-block" }}
            >
              <Box
                component="div"
                sx={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  p: { xs: 1.5, md: 3 },
                  transition: "all 0.2s",
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 1,
                  position: "relative",
                  width: { xs: "120px", md: "236px" },
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <WebsiteFavicon
                  showTooltip={false}
                  url={site.url}
                  sx={{
                    width: { xs: "32px", md: "48px" },
                    height: { xs: "32px", md: "48px" },
                    backgroundColor: "transparent",
                    outline: "none",
                    borderRadius: "10px !important",
                    "& > div": {
                      borderRadius: "10px !important"
                    }
                  }}
                />
                <Typography
                  sx={{
                    color: "white",
                    fontSize: { xs: "12px", md: "16px" },
                    fontWeight: 500,
                    maxWidth: { xs: "100px", md: "200px" },
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {getDisplayUrl(site.url)}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
    </Box>
    
  )
}
