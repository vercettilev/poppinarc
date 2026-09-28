import { Box, Typography, useTheme } from "@mui/material"


import NoPostsYet from "~/assets/NoPostsYet.png"
import NoRepliesYet from "~/assets/NoRepliesYet.png"
import LikeIcon from "~/assets/task-perpetual-get-like.png"

import Person from "~/assets/task-add-profile-picture.png"

interface EmptyStateProps {
  type: "upvotes" | "posts" | "replies" | "followers" | "following"
}

const EmptyState = ({ type }: EmptyStateProps) => {

  const noPostsYetUrl = new URL(NoPostsYet, import.meta.url).href

  const noRepliesYetUrl = new URL(NoRepliesYet, import.meta.url).href

  const likeIconUrl = new URL(LikeIcon, import.meta.url).href

  const personIconUrl = new URL(Person, import.meta.url).href

  const theme = useTheme()


  const config = {
    // The KEY is `upvotes` and the SENTENCE says "liked". That mismatch is
    // deliberate, not a leftover: the key is the schema's word — it is what
    // ProfileFeed passes and what the /users/upvoted-* endpoints are called —
    // while the sentence is the reader's, and everywhere the product speaks
    // to a reader it says "like" (notificationText collapses every upvote_*
    // row to the kind "like"). Renaming the key would be a refactor across
    // the API surface for no reader's benefit; renaming the sentence was the
    // whole point. The icon has always been the Like icon.
    upvotes: {
      icon: <img src={likeIconUrl} alt="Like Icon" style={{ height: "144px" }} />,
      text: "No liked posts yet",
    },
    posts: {
      icon: (
        <img src={noPostsYetUrl} alt="No Posts Yet" style={{ height: "144px", marginLeft: 40 }} />
      ),
      text: "No posts yet",
    },
    replies: {
      icon: <img src={noRepliesYetUrl} alt="No Replies Yet" style={{ height: "144px" }} />,
      text: "No replies yet",
    },
    followers: {
      icon: <img src={personIconUrl} alt="Person Icon" style={{ height: "144px" }} />,
      text: "No followers yet",
    },
    following: {
      icon: <img src={personIconUrl} alt="Person Icon" style={{ height: "144px" }} />,
      text: "Not following anyone yet",
    },
  }

  const { icon, text } = config[type]

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 8,
        gap: 2,
      }}
    >
      {icon}
      <Typography variant="body1" color={theme.palette.secondary.contrastText}>
        {text}
      </Typography>
    </Box>
  )
}

export default EmptyState
