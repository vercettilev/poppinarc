import { Paper, Theme, useTheme } from "@mui/material"
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useState, useRef} from "react"
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router"
import Loading from "~/components/Loading"
import { syncStore } from "~/helpers"
import { BRAND_GROUND } from "~/helpers/brandGround"
import { checkPermissions } from "~/helpers/permissionHelper"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useAppConfigStore, useEnvironmentStore } from "~/store/useAppConfigStore"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { useRefreshStore } from "~/store/useRefreshStore"
import { useUIStore } from "~/store/useUIStore"
import { CAP } from "~/config/edition"
import "./App.css"


import Layout from "~/components/Layout"
import { CreateProfileStep } from "~/entries/welcome/components/steps/CreateProfileStep"
import Comment from "~/views/comment"
import EditProfile from "~/views/edit-profile"
import Profile from "~/views/profile"
import { needsProfileSetup } from "~/helpers/profileGate"
import Receive from "~/views/receive"
import ReferralProgram from "~/views/referral-program"
import Settings from "~/views/Settings"
import WalletUI from "~/views/wallet-ui"
import FlywheelLeaderboard from "~/views/FlywheelLeaderboard"
import Callers from "~/views/Callers"
import LiveChat from "~/views/live-chat"
import SpotPositions from "~/views/SpotPositions"
import TokenView from "~/views/TokenView"
import Discover from "~/views/Discover"

const SignInModal = lazy(() => import("~/components/SignInModal"))

/**
 * THE ACTION-MENU DIALOGS ARE NOT HERE. They live in components/Layout.tsx,
 * once.
 *
 * This file used to render its own Delete and Report CDialogs off the SAME
 * useActionMenuDialogStore, above <Routes> — and every route below is a child
 * of the layout route <Route element={<Layout />}>, which renders the same two
 * dialogs bound to the same store field. One `dialogMode === "delete"` opened
 * BOTH: two MUI Modals, two backdrops, two stacked Papers. Layout's copy is
 * the richer one (it carries the admin "reason for deletion" field and the
 * guard that disables Delete until the reason is typed), so the copy that
 * survives is Layout's.
 *
 * Adding a route OUTSIDE the layout route would give that route no dialogs at
 * all. If you ever need one, move the dialogs up here — do not re-add a second
 * copy beside Layout's.
 */
