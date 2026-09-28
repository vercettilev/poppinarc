import { Box, darken, Tooltip, Typography, useTheme } from "@mui/material"
import { SxProps, Theme } from "@mui/material/styles"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useActionMenuDialogStore } from "~/store/useActionMenuDialogStore"
import PoppinLogo from "~/assets/logo.png"
import { cleanSiteUrl, siteFaviconUrl } from "~/helpers/siteMark"

interface WebsiteFaviconProps {
  url: string
  sx?: SxProps<Theme>
  showTooltip?: boolean
}

// The readable-name and icon-source rules moved to helpers/siteMark so the
// trade card can show the same mark. This file keeps the Tooltip and the Box —
// the card is inside a closed shadow root and cannot have either.
const cleanUrl = cleanSiteUrl

const getDomainFirstLetter = (url: string): string =>
  cleanUrl(url).charAt(0).toUpperCase()

const WebsiteFavicon = React.memo(({ url, sx, showTooltip = true }: WebsiteFaviconProps) => {
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const { setDialogMode, setExternalLinkUrl } = useActionMenuDialogStore()

  const faviconUrl = useMemo(() => {
    try {
      // Determine favicon size based on custom dimensions or default
      const customWidth = (sx as any)?.width
      const customHeight = (sx as any)?.height
      const hasCustomSize = customWidth || customHeight

      let faviconSize = 64 // default size
      if (hasCustomSize) {
        // Extract numeric value from width/height (supports string, number, or responsive object)
        let widthValue: number | undefined
        let heightValue: number | undefined

        if (typeof customWidth === 'string') {
          widthValue = parseInt(customWidth)
        } else if (typeof customWidth === 'number') {
          widthValue = customWidth
        } else if (typeof customWidth === 'object') {
          // For responsive objects like { xs: "32px", md: "48px" }, use the largest value
          const widthObj = customWidth as Record<string, string | number>
          const mdValue = widthObj.md || widthObj.sm || widthObj.xs
          widthValue = typeof mdValue === 'string' ? parseInt(mdValue) : mdValue
        }

        if (typeof customHeight === 'string') {
          heightValue = parseInt(customHeight)
        } else if (typeof customHeight === 'number') {
          heightValue = customHeight
        } else if (typeof customHeight === 'object') {
          // For responsive objects like { xs: "32px", md: "48px" }, use the largest value
          const heightObj = customHeight as Record<string, string | number>
          const mdValue = heightObj.md || heightObj.sm || heightObj.xs
          heightValue = typeof mdValue === 'string' ? parseInt(mdValue) : mdValue
        }

        const sizeValue = widthValue || heightValue || 64
        faviconSize = Math.max(16, Math.min(512, sizeValue)) // Clamp between 16 and 512
      }

      return siteFaviconUrl(url, faviconSize, PoppinLogo)
    } catch {
      return null
    }
  }, [url, sx])

  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Check if favicon loads successfully
  useEffect(() => {
    if (!faviconUrl) return

    const img = new Image()
    img.onload = () => {
      setShowPlaceholder(false)
    }
    img.onerror = () => {
      setShowPlaceholder(true)
    }
    img.src = faviconUrl

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [faviconUrl])

  const handleFaviconClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()

    /**
     * The warning is for LEAVING. `website_url` rides along with a post, so it
     * can point anywhere, and walking a reader onto an unknown origin with one
     * unlabelled click is how a feed becomes a phishing surface. That gate
     * stays.
     *
     * It just does not apply when the destination is the origin the reader is
     * already standing on. Clicking the x.com mark under a post you are
     * reading on x.com warned about x.com, which teaches people to click
     * through warnings — the exact opposite of what a warning is for.
     *
     * THE ORIGIN TO COMPARE IS THE TAB'S, NOT OURS. This panel runs at
     * chrome-extension://…, so `window.location` here answers a question
     * nobody asked; the reader's origin is the active tab's. Same reason the
     * jump is `tabs.update` and not `location.assign`: navigating means moving
     * the page beside us, not replacing the panel with x.com.
     *
     * Same ORIGIN, not same URL. A different path on a host the reader is
     * already on is the trust decision they have made; a different host is not.
     */
    let target: URL
    try {
      target = new URL(url)
    } catch {
      setExternalLinkUrl(url) // unparseable is never trusted
      setDialogMode("externalLink")
      return
    }

    const warn = () => {
      setExternalLinkUrl(url)
      setDialogMode("externalLink")
    }

    if (typeof chrome?.tabs?.query !== "function") return warn()

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0]
      let here: string | null = null
      try {
        here = tab?.url ? new URL(tab.url).origin : null
      } catch {
        here = null
      }

      if (tab?.id !== undefined && here === target.origin) {
        chrome.tabs.update(tab.id, { url })
        return
      }
      warn()
    })
  }, [url, setDialogMode, setExternalLinkUrl])

  const theme = useTheme()

  if (!faviconUrl) return null

  // Extract width and height from sx prop to determine if custom sizing is provided
  const customWidth = (sx as any)?.width
  const customHeight = (sx as any)?.height
  const hasCustomSize = customWidth || customHeight

  const faviconElement = (
    <Box
      onClick={handleFaviconClick}
      sx={{
        height: hasCustomSize ? customHeight : 18,
        width: hasCustomSize ? customWidth : 18,
        minWidth: hasCustomSize ? customWidth : 18,
        minHeight: hasCustomSize ? customHeight : 18,
        maxWidth: hasCustomSize ? customWidth : 18,
        maxHeight: hasCustomSize ? customHeight : 18,
        outline: `1px solid ${darken(theme.palette.secondary.main, 0.2)}`,
        borderRadius: "9999px",
        backgroundColor: darken(theme.palette.secondary.main, 0.4),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        cursor: "pointer",
        transition: "all 0.2s ease",
        "&:hover": {
          filter: "brightness(1.2)",
        },
        ...sx,
        mr: "0"
      }}
    >
      {showPlaceholder ? (
        <Typography
          sx={{
            fontSize: hasCustomSize ? "10px" : "12px",
            fontWeight: "bold",
            color: "white",
            userSelect: "none",
          }}
        >
          {getDomainFirstLetter(url)}
        </Typography>
      ) : (
        <Box
          sx={{
            height: hasCustomSize ? "calc(100% - 2px)" : 16,
            width: hasCustomSize ? "calc(100% - 2px)" : 16,
            minHeight: hasCustomSize ? "calc(100% - 2px)" : 16,
            minWidth: hasCustomSize ? "calc(100% - 2px)" : 16,
            maxHeight: hasCustomSize ? "calc(100% - 2px)" : 16,
            maxWidth: hasCustomSize ? "calc(100% - 2px)" : 16,
            backgroundImage: `url(${faviconUrl})`,
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            borderRadius: "9999px",
          }}
        />
      )}
    </Box>
  )

  if (!isMounted) {
    return faviconElement
  }

  if (!showTooltip) {
    return faviconElement
  }

  return (
    <Tooltip
      title={
        <span>
          <span style={{fontSize: '12px', fontWeight: '400'}}>posted on</span>
           <span style={{fontStyle: 'normal', fontSize: '12px', fontWeight: "500"}}> {cleanUrl(url)}</span>
        </span>
      }
      componentsProps={{
        tooltip: {
          sx: {
            fontSize: "0.75rem",
            px: 1,
            py: 0.5,
            backgroundColor: theme.palette.secondary.main,
          },
        },
      }}
      arrow
      placement="top"
    >
      {faviconElement}
    </Tooltip>
  )
})

WebsiteFavicon.displayName = "WebsiteFavicon"

export default WebsiteFavicon
