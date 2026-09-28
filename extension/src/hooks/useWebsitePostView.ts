import { useMutation, UseMutationResult } from "@tanstack/react-query"
import { WebsitePostService } from "~/services/WebsitePostService"

export type ViewPostsParams = {
  ids: string[]
}

// Define the response type of the view API call. Adjust this type based on actual API response.
export type ViewPostsResponse = unknown

/**
 * Hook for recording views for website posts.
 *
 * Usage:
 * const { mutate, data, isLoading, isError } = useWebsitePostView();
 * mutate({ ids: ["post1", "post2"] });
 *
 * @returns {UseMutationResult<ViewPostsResponse, Error, ViewPostsParams>} Object from react-query's useMutation hook.
 */
export function useWebsitePostView(): UseMutationResult<
  ViewPostsResponse,
  Error,
  ViewPostsParams
> {
  return useMutation<ViewPostsResponse, Error, ViewPostsParams>({
    mutationFn: (params: ViewPostsParams) => WebsitePostService.view(params),
  })
}
