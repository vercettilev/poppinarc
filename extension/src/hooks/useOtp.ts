import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import OtpService from '~/services/otp.service'

/**
 * Hook for managing OTP operations including sending and verifying OTP codes
 * @returns Object containing OTP operations and state
 */
export function useOtp() {
  const [resendTimer, setResendTimer] = useState(0)

  const sendOtpMutation = useMutation({
    mutationFn: (data: { email: string; invitationCode?: string }) => OtpService.sendOtp(data),
    onSuccess: () => {
      setResendTimer(60) // Start 60-second countdown
    },
  })

  const verifyOtpMutation = useMutation({
    mutationFn: (data: { email: string; code: string; poppinId?: string; invitationCode?: string }) => 
      OtpService.verifyOtp(data),
  })

  /**
   * Send OTP to the provided email address
   * @param email - Email address to send OTP to
   * @param invitationCode - Optional invitation code
   */
  const sendOtp = (email: string, invitationCode?: string) => {
    return sendOtpMutation.mutate({ email, invitationCode })
  }

  /**
   * Verify OTP code for the provided email address
   * @param email - Email address
   * @param code - OTP code to verify
   * @param poppinId - Optional poppin ID
   */
  const verifyOtp = (email: string, code: string, poppinId?: string, invitationCode?: string) => {
    return verifyOtpMutation.mutateAsync({ email, code, poppinId, invitationCode })
  }

  /**
   * Resend OTP to the provided email address
   * @param email - Email address to resend OTP to
   * @param invitationCode - Optional invitation code
   */
  const resendOtp = (email: string, invitationCode?: string) => {
    if (resendTimer > 0) return
    return sendOtpMutation.mutate({ email, invitationCode })
  }

  return {
    // Actions
    sendOtp,
    verifyOtp,
    resendOtp,
    
    // State
    resendTimer,
    setResendTimer,
    
    // Send OTP state
    sendOtpLoading: sendOtpMutation.isPending,
    sendOtpError: sendOtpMutation.error?.message,
    sendOtpSuccess: sendOtpMutation.isSuccess,
    sendOtpData: sendOtpMutation.data,
    
    // Verify OTP state
    verifyOtpLoading: verifyOtpMutation.isPending,
    verifyOtpError: verifyOtpMutation.error?.message,
    verifyOtpSuccess: verifyOtpMutation.isSuccess,
    verifyOtpData: verifyOtpMutation.data,
    
    // Reset functions
    resetSendOtp: sendOtpMutation.reset,
    resetVerifyOtp: verifyOtpMutation.reset,
  }
} 