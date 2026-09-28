import { sendApiRequest } from "~/lib/fetchService"
import { PaginatedData } from "~/types/fetchTypes"
import { Post } from "~/types/post"
import { Reply } from "~/types/reply"
import type { ProfileCounts } from "~/types/user"

/**
 * The account no longer chooses a venue or a network.
 *
 * `TradingVenue` was "polymarket" | "kalshi" and `PreferredNetwork` was
 * "solana" | "polygon": both belonged to the prediction product, and the
 * post-profile flow that captured them left with it. The backend may still
 * return the columns; nothing here reads them.
 */

export interface User {
  id: string
  username: string
  display_name: string
  last_name: string
  profile_photo_url: string | null
  ditto: number
  wallet_address: string | null
  role: "user" | "admin"
  extraRoles: string[]
  cover_photo_url: string | null
  bio: string | null
  website: string | null
  following_count: number
  followers_count: number
  comments_count: number
  twitter_id: string | null
  twitter_username: string | null
  twitterConnected: boolean
  activeStreakCount?: number
  access_token?: string
  success?: boolean
  // Onboarding preferences. All nullable: legacy users + skipped steps land
  // here as null and the UI falls back to its built-in defaults.
  notifications_enabled?: boolean | null
  /** Opt-in to the named wins rail. Absent on an older server; absent
   *  means NOT opted in, which is the safe reading of silence here. */
  public_wins?: boolean | null
  /** Whose key trades: the embedded wallet (custodial, default) or the reader's own (external, Phantom). */
  wallet_mode?: "custodial" | "external" | null
  external_address?: string | null
}

type UpvotedStatusResponse = string[]

type StreakStatusResponse = any[]

interface FollowersResponse {
  data: User[]
  meta: {
    cursor: string | null
  }
}

interface FollowingResponse {
  data: User[]
  meta: {
    cursor: string | null
  }
}

interface UpvotedPostsResponse {
  data: Post[]
  meta: {
    cursor: string | null
  }
}

interface UserRepliesResponse {
  data: Reply[]
  meta: {
    hasNextPage: boolean
    cursor?: string
  }
}

interface NotificationActionTakenBy {
  username: string
  id: string
  profile_photo_url: string | null
  is_pro: boolean
  followers: Array<any>
  followings: Array<any>
  display_name: string
  ditto: number
}

export interface Notification {
  id: string
  user_id: string
  action_taken_by: NotificationActionTakenBy
  created_at: string
  read_at: string | null
  deleted_at: string | null
  type: string
  amount: number | null
  content: string | null
  url: string | null
  topic_name: string | null
  website_url: string | null
  post_type: string | null
  group_id: string | null
  invitation_status: 'pending' | 'accepted' | 'declined' | null
  count: string
  user: User & {
    is_pro: boolean
    followers: Array<any>
    followings: Array<any>
  }
}

interface NotificationsResponse {
  data: Notification[]
  meta: {
    hasNextPage: boolean
  }
}

interface NotificationCount {
  count: number
}

interface InvitationCode {
  id: string
  code: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  redeemed_at: string | null
  user_id: string | null
  redeemed_by: string | null
  redeemedBy?: User
}

type InvitationCodesResponse = InvitationCode[]

interface UserTasks {
  login_streak: number
  ditto: number
  last_posted_at: string
  last_voted_at: string
  invites_count: number
}

interface OrganizationOwner {
  id: string
  username: string
  display_name: string
  profile_photo_url: string | null
}

export interface Organization {
  id: string
  name: string
  badgeUrl: string
  owner_user_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  owner: OrganizationOwner
  role: string
  primaryColor: string
  secondaryColor: string
  tertiaryColor: string
  doodleBgUrl: string
  domain?: string
  isAutoOpen?: boolean
  isChatTabFirst?: boolean // Added for chat tab order
  verification?: {
    id: string
    organization_id: string
    verification_code: string
    verification_code_expires_at: string
    is_verified: boolean
    verification_method: string
    verified_at: string
    created_at: string
    updated_at: string
  }
}

// Observable Organization interface that extends EventEmitter
export interface ObservableOrganization extends Organization {
  on: (event: string, callback: (data: any) => void) => () => void
  emit: (event: string, data?: any) => void
  off: (event: string) => void
  removeAllListeners: () => void
}

type UserOrganizationsResponse = Organization[]

interface BulkUserOrganizationsResponse {
  [userId: string]: Organization[]
}

export class UserService {
  /**
   * Get current user information
   * @returns Promise with user data
   */
  public static async getCurrentUser() {
    return sendApiRequest<User>({
      url: "/users/me",
      method: "GET",
    })
  }

  /**
   * Get upvoted status for multiple posts
   * @param postIds Array of post IDs to check
   * @param type Optional type parameter ("announcement" or "website")
   * @returns Promise with object mapping post IDs to upvoted status
   */
  public static async getUpvotedStatus(postIds: string[], type?: string) {
    if (!postIds.length) return []

    const filteredPostIds = postIds.filter(Boolean)

    if (!filteredPostIds.length) return []

    const params: any = {
      post_ids: postIds,
    }

    // Add type parameter if provided
    if (type) {
      params.type = type
    }

    return sendApiRequest<UpvotedStatusResponse>({
      url: "/users/upvoted-status",
      method: "GET",
      params,
    })
  }

