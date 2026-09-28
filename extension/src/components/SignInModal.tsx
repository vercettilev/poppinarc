import { Close as CloseIcon } from "@mui/icons-material"
import { alpha, Box, IconButton, Modal } from "@mui/material"
import { useEffect } from "react"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import SignInPrompt from "./SignInPrompt"

interface SignInModalProps {
  open: boolean
  onClose: () => void
  refetchCurrentUser: () => void
}

export default function SignInModal({
  open,
  onClose,
  refetchCurrentUser,
}: SignInModalProps) {
  const { data: user } = useCurrentUser()

  useEffect(() => {
    if (user && open && user.username) {
      onClose()
    }
  }, [user, open, onClose])

  return (
    <Modal
      autoFocus={false}
      component="div"
      open={open}
      onClose={onClose}
      aria-labelledby="sign-in-modal-title"
      aria-describedby="sign-in-modal-description"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(6px)",
        "& .MuiBackdrop-root": {
          backgroundColor: alpha("#000", 0.5),
        },
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Box
        contentEditable={false}
        autoFocus={false}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: "relative",
          // Sit on #000 with a 1px hairline + a subtle brand-blue glow so
          // the modal reads as the same surface family as drawers/toasts
          // but with a quiet halo announcing it's the focal layer.
          backgroundColor: "transparent",
          borderRadius: "16px",
          minWidth: 320,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${alpha("#FFFFFF", 0.1)}`,
          boxShadow: `0 24px 60px ${alpha("#000", 0.6)}`,
        }}
      >
        <IconButton
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          size="small"
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            color: alpha("#FFFFFF", 0.7),
            backgroundColor: alpha("#FFFFFF", 0.04),
            border: `1px solid ${alpha("#FFFFFF", 0.08)}`,
            width: "26px",
            height: "26px",
            borderRadius: "8px",
            padding: "4px",
            "&:hover": {
              color: "#FFFFFF",
              backgroundColor: alpha("#FFFFFF", 0.1),
            },
          }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
        <SignInPrompt
          user={user ?? undefined}
          refetchCurrentUser={refetchCurrentUser}
        />
      </Box>
    </Modal>
  )
}
