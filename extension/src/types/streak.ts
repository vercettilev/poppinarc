export interface User {
  username: string
  display_name: string
  profile_photo_url: string | null
  ditto: number
  extraRoles: string[]
  role: "user" | "admin"
}

export interface Streak {
  id: string
  user_id: string
  streak_count: number
  start_date: string
  last_activity_date: string
  end_date: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  user: User
}

// Add to existing PaginatedResponse type if not already present
export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    nextCursor?: Date
    rank?: number
    total: number
  }
}
