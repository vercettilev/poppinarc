import { Close as CloseIcon } from "@mui/icons-material"
import { Box, IconButton, Modal, Typography, useMediaQuery } from "@mui/material"
import { useEffect, useRef, useState } from "react"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useAppConfigStore } from "~/store/useAppConfigStore"

interface LoginModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export default function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { onClose: appConfigClose } = useAppConfigStore()
  const userProcessedRef = useRef(false)

  const { data: user } = useCurrentUser()
  const isMobile = useMediaQuery("(max-width: 768px)")

  useEffect(() => {
    if (isOpen) {
      setError(null)
      userProcessedRef.current = false
    } else {
      setError(null)
      userProcessedRef.current = false
    }
  }, [isOpen])

  useEffect(() => {
    if (user && !userProcessedRef.current && isOpen) {
      userProcessedRef.current = true
      onSuccess?.()
      onClose()
    }
  }, [user, isOpen, onSuccess, onClose])

  const handleClose = () => {
    onClose()
    if (appConfigClose) {
      appConfigClose()
    }
  }

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      aria-labelledby="login-modal-title"
      aria-describedby="login-modal-description"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: isMobile ? '90%' : 398,
          height: isMobile ? '80vh' : 598,
          bgcolor: 'transparent',
          border: 'none',
          outline: 'none',
        }}
      >
        {/* Error message */}
        {error && (
          <Box
            sx={{
              position: "absolute",
              top: -60,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 10001,
              bgcolor: "#ff4444",
              color: "white",
              padding: 2,
              borderRadius: 2,
              maxWidth: 300,
              textAlign: "center",
            }}
          >
            <Typography variant="body2">{error}</Typography>
          </Box>
        )}

        <IconButton
          onClick={handleClose}
          size="small"
          sx={{
            position: "absolute",
            top: -16,
            right: -16,
            width: "32px",
            height: "32px",
            color: "white",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 10000,
            "&:hover": {
              backgroundColor: "rgba(0, 0, 0, 0.7)",
            },
            "& svg": {
              width: "18px",
              height: "18px",
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
    </Modal>
  )
} 