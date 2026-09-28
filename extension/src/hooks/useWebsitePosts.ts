import {
    InfiniteData,
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query"
import { stripQueryParams } from "~/helpers/urlHelper"
import { User } from "~/services/UserService"
import { ReportType, WebsitePostService } from "~/services/WebsitePostService"
import { WebsitePost, WebsitePostQueryParams } from "~/types/websitePost"
import { useCurrentUser } from "./useCurrentUser"

interface UseWebsitePostsParams {
  enabled?: boolean
  userId?: string
  range?: "all" | "year" | "month" | "week" | "today"
  sort?: { field: string; order: "ASC" | "DESC" }
  website_url?: string
  search?: string
  date?: { start: Date; end: Date }
  limit?: number
  isDomainPost?: boolean
  show_all_scores?: boolean
  /** Trades-only / posts-only, filtered SERVER-side. In the queryKey,
   *  because two kinds are two different lists — serving one from the
   *  other's cache pages was the original client-filter bug's cousin. */
  kind?: "trades" | "posts"
}

interface PaginatedResponse {
  data: WebsitePost[]
  meta: { cursor?: string; hasNextPage?: boolean; totalCount?: number }
}

export function useWebsitePosts(params?: UseWebsitePostsParams) {
  const postsQuery = useInfiniteQuery<PaginatedResponse, Error>({
    queryKey: [
      "website-posts",
      params?.sort,
      params?.range,
      params?.website_url,
      params?.search,
      params?.date,
      params?.limit,
      params?.userId,
      params?.isDomainPost,
      params?.show_all_scores,
      params?.kind,
    ],
    queryFn: ({ pageParam }) => {
      const queryParams: WebsitePostQueryParams = {
        cursor: pageParam as string | undefined,
        sort: params?.sort,
        range: params?.range,
        website_url: stripQueryParams(params?.website_url || ""),
        origin: params?.isDomainPost ? params?.website_url : undefined,
        search: params?.search,
        date: params?.date,
        limit: params?.limit,
        user_id: params?.userId,
        isDomainPost: !!params?.isDomainPost,
        show_all_scores: params?.show_all_scores,
        kind: params?.kind,
      }

      return WebsitePostService.get(queryParams)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.cursor || undefined,
    getPreviousPageParam: () => undefined,
    enabled: params?.enabled !== false,
  })

  return postsQuery
}

/**
 * Hook to fetch comment counts for specific posts and/or parent comments
 */
export function useCommentCounts(params: {
  post_ids: string[]
  parent_ids?: string[]
  enabled?: boolean
}) {
  const { post_ids, parent_ids, enabled = true } = params

  return useQuery({
    queryKey: ["comment-counts", post_ids.toString(), parent_ids?.toString],
    queryFn: () =>
      WebsitePostService.getCommentCounts({
        post_ids,
        parent_ids: parent_ids || [],
      }),
    enabled: enabled && post_ids.length > 0,
  })
}

/**
 * Hook to create a new website post
 */
export function useCreateWebsitePost() {
  const queryClient = useQueryClient()
  const { data: currentUser } = useCurrentUser()
  return useMutation({
    mutationFn: (params: any) => {
      return WebsitePostService.create(params)
    },
    onSuccess: (newPost) => {
      newPost.user = currentUser as User

      // Update all website-posts queries
      queryClient.setQueriesData<InfiniteData<PaginatedResponse>>(
        { queryKey: ["website-posts"] },
        (oldData) => {
          if (!oldData) return oldData
          // Create new pages array with the new post at the beginning of the first page
          const updatedPages = oldData.pages.map((page, index) => {
            if (index === 0) {
              return {
                ...page,
                data: [newPost, ...page.data],
              }
            }
            return page
          })

          return {
            ...oldData,
            pages: updatedPages,
          }
        }
      )
      // Invalidate posts count query to refresh the count in UI
      queryClient.invalidateQueries({ queryKey: ["postsCount"] })
    },
    onError: (error) => {
      console.error("Failed to create post", error)
    },
  })
}

export function useDeleteWebsitePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      WebsitePostService.delete({ id, reason }),
    onSuccess: (_, variables) => {
      // Update all website-posts queries
      queryClient.setQueriesData<InfiniteData<PaginatedResponse>>(
        { queryKey: ["website-posts"] },
        (oldData) => {
          if (!oldData) return oldData

          // Remove the deleted post from all pages
          const updatedPages = oldData.pages.map((page) => ({
            ...page,
            data: page.data.filter(
              (post: WebsitePost) => post.id !== variables.id
            ),
          }))

          return {
            ...oldData,
            pages: updatedPages,
          }
        }
      )
    },
    onError: (error) => {
      console.error("Failed to delete post", error)
    },
  })
}

/**
 * Hook to fetch a single website post by its ID.
 * @param postId - The ID of the website post.
 */
export function useWebsitePost(postId: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ["website-post", postId],
    queryFn: () => WebsitePostService.getOne(postId),
    enabled: !!postId,
    /**
     * THE POST YOU JUST TAPPED IS ALREADY ON YOUR SCREEN.
     *
     * Opening a post from the feed replaced it with a centered spinner
     * while the network re-fetched a row the reader had been reading a
     * frame earlier - the one navigation in the product where the
     * destination was guaranteed to be in hand and we threw it away.
     *
     * The feed's cache is searched for the row and it is used as the
     * INITIAL data, not as the answer: the query still runs, and the
     * detail response (comments, viewer state) replaces it as soon as it
     * lands. A post opened from a link, or one scrolled past long enough
     * ago to be evicted, finds nothing here and behaves exactly as before.
     */
    initialData: () => {
      if (!postId) return undefined
      const lists = queryClient.getQueriesData<{
        pages?: Array<{ data?: WebsitePost[] }>
      }>({ queryKey: ["website-posts"] })
      for (const [, cached] of lists) {
        for (const page of cached?.pages ?? []) {
          const hit = page?.data?.find((p) => p.id === postId)
          if (hit) return hit
        }
      }
      return undefined
    },
    /**
     * Seeded rows are STALE the moment they are handed over - the feed's
     * copy has no comments and an older vote count - so the fetch always
     * runs. Without this, react-query treats fresh initialData as a
     * complete answer and never asks.
     */
    initialDataUpdatedAt: 0,
  })
}

/**
 * Hook to report a website post, comment, or reply
 */
export function useReportWebsitePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      postId,
      type,
      contentType = "post",
    }: {
      postId: string
      type: ReportType
      contentType?: "post" | "comment" | "reply"
    }) => WebsitePostService.report(postId, type, contentType),
    onSuccess: () => {
      // Optionally invalidate queries if needed
      // queryClient.invalidateQueries({ queryKey: ["website-posts"] })
    },
  })
}

/**
 * Hook to get the short link for a website post by its ID
 */
export function useWebsitePostShortLink() {
  return useMutation<
    { short_code: string; website_post_id: string; created_at: string },
    Error,
    string
  >({
    mutationFn: (postId: string) => WebsitePostService.getShortLink(postId),
  })
}