  public static async getStreakStatus(userIds: string[]) {
    if (!userIds.length) return []

    const filteredUserIds = userIds.filter(Boolean)

    if (!filteredUserIds.length) return []

    return sendApiRequest<StreakStatusResponse>({
      url: "/streaks/status",
      method: "GET",
      params: {
        user_ids: filteredUserIds,
      },
    })
  }
  /**
   * Get user leaderboard with pagination
   * @param params Query parameters for filtering and pagination
   * @returns Promise with array of users and pagination metadata including rank
   */
  public static async getLeaderboard(params?: {
    cursor?: string
    limit?: number
  }) {
    return sendApiRequest<PaginatedData<User, { rank: number }>>({
      url: "/users/leaderboard",
      method: "GET",
      params: {
        ...params,
        limit: params?.limit ? Number(params.limit) : undefined,
      },
    })
  }

  /**
   * Get following status for multiple users
   * @param following_ids Array of user IDs to check
   * @returns Promise with array of following statuses
   */
  public static async getFollowingStatus(following_ids: string[]) {
    return sendApiRequest<
      {
        following_id: string
        notify: boolean
      }[]
    >({
      url: "/users/following-status",
      method: "GET",
      params: {
        following_ids,
      },
    })
  }

  public static async followUser(userId: string) {
    return sendApiRequest<void>({
      url: `/users/${userId}/follow`,
      method: "POST",
    })
  }

  public static async unfollowUser(userId: string) {
    return sendApiRequest<void>({
      url: `/users/${userId}/unfollow`,
      method: "POST",
    })
  }

  /**
   * Update notification preferences for a followed user
   * @param userId ID of the user being followed
   * @param notify Boolean indicating whether to receive notifications
   * @returns Promise with void response
   */
  public static async updateFollowNotify(userId: string, notify: boolean) {
    return sendApiRequest<void>({
      url: `/users/${userId}/follow/notify`,
      method: "PATCH",
      data: { notify },
    })
  }

  public static async getProfileCounts(userId: string) {
    return sendApiRequest<ProfileCounts>({
      url: `/users/profile/counts`,
      method: "GET",
      params: {
        user_id: userId,
      },
    })
  }

  /**
   * Get user by username
   * @param userId User ID to fetch
   * @returns Promise with user data
   */
  public static async getUser(userId: string) {
    return sendApiRequest<User>({
      url: `/users/id/${userId}`,
      method: "GET",
    })
  }

  public static async getUserByUsername(username: string) {
    return sendApiRequest<User>({
      url: `/users/username/${username}`,
      method: "GET",
    })
  }

