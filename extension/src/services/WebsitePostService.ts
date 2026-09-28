import { AxiosRequestHeaders } from "axios"
import { stripQueryParams } from "~/helpers/pageUrl"
import { sendApiRequest } from "~/lib/fetchService"
import { PaginatedData } from "~/types/fetchTypes"
import { WebsitePost, WebsitePostQueryParams } from "~/types/websitePost"

export type ReportType =
  | "spam"
  | "harassment"
  | "hate"
  | "violence"
  | "sexual"
  | "misleading"
  | "self_harm"
  | "terrorism"
  | "child_exploitation"
  | "impersonation"
  | "copyright_violation"
  | "privacy_violation"
  | "other"
interface CreatePostParams {
  content: string
  only_followers: boolean
  on_chain: boolean
  website_url: string
  gifUrl?: string
  page_content?: string
  transaction_data?: {
    tokenSymbol?: string
    tokenMint?: string
    tokenAmount?: number
    solAmount?: number
    signature?: string
    tokenImageUrl?: string
    /** The DB defaults absence to 'buy' — every writer should say it. */
    tradeType?: "buy" | "sell"
  }
  prediction_data?: {
    marketTitle: string
    eventTitle?: string
    position: "Yes" | "No"
    amount: number
    signature: string // Required for verification
  }
}

interface UserCommentsResponse {
  data: WebsitePost[]
  meta: {
    cursor: string | null
  }
}

export class WebsitePostService {
  /**
   * Get website posts with optional filtering and pagination
   * @param params Query parameters for filtering and pagination
   * @returns Promise with array of website posts and pagination metadata
   */
  public static async get(params?: WebsitePostQueryParams) {
    return sendApiRequest<PaginatedData<WebsitePost>>({
      url: "/website-post/",
      method: "GET",
      params: {
        ...params,
        // Convert limit to number if it exists
        limit: params?.limit ? Number(params.limit) : undefined,
      },
    })
  }

  /**
   * Helper method to get posts for a specific time range
   * @param range daily, weekly, or monthly
   * @param additionalParams Other query parameters
   */
  public static async getByTimeRange(
    range: WebsitePostQueryParams["range"],
    additionalParams?: Omit<WebsitePostQueryParams, "range">
  ) {
    return this.get({
      ...additionalParams,
      range,
    })
  }

  /**
   * Helper method to get posts for a specific website
   * @param websiteUrl URL of the website
   * @param additionalParams Other query parameters
   */
  public static async getByWebsite(
    websiteUrl: string,
    additionalParams?: Omit<WebsitePostQueryParams, "website_url">
  ) {
    return this.get({
      ...additionalParams,
      website_url: stripQueryParams(websiteUrl),
    })
  }

  /**
   * Get comment counts for specified posts and/or parent comments
   * @param params Object containing post_ids and optional parent_ids
   * @returns Promise with a record of id to comment count mapping
   */
  public static async getCommentCounts(params: {
    post_ids: string[]
    parent_ids?: string[]
  }) {
    return sendApiRequest<Record<string, number>>({
      url: `/comments/count`,
      method: "POST",
      data: {
        post_ids: params.post_ids,
        parent_ids: params.parent_ids || [],
      },
    })
  }

  /**
   * Vote on a website post
   * @param params Vote parameters including post id, vote type, and metadata
   * @returns Promise with the updated post data
   */
  public static async vote(params: {
    id: string
    vote: "upvote" | "downvote" | "unupvote" | "undownvote"
    headers?: AxiosRequestHeaders
    isAlreadyVoted: boolean
    authorId: string
    type?: string // Optional type field for announcements
  }) {
    const payload: any = {
      vote: params.vote,
      isAlreadyVoted: params.isAlreadyVoted,
      authorId: params.authorId,
    }

    // Add type field if provided
    if (params.type) {
      payload.type = params.type
    }

    return sendApiRequest<WebsitePost>({
      url: `/website-post/${params.id}/vote`,
      method: "POST",
      data: payload,
    })
  }

  /**
   * Create a new website post
   * @param params Post creation parameters
   * @returns Promise with the created post data
   */
  public static async create(params: CreatePostParams) {
    const { website_url, ...rest } = params

    return sendApiRequest<WebsitePost>({
      url: "/website-post/", // Use the class name to access static property
      method: "POST",
      data: {
        ...rest,
        website_url: decodeURIComponent(stripQueryParams(website_url)),
      },
    })
  }

  public static async delete({
    id,
    reason,
  }: {
    id: string
    reason?: string
  }) {
    return sendApiRequest({
      url: `/website-post/${id}`,
      method: "DELETE",
      data: reason ? { reason } : undefined,
    })
  }

  public static async getUserComments({
    userId,
    limit = 20,
    cursor,
  }: {
    userId: string
    limit?: number
    cursor?: string
  }) {
    return sendApiRequest<UserCommentsResponse>({
      url: `/website-post/user/${userId}`,
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  /**
   * Get a single website post by its ID.
   * @param postId - The ID of the website post.
   * @returns A promise resolving to the website post.
   */
  public static async getOne(postId: string): Promise<WebsitePost> {
    const res = await sendApiRequest<WebsitePost>({
      url: `/website-post/${postId}`,
      method: "GET",
    })

    if ("success" in res && !res.success) {
      return null as unknown as WebsitePost
    }

    return res
  }

  /**
   * Get the short link for a website post by its ID.
   * @param postId - The ID of the website post.
   * @returns A promise resolving to the short link info.
   */
  public static async getShortLink(postId: string): Promise<{
    short_code: string
    website_post_id: string
    created_at: string
  }> {
    return sendApiRequest<{
      short_code: string
      website_post_id: string
      created_at: string
    }>({
      url: `/website-post/short-link/${postId}`,
      method: "GET",
    })
  }



  // POST /posts/view {ids, type}
  public static async view(params: { ids: string[] }) {
    return sendApiRequest({
      url: "/posts/view",
      method: "POST",
      data: params,
    })
  }

  /**
   * Report a website post, comment, or reply
   * @param id ID of the content to report
   * @param type Type of report
   * @param contentType Type of content being reported (post, comment, or reply)
   */
  public static async report(
    id: string,
    type: ReportType,
    contentType: "post" | "comment" | "reply" = "post"
  ) {
    const endpoint =
      contentType === "post"
        ? `/website-post/${id}/report`
        : `/comments/${id}/report`

    return sendApiRequest({
      url: endpoint,
      method: "POST",
      data: {
        type,
      },
    })
  }

  /**
   * Preview the ditto award + spam verdict for a draft post.
   * Backend uses the heuristic in @repo/commonjs — the same one the
   * rabbit worker runs after submit, so the preview matches the real award.
   */
  public static async calculatePoints(website_url: string, content?: string) {
    return sendApiRequest<{
      ditto: number
      reason: string
      isSpam: boolean
    }>({
      url: "/website-post/calculate-points",
      method: "POST",
      data: {
        website_url: decodeURIComponent(stripQueryParams(website_url)),
        content: content,
      },
    })
  }
}
