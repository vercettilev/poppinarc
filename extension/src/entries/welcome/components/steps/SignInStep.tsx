import { ARC_EDITION } from "~/config/edition"
import { PHANTOM_LOGO_URI } from "~/assets/phantomLogoDataUri"
import { Alert, alpha, Box, Button, CircularProgress, SxProps, TextField, Theme } from "@mui/material"
import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "~/components/Toast/ToastProvider"
import { useInvitationCode } from "~/hooks/useInvitationCode"
import { useApplyReferralCode } from "~/hooks/useReferral"
import { CONNECT_X_ENABLED, PHANTOM_SIGNIN_ENABLED } from "~/config/features"
import { ONBOARDING_V2 } from "~/config/onboarding"
import { isNewbornAccount } from "~/helpers/accountAge"
import { openAuthTab } from "~/helpers/openAuthTab"
import { useAppConfigStore } from "~/store/useAppConfigStore"
import { StepProps } from "../types"

import { UserService } from "~/services/UserService"
import { QuietAction, StepFrame } from "../StepFrame"
import { ChipDemo } from "../ChipDemo"
import { SWITCH_FLAG } from "~/helpers/switchAccount"

interface SignInStepProps extends StepProps {}

/**
 * Connect X is a first-run offer, shown once per browser profile. Stored in
 * chrome.storage.sync (not local) so it travels with the person's Chrome
 * rather than greeting them again on every machine.
 */
const CONNECT_X_OFFERED_KEY = "poppinConnectXOffered"

// Shared field/button styling so every sub-step reads as one flow. The
// headings moved into StepFrame; these style what remains inside it.
const primaryBtnSx: SxProps<Theme> = {
  width: "100%",
  height: 52,
  backgroundColor: "#68C6FF",
  color: "#001018",
  textTransform: "none",
  fontWeight: 700,
  fontSize: "16px",
  fontFamily: "PoppinSans, sans-serif",
  borderRadius: "14px",
  "&:hover": { backgroundColor: "#5AB8F5" },
  "&:disabled": {
    backgroundColor: "rgba(104,198,255,0.25)",
    color: "rgba(255,255,255,0.5)",
  },
}

// Google + X, no email — the extension's sign-in step. Both third parties'
// OWN colours (white/black), not the brand accent: a button that borrows
// #68C6FF for someone else's login would look like this screen invented it.
// Email/OTP below (isInviteOnly, the actual /otp and /referral sub-steps)
// stays fully intact — only the FIRST sub-step's rendering changed, because
// only that sub-step is what a fresh sign-in actually reaches.
const googleBtnSx: SxProps<Theme> = {
  width: "100%",
  height: 52,
  backgroundColor: "#FFFFFF",
  color: "#111111",
  textTransform: "none",
  fontWeight: 700,
  fontSize: "15px",
  fontFamily: "PoppinSans, sans-serif",
  borderRadius: "14px",
  gap: 1,
  "&:hover": { backgroundColor: "#F0F0F0" },
  "&:disabled": { backgroundColor: "rgba(255,255,255,0.5)", color: "rgba(0,0,0,0.4)" },
}


function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}


const authFieldSx = (hasError: boolean): SxProps<Theme> => ({
  width: "100%",
  "& .MuiOutlinedInput-root": {
    backgroundColor: "rgba(255,255,255,0.04)",
    color: "white",
    height: "40px",
    "& fieldset": { borderColor: hasError ? "#FF453A" : "rgba(255,255,255,0.1)" },
    "&:hover fieldset": { borderColor: hasError ? "#FF453A" : "#4B5563" },
    "&.Mui-focused fieldset": { borderColor: hasError ? "#FF453A" : "#68C6FF" },
  },
  "& .MuiInputBase-input": {
    color: "white",
    fontSize: "0.85rem",
    padding: "8px 12px",
  },
  "& .MuiFormHelperText-root": {
    color: "#FF453A",
    fontSize: "0.75rem",
    lineHeight: 1.2,
    marginLeft: 0,
  },
})

