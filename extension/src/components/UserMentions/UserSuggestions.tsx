import { JUICE } from "~/theme/juice"
import {
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  Popper
} from "@mui/material"
import { User } from "~/services/UserService"
import { CAvatar } from "../CAvatar"

interface UserSuggestionsProps {
  anchorEl: HTMLElement | null
  userSuggestions: User[] | undefined
  selectedUserIndex: number
  onSelectUser: (user: User) => void
  mentionQuery: string | null
}

export const UserSuggestions = ({
  anchorEl,
  userSuggestions,
  selectedUserIndex,
  onSelectUser,
  mentionQuery,
}: UserSuggestionsProps) => {
  const showSuggestions =
    Boolean(anchorEl) &&
    Boolean(mentionQuery) &&
    mentionQuery!.length > 1 &&
    Boolean(userSuggestions && userSuggestions.length > 0)

  if (!showSuggestions) return null

  return (
    <Popper
      open={showSuggestions}
      anchorEl={anchorEl}
      placement="bottom-start"
      style={{ zIndex: 1300 }}
    >
      <Paper
        sx={{
          width: 250,
          maxHeight: 200,
          overflow: "auto",
          bgcolor: "transparent",
          border: `1px solid ${JUICE.border}`,
          borderRadius: "12px",
          mt: 1,
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        <List sx={{ py: 0, height: 150 }}>
          {userSuggestions && userSuggestions.length > 0
            ? userSuggestions.map((user, index) => (
                <ListItemButton
                  key={user.id}
                  onClick={() => onSelectUser(user)}
                  selected={index === selectedUserIndex}
                  sx={{
                    py: 0.5,
                    bgcolor:
                      index === selectedUserIndex
                        ? JUICE.border
                        : "transparent",
                    "&:hover": {
                      bgcolor: JUICE.border,
                    },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 36 }}>
                    <CAvatar
                      src={user.profile_photo_url || undefined}
                      sx={{ width: 24, height: 24 }}
                    />
                  </ListItemAvatar>
                  <ListItemText
                    primary={user.display_name}
                    secondary={`@${user.username}`}
                    primaryTypographyProps={{
                      fontSize: "12px",
                      fontWeight: "medium",
                      color: "white",
                    }}
                    secondaryTypographyProps={{
                      fontSize: "10px",
                      color: "grey.500",
                    }}
                  />
                </ListItemButton>
              ))
            : null}
        </List>
      </Paper>
    </Popper>
  )
}