  public static async getFollowers({
    userId,
    limit = 20,
    cursor,
  }: {
    userId: string
    limit?: number
    cursor?: string
  }) {
    return sendApiRequest<FollowersResponse>({
      url: `/users/${userId}/followers`,
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  public static async getFollowing({
    userId,
    limit = 20,
    cursor,
  }: {
    userId: string
    limit?: number
    cursor?: string
  }) {
    return sendApiRequest<FollowingResponse>({
      url: `/users/${userId}/followings`,
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  static async getUpvotedPosts(userId: string, limit: number, cursor?: string) {
    return sendApiRequest<UpvotedPostsResponse>({
      url: `/users/${userId}/upvoted-posts`,
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  public static async getUserReplies(
    userId: string,
    limit: number,
    cursor?: string
  ) {
    return sendApiRequest<UserRepliesResponse>({
      url: `/users/${userId}/replies`,
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  public static async getNotifications(limit: number, cursor?: string) {
    return sendApiRequest<NotificationsResponse>({
      url: "/users/me/notifications",
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  public static async getRedeemedInvitationCodes(
    limit: number,
    cursor?: string
  ) {
    return sendApiRequest<InvitationCodesResponse>({
      url: "/invitation-codes/redeemed",
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  public static async getUnusedInvitationCodes(limit: number, cursor?: string) {
    return sendApiRequest<InvitationCodesResponse>({
      url: "/invitation-codes/unused",
      method: "GET",
      params: {
        limit,
        cursor,
      },
    })
  }

  public static async getUserTasks() {
    return sendApiRequest<UserTasks>({
      url: "/users/me/tasks",
      method: "GET",
    })
  }

  public static async getUsers(search: string) {
    return sendApiRequest<User[]>({
      url: "/users",
      method: "GET",
      params: {
        s: search,
      },
    })
  }

  public static async getInvitationCode(code: string) {
    return sendApiRequest<InvitationCode>({
      url: `/invitation-codes/${code}`,
      method: "GET",
    })
  }

  /**
   * Exchange a Google ID token for a Poppin session, creating the account if
   * this is the first time we have seen it.
   *
   * The extension used to reach this endpoint the long way round: open
   * app.poppin.so/auth in a tab, let the web app call it, and relay the
   * resulting custom token back over externally_connectable. With
   * chrome.identity signing in natively there is no tab to route through,
   * so the extension calls it directly.
   *
   * `code` is sent empty: invite codes arrive on the web join link, not from
   * inside the extension. The backend treats an unknown-but-invite-free
   * signup according to INVITE_ONLY, exactly as it does for the web.
   */
  public static async loginOrCreate(data: { token: string; code?: string }) {
    return sendApiRequest<{ token: string; firebaseToken: string; user: User }>({
      url: "/auth/login-or-create",
      method: "POST",
      data: { token: data.token, code: data.code ?? "" },
    })
  }

  public static async registerProfile(data: {
    username: string
    display_name: string
    profile_photo_url?: string | null
  }) {
    return sendApiRequest<User>({
      url: "/users/me/register",
      method: "POST",
      data,
    })
  }

  /**
   * A BUG REPORT, WITH THE CONTEXT THE REPORTER SHOULD NOT HAVE TO TYPE.
   *
   * Version and page are attached here rather than asked for: "which
   * version are you on" is a question nobody can answer and every support
   * thread opens with. Identity is optional server-side — the person whose
   * session just broke is the one most likely to have something worth
   * reading.
   */
  public static async sendFeedback(message: string) {
    let context = ""
    try {
      const v = chrome?.runtime?.getManifest?.()?.version
      context = [
        v ? `v${v}` : null,
        typeof location !== "undefined" ? location.href.slice(0, 300) : null,
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    } catch {
      // Context is a nicety. A report with none still beats no report.
    }
    return sendApiRequest<{ ok: boolean }>({
      url: "/feedback",
      method: "POST",
      data: { message, context },
    })
  }

  public static async updateProfile(data: {
    username?: string
    display_name?: string
    profile_photo_url?: string | null
    cover_photo_url?: string | null
    notifications_enabled?: boolean
    public_wins?: boolean
  }) {
    return sendApiRequest<User>({
      url: "/users/me",
      method: "PATCH",
      data,
    })
  }

  public static async uploadFile(file: File, options?: {
    width?: number
    height?: number
    quality?: number
    /** 'attention' keeps the face when an off-aspect image must be cropped. */
    crop?: "entropy" | "attention"
  }) {
    // Convert File to base64 string
    const base64String = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
        const base64Data = base64.split(",")[1]
        resolve(base64Data)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    // Build query parameters if options are provided
    const params: Record<string, any> = {}
    if (options?.width) params.width = options.width
    if (options?.height) params.height = options.height
    if (options?.quality) params.quality = options.quality
    if (options?.crop) params.crop = options.crop

    return sendApiRequest<{ url: string }>({
      url: "/upload",
      method: "POST",
      data: {
        file: base64String,
        filename: file.name,
        contentType: file.type,
      },
      params,
      headers: {
        "Content-Type": "application/json",
      },
    })
  }



  /**
   * Where the Connect X flow begins.
   *
   * This used to call the Next app's /createTwitterAuthorizationURL — an
   * address that exists in no deploy of this product, so the onboarding
   * button did nothing at all. The handshake lives in the backend now, where
   * the caller's identity is already known and the PKCE verifier never
   * leaves the server. `apiType` is deliberately absent: this goes through
   * the authenticated backend client, and the guard on the other side is
   * what ties the eventual X handle to THIS account.
   */
  public static async createTwitterUrl() {
    return sendApiRequest<{ url: string }>({
      url: "/auth/x/start",
      method: "GET",
    })
  }

  /**
   * Unlink X. This called POST /removeTwitter for as long as the button
   * existed, and no such route was ever written — settings said "removed
   * successfully" over a link that was still there. It was also aimed at
   * the NEXT app rather than the backend, so both halves of the address
   * were wrong. DELETE /auth/x/link is the real one, on the backend,
   * beside the flow that creates the link.
   */
  public static async removeTwitter() {
    return sendApiRequest<void>({
      url: "/auth/x/link",
      method: "DELETE",
    })
  }

  /**
   * Get current user's organizations
   * @returns Promise with array of organizations where the user is a member
   */
  public static async getUserOrganizations() {
    return sendApiRequest<UserOrganizationsResponse>({
      url: "/users/me/organizations",
      method: "GET",
    })
  }

  /**
   * Get organizations for multiple users in bulk
   * @param userIds Array of user IDs to fetch organizations for
   * @returns Promise with object mapping user IDs to their organizations
   */
  public static async getBulkUserOrganizations(userIds: string[]) {
    if (!userIds.length) return {}

    const filteredUserIds = userIds.filter(Boolean)
    if (!filteredUserIds.length) return {}

    return sendApiRequest<BulkUserOrganizationsResponse>({
      url: "/users/bulk/organizations",
      method: "GET",
      params: {
        user_ids: filteredUserIds.join(',')
      },
    })
  }
}
