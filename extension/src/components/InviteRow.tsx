import { alpha, Box, Typography } from "@mui/material"
import { useNavigate } from "react-router"
import { useReferralStats } from "~/hooks/useReferral"
import { ACCENT, DIM } from "~/helpers/panelSurface"
import { JUICE } from "~/theme/juice"

/**
 * THE INVITE DOOR, ON THE FRONT DOOR, UNGATED.
 *
 * Measured 2026-09-19: 2,532 accounts, 45 codes ever minted, ZERO accounts
 * arrived through a link and ZERO links were ever copied. The mechanism
 * works end to end; nobody had been shown it. Both chip surfaces open only
 * after a landed trade and exactly one account has ever traded, so at most
 * one person had seen the invite anywhere, and the panel's own invite page
 * was reachable only through a small card on the leaderboard.
 *
 * So the door moves to the one screen every session starts on, above the
 * fold, with no trade required. The gate that used to stand here was a
 * deliberate 2026-09-17 call (an invite from someone who has not traded is
 * "try it, I don't know") and Lev lifted it on 2026-09-19 seeing the
 * zeroes: a filter on a funnel nobody enters filters nothing.
 *
 * TWO STATES, AND THE SECOND ONE IS THE POINT. Before anyone joins, the
 * row states the rule. After, it stops being a rule and becomes a METER:
 * how many friends are trading and what they have paid you. Nobody reads a
 * rule twice; a number that grows is read every time.
 */
export function InviteRow() {
  const navigate = useNavigate()
  const { data: stats } = useReferralStats()
  const joined = Number(stats?.referrals_count ?? 0)
  const earned = Number(stats?.total_earned_usd ?? 0)
  // No answer yet (signed out, or the first load) draws nothing: an empty
  // row that fills in a beat later is worse than one that arrives whole.
  if (!stats) return null
  const meter = joined > 0

  return (
    <Box
      component="button"
      onClick={() => navigate("/referral")}
      className="click-animation"
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        mb: 2,
        px: 1.5,
        py: "11px",
        borderRadius: "14px",
        border: `1px solid ${meter ? alpha("#FFFFFF", 0.1) : alpha(ACCENT, 0.34)}`,
        background: meter
          ? alpha("#FFFFFF", 0.05)
          : `linear-gradient(180deg, ${alpha(ACCENT, 0.1)}, ${alpha(ACCENT, 0.04)})`,
        color: "#FFFFFF",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        "&:hover": { background: alpha("#FFFFFF", 0.08) },
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          fontSize: 16,
          backgroundColor: alpha(ACCENT, 0.18),
        }}
      >
        🎟️
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>
          {meter ? `${joined} ${joined === 1 ? "friend" : "friends"} trading` : "Bring a friend"}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: DIM, lineHeight: 1.4 }}>
          {meter ? "earned from their trades" : "You earn 20% of their trading fees"}
        </Typography>
      </Box>
      {meter ? (
        <Box sx={{ textAlign: "right", flexShrink: 0 }}>
          <Typography
            sx={{
              fontSize: 15,
              fontWeight: 700,
              fontFamily: JUICE.mono,
              fontVariantNumeric: "tabular-nums",
              color: earned > 0 ? JUICE.green : DIM,
            }}
          >
            {`$${earned.toFixed(2)}`}
          </Typography>
        </Box>
      ) : (
        <Typography sx={{ color: DIM, fontSize: 16, lineHeight: 1, flexShrink: 0 }}>›</Typography>
      )}
    </Box>
  )
}
