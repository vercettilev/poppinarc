import { alpha, Box, Stack, Typography, Avatar } from "@mui/material"
import React from "react"
import { JUICE } from "~/theme/juice"
import { formatDistanceToNowWithDate } from "~/utils/dateUtils"
import { CAvatar } from "./CAvatar"

interface User {
  id: string
  display_name: string
  username: string
  profile_photo_url?: string
}

interface TipCommentProps {
  id: string
  user: User
  tipAmount: string
  tipToken: string
  message?: string
  created_at: string
  recipientUsername: string
}

const TipComment: React.FC<TipCommentProps> = ({
  id,
  user,
  tipAmount,
  tipToken,
  message,
  created_at,
  recipientUsername
}) => {
  return (
    <Box
      sx={{
        py: "12px",
        px: "16px",
        backgroundColor: alpha(JUICE.accent, 0.08),
        border: `1px solid ${JUICE.accent}`,
        borderRadius: "10px",
        position: "relative"
      }}
    >
      <Stack spacing={1.5}>
        {/* User Info */}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CAvatar
            src={user.profile_photo_url}
            sx={{
              width: 36,
              height: 36
            }}
          />
          <Box>
            <Typography
              sx={{
                fontSize: "14px",
                fontWeight: 600,
                color: "#FFFFFF",
                lineHeight: 1.3
              }}
            >
              {user.display_name}
            </Typography>
            <Typography
              sx={{
                fontSize: "12px",
                color: "#8B92A0",
                lineHeight: 1.2
              }}
            >
              @{user.username}
            </Typography>
          </Box>
        </Stack>

        {/* Tip Information */}
        <Box sx={{ mt: 0.5 }}>
          <Typography
            component="div"
            sx={{
              fontSize: "14px",
              color: JUICE.accent,
              fontWeight: 400,
              display: "flex",
              alignItems: "center",
              gap: 0.5
            }}
          >
            Tipped {tipAmount} {tipToken} to{" "}
            <Typography
              component="span"
              sx={{
                color: JUICE.accent,
                fontWeight: 500,
                fontSize: "14px"
              }}
            >
              @{recipientUsername}
            </Typography>
            <Box
              component="span"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                ml: 0.5,
                width: 18,
                height: 18,
                backgroundColor: "#302164",
                borderRadius: "4px"
              }}
            >
              <Typography
                sx={{
                  background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  fontSize: "14px",
                  fontWeight: 700,
                  lineHeight: 1
                }}
              >
                ≡
              </Typography>
            </Box>
          </Typography>

          {/* Tip Message */}
          {message && (
            <Typography
              sx={{
                fontSize: "14px",
                color: "#FFFFFF",
                lineHeight: 1.5,
                mt: 0.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              }}
            >
              {message}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  )
}

export default TipComment