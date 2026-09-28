import { BRAND_GROUND } from "~/helpers/brandGround"
import { dueMarks } from "./dwell"
import { Box } from "@mui/material"
import { useEffect, useRef, useState } from "react"
import { Route, Routes, useLocation, useNavigate } from "react-router"
import "~/assets/logo.png"
import { addCustomFonts } from "~/helpers/fontHelper"
import { checkPermissions } from "~/helpers/permissionHelper"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { User } from "~/services/UserService"
import { CreateProfileStep } from "./components/steps/CreateProfileStep"
import { FinalStep } from "./components/steps/FinalStep"
import { PermissionsStep } from "./components/steps/PermissionsStep"
import { QuickStartStep } from "./components/steps/QuickStartStep"
import { YoureInStep } from "./components/steps/YoureInStep"
import { ONBOARDING_V2 } from "~/config/onboarding"
import { SignInStep } from "./components/steps/SignInStep"
import { ConnectXStep } from "./components/steps/ConnectXStep"
import { ClaimIdentityStep } from "./components/steps/ClaimIdentityStep"
import { ShowMeStep } from "./components/steps/ShowMeStep"
// Post-profile onboarding (Intro → Venue → Network → Fund → Notifications,
// with the Kalshi branch splitting after Venue). Each step lives in its
// own file and renders the OnboardingShell directly — so we do NOT wrap
// these routes in a MUI <Container>: that was clipping the full-bleed
// dark canvas to 1200 px and leaving black bars on wide monitors.


