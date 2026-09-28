import { JUICE } from "~/theme/juice"
import { ArrowBack, CameraAlt } from "@mui/icons-material"
import {
  alpha,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  useTheme,
} from "@mui/material"
import { styled } from "@mui/material/styles"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { z } from "zod"
import SignInPrompt from "~/components/SignInPrompt"
import { useToast } from "~/components/Toast/ToastProvider"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useUpdateProfile } from "~/hooks/useUpdateProfile"
import { useUploadFile } from "~/hooks/useUploadFile"
import { UserService } from "~/services/UserService"
import { useAppConfigStore, useEnvironmentStore } from "~/store/useAppConfigStore"
import { useRouteStore } from "~/store/useRouteStore"

const ProfilePhotoContainer = styled(Box)(({ theme }) => ({
  position: "relative",
  margin: "20px auto",
  width: 60,
  height: 60,
  borderRadius: "50%",
  backgroundColor: "transparent",
  border: `1px solid ${JUICE.border}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  "@container (min-width: 300px)": {
    width: 70,
    height: 70,
  },
  "@container (min-width: 400px)": {
    width: 80,
    height: 80,
  },
  "@container (min-width: 800px)": {
    width: 90,
    height: 90,
  },
  "@container (min-width: 1280px)": {
    width: 100,
    height: 100,
  },
}))

const profileSchema = z.object({
  display_name: z
    .string()
    .min(1, "Display name is required")
    .max(20, "Display name must be 20 characters or less"),
  username: z
    .string()
    .min(1, "Username is required")
    .max(15, "Username must be 15 characters or less")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Only letters, numbers, and underscores are allowed"
    ),
  bio: z.string().max(90, "Bio must be 90 characters or less").optional(),
})

interface UpdateProfileData {
  username: string
  display_name: string
  bio?: string
  profile_photo_url?: string
}

export default function EditProfile() {
  const navigate = useNavigate()
  const theme = useTheme()
  const { organization } = useAppConfigStore()
  const { setRoute } = useRouteStore()
  const { showToast } = useToast()
  const { data: currentUser, isLoading: isUserLoading, refetch: refetchCurrentUser } = useCurrentUser()
  const { environment } = useEnvironmentStore()
  const [formData, setFormData] = useState({
    display_name: "",
    username: "",
    bio: "",
  })
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null)
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(
    null
  )
  const [validationErrors, setValidationErrors] = useState<{
    display_name?: string
    username?: string
    bio?: string
  }>({})

  const [isUploadingProfile, setIsUploadingProfile] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRemoveTwitterDialogOpen, setIsRemoveTwitterDialogOpen] =
    useState(false)

  const updateProfileMutation = useUpdateProfile()
  const uploadFileMutation = useUploadFile()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (currentUser) {
      setFormData({
        display_name: currentUser.display_name || "",
        username: currentUser.username || "",
        bio: currentUser.bio || "",
      })
      setProfilePhotoPreview(currentUser.profile_photo_url)
    }
  }, [currentUser])

  const handleInputChange =
    (field: keyof typeof formData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement
      setFormData((prev) => ({ ...prev, [field]: target.value }))
      setValidationErrors((prev) => ({ ...prev, [field]: undefined }))
    }

  const handleProfilePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    if (file) {
      setProfilePhoto(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setProfilePhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleUpdateProfile = async () => {
    try {
      profileSchema.parse(formData)
      setValidationErrors({})
      setIsSaving(true)

      let newProfilePhotoUrl = currentUser?.profile_photo_url || undefined

      // Upload profile photo if it was changed
      if (profilePhoto) {
        setIsUploadingProfile(true)
        try {
          const response = await uploadFileMutation.mutateAsync({
            file: profilePhoto,
            options: {
              /**
               * 320, NOT 64. The avatar was uploaded at 64px wide while the
               * profile renders it at 60-96 CSS px — so on any 2x or 3x
               * screen (which is every phone and most laptops) the stored
               * image was UPSCALED. The reader picked a crisp photo, saw
               * the crisp local preview, and got a mush back: reported as
               * "profil resmimi böyle koyuyorum, böyle görünüyor".
               *
               * 320 covers the largest avatar on the surface at 3x with
               * room to spare, and a face at q85 that size is ~25KB.
               */
              width: 320,
              height: 320,
              quality: 85,
              crop: "attention" as const,
            }
          })
          /**
           * A 200 THAT CARRIES NO URL IS A FAILED UPLOAD.
           *
           * This used to read `response.url || undefined`, which quietly
           * fell back to sending no photo at all - so the save went
           * through, the toast said "Profile updated successfully", and
           * the OLD picture stayed. The one thing the person came here to
           * change was the one thing that did not change, and nothing on
           * screen said so.
           *
           * The upload either produced an address or it did not. Without
           * one there is nothing to save, and the honest move is the same
           * one the throw below takes: say it failed, keep the form as it
           * is, and let them press Save again.
           */
          if (!response.url) {
            throw new Error("Upload returned no address")
          }
          newProfilePhotoUrl = response.url
        } catch (error) {
          console.error("Failed to upload profile photo", error)
          showToast("Couldn't upload your photo. Nothing was changed.", "error")
          setIsSaving(false)
          return
        } finally {
          setIsUploadingProfile(false)
        }
      }

      const updateData: UpdateProfileData = {
        ...formData,
        profile_photo_url: newProfilePhotoUrl,
      }

      updateProfileMutation.mutate(updateData, {
        onSuccess: async () => {
          try {
            // Invalidate and wait for refetch of user queries
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["current-user"] }),
            ])
            showToast("Profile updated successfully", "success")
            navigate("/profile")
          } catch (error) {
            console.error("Error refreshing user data", error)
            // Still navigate even if refresh fails
            showToast("Profile updated successfully", "success")
            navigate("/profile")
          }
        },
        onError: (error: any) => {
          showToast(error?.message || "Failed to update profile", "error")
          setIsSaving(false)
        },
      })
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors: typeof validationErrors = {}
        err.errors.forEach((error) => {
          if (error.path[0]) {
            errors[error.path[0] as keyof typeof validationErrors] =
              error.message
          }
        })
        setValidationErrors(errors)
        setIsSaving(false)
      }
    }
  }

  const handleRemoveTwitterClick = () => {
    setIsRemoveTwitterDialogOpen(true)
  }

  const handleRemoveTwitterConfirm = async () => {
    try {
      await UserService.removeTwitter()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["current-user"] }),
      ])
      showToast("X account disconnected", "success")
      setIsRemoveTwitterDialogOpen(false)
    } catch (error) {
      console.error("Failed to remove Twitter connection", error)
      showToast("Couldn't disconnect X. Try again.", "error")
    }
  }

  if (isUserLoading) {
    return (
      <Box sx={{ color: "white", textAlign: "center", py: 4 }}>Loading...</Box>
    )
  }

  if (!currentUser) {
    return <SignInPrompt refetchCurrentUser={refetchCurrentUser} />
  }

  // Display Name and Username wear the same single-line field skin. The
  // bio keeps its own: multiline padding and a right-aligned counter.
  const fieldSx = {
    "& .MuiOutlinedInput-root": {
      backgroundColor: theme.palette.secondary.main,
      color: theme.palette.secondary.contrastText,
      height: "40px",
      "& fieldset": {
        borderColor: "#272727",
        borderWidth: "1px",
      },
      "&:hover fieldset": {
        borderColor: alpha(theme.palette.secondary.contrastText, 0.5),
      },
      "&.Mui-focused fieldset": {
        borderColor: "primary.main",
      },
      "& input": {
        padding: "8px 14px",
      },
    },
    "& .MuiFormHelperText-root": {
      color: "error.main",
      marginTop: "2px",
      fontSize: "11px",
    },
  }

  return (
    <Box
      sx={{
        position: "relative",
        "&::-webkit-scrollbar": {
          width: "8px",
        },
        "&::-webkit-scrollbar-track": {
          background: "transparent",
        },
        "&::-webkit-scrollbar-thumb": {
          background: "rgba(122,183,255,.10)",
          borderRadius: "4px",
        },
        "&::-webkit-scrollbar-thumb:hover": {
          background: organization?.secondaryColor,
        },
      }}
      style={{
        containerName: "profile-container",
        containerType: environment === "contentScript" ? "inline-size" : "normal",
      }}
    >
      {/* Header with Back Button */}
      <Box sx={{ position: "relative", width: "100%", p: 1 }}>
        <Button
          onClick={() => navigate("/profile")}
          sx={{
            backgroundColor: alpha(theme.palette.secondary.main, 0.5),
            backdropFilter: "blur(4px)",
            color: theme.palette.secondary.contrastText,
            minWidth: "unset",
            width: 32,
            height: 32,
            borderRadius: "50%",
            padding: 0,
            border: `1px solid ${alpha(theme.palette.secondary.contrastText, 0.1)}`,
            "&:hover": {
              backgroundColor: alpha(theme.palette.secondary.main, 0.7),
            },
          }}
        >
          <ArrowBack sx={{ fontSize: 16 }} />
        </Button>
      </Box>

      {/* Profile Photo Section */}
      <ProfilePhotoContainer>
        {profilePhotoPreview ? (
          <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
            <Box
              sx={{
                width: "100%",
                height: "100%",
                backgroundImage: `url(${profilePhotoPreview})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                borderRadius: "50%",
                overflow: "hidden",
              }}
            />
            {isUploadingProfile && (
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: alpha(theme.palette.secondary.main, 0.5),
                  borderRadius: "50%",
                }}
              >
                <CircularProgress size={24} sx={{ color: theme.palette.tetriary.contrastText }} />
              </Box>
            )}
          </Box>
        ) : (
          <Box
            sx={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              backgroundColor: theme.palette.primary.main,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
        )}
        <input
          type="file"
          accept="image/*"
          id="profile-photo-input"
          style={{ display: "none" }}
          onChange={handleProfilePhotoChange}
        />
        <label htmlFor="profile-photo-input">
          <Button
            sx={{
              position: "absolute",
              bottom: -4,
              right: -4,
              minWidth: 32,
              width: 32,
              height: 32,
              borderRadius: "50%",
              padding: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(4px)",
              border: `1px solid ${JUICE.border}`,
              "&:hover": {
                backgroundColor: "rgba(0, 0, 0, 0.7)",
              },
            }}
            component="span"
          >
            <CameraAlt sx={{ fontSize: 16, color: "white" }} />
          </Button>
        </label>
      </ProfilePhotoContainer>

      {/* NO "CONNECT X" OFFER. config/features.ts has held
          CONNECT_X_ENABLED false since the X app lost its Project
          enrolment, so this button could not render — and pressing it
          would have started a flow the API refuses. Someone already linked
          still sees their connection, and its exit, below. */}
        {currentUser.twitter_id && (
          <>
            {/* INLINE WITH WHAT IT DISCONNECTS. This was a red button
                absolutely positioned over the page's top corner - a
                destructive action floating away from its subject, in a
                color weight reserved for selling. A quiet row now: the
                connection named, its exit beside it. */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
                mb: 2,
                px: 0.5,
              }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                X connected
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                onClick={handleRemoveTwitterClick}
                sx={{
                  fontSize: "12px",
                  textTransform: "none",
                  color: "rgba(255,255,255,.55)",
                  "&:hover": { color: "#FF453A", backgroundColor: "transparent" },
                }}
              >
                Disconnect
              </Button>
            </Box>

            <Dialog
              open={isRemoveTwitterDialogOpen}
              onClose={() => setIsRemoveTwitterDialogOpen(false)}
              PaperProps={{
                sx: {
                  width: "280px",
                  backgroundColor: "#121212",
                  color: "white",
                },
              }}
            >
              <DialogTitle sx={{ p: 2, fontSize: "16px" }}>
                Disconnect X
              </DialogTitle>
              <DialogContent sx={{ p: 2, pb: 1 }}>
                <Typography sx={{ fontSize: "14px" }}>
                  Disconnect your X account from Poppin?
                </Typography>
              </DialogContent>
              <DialogActions sx={{ p: 1.5 }}>
                <Button
                  onClick={() => setIsRemoveTwitterDialogOpen(false)}
                  sx={{
                    color: "white",
                    fontSize: "13px",
                    "&:hover": { backgroundColor: "rgba(122,183,255,.10)" },
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRemoveTwitterConfirm}
                  variant="contained"
                  sx={{
                    backgroundColor: "rgba(255, 0, 0, 0.5)",
                    color: "white",
                    fontSize: "13px",
                    "&:hover": { backgroundColor: "rgba(255, 0, 0, 0.7)" },
                  }}
                >
                  Disconnect
                </Button>
              </DialogActions>
            </Dialog>
          </>
        )}

      <Box
        sx={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          px: "10px",
          position: "relative",
        }}
      >
      
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography
            component="label"
            htmlFor="display-name"
            sx={{
              color: theme.palette.tetriary.contrastText,
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            Display Name
          </Typography>
          <TextField
            id="display-name"
            fullWidth
            placeholder="Display Name"
            value={formData.display_name}
            onChange={handleInputChange("display_name")}
            error={!!validationErrors.display_name}
            helperText={validationErrors.display_name}
            variant="outlined"
            InputLabelProps={{ shrink: false }}
            inputProps={{ maxLength: 20 }}
            sx={fieldSx}
          />
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography
            component="label"
            htmlFor="username"
            sx={{
              color: theme.palette.tetriary.contrastText,
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            Username
          </Typography>
          <TextField
            id="username"
            fullWidth
            placeholder="Username"
            value={formData.username}
            onChange={handleInputChange("username")}
            error={!!validationErrors.username}
            helperText={validationErrors.username}
            variant="outlined"
            InputLabelProps={{ shrink: false }}
            inputProps={{ maxLength: 15 }}
            sx={fieldSx}
          />
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography
            component="label"
            htmlFor="bio"
            sx={{
              color: theme.palette.tetriary.contrastText,
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            Bio
          </Typography>
          <TextField
            id="bio"
            fullWidth
            multiline
            rows={3}
            placeholder="Tell us about yourself"
            value={formData.bio}
            onChange={handleInputChange("bio")}
            error={!!validationErrors.bio}
            helperText={validationErrors.bio || `${formData.bio.length}/90`}
            variant="outlined"
            inputProps={{ maxLength: 90 }}
            InputLabelProps={{ shrink: false }}
            sx={{
              "& .MuiOutlinedInput-root": {
                padding: "0px",
                paddingTop: "6px",
                backgroundColor: theme.palette.secondary.main,
                color: theme.palette.secondary.contrastText,
                "& fieldset": {
                  borderColor: "#272727",
                  borderWidth: "1px",
                },
                "&:hover fieldset": {
                  borderColor: alpha(theme.palette.secondary.contrastText, 0.5),
                },
                "&.Mui-focused fieldset": {
                  borderColor: "primary.main",
                },
                "& textarea": {
                  padding: "6px 10px",
                  lineHeight: "1.3",
                },
              },
              "& .MuiFormHelperText-root": {
                color: validationErrors.bio ? "error.main" : "#666",
                marginTop: "2px",
                fontSize: "11px",
                textAlign: "right",
              },
            }}
          />
        </Box>
        <Button
          variant="contained"
          fullWidth
          disabled={isSaving}
          startIcon={
            isSaving ? <CircularProgress size={14} color="inherit" /> : null
          }
          onClick={handleUpdateProfile}
          sx={{
            backgroundColor: isSaving ? alpha(theme.palette.primary.main, 0.5) : theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            borderRadius: "8px",
            py: 0.8,
            px: 2,
            fontSize: "13px",
            fontWeight: 500,
            maxWidth: "140px",
            minHeight: "32px",
            alignSelf: "flex-end",
            mt: 0,
            mb: 0.5,
            "&:hover": {
              backgroundColor: isSaving ? alpha(theme.palette.primary.main, 0.5) : theme.palette.primary.main,
            },
            "& .MuiCircularProgress-root": {
              marginRight: 1,
            },
            cursor: isSaving ? "not-allowed" : "pointer",
            pointerEvents: "auto",
            "&.Mui-disabled": {
              backgroundColor: alpha(theme.palette.primary.main, 0.5),
              color: theme.palette.primary.contrastText,
            },
          }}
        >
          {isSaving ? "Updating..." : "Save Changes"}
        </Button>
      </Box>
    </Box>
  )
}
