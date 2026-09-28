import { sendApiRequest } from "~/lib/fetchService"

/**
 * Interface for OTP request parameters
 */
interface SendOtpRequest {
  email: string
  invitationCode?: string
}

/**
 * Interface for OTP verification request parameters
 */
interface VerifyOtpRequest {
  email: string
  code: string
  poppinId?: string
}

/**
 * Interface for OTP response data.
 *
 * The verify-otp endpoint returns a Firebase custom token bound to the
 * email-verified user's UID. The caller MUST pass this to
 * signInWithCustomToken before continuing — without it the extension
 * keeps using whichever Firebase session was previously cached, which
 * silently leaks the previous user's identity to /users/me.
 */
export interface OtpResponse {
  success: boolean
  message?: string
  error?: string
  status?: number
  access_token?: string
  user?: {
    id?: string
    username?: string
  }
}

/**
 * OTP Service class for handling OTP-related API operations
 */
class OtpService {
  /**
   * Send OTP to the provided email address
   * @param data - Object containing email address
   * @returns Promise with OTP response data
   */
  static async sendOtp(data: SendOtpRequest): Promise<OtpResponse> {
    return sendApiRequest<OtpResponse>({
      url: "/auth/send-otp",
      method: "POST",
      data,
      apiType: "backend"
    })
  }

  /**
   * Verify OTP code for the provided email address
   * @param data - Object containing email, code, and optional poppinId
   * @returns Promise with verification response data
   */
  static async verifyOtp(data: VerifyOtpRequest): Promise<OtpResponse> {
    return sendApiRequest<OtpResponse>({
      url: "/auth/verify-otp",
      method: "POST",
      data,
      apiType: "backend"
    })
  }
}

export default OtpService 