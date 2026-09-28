import { sendMessageToBackground } from "~/helpers/messaging"

export interface LogoutResponse {
  success: boolean
  message?: string
}

/**
 * AuthService provides methods for authentication-related API calls.
 */
export default class AuthService {
  /**
   * Logs out the current user.
   *
   * @returns {Promise<LogoutResponse>} The result of the logout API call.
   */
  static logout(): Promise<LogoutResponse> {
    return sendMessageToBackground("LOGOUT", {})
  }
}
