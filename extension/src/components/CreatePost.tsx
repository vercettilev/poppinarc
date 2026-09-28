import { JUICE } from "~/theme/juice"
import { zodResolver } from "@hookform/resolvers/zod"
import { Close as CloseIcon } from "@mui/icons-material"
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined"
import {
  alpha,
  Box,
  CircularProgress,
  darken,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  Stack,
  TextareaAutosize,
  Theme,
  Typography,
  useTheme
} from "@mui/material"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useController, useForm } from "react-hook-form"
import { useDebounceValue } from "usehooks-ts"
import * as z from "zod"
import { GifTag } from "~/components/GifSearch"
import { useToast } from "~/components/Toast/ToastProvider"
import { removeUrlPrefixes } from "~/helpers/urlHelper"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useGetUsers } from "~/hooks/useGetUsers"
import { useCreateWebsitePost } from "~/hooks/useWebsitePosts"
import { User } from "~/services/UserService"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { useRouteStore } from "~/store/useRouteStore"

import sanitizeHtml from "sanitize-html"
import { useUploadFile } from "~/hooks/useUploadFile"
import { useUIStore } from "~/store/useUIStore"
import { CAvatar } from "./CAvatar"
import EmojiGifWrapper from "./EmojiGifWrapper"
import { extractPageContent } from "~/helpers/pageContentHelper"

// Define the form schema
const formSchema = z.object({
  content: z
    .string()
    .trim()
    .max(360, "Message cannot exceed 360 characters")
    .optional()
    .default(""),
})

type FormValues = z.infer<typeof formSchema>

const CharacterCounter = ({ length }: { length: number }) => {
  const maxLength = 360
  const remainingChars = maxLength - length
  const progress = (length / maxLength) * 100
  const theme = useTheme()
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="flex-end"
    >
      <Box
        sx={{
          position: "relative",
          width: "14px",
          height: "14px",
          borderRadius: "50%",
          border: "1px solid",
          borderColor: darken(theme.palette.primary.main, 0.6),
          bgcolor: "transparent",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            height: `${progress}%`,
            bgcolor: "primary.main",
            transition: "height 0.2s ease-in-out",
          }}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{
          color: theme.palette.tetriary.contrastText,
          fontSize: "0.75rem",
        }}
      >
        {remainingChars}
      </Typography>
    </Stack>
  )
}

// Component to render content with blue mentions
const ContentWithMentions = ({ content }: { content: string }) => {
  // Regex to match @username patterns
  const mentionRegex = /@(\w+)/g

  // Split content by mentions
  const parts = content.split(mentionRegex)

  if (parts.length <= 1) {
    return <span>{content}</span>
  }

  const result: React.ReactElement[] = []
  let i = 0

  // Rebuild the content with styled mentions
  content.replace(mentionRegex, (match, username) => {
    // Add text before the mention
    if (parts[i]) {
      result.push(<span key={`text-${i}`}>{parts[i]}</span>)
    }

    // Add the mention with blue styling
    result.push(
      <span key={`mention-${username}-${i}`} style={{ color: JUICE.accent }}>
        @{username}
      </span>
    )

    i += 2
    return match
  })

  // Add any remaining text
  if (i < parts.length) {
    result.push(<span key={`text-${i}`}>{parts[i]}</span>)
  }

  return <>{result}</>
}

interface CreatePostProps {
  onPostCreated?: () => void
  placeholder?: string
  transactionMetadata?: {
    tokenSymbol?: string
    tokenMint?: string
    tokenAmount?: number
    solAmount?: number
    signature?: string
    tokenImageUrl?: string
    tradeType?: "buy" | "sell"
  }
  defaultContent?: string
}

