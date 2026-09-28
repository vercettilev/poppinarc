import { Alert, Box, Button, SxProps, Theme } from "@mui/material"
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew"
import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { humanApiError } from "~/helpers/apiError"
import { UserService } from "~/services/UserService"
import { StepFrame } from "../StepFrame"

/**
 * The one screen between signing in and using Poppin.
 *
 * Connecting X trades an auto-assigned username for the real handle: accounts
 * are now created already named (from the email local part), so declining
 * costs nothing and lands in the product just the same. The incentive is no
 * longer "skip a screen you would otherwise sit through" — that screen is
 * gone for everyone — it is "be @yourhandle instead of @lev_a3f".
 *
 * Deliberately NOT built as FOMO's version of this screen. Theirs floats the
 * two app marks as tilted tiles in a glow; we removed that composition from
 * the sign-in screen earlier for looking lifted, and re-adding it here would
 * walk it straight back in. The two buttons are the content.
 *
 * How it knows the link happened: /twitter/success posts
 * { action: "extension-x-connected" } to the extension, background relays it
 * as EXTENSION_X_CONNECTED, and the listener below refetches the user. The
 * window-closed fallback covers someone who abandons the X screen or whose
 * message never lands.
 */

const xBtnSx: SxProps<Theme> = {
  width: "100%",
  height: 52,
  backgroundColor: "#000000",
  color: "#FFFFFF",
  border: "1px solid rgba(255,255,255,0.15)",
  textTransform: "none",
  fontWeight: 700,
  fontSize: "15px",
  fontFamily: "PoppinSans, sans-serif",
  borderRadius: "14px",
  gap: 1,
  "&:hover": { backgroundColor: "#1A1A1A" },
  "&:disabled": {
    backgroundColor: "rgba(0,0,0,0.5)",
    color: "rgba(255,255,255,0.4)",
  },
}

function XGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9.24 6.85 14.9 0h-1.34L8.65 5.95 4.6 0H0l5.94 8.68L0 16h1.34l5.19-6.28L10.75 16H16L9.24 6.85Zm-1.84 2.22-.6-.87L2.02.87h2.06l3.83 5.5.6.87 5.03 7.2H11.5L7.4 9.07Z"
      />
    </svg>
  )
}

