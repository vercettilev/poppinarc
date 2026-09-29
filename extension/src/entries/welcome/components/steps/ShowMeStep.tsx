import { ARC_EDITION } from "~/config/edition"
import { Button, CircularProgress, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { ONBOARDING_X_URL } from "~/config/onboarding"
import { checkPermissions, requestPermissions } from "~/helpers/permissionHelper"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { QuietAction, StepFrame } from "../StepFrame"
import { ArcAddMoney } from "../ArcAddMoney"
import { GhostMark } from "../GhostMark"
import coolGif from "~/assets/poppin-thuglife.gif"
import { switchAccount } from "~/helpers/switchAccount"
import { useNavigate } from "react-router"

/**
 * THE LAST SCREEN, AND THE SCARIEST TAP IN THE PRODUCT.
 *
 * Chrome's host-permission prompt reads "Read and change all your data on
 * all websites", and for a browser extension it is the single largest
 * drop-off there is. Two decisions about WHEN and HOW it is asked:
 *
 * AFTER SIGN-IN, NOT BEFORE. A person who has just made an account and a
 * name has reasons to say yes; a stranger on the install screen has none.
 * The old flow asked first (QuickStartStep), and measured on 2026-09-16,
 * 87 of 107 chip-era installs never signed in at all.
 *
 * FRAMED IN ONE SENTENCE, WITH THE REWARD ON THE BUTTON. No separate
 * "permissions" screen explaining the model, no bullet list. One line says
 * what the prompt is for, and the button is not "Allow" or "Grant" but
 * "Show me": what the permission buys, not what it costs. The line is the
 * true one, checked against attachSpotCard.harvest(): page text IS sent to
 * find a market, with no identity attached and nothing stored.
 *
 * DENY IS NOT A DEAD END. Without the permission no content script runs,
 * so no chip can ever appear, and the uninstall survey's top reason is
 * "chips didn't show up". The screen therefore stays put on a refusal and
 * says why, rather than sending a person to X to discover an empty feed.
 *
 * An already-granted visitor (a reinstall, a test build) never sees a
 * prompt: the same button just opens X.
 */
const FONT = "PoppinSans, -apple-system, 'Segoe UI', Roboto, sans-serif"

export const ShowMeStep = () => {
  const { data: me } = useCurrentUser()
  const navigate = useNavigate()
  const [switching, setSwitching] = useState(false)
  const [granted, setGranted] = useState<boolean | null>(null)
  const [refused, setRefused] = useState(false)
  /* A refusal and a failure look identical from the screen and mean
     opposite things: one is the person's decision, the other is ours to
     fix. The failure keeps its message so it can be read off the screen. */
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* THE ARC EDITION ASKS FOR MONEY BEFORE THE FIRST POST: its account is a
     Circle wallet from sign-in, and a Buy with nothing behind it is the one
     dead end left. Rendered here rather than routed, so the handoff to X
     stays this screen's, in one place (onboarding-handoff.spec). */
  const [addingMoney, setAddingMoney] = useState(false)

  useEffect(() => {
    let alive = true
    checkPermissions()
      .then((ok) => {
        if (!alive) return
        setGranted(ok)
        /* NO SKIPPING, EVEN WHEN NOTHING NEEDS ASKING. An earlier cut
           handed an already-permitted visitor straight to X, and that is
           precisely the visitor who most needs one screen: a reinstall
           brings the old session back without a word, and a person who
           never sees a screen never gets to say "that is not me". One
           tap is the price of a place to switch accounts. */
      })
      .catch(() => alive && setGranted(false))
    return () => {
      alive = false
    }
  }, [])

  /* `to` is where the reader chose to go: the Arc edition's "Try Poppin"
     offers X, a news page and Reddit (ARC_TRY_PLACES). Everything else still
     hands off to ONBOARDING_X_URL. */
  const handoff = async (to: string = ONBOARDING_X_URL) => {
    // A click handler's event is not a place: anything but a string goes to X.
    if (typeof to !== "string") to = ONBOARDING_X_URL
    /* NOTHING TO ARM HERE ANY MORE. This used to set the coach's one-shot
       flag, which made the coach a reward for reaching this screen — and
       measured 2026-09-23, only 9 people ever did, against 140 shown a
       chip. The coach now asks whether THIS BROWSER has been shown it, so
       the reader who skipped straight to X gets the same introduction as
       the reader who came through here. See COACH_SEEN_KEY. */
    /* WHERE ONBOARDING SENT THEM — the one moment the flow stops being
       screens and becomes the product. It is the same fact FinalStep has
       always counted (see its copy of this, still live with V2 off): the
       host onboarding handed the reader to, and whether a card_shown ever
       follows it is whether onboarding connected to reality at all.

       It had never once fired in production, because the event was only
       ever attached to V1's closing screen and V2 routes /final out of the
       flow entirely. It belongs to the ACTION, so it moves with the action.

       AWAITED, unlike FinalStep's copy, and for a reason particular to
       here: that screen opened its destination in a NEW tab and kept
       living, so a fire-and-forget send had all the time it needed. This
       one replaces its own page in the SAME tab, and an un-awaited message
       races the teardown of the context sending it. Catching everything
       keeps the old promise intact — counting must never block the
       handoff itself. */
    try {
      let host = ""
      try {
        host = new URL(to).hostname
      } catch {
        host = "invalid"
      }
      await chrome.runtime.sendMessage({
        type: "SPOT_TELEMETRY",
        event: "onboarding_handoff",
        payload: { host },
      })
    } catch {
      // No listener, an orphaned page, a closed port: none of it is the
      // reader's problem, and the handoff below happens regardless.
    }

    // Same tab: this page has nothing left to say, and the browser's back
    // button returning here is handled (a signed-in visitor lands on this
    // screen again, whose button just reopens X).
    window.location.href = to
  }

  const track = (action: string) => {
    try {
      void chrome.runtime.sendMessage({
        type: "SPOT_TELEMETRY",
        event: "onboarding_step",
        payload: { step: "/show-me", action },
      })
    } catch {
      // Counting is never worth failing the step over.
    }
  }

  const onShowMe = async () => {
    if (busy) return
    setBusy(true)
    try {
      let ok = granted === true
      if (!ok) {
        ok = await requestPermissions()
        track(ok ? "granted" : "denied")
        if (ok) {
          // Tabs already open get the scripts now rather than on their
          // next reload; the X tab about to open needs nothing, the
          // manifest injects there on load.
          try {
            chrome.runtime.sendMessage({ type: "INJECT_CONTENT_SCRIPTS" })
          } catch {
            // Not critical: the handoff page injects on its own.
          }
        }
      }
      if (!ok) {
        setRefused(true)
        setFailure(null)
        setGranted(false)
        return
      }
      if (ARC_EDITION) {
        setAddingMoney(true)
        return
      }
      await handoff()
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      track(`error: ${why.slice(0, 120)}`)
      setFailure(why)
      setRefused(true)
    } finally {
      setBusy(false)
    }
  }

  if (addingMoney) return <ArcAddMoney onDone={handoff} />

  return (
    <StepFrame
      // The ghost puts its glasses on: you're in (Lev, 2026-09-29).
      mark={ARC_EDITION && !refused ? <GhostMark src={coolGif} /> : undefined}
      title={
        ARC_EDITION
          ? refused
            ? "One more tap."
            : "You're in."
          : refused
          ? "Poppin needs to see the page."
          : granted
            ? "You're in."
            : "Chrome will ask to let Poppin read pages."
      }
      subtitle={
        failure
          ? `Chrome did not open the permission prompt: ${failure}`
          : ARC_EDITION
            ? refused
              ? "Chrome asks once, so Poppin can appear under the posts you read."
              : "Poppin shows up wherever you read: X, Reddit, the news."
            : refused
            ? "Without that, Poppin can't show you anything. Pages are matched to markets in the moment, with no name attached."
            : granted
              ? "Poppin is on. Tweets, Reddit posts, any page you read. We'll start on X."
              : "Tweets, Reddit posts, any page you read. Allow it and we'll start on X."
      }
      actions={
        <>
        <Button
          onClick={() => void onShowMe()}
          disabled={busy || granted === null}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
          sx={{
            width: "100%",
            maxWidth: 420,
            py: 1.75,
            borderRadius: "16px",
            fontFamily: FONT,
            fontSize: 17,
            fontWeight: 700,
            textTransform: "none",
            color: "#06202E",
            backgroundColor: "#68C6FF",
            boxShadow: "0 6px 30px rgba(104,198,255,.25)",
            "&:hover": { backgroundColor: "#8AD4FF" },
            "&.Mui-disabled": { backgroundColor: "rgba(104,198,255,.35)", color: "#06202E" },
          }}
        >
          {ARC_EDITION ? (granted ? "Continue" : "Turn on Poppin") : refused ? "Turn on Poppin" : "Pop it"}
        </Button>
        {/* Under the button, small, one line: it names the account AND is
            the way out of it. The wrong-account case is real (a reinstall
            hands the old session straight back) and rare, so it gets a
            quiet door rather than a second button. */}
        {me?.username && (
          <Typography sx={{ fontFamily: FONT, fontSize: 13, color: "rgba(255,255,255,.45)", mt: 2 }}>
            Logged in as <b style={{ color: "rgba(255,255,255,.8)" }}>@{me.username}</b>
          </Typography>
        )}
        <QuietAction
          label={switching ? "Signing out…" : "Not you? Switch account"}
          disabled={switching}
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
