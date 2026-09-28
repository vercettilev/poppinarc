import { TradingWalletCard } from "~/components/TradingWalletCard"
import { CAP } from "~/config/edition"
import { JUICE } from "~/theme/juice"
import { Avatar, Box, Paper, Stack, Switch, Typography } from "@mui/material"
import {
  NOTIFY_DEFAULTS,
  NOTIFY_PREFS_KEY,
  NOTIFY_ROWS,
  readNotifyPrefs,
  type NotifyKind,
  type NotifyPrefs,
} from "~/helpers/notifyPrefs"
import {
  readSharePrefs,
  SHARE_DEFAULTS,
  SHARE_PREFS_KEY,
  SHARE_ROWS,
  type SharePrefs,
} from "~/helpers/sharePrefs"
import { alpha, styled } from "@mui/material/styles"
import { DEBUG_KEY } from "~/helpers/poppinDebug"
import { signOutEverywhere } from "~/helpers/signOut"
import React, { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { UserService } from "~/services/UserService"
import { useEnvironmentStore } from "~/store/useAppConfigStore"

const AntSwitch = styled(Switch)(({ theme }) => ({
  width: 28,
  height: 16,
  padding: 0,
  display: "flex",
  "&.Mui-disabled": {
    opacity: 0.4,
    "& .MuiSwitch-thumb": {
      backgroundColor: "#ccc",
    },
    "& .MuiSwitch-track": {
      opacity: 0.3,
      backgroundColor: "rgba(122,183,255,.35) !important",
    },
  },
  "&:active": {
    "& .MuiSwitch-thumb": {
      width: 15,
    },
    "& .MuiSwitch-switchBase.Mui-checked": {
      transform: "translateX(9px)",
    },
  },
  "& .MuiSwitch-switchBase": {
    padding: 2,
    "&.Mui-checked": {
      transform: "translateX(12px)",
      color: "#fff",
      "& + .MuiSwitch-track": {
        opacity: 1,
        backgroundColor: JUICE.accent,
      },
    },
  },
  "& .MuiSwitch-thumb": {
    boxShadow: "0 2px 4px 0 rgb(0 35 11 / 20%)",
    width: 12,
    height: 12,
    borderRadius: 6,
    transition: theme.transitions.create(["width"], {
      duration: 200,
    }),
  },
  "& .MuiSwitch-track": {
    borderRadius: 16 / 2,
    opacity: 1,
    backgroundColor: "rgba(122,183,255,.35)",
    boxSizing: "border-box",
  },
}))

const shortcutInfo = {
  title: "Keyboard Shortcut",
  description: "Default shortcut: Ctrl + Period (Windows/Linux) or Cmd + Period (Mac). To change this shortcut, visit ",
  linkText: "Chrome Extension Shortcuts",
  linkUrl: "chrome://extensions/shortcuts"
}

// One surface language: the panel's own glass block, not a fourth copy.
const PANEL_BORDER = JUICE.border
const PANEL_BG = JUICE.well
const PANEL_TEXT = "#FFFFFF"

const CARD_SX = {
  background: PANEL_BG,
  color: PANEL_TEXT,
  borderRadius: "12px",
  border: `1px solid ${PANEL_BORDER}`,
} as const

/** The small caps that name a group. Five words on the screen, at most. */
const SectionLabel: React.FC<{ children: string }> = ({ children }) => (
  <Typography
    sx={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: ".06em",
      color: alpha(PANEL_TEXT, 0.5),
      pt: 1,
    }}
  >
    {children}
  </Typography>
)

/**
 * ONE ROW, EVERY SECTION. A row is a title, a sentence and a switch. The
 * title carries the weight and the sentence carries the terms, so the eye
 * finds the row by its title first; the two were the same size before,
 * and a list of same-size lines is a wall.
 */
const PrefRow: React.FC<{
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}> = ({ title, description, checked, disabled, onChange }) => (
  <Paper
    sx={{
      ...CARD_SX,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      p: "10px",
      gap: 2,
    }}
  >
    <Box sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: PANEL_TEXT }}>
        {title}
      </Typography>
      <Typography sx={{ fontSize: 12, color: alpha(PANEL_TEXT, 0.7) }}>
        {description}
      </Typography>
    </Box>
    <AntSwitch
      checked={checked}
      disabled={disabled}
      inputProps={{ "aria-label": title }}
      onChange={(_, v) => onChange(v)}
    />
  </Paper>
)