export const SignInStep = ({
  onNext,
  refetchUser,
}: {
  onNext: (path: string) => void
  refetchUser: () => void
}) => {
  const { showToast } = useToast()

  const isInviteOnly = process.env.NEXT_PUBLIC_INVITE_ONLY === 'true'

  // Form states
  const [step, setStep] = useState<'email' | 'invitation' | 'referral'>(isInviteOnly ? 'invitation' : 'email')
  const [invitationCode, setInvitationCode] = useState('')
  const [invitationCodeError, setInvitationCodeError] = useState('')
  const [alertMessage, setAlertMessage] = useState('')
  /**
   * THE TAB YOU ARE HANDED BACK MUST SAY SOMETHING TRUE.
   *
   * The auth tab closes the moment sign-in lands and this tab activates
   * itself, deterministically, so the reader is looking at it - while
   * afterAuthed is still fetching /users/me to decide where they go. That
   * gap put them back on a sign-in screen with the buttons they had already
   * pressed, which reads as "it did not work" at exactly the moment it did.
   */
  const [handingOver, setHandingOver] = useState(false)
  // Referral-step state. User can submit a code or skip — either way the
  // next route is /create-profile.
  const [referralCodeInput, setReferralCodeInput] = useState('')
  const [referralCodeError, setReferralCodeError] = useState('')

  // Hooks
  const {
    mutate: validateInvitationCode,
    isPending: invitationCodeLoading,
    error: invitationCodeMutationError,
  } = useInvitationCode()

  const { mutateAsync: applyReferralCode, isPending: referralCodeLoading } =
    useApplyReferralCode()

  const { organization } = useAppConfigStore()
  const queryClient = useQueryClient()

  const poppinId = organization?.id



  // Handle invitation code validation
  useEffect(() => {
    if (invitationCodeMutationError) {
      setInvitationCodeError(invitationCodeMutationError.message || 'Invalid invitation code')
      setAlertMessage(invitationCodeMutationError.message || 'Invalid invitation code')
    }
  }, [invitationCodeMutationError])

  const handleValidateInvitationCode = () => {
    if (!invitationCode.trim()) {
      setInvitationCodeError('Please enter an invitation code')
      return
    }

    // Clear any previous errors
    setInvitationCodeError('')

    validateInvitationCode(invitationCode, {
      onSuccess: () => {
        // Store the invitation code in sessionStorage
        sessionStorage.setItem('invitation_code', invitationCode)
        showToast('Invitation code validated successfully', 'success')
        // Code accepted — on to sign-in itself.
        setStep('email')
      },
      onError: (error) => {
        // Set error message directly here as well
        setInvitationCodeError(error.message || 'Invalid invitation code')
      }
    })
  }

  const [socialBusy, setSocialBusy] = useState(false)

  /**
   * The routing decision after ANY auth method lands a session — OTP and
   * social both end here. Factored out because it's the part that actually
   * matters (new user? referral step. existing-legacy? finish the post-
   * profile flow. fully onboarded? straight to the main app.) and social
   * sign-in needs the identical decision, just without the verify-otp
   * response to read `user` off of first.
   */
  const afterAuthed = async (knownUser?: { username?: string | null }) => {
    sessionStorage.removeItem('invitation_code')
    setAlertMessage('')
    setHandingOver(true)
    /**
     * ONBOARDING IS SEEN. The only writers of this flag lived in the
     * legacy branch V2's early-return makes unreachable and in the retired
     * popup - so every REINSTALL reopened the welcome tab for a person who
     * already has an account. "Signed in and recognized" is the bar the
     * background's comment demanded; this is that moment.
     */
    let seenOnboardingBefore = false
    try {
      /* Read BEFORE write, because the claim decision below needs the
         PRIOR answer: "has this browser been through onboarding before"
         is destroyed the moment the flag is set, and setting it first is
         exactly how a reinstall got greeted like a stranger. */
      const prior = await chrome.storage.sync.get("poppinHasSeenOnboarding")
      seenOnboardingBefore = prior?.poppinHasSeenOnboarding === true
      void chrome.storage.sync.set({ poppinHasSeenOnboarding: true })
    } catch {
      // Storage refusing changes nothing about the sign-in itself.
    }

    let freshUser: any = knownUser ?? null
    if (!freshUser) {
      // One fetch, and it lands IN the cache. This used to call
      // getCurrentUser() and then refetchUser(): two GET /users/me in a row,
      // the first of which was thrown away because nothing wrote it to the
      // cache. That was a whole round trip of dead time between the tap and
      // the next screen, on the primary sign-in path.
      try {
        freshUser = await queryClient.fetchQuery({
          queryKey: ["current-user"],
          queryFn: () => UserService.getCurrentUser(),
          // Never serve the cache here. Whoever was signed in a moment ago
          // may not be who just signed in, and this value decides where they
          // land. The removed removeQueries() used to enforce that by
          // emptying the cache first, at the cost of nudging the live
          // observer into a fetch of its own.
          staleTime: 0,
        })
      } catch {
        // network blip — freshUser stays null, routes to /connect-x same as
        // a brand-new user would. Not ideal, but never a dead end.
      }
    } else {
      // Caller already knows who this is; just make sure the cache agrees.
      try { refetchUser() } catch {}
    }

    // Connect X is the ONE screen between signing in and the product, and it
    // is offered once per browser profile.
    //
    // It used to be gated on "has no username yet", which worked only while
    // accounts arrived nameless. They don't any more — the backend assigns a
    // username at creation, precisely so nobody has to stop and type one —
    // so that test would now send every single person straight past this
    // screen. A local once-flag says what we actually mean: this is a
    // first-run offer, not a repair for missing data.
    //
    // Someone genuinely still nameless (an older account, or a failed
    // assignment) is sent to pick one; that screen skips itself when the name
    // turns out to be set, so it is never a dead end.
    if (!freshUser?.username) {
      onNext("/create-profile")
      return
    }

    // A BRAND-NEW account gets one screen the payoff never carries: its
    // own identity, shown, with the optional doors to change it. Age, not
    // a flag, because the sign-in bridge forwards only the token and the
    // account's birth timestamp already answers the question (see
    // helpers/accountAge — every unknowable reads as "existing", so a
    // returning user can never be shown a newborn's screen by accident).
    /* Newborn AND first time in this browser. The age test alone showed
       the identity screen to somebody who created the account, uninstalled
       and reinstalled inside fifteen minutes — recognised perfectly (the
       screen greeted them with their own handle) and still read like a
       second registration. The sync flag survives a reinstall, which is
       precisely the property the age test lacks. */
    if (
      ONBOARDING_V2 &&
      isNewbornAccount(freshUser?.created_at) &&
      !seenOnboardingBefore
    ) {
      onNext("/claim")
      return
    }

    // Connect X is off (see ~/config/features.ts) -- straight to the
    // product. Usernames are auto-assigned now, so skipping this costs
    // nobody a name; the once-per-profile bookkeeping below only matters
    // while the screen is actually reachable.
    if (!CONNECT_X_ENABLED) {
      onNext("/final")
      return
    }

    let alreadyOffered = false
    try {
      const stored = await chrome.storage?.sync?.get?.(CONNECT_X_OFFERED_KEY)
      alreadyOffered = Boolean(stored?.[CONNECT_X_OFFERED_KEY])
    } catch {
      // storage unavailable — treat as "not offered". Worst case someone
      // sees an optional, skippable screen twice.
    }

    if (alreadyOffered) {
      onNext("/final")
      return
    }

    try {
      await chrome.storage?.sync?.set?.({ [CONNECT_X_OFFERED_KEY]: true })
    } catch {
      // best effort
    }
    onNext("/connect-x")
  }

  // Picks up background/main.ts's EXTENSION_SIGNIN_COMPLETE broadcast, sent
  // after its onMessageExternal listener finishes signInWithCustomToken for
  // a Google sign-in relayed from the app.poppin.so/auth tab (see
  // handleGoogleSignIn below). Same chrome.runtime.onMessage API popup/
  // App.tsx already uses for its own inbound messages.
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === "EXTENSION_SIGNIN_COMPLETE") {
        afterAuthed()
        // BRING THIS TAB BACK. The auth tab closes the instant sign-in
        // lands, and most browsers then return focus to the opener — but
        // "most" is how the Brave sign-in saga started. Self-activating is
        // deterministic in all of them, so the reader is LOOKING at
        // You're in the moment it exists, with no tab to hunt for.
        void chrome.tabs
          .getCurrent()
          .then((tab) => {
            if (tab?.id !== undefined) {
              void chrome.tabs.update(tab.id, { active: true })
            }
          })
          .catch(() => {
            // Focus is a nicety; sign-in already succeeded.
          })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [onNext, refetchUser])

  /**
   * Google sign-in: ONE flow, in every browser.
   *
   * This button opens app.poppin.so/auth with provider=google, and that
   * page goes straight to Google via redirect — the only Google screen the
   * reader ever sees. The token comes back over two channels at once (the
   * page's own runtime message, and the content-script relay that works
   * even where Brave withholds chrome.runtime from pages), the background
   * signs in and broadcasts EXTENSION_SIGNIN_COMPLETE, the effect above
   * turns that into afterAuthed(), and the background closes the auth tab.
   *
   * There USED to be a second, Chrome-only path here —
   * chrome.identity.getAuthToken, the browser's own account picker. It was
   * genuinely one press shorter in Chrome and it still went: every browser
   * that is not Chrome shims or stubs that API (Brave ends on a Google 400
   * error page), so the product had two sign-in flows, and the reader who
   * switched browsers got the one we tested less. "Her browserda aynı flow
   * olmalı" — one flow, tested everywhere, beats a shortcut somewhere.
   */
  /**
   * THE BIGGEST HOLE IN THE FUNNEL HAD NO INSTRUMENT ON IT.
   *
   * Measured 2026-09-25: 39 readers reached this screen, 15 reached the
   * permission step after it, and of those 12 granted and NOT ONE refused.
   * So the permission screen is fine and the loss is here, on the door
   * before it: twenty-four people arrived at sign-in and never came out.
   *
   * Nothing said whether they pressed a button and it failed, or never
   * pressed one at all, and those are opposite repairs. Pressed is
   * recorded here; completed is already recorded by the background when a
   * token lands, so the gap between the two is abandonment.
   */
  const track = (action: string, method?: "google" | "wallet") => {
    try {
      void chrome.runtime.sendMessage({
        type: "SPOT_TELEMETRY",
        event: "onboarding_step",
        payload: { step: "/signup", action, ...(method ? { method } : {}) },
      })
    } catch {
      // Counting is never worth failing the door over.
    }
  }

  const handleGoogleSignIn = async () => {
    setSocialBusy(true)
    setAlertMessage('')
    track("pressed", "google")

    try {
      // provider=google: the reader already chose Google by pressing THIS
      // button, so the web page skips its own landing and goes straight to
      // Google via redirect — one Google screen total.
      /* After "Switch account" the bridge must show Google's picker rather
         than hand back the last session; the flag is one-shot. */
      let switching = false
      try {
        switching = sessionStorage.getItem(SWITCH_FLAG) === "1"
        if (switching) sessionStorage.removeItem(SWITCH_FLAG)
      } catch {
        // No storage, no forced picker.
      }
      const url =
        process.env.NEXT_PUBLIC_WEB_URL + "/auth?fromExtension=1&provider=google" +
        (poppinId ? `&widgetId=${poppinId}` : "") +
        (switching ? "&switch=1" : "")
      /* THE PRESS IS THE ONLY GESTURE WE GET, and openAuthTab spends it on
         the relay's origin BEFORE the tab navigates. Nothing above this
         line awaits, deliberately: an await here would end the gesture and
         Chrome would refuse to prompt. See helpers/openAuthTab. */
      const tab = await openAuthTab(url)

      // If the person just closes the tab without finishing sign-in, don't
      // leave the button permanently disabled. Harmless after a successful
      // sign-in too — by then this step has already navigated away via
      // afterAuthed(), and the background is the one closing the tab.
      if (tab.id !== undefined) {
        const tabId = tab.id
        const onRemoved = (removedTabId: number) => {
          if (removedTabId !== tabId) return
          chrome.tabs.onRemoved.removeListener(onRemoved)
          setSocialBusy(false)
        }
        chrome.tabs.onRemoved.addListener(onRemoved)
      }
    } catch {
      track("failed", "google")
      setAlertMessage('Could not open the Google sign-in page.')
      setSocialBusy(false)
    }
  }


  // Apply a referral code, then continue to profile creation. Errors surface
  // inline via referralCodeError; network / validation failures do NOT block
  // the user from skipping afterwards.
  /**
   * THE WALLET LEG: same tab, same bridge, provider=phantom. The page
   * connects Phantom and signs a sentence; the token comes back the way
   * Google's does, so nothing below this screen knows the difference.
   */
  const handlePhantomSignIn = async () => {
    setSocialBusy(true)
    setAlertMessage('')
    track("pressed", "wallet")
    try {
      const url =
        process.env.NEXT_PUBLIC_WEB_URL + "/auth?fromExtension=1&provider=phantom" +
        (poppinId ? `&widgetId=${poppinId}` : "")
      // Same door, same order: grant, then navigate. The wallet leg lands
      // its token through the identical two channels.
      const tab = await openAuthTab(url)
      if (tab.id !== undefined) {
        const tabId = tab.id
        const onRemoved = (removedTabId: number) => {
          if (removedTabId !== tabId) return
          chrome.tabs.onRemoved.removeListener(onRemoved)
          setSocialBusy(false)
        }
        chrome.tabs.onRemoved.addListener(onRemoved)
      }
    } catch {
      track("failed", "wallet")
      setAlertMessage('Could not open the Phantom sign-in page.')
      setSocialBusy(false)
    }
  }
  const handleApplyReferral = async () => {
    const code = referralCodeInput.trim()
    if (!code) {
      setReferralCodeError('Please enter a referral code')
      return
    }
    setReferralCodeError('')
    try {
      await applyReferralCode(code)
      showToast('Referral code applied', 'success')
      onNext('/create-profile')
    } catch (err: any) {
      setReferralCodeError(err?.message || 'Invalid referral code')
    }
  }

  const handleSkipReferral = () => {
    onNext('/create-profile')
  }

  const handleInvitationCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleValidateInvitationCode()
  }

  // Errors ride StepFrame's banner slot: in the column, directly above the
  // actions, so the message sits with the button it explains instead of
  // floating over the screen in its own coordinate system.
  const errorBanner = alertMessage ? (
    <Alert
      severity="error"
      onClose={() => setAlertMessage("")}
      sx={{
        width: "100%",
        backgroundColor: "rgba(211, 47, 47, 0.1)",
        color: "white",
        "& .MuiAlert-icon": { color: "#FF453A" },
        "& .MuiIconButton-root": {
          color: "white",
          padding: "4px",
          "& .MuiSvgIcon-root": { fontSize: "1rem" },
        },
      }}
    >
      {alertMessage}
    </Alert>
  ) : undefined

  return (
    <>
      {step === "email" ? (
        // One way in, and that is deliberate. X used to sit here as a second
        // sign-in button, which would have let the same person arrive as two
        // separate accounts — two embedded wallets, split balances, split
        // history — because a provider that returns no email gives Firebase
        // nothing to merge on. X is now offered right after this, as a
        // connect step that attaches to the account that already exists, so
        // it can only ever add to an identity rather than fork one.
        //
        // No hero either. It used to float the provider marks as tilted tiles
        // in a glow — FOMO's Connect-X composition with our logos dropped in,
        // printing each mark twice since they are already on the buttons.
        // Sign-in is a decision screen; the button IS the content.
        <StepFrame
          title={ARC_EDITION ? "See it. Tap it. It's yours." : "Trade from the tweet."}
          // The one thing the chip below cannot show is WHERE it shows up;
          // one calm line carries that, three concrete places rather than
          // three brand names. Folded into the headline it ran to four
          // lines and read as a wall.
          subtitle={ARC_EDITION ? "Right where you read. Powered by Circle." : ONBOARDING_V2 ? "Tokens and tokenized stocks. On X, Reddit, and everywhere else you scroll." : "One account to trade the internet."}
          // The chip itself, drawn as the product draws it, under a tweet
          // that never said a cashtag.
          hero={ONBOARDING_V2 ? <ChipDemo /> : undefined}
          banner={errorBanner}
          actions={
            <>
              <Button
                onClick={handleGoogleSignIn}
                disabled={socialBusy}
                sx={googleBtnSx}
                startIcon={<GoogleGlyph />}
              >
                {/* The label swaps rather than just dimming: first cold open
                    of Google's account picker is not instant, and a tap with
                    zero feedback reads as "did that register?" on the one
                    button this whole screen is about. */}
                {socialBusy ? "Signing in…" : "Continue with Google"}
              </Button>
              {PHANTOM_SIGNIN_ENABLED && (
                <Button
                  onClick={handlePhantomSignIn}
                  disabled={socialBusy}
                  sx={{
                    ...googleBtnSx,
                    mt: 1.25,
                    backgroundColor: "#AB9FF2",
                    color: "#1C1530",
                    "&:hover": { backgroundColor: "#B9AEF5" },
                  }}
                  startIcon={
                    <Box
                      component="img"
                      src={PHANTOM_LOGO_URI}
                      alt=""
                      sx={{ width: 20, height: 20, borderRadius: "5px", display: "block" }}
                    />
                  }
                >
                  {socialBusy ? "Signing in…" : "Continue with Phantom"}
                </Button>
              )}
            </>
          }
        />
      ) : step === "invitation" ? (
        <StepFrame
          title="Welcome to Poppin"
          subtitle="Enter your invitation code to get started."
          banner={errorBanner}
          actions={
            <>
              <QuietAction
                label="Already have an account? Sign in"
                onClick={() => { setStep("email"); setAlertMessage("") }}
              />
              <Button
                variant="contained"
                disabled={invitationCodeLoading || !invitationCode || !!invitationCodeError}
                sx={primaryBtnSx}
                onClick={handleValidateInvitationCode}
              >
                {invitationCodeLoading ? "Validating..." : "Continue"}
              </Button>
            </>
          }
        >
          <Box component="form" onSubmit={handleInvitationCodeSubmit}>
            <TextField
              type="text"
              placeholder="Enter invitation code"
              value={invitationCode}
              onChange={(e) => {
                setInvitationCode(e.target.value)
                if (invitationCodeError) setInvitationCodeError("")
              }}
              error={!!invitationCodeError}
              helperText={invitationCodeError}
              disabled={invitationCodeLoading}
              size="small"
              autoFocus
              sx={authFieldSx(!!invitationCodeError)}
            />
          </Box>
        </StepFrame>
      ) : (
        <StepFrame
          title="Got a referral code?"
          subtitle="Link a friend's code, or skip."
          banner={errorBanner}
          actions={
            <>
              <QuietAction
                label="I'll do this later"
                onClick={handleSkipReferral}
                disabled={referralCodeLoading}
              />
              <Button
                variant="contained"
                disabled={referralCodeLoading || !referralCodeInput.trim()}
                sx={primaryBtnSx}
                onClick={handleApplyReferral}
              >
                {referralCodeLoading ? "Applying..." : "Apply code"}
              </Button>
            </>
          }
        >
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault()
              handleApplyReferral()
            }}
          >
            <TextField
              type="text"
              placeholder="Enter referral code (optional)"
              value={referralCodeInput}
              onChange={(e) => {
                setReferralCodeInput(e.target.value.toUpperCase())
                if (referralCodeError) setReferralCodeError("")
              }}
              error={!!referralCodeError}
              helperText={referralCodeError}
              disabled={referralCodeLoading}
              size="small"
              autoFocus
              inputProps={{ maxLength: 16, style: { textTransform: "uppercase", letterSpacing: "1px" } }}
              sx={authFieldSx(!!referralCodeError)}
            />
          </Box>
        </StepFrame>
      )}

      {/*
        THE HANDOVER BEAT. Between "signed in" and the screen that comes
        next there is one round trip to /users/me, and the tab activates
        itself at the START of it - so without this the reader is handed
        back a sign-in screen carrying the buttons they already pressed.
        It covers the surface deliberately: there is nothing on it they
        should touch while it resolves, and every route out of afterAuthed
        replaces this view.
      */}
      {handingOver && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "grid",
            placeItems: "center",
            backgroundColor: alpha("#0A0E14", 0.92),
            backdropFilter: "blur(2px)",
          }}
        >
          <Box sx={{ display: "grid", justifyItems: "center", gap: 1.5 }}>
            <CircularProgress size={26} sx={{ color: "#68C6FF" }} />
            <Box
              sx={{
                fontSize: 14,
                fontWeight: 600,
                color: alpha("#FFFFFF", 0.82),
              }}
            >
              Signing you in&hellip;
            </Box>
          </Box>
        </Box>
      )}
    </>
  )
}
