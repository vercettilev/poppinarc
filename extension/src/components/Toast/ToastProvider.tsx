import { AlertProps, SnackbarOrigin } from "@mui/material"
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react"
import Toast from "./Toast"

type ToastMessage = string | ReactNode

interface ToastContextType {
  showToast: (
    message: ToastMessage,
    severity?: AlertProps["severity"],
    position?: SnackbarOrigin
  ) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

const defaultPosition: SnackbarOrigin = {
  vertical: "bottom",
  horizontal: "right",
}

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<ToastMessage>("")
  const [severity, setSeverity] = useState<AlertProps["severity"]>("info")
  const [position, setPosition] = useState<SnackbarOrigin>(defaultPosition)

  const showToast = useCallback(
    (
      message: ToastMessage,
      severity: AlertProps["severity"] = "info",
      position: SnackbarOrigin = defaultPosition
    ) => {
      setMessage(message)
      setSeverity(severity)
      setPosition(position)
      setOpen(true)
    },
    []
  )

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast
        open={open}
        message={message}
        severity={severity}
        position={position}
        onClose={handleClose}
      />
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const context = useContext(ToastContext)
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}
