import { JUICE } from "~/theme/juice"
import { Box, Popper, SxProps, Typography } from "@mui/material"
import React, { useRef, useState } from "react"
import { XIcon } from "./icons"

export const TwitterBadge = ({
  twitterId,
  sx,
}: {
  twitterId: string
  sx?: SxProps
}) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [twitterPopperOpen, setTwitterPopperOpen] = useState(false)

  const handleTwitterPopperOpen = () => {
    setTwitterPopperOpen(true)
  }

  const handleTwitterPopperClose = () => {
    setTwitterPopperOpen(false)
  }

  const handleTwitterClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    if (twitterId) {
      if(typeof chrome.tabs !== "undefined"){
      chrome.tabs.create({
        url: `https://twitter.com/i/user/${twitterId}`,
      })
    } else {
        chrome.runtime.sendMessage({
          type: "openTab",
          payload: {
            url: `https://twitter.com/i/user/${twitterId}`,
          }
        })
      }
    }
  }

  return (
    <React.Fragment>
      <Box
        ref={anchorRef}
        onClick={(e) => {
          e.stopPropagation()
          handleTwitterClick(e)
        }}

        onMouseEnter={handleTwitterPopperOpen}
        onMouseLeave={handleTwitterPopperClose}
        sx={{
          position: "absolute",
          right: 0,
          bottom: 0,
          backgroundColor: "transparent",
          border: `1px solid ${JUICE.border}`,
          borderRadius: "9999px",
          padding: "2px",
          width: "16px",
          height: "16px",
          ml: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4px",
          cursor: "pointer",
          "&:hover": {
            backgroundColor: "rgba(122,183,255,.10)",
          },
          ...sx,
        }}
      >
        <XIcon width={8} />
      </Box>
      {anchorRef.current && (
        <Popper
          open={twitterPopperOpen}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          disablePortal={true}
          sx={{ zIndex: 1300 }}
          onMouseEnter={() => setTwitterPopperOpen(true)}
          onMouseLeave={() => handleTwitterPopperClose()}
        >
          <Box
            sx={{
              backgroundColor: "transparent",
              color: "#FFFFFF",
              border: `1px solid ${JUICE.border}`,
              borderRadius: "10px",
              mt: 0.5,
              cursor: "pointer",
              padding: "6px 10px",
              fontSize: "11px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              "&:hover": {
                backgroundColor: "rgba(122,183,255,.10)",
              },
            }}
            onClick={handleTwitterClick}
          >
            <Typography
              sx={{
                fontSize: "10px",
                whiteSpace: "nowrap",
              }}
            >
              Visit X Profile
            </Typography>
          </Box>
        </Popper>
      )}
    </React.Fragment>
  )
}
