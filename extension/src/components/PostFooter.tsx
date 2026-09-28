import { CAP } from "~/config/edition"
import { sendApiRequest } from "~/lib/fetchService"
import { alpha, Box, Stack, SxProps, Theme, Typography } from "@mui/material"
import React, { useState } from "react"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useUIStore } from "~/store/useUIStore"
import { WebsitePost } from "~/types/websitePost"
import { compactAge } from "~/utils/dateUtils"
import { formatCompactNumber } from "~/utils/numberUtils"
import { ChipGlyphIcon } from "./ChipGlyphIcon"
import { CHIP_ACT, chipActBareSx, chipActSx, chipNumSx } from "./chipActStyle"
import { GLYPH_REPLY, GLYPH_SHARE, GLYPH_TIP } from "./chipGlyphs"
import UpvoteButton from "./UpvoteButton"

interface PostFooterProps {
  sx?: SxProps<Theme>
  post: WebsitePost
  isUpvoted: boolean
  showComments: boolean
  onUpvoteClick: () => void
  onCommentClick: () => void
  onTip?: (data: { user: { id: string; username: string; display_name?: string; wallet_address?: string | null }; postId: string }) => void
  fromReply?: boolean
  contentType: "post" | "reply" | "comment"
}

const PostFooter = React.memo(
  ({
    sx,
    post,
    isUpvoted,
    showComments,
    onUpvoteClick,
    onCommentClick,
    onTip,
    fromReply,
    contentType,
  }: PostFooterProps) => {
    const { data: currentUser } = useCurrentUser()
    const { setIsSignInModalOpen } = useUIStore()
    
    const {
      id,
      content,
      gifUrl,
      user,
      created_at,
      upvotes,
      downvotes,
      comment_count,
      reply_count,
      view_count,
      website_url,
    } = post


    const handleUpvoteClick = () => {
      // Check if user is logged in
      if (!currentUser || (currentUser && !currentUser.username)) {
        setIsSignInModalOpen(true)
        return
      }
      
      // If user is logged in, proceed with original onUpvoteClick
      onUpvoteClick()
    }

    const handleSharePlatform = async (platform: string) => {
      if (platform === 'twitter') {
        /**
         * THE LINK HAS TO RESOLVE. This used to tweet
         * https://share.poppin.so/<code> — a host with no route, no
         * redirect and no deploy in either repo — and for any post never
         * shared through the in-page card it tweeted a raw UUID, because the
         * short-link route only LOOKS UP a code that flywheel.share is the
         * only thing that mints. Every share from the feed was a dead link
         * and none of them counted as a share.
         *
         * POST /flywheel/share mints the code, records the share event, and
         * returns the real address the redirect route serves. If that fails
         * there is no link worth tweeting, so nothing is tweeted rather than
         * a 404 with the brand's name on it.
         */
        let url: string | null = null
        try {
          const minted = await sendApiRequest<{ url?: string }>({
            url: "/flywheel/share",
            method: "POST",
            data: { post_id: id },
            apiType: "backend",
          })
          if (typeof minted?.url === "string" && minted.url.startsWith("https://")) url = minted.url
        } catch {
          // Signed out, offline, or a post the server will not mint for.
        }
        if (!url) return
        const text = encodeURIComponent(url)
        const shareUrl = `https://twitter.com/intent/tweet?text=${text}`
        
        // Open in a new tab instead of popup
        if (chrome.tabs) {
          chrome.tabs.create({ url: shareUrl })
        } else {
          // Fallback for when chrome.tabs is not available
          window.open(shareUrl, '_blank')
        }
      }
    }

    return (
      <>
        {/*
          TWO GROUPS, NOT FOUR BUTTONS. Left: the counters — like and reply,
          each a framed chip because a frame is what says "a number lives
          here". Right, pushed over by `ml:"auto"` and sitting with the age:
          the doors out — tip and share, frameless (chipActBareSx).

          `flexWrap` is the valve, and it is the house rule for any pill row
          in this product (components/profile/ProfileFeed.tsx:70-87: "THE ROW
          FITS; IT DOES NOT SLIDE" — a hidden scrollbar puts a control
          off-screen with nothing to hint it exists; a second line is
          honest). It should never fire here, and post-action-row.spec.ts is
          what keeps that true: it adds the row up from the metrics this file
          declares and the advances of the font it really draws, against the
          panel's 320px floor. The numbers are not repeated in this comment —
          they moved twice in one pass (a 13px glyph in, the separator dot
          out) and a comment carrying a stale total is worse than a comment
          carrying none. Read the spec for the arithmetic.
        */}
        <Stack
          direction="row"
          alignItems="center"
          sx={{ mt: 1, flexWrap: "wrap" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Stack direction="row" alignItems="center" spacing={1}
          sx={sx}
          >
            <UpvoteButton
              data={{
                id,
                content,
                gifUrl,
                user,
                created_at,
                upvotes,
                downvotes,
                comment_count,
                reply_count,
                view_count,
                isUpvoted,
                website_url,
                updated_at: created_at,
                user_id: user.id,
                deleted_at: null,
                last_commented_at: null,
                only_followers: false,
                on_chain: false,
              }}
              isUpvoted={isUpvoted}
              onUpvoteClick={handleUpvoteClick}
            />

            <Box
              component="button"
              onClick={(e) => {
                e.stopPropagation()
                onCommentClick()
              }}
              className="click-animation"
              sx={chipActSx(showComments)}
            >
              {/* The chip had NO glyph at all — just a count that vanished at
                  zero, so it rendered as an empty pill next to a pill with a
                  shape in it. Same bubble the card draws, from the same
                  descriptor. */}
              <ChipGlyphIcon glyph={GLYPH_REPLY} size={CHIP_ACT.icon} />
              {/* The COUNT, not the verb. A speech bubble already says
                  "reply"; the word repeats it, and it made the same control
                  look different in the card (icon + count) and here (icon +
                  word).

                  THE WHOLE ELEMENT GOES AT ZERO, not just its text. This
                  line used to render the <Typography> unconditionally with
                  `: ""` in it and claim, right here, that the count was
                  "hidden at zero" — while an emptied Typography is still a
                  <p>, still a flex item, and still earns chipActSx's
                  `gap: "5px"`. So the chip drew its left padding, the glyph,
                  then a gap and a zero-wide element before its right padding:
                  more air on the right of the bubble than on its left, which
                  is the off-centre glyph and the "space as though it said 0"
                  the owner reported. Guarded the way UpvoteButton guards the
                  like count beside it. */}
              {(comment_count || reply_count) > 0 && (
                <Typography variant="body2" sx={chipNumSx(showComments)}>
                  {/* COMPACTED, like the count in the chip beside it — a
                      deliberate change, not a side effect. This printed the
                      integer raw while the like chip has compacted its own
                      since before this pass (UpvoteButton.tsx:54), so one
                      row formatted the same kind of number two ways, and a
                      raw integer has no width bound at all — which left the
                      fit test reserving space for a guess. What the change
                      buys is a bound the FORMATTER decides:
                      post-action-row.spec.ts enumerates what Intl compact
                      notation can emit and reserves the widest string it
                      found, in place of an assumption about how many
                      comments one page can collect. */}
                  {formatCompactNumber(comment_count || reply_count)}
                </Typography>
              )}
            </Box>
          </Stack>

          <Stack
            direction="row"
            alignItems="center"
            /*
              THE GAP BETWEEN THE DOORS AND THE AGE, AND NOTHING ELSE IN IT.

              A 3px separator dot used to sit here between the two. The owner
              called it out by name — "alttaki saatin solunda bir nokta var
              anlamsiz ve aralarindaki bosluklar anlamsiz" — and they are
              right twice over. A dot is a SEPARATOR, and a separator earns
              its place by parting two things of the same kind; this one had
              a pair of icon buttons on one side and a timestamp on the
              other, which are already told apart by being an icon and a
              number. It also cost three widths in the row (the dot plus a
              gap either side of it) to say nothing.

              3px, not the 4px it replaced, because the gap it has to LOOK
              equal to is not this one. The share door's body is 24px wide
              with a 13px glyph centred in it, so 5.5px of transparent button
              already sits between the drawn glyph and this gap. 3 + 5.5
              lands the age about 8.5px from the last mark — the same air the
              two chips on the left have between them.
            */
            sx={{ ml: "auto", gap: "3px" }}
          >
            {/*
              THE TWO DOORS, ON THE RIGHT WHERE THEY BELONG.

              Both used to sit in the left group wearing the counters' pill,
              which is what the owner reported: four identical frames implied
              four controls of the same kind. Like and reply are counters —
              press, and a number moves. Tip and share LEAVE the row, hold no
              tally, and a pill around them promises a count that never
              arrives. So they crossed the gap to the metadata side, took the
              frame off (chipActBareSx), and kept everything that made them
              work: the same handlers, the same aria-labels, the same
              self-tip gate, the same press animation.

              THEIR BODIES TOUCH — gap 0, which is a change and a deliberate
              one. Each door is a 24x24 transparent hit body (WCAG 2.2 SC
              2.5.8) around a 13px glyph, so 5.5px of nothing already stands
              on each side of every mark. The 8px that used to sit BETWEEN
              the bodies was therefore drawing 19px of white space between
              two glyphs, in a row whose left-hand chips sit 8px apart —
              the "meaningless gaps" half of the same report. At gap 0 the
              two marks are 11px apart, the hit areas are contiguous so a
              press between them still lands on a control, and the row reads
              as one rhythm instead of two.
            */}
            <Stack direction="row" alignItems="center" sx={{ gap: 0 }}>
              {/* Other people's posts only: tipping yourself is not a
                  gesture, and hiding the door beats disabling it. The whole
                  flow behind it is real — onTip climbs to the page,
                  TipDialog moves actual money. */}
              {onTip && currentUser && user.id !== currentUser.id && (
                <Box
                  component="button"
                  aria-label={`Tip @${user.username}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTip({
                      user: {
                        id: user.id,
                        username: user.username,
                        display_name: user.display_name,
                        wallet_address: user.wallet_address ?? null,
                      },
                      postId: id,
                    })
                  }}
                  className="click-animation"
                  sx={chipActBareSx}
                >
                  <ChipGlyphIcon glyph={GLYPH_TIP} size={CHIP_ACT.icon} />
                </Box>
              )}
              {/* handleSharePlatform sat in this file complete and
                  unreachable for a long time — the short-link fetch, the
                  share.poppin.so address, the composer — so the panel's feed
                  was the one surface with no way to send a post onward. */}
              {/* The share link is minted by the store backend's flywheel. */}
              {CAP.autoPost && (
              <Box
                component="button"
                aria-label="Share this post"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleSharePlatform("twitter")
                }}
                className="click-animation"
                sx={chipActBareSx}
              >
                <ChipGlyphIcon glyph={GLYPH_SHARE} size={CHIP_ACT.icon} />
              </Box>
              )}
            </Stack>

            <Typography
              variant="body2"
              sx={{
                color: alpha("#FFFFFF", 0.55),
                fontSize: "10px",
                /* The age is the only text in this group and it sits beside
                   24px buttons; without a line box of its own it rides the
                   flex line's baseline and lands a pixel low against the
                   glyphs. `lineHeight: 1` plus the row's centre alignment is
                   what puts every mark in this group on one axis, which is
                   the "ayni hizada durmalari" half of the report. */
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {compactAge(created_at)}
            </Typography>
          </Stack>
        </Stack>

        {/* MUI Popover */}
        {/* Popover removed: Only Twitter share is available, no popover. */}
      </>
    )
  }
)

export default PostFooter
