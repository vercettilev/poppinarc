import { JUICE } from "~/theme/juice"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  Close as CloseIcon
} from "@mui/icons-material"
import {
  alpha,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  TextareaAutosize,
  Typography,
  useTheme
} from "@mui/material"
import { motion } from "framer-motion"
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useController, useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import * as z from "zod"
import { CAvatar } from "~/components/CAvatar"
import { GifTag } from "~/components/GifSearch"
import { ContentWithMentionsPreview } from "~/components/UserMentions/ContentWithMentions"
import { UserSuggestions } from "~/components/UserMentions/UserSuggestions"
import { useComments, useCreateComment } from "~/hooks/useComments"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useMentions } from "~/hooks/useMentions"
import { useTippersForPost } from "~/hooks/useWallet"
import { useAppConfigStore } from "~/store/useAppConfigStore"
import { useUIStore } from "~/store/useUIStore"
import CommentPage from "./CommentPage"

const EmojiGifWrapper = lazy(() => import("~/components/EmojiGifWrapper"))

interface CommentSectionProps {
  postId: string
  isReply?: boolean
  parentId?: string
  announcement_id?: string
  replyToUsername?: string
  onReplyStateChange?: (isReplying: boolean) => void
}

// Update the Comment interface with required properties
interface Comment {
  id: string
  content: string
  created_at: string
  user: {
    id: string
    username: string
    profile_photo_url?: string | null
    display_name?: string
    ditto?: number
    activeStreakCount?: number
    twitter_id?: string | null
  }
  tip_amount?: string
  tip_token?: string
  recipient_username?: string
}

export interface PaginatedComments {
  data: Comment[]
}

/**
 * "LOAD MORE", DECLARED ONCE.
 *
 * This used to be `const LoadMoreButton = React.memo(...)` INSIDE the
 * component body, with a comment calling it memoized. It was the opposite of
 * memoized: a fresh component type on every render, so React could never
 * reconcile it and tore the Button subtree down and rebuilt it instead. And
 * CommentSection re-renders on every keystroke in the composer —
 * `watch("content")` and `useController({ name: "content" })` below both
 * subscribe it to the field — so the one control a reader is reaching for
 * while reading a long thread was being remounted per character.
 *
 * Hoisted to module scope it is a stable type, and the memo can actually bail
 * out: the button only re-renders when `isFetchingNextPage` flips.
 *
 * The label swap keeps the row still on purpose — `width: "100%"` and a fixed
 * `height: "28px"` mean "Load more" -> "Loading..." plus a spinner cannot
 * change the button's box, so the thread above it does not move.
 */
const LoadMoreButton = React.memo(function LoadMoreButton({
  isFetchingNextPage,
  onLoadMore,
}: {
  isFetchingNextPage: boolean
  onLoadMore: () => void
}) {
  return (
    <Box sx={{ textAlign: "center", mt: 2, width: "100%" }}>
      <Button
        variant="outlined"
        size="small"
        onClick={onLoadMore}
        disabled={isFetchingNextPage}
        sx={{
          color: "#FFFFFF",
          borderColor: JUICE.border,
          padding: "4px 10px",
          minWidth: "unset",
          fontSize: "0.75rem",
          borderRadius: "999px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          "&:hover": {
            borderColor: "primary.main",
            backgroundColor: JUICE.well,
          },
          width: "100%",
          height: "28px",
        }}
      >
        {isFetchingNextPage ? <CircularProgress size={16} /> : null}
        {isFetchingNextPage ? "Loading..." : "Load more"}
      </Button>
    </Box>
  )
})

