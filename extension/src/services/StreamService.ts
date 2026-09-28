import { sendApiRequest } from "~/lib/fetchService"

export interface CreateStreamParams {
  link: string
  title: string
  description: string
  speakers: string[]
}

export interface StreamUser {
  id: string
  name: string
  image: string
  custom: {
    imageUrl: string
    username: string
  }
  role: string
  created_at: string
  updated_at: string
  banned: boolean
  online: boolean
}

export interface StreamSession {
  id: string
  started_at: string
  ended_at: string | null
  participants: Array<{
    user: StreamUser
    user_session_id: string
    role: string
    joined_at: string
  }>
  participants_count_by_role: Record<string, number>
  anonymous_participant_count: number
  live_started_at: string | null
  live_ended_at: string | null
}

export interface StreamCall {
  type: string
  id: string
  cid: string
  current_session_id: string
  created_by: StreamUser
  custom: {
    title: string
    description: string
    link?: string

    profile_photo_url: string
    ditto: number
    username: string
    extraRoles: string[]
    display_name: string
  }
  created_at: string
  updated_at: string
  recording: boolean
  transcribing: boolean
  captioning: boolean
  ended_at: string | null
  starts_at: string | null
  session: StreamSession | null
}

export interface StreamMember {
  id: string
  role: string
  user: StreamUser
}

export interface StreamCallResponse {
  call: StreamCall
  members: StreamMember[]
  own_capabilities: string[]
  blocked_users: any[]
}

export interface StreamResponse {
  success: boolean
  data: {
    call: StreamCall
  }
}

export interface GetStreamsResponse {
  success: boolean
  data: {
    calls: StreamCallResponse[]
    duration: string
    metadata: {
      clientRequestId: string
      responseCode: number
      rateLimit: {
        rateLimit: number
        rateLimitRemaining: number
        rateLimitReset: string
      }
    }
  }
}

export class StreamService {
  /**
   * Create a new stream
   * @param params Stream creation parameters
   * @returns Promise with the created stream data
   */
  public static async create(params: CreateStreamParams) {
    const response = await sendApiRequest<StreamResponse>({
      method: "POST",
      url: "/stream",
      data: params,
      apiType: "next",
    })
    return response
  }

  /**
   * Get all streams
   * @returns Promise with the list of streams
   */
  public static async get() {
    const response = await sendApiRequest<GetStreamsResponse>({
      method: "GET",
      url: "/stream",
      apiType: "next",
    })
    return response
  }
}
