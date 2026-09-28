import { Alert, Box, Button, CircularProgress, TextField, Typography } from "@mui/material"
import { alpha, styled } from "@mui/material/styles"
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { z } from "zod"
import { XIcon } from "~/components/icons"
import { CONNECT_X_ENABLED } from "~/config/features"
import { humanApiError } from "~/helpers/apiError"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useUpdateProfile } from "~/hooks/useUpdateProfile"
import { useUploadFile } from "~/hooks/useUploadFile"
import { QuietAction, StepFrame } from "../StepFrame"
import { switchAccount } from "~/helpers/switchAccount"

/**
 * THE IDENTITY STEP — newborn accounts only, exactly once.
 *
 * First cut of this idea rode on "You're in!" as a pill and was pulled the
 * same day: it made five pressable things out of a screen whose whole
 * argument was two doors and a quiet exit ("çok çok fazla CTA var"). So it
 * became its own step, BETWEEN sign-in and the payoff, and only for
 * accounts minutes old (see helpers/accountAge). Existing users never meet
 * it; the payoff screen is untouched.
 *
 * Second cut sent the two changes AWAY — "Change username" opened another
 * screen, and the photo could not be changed at all. Both were wrong for a
 * screen whose whole promise is "this is you": being shown an identity and
 * then having to travel to amend it is worse than not being shown one.
 * "Beğenmediyse oracıkta foto upload etse veya username seçse" — so the
 * avatar IS the file picker and the handle IS the field, in place.
 *
 * WHAT KEEPS IT FROM BECOMING A FORM: nothing is required and nothing is
 * asked. The account arrives named (assigned at creation) and faced (the
 * Google photo, captured in auth), so the screen renders a finished
 * identity and Continue keeps it — untouched, Continue does not even reach
 * the network. Editing is the exception path, priced accordingly.
 *
 * Connect X stays a door because it genuinely leaves: OAuth is a round
 * trip, not a field.
 */

const FONT = "PoppinSans, sans-serif"

/** Same rules the standalone username screen enforces — one grammar for
 *  one value, wherever it is typed. */
const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  // The server's ceiling is 15 (UpdateUserSchema). Without it here, a
  // longer name passed on screen and came back as a 400 from the API —
  // the rule was enforced, just in the worst possible place.
  .max(15, "Username must be at most 15 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers, and underscores are allowed")

/**
 * Big enough for any phone photo, small enough that a base64 round trip
 * through the service worker stays sane (the upload bridge encodes the
 * whole file into a message). The server resizes to 64px anyway, so
 * refusing a 30MB original costs the reader nothing but a second pick.
 */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024

const ContinueButton = styled(Button)(({ theme }) => ({
  width: "100%",
  height: 52,
  borderRadius: "14px",
  fontSize: "15px",
  fontWeight: 700,
  fontFamily: FONT,
  textTransform: "none",
  backgroundColor: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
  transition: "all 0.2s ease-in-out",
  "&:hover": { backgroundColor: alpha(theme.palette.primary.main, 0.9) },
  "&:disabled": {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: "rgba(255, 255, 255, 0.4)",
  },
}))

/** The handle field: an @ that belongs to the input, not a label above it. */
const HandleField = styled(TextField)(({ theme }) => ({
  "& .MuiOutlinedInput-root": {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderRadius: 14,
    paddingLeft: 14,
    transition: "all 0.2s ease-in-out",
    "& fieldset": { borderColor: "rgba(255, 255, 255, 0.12)", borderWidth: "1px" },
    "&:hover fieldset": { borderColor: "rgba(255, 255, 255, 0.2)" },
    "&.Mui-focused fieldset": {
      borderColor: theme.palette.primary.main,
      borderWidth: "2px",
    },
    "&.Mui-focused": { backgroundColor: "rgba(255, 255, 255, 0.04)" },
  },
  "& .MuiInputBase-input": {
    color: "white",
    fontSize: "16px",
    fontWeight: 600,
    fontFamily: FONT,
    padding: "15px 16px 15px 4px",
    textAlign: "center",
  },
  "& .MuiFormHelperText-root": {
    color: theme.palette.error.main,
    fontSize: "0.75rem",
    textAlign: "center",
    marginLeft: 0,
  },
}))

