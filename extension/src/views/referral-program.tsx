import PersonAddIcon from "@mui/icons-material/PersonAdd"
import {
  alpha,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material"
import { useState } from "react"
import { useToast } from "~/components/Toast/ToastProvider"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useAssignInvitationCodes } from "~/hooks/useInvitationCodes"
import { useMyReferralCode, useReferralEarnings, useReferralStats } from "~/hooks/useReferral"
import { inviteLink } from "~/helpers/invite"
import { ACCENT, DIM, PANEL_CARD } from "~/helpers/panelSurface"
import { JUICE } from "~/theme/juice"

/**
 * INVITE: the money first, then one rule, then the link.
 *
 * This screen used to show the CODE, because the link went nowhere: no
 * /invite or /join route existed and the sentence under it said a friend
 * would type the code at sign-up, a field the live Google and X sign-in
 * never reaches. Both are gone. poppin.so/join/<code> is live (a cookie
 * on .poppin.so, read by the sign-in bridge, applied when the account is
 * created), so the link is the thing and the chip's own invite row says
 * the same words: "You earn 20% of their trading fees."
 *
 * The legacy invitation-code count ("Friends Joined", from single-use
 * codes of the invite-only era) was a second friends number beside the
 * referral count. The gate is open; that number is history and is gone.
 * The admin's code tools stay, admin-only, at the bottom.
 */
