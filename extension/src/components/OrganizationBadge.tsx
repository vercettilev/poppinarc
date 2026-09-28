import { Box, Tooltip, useTheme } from "@mui/material"
import { SxProps, Theme } from "@mui/material/styles"
import React, { useCallback } from "react"
import type { Organization } from "~/services/UserService"
import { useActionMenuDialogStore } from "~/store/useActionMenuDialogStore"

interface OrganizationBadgeProps {
  organization: Organization
  size?: number
  sx?: SxProps<Theme>
}

const OrganizationBadge = React.memo(({ organization, size = 14, sx }: OrganizationBadgeProps) => {
  const { setDialogMode, setExternalLinkUrl } = useActionMenuDialogStore()
  const theme = useTheme()

  const handleBadgeClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    
    // Construct the organization URL from domain
    if (organization.domain) {
      let orgUrl = organization.domain
      // Ensure the URL has a protocol
      if (!orgUrl.startsWith('http://') && !orgUrl.startsWith('https://')) {
        orgUrl = `https://${orgUrl}`
      }
      
      // Show external link warning dialog
      setExternalLinkUrl(orgUrl)
      setDialogMode("externalLink")
    }
  }, [organization.domain, setDialogMode, setExternalLinkUrl])

  // Clean the organization URL for display
  const cleanOrgUrl = (url: string): string => {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
      return urlObj.hostname.replace(/^www\./, '')
    } catch {
      return url.replace(/^(https?:\/\/)?(www\.)?/i, "")
    }
  }

  const orgUrl = organization.domain ? cleanOrgUrl(organization.domain) : ""

  return (
    <Tooltip
      title={`VERIFIED - ${orgUrl}`}
      componentsProps={{
        tooltip: {
          sx: {
            fontSize: "0.75rem",
            px: 1,
            py: 0.5,
          },
        },
      }}
      arrow
      placement="top"
    >
      <Box
        component="img"
        src={organization.badgeUrl}
        alt={organization.name}
        onClick={handleBadgeClick}
        sx={{
          width: size,
          height: size,
          borderRadius: "2px",
          objectFit: "cover",
          cursor: "pointer",
          transition: "all 0.2s ease",
          "&:hover": {
            filter: "brightness(1.2)",
            transform: "scale(1.1)",
          },
          ...sx,
        }}
      />
    </Tooltip>
  )
})

OrganizationBadge.displayName = "OrganizationBadge"

export default OrganizationBadge
