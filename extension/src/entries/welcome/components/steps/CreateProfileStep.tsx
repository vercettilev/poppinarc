import {
  Alert,
  alpha,
  Button,
  CircularProgress,
  InputAdornment,
  TextField,
} from "@mui/material"
import { styled } from "@mui/material/styles"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { z } from "zod"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { hasUsableProfile } from "~/helpers/profileGate"
import { useUpdateProfile } from "~/hooks/useUpdateProfile"
import { StepFrame } from "../StepFrame"

const StyledTextField = styled(TextField)(({ theme }) => ({
  "& .MuiOutlinedInput-root": {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderRadius: 14,
    transition: "all 0.2s ease-in-out",
    "& fieldset": {
      borderColor: "rgba(255, 255, 255, 0.12)",
      borderWidth: "1px",
    },
    "&:hover fieldset": {
      borderColor: "rgba(255, 255, 255, 0.2)",
    },
    "&.Mui-focused fieldset": {
      borderColor: theme.palette.primary.main,
      borderWidth: "2px",
    },
    "&.Mui-focused": {
      backgroundColor: "rgba(255, 255, 255, 0.04)",
    },
  },
  "& .MuiInputBase-input": {
    color: "white",
    fontSize: "16px",
    fontFamily: "PoppinSans, sans-serif",
    padding: "15px 16px 15px 4px",
  },
  "& .MuiFormHelperText-root": {
    color: theme.palette.error.main,
    fontSize: "0.75rem",
    marginLeft: 4,
    marginTop: 8,
    textAlign: "left",
    fontFamily: "PoppinSans, sans-serif",
  },
}))

const ContinueButton = styled(Button)(({ theme }) => ({
  width: "100%",
  height: 52,
  borderRadius: "14px",
  fontSize: "15px",
  fontWeight: 700,
  fontFamily: "PoppinSans, sans-serif",
  textTransform: "none",
  backgroundColor: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
  transition: "all 0.2s ease-in-out",
  "&:hover": {
    backgroundColor: alpha(theme.palette.primary.main, 0.9),
  },
  "&:disabled": {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: "rgba(255, 255, 255, 0.4)",
  },
}))

// Username only. This screen used to also demand a display name and offer
// photo uploads: three asks standing between signing in and using anything,
// on the one screen someone reaches by declining the fast path. Both dropped
// fields are optional server-side (UpdateUserSchema marks display_name
// .optional(), profile_photo_url is nullable) and both stay editable in
// profile settings, so nothing is lost by not asking here.
//
// Nothing is auto-filled into display_name either, and that is deliberate:
// its regex is /^[a-zA-Z0-9_\s]*$/, Latin only, so quietly seeding it from
// the Google name would reject exactly the people whose names carry
// diacritics ("Uğur") — turning a field they never asked to fill into a
// validation error on someone else's screen. Better to leave it empty.
const profileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Only letters, numbers, and underscores are allowed"
    ),
})

interface CreateProfileStepProps {
  onSuccess?: () => void
}

export const CreateProfileStep = ({ onSuccess }: CreateProfileStepProps) => {
  const navigate = useNavigate()
  const { data: currentUser } = useCurrentUser()
  const [username, setUsername] = useState("")
  const [validationError, setValidationError] = useState<string>("")
  const [apiError, setApiError] = useState<string | null>(null)

  const updateProfileMutation = useUpdateProfile()

  // Nothing to ask if they already have one — this is what makes the screen
  // safe as ConnectXStep's fallback: linking X sets the username, so anyone
  // who arrives here already named passes straight through.
  useEffect(() => {
    if (hasUsableProfile(currentUser)) {
      if (onSuccess) {
        onSuccess()
      } else {
        navigate("/")
      }
    }
  }, [currentUser?.username, onSuccess, navigate])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value)
    setValidationError("")
    setApiError(null)
  }

  const handleCreateProfile = () => {
    const parsed = profileSchema.safeParse({ username })
    if (!parsed.success) {
      setValidationError(parsed.error.errors[0]?.message ?? "Invalid username")
      return
    }
    setValidationError("")
    setApiError(null)

    updateProfileMutation.mutate(parsed.data as any, {
      onSuccess: () => {
        if (onSuccess) {
          onSuccess()
        } else {
          navigate("/")
        }
      },
      onError: (error: any) => {
        // The API returns either a plain message or a JSON-encoded array of
        // field errors; show whichever it actually sent.
        try {
          const errorData = JSON.parse(error?.message)
          if (Array.isArray(errorData)) {
            setApiError(errorData.map((err) => err.message).join(", "))
          } else if (errorData.message) {
            setApiError(errorData.message)
          } else {
            setApiError(error?.message || "Failed to update profile")
          }
        } catch {
          setApiError(error?.message || "Failed to update profile")
        }
      },
    })
  }

  const isPending = updateProfileMutation.isPending

  return (
    <StepFrame
      title="Pick a username"
      subtitle="This is how you show up on Poppin."
      banner={
        apiError ? (
          <Alert
            severity="error"
            sx={{
              width: "100%",
              borderRadius: 2,
              backgroundColor: "rgba(211, 47, 47, 0.1)",
              color: "#ffcdd2",
              "& .MuiAlert-icon": { color: "#FF453A" },
            }}
          >
            {apiError}
          </Alert>
        ) : undefined
      }
      actions={
        <ContinueButton
          variant="contained"
          disabled={isPending}
          startIcon={
            isPending ? <CircularProgress size={18} color="inherit" /> : null
          }
          onClick={handleCreateProfile}
        >
          {isPending ? "Saving..." : "Continue"}
        </ContinueButton>
      }
    >
      <StyledTextField
        id="username"
        fullWidth
        autoFocus
        placeholder="yourname"
        value={username}
        onChange={handleChange}
        // One field, so Enter should finish it — reaching for the mouse to
        // submit a single input is friction nobody asked for.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isPending) handleCreateProfile()
        }}
        error={!!validationError}
        helperText={validationError}
        variant="outlined"
        inputProps={{
          autoCapitalize: "none",
          autoCorrect: "off",
          spellCheck: false,
          "aria-label": "Username",
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <span
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 16,
                  fontFamily: "PoppinSans, sans-serif",
                }}
              >
                @
              </span>
            </InputAdornment>
          ),
        }}
      />
    </StepFrame>
  )
}