/**
 * SETTINGS, IN THE ORDER A PERSON ASKS. Who am I (and the way out), what
 * reaches me, what goes out under my name, where to say something broke,
 * and the two things a support thread sometimes needs, folded.
 */
const Settings: React.FC = () => {
  const { data: user } = useCurrentUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { environment } = useEnvironmentStore()

  const [advanced, setAdvanced] = useState(false)

  /** The diagnostics switch, read from the same key the chip reads. */
  const [debugOn, setDebugOn] = useState(false)
  useEffect(() => {
    void chrome.storage.local
      .get(DEBUG_KEY)
      .then((got) => setDebugOn(got?.[DEBUG_KEY] === true))
      .catch(() => undefined)
  }, [])

  /**
   * THE WAY OUT, NEXT TO THE NAME. The avatar menu had the only sign-out,
   * behind a letter nobody knows is a menu; the first thing a person asks
   * a settings screen is which account this is, and the second is how to
   * leave it. Same procedure as the menu (helpers/signOut.ts).
   */
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOutEverywhere(queryClient)
      navigate("/")
      if (environment === "sidepanel") window.close()
    } finally {
      setSigningOut(false)
    }
  }

  /**
   * THE DEVICE'S SWITCHES, one per kind the product sends uninvited.
   * Stored on the device, because the sender is the device: the background
   * worker reads this key at the moment of sending, so a switch flipped
   * here takes effect on the very next one.
   */
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>(NOTIFY_DEFAULTS)
  const [sharePrefs, setSharePrefs] = useState<SharePrefs>(SHARE_DEFAULTS)
  useEffect(() => {
    let alive = true
    void chrome.storage?.local
      ?.get([NOTIFY_PREFS_KEY, SHARE_PREFS_KEY])
      .then((st) => {
        if (!alive) return
        setNotifyPrefs(readNotifyPrefs(st?.[NOTIFY_PREFS_KEY]))
        setSharePrefs(readSharePrefs(st?.[SHARE_PREFS_KEY]))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const setNotifyKind = (kind: NotifyKind, value: boolean) => {
    // Written straight through: a switch that waits on a network call is a
    // switch that appears not to work.
    setNotifyPrefs((cur) => {
      const next = { ...cur, [kind]: value }
      void chrome.storage?.local?.set({ [NOTIFY_PREFS_KEY]: next })
      return next
    })
  }

  const setShareKind = (kind: keyof SharePrefs, value: boolean) => {
    setSharePrefs((cur) => {
      const next = { ...cur, [kind]: value }
      void chrome.storage?.local?.set({ [SHARE_PREFS_KEY]: next })
      return next
    })
  }

  /**
   * THE SERVER'S SWITCH. Alerts and filled orders reach the inbox when
   * Chrome is closed; that mail leaves from the server, so the switch
   * lives on the account (users.notifications_enabled) and every such
   * mail also carries a link that flips the same flag. Both senders read
   * it at the moment of sending.
   */
  const [emailOn, setEmailOn] = useState<boolean>(user?.notifications_enabled ?? true)
  useEffect(() => {
    if (user) setEmailOn(user.notifications_enabled ?? true)
  }, [user?.id, user?.notifications_enabled])
  const [savingEmail, setSavingEmail] = useState(false)
  const handleToggleEmail = async (value: boolean) => {
    const previous = emailOn
    setEmailOn(value)
    setSavingEmail(true)
    try {
      await UserService.updateProfile({ notifications_enabled: value })
      queryClient.setQueryData(["current-user"], (old: any) =>
        old ? { ...old, notifications_enabled: value } : old,
      )
    } catch {
      setEmailOn(previous)
    } finally {
      setSavingEmail(false)
    }
  }

  /**
   * CONSENT TO BE NAMED ON THE WINS RAIL. Off until somebody says
   * otherwise: the rail publishes a named person's profit, which is a
   * step past the volume-shaped points the leaderboard shows.
   */
  const [publicWins, setPublicWins] = useState<boolean>(
    user?.public_wins ?? false,
  )
  useEffect(() => {
    if (user) setPublicWins(user.public_wins ?? false)
  }, [user?.id, user?.public_wins])
  const [savingWins, setSavingWins] = useState(false)
  const handleTogglePublicWins = async (value: boolean) => {
    const previous = publicWins
    setPublicWins(value)
    setSavingWins(true)
    try {
      await UserService.updateProfile({ public_wins: value })
      queryClient.setQueryData(["current-user"], (old: any) =>
        old ? { ...old, public_wins: value } : old,
      )
    } catch {
      setPublicWins(previous)
    } finally {
      setSavingWins(false)
    }
  }

  /**
   * SOMEWHERE TO PUT A BUG WITHOUT LEAVING. The product's only other
   * feedback channel fires on uninstall, the latest possible moment.
   */
  const [report, setReport] = useState("")
  const [reportState, setReportState] = useState<"idle" | "sending" | "sent">("idle")
  const sendReport = async () => {
    const text = report.trim()
    if (!text || reportState === "sending") return
    setReportState("sending")
    try {
      await UserService.sendFeedback(text)
    } catch {
      // The server logs a failed insert rather than losing the report, and
      // there is nothing useful a person can do with our database trouble.
    }
    setReport("")
    setReportState("sent")
  }

  const who = user?.display_name || user?.username || "Signed in"

  return (
    <>
      <Typography sx={{ fontSize: 19, fontWeight: 700, px: 2, pt: 1.5, pb: 1 }}>
        Settings
      </Typography>

      <Box
        sx={{
          px: "10px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          pb: 3,
          width: "100%",
          // The shell is a fixed-height flex column; a view that does not
          // claim its own scroll simply loses whatever falls off the bottom.
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        <Stack spacing={2} sx={{ width: "100%", maxWidth: 600 }}>
          <SectionLabel>ACCOUNT</SectionLabel>
          <Paper
            sx={{
              ...CARD_SX,
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              p: "10px",
            }}
          >
            <Avatar
              src={user?.profile_photo_url ?? undefined}
              sx={{ width: 36, height: 36, fontSize: 15 }}
            >
              {who[0]?.toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: PANEL_TEXT,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {who}
              </Typography>
              {user?.username && (
                <Typography sx={{ fontSize: 12, color: alpha(PANEL_TEXT, 0.7) }}>
                  @{user.username}
                </Typography>
              )}
            </Box>
            <Box
              component="button"
              onClick={() => void signOut()}
              disabled={signingOut || !user}
              className="click-animation"
              sx={{
                flexShrink: 0,
                border: `1px solid ${alpha(PANEL_TEXT, 0.16)}`,
                background: "none",
                cursor: signingOut ? "default" : "pointer",
                font: "inherit",
                fontSize: 12,
                fontWeight: 700,
                px: 1.5,
                py: "6px",
                borderRadius: "999px",
                color: PANEL_TEXT,
                opacity: signingOut ? 0.5 : 1,
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Box>
          </Paper>

          {/* Whose wallet trades, and the door to connect another. */}
          {CAP.solanaRails && <TradingWalletCard />}

          {/* What reaches you: the device's own notifications, and the
              server's mail for when Chrome is closed. One list, because to
              the person they are one question. */}
          <SectionLabel>TELL ME WHEN</SectionLabel>
          {/* Followed traders' news comes from the store's social backend. */}
          {NOTIFY_ROWS.filter((row) => CAP.social || row.kind !== "social").map((row) => (
            <PrefRow
              key={row.kind}
              title={row.title}
              description={row.description}
              checked={notifyPrefs[row.kind]}
              onChange={(v) => setNotifyKind(row.kind, v)}
            />
          ))}
          {CAP.alertsMirror && (
          <PrefRow
            title="Email when Chrome is closed"
            description="Alerts and filled orders reach your inbox when the extension is not running."
            checked={emailOn}
            disabled={savingEmail || !user}
            onChange={(v) => void handleToggleEmail(v)}
          />
          )}

          {/* What goes out under your name. Two rows, one sentence shape,
              so the reader can tell at a glance which is on. */}
          {(CAP.social || CAP.autoPost) && <SectionLabel>SHARING</SectionLabel>}
          {CAP.social && (
          <PrefRow
            title="Show my best trades"
            description="Your name and your best closed trades appear on your profile and in the feed's Biggest wins. Open positions stay yours alone."
            checked={publicWins}
            disabled={savingWins || !user}
            onChange={(v) => void handleTogglePublicWins(v)}
          />
          )}
          {CAP.autoPost && SHARE_ROWS.map((row) => (
            <PrefRow
              key={row.kind}
              title={row.title}
              description={row.description}
              checked={sharePrefs[row.kind]}
              onChange={(v) => setShareKind(row.kind, v)}
            />
          ))}

          {/* THE BUG BOX IS THE LAST OPEN CARD, deliberately: scrolling to
              the bottom is what a person does after the preferences failed
              to fix what they came in for. Version, page and browser ride
              along automatically. */}
          <Paper sx={{ ...CARD_SX, p: "10px", borderRadius: "14px", mt: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: PANEL_TEXT }}>
              Report a bug
            </Typography>
            <Typography
              sx={{ fontSize: 12, color: alpha(PANEL_TEXT, 0.7), mb: 1 }}
            >
              {reportState === "sent"
                ? "Thanks. It reached us with your version and the page you were on."
                : "Tell us what happened. Your version and current page are attached."}
            </Typography>
            {reportState !== "sent" && (
              <>
                <Box
                  component="textarea"
                  value={report}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setReport(e.target.value)
                  }
                  placeholder="What went wrong?"
                  rows={3}
                  sx={{
                    width: "100%",
                    boxSizing: "border-box",
                    resize: "vertical",
                    background: alpha("#000000", 0.25),
                    border: `1px solid ${PANEL_BORDER}`,
                    borderRadius: "10px",
                    color: PANEL_TEXT,
                    font: "inherit",
                    fontSize: "12px",
                    p: "8px 10px",
                    "&:focus": { outline: "none", borderColor: JUICE.accent },
                    "&::placeholder": { color: alpha(PANEL_TEXT, 0.45) },
                  }}
                />
                <Box
                  component="button"
                  onClick={sendReport}
                  disabled={!report.trim() || reportState === "sending"}
                  className="click-animation"
                  sx={{
                    mt: 1,
                    border: "none",
                    cursor: report.trim() ? "pointer" : "default",
                    font: "inherit",
                    fontSize: "12px",
                    fontWeight: 700,
                    px: 2,
                    py: "7px",
                    borderRadius: "999px",
                    color: JUICE.onAccent,
                    backgroundColor: JUICE.accent,
                    opacity: report.trim() ? 1 : 0.4,
                  }}
                >
                  {reportState === "sending" ? "Sending…" : "Send"}
                </Box>
              </>
            )}
          </Paper>

          {/* ADVANCED, FOLDED: where the keyboard shortcut is changed, and
              the switch that makes a silent chip explain itself. Behind one
              word they cost nothing until asked for. */}
          <Box
            component="button"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
            sx={{
              alignSelf: "flex-start",
              background: "none",
              border: "none",
              color: alpha(PANEL_TEXT, 0.55),
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              px: 0.5,
              py: 0.5,
            }}
          >
            {advanced ? "Advanced ▾" : "Advanced ▸"}
          </Box>
          {advanced && (
            <>
              <Paper sx={{ ...CARD_SX, p: "10px" }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: PANEL_TEXT }}>{shortcutInfo.title}</Typography>
                <Typography sx={{ fontSize: 12, color: alpha(PANEL_TEXT, 0.7) }}>
                  {shortcutInfo.description}
                  <Box
                    component="a"
                    href={shortcutInfo.linkUrl}
                    target="_blank"
                    onClick={() => {
                      chrome.tabs.create({ url: shortcutInfo.linkUrl })
                    }}
                    rel="noopener noreferrer"
                    sx={{ color: JUICE.accent, textDecoration: "underline", cursor: "pointer" }}
                  >
                    {shortcutInfo.linkText}
                  </Box>
                </Typography>
              </Paper>
              {/* THE SWITCH THAT MAKES A SILENT FAILURE EXPLAIN ITSELF. The
                  chip fails quietly by design; the lines that explain it
                  are deleted from the production bundle and speak on
                  console.info instead, behind this. It lives here rather
                  than in a DevTools instruction because the person holding
                  the bug is not always holding a console. */}
              <PrefRow
                title="Explain what the chip is doing"
                description="Writes a line to the page console whenever a chip decides not to appear, or a logo will not load."
                checked={debugOn}
                onChange={(v) => {
                  setDebugOn(v)
                  void chrome.storage.local.set({ [DEBUG_KEY]: v })
                }}
              />
            </>
          )}
        </Stack>
      </Box>
    </>
  )
}

export default Settings
