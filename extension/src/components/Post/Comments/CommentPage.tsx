import { memo, useCallback, useMemo } from "react"
import Reply from "~/components/Reply"
import TipComment from "~/components/TipComment"
import { useUpvotedStatus } from "~/hooks/useUpvotedStatus"
import { useUserStreaksByIds } from "~/hooks/useStreaks"
import { useBulkUserOrganizations } from "~/hooks/useBulkUserOrganizations"
import { PaginatedComments } from "./CommentSection"

// Create a memoized comment item component to prevent re-renders
const MemoizedReply = memo(
  ({
    comment,
    isReply,
    postId,
    isUpvoted,
    announcement_id,
    userStreak,
    userOrganizations,
    isTipper,
  }: {
    comment: any
    isReply: boolean
    postId: string
    isUpvoted: boolean
    announcement_id?: string
    userStreak?: number
    userOrganizations?: any[]
    isTipper?: boolean
  }) => (
    <Reply
      key={comment.id}
      id={comment.id}
      content={comment.content}
      created_at={comment.created_at}
      gifUrl={comment.gifUrl}
      user={{
        id: comment.user.id,
        username: comment.user.username,
        display_name: comment.user.display_name || comment.user.username,
        profile_photo_url: comment.user.profile_photo_url || null,
        ditto: comment.user.ditto || 0,
        activeStreakCount: comment.user.activeStreakCount || 0,
        twitter_id: comment.user.twitter_id || null,
        last_name: "",
        wallet_address: null,
        role: "user",
        extraRoles: [],
        cover_photo_url: null,
        bio: null,
        website: null,
        following_count: 0,
        followers_count: 0,
        comments_count: 0,
        twitter_username: null,
        twitterConnected: false,
      }}
      upvotes={comment.upvotes}
      downvotes={comment.downvotes}
      comment_count={comment.comment_count}
      reply_count={comment.reply_count}
      view_count={comment.view_count}
      website_url=""
      updated_at={comment.created_at}
      user_id={comment.user.id}
      deleted_at={null}
      last_commented_at={null}
      only_followers={false}
      on_chain={false}
      isReply={isReply}
      isUpvoted={isUpvoted}
      post_id={postId}
      announcement_id={announcement_id}
      userStreak={userStreak}
      userOrganizations={userOrganizations}
      isTipper={isTipper}
    />
  )
)

function CommentPage({
  page,
  isReply,
  postId,
  announcement_id,
  tipperIds = [],
}: {
  page: PaginatedComments
  isReply: boolean
  postId: string
  announcement_id?: string
  tipperIds?: string[]
}) {
  const flatIds = useMemo(() => {
    return page.data.map((r: any) => r.id) || []
  }, [page.data])

  const flatUserIds = useMemo(() => {
    return page.data.map((r: any) => r.user?.id).filter(Boolean) || []
  }, [page.data])

  const { data: upvotedPosts } = useUpvotedStatus(flatIds, announcement_id ? "announcement" : undefined)
  const { data: userStreaks } = useUserStreaksByIds(flatUserIds)
  const { data: userOrganizations, getOrganizationsForUser } = useBulkUserOrganizations(flatUserIds)

  const isPostUpvoted = useCallback(
    (commentId: string) => {
      return Boolean((upvotedPosts || [])?.includes(commentId))
    },
    [upvotedPosts]
  )

  const getUserStreak = useCallback(
    (userId: string) => {
      if (!userStreaks || !Array.isArray(userStreaks)) return 0
      const streak = userStreaks.find((s) => s.user_id === userId)
      return streak?.current_streak || 0
    },
    [userStreaks]
  )

  return (
    <>
      {page.data.map((comment) => {
        // Check if this is a tip comment by checking for tip-related fields
        const isTipComment = comment.tip_amount && comment.tip_token && comment.recipient_username;
        
        if (isTipComment) {
          return (
            <TipComment
              key={comment.id}
              id={comment.id}
              user={{
                id: comment.user.id,
                username: comment.user.username,
                display_name: comment.user.display_name || comment.user.username,
                profile_photo_url: comment.user.profile_photo_url || undefined,
              }}
              tipAmount={comment.tip_amount!}
              tipToken={comment.tip_token!}
              message={comment.content}
              created_at={comment.created_at}
              recipientUsername={comment.recipient_username!}
            />
          );
        }
        
        return (
          <MemoizedReply
            key={comment.id}
            comment={comment}
            isReply={isReply}
            postId={postId}
            isUpvoted={isPostUpvoted(comment.id)}
            announcement_id={announcement_id}
            userStreak={getUserStreak(comment.user?.id)}
            userOrganizations={getOrganizationsForUser(comment.user?.id)}
            isTipper={tipperIds.includes(comment.user?.id)}
          />
        );
      })}
    </>
  )
}

export default memo(CommentPage)
