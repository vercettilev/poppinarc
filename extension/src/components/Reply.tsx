import { Box, Stack, Theme, Typography, useTheme } from "@mui/material"
import { AnimatePresence } from "framer-motion"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useToast } from "~/components/Toast/ToastProvider"
import { useCommentVote, useDeleteComment } from "~/hooks/useComments"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useDeleteWebsitePost } from "~/hooks/useWebsitePosts"
import { useWebsitePostVote } from "~/hooks/useWebsitePostVote"
import { useActionMenuDialogStore } from "~/store/useActionMenuDialogStore"
import { useRouteStore } from "~/store/useRouteStore"
import { WebsitePost } from "~/types/websitePost"
import { Organization } from "~/services/UserService"
import CommentSection from "./Post/Comments/CommentSection"
import PostHeader from "./Post/PostHeader"
import PostFooter from "./PostFooter"

interface User {
  id: string
  display_name: string
  username: string
  profile_photo_url?: string
  ditto?: number
}

interface Comment {
  id: string
  content: string
  created_at: string
  user: User
}

const decodeHtmlEntities = (text: string): string => {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

const cleanUrl = (url: string): string => {
  try {
    // Parse the URL to extract components
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.replace(/^www\./, '')
    const pathname = urlObj.pathname
    const search = urlObj.search
    
    // Combine hostname, pathname, and search params
    const fullPath = hostname + pathname + search
    
    // If the full path is longer than 25 characters, truncate after hostname + 5-6 chars
    if (fullPath.length > 25) {
      const afterHostname = pathname + search
      const truncatedAfter = afterHostname.substring(0, 6)
      
      return hostname + truncatedAfter + (afterHostname.length > 6 ? "..." : "")
    }
    
    // Return the full path if it's short enough
    return fullPath
  } catch {
    // Fallback to simple cleaning if URL parsing fails
    return url.replace(/^(https?:\/\/)?(www\.)?/i, "")
  }
}

const formatContent = (
  content: string,
  onMentionClick: (username: string) => void
) => {
  const { setDialogMode, setExternalLinkUrl } = useActionMenuDialogStore()
  
  // First split by mentions
  const mentionParts = content.split(/([@]\w+)/g)
  
  return mentionParts.map((part, partIndex) => {
    if (part.startsWith("@")) {
      return (
        <Typography
          component={"span"}
          key={`mention-${partIndex}`}
          onClick={(e) => {
            e.stopPropagation()
            onMentionClick(part.substring(1))
          }}
          sx={(theme) => ({
            color: theme.palette.primary.main,
            cursor: "pointer",
          })}
        >
          {part}
        </Typography>
      )
    }
    
    // For non-mention parts, check for URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const urlParts = part.split(urlRegex)
    
    return urlParts.map((urlPart, urlIndex) => {
      if (urlRegex.test(urlPart)) {
        return (
          <Typography
            component={"span"}
            key={`url-${partIndex}-${urlIndex}`}
            title={urlPart}
            onClick={(e) => {
              e.stopPropagation()
              // Show external link warning dialog
              setExternalLinkUrl(urlPart)
              setDialogMode("externalLink")
            }}
            sx={(theme) => ({
              color: theme.palette.primary.main,
              textDecoration: "none",
              cursor: "pointer",
              verticalAlign: "baseline",
              "&:hover": {
                textDecoration: "underline",
              },
            })}
          >
            {cleanUrl(urlPart)}
          </Typography>
        )
      }
      
      return (
        <Typography component={"span"} key={`text-${partIndex}-${urlIndex}`}>
          {urlPart}
        </Typography>
      )
    })
  })
}

export default React.memo(
  ({
    id,
    content,
    user,
    created_at,
    upvotes,
    downvotes,
    comment_count,
    reply_count,
    view_count,
    website_url,
    gifUrl,
    isUpvoted: initialIsUpvoted = false,
    isFromDetailView = false,
    isReply,
    announcement_id,
    userStreak = 0,
    userOrganizations,
    isTipper = false,
    ...rest
  }: WebsitePost & { isFromDetailView?: boolean; isReply?: boolean; announcement_id?: string; userStreak?: number; userOrganizations?: Organization[]; isTipper?: boolean }) => {
    const [isUpvoted, setIsUpvoted] = useState(initialIsUpvoted)
    const [upvoteCount, setUpvoteCount] = useState(upvotes)
    const { mutate: votePost } = useWebsitePostVote()
    const { mutate: voteComment } = useCommentVote()

    const { data: currentUser } = useCurrentUser()
    const { mutate: deletePost, isPending: isDeleting } = useDeleteWebsitePost()

    const { mutate: deleteComment, isPending: isDeletingComment } =
      useDeleteComment()

    const { showToast } = useToast()
    const navigate = useNavigate()
    const theme = useTheme()

    useEffect(() => {
      setIsUpvoted(initialIsUpvoted)
    }, [initialIsUpvoted])

    useEffect(() => {
      setUpvoteCount(upvotes)
    }, [upvotes])

    const handleUpvote = useCallback(() => {
      if (!currentUser) return

      const newIsUpvoted = !isUpvoted
      const newUpvoteCount = isUpvoted ? upvoteCount - 1 : upvoteCount + 1

      // Optimistically update UI
      setIsUpvoted(newIsUpvoted)
      setUpvoteCount(newUpvoteCount)

      if (rest.post_id) {
        voteComment(
          {
            id,
            vote: newIsUpvoted ? "upvote" : "unupvote",
            isAlreadyVoted: isUpvoted,
            authorId: user.id,
            parentId: rest.post_id,
          },
          {
            onError: () => {
              // Revert on error
              setIsUpvoted(isUpvoted)
              setUpvoteCount(upvoteCount)
            },
          }
        )
      } else {
        votePost(
          {
            id,
            vote: newIsUpvoted ? "upvote" : "unupvote",
            isAlreadyVoted: isUpvoted,
            authorId: user.id,
            parentId: id,
          },
          {
            onError: () => {
              // Revert on error
              setIsUpvoted(isUpvoted)
              setUpvoteCount(upvoteCount)
            },
          }
        )
      }

      // Call mutation
    }, [
      currentUser,
      id,
      isUpvoted,
      upvoteCount,
      user.id,
      votePost,
      voteComment,
    ])

    const handleEdit = useCallback(() => {
      // TODO: implement edit post
    }, [])

    const handleDelete = useCallback(() => {
      deleteComment(id, {
        onSuccess: () => {
          showToast(
            `${isReply ? "Reply" : "Comment"} deleted successfully`,
            "success",
            {
              vertical: "bottom",
              horizontal: "center",
            }
          )
        },
        onError: (error) => {
          showToast(
            `Failed to delete ${
              isReply ? "reply" : "comment"
            }. Please try again.`,
            "error",
            {
              vertical: "bottom",
              horizontal: "center",
            }
          )
        },
      })
    }, [deleteComment, id, showToast, isReply])

    const handleReport = useCallback(() => {
      // TODO: implement report
    }, [])

    const [showComments, setShowComments] = useState(false)
    const [isReplying, setIsReplying] = useState(false)

    const { currentRoute } = useRouteStore()

    useEffect(() => {
      if (isFromDetailView) {
        setShowComments(true)
      }
    }, [currentRoute])

    const handleCommentClick = useCallback(() => {
      setShowComments((prev) => !prev)
    }, [])

    const handleMentionClick = useCallback(async (username: string) => {
        // `/feed`, not `/` — see PostHeader's note: `/` is the positions
        // screen now and reads none of this state.
        navigate(`/feed`, {
          state: {
            username,
            from: "post",
          }
        })
    }, [navigate])

    return (
      <>
        <Box
          sx={(theme: Theme) => ({
            py: "10px",
            px: isTipper ? "10px" : "0px",
            backgroundColor: isTipper ? "rgba(103, 198, 254, 0.08)" : "transparent",
            borderRadius: "10px",
            border: isTipper ? "1px solid #67C6FE" : "none",
            position: "relative",
          })}
        >
          {/* Tipper Badge */}
          {isTipper && (
            <Box
              sx={{
                position: "absolute",
                top: -8,
                right: 12,
                width: 20,
                height: 20,
                backgroundColor: "#302164",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid rgba(255,255,255,0.08)"
              }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
                  borderRadius: "2px"
                }}
              />
            </Box>
          )}
          <Stack spacing={1.5}>
            <PostHeader
              user={user}
              currentUserId={currentUser?.id}
              onDelete={handleDelete}
              website_url={website_url}
              postId={id}
              contentType={isReply ? "reply" : "comment"}
              announcement_id={announcement_id}
              userStreak={userStreak}
              userOrganizations={userOrganizations}
              isOwnProfile={false}
            />
            <Typography
              color="white"
              variant="body1"
              sx={{
                fontSize: "12px",
                lineHeight: "20px",
                fontWeight: "regular",
                mt: 0.5,
                whiteSpace: "pre-wrap",
                ml: "34px !important",
              }}
            >
              {formatContent(decodeHtmlEntities(content), handleMentionClick)}
            </Typography>
            {gifUrl && (
              <div className="flex w-max items-center ">
                <img
                   style={{
                    width: "-webkit-fill-available",
                  }}
                  src={gifUrl}
                  alt="gif"
                  className="max-h-[112px] rounded-lg object-contain"
                />
              </div>
            )}
            <PostFooter
              sx={{
                marginLeft: "34px !important",
              }}
              contentType={isReply ? "reply" : "reply"}
              post={{
                id,
                content,
                gifUrl,
                user,
                created_at,
                upvotes: upvoteCount,
                downvotes,
                comment_count,
                reply_count,
                view_count,
                website_url,
                isUpvoted,
                updated_at: created_at,
                user_id: user.id,
                deleted_at: null,
                last_commented_at: null,
                only_followers: false,
                on_chain: false,
                post_id: rest.post_id,
              }}
              isUpvoted={isUpvoted}
              showComments={showComments}
              onUpvoteClick={handleUpvote}
              onCommentClick={handleCommentClick}
              fromReply={true}
            />
          </Stack>
        </Box>
        <AnimatePresence>
          {showComments && (
            <CommentSection
              parentId={id}
              postId={rest.post_id || id}
              isReply={true}
              announcement_id={announcement_id}
              replyToUsername={user?.username}
              onReplyStateChange={setIsReplying}
            />
          )}
        </AnimatePresence>
      </>
    )
  }
)
