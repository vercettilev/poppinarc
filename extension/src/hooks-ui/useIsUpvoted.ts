import { InfiniteData } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import { useUpvotedStatus } from "~/hooks/useUpvotedStatus"
import { PaginatedData } from "~/types/fetchTypes"
import { WebsitePost } from "~/types/websitePost"

export const useIsUpvoted = (
  data: InfiniteData<PaginatedData<WebsitePost>>,
  type?: string
) => {
  const flatPostIds = useMemo(() => {
    return data?.pages.flatMap((p) => p.data.map((post) => post.id)) || []
  }, [data])

  const detectedType = useMemo(() => {
    if (type) return type
    
    const hasAnnouncements = data?.pages.some((page) => 
      page.data.some((post: any) => post.announcement_id)
    )
    
    return hasAnnouncements ? "announcement" : undefined
  }, [data, type])

  const { data: upvotedPosts } = useUpvotedStatus(flatPostIds, detectedType)

  const isPostUpvoted = useCallback(
    (postId: string) => {
      if (!upvotedPosts || !Array.isArray(upvotedPosts)) return false

      return (upvotedPosts || []).includes(postId || "")
    },
    [upvotedPosts]
  )

  return { isPostUpvoted }
}