export const ConnectXStep = ({
  onDone,
  onNeedsUsername,
}: {
  /** Linked, declined, or already named: either way, into the product. */
  onDone: () => void
  /**
   * Genuinely nameless, which should no longer happen: accounts are created
   * with a username now. Kept as the honest answer for older rows and for a
   * failed assignment, rather than dropping someone into the product with no
   * name at all.
   */
  onNeedsUsername: () => void
}) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const navigate = useNavigate()
  const { state } = useLocation() as { state?: { from?: string } }

  /**
   * THE BACK ARROW IS THE DECLINE. There used to be a "Not now" beside
   * Connect X, which made the screen read as a two-way question — and the
   * screen is not a question, it is an offer you can walk away from. A
   * back arrow says the same thing in the grammar every other screen
   * already uses, and costs no width beside the primary.
   *
   * Back means BACK: whoever sent the reader here says where that is
   * (`state.from`), so declining from the identity step returns to the
   * identity step, with the username and photo still there to finish.
   * Reached without a sender — the once-per-profile offer straight after
   * sign-in — there is nothing behind it, so back means the same as
   * declining always did: on into the product.
   */
  const decline = () => {
    if (state?.from) {
      navigate(state.from)
      return
    }
    onDone()
  }

  /**
   * Re-read the user and decide where to go. The callback sets the username
   * from the handle, but only when the account had none — someone who
   * already picked a name keeps it, and either way they have one, so both
   * outcomes are "done". Only a genuinely missing username sends them on to
   * pick one.
   */
  const settle = async () => {
    try {
      const fresh: any = await UserService.getCurrentUser()
      if (fresh?.username) {
        onDone()
        return
      }
    } catch {
      // Couldn't confirm. Fall through to the username screen — it skips
      // itself if the name turns out to be set, so this is never a dead end.
    }
    onNeedsUsername()
  }

  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === "EXTENSION_X_CONNECTED") {
        setBusy(false)
        void settle()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handleConnect = async () => {
    setBusy(true)
    setError("")

    /**
     * ASK FIRST, OPEN SECOND — and say which one failed.
     *
     * One try/catch used to wrap both, wearing the window's words: a
     * reader whose account simply could not link X was told "Couldn't
     * open X just now", a guess about a window that had never been
     * asked for. Measured live — the server was answering "Connecting X
     * is not configured yet" (503, X_CLIENT_ID unset) and the screen
     * replaced that sentence with its own.
     */
    let href: string
    try {
      const answer: any = await UserService.createTwitterUrl()
      href = typeof answer === "string" ? answer : answer?.url
      if (!href) throw new Error("")
    } catch (e) {
      // The server's own words when it has any — it knows things this
      // screen cannot (not configured, rate limited, signed out).
      setError(humanApiError(e, "Connecting X isn't available right now."))
      setBusy(false)
      return
    }

    try {
      // A focused window, not a tab. Sending someone to X used to replace
      // what they were looking at with a full browser tab, for a detour that
      // ends in a few seconds and closes itself; this keeps onboarding on
      // screen behind it and reads as a dialog rather than a departure.
      //
      // Deliberately NOT chrome.identity.launchWebAuthFlow, which would be
      // tidier still: that requires the OAuth chain to terminate on
      // chromiumapp.org, which means threading a signal through
      // createTwitterUrl, the backend, X, and the callback page — a working
      // path, rewired, with no way to test it end to end without X
      // credentials. Not worth it for the same few seconds.
      const authWindow = await chrome.windows.create({
        url: href,
        type: "popup",
        width: 520,
        height: 760,
      })

      // Fallback for a closed window: covers both "changed their mind" and a
      // successful link whose message didn't arrive. settle() re-reads the
      // user, so a real link is still detected here.
      if (authWindow?.id !== undefined) {
        const windowId = authWindow.id
        const onRemoved = (removedWindowId: number) => {
          if (removedWindowId !== windowId) return
          chrome.windows.onRemoved.removeListener(onRemoved)
          setBusy(false)
          void settle()
        }
        chrome.windows.onRemoved.addListener(onRemoved)
      }
    } catch {
      // Genuinely the window now, and nothing else.
      setError("Couldn't open the X window. You can connect it later.")
      setBusy(false)
    }
  }

  return (
    <StepFrame
      title="Connect X"
      subtitle="Take your handle as your username, so people know it's you."
      banner={
        error ? (
          <Alert severity="error" sx={{ fontSize: "0.8rem" }}>
            {error}
          </Alert>
        ) : undefined
      }
      /**
       * BACK SITS UNDER THE OFFER, not in the corner. StepFrame's own back
       * arrow floats at the viewport's top-right — correct for a screen you
       * are passing THROUGH, wrong here, where declining is one of the two
       * things a reader came to do. A control that far from the decision
       * has to be hunted for; under the button it is simply the other
       * answer, and the order still reads primary-first.
       */
      actions={
        <>
          <Button
            onClick={handleConnect}
            disabled={busy}
            sx={xBtnSx}
            startIcon={<XGlyph />}
          >
            Connect X
          </Button>
          <Box
            component="button"
            type="button"
            onClick={decline}
            disabled={busy}
            aria-label="Back"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.5,
              alignSelf: "center",
              background: "none",
              border: 0,
              p: 1,
              cursor: "pointer",
              color: "rgba(255,255,255,0.55)",
              fontSize: "15px",
              fontWeight: 600,
              fontFamily: "PoppinSans, sans-serif",
              "&:hover": { color: "#FFFFFF" },
              "&:disabled": { color: "rgba(255,255,255,0.25)", cursor: "default" },
            }}
          >
            <ArrowBackIosNewIcon sx={{ fontSize: 13 }} />
            Back
          </Box>
        </>
      }
    />
  )
}
