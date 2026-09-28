import { InfiniteData } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import { useUpvotedStatus } from "~/hooks/useUpvotedStatus"
import { PaginatedData } from "~/types/fetchTypes"
import { Reply } from "~/types/reply"

export const useReplyUpvoted = (data: InfiniteData<PaginatedData<Reply>>) => {
  const flatPostIds = useMemo(() => {
    return (
      data?.pages.flatMap((r) => r.data.map((reply) => reply.post.id)) || []
    )
  }, [data])
  const { data: upvotedPosts } = useUpvotedStatus(flatPostIds)

  const isPostUpvoted = useCallback(
    (postId: string) => {
      if (!upvotedPosts || !Array.isArray(upvotedPosts)) return false
      return upvotedPosts.includes(postId || "")
    },
    [upvotedPosts]
  )

  return { isPostUpvoted }
}
