export interface Post {
  id: string
  title: string
  content: string
  user_id: string
  created_at: string
  updated_at: string
  upvote_count: number
  reply_count: number
  user: {
    id: string
    username: string
    display_name: string
    profile_photo_url: string | null
  }
}
