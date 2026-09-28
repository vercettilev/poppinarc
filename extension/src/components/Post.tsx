import { JUICE } from "~/theme/juice"
import ContentCopyIcon from "@mui/icons-material/ContentCopy"
import { alpha, Box, lighten, Stack, Typography } from "@mui/material"
import { AnimatePresence } from "framer-motion"
import React, { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { useToast } from "~/components/Toast/ToastProvider"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useDeleteWebsitePost } from "~/hooks/useWebsitePosts"
import { useWebsitePostVote } from "~/hooks/useWebsitePostVote"
import { useActionMenuDialogStore } from "~/store/useActionMenuDialogStore"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"
import { WebsitePost } from "~/types/websitePost"
import { Organization } from "~/services/UserService"
import CommentSection from "./Post/Comments/CommentSection"
import PostHeader from "./Post/PostHeader"
import PostFooter from "./PostFooter"
import { receiptText } from "~/helpers/receiptText"
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
    score,
    isUpvoted: initialIsUpvoted = false,
    isFromDetailView = false,
    reply,
    announcement_id,
    userStreak = 0,
    userOrganizations,
    isOwnProfile,
    onTip,
    transaction: transactionProp,
    post_transaction,
  }: WebsitePost & {
    isFromDetailView?: boolean
    reply?: any
    announcement_id?: string
    userStreak?: number
    userOrganizations?: Organization[],
    isOwnProfile: boolean
    onTip?: (data: { user: { id: string; username: string; display_name?: string; wallet_address?: string | null }; postId: string }) => void
  }) => {
    /**
     * THE RECEIPT NO LONGER DEPENDS ON THE CALLER REMEMBERING.
     *
     * `post_transaction` is what the API sends; `transaction` is the name
     * three callers hand it to this component under, by writing the mapping
     * out themselves. A fourth caller - the reply's parent post on a
     * profile - spread the row and never wrote that line, so a trade
     * receipt there lost its coin, its buy door and its re-said sentence
     * and fell back to the raw stored words. Both ends type-checked, which
     * is exactly why nothing caught it.
     *
     * So the fallback lives HERE, once, where the component can see both
     * names. A caller that maps by hand still wins; a caller that forgets
     * is no longer punished for it.
     */
    const transaction = transactionProp ?? post_transaction ?? undefined

    /**
     * The face this receipt wears: the one saved with the trade when there
     * is one, else the mint's own art from our icon road (see the img).
     */
    const coinFace =
      transaction?.token_image_url ||
      (transaction?.token_mint
        ? `${process.env.NEXT_PUBLIC_API_URL}/embed/asset/icon?mint=${transaction.token_mint}`
        : null)

    /**
     * ONE TAG, TWO COLOURS — and that is the whole permitted difference.
     *
     * Reported: "bought ve sold tagleri aynı değil". They were not the same
     * object. The direction was re-derived at eight separate sites as
     * `transaction.trade_type === "sell"`, each free to answer with whatever
     * it liked, and the trailing slot had already drifted: the buy tag ended
     * "· Buy →" while the sell tag ended with a bare "→". Same control, two
     * widths, decided by which way a stranger had traded.
     *
     * The direction is read ONCE now, so the two states cannot be edited
     * apart again. Everything the tag is built from — its box, its element
     * count, its gap, its metrics, its door — is written a single time; only
     * the semantic colour and the verb branch on this flag, which is
     * juice.ts rule 4 and nothing more.
     */
    const isSell = transaction?.trade_type === "sell"

    /**
     * The coin art that has already 404'd, so a missing face lands on the
     * emoji instead of on nothing. Keyed by URL rather than by a boolean:
     * a recycled row must not inherit the previous token's failure.
     */
    const [brokenFace, setBrokenFace] = useState<string | null>(null)
    const [isUpvoted, setIsUpvoted] = useState(initialIsUpvoted)
    const [upvoteCount, setUpvoteCount] = useState(upvotes)
    const { mutate: votePost } = useWebsitePostVote()
    const { data: currentUser } = useCurrentUser()
    const { mutate: deletePost } = useDeleteWebsitePost()
    const { showToast } = useToast()
    const navigate = useNavigate()

    const handleOpenImagePreview = () => {
      
      // Send message to background script to open image preview
      chrome.runtime.sendMessage({
        type: "OPEN_IMAGE_PREVIEW",
        payload: { imageUrl: gifUrl }
      })
    }

    useEffect(() => {
      if (initialIsUpvoted !== undefined) setIsUpvoted(initialIsUpvoted)
    }, [initialIsUpvoted])

    useEffect(() => {
      setUpvoteCount(upvotes)
    }, [upvotes])

    const handleUpvote = useCallback(() => {
      if (!currentUser) return

      const newIsUpvoted = !isUpvoted
      const newUpvoteCount = isUpvoted ? upvoteCount - 1 : upvoteCount + 1

      // Track upvote action
      
      // Optimistically update UI
      setIsUpvoted(newIsUpvoted)
      setUpvoteCount(newUpvoteCount)

      // Use the same voting endpoint but include type for announcements
      votePost(
        {
          id: announcement_id || id, // Use announcement_id if available, otherwise use regular id
          vote: newIsUpvoted ? "upvote" : "unupvote",
          isAlreadyVoted: isUpvoted,
          authorId: user?.id,
          parentId: id,
          type: announcement_id ? "announcement" : undefined, // Add type field for announcements
        },
        {
          onError: () => {
            // Revert on error
            setIsUpvoted(isUpvoted)
            setUpvoteCount(upvoteCount)
          },
        }
      )
    }, [currentUser, id, isUpvoted, upvoteCount, user, votePost, announcement_id, gifUrl])

    const handleDelete = useCallback((reason?: string) => {
      
      deletePost({ id, reason }, {
        onSuccess: () => {
          showToast("Post deleted successfully", "success", {
            vertical: "bottom",
            horizontal: "center",
          })
        },
        onError: (error) => {
          showToast("Failed to delete post. Please try again.", "error", {
            vertical: "bottom",
            horizontal: "center",
          })
        },
      })
    }, [deletePost, id, showToast, gifUrl, content, upvoteCount])

    const [showComments, setShowComments] = useState(false)

    const location = useLocation()


    useEffect(() => {
      if (isFromDetailView) {
        setShowComments(true)
      }
    }, [location])

    const handleCommentClick = useCallback(() => {
      setShowComments((prev) => !prev)
    }, [])

    const handleMentionClick = useCallback(async (username: string) => {
        
        navigate(`.`, {
          state: {
            username,
            from: "post",
            to: "ProfileDetailView"
          }
        })


    }, [navigate, id])

    return (
      <>
        <Box
          sx={{
            p: "14px",
            mb: "10px",
            // The site's tile: 16px corners, a surface that sits ON the lit
            // ground rather than a hairline drawn on a void, and an accent
            // edge on hover — the same "objects in a dark room" reading the
            // shell's auroras exist for.
            borderRadius: "16px",
            border: `1px solid ${alpha("#FFFFFF", 0.07)}`,
            backgroundColor: JUICE.ground,
            transition:
              "background-color .16s ease-out, border-color .16s ease-out",
            cursor: "pointer",
            "&:hover": {
              backgroundColor: "#13131B",
              borderColor: "rgba(104,198,255,0.28)",
            },
          }}
          onClick={() => {
              
              navigate(".", {
                state: {
                  postId: id,
                  from: "post",
                  to: "PostDetailView"
                }
              })
          }}
        >
          <Stack spacing={1.5}>
            <PostHeader
              user={user}
              currentUserId={currentUser?.id}
              onDelete={handleDelete}
              website_url={website_url}
              postId={id}
              contentType="post"
              announcement_id={announcement_id}
              userStreak={userStreak}
              userOrganizations={userOrganizations}
              isOwnProfile={isOwnProfile}
            />
            {transaction?.token_mint && (
              <Box
                component="button"
                // The accessible name is the visible one. It used to say
                // "Buy $WIF" on BOTH tags, so a screen reader was promised a
                // buy sheet by a control that opens the asset and nothing
                // else — see the side the click handler passes below.
                aria-label={
                  isSell
                    ? `View ${transaction.token_symbol}`
                    : `Buy ${transaction.token_symbol}`
                }
                onClick={(e) => {
                  e.stopPropagation()
                  /**
                   * COPY THE TRADE. This receipt used to navigate to
                   * "/terminal", a route that does not exist in this panel's
                   * table — the one door in the product that led somewhere
                   * only its author could see. It now hands the mint to the
                   * asset strip WITH the side, so the sheet is already open
                   * on Buy when the reader arrives: they decided when they
                   * tapped a receipt, not when they got there.
                   *
                   * Same direction as every other route: into this panel.
                   * The panel is the app and never sends anyone to the card.
                   *
                   * A BUY receipt opens the Buy sheet; a SELL receipt opens
                   * the asset and nothing else. Copying a sale means selling
                   * a thing the reader probably does not hold, and a sheet
                   * that opens straight onto "you hold none" is a dead end
                   * dressed as an invitation.
                   */
                  // The token's own room now exists — richer than the
                  // front-door strip: the chart with your fills, the
                  // gate's numbers, the sheet. The launch store still
                  // carries the side so nothing downstream changes shape.
                  useLaunchAssetStore
                    .getState()
                    .setLaunchMint(
                      transaction.token_mint,
                      isSell ? undefined : "buy",
                    )
                  navigate(`/token/${transaction.token_mint}`)
                }}
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  // The card's tag grammar, not the accent: green means
                  // bought, red means sold, tinted fill with the color as
                  // TEXT. Accent blue on every receipt made a sell and a buy
                  // the same color an inch from a card that separates them.
                  backgroundColor: isSell
                    ? "rgba(255,69,58,0.14)"
                    : "rgba(48,209,88,0.14)",
                  border: "none",
                  borderRadius: "999px",
                  padding: "6px 12px",
                  width: "fit-content",
                  mt: "8px !important",
                  cursor: "pointer",
                  font: "inherit",
                  /**
                   * IT IS A KEY, SO IT LOOKS LIKE ONE. This receipt is the
                   * flywheel's whole invitation — somebody's trade, one tap
                   * from being yours — and it was a flat tinted rectangle.
                   * Same physicality the chip's own controls carry: a lit
                   * top edge, a hairline in the direction's colour, a seat
                   * of glow, and a press that answers the finger.
                   *
                   * ALL FOUR OF THOSE ARE PAINTED, NEVER LAID OUT, and that
                   * is a decision rather than an accident. The hairline is
                   * an INSET box-shadow (`inset 0 0 0 1px`) and `border`
                   * stays `none` on purpose: a border that appears or
                   * thickens on :hover adds a pixel to the box and shoves
                   * the words inside it, which is the textbook version of
                   * the bug reported against this pill — "the Bought/Sold
                   * tag shifts its text on hover". An inset shadow occupies
                   * no space in any state, so this chip can light up
                   * without a single glyph moving.
                   */
                  boxShadow: isSell
                    ? "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 0 0 1px rgba(255,69,58,0.28), 0 4px 16px -6px rgba(255,69,58,0.4)"
                    : "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 0 0 1px rgba(48,209,88,0.28), 0 4px 16px -6px rgba(48,209,88,0.4)",
                  // The REST transform is not dead weight now that hover no
                  // longer moves. A non-`none` transform gives the pill its
                  // own stacking context and containing block, so its paint
                  // order against the card's hover ground (see the card's sx
                  // above) is identical at rest, on hover and mid-press —
                  // and the :active below needs a defined from-value to
                  // animate off. Delete it and the chip would acquire a
                  // stacking context only while pressed: a repaint bought
                  // for nothing.
                  transform: "translateY(0) scale(1)",
                  // The 220ms release curve is still declared here, but it
                  // now serves the PRESS alone — see :active below.
                  transition:
                    "transform 220ms cubic-bezier(.2,1.35,.4,1), background-color .15s ease, box-shadow .15s ease",
                  /**
                   * HOVER PAINTS. IT DOES NOT MOVE.
                   *
                   * This block used to lift the pill — `translateY(-1px)
                   * scale(1.015)` — on the release curve above, and the
                   * scale was the whole defect. It pushes every glyph
                   * outward from the pill's centre (roughly ±0.9px at the
                   * ends of a "Bought $WIF · Buy →" row) and re-rasterises
                   * text that Chrome had drawn at 1.0; and the curve is an
                   * overshoot (y1 = 1.35), so the chip sailed past its
                   * hover target and settled back. Read — and reported — as
                   * the words sliding, then landing twice.
                   *
                   * The two signals that survive say "aimed at" without
                   * touching the box: a stronger tint under it (.14 → .22)
                   * and a brighter hairline over a deeper seat of glow
                   * (.28 → .42). Both are paint. Nothing here changes a
                   * border width, a padding, a font weight or a transform,
                   * so the glyphs stay on the pixels they were drawn on.
                   *
                   * This deliberately breaks juice.ts's "hover LIFTS, press
                   * SCALES" grammar for this one control. That rule was
                   * written for pills whose contents are a glyph; this one
                   * carries a sentence, and a sentence is the thing you can
                   * watch move.
                   */
                  "&:hover": {
                    backgroundColor: isSell
                      ? "rgba(255,69,58,0.22)"
                      : "rgba(48,209,88,0.22)",
                    boxShadow: isSell
                      ? "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,69,58,0.42), 0 8px 22px -6px rgba(255,69,58,0.55)"
                      : "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(48,209,88,0.42), 0 8px 22px -6px rgba(48,209,88,0.55)",
                  },
                  // THE PRESS IS THE ONLY MOVEMENT THIS CONTROL HAS LEFT.
                  // It still arrives faster than it leaves — 90ms in, the
                  // 220ms release curve out — which is the chip's own press
                  // rule and also the reason a press may move where a hover
                  // may not: the finger asked the surface a question and is
                  // still on the glass when the answer arrives, so the text
                  // moving under it is the point. A pointer merely passing
                  // over asked nothing, and owes no answer that costs a
                  // reflow.
                  "&:active": {
                    transform: "scale(0.955)",
                    transitionDuration: "90ms",
                  },
                  "@media (prefers-reduced-motion: reduce)": {
                    transition: "none",
                    // Only :active moves now, so only :active needs undoing.
                    // The old `"&:hover, &:active"` would be a rule that can
                    // never fire, still explaining a hover lift the code
                    // above no longer has — the exact dead-rule-with-a-stale
                    // -story shape theme/no-dead-rules.spec.ts exists to
                    // stop. That spec only scans the two shadow-DOM
                    // stylesheets, so this one was ours to keep honest.
                    "&:active": { transform: "none" },
                  },
                }}
              >
                {/**
                 * THE COIN'S FACE, FOR EVERY RECEIPT AND NOT JUST NEW ONES.
                 *
                 * token_image_url is written at trade time, so every receipt
                 * created before that field existed shows a generic coin
                 * emoji beside a sentence about a token nobody can picture.
                 * The mint is on the row regardless, and the same
                 * ours-origin icon road the chip's face takes answers for
                 * any mint, so the fallback costs no new third-party
                 * request and heals the whole back catalogue at once.
                 *
                 * THE SLOT IS THE FIXED THING, not what sits in it. The
                 * emoji fallback was written as a bare 12px <span> beside a
                 * 20px <img>, and the onError hid the <img> outright — so a
                 * face that 404'd took its 20px AND the row's 7px gap out of
                 * the tag, and the same control was a different width on the
                 * next post down. A 20×20 box holds either one; only the
                 * contents change, so nothing around it moves.
                 */}
                <Box
                  component="span"
                  sx={{
                    flex: "none",
                    // Big enough to BE the coin: at 14px a token's mark is a
                    // smudge, and this tag's whole job is to make somebody
                    // want the thing in it.
                    width: "20px",
                    height: "20px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // Sizes the EMOJI, not the art — the <img> below fills
                    // the box outright. Set on the slot so the fallback is
                    // centred in the same 20px the art occupies.
                    fontSize: "14px",
                    lineHeight: 1,
                  }}
                >
                  {coinFace && brokenFace !== coinFace ? (
                    <img
                      src={coinFace}
                      // Decorative: the button's aria-label already names the
                      // token, and an alt STRING is the second way this slot
                      // used to change width — a broken image paints its alt
                      // text in the 20px box until onError lands.
                      alt=""
                      onError={() => setBrokenFace(coinFace)}
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: "50%",
                        objectFit: "cover",
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.10)",
                      }}
                    />
                  ) : (
                    "🪙"
                  )}
                </Box>
                <Typography
                  sx={{
                    fontSize: "11px",
                    fontWeight: 700,
                    // The one thing juice.ts rule 4 lets this tag branch on.
                    color: isSell ? JUICE.red : JUICE.green,
                    lineHeight: 1,
                  }}
                >
                  {isSell
                    ? `Sold ${transaction.token_symbol}`
                    : `Bought ${transaction.token_symbol}`}
                </Typography>
                {/**
                 * THE DOOR SLOT, AND WHY BOTH DIRECTIONS FILL IT.
                 *
                 * The receipt says what happened; this says it is a door.
                 * Without it the pill reads as a label and nobody presses a
                 * label — which is exactly what the sell tag had become: it
                 * printed a bare "→" against the buy tag's "· Buy →", so the
                 * two tags were different objects at different widths and the
                 * sell one lost the word that made it pressable.
                 *
                 * Same three parts in both directions now — separator, verb,
                 * arrow — and the verb stays TRUE to what the tap does (see
                 * the click handler): a buy receipt opens the Buy sheet, a
                 * sell receipt opens the asset with no side, because copying
                 * a sale means selling a thing the reader probably does not
                 * hold. So "Buy" on one and "View" on the other. Never
                 * "Sell": no sell sheet is behind this.
                 *
                 * nowrap on the door ALONE. It must never break between the
                 * verb and its arrow; the label above it stays breakable, so
                 * a long ticker still wraps inside the panel instead of
                 * pushing the tag off the edge.
                 */}
                <Typography
                  sx={{
                    fontSize: "11px",
                    fontWeight: 700,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    color: alpha("#FFFFFF", 0.55),
                  }}
                >
                  {isSell ? "· View →" : "· Buy →"}
                </Typography>
              </Box>
            )}
            <Typography
              color="white"
              variant="body1"
              sx={{
                fontSize: "12px",
                lineHeight: "20px",
                fontWeight: "regular",
                mt: 0.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {formatContent(
                decodeHtmlEntities(receiptText(
                    content,
                    !!transaction?.token_mint,
                    transaction?.mcap_usd,
                  )),
                handleMentionClick,
              )}
            </Typography>
            {typeof score === "number" && score < 1 && (
              // Below the quality bar — and reachable only because it is
              // YOURS, since the API hides everyone else's. Say so, quietly:
              // a post that vanished without a word is the failure this line
              // exists to end.
              <Typography
                sx={{ fontSize: "11px", color: "rgba(255,255,255,0.42)", mt: 0.5 }}
              >
                Only you can see this. It looked like spam to us.
              </Typography>
            )}
            {gifUrl && (
              <div className="flex w-max items-center ">
                <img
                  src={gifUrl}
                  alt={gifUrl.includes("lazy-slug") ? "User uploaded image" : "gif"}
                  style={{
                    width: "-webkit-fill-available",
                  }}
                  className="max-h-[112px]
                  rounded-lg object-contain cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenImagePreview()
                  }}
                />
              </div>
            )}
            <PostFooter
              post={{
                id,
                content,
                gifUrl,
                user,
                created_at,
                upvotes: upvoteCount,
                downvotes,
                comment_count,
                view_count,
                website_url,
                isUpvoted,
                updated_at: created_at,
                user_id: user?.id,
                deleted_at: null,
                last_commented_at: null,
                only_followers: false,
                reply_count: 0,
                on_chain: false,
              }}
              contentType="post"
              isUpvoted={isUpvoted}
              showComments={showComments}
              onUpvoteClick={handleUpvote}
              onCommentClick={handleCommentClick}
              onTip={onTip}
            />
          </Stack>

          <AnimatePresence>
            {showComments && (
              <CommentSection
                postId={id}
                announcement_id={announcement_id}
                replyToUsername={user?.username}
              />
            )}
          </AnimatePresence>
        </Box>
      </>
    )
  }
)