export function ClaimIdentityStep() {
  const navigate = useNavigate()
  const { data: me } = useCurrentUser()
  const updateProfile = useUpdateProfile()
  const uploadFile = useUploadFile()

  const [username, setUsername] = useState("")
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [switching, setSwitching] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * Seed ONCE from the assigned name. The cache is primed by the sign-in
   * that routed here, but if /users/me is a beat late the seed still lands
   * — and clearing the field afterwards must never re-fill it under the
   * reader's cursor.
   */
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !me?.username) return
    seeded.current = true
    setUsername(me.username)
  }, [me?.username])

  const assigned = me?.username ?? ""
  const shownPhoto = photoPreview ?? me?.profile_photo_url ?? null
  const nameChanged = username !== assigned
  const touched = nameChanged || photoFile !== null

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image.")
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("That photo is over 8MB. Try a smaller one.")
      return
    }
    setError(null)
    setPhotoFile(file)
    // Show it immediately; the upload waits for Continue, so a reader who
    // picks three photos costs us one upload, not three.
    const reader = new FileReader()
    reader.onloadend = () => setPhotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const onContinue = async () => {
    // UNTOUCHED IS FREE. The identity on screen is already the identity on
    // the server; Continue must not spend a round trip to agree with it.
    if (!touched) {
      navigate("/show-me")
      return
    }

    if (nameChanged) {
      const parsed = usernameSchema.safeParse(username)
      if (!parsed.success) {
        setError(parsed.error.errors[0]?.message ?? "Invalid username")
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      let photoUrl = me?.profile_photo_url ?? undefined
      if (photoFile) {
        const res = await uploadFile.mutateAsync({
          file: photoFile,
          // 320, not 64 — see edit-profile: the avatar renders far larger
          // than 64px on any retina screen, so a 64px upload arrives
          // upscaled and mushy. Both doors that set a photo agree.
          options: { width: 320, height: 320, quality: 85, crop: "attention" },
        })
        /**
         * A 200 THAT CARRIES NO URL IS A FAILED UPLOAD, and this line used
         * to hide exactly that: `res.url || photoUrl` fell back to whatever
         * was there before, so the step completed, the person landed on
         * "you're in", and the picture they had just chosen was gone with
         * nothing on screen to say why. Same rule as edit-profile - the
         * upload either produced an address or it did not.
         */
        if (!res.url) {
          throw new Error("Upload returned no address")
        }
        photoUrl = res.url
      }
      await updateProfile.mutateAsync({
        username: nameChanged ? username : assigned,
        // display_name is OMITTED, not emptied. This screen does not ask
        // for one (its regex is Latin-only — see CreateProfileStep), and
        // the schema that allows leaving it out also enforces min(3), so
        // the "" this used to send was rejected outright: an account with
        // no display name could not save a photo. Measured live.
        ...(me?.display_name ? { display_name: me.display_name } : {}),
        profile_photo_url: photoUrl ?? null,
      })
      navigate("/show-me")
    } catch (e) {
      // The API's own words when it has any a reader can use (a taken
      // name, a length rule); a written sentence when all it has is JSON.
      setError(
        e instanceof Error && e.message === "Upload returned no address"
          ? "Couldn't upload your photo. Nothing was changed."
          : humanApiError(e, "Could not save that. Try again."),
      )
      setSaving(false)
    }
  }

  return (
    <StepFrame
      title="This is you"
      banner={
        error ? (
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
            {error}
          </Alert>
        ) : undefined
      }
      hero={
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.25,
          }}
        >
          {/* THE AVATAR IS THE PICKER. A separate "upload photo" button
              would be a second control for one idea; the face people want
              to change is the thing they will press. */}
          <Box
            component="button"
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label="Change your photo"
            sx={{
              position: "relative",
              width: 96,
              height: 96,
              p: 0,
              border: 0,
              borderRadius: "50%",
              cursor: "pointer",
              background: "none",
              "&:hover .photo-veil": { opacity: 1 },
            }}
          >
            {shownPhoto ? (
              <Box
                component="img"
                src={shownPhoto}
                alt=""
                referrerPolicy="no-referrer"
                sx={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  objectFit: "cover",
                  display: "block",
                  boxShadow: "0 8px 28px -8px rgba(104,198,255,.55)",
                }}
              />
            ) : (
              <Box
                sx={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  background: "linear-gradient(180deg, #8AD4FF, #5EC1FF)",
                  color: "#06202e",
                  fontSize: "38px",
                  fontWeight: 800,
                  fontFamily: FONT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 8px 28px -8px rgba(104,198,255,.55)",
                }}
              >
                {(username || assigned).charAt(0).toUpperCase()}
              </Box>
            )}
            {/* A permanent badge, because the veil only speaks on hover and
                a first-time visitor has no reason to hover: the face has to
                look pressable at rest. */}
            <Box
              aria-hidden="true"
              sx={{
                position: "absolute",
                right: -2,
                bottom: -2,
                width: 30,
                height: 30,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                backgroundColor: "#68C6FF",
                color: "#06202E",
                boxShadow: "0 0 0 3px #06090F",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.2" />
              </svg>
            </Box>
            {/* The affordance: quiet at rest, explicit on hover. */}
            <Box
              className="photo-veil"
              sx={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(4,10,16,.55)",
                color: "#FFFFFF",
                fontSize: "12px",
                fontWeight: 700,
                fontFamily: FONT,
                opacity: 0,
                transition: "opacity 160ms ease-out",
              }}
            >
              Change
            </Box>
          </Box>
          <Box
            component="input"
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={pickPhoto}
            sx={{ display: "none" }}
          />

          <HandleField
            value={username}
            onChange={(e) => {
              setUsername((e.target as HTMLInputElement).value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !saving) void onContinue()
            }}
            variant="outlined"
            InputProps={{
              startAdornment: (
                <Typography
                  sx={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "rgba(255,255,255,.45)",
                    fontFamily: FONT,
                  }}
                >
                  @
                </Typography>
              ),
            }}
            inputProps={{
              autoCapitalize: "none",
              autoCorrect: "off",
              spellCheck: false,
              "aria-label": "Your username",
            }}
            sx={{ width: 240 }}
          />

          {/* X stays a door: OAuth leaves the page, it is not a field.
              LINKED IS twitter_id, not twitter_username: the users table has
              no such column (the service's type declares one anyway), so the
              first cut asked a question that could only ever answer
              "undefined" and offered the link to people who had already
              made it. x-oauth.controller writes twitter_id + twitter_url.

              CONNECT_X_ENABLED gates it, like the two surfaces that came
              before this one. I added this door without checking the flag
              and quietly re-opened a feature that was deliberately closed —
              a screen offering something the product has switched off is
              the same broken promise the flag exists to prevent. */}
          {CONNECT_X_ENABLED && !me?.twitter_id && (
            <Box
              component="button"
              type="button"
              // Says where back goes: declining X returns here, with the
              // username and photo still on screen to finish.
              onClick={() => navigate("/connect-x", { state: { from: "/claim" } })}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                mt: 0.5,
                px: 1.75,
                py: 0.875,
                borderRadius: "999px",
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,.12)",
                backgroundColor: "rgba(255,255,255,.05)",
                color: "rgba(255,255,255,.85)",
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: FONT,
                transition:
                  "background-color 160ms ease-out, border-color 160ms ease-out",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,.1)",
                  borderColor: "rgba(255,255,255,.25)",
                },
              }}
            >
              <XIcon sx={{ fontSize: 11 }} />
              Use my X handle
            </Box>
          )}
        </Box>
      }
      actions={
        <>
          <ContinueButton
            variant="contained"
            disabled={saving}
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : null}
            onClick={() => void onContinue()}
          >
            {saving ? "Saving..." : "Continue"}
          </ContinueButton>
          {/* "This is you" is exactly where a wrong account is noticed, so
              the way out lives here too, quietly. */}
          <QuietAction
            label={switching ? "Signing out…" : "Not you? Switch account"}
            disabled={switching || saving}
            onClick={() => {
              setSwitching(true)
              void switchAccount().finally(() => navigate("/signup"))
            }}
          />
        </>
      }
    />
  )
}
