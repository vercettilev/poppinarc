import { AxiosRequestHeaders } from "axios"
import { sendApiRequest } from "~/lib/fetchService"
import { PaginatedData } from "~/types/fetchTypes"
import { Post } from "~/types/post"
import { Reply } from "~/types/reply"
import { User } from "./UserService"

export interface Comment {
  id: string
  content: string
  user_id: string
  post_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  parent_id: string | null
  reply_count: number
  upvotes: number
  downvotes: number
  last_commented_at: string | null
  view_count: number
  gifUrl?: string
  user: User
  post: Post
  parent: Comment | null
  comment_count: number
  tip_amount?: string
  tip_token?: string
  recipient_username?: string
}
interface CreateCommentParams {
  content: string
  post_id: string
  parent_id?: string
  gifUrl?: string
  announcement_id?: string
  // Tip-related fields (optional)
  tip_amount?: string
  tip_token?: string
  recipient_username?: string
}

interface GetCommentsParams {
  parent_id?: string
  post_id?: string
  cursor?: string
  limit?: number
}

export class CommentService {
  /**
   * Create a new comment or reply
   * @param params Comment parameters including content and post/parent IDs
   * @returns Promise with the created comment
   */
  public static async create(params: CreateCommentParams) {
    return sendApiRequest<Comment>({
      url: "/comments",
      method: "POST",
      data: {
        type: params.announcement_id ? "announcement" : "website",
        content: params.content,
        post_id: params.post_id,
        parent_id: params.parent_id,
        gifUrl: params.gifUrl,
        // Tip-related fields (optional)
        tip_amount: params.tip_amount,
        tip_token: params.tip_token,
        recipient_username: params.recipient_username,
      },
    })
  }

  /**
   * Delete a comment
   * @param id Comment ID to delete
   */
  public static async delete(id: string) {
    return sendApiRequest<void>({
      url: `/comments/${id}`,
      method: "DELETE",
    })
  }

  /**
   * Get comments with optional filtering and pagination
   * @param params Query parameters for filtering and pagination
   * @returns Promise with array of comments and pagination metadata
   */
  public static async get(params?: GetCommentsParams) {
    return sendApiRequest<PaginatedData<Comment>>({
      url: "/comments",
      method: "GET",
      params: {
        ...params,
        // Convert limit to number if it exists
        limit: params?.limit ? Number(params.limit) : undefined,
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
  }) {
    return sendApiRequest<Reply>({
      url: `/comments/${params.id}/vote`,
      method: "POST",
      data: {
        vote: params.vote,
        isAlreadyVoted: params.isAlreadyVoted,
        authorId: params.authorId,
      },
    })
  }
}
