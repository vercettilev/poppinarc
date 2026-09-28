import { sendApiRequest } from "~/lib/fetchService"

export interface PostsCountResponse {
  count: number
}

/**
 * Service class to handle API calls related to posts count.
 */
export class PostsCountService {
  /**
   * Fetches posts count for a given URL.
   *
   * @param url - The URL to fetch posts count for.
   * @returns A promise that resolves to an array of PostsCountResponse objects.
   */
  static async getPostsCount(url: string): Promise<PostsCountResponse[]> {
    const endpoint = `/posts/count?url=${encodeURIComponent(url)}`
    return sendApiRequest<PostsCountResponse[]>({
      url: endpoint,
      method: "GET",
    })
  }
}