export default function CreatePost({ onPostCreated, placeholder, transactionMetadata, defaultContent }: CreatePostProps = {}) {
  const { currentUrl } = useCurrentUrlStore()
  const { data: currentUser } = useCurrentUser()
  const { mutate: createPost, isPending: isPosting } = useCreateWebsitePost()
  const { showToast } = useToast()

  const createPostRef = useRef<HTMLTextAreaElement>(null)
  const [emojiAnchorEl, setEmojiAnchorEl] = useState<null | HTMLElement>(null)
  const isEmojiPickerOpen = Boolean(emojiAnchorEl)
  const [activeTab, setActiveTab] = useState<"emoji" | "gif">("emoji")
  const [isGifSearchOpen, setIsGifSearchOpen] = useState(false)
  const [selectedGif, setSelectedGif] = useState<GifTag | null>(null)

  const uploadFileMutation = useUploadFile()

  // Image selection/paste
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null)
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const {isSignInModalOpen, setIsSignInModalOpen} = useUIStore()

  // User mention related states
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [debouncedMentionQuery] = useDebounceValue(mentionQuery, 500)
  const [mentionAnchorEl, setMentionAnchorEl] =
    useState<HTMLTextAreaElement | null>(null)
  const [cursorPosition, setCursorPosition] = useState<number | null>(null)
  const [selectedUserIndex, setSelectedUserIndex] = useState<number>(-1)

  const { data: userSuggestions, isLoading: isLoadingUsers } = useGetUsers(
    debouncedMentionQuery ? debouncedMentionQuery.substring(1) : "",
    {
      enabled:
        Boolean(debouncedMentionQuery) && debouncedMentionQuery!.length > 1,
      refetchOnWindowFocus: false,
    }
  )

  const { params } = useRouteStore()

  const postId = useMemo(() => {
    if (params.postId) {
      return params.postId
    }
    return null
  }, [params.postId])

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onSubmit",
    defaultValues: {
      content: defaultContent || "",
    },
  })

  const content = watch("content", "")

  const {
    field: { onChange, value, ref },
  } = useController({
    name: "content",
    control,
  })

  const contentLength = content?.length || 0
  const hasMedia = selectedGif || selectedImageFile
  /** There is something to post. */
  const canPost = contentLength > 0 || Boolean(hasMedia)
  /** A post is in flight — the upload counts, it is the same wait. */
  const busy = isPosting || isUploadingImage
  // The counter arrives on the same condition the submit wakes up on, and
  // reads it from the same place so the two can never disagree.
  const showAudienceControls = canPost

  const getPlaceholder = useCallback(() => {
    // Use custom placeholder if provided
    if (placeholder) return placeholder

    const url = currentUrl
    if (!url) return "What's poppin'?!"

    // Extract domain from URL for a more friendly message
    try {
      const domain = removeUrlPrefixes(url).slice(0, 20)
      return `What's poppin' on ${domain}...`
    } catch {
      return "What's poppin'?!"
    }
  }, [currentUrl, placeholder])

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length <= 360) {
      onChange(e)

      // Get cursor position
      const cursorPos = e.target.selectionStart
      setCursorPosition(cursorPos)

      // Check if we're in a potential mention
      const textBeforeCursor = e.target.value.substring(0, cursorPos)
      const mentionMatch = textBeforeCursor.match(/@(\w*)$/)

      if (mentionMatch && mentionMatch[1].length >= 1) {
        // We have a potential mention with at least 1 character after @
        const newMentionQuery = "@" + mentionMatch[1]
        setMentionQuery(newMentionQuery)
        setMentionAnchorEl(e.target)
      } else {
        // Close the mention suggestions
        setMentionQuery(null)
        setMentionAnchorEl(null)
        setSelectedUserIndex(-1)
      }
    }
  }

  // Handle keyboard navigation for user suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Check if user suggestions are open
    const isSuggestionsOpen =
      userSuggestions && userSuggestions.length > 0 && mentionAnchorEl

    // Handle Enter key for form submission when suggestions are not open
    if (e.key === "Enter" && !e.shiftKey && !isSuggestionsOpen) {
      e.preventDefault()
      // Prevent duplicate submission while post is being created
      if (isPosting) return
      handleSubmit(onSubmit)()
      return
    }

    // Only handle keyboard navigation when suggestions are open
    if (!isSuggestionsOpen) {
      return
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedUserIndex((prevIndex) =>
          prevIndex < userSuggestions.length - 1 ? prevIndex + 1 : 0
        )
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedUserIndex((prevIndex) =>
          prevIndex > 0 ? prevIndex - 1 : userSuggestions.length - 1
        )
        break
      case "Enter":
        // Only handle Enter for user selection if we have a selected user
        if (
          selectedUserIndex >= 0 &&
          selectedUserIndex < userSuggestions.length
        ) {
          e.preventDefault()
          handleSelectUser(userSuggestions[selectedUserIndex])
        }
        break
      case "Escape":
        e.preventDefault()
        setMentionQuery(null)
        setMentionAnchorEl(null)
        setSelectedUserIndex(-1)
        break
    }
  }

  const handleSelectUser = (user: User) => {
    if (cursorPosition !== null && mentionQuery !== null) {
      const beforeMention = content.substring(
        0,
        cursorPosition - mentionQuery.length
      )
      const afterMention = content.substring(cursorPosition)

      // Replace the mention query with the selected username
      const newContent = `${beforeMention}@${user.username} ${afterMention}`

      setValue("content", newContent, {
        shouldValidate: true,
        shouldDirty: true,
      })

      // Close the mention suggestions
      setMentionQuery(null)
      setMentionAnchorEl(null)
      setSelectedUserIndex(-1)

      // Focus back on the textarea
      createPostRef.current?.focus()
    }
  }

  const onSubmit = useCallback(async (data: FormValues) => {
    if (!currentUrl) return

    // Check if user is logged in
    if (!currentUser || (currentUser && !currentUser.username)) {
      setIsSignInModalOpen(true)
      return
    }

    // Check if there's content or media to post
    if ((!data.content || !data.content.trim()) && !selectedGif && !selectedImageFile) {
      return
    }

    try {
      let mediaUrl: string | undefined = selectedGif?.image

      // If an image is selected, upload it first
      if (selectedImageFile) {
        setIsUploadingImage(true)
        
        // Check file size (2MB = 2 * 1024 * 1024 bytes)
        const twoMB = 2 * 1024 * 1024
        const isLargeFile = selectedImageFile.size > twoMB
        
        let uploadOptions: any = {
          quality: 95 // Higher quality
        }
        
        // If file is larger than 2MB, resize to 50% of original dimensions
        if (isLargeFile) {
          // Create an image element to get original dimensions
          const img = new Image()
          const imageUrl = URL.createObjectURL(selectedImageFile)
          
          await new Promise((resolve) => {
            img.onload = () => {
              uploadOptions.width = Math.round(img.width * 0.5)
              uploadOptions.height = Math.round(img.height * 0.5)
              URL.revokeObjectURL(imageUrl)
              resolve(null)
            }
            img.src = imageUrl
          })
        }
        
        const response = await uploadFileMutation.mutateAsync({
          file: selectedImageFile,
          options: uploadOptions
        })
        mediaUrl = response.url
        setIsUploadingImage(false)
      }

      // Extract page content from actual page DOM
      const pageContent = await extractPageContent()

      // Determine website_url based on post type
      let websiteUrl = currentUrl
      if (transactionMetadata?.tokenMint) {
        // Token buy posts link to Orb Markets
        websiteUrl = `https://www.orbmarkets.io/token/${transactionMetadata.tokenMint}`
      }

      const finalContent = data.content || ''

      createPost(
        {
          content: sanitizeHtml(finalContent),
          website_url: websiteUrl,
          only_followers: false,
          on_chain: false,
          gifUrl: mediaUrl,
          page_content: pageContent,
          transaction_data: transactionMetadata,
        },
        {
          onSuccess: () => {
            // Track post creation
            
            reset({ content: "" })
            setValue("content", "")
            setSelectedGif(null)
            setSelectedImageFile(null)
            setSelectedImagePreview(null)

            // Show success toast for transaction posts
            if (transactionMetadata) {
              const action = transactionMetadata.tradeType === "sell" ? "sale" : "purchase"
              showToast(`Posted! Your ${transactionMetadata.tokenSymbol} ${action} is now live!`, "success")
            }

            // Tell the page's surfaces. The card fetches its conversation
            // once at mount, so a post made HERE was invisible over there
            // until a full page reload — the reader posts, switches eyes to
            // the card, and sees a count that says they didn't. The
            // background fans this out: the card re-reads its posts and the
            // in-page toast shows the new one.
            try {
              chrome.runtime.sendMessage({
                type: "PAGE_POST_CREATED",
                payload: {
                  text: sanitizeHtml(finalContent),
                  name:
                    currentUser?.username || currentUser?.display_name || "you",
                  uid: currentUser?.id,
                  profile_photo_url: currentUser?.profile_photo_url,
                },
              })
            } catch {}

            // Call the optional callback
            onPostCreated?.()
          },
          onError: (error: any) => {
            console.error("Error creating post", error)

            const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error occurred while creating the post'
            
            setError('content', {
              type: 'manual',
              message: errorMessage,
            })

            // Track post creation failure
                      },
        }
      )
    } catch (err) {
      console.error("Error uploading image", err)
      setIsUploadingImage(false)
      
      setError('content', {
        type: 'manual',
        message: 'Failed to upload image. Please try again.',
      })
    }
  }, [currentUrl, currentUser, createPost, selectedGif, selectedImageFile, uploadFileMutation, reset, setValue, setError, setIsSignInModalOpen, onPostCreated, transactionMetadata])

  const handleEmojiButtonClick = (event: React.MouseEvent<HTMLElement>) => {
    setEmojiAnchorEl(event.currentTarget)
  }

  const handleEmojiPickerClose = () => {
    setEmojiAnchorEl(null)
  }

  const handleEmojiSelect = (emoji: { emoji: string }) => {
    // Get the current content
    const currentContent = watch("content") || ""

    // Update the form value directly using setValue
    setValue("content", currentContent + emoji.emoji, {
      shouldValidate: true,
      shouldDirty: true,
    })

    

    handleEmojiPickerClose()
  }

  const handleGifSelect = (gif: GifTag) => {
    setSelectedGif(gif)
    setIsGifSearchOpen(false)
    setSelectedImageFile(null)
    setSelectedImagePreview(null)
  }

  const handleImageButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) return
    setSelectedImageFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setSelectedImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
    setSelectedGif(null)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile()
        if (file) {
          setSelectedImageFile(file)
          const reader = new FileReader()
          reader.onloadend = () => {
            setSelectedImagePreview(reader.result as string)
          }
          reader.readAsDataURL(file)
          setSelectedGif(null)
          e.preventDefault()
        }
        break
      }
    }
  }

  // Modify the handleStackClick function
  const handleStackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // If clicking on an element marked to ignore focus, do nothing
      if ((e.target as HTMLElement).closest("[data-ignore-click]")) return

      // If clicking inside the emoji/gif popover, do nothing
      if ((e.target as HTMLElement).closest("#emoji-picker-popover")) return

      // Otherwise focus on the textarea
      createPostRef.current?.focus()
    },
    []
  )

  // Check if user is on a chrome:// page (but allow transaction posts)
  const isChromeUrl = useMemo(() => {
    if (transactionMetadata) return false // Allow posting for transaction posts
    return currentUrl?.startsWith("chrome://") || currentUrl?.startsWith("chrome-extension://")
  }, [currentUrl, transactionMetadata])

  useEffect(() => {
    createPostRef.current?.[isChromeUrl ? 'blur' : 'focus']()
  }, [isChromeUrl])

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedUserIndex(-1)
  }, [userSuggestions])

  // Set the first user suggestion as active by default
  useEffect(() => {
    if (userSuggestions && userSuggestions.length > 0) {
      setSelectedUserIndex(0)
    }
  }, [userSuggestions])

  const theme = useTheme()

  if (postId) {
    return null
  }

  return (
    <Box
      sx={{
        position: 'relative'
      }}
    >
      {isChromeUrl && (
        <Box
          sx={{
            top: 0,
            left: 0,
            position: 'absolute',
            width: '100%',
            height: '100%',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '16px',
            cursor: 'not-allowed',
            // A frosted grey slab was the only light-grey object left in the
            // feed. Same treatment as every other disabled surface now: the
            // ground showing through, one hairline, quiet type.
            backdropFilter: 'blur(3px)',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(7,7,10,0.72)'
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              fontSize: '13px',
              color: JUICE.text2
            }}
          >
            You can&apos;t post on a new tab
          </Typography>
        </Box>
      )}

      <Box
        id="create-post-wrapper"
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        sx={(theme: Theme) => ({
          px: theme.spacing(1.25),
          py: theme.spacing(1),
          borderRadius: "14px",
          pointerEvents: isPosting ? "none" : "auto",
          marginBlockEnd: 0,
          border: `1px solid rgba(255,255,255,0.1)`,
          backgroundColor: JUICE.well,
          transition: "border-color .15s ease",
          "&:focus-within": {
            borderColor: alpha(theme.palette.primary.main, 0.5),
          },
        })}
      >
        <Stack direction="row" spacing={0} alignItems="flex-start">
          <CAvatar
            src={currentUser?.profile_photo_url || undefined}
            sx={(theme: Theme) => ({
              width: theme.spacing(3.5),
              height: theme.spacing(3.5),
            })}
          />
          <Box sx={{ position: "relative", width: "100%",

"& textarea::placeholder": {
  color: alpha(theme.palette.secondary.contrastText, 0.6),
}

           }}>
            <TextareaAutosize
              ref={(e: HTMLTextAreaElement | null) => {
                ref(e)
                createPostRef.current = e
              }}
              value={value}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              maxLength={360}
              placeholder={getPlaceholder()}
              minRows={1}
              maxRows={5}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                resize: "none",
                color: theme.palette.secondary.contrastText,
                fontSize: "12px",
                fontFamily: "inherit",
                padding: "0 0 0 8px",
                outline: "none",
                marginTop: "2px",
              }}
            />

            {/* Preview with blue mentions - only shown when there's content */}
            {content && (
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: "0 0 0 8px",
                  pointerEvents: "none", // Allow clicks to pass through to textarea
                  fontSize: "12px",
                  fontFamily: "inherit",
                  marginTop: "2px",
                  color: "transparent", // Make text invisible
                  "& span": {
                    whiteSpace: "pre-wrap",
                  },
                }}
              >
                <ContentWithMentions content={content} />
              </Box>
            )}
          </Box>
        </Stack>

        {/* User Mention Suggestions Popper */}
        <Popper
          open={
            Boolean(mentionAnchorEl) &&
            Boolean(mentionQuery) &&
            mentionQuery!.length > 1 &&
            Boolean(userSuggestions && userSuggestions.length > 0)
          }
          anchorEl={mentionAnchorEl}
          placement="bottom-start"
          style={{ zIndex: 1300 }}
        >
          <Paper
            sx={{
              width: 250,
              maxHeight: 200,
              overflow: "auto",
              bgcolor: "transparent",
              border: "1px solid #323232",
              borderRadius: "8px",
              mt: 1,
            }}
          >
            <List sx={{ py: 0, height: 150 }}>
              {userSuggestions && userSuggestions.length > 0 ? (
                userSuggestions.map((user, index) => (
                  <ListItemButton
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
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
              ) : (
                <ListItem>
                  <ListItemText
                    primary=""
                    sx={{ color: "white", fontSize: "12px" }}
                  />
                </ListItem>
              )}
            </List>
          </Paper>
        </Popper>

        {/* Error message */}
        {errors.content && (
          <Typography
            variant="caption"
            sx={{
              color: "error.main",
              ml: 5,
              mt: 0.5,
              fontSize: "10px",
            }}
          >
            {errors.content.message}
          </Typography>
        )}

        {/* Selected Image Preview */}
        {selectedImagePreview ? (
          <Box sx={{ mt: 2, position: "relative", width: "60px" }}>
            <Box
              component="img"
              src={selectedImagePreview}
              alt="selected"
              sx={{
                width: "60px",
                height: "auto",
                objectFit: "cover",
                borderRadius: 1,
                display: "block",
              }}
            />
            <IconButton
              size="small"
              aria-label="Remove image"
              onClick={() => {
                setSelectedImageFile(null)
                setSelectedImagePreview(null)
              }}
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
        ) : (
          selectedGif && (
            <Box sx={{ mt: 2, position: "relative", width: "60px" }}>
              <Box
                component="img"
                src={selectedGif.image}
                alt={selectedGif.name}
                sx={{
                  width: "60px",
                  height: "auto",
                  objectFit: "cover",
                  borderRadius: 1,
                  display: "block",
                }}
              />
              <IconButton
                size="small"
                aria-label="Remove GIF"
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
          )
        )}

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          mt={1}
          onClick={handleStackClick}
        >
          <Box flex={1} display="flex" alignItems="center" gap={1.5} padding={0} margin={0}>
            {showAudienceControls && (
              <Box>
                <CharacterCounter length={contentLength} />
              </Box>
            )}
          </Box>

          <Stack
            data-ignore-click
            direction="row"
            spacing={0.625} // 10px gap (1.25 * 8px = 10px)
            alignItems="center"
          >
            <EmojiGifWrapper
              handleEmojiButtonClick={handleEmojiButtonClick}
              handleEmojiPickerClose={handleEmojiPickerClose}
              handleEmojiSelect={handleEmojiSelect}
              handleGifSelect={handleGifSelect}
              emojiAnchorEl={emojiAnchorEl}
              isEmojiPickerOpen={isEmojiPickerOpen}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <IconButton
              size="small"
              aria-label="Add a photo"
              onClick={handleImageButtonClick}
              data-ignore-click
            >
              <PhotoCameraOutlinedIcon sx={{ fontSize: 16, color: theme.palette.secondary.contrastText }} />
            </IconButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              style={{ display: "none" }}
            />
            {/**
              * THE SUBMIT NEVER LEAVES THE ROW, AND NEVER CHANGES SIZE.
              *
              * Two shifts lived in this one control, and both moved things
              * the reader was not touching. It was MOUNTED on the first
              * keystroke, so the pill's whole width appeared inside a
              * right-aligned group and dragged the emoji and camera doors
              * left with it;
              * and while posting it swapped its whole label for a 12px
              * spinner, which collapsed the same group again mid-press. A
              * control may repaint on a press; it may not re-measure.
              *
              * So the pill is always in the row — inert until there is
              * something to post — and the label keeps its place in the flow
              * while the spinner rides on top of it, which is what makes the
              * box big enough for both states without anyone guessing a
              * width. FollowButton.tsx:107-116 documents the same defect and
              * the same cure on the other button that does this.
              */}
            <Box
              component="button"
              type="submit"
              disabled={busy || !canPost}
              sx={{
                padding: '4px 10px',
                // A floor under the pill, so it can never be narrower than
                // the spinner state whatever the label measures.
                minWidth: "56px",
                position: "relative",
                fontSize: "12px",
                fontWeight: "600",
                color: theme.palette.primary.contrastText,
                bgcolor: theme.palette.primary.main,
                borderRadius: "12px",
                border: "0.5px solid",
                borderColor: darken(theme.palette.primary.main, 0.05),
                cursor: !canPost || busy ? "not-allowed" : "pointer",
                // Busy keeps the 0.7 it always had. Nothing-to-post sits
                // further back still: the pill must not offer a press it
                // would refuse.
                opacity: !canPost ? 0.45 : busy ? 0.7 : 1,
                // Paint-only, and only when there is a press to aim at: a
                // disabled pill that darkens under the pointer promises one.
                "&:not(:disabled):hover": {
                  bgcolor: darken(theme.palette.primary.main, 0.1),
                },
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Box
                component="span"
                sx={{ visibility: busy ? "hidden" : "visible" }}
              >
                {"Pop it"}
              </Box>
              {busy && (
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {/* The LABEL's ink, not black. The word one element above
                      paints primary.contrastText, which themeHelper resolves
                      to JUICE.onAccent for the default blue — so a hard #000
                      here drew the busy state and the resting state in two
                      different inks on one fill, and left the last colour
                      literal inside a block whose own pass retired the
                      others. */}
                  <CircularProgress size={12} sx={{ color: JUICE.onAccent }} />
                </Box>
              )}
            </Box>
          </Stack>
        </Stack>
      </Box>
    </Box>
  )
}
