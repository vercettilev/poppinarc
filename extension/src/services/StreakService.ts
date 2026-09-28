import { sendApiRequest } from "~/lib/fetchService"
import { PaginatedData } from "~/types/fetchTypes"

export interface Streak {
  id: string
  user_id: string
  count: number
  started_at: string
  last_incremented_at: string
  created_at: string
  updated_at: string
}

interface StreakRankResponse {
  rank: number
  total_participants: number
  streak_count: number
  has_active_streak: boolean
  streak?: Streak
}

export interface UserStreakStatus {
  user_id: string
  current_streak: number
  max_streak: number
  last_activity_date: string | null
}

export class StreakService {
  /**
   * Get current streaks for multiple users
   * @param userIds Array of user IDs to fetch streaks for
   * @returns Promise with array of user streak statuses
   */
  static async getUserStreaksByIds(userIds: string[]) {
    return sendApiRequest<UserStreakStatus[]>({
      url: "/streaks/user-streaks",
      method: "GET",
      params: {
        user_ids: userIds,
      },
    })
  }
  /**
   * Get streaks leaderboard with pagination
   * @param params Query parameters for filtering and pagination
   * @returns Promise with array of users and pagination metadata including rank
   */
  static async getStreaks(params?: {
    cursor?: string
    limit?: number
    sort?: string
  }) {
    return sendApiRequest<PaginatedData<Streak>>({
      url: "/streaks",
      method: "GET",
      params: {
        ...params,
        limit: params?.limit ? Number(params.limit) : undefined,
      },
    })
  }

  /**
   * Get current user's active streak
   * @returns Promise with streak data
   */
  static async getActiveStreak() {
    return sendApiRequest<Streak>({
      url: "/streaks/active",
      method: "GET",
    })
  }

  /**
   * Get all streaks for current user
   * @returns Promise with array of streaks
   */
  static async getUserStreaks() {
    return sendApiRequest<Streak[]>({
      url: "/streaks/user",
      method: "GET",
    })
  }

  /**
   * Get streak by ID
   * @param id Streak ID to fetch
   * @returns Promise with streak data
   */
  static async getStreak(id: string) {
    return sendApiRequest<Streak>({
      url: `/streaks/${id}`,
      method: "GET",
    })
  }

  /**
   * Get current user's streak rank
   * @returns Promise with user's streak rank data
   */
  static async getUserRank() {
    return sendApiRequest<StreakRankResponse>({
      url: "/streaks/rank",
      method: "GET",
    })
  }
}