export default function ReferralProgram() {
  const { showToast } = useToast()
  const { data: user } = useCurrentUser()
  const { data: referralCode } = useMyReferralCode()
  const { data: stats } = useReferralStats()
  const { data: earnings } = useReferralEarnings({ limit: 10 })
  const assignInvitationCodes = useAssignInvitationCodes()
  const isAdmin = user?.role === "admin"

  const code = referralCode?.code ?? ""
  const link = code ? inviteLink(code) : ""
  const joined = Number(stats?.referrals_count ?? 0)
  const earnedUsd = Number(stats?.total_earned_usd ?? 0)

  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      showToast("Could not copy. Select the link and copy it.", "error")
    }
  }

  const fmtUsd = (s?: string) => {
    const n = parseFloat(s || "0")
    if (!isFinite(n)) return "$0.00"
    return `$${n.toFixed(n >= 100 ? 0 : 2)}`
  }

  // Admin: hand out single-use codes (legacy gate tooling, admin-only).
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [usernamesInput, setUsernamesInput] = useState("")
  const [codeCount, setCodeCount] = useState("1")
  const [minPoints, setMinPoints] = useState("")
  const handleAssignCodes = async () => {
    try {
      const usernames = usernamesInput
        .split(",")
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
      const count = parseInt(codeCount) || 1
      const minPointsValue = minPoints ? parseInt(minPoints) : undefined
      await assignInvitationCodes.mutateAsync({ usernames, count, minPoints: minPointsValue })
      showToast(
        usernames.length > 0
          ? `Invitation codes assigned to ${usernames.length} user(s)`
          : minPointsValue !== undefined
            ? `Invitation codes created for users with ${minPointsValue}+ points`
            : "Invitation codes created for all users",
        "success",
      )
      setAssignDialogOpen(false)
      setUsernamesInput("")
      setCodeCount("1")
      setMinPoints("")
    } catch (error) {
      console.error("Failed to assign invitation codes", error)
      showToast("Failed to assign invitation codes", "error")
    }
  }

  const fieldSx = {
    "& .MuiOutlinedInput-root": {
      fontSize: "0.8rem",
      color: JUICE.text,
      "& fieldset": { borderColor: JUICE.border },
      "&:hover fieldset": { borderColor: JUICE.borderStrong },
      "&.Mui-focused fieldset": { borderColor: ACCENT },
    },
    "& .MuiInputLabel-root": { fontSize: "0.8rem", color: JUICE.text2 },
    "& .MuiFormHelperText-root": { fontSize: "0.7rem", color: JUICE.text3 },
  } as const

  return (
    // Own scroll context: the shell does not scroll for its views, and
    // 100vh here measured the whole column and clipped the bottom.
    <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: "auto", boxSizing: "border-box" }}>
      <Typography sx={{ fontSize: 19, fontWeight: 700, mb: 2 }}>Invite</Typography>

      {/* THE RESULT FIRST, THE RULE SECOND. This screen used to open with
          the rule and bury what it had produced in a mono footnote. What a
          reader comes back for is the number, so the number is the page's
          first object and the rule is three short lines under it. */}
      <Box sx={{ textAlign: "center", pt: 0.5, pb: 0.5 }}>
        <Typography
          sx={{
            fontSize: 34,
            fontWeight: 700,
            lineHeight: 1.1,
            fontFamily: JUICE.mono,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-.02em",
            color: earnedUsd > 0 ? JUICE.green : JUICE.text,
          }}
        >
          {`$${earnedUsd.toFixed(2)}`}
        </Typography>
        <Typography sx={{ fontSize: 12, color: DIM, mt: 0.5 }}>
          {joined > 0
            ? `earned from ${joined} ${joined === 1 ? "friend" : "friends"}`
            : "nobody has joined through your link yet"}
        </Typography>
      </Box>

      <Box sx={{ ...PANEL_CARD, p: 2, mt: 1.5, mb: 2 }}>
        {/* The rule in percentages, which is how it is said everywhere
            else in the product: the chip's receipt line and the
            leaderboard card both say 20%. Lev, 2026-09-19, choosing the
            percentage over a worked dollar example: "%20 daha taşaklı". */}
        {[
          { k: "Of your friends' trading fees", v: "20%" },
          { k: "Of their friends' fees too", v: "5%" },
          { k: "For as long as they trade", v: "always" },
        ].map((r, i) => (
          <Box
            key={r.k}
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 1,
              ...(i > 0
                ? { mt: 1, pt: 1, borderTop: "1px solid rgba(255,255,255,.06)" }
                : {}),
            }}
          >
            <Typography sx={{ fontSize: 13, color: JUICE.text2, flex: 1 }}>{r.k}</Typography>
            <Typography
              sx={{
                fontSize: 13.5,
                fontWeight: 700,
                fontFamily: JUICE.mono,
                color: r.v === "always" ? JUICE.text2 : ACCENT,
              }}
            >
              {r.v}
            </Typography>
          </Box>
        ))}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.75 }}>
          <Box
            component="code"
            sx={{
              flex: 1,
              minWidth: 0,
              font: `600 12.5px ${JUICE.mono}`,
              color: ACCENT,
              background: alpha(ACCENT, 0.08),
              px: 1.25,
              py: 1,
              borderRadius: "10px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {link ? link.replace(/^https:\/\//, "") : "…"}
          </Box>
          <Box
            component="button"
            onClick={() => void copy()}
            disabled={!link}
            className="click-animation"
            sx={{
              flexShrink: 0,
              border: 0,
              cursor: link ? "pointer" : "default",
              font: "inherit",
              fontWeight: 700,
              fontSize: 13,
              px: 1.75,
              py: "8px",
              borderRadius: "999px",
              background: alpha(ACCENT, 0.12),
              color: ACCENT,
              boxShadow: `inset 0 0 0 1px ${alpha(ACCENT, 0.28)}`,
              opacity: link ? 1 : 0.5,
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Box>
        </Box>
        {/* True today, and said: nothing pays out on its own yet. */}
        <Typography sx={{ fontSize: 12, color: JUICE.text3, mt: 1.25 }}>
          Earnings are paid to your wallet by hand for now.
        </Typography>
      </Box>

      {earnings?.items && earnings.items.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>Recent earnings</Typography>
          {earnings.items.map((e) => (
            <Box
              key={e.id}
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                py: 1,
                borderBottom: "1px solid rgba(255,255,255,.06)",
              }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {fmtUsd(e.earning_amount_usd)}
              </Typography>
              <Typography sx={{ fontSize: 12, color: DIM }}>
                {new Date(e.created_at).toLocaleDateString()}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {isAdmin && (
        <Box sx={{ mt: 3 }}>
          <Button
            variant="outlined"
            size="small"
            fullWidth
            startIcon={<PersonAddIcon sx={{ fontSize: "1rem" }} />}
            onClick={() => setAssignDialogOpen(true)}
            sx={{
              borderColor: JUICE.border,
              color: JUICE.text2,
              textTransform: "none",
              borderRadius: 1.5,
              fontWeight: 600,
              fontSize: "0.75rem",
            }}
          >
            Assign invitation codes (admin)
          </Button>
        </Box>
      )}

      <Dialog
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: JUICE.wellSolid,
            borderRadius: 2,
            border: `1px solid ${JUICE.border}`,
          },
        }}
      >
        <DialogTitle sx={{ color: JUICE.text, fontWeight: 600, fontSize: "0.95rem", py: 1.5, px: 2 }}>
          Assign Invitation Codes
        </DialogTitle>
        <DialogContent sx={{ px: 2, py: 1.5 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 0.5 }}>
            <TextField
              label="Usernames"
              placeholder="user1, user2, user3"
              multiline
              rows={2}
              fullWidth
              value={usernamesInput}
              onChange={(e) => setUsernamesInput(e.target.value)}
              helperText="Comma-separated. Leave empty for all users."
              sx={fieldSx}
            />
            <TextField
              label="Codes per user"
              type="number"
              fullWidth
              value={codeCount}
              onChange={(e) => setCodeCount(e.target.value)}
              inputProps={{ min: 1 }}
              sx={fieldSx}
            />
            <TextField
              label="Minimum Points (optional)"
              placeholder="e.g., 100"
              type="number"
              fullWidth
              value={minPoints}
              onChange={(e) => setMinPoints(e.target.value)}
              helperText="Only assign to users with this many points or more."
              inputProps={{ min: 0 }}
              sx={fieldSx}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5, gap: 0.5 }}>
          <Button
            size="small"
            onClick={() => setAssignDialogOpen(false)}
            sx={{ color: JUICE.text2, textTransform: "none", fontSize: "0.75rem" }}
          >
            Cancel
          </Button>
          <Button
            size="small"
            onClick={handleAssignCodes}
            disabled={assignInvitationCodes.isPending}
            variant="contained"
            sx={{
              backgroundColor: ACCENT,
              color: JUICE.onAccent,
              textTransform: "none",
              fontSize: "0.75rem",
              "&:hover": { backgroundColor: alpha(ACCENT, 0.9) },
            }}
          >
            {assignInvitationCodes.isPending ? "Assigning..." : "Assign"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
