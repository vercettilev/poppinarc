import { Box, Stack, Typography } from "@mui/material"
import React from "react"
import { Comment } from "~/services/CommentService"
import UpvoteButton from "./UpvoteButton"
import { CommentIcon } from "./icons"

interface CommentFooterProps {
  comment: Comment
  isUpvoted: boolean
  onUpvoteClick: () => void
  onCommentClick: () => void
}

const CommentFooter = React.memo(
  ({
    comment,
    isUpvoted,
    onUpvoteClick,
    onCommentClick,
  }: CommentFooterProps) => {
    const {
      id,
      content,
      user,
      created_at,
      upvotes,
      comment_count,
      reply_count,
    } = comment

    return (
      <Stack
        direction="row"
        alignItems="center"
        sx={{ mt: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <UpvoteButton
            data={{
              id,
              content,
              user,
              created_at,
              upvotes: comment.upvotes,
              isUpvoted,
              updated_at: created_at,
              user_id: user.id,
              deleted_at: null,
              last_commented_at: null,
              only_followers: false,
              on_chain: false,
              downvotes: 0,
              website_url: "",
              comment_count: 0,
              reply_count: 0,
              view_count: 0,
            }}
            isUpvoted={isUpvoted}
            onUpvoteClick={() => {
              onUpvoteClick()
            }}
          />

          <Box
            component="button"
            onClick={(e) => {
              e.stopPropagation()
              onCommentClick()
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              backgroundColor: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              "&:hover": {
                "& .icon": {
                  color: "primary.main",
                },
              },
            }}
          >
            <CommentIcon
              className="icon"
              sx={{
                color: "#C4BFBF",
                fontSize: 20,
              }}
              height={16}
              width={16}
            />
            {/* THE COUNT GOES WHEN THERE IS NO COUNT — and what goes is the
                ELEMENT, not just its text. This printed a literal `0` beside
                the bubble on every comment nobody had answered: the loud
                version of the defect reported against the panel's post row
                ("the comment button reserves space for a number that is not
                there"). A row of zeroes reads as "nobody cared", which is a
                claim the product has no business making on a young feed.

                Emptying the string would not have been enough either. An
                empty <Typography/> is invisible but is still a flex item, so
                the parent's `gap: 4px` above keeps drawing a hole to the
                right of the glyph and the control reads as a chip with its
                number missing. UpvoteButton.tsx guards the whole element for
                exactly this reason; this now matches it.

                NOTE FOR WHOEVER FINDS THIS FILE: nothing imports
                CommentFooter today — the live row is PostFooter.tsx — so
                this changes no pixel on screen right now. It is fixed here
                so the bug cannot ride back in the day somebody mounts this
                component or copies it into a new one, which is how this
                exact defect got two homes in the first place. */}
            {(comment_count || reply_count) > 0 && (
              <Typography
                variant="body2"
                sx={{
                  color: "#C4BFBF",
                  fontSize: "10px",
                }}
                fontWeight="bold"
              >
                {comment_count || reply_count}
              </Typography>
            )}
          </Box>
        </Stack>
      </Stack>
    )
  }
)

export default CommentFooter