function App() {




  const [hasOpenedWelcome, setHasOpenedWelcome] = useState(false)

  const navigate = useNavigate()


  if (localStorage) { // fix for API
    localStorage.removeItem("firebase:previous_websocket_failure");
  }

  const { primaryColor, organization, setCurrentPath } = useAppConfigStore()
  const { currentUrl } = useCurrentUrlStore()
  
 
  const location = useLocation()
  const params = useParams()
  const currentRoute = location.pathname
  const { environment } = useEnvironmentStore()

  /**
   * WHICH SCREENS OF THE APP GET LOOKED AT. Same shape as the welcome
   * flow's step counter: screens here are routes, so one hook covers all
   * nineteen and next month's screen is counted without anyone
   * remembering to. Dynamic segments are folded to their pattern —
   * /token/<mint> is one screen called /token, not a thousand screens —
   * so the answer stays readable and no identifier rides along.
   *
   * Consecutive-duplicate guard rather than a Set: a person bouncing
   * between two screens is usage worth counting, the same render firing
   * twice (StrictMode) is not, and one ref distinguishes them. Gated to
   * the sidepanel environment so a stray popup or dev harness counts
   * nothing.
   */
  const lastViewRef = useRef<string | null>(null)
  useEffect(() => {
    if (environment !== "sidepanel") return
    const view = currentRoute
      .replace(/^\/token\/.+$/, "/token")
      .replace(/^\/post\/.+$/, "/post")
      .replace(/^\/profile\/.+$/, "/profile")
    if (lastViewRef.current === view) return
    lastViewRef.current = view
    try {
      void chrome.runtime.sendMessage({
        type: "SPOT_TELEMETRY",
        event: "panel_view",
        payload: { view },
      })
    } catch {
      // Counting is never worth failing a screen over.
    }
  }, [currentRoute, environment])

  useEffect(() => {
    const unsub = syncStore()
    return () => {
      unsub()
    }
  }, [])

  // A `ROUTE_CHANGED` message fired at the active tab on every navigation
  // stood here. `ROUTE_CHANGED` had no listener anywhere in the extension —
  // not in either content script, not in the background — so the panel woke a
  // tab up on every route change to tell it nothing.

  const paperStyles = useMemo(() => (theme: Theme) => ({
    overflow: "hidden" as const,
    minHeight: {
      "@0": "100svh",
      "@768": "600px"
    },
    height: {
      "@0": "100svh",
      "@768": "600px"
    },
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    flex: 1,
    [theme.breakpoints.down(768)]: {
      minHeight: "100svh",
      height: "100svh",
    },
  }), [])

  const theme =  useTheme()

  const refreshKey = useRefreshStore((state) => state.key)

  const { data: currentUser, refetch, handleFirebaseAuth, isLoading } = useCurrentUser()

  // Once we recognise a logged-in user, persist a Chrome-synced flag so a
  // future uninstall+reinstall on the same Chrome profile doesn't re-open
  // the welcome tab. This catches users who set the extension up before the
  // welcome-gating change shipped — they'd otherwise see a fresh welcome on
  // their next reinstall even though they're an established user.
  useEffect(() => {
    if (currentUser?.id) {
      try {
        chrome.storage?.sync?.set?.({ poppinHasSeenOnboarding: true })
      } catch {
        // sync may be unavailable; harmless — at worst the welcome tab
        // pops up again on next reinstall.
      }
    }
  }, [currentUser?.id])

  // The automatic URL joining is handled by the background script's updateCurrentUrl function
  // which is triggered by tab changes and URL updates. No additional logic needed here.

  // Check if user is logged in and has permissions, open welcome page if needed
  useEffect(() => {
    const checkAndOpenWelcome = async () => {
      // Prevent infinite loops by checking if we've already opened welcome
      if (hasOpenedWelcome) return
      
      try {
      
        // Check if user is logged in
        const isUserLoggedIn = currentUser && currentUser.id && !isLoading

        if(isLoading){
          return
        }
        
        // Check permissions
        const hasPermissions = await checkPermissions()
        
        // If user is not logged in OR doesn't have permissions, open welcome page
        if ((!isUserLoggedIn || !hasPermissions) && currentRoute !== "/welcome" && currentRoute !== "/permissions") {
          // Set flag to prevent infinite loops
          setHasOpenedWelcome(true)
          // Send message to background script to open welcome page
          chrome.runtime.sendMessage({ type: "OPEN_WELCOME_PAGE" })
          // Close the sidepanel after opening welcome page.
          //
          // THIS DOCUMENT CLOSES ITSELF; IT CANNOT MESSAGE ITSELF SHUT. This
          // used to post `{ action: "CLOSE_SIDE_PANEL" }`, and nothing in the
          // extension has ever listened for that verb. The nearest real
          // listener is CLOSE_SIDEPANEL in components/providers/
          // SidepanelProvider.tsx, and switching to that key would still be a
          // no-op here: SidepanelProvider wraps THIS component in the same
          // panel document (entries/side_panel/main.tsx), and
          // chrome.runtime.sendMessage never delivers back to the context
          // that sent it. window.close() is what the failure branch below
          // already does for the identical reason, so both paths now agree.
          window.close()
        }
      } catch (error) {
        console.error("Error checking user login status or permissions:", error)
        // If there's an error, open welcome page
        if (currentRoute !== "/welcome" && currentRoute !== "/permissions") {
          // Set flag to prevent infinite loops
          setHasOpenedWelcome(true)
          chrome.runtime.sendMessage({ type: "OPEN_WELCOME_PAGE" })
          // Close the sidepanel after opening welcome page
          window.close()
        }
      }
    }

    // Only check if we're not already on welcome or permissions routes
    if (currentRoute !== "/welcome" && currentRoute !== "/permissions") {
      checkAndOpenWelcome()
    }
  }, [currentRoute, hasOpenedWelcome, currentUser, isLoading])

  // Check if user needs to complete profile
  // ONE definition, shared with the screen this redirects to — see
  // helpers/profileGate. Requiring display_name here while CreateProfileStep
  // only asked for a username is what made the panel flicker between the two
  // forever.
  const needsProfileCompletion = needsProfileSetup(currentUser)

  // Redirect to profile completion if needed
  useEffect(() => {
    if (needsProfileCompletion && currentRoute !== "/create-profile") {
      navigate("/create-profile")
    }
  }, [needsProfileCompletion, currentRoute])

  const refetchCurrentUser = useCallback(() => {
    refetch().then(() => {
      handleFirebaseAuth(currentUser)
    })
  }, [refetch, currentUser, handleFirebaseAuth])

  const { setIsSignInModalOpen } = useUIStore()

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if(tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "SIDEPANEL_OPENED"
        })
      }
    })

    const listener = (message: any, sender: any, sendResponse: any) => {
      if(message.type==="IS_SIDEPANEL_OPEN"){
        return sendResponse(true)
      }
      if(message.type === "GET_CURRENT_ROUTE") {
        return sendResponse(currentRoute)
      }
    }
    chrome.runtime.onMessage.addListener(listener)

    return () => {
      chrome.runtime.onMessage.removeListener(listener)
    }
  },[currentRoute])

  return (
    <Paper elevation={0} 
    className="popup-app"
    sx={{
      ...paperStyles,
      position: "relative", // 🔹 make room for ::before
      // The ground's darkest stop, NOT the gradient: Layout inside is the
      // one painter of the brand ground, and two nested copies would
      // restart the sweep mid-screen. This only stops a gray flash where
      // the shell peeks out. Named from the shared source rather than
      // retyped, because a loose hex here is the exact drift the ground
      // object exists to prevent.
      backgroundColor: BRAND_GROUND.backgroundColor,
      width: "100%",
      overflow: "hidden",
      height: "100%",
      // A TERNARY, NOT AN `&&` INSIDE A TEMPLATE LITERAL. This read
      // `` `${environment === 'contentScript' && `1px solid …`}` ``, and on
      // every surface that is not the content script the `&&` short-circuits
      // to the boolean `false`, which the template literal stringifies — so
      // the panel and the welcome page shipped the invalid declaration
      // `border: false`. The browser drops it, which is why the hairline gate
      // below described a rule its own border half never performed.
      border:
        environment === "contentScript"
          ? `1px solid ${theme.palette.primary.main}`
          : "none",
      // THIS PAPER IS THE ONE THAT CLIPS. Layout's shell can ask for square
      // corners all it likes: it renders inside this box, and a parent with
      // a radius AND a non-visible overflow (right above) clips every
      // descendant to that radius. Squaring the shell alone left all four
      // 18px notches exactly where the reader reported them, because they
      // were never the shell's notches — they were this one's.
      //
      // The 18px belongs to the injected in-page widget, which floats over
      // somebody else's page and has to read as a detached card; it keeps
      // the radius and the hairline above. In the side panel this Paper IS
      // the window, so a rounded window bites four holes out of the ground
      // and lets whatever is behind the document show through them.
      //
      // Same gate, same reasoning, same wording as the shell's own corner
      // rule (components/Layout.tsx) — the two are one decision about one
      // surface and must not be able to disagree.
      borderRadius: environment === "sidepanel" ? 0 : "18px",

      "& > *": {
        position: "relative", // 🔹 ensure content is above ::before
        zIndex: 1,
      },
    }}
    >
      <Fragment>
          <Routes>
            <Route element={<Layout />}>
              {/*
                * THE FRONT DOOR IS THE PRODUCT.
                *
                * This was the social feed, with the page's tradable assets
                * buried above it and /positions reachable from nowhere in
                * the panel at all — a trading product whose panel opened on
                * a timeline and hid the book. The feed is still routed at
                * /feed for anyone who wants it; it is simply no longer what
                * "open the panel" means.
                */}
              <Route path="/" element={<SpotPositions />} />
              <Route path="feed" element={<Comment />} />
              {/*
                THREE ROUTES CLOSED HERE ON 2026-09-20, from the panel audit:

                /notifications — an 836-line inbox that no money event could
                reach. apps/rabbit is the only writer of notification rows
                and writes seven social kinds; a filled order, a ringing
                alert and a followed trade all travel by other surfaces. Two
                people had ever opened it.

                /post/:postId — PostDetailView is an OVERLAY, gated on
                `location.state.to === "PostDetailView"`, so this route
                rendered a blank screen on any plain navigate. The component
                stays where it works: inside the feed.

                /positions — a second name for "/", which is SpotPositions
                already. One room, one address.
              */}
              {/*
                THE WEBSITE LIVE CHAT — one room per hostname, opened from the
                header's "N live" pill. Inside the Layout route on purpose: the
                header, the permission banner and the sign-in redirect all live
                there, and the screen leans on all three.

                The segment is relative, like every other screen here;
                the header's pill types the absolute "/live-chat" to reach
                it. views/live-chat.spec.ts pins this literal.
              */}
              {/* Rooms the Arc edition's backend does not serve are not
                  routed there at all; the catch-all below lands a stale
                  path on "/". */}
              {CAP.sitePresence && <Route path="live-chat" element={<LiveChat />} />}
              <Route path="wallet-ui" element={<WalletUI />} />
              {CAP.gamification && <Route path="flywheel" element={<FlywheelLeaderboard />} />}
              {CAP.social && <Route path="callers" element={<Callers />} />}
          <Route path="token/:mint" element={<TokenView />} />
          {CAP.discover && <Route path="discover" element={<Discover />} />}
              <Route path="profile" element={<Profile />} />
              <Route path="profile/:userId" element={<Profile />} />
              {CAP.gamification && <Route path="referral" element={<ReferralProgram />} />}
              <Route path="edit-profile" element={<EditProfile />} />
              <Route path="create-profile" element={<CreateProfileStep />} />
              <Route path="settings" element={<Settings />} />
              {/*
                THE LEGACY WALLET IS RETIRED. It printed "0.0000 SOL" as the
                only unit on a screen headed "Total Balance" — the last place
                in the product that named SOL as the money — and it was not
                in the nav, yet every Send landed on it. The three senders
                now return to /wallet-ui, which is the wallet people actually
                navigate to. Redirected rather than deleted so any stale
                bookmark or deep link still arrives somewhere real.
              */}
              <Route path="wallet" element={<Navigate to="/wallet-ui" replace />} />
              <Route path="receive" element={<Receive />} />
              {/*
                A ROUTE THAT NO LONGER EXISTS MUST LAND SOMEWHERE.

                Layout restores the panel to the path it was last on, and
                that path is persisted across sessions (store/
                useAppConfigStore, "app-config-store"). So a reader whose
                last screen was one of the four closed on 2026-09-20 would
                have reopened the panel into a matched-nothing route: the
                header and the chrome, and nothing under them. The same
                holds for any stale deep link or bookmark.

                A catch-all is the one guard that covers the restore, the
                deep link and every future closure at once — do not replace
                it with a list of retired paths.
              */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>


          <Suspense fallback={<>
          
      
          <Loading /></>}>
          <SignInModal
            refetchCurrentUser={refetchCurrentUser}
            open={useUIStore.getState().isSignInModalOpen}
            onClose={() => setIsSignInModalOpen(false)}
          />
        </Suspense>
      </Fragment>
    </Paper>
  )
}

export default App
