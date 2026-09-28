import { useQuery } from "@tanstack/react-query"
import {
  PostsCountResponse,
  PostsCountService,
} from "~/services/PostsCountService"

/**
 * Custom hook to fetch posts count data.
 *
 * @param url - The URL for which to fetch the posts count.
 * @returns Query object containing data, error, and status.
 */
export function usePostsCount(url: string) {
  return useQuery<PostsCountResponse[], Error>({
    queryKey: ["postsCount", url],
    queryFn: () => PostsCountService.getPostsCount(url),
  })
}