const App = () => {
  const [isInitializing, setIsInitializing] = useState(true)
  const v2Routed = useRef(false)
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * EVERY SCREEN OF THIS FLOW, COUNTED BY ITS ROUTE.
   *
   * Eight steps shipped with zero instrumentation, and the cost of that
   * was measured the day this hook was added: 87 of the 107 installs
   * active in the chip era had never signed in, and nothing could say
   * which screen they closed the tab on. Steps here ARE routes, so one
   * hook covers all of them and a step added next month is counted
   * without anyone remembering to.
   *
   * A Set rather than a `cancelled` flag, per the house rule: StrictMode
   * runs effects twice in dev and a flag only guards state writes, never
   * the second sendMessage. Try/catch because onboarding must survive a
   * telemetry failure — the message channel dying is the reader's cue to
   * nothing.
   */
  const seenSteps = useRef<Set<string>>(new Set())
  useEffect(() => {
    const step = location.pathname
    if (seenSteps.current.has(step)) return
    seenSteps.current.add(step)
    try {
      void chrome.runtime.sendMessage({
        type: "SPOT_TELEMETRY",
        event: "onboarding_step",
        payload: { step },
      })
    } catch {
      // The page may be orphaned mid-update; counting is not worth a throw.
    }
  }, [location.pathname])

  /**
   * HOW LONG THEY LOOKED, which the step event above cannot say.
   *
   * Every onboarding event fires on load, so first-event-to-last-event
   * measures the page settling, not the person reading. Measured
   * 2026-09-25: the twenty-seven readers who never finished sign-in had a
   * median span of ONE SECOND, a number equally consistent with a bounce
   * and with five minutes of reading. Marks laid down during the visit
   * separate them, and they survive a killed tab in a way an unload
   * beacon does not. See ./dwell for why marks and why visible-only.
   */
  useEffect(() => {
    const step = location.pathname
    const fired = new Set<number>()
    let visibleMs = 0
    let last = Date.now()
    const tick = () => {
      const now = Date.now()
      if (document.visibilityState === "visible") visibleMs += now - last
      last = now
      for (const seconds of dueMarks(visibleMs, fired)) {
        fired.add(seconds)
        try {
          void chrome.runtime.sendMessage({
            type: "SPOT_TELEMETRY",
            event: "onboarding_step",
            payload: { step, action: "dwell", seconds },
          })
        } catch {
          // Same posture as the step event: counting never breaks the flow.
        }
      }
    }
    const id = setInterval(tick, 1000)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [location.pathname])
  const {
    data: user,
    isLoading: isUserLoading,
    refetch: refetchUser,
  } = useCurrentUser()


  // Welcome tab always starts at the email entry screen — EVEN if the
  // browser has a cached Firebase auth session for someone. The product
  // requirement is: opening the extension = ask for the email. The
  // session-aware routing (skip to /onboarding/intro for existing-no-
  // venue users, /final for fully-onboarded users) runs AFTER the user
  // verifies an OTP, not before.
  //
  // Why: a tester who uninstalled / signed out / shared a Chrome profile
  // would otherwise silently re-enter the prior session — which the
  // user perceives (correctly) as a bypass of the login screen.
  const onPermissionNext = (_optUser?: User) => {
    // A signed-in user reaching this step (see below) has nothing to do at the
    // sign-in screen; everyone else continues to it.
    navigate(user ? "/final" : "/signup")
  }

  useEffect(() => {
    addCustomFonts()
  }, [])

  useEffect(() => {
    if (ONBOARDING_V2) {
      // ONCE, on mount — this effect's deps are [user, isUserLoading], and
      // without the guard every user-data refresh re-ran this branch and
      // re-navigated to /signup. That was the "invite code throws me back to
      // the email screen" bug: verify-OTP and profile creation both refetch
      // the user, the refetch landed, and whatever step the person was on
      // was yanked back to the start of sign-in.
      if (v2Routed.current) return
      // V2 has TWO entrances and they must not share a screen (they did, and
      // a person pressing "sign in" met the same "You're set" they saw at
      // install — a door opening onto itself):
      //   plain open        → QuickStartStep (install: welcome + permission)
      //   ?flow=signin      → the real sign-in flow, from the card's ladder
      const flow = new URLSearchParams(window.location.search).get("flow")
      if (flow === "signin") {
        v2Routed.current = true
        navigate("/signup")
        setIsInitializing(false)
      } else if (flow === "done") {
        // QA / store-screenshot entrance to the closing screen. Harmless:
        // the screen is reachable by finishing sign-in anyway.
        v2Routed.current = true
        navigate("/show-me")
        setIsInitializing(false)
      } else {
        /**
         * A PLAIN OPEN WAITS TO LEARN WHO ARRIVED, and that is a repeal.
         *
         * The rule this replaces — route to sign-in before the session
         * loads, "EVEN if the browser has a cached session" — was written
         * for the email-OTP flow, where a shared Chrome profile silently
         * re-entering somebody's session genuinely looked like a login
         * bypass. With Google sign-in the same rule manufactured a broken
         * loop instead, found by walking the flow as a new user: finish
         * onboarding, land on X, press the browser's BACK button, and the
         * welcome page remounts and demands sign-in from a person who
         * signed in a minute ago. Every back-press repeated it. Nothing
         * was wrong with the session; the router just never asked.
         *
         * Waiting costs a moment of blank (isInitializing already gates
         * the first paint), and only on the plain entrance: both ?flow
         * doors above still route immediately, because they carry the
         * person's own stated intent.
         */
        if (isUserLoading) return
        // Plain open — the install entrance, which QuickStartStep owns. But
        // its welcome pitch has something to SAY only to someone who hasn't
        // granted the host permission yet: a test build (grantUpFront in
        // manifest.ts promotes it to required) and any real returning user
        // who granted it in a prior session both start already-granted, and
        // for them the screen was a one-click no-op wearing a full page —
        // same logo, new headline, no different from the sign-in screen
        // it immediately hands off to. Checking here, before the first
        // paint (isInitializing still gates rendering to null), means an
        // already-granted visitor never sees it flash by; a genuinely fresh
        // install still lands on QuickStartStep and gets asked for real.
        v2Routed.current = true
        /* The permission is no longer the first question, so it no longer
           decides the first screen. A signed-in visitor lands on the last
           step (whose one button opens X, and asks for the permission only
           if it is still missing); everyone else starts at sign-in. */
        navigate(user ? "/show-me" : "/signup")
        setIsInitializing(false)
      }
      return
    }
    if (isUserLoading) {
      return
    }
    if (user) {
      // Mark this Chrome profile as having completed onboarding so a
      // future uninstall+reinstall doesn't re-open this welcome tab. We
      // only set the flag once the user is loaded (i.e. signed in and the
      // backend recognises them); a half-finished sign-in shouldn't count.
      // chrome.storage.sync survives reinstall when Chrome sync is on.
      try {
        chrome.storage?.sync?.set?.({ poppinHasSeenOnboarding: true })
      } catch {
        // sync may be unavailable; the worst case is the welcome tab
        // re-opens on next install — recoverable, not user-facing.
      }
      // Signed in does NOT imply granted. The permissions are optional, the
      // welcome flow used to be the only thing that requested them, and a
      // returning user can be signed in with the grant missing (reinstall,
      // revoked in chrome://extensions, new machine with synced onboarding
      // flag). Without this check that user never sees the request again and
      // no content script is ever injected — so check here, for everyone.
      checkPermissions().then((granted) => {
        if (!granted) {
          navigate("/")
        } else {
          navigate("/final")
        }
        setIsInitializing(false)
      })
    } else {
      // check if extension is
      checkPermissions().then((res) => {
        if (!res) {
          navigate("/")
        } else {
          onPermissionNext()
        }
        setIsInitializing(false)
      })
    }
  }, [user, isUserLoading])

  if (isInitializing) {
    return null
  }

  // Root container — full-bleed dark canvas with the same radial bg +
  // ambient blue auroras used by OnboardingShell, so EVERY welcome
  // route (Permissions, SignIn, CreateProfile, the onboarding steps,
  // Final) shares one consistent backdrop. Without this, screens that
  // don't wrap themselves in OnboardingShell (PermissionsStep,
  // SignInStep, FinalStep) showed a flat #000 with their card pinned
  // to the top of the viewport — visually inconsistent with the
  // onboarding flow and the card looked "lost at the top".
  //
  // Flex-centering centers the route's card vertically + horizontally.
  // OnboardingShell-wrapped routes still set their own minHeight: 100vh
  // and re-paint the gradient (covers harmlessly).
  return (
    <Box
      sx={{
        minHeight: "100vh",
        width: "100%",
        position: "relative",
        // The card's ground, from the one shared source — an older aurora
        // variant lived here before the panel/card/welcome unification.
        ...BRAND_GROUND,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Routes>
        <Route
          path="/"
          element={
            ONBOARDING_V2 ? (
              <QuickStartStep />
            ) : (
              <PermissionsStep onNext={onPermissionNext} />
            )
          }
          index
        />
        <Route
          path="/final"
          element={<FinalStep onNext={() => navigate("/")} />}
        />
        <Route
          path="/signup"
          element={
            <SignInStep
              onNext={(path) => {
                // V2 ends at the payoff screen, not the legacy destinations:
                // /final is V1's closing screen, /onboarding/intro is V1's
                // venue-capture flow — both replaced by "You're in!" + the
                // demo choice. V1 (flag off) keeps its own routing.
                if (path === "/final" || path === "/onboarding/intro") {
                  navigate("/show-me")
                  return
                }
                navigate(path)
              }}
              refetchUser={refetchUser}
            />
          }
        />
        <Route path="/youre-in" element={<YoureInStep />} />
        {/* The last step: the permission prompt, framed in one line, and
            the handoff to a real X page with a real chip. */}
        <Route path="/show-me" element={<ShowMeStep />} />
        {/* Newborn accounts only — SignInStep routes here when the account
            is minutes old (helpers/accountAge). Every door out of the step
            ends on /youre-in, so the payoff is never skippable-by-accident. */}
        <Route path="/claim" element={<ClaimIdentityStep />} />
        {/* Both sign-up screens mount StepFrame directly, like /signup —
            NOT inside OnboardingShell. The shell paints a 680–1080px
            frosted card, and StepFrame is already a centered 460px column
            with its own full-height canvas: nesting them put the new
            anatomy inside the old card, so the two screens either side of
            sign-in didn't look like the same product. */}
        <Route
          path="/connect-x"
          element={
            <ConnectXStep
              // Linked, or declined: either way the account has a name and
              // there is nothing left to ask. V2 returns to its own payoff
              // screen — /final is V1's closer, and the identity pill on
              // "You're in!" is what sent the reader here in the first place.
              onDone={() => navigate(ONBOARDING_V2 ? "/show-me" : "/final")}
              // Only for an account that somehow still has no username.
              // Accounts are created with one now, so this is the safety
              // net rather than the other half of the flow.
              onNeedsUsername={() => navigate("/create-profile")}
            />
          }
        />
        <Route
          path="/create-profile"
          element={
            <CreateProfileStep
              onSuccess={() => {
                // Setup ends here. Venue/fund/notifications used to follow
                // in a line before anyone had seen a single card; they are
                // still routed below, just asked at the moment they
                // actually matter (funding at the first trade, and so on).
                //
                // /youre-in, not /final -- this call used to bypass the
                // /signup route's own onNext wrapper (the one just above,
                // which redirects /final to /youre-in in V2) because it
                // navigates directly rather than through that prop. The
                // effect: everyone who signs in with a name already lands
                // on the new payoff screen, but anyone routed here first --
                // today that's only a pre-fix account still missing a
                // username, since new accounts arrive named -- fell through
                // to the old 560-line search screen instead. Same
                // destination for both paths now.
                navigate(ONBOARDING_V2 ? "/show-me" : "/youre-in")
              }}
            />
          }
        />
      </Routes>
    </Box>
  )
}

export default App
