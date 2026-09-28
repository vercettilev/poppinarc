import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { Comment, CommentService } from "~/services/CommentService"
import { OrganizationSearchResponse } from "~/services/OrganizationService"
import { VoteParams } from "./useWebsitePostVote"

interface UseCommentsParams {
  parent_id?: string
  post_id?: string
  limit?: number
  enabled?: boolean
}

/**
 * Hook to fetch comments with infinite scrolling
 */
export function useComments(params?: UseCommentsParams) {
  return useInfiniteQuery({
    queryKey: ["comments", params?.post_id, params?.parent_id],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      // Create the payload without cursor if pageParam is undefined
      const payload = { ...params } as UseCommentsParams & { cursor?: string }
      if (pageParam) {
        payload.cursor = pageParam
      }
      return CommentService.get(payload)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.meta?.cursor || undefined,
    enabled: params?.enabled !== false,
  })
}

/**
 * Hook to create a new comment
 */
export function useCreateComment() {
  const queryClient = useQueryClient()
  const { data: currentUser } = useCurrentUser()

  return useMutation({
    mutationFn: CommentService.create,
    onSuccess: (newComment, variables) => {
      // Attach the current user to the new comment if available.
      if (currentUser) {
        newComment.user = currentUser
      }

      // Normalize parent_id to undefined if it's falsy so that the key matches useComments.
      const key = [
        "comments",
        newComment.post_id,
        newComment.parent_id || undefined,
      ]

      queryClient.setQueriesData<
        InfiniteData<{ data: Comment[]; meta: { cursor: string | null } }>
      >({ queryKey: key }, (oldData) => {
        if (!oldData) {
          // If there's no cached data, construct an initial cache structure.
          return {
            pages: [{ data: [newComment], meta: { cursor: null } }],
            pageParams: [undefined],
          }
        }
        return {
          ...oldData,
          pages: oldData.pages.map(
            (
              page: { data: Comment[]; meta: { cursor: string | null } },
              index: number
            ) => {
              if (index === 0) {
                return { ...page, data: [newComment, ...page.data] }
              }
              return page
            }
          ),
        }
      })

      /**
       * THE COUNT THE READER CAN SEE. The footer chip's number comes from
       * comment_count in the website-posts cache, which nothing here
       * touched - so somebody replied to a post and the count beside their
       * own reply stayed stale until an unrelated refetch. Their own
       * action, unacknowledged. Same prefix-patch the announcement branch
       * below already performs, on the cache the row actually reads.
       */
      if (newComment?.post_id) {
        queryClient.setQueriesData<unknown>(
          { queryKey: ["website-posts"] },
          (data: unknown) => {
            const bump = (p: { id?: string; comment_count?: number }) =>
              p?.id === newComment.post_id
                ? { ...p, comment_count: (p.comment_count || 0) + 1 }
                : p
            if (Array.isArray(data)) return data.map(bump)
            const paged = data as { pages?: Array<{ data?: unknown[] }> } | undefined
            if (Array.isArray(paged?.pages)) {
              return {
                ...paged,
                pages: paged.pages.map((page) =>
                  Array.isArray(page?.data)
                    ? { ...page, data: page.data.map((p) => bump(p as never)) }
                    : page,
                ),
              }
            }
            return data
          },
        )
      }

      // If this is an announcement comment, update the comment count in organization search cache
      if (variables.announcement_id) {
        // Update all organization search queries to increment comment count for this announcement
        queryClient.setQueriesData<OrganizationSearchResponse>(
          { queryKey: ["organization-search"], type: "active" },
          (oldData: OrganizationSearchResponse | undefined) => {
            if (!oldData || !oldData.data) return oldData
            
            return {
              ...oldData,
              data: oldData.data.map((announcement) => {
                if (announcement.id === variables.announcement_id) {
                  return {
                    ...announcement,
                    comment_count: (announcement.comment_count || 0) + 1
                  }
                }
                return announcement
              })
            }
          }
        )
      }
    },
  })
}

/**
 * Hook to delete a comment
 */
export function useDeleteComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: CommentService.delete,
    onSuccess: (_data, commentId) => {
      // Invalidate and refetch comments queries
      queryClient.invalidateQueries({
        queryKey: ["comments"],
      })
    },
  })
}

export function useCommentVote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: VoteParams) => {
      return CommentService.vote(params)
    },
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["comments"] })

      // Snapshot the previous value
      const previousPosts = queryClient.getQueryData<{
        pages: { data: Comment[] }[]
      }>(["comments"])

      // Optimistically update the posts
      if (previousPosts) {
        queryClient.setQueryData(["comments"], {
          ...previousPosts,
          pages: previousPosts.pages.map((page) => ({
            ...page,
            data: page.data.map((post) => {
              if (post.id === variables.id) {
                const voteChange = variables.vote.startsWith("un") ? -1 : 1
                return {
                  ...post,
                  upvotes: variables.vote.includes("upvote")
                    ? post.upvotes + voteChange
                    : post.upvotes,
                  downvotes: variables.vote.includes("downvote")
                    ? post.downvotes + voteChange
                    : post.downvotes,
                }
              }
              return post
            }),
          })),
        })
      }

      return { previousPosts }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousPosts) {
        queryClient.setQueryData(["comments"], context.previousPosts)
      }
    },
    onSettled: () => {
      // Refetch after error or success
      queryClient.invalidateQueries({ queryKey: ["comments"] })
    },
  })
}