const CommentSection = React.memo(
  ({ postId, isReply = false, parentId, announcement_id, replyToUsername, onReplyStateChange }: CommentSectionProps) => {
    const theme = useTheme()
    const { organization } = useAppConfigStore()
    /**
     * TAPPING AN AVATAR IN A THREAD USED TO DO NOTHING AT ALL.
     *
     * `handleUserClick` below called `navigate()` from helpers/navigation, a
     * module whose `navigateFunction` was only ever filled by
     * `setNavigateFunction` — an export with exactly one occurrence in the
     * tree, its own declaration. So the call always fell through to a
     * `NAVIGATE` message to the service worker, which broadcast a
     * `"route-store"` update the panel's store map has no key for: a dead tap
     * and a TypeError. The panel routes through MemoryRouter
     * (providers/RouterWrapper.tsx), so this hook is what actually moves it.
     */
    const navigate = useNavigate()

    const { data: currentUser } = useCurrentUser()
    const { mutate: createComment, isPending } = useCreateComment()

    // Add state for emoji and gif support
    const [emojiAnchorEl, setEmojiAnchorEl] = useState<null | HTMLElement>(null)
    const isEmojiPickerOpen = Boolean(emojiAnchorEl)
    const [activeTab, setActiveTab] = useState<"emoji" | "gif">("emoji")
    const [selectedGif, setSelectedGif] = useState<GifTag | null>(null)
    const {isSignInModalOpen, setIsSignInModalOpen} = useUIStore()

    const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
      useComments({
        post_id: postId,
        limit: 10,
        parent_id: parentId,
      })

    // Fetch tippers for this post (for tipper badge on comments)
    const { data: tippersData } = useTippersForPost(postId)
    const tipperIds = useMemo(() => tippersData?.tipperIds || [], [tippersData])

    // Memoize pages to prevent unnecessary re-renders
    const commentPages = useMemo(
      () => (data?.pages as PaginatedComments[]) || [],
      [data?.pages]
    )

    const totalReplies = useMemo(() => {
      try {
        return commentPages.reduce((sum: number, page: PaginatedComments) => sum + (page?.data?.length || 0), 0)
      } catch {
        return 0
      }
    }, [commentPages])

    const commentSchema = z.object({
      content: z
        .string()
        .trim()
        .max(360, "Comment cannot exceed 360 characters")
        .optional()
        .default(""),
    })

    const {
      handleSubmit,
      control,
      reset,
      formState: { errors },
      setValue, // Add setValue to use with emoji picker
      watch, // Add watch to get current content value
    } = useForm<{ content: string }>({
      resolver: zodResolver(commentSchema),
      mode: "onSubmit",
      defaultValues: {
        content: "",
      },
    })

    const content = watch("content", "") // Watch the content field
    const hasMedia = selectedGif

    const {
      field: { onChange, value, ref },
    } = useController({
      name: "content",
      control,
    })

    // === Added local ref for the textarea to enable focusing ===
    const inputRef = React.useRef<HTMLTextAreaElement | null>(null)

    // Handle emoji button click
    const handleEmojiButtonClick = (event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation()
      setEmojiAnchorEl(event.currentTarget)
    }

    // Handle emoji picker close
    const handleEmojiPickerClose = () => {
      setEmojiAnchorEl(null)
    }

    // Handle emoji selection
    const handleEmojiSelect = (emoji: { emoji: string }) => {
      // Get the current content
      const currentContent = value || ""

      // Update the form value
      setValue("content", currentContent + emoji.emoji, {
        shouldValidate: true,
        shouldDirty: true,
      })

      handleEmojiPickerClose()
    }

    // Handle gif selection
    const handleGifSelect = (gif: GifTag) => {
      setSelectedGif(gif)
      handleEmojiPickerClose()
    }

    const handleCommentSubmit = useCallback(
      (data: { content: string }) => {
        // Check if user is logged in
        if (!currentUser || (currentUser && !currentUser.username)) {
          setIsSignInModalOpen(true)
          return
        }

        // Check if there's content or media to post
        if ((!data.content || !data.content.trim()) && !selectedGif) {
          return
        }

        createComment(
          {
            content: data.content || "",
            post_id: postId,
            parent_id: parentId,
            gifUrl: selectedGif?.image, // Add the gifUrl if there's a selected GIF
            announcement_id, // Pass announcement_id if it exists
          },
          {
            onSuccess: () => {
              reset()
              setSelectedGif(null) // Clear selected GIF after successful submission
            },
          }
        )
      },
      [createComment, parentId, postId, reset, selectedGif, announcement_id, currentUser] // Add currentUser to dependencies
    )

    useEffect(() => {
      if (inputRef.current) {
        inputRef.current.focus()
      }
    }, [])

    // Notify parent component when reply state changes
    useEffect(() => {
      onReplyStateChange?.(isPending)
    }, [isPending, onReplyStateChange])

    const handleUserClick = useCallback(
      (userId: string) => {
        navigate(`/profile/${userId}`)
      },
      [navigate],
    )

    /** Stable, so the hoisted LoadMoreButton's memo can actually bail out. */
    const handleLoadMore = useCallback(() => {
      fetchNextPage()
    }, [fetchNextPage])

    // Add mentions functionality
    const {
      mentionQuery,
      mentionAnchorEl,
      selectedUserIndex,
      userSuggestions,
      handleTextChange: handleMentionTextChange,
      handleKeyDown: handleMentionKeyDown,
      handleSelectUser,
    } = useMentions()

    return (
      <>
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{ overflow: "hidden" }}
        >
          {/* Header outside of the composer box */}
          <Typography
            variant="body2"
            sx={{
              color: theme.palette.primary.main,
              fontSize: "11px",
              fontWeight: 500,
              mt: 1,
              mb: 0.25,
            }}
          >
            {`Replies${totalReplies ? ` (${totalReplies})` : ""}`}
          </Typography>

          <Box
            sx={{
              mt: 0.5,
              mb: "10px",
              mx: 0,
              padding: "10px",
              backgroundColor: alpha("#FFFFFF", 0.04),
              border: `1px solid ${alpha("#FFFFFF", 0.1)}`,
              borderRadius: "12px",
              transition: "background-color .15s ease, border-color .15s ease",
              "&:hover": {
                backgroundColor: alpha("#FFFFFF", 0.06),
                borderColor: alpha("#FFFFFF", 0.18),
              },
            }}
            onClick={() => {
              if (inputRef.current) {
                inputRef.current.focus()
              }
            }}
          >
            <Stack spacing={2}>

              <Box component="form" onSubmit={handleSubmit(handleCommentSubmit)}>
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <Box>
                    <CAvatar
                      src={currentUser?.profile_photo_url || undefined}
                      sx={{
                        width: 24,
                        height: 24,
                        cursor: "pointer",
                      }}
                      onClick={() =>
                        currentUser?.id && handleUserClick(currentUser.id)
                      }
                    />
                  </Box>

                  <Box sx={{ flex: 1, position: "relative",
                    "& textarea::placeholder": {
                      color: alpha(theme.palette.secondary.contrastText, 0.8),
                    }
                   }}>
                    <TextareaAutosize
                      ref={(el: HTMLTextAreaElement | null) => {
                        ref(el)
                        inputRef.current = el
                      }}
                      
                      value={value || ""}
                      onChange={(e) => handleMentionTextChange(e, onChange)}
                      maxLength={360}
                      minRows={1}
                      maxRows={2}
                      placeholder={
                        replyToUsername
                          ? `In reply to @${replyToUsername}`
                          : isReply
                            ? "Write a reply..."
                            : "Write a comment..."
                      }
                      style={{
                     
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        resize: "none",
                        color: theme.palette.secondary.contrastText,
                        fontSize: "11px",
                        fontFamily: "inherit",
                        padding: "0 0 0 4px",
                        outline: "none",
                        marginTop: "2px",
                      }}
                      onKeyDown={(e) =>
                        handleMentionKeyDown(
                          e,
                          value || "",
                          (newValue) =>
                            setValue("content", newValue, {
                              shouldValidate: true,
                              shouldDirty: true,
                            }),
                          () => {
                            if (!isPending && (value?.trim() || selectedGif)) {
                              handleSubmit(handleCommentSubmit)()
                            }
                          }
                        )
                      }
                    />

                    {/* Add mentions preview */}
                    <ContentWithMentionsPreview
                      content={value || ""}
                      fontSize="11px"
                    />

                    {/* Add user suggestions */}
                    <UserSuggestions
                      anchorEl={mentionAnchorEl}
                      userSuggestions={userSuggestions}
                      selectedUserIndex={selectedUserIndex}
                      onSelectUser={(user) =>
                        handleSelectUser(user, value || "", (newValue) =>
                          setValue("content", newValue, {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        )
                      }
                      mentionQuery={mentionQuery}
                    />

                    {/* Display selected GIF if there is one */}
                    {selectedGif && (
                      <Box
                        sx={{ mt: 2, position: "relative", maxWidth: "150px" }}
                      >
                        <Box
                          component="img"
                          src={selectedGif.image}
                          alt={selectedGif.name}
                          sx={{
                            width: "100%",
                            height: "auto",
                            borderRadius: 1,
                          }}
                        />
                        <IconButton
                          size="small"
                          onClick={() => setSelectedGif(null)}
                          sx={{
                            position: "absolute",
                            top: -8,
                            right: -8,
                            bgcolor: "background.paper",
                            "&:hover": {
                              bgcolor: "background.paper",
                            },
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 16, color: "white" }} />
                        </IconButton>
                      </Box>
                    )}

                    {errors.content && (
                      <Typography
                        variant="caption"
                        sx={{ color: "error.main", mt: 0.25, fontSize: "10px" }}
                      >
                        {errors.content.message}
                      </Typography>
                    )}

                    {/* THE ROW DOES NOT COLLAPSE WHEN YOU SEND.
                        Pressing the submit button swapped this row's contents
                        for a 2px progress bar, so the row lost its height and
                        every comment below the composer jumped up under the
                        reader's finger at the exact moment they were still
                        touching the screen.

                        24px is the loaded row measured, not guessed: the tall
                        child is EmojiGifWrapper's MUI IconButton at
                        size="small" — 5px of padding either side of a 14px
                        svg (IconButton's own `padding: 5` for the small size;
                        the 14px is set twice, by the `& svg` sx passed below
                        and by EmojiGifWrapper's own). The submit button beside
                        it is shorter, 22px, and the lazy Suspense fallback
                        shorter still at 16px, so the IconButton is the floor
                        and this matches it exactly.

                        `display: "flex"` on that IconButton (in the sx below)
                        is part of the measurement, not decoration: as MUI
                        ships it the button is `inline-flex`, so its wrapper
                        div's height is a LINE box — button height plus
                        whatever half-leading the inherited 14px/1.5 strut
                        adds under the baseline, a fraction of a pixel nobody
                        can write down. Block-level, the wrapper is exactly as
                        tall as the button, and 24px is a number rather than
                        an estimate. */}
                    <Box
                      sx={{
                        mt: 0.5,
                        minHeight: "24px",
                        display: "flex",
                        justifyContent: "flex-end",
                        alignItems: "center",
                        gap: 0.75,
                      }}
                    >
                      {isPending ? (
                        <Box
                          sx={{
                            height: "2px",
                            width: "100%",
                            backgroundColor: alpha(theme.palette.primary.main, 0.3),
                            borderRadius: "1px",
                            overflow: "hidden",
                            position: "relative",
                            "&::after": {
                              content: '""',
                              position: "absolute",
                              top: 0,
                              left: 0,
                              height: "100%",
                              width: "100%",
                              background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.3)}, ${theme.palette.primary.main}, ${alpha(theme.palette.primary.main, 0.3)})`,
                              animation: "loading 1.5s infinite",
                            },
                            "@keyframes loading": {
                              "0%": {
                                transform: "translateX(-100%)",
                              },
                              "100%": {
                                transform: "translateX(100%)",
                              },
                            },
                          }}
                        />
                      ) : (
                        <>
                          <Suspense fallback={<CircularProgress size={16} />}>
                            <EmojiGifWrapper
                              handleEmojiButtonClick={handleEmojiButtonClick}
                              handleEmojiPickerClose={handleEmojiPickerClose}
                              handleEmojiSelect={handleEmojiSelect}
                              handleGifSelect={handleGifSelect}
                              emojiAnchorEl={emojiAnchorEl}
                              isEmojiPickerOpen={isEmojiPickerOpen}
                              activeTab={activeTab}
                              setActiveTab={setActiveTab}
                              sx={{
                                // Block-level, so the wrapper around this
                                // button is exactly 5 + 14 + 5 = 24px and not
                                // a line box with a strut's leading under it.
                                // See the row's note above.
                                display: "flex",
                                "& svg": {
                                  width: "14px",
                                  height: "14px",
                                },
                              }}
                            />
                          </Suspense>

                          {value?.trim() && (
                            <Box
                              component="button"
                              type="submit"
                              disabled={isPending}
                              sx={{
                                width: "48px",
                                height: "22px",
                                fontSize: "12px",
                                fontWeight: "bold",
                                color: theme.palette.primary.contrastText,
                                bgcolor: theme.palette.primary.main,
                                borderRadius: "10px", 
                                border: `0.5px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                                cursor: isPending ? "not-allowed" : "pointer",
                                opacity: isPending ? 0.7 : 1,
                                "&:hover": {
                                  bgcolor: alpha(theme.palette.primary.main, 0.9),
                                },
                                transition: "all 0.2s ease-in-out",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                              }}
                            >
                              {isReply ? "Reply" : "Reply"}
                            </Box>
                          )}
                        </>
                      )}
                    </Box>
                  </Box>
                </Stack>
              </Box>
            </Stack>
          </Box>

          {/* Replies list is rendered OUTSIDE the composer box at all depths */}
          <Box sx={{ mt: 0 }}>
            <Stack spacing={1}>
              {commentPages.map((page: PaginatedComments, i: number) => (
                <CommentPage
                  isReply={isReply}
                  postId={postId}
                  key={`comment-page-${i}`}
                  page={page}
                  announcement_id={announcement_id}
                  tipperIds={tipperIds}
                />
              ))}
            </Stack>
            {hasNextPage && (
              <LoadMoreButton
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={handleLoadMore}
              />
            )}
          </Box>
        </motion.div>

        {/* Sign In Modal */}
        
      </>
    )
  }
) as React.FC<CommentSectionProps>

export default CommentSection
