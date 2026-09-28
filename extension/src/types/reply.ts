export interface Reply {
  id: string
  content: string
  created_at: Date
  updated_at: Date
  user: {
    id: string
    username: string
    display_name: string
    profile_photo_url: string | null
    extraRoles: string[]
    role: string
    activeStreakCount?: number
  }
  post: {
    id: string
    title: string
    user: {
      id: string
      username: string
      display_name: string
      profile_photo_url: string | null
      extraRoles: string[]
      role: string
      activeStreakCount?: number
    }
    upvotes: number
    view_count: number
    comment_count: number
  }
}
