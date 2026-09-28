import { useMutation, useQueryClient } from "@tanstack/react-query"
import { WebsitePostService } from "~/services/WebsitePostService"
import { WebsitePost } from "~/types/websitePost"

export interface VoteParams {
  id: string
  vote: "upvote" | "downvote" | "unupvote" | "undownvote"
  isAlreadyVoted: boolean
  authorId: string
  parentId: string
  type?: string // Optional type field for announcements
}

/**
 * A vote is INSTANT, and it costs zero network after the vote itself.
 *
 * The old optimistic branch was dead code: it read
 * getQueryData(["website-posts"]) - an EXACT-key lookup - while every real
 * feed query carries ten params in its key, so the snapshot was always
 * undefined and the whole block never ran. Worse, onSettled invalidated the
 * ["website-posts"] PREFIX, so one tap refetched every loaded page of the
 * infinite feed, sequentially. The reader paid a full feed reload to like a
 * post, and with mutating sort orders the post could jump out from under
 * their thumb.
 *
 * setQueriesData patches the voted row in EVERY matching cache (the
 * prefix-matching pattern useCreateWebsitePost already proved), pages or
 * plain arrays alike. No invalidation: the patch mirrors the server's exact
 * mutation, and being wrong by one vote until the next natural refetch is
 * cheaper than reloading the room on every tap.
 */
type PostsShape =
  | { pages: Array<{ data: WebsitePost[] }> }
  | WebsitePost[]
  | undefined

function patchPost(
  data: PostsShape,
  id: string,
  patch: (p: WebsitePost) => WebsitePost,
): PostsShape {
  if (!data) return data
  if (Array.isArray(data)) return data.map((p) => (p.id === id ? patch(p) : p))
  if (Array.isArray((data as { pages?: unknown }).pages)) {
    const paged = data as { pages: Array<{ data: WebsitePost[] }> }
    return {
      ...paged,
      pages: paged.pages.map((page) =>
        Array.isArray(page?.data)
          ? { ...page, data: page.data.map((p) => (p.id === id ? patch(p) : p)) }
          : page,
      ),
    }
  }
  return data
}

export function useWebsitePostVote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: VoteParams) => {
      return WebsitePostService.vote(params)
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["website-posts"] })
      // Snapshot every matching cache, keys included, for the rollback.
      const snapshots = queryClient.getQueriesData<PostsShape>({
        queryKey: ["website-posts"],
      })
      const delta = variables.vote.startsWith("un") ? -1 : 1
      queryClient.setQueriesData<PostsShape>(
        { queryKey: ["website-posts"] },
        (data) =>
          patchPost(data, variables.id, (post) => ({
            ...post,
            upvotes: variables.vote.includes("upvote")
              ? Math.max(0, (post.upvotes ?? 0) + delta)
              : post.upvotes,
            downvotes: variables.vote.includes("downvote")
              ? Math.max(0, (post.downvotes ?? 0) + delta)
              : post.downvotes,
          })),
      )
      return { snapshots }
    },
    onError: (_err, _variables, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data)
      }
    },
    // No onSettled invalidation, deliberately - see the header.
  })
}
