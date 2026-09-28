// types.ts

/**
 * Allowed HTTP methods
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"

/**
 * Shape of the request payload sent to the background script
 */
export interface ApiRequestPayload {
  url: string
  method: HttpMethod
  // `data` is optional for GET/DELETE, but useful for POST/PUT
  data?: unknown
  // `params` can be used for query parameters
  params?: Record<string, any>
}

/**
 * The shape of the message we send to the background script
 */
export interface ApiRequestMessage {
  type: "API_REQUEST"
  payload: ApiRequestPayload
}

/**
 * The response shape returned from the background script
 */
export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
}

export interface Meta {
  hasNextPage: boolean
  cursor?: string
  totalCount?: number
}
export interface PaginatedData<T, U = {}> {
  data: T[]
  meta: Meta & Partial<U>
}
