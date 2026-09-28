import { MoreHoriz } from "@mui/icons-material"
import {
  alpha,
  IconButton,
  Menu,
  MenuItem,
  useTheme,
} from "@mui/material"
import React, { useCallback, useMemo, useRef, useState } from "react"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useActionMenuDialogStore } from "~/store/useActionMenuDialogStore"
import { useAppConfigStore } from "~/store/useAppConfigStore"

type ContentType = "post" | "comment" | "reply"

interface ActionMenuProps {
  onDelete: () => void
  currentUserId?: string
  authorId: string
  postId: string
  contentType?: ContentType
  container?: HTMLElement | null
}

const ActionMenu = React.memo(
  ({
    onDelete,
    currentUserId,
    authorId,
    postId,
    contentType = "post",
    container,
  }: ActionMenuProps) => {

    const theme = useTheme()
    const { data: currentUser } = useCurrentUser()
    const { organization } = useAppConfigStore()

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
    const open = useMemo(() => Boolean(anchorEl), [anchorEl])
    const containerRef = useRef<HTMLDivElement>(null)
    const { setDialogMode, setDialogData } = useActionMenuDialogStore()

    const contentTypeCapitalized =
      contentType.charAt(0).toUpperCase() + contentType.slice(1)

    const handleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation()
      setAnchorEl(event.currentTarget)
    }, [])

    const handleClose = useCallback(() => {
      setAnchorEl(null)
    }, [])

    const handleDeleteClick = useCallback(
      (event: React.MouseEvent<HTMLElement>) => {
        event.stopPropagation()
        handleClose()
        setDialogData({
          postId,
          currentUserId,
          authorId,
          contentType,
          onDeleteCallback: onDelete,
        })
        setDialogMode("delete")
      },
      [handleClose, postId, currentUserId, authorId, contentType, onDelete, setDialogData, setDialogMode]
    )

    const handleReportClick = useCallback(
      (event: React.MouseEvent<HTMLElement>) => {
        event.stopPropagation()
        handleClose()
        setDialogData({
          postId,
          currentUserId,
          authorId,
          contentType,
          onDeleteCallback: onDelete,
        })
        setDialogMode("report")
      },
      [handleClose, postId, currentUserId, authorId, contentType, onDelete, setDialogData, setDialogMode]
    )

    return (
      <div ref={containerRef} onClick={(e) => e.stopPropagation()}>
        <IconButton
          size="small"
          onClick={handleClick}
          sx={{
            padding: 0,
            marginLeft: "auto",
            "& .MuiSvgIcon-root": {
              color: alpha(theme.palette.secondary.contrastText,0.8),
              width: "18px",
              height: "18px",
            },
          }}
        >
          <MoreHoriz sx={{ width: "16px", height: "16px" }} />
        </IconButton>
        <Menu
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          PaperProps={{
            sx: {
              backgroundColor: organization?.secondaryColor,
                border: "1px solid",
              borderImageSource: "linear-gradient(89.37deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.05) 100%)",
              backdropFilter: "blur(4px)",
              boxShadow: "none",
              borderRadius: "8px",
              color: "#FFFFFF",
              "& .MuiMenuItem-root": {
                fontSize: "12px",
                padding: "4px 8px",
                minHeight: "24px",
                color: "#FFFFFF",
                "&:hover": {
                  backgroundColor: "rgba(122,183,255,.10)",
                },
              },
              "& .MuiList-root": {
                padding: 0,
              },
            },
          }}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        >
          {currentUserId === authorId || currentUser?.role === "admin" ? (
            <MenuItem
              onClick={handleDeleteClick}
              sx={{
                fontSize: "12px",
              }}
            >
              Delete {contentTypeCapitalized}
            </MenuItem>
          ) : (
            <MenuItem
              onClick={handleReportClick}
              sx={{
                fontSize: "12px",
              }}
            >
              Report {contentTypeCapitalized}
            </MenuItem>
          )}
        </Menu>
      </div>
    )
  }
)

ActionMenu.displayName = "ActionMenu"

export default ActionMenu
